/**
 * Wind and road roar.
 *
 * This is what actually conveys speed. The engine tells you how hard you are
 * working; the rush past the windows tells you how fast you are going, and it
 * scales superlinearly for the same reason it does in a real car — drag goes as
 * the square of velocity. Scaling it linearly is what makes 20mph and 60mph
 * sound like the same journey.
 *
 * Three details separate "moving air" from "untuned television", and the first
 * version of this voice got all three wrong:
 *
 *   - The source is **pink**, not white. White noise has equal energy per hertz,
 *     so half its power sits in the top octave and it reads as electronic hiss.
 *   - Wind is a **band**. Highpassing and leaving the top open passes everything
 *     up to Nyquist, which is the definition of white noise; real wind rolls off
 *     hard above a couple of kilohertz.
 *   - It **gusts**. Perfectly steady broadband noise is what the ear labels
 *     static, and no amount of filtering fixes that — only fluctuation does.
 */
import { WIND_GUST_DEPTH, type DriveAudioParams } from "../audioMath";
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
  private readonly windHighpass: BiquadFilterNode;
  private readonly windLowpass: BiquadFilterNode;
  private readonly windGain: GainNode;
  private readonly gustDepth: GainNode;
  private readonly roadFilter: BiquadFilterNode;
  private readonly roadGain: GainNode;
  private previous = {
    windHz: 0,
    windTopHz: 0,
    windGain: -1,
    gust: -1,
    roadHz: 0,
    roadQ: 0,
    roadGain: -1,
  };

  constructor(voice: VoiceContext) {
    const context = voice.context;
    this.context = context;

    // Two taps on the pink buffer at incommensurate rates. Running both filters
    // off identical noise would sound phasey and hollow.
    const windSource = createNoiseSource(voice, 1, "pink");
    const roadSource = createNoiseSource(voice, 0.7413, "pink");

    this.windHighpass = context.createBiquadFilter();
    this.windHighpass.type = "highpass";
    this.windHighpass.frequency.value = 180;
    this.windHighpass.Q.value = 0.5;
    this.windLowpass = context.createBiquadFilter();
    this.windLowpass.type = "lowpass";
    this.windLowpass.frequency.value = 900;
    this.windLowpass.Q.value = 0.7;
    this.windGain = context.createGain();
    this.windGain.gain.value = 0;

    // Summed into the gain parameter, so the level wanders around whatever the
    // model asks for instead of sitting flat. Runs on the audio thread.
    this.gustDepth = context.createGain();
    this.gustDepth.gain.value = 0;
    voice.jitter.connect(this.gustDepth);
    this.gustDepth.connect(this.windGain.gain);

    this.roadFilter = context.createBiquadFilter();
    this.roadFilter.type = "bandpass";
    this.roadFilter.frequency.value = 120;
    this.roadFilter.Q.value = 0.9;
    this.roadGain = context.createGain();
    this.roadGain.gain.value = 0;

    windSource
      .connect(this.windHighpass)
      .connect(this.windLowpass)
      .connect(this.windGain)
      .connect(voice.destination);
    roadSource.connect(this.roadFilter).connect(this.roadGain).connect(voice.destination);

    this.nodes.push(
      this.windHighpass,
      this.windLowpass,
      this.windGain,
      this.gustDepth,
      this.roadFilter,
      this.roadGain,
    );
    this.sources.push(windSource, roadSource);
    for (const source of this.sources) source.start();
  }

  update(params: DriveAudioParams): void {
    const when = this.context.currentTime + CONTINUOUS_LOOKAHEAD;
    const previous = this.previous;
    if (writeIfChanged(this.windHighpass.frequency, params.windHz, previous.windHz, EPSILON_HZ, when, TAU_WIND_HZ)) {
      previous.windHz = params.windHz;
    }
    if (writeIfChanged(this.windLowpass.frequency, params.windTopHz, previous.windTopHz, EPSILON_HZ, when, TAU_WIND_HZ)) {
      previous.windTopHz = params.windTopHz;
    }
    if (writeIfChanged(this.windGain.gain, params.windGain, previous.windGain, EPSILON_GAIN, when, TAU_WIND_GAIN)) {
      previous.windGain = params.windGain;
    }
    // Gust swing scales with the level, so it stays proportional rather than
    // swamping a quiet layer at low speed.
    const gust = params.windGain * WIND_GUST_DEPTH;
    if (writeIfChanged(this.gustDepth.gain, gust, previous.gust, EPSILON_GAIN, when, TAU_WIND_GAIN)) {
      previous.gust = gust;
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
