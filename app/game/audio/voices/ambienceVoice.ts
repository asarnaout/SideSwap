/**
 * Wind and road roar.
 *
 * This is what actually conveys speed. The engine tells you how hard you are
 * working; the rush past the windows tells you how fast you are going, and it
 * scales superlinearly for the same reason it does in a real car — drag goes as
 * the square of velocity. Scaling it linearly is what makes 20mph and 60mph
 * sound like the same journey.
 */
import type { DriveAudioParams } from "../audioMath";
import {
  CONTINUOUS_LOOKAHEAD,
  EPSILON_GAIN,
  EPSILON_HZ,
  EPSILON_Q,
  writeIfChanged,
} from "../paramUtils";
import { createNoiseSource, type VoiceContext } from "./voiceContext";

/** Wind is inertial and should lag the throttle rather than track it. */
const TAU_WIND_GAIN = 0.1;
const TAU_WIND_HZ = 0.12;
const TAU_ROAD = 0.09;

export class AmbienceVoice {
  private readonly context: AudioContext;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioBufferSourceNode[] = [];
  private readonly windFilter: BiquadFilterNode;
  private readonly windGain: GainNode;
  private readonly roadFilter: BiquadFilterNode;
  private readonly roadGain: GainNode;
  private previous = { windHz: 0, windGain: -1, roadHz: 0, roadQ: 0, roadGain: -1 };

  constructor(voice: VoiceContext) {
    const context = voice.context;
    this.context = context;

    // Two taps on the shared buffer at incommensurate rates. Running both
    // filters off identical noise would sound phasey and hollow.
    const windSource = createNoiseSource(voice, 1);
    const roadSource = createNoiseSource(voice, 0.7413);

    this.windFilter = context.createBiquadFilter();
    this.windFilter.type = "highpass";
    this.windFilter.frequency.value = 260;
    this.windFilter.Q.value = 0.5;
    this.windGain = context.createGain();
    this.windGain.gain.value = 0;

    this.roadFilter = context.createBiquadFilter();
    this.roadFilter.type = "bandpass";
    this.roadFilter.frequency.value = 120;
    this.roadFilter.Q.value = 0.9;
    this.roadGain = context.createGain();
    this.roadGain.gain.value = 0;

    windSource.connect(this.windFilter).connect(this.windGain).connect(voice.destination);
    roadSource.connect(this.roadFilter).connect(this.roadGain).connect(voice.destination);

    this.nodes.push(this.windFilter, this.windGain, this.roadFilter, this.roadGain);
    this.sources.push(windSource, roadSource);
    for (const source of this.sources) source.start();
  }

  update(params: DriveAudioParams): void {
    const when = this.context.currentTime + CONTINUOUS_LOOKAHEAD;
    const previous = this.previous;
    if (writeIfChanged(this.windFilter.frequency, params.windHz, previous.windHz, EPSILON_HZ, when, TAU_WIND_HZ)) {
      previous.windHz = params.windHz;
    }
    if (writeIfChanged(this.windGain.gain, params.windGain, previous.windGain, EPSILON_GAIN, when, TAU_WIND_GAIN)) {
      previous.windGain = params.windGain;
    }
    if (writeIfChanged(this.roadFilter.frequency, params.roadHz, previous.roadHz, EPSILON_HZ, when, TAU_ROAD)) {
      previous.roadHz = params.roadHz;
    }
    if (writeIfChanged(this.roadFilter.Q, params.roadQ, previous.roadQ, EPSILON_Q, when, TAU_ROAD)) {
      previous.roadQ = params.roadQ;
    }
    if (writeIfChanged(this.roadGain.gain, params.roadGain, previous.roadGain, EPSILON_GAIN, when, TAU_ROAD)) {
      previous.roadGain = params.roadGain;
    }
  }

  stop(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    for (const node of this.nodes) node.disconnect();
    for (const source of this.sources) source.disconnect();
  }
}
