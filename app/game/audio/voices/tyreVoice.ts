/**
 * Tyre squeal and brake-disc squeal — two sounds that come from quite different
 * physics and are easy to conflate.
 *
 * Squeal is rubber losing and regaining grip: broad, mid-band, and it happens
 * fast and at speed. Disc squeal is a mechanical resonance of pad against rotor:
 * narrow, high, and it only happens as you roll to a stop.
 */
import type { DriveAudioParams } from "../audioMath";
import {
  CONTINUOUS_LOOKAHEAD,
  EPSILON_GAIN,
  EPSILON_HZ,
  writeIfChanged,
} from "../paramUtils";
import { createNoiseSource, type VoiceContext } from "./voiceContext";

/** Squeal has to start quickly or it feels disconnected from the steering. */
const TAU_SQUEAL_RISE = 0.03;
const TAU_SQUEAL_FALL = 0.09;
/** Slow, because sweeping a very high-Q filter quickly makes it ring. */
const TAU_DISC_HZ = 0.14;
const TAU_DISC_GAIN = 0.08;

export class TyreVoice {
  private readonly context: AudioContext;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioBufferSourceNode[] = [];
  private readonly squealBand: BiquadFilterNode;
  private readonly squealUpper: BiquadFilterNode | null;
  private readonly squealGain: GainNode;
  private readonly discBand: BiquadFilterNode;
  private readonly discGain: GainNode;
  private previous = { squealHz: 0, squealGain: -1, discHz: 0, discGain: -1 };

  constructor(voice: VoiceContext) {
    const context = voice.context;
    this.context = context;
    const source = createNoiseSource(voice, 1.3187);

    this.squealBand = context.createBiquadFilter();
    this.squealBand.type = "bandpass";
    this.squealBand.frequency.value = 900;
    this.squealBand.Q.value = 4.5;
    this.squealGain = context.createGain();
    this.squealGain.gain.value = 0;

    if (voice.lowPower) {
      this.squealUpper = null;
      source.connect(this.squealBand).connect(this.squealGain).connect(voice.destination);
    } else {
      // The lower band is the tread-block stick-slip; the octave above is the
      // shriek that rides on top of it.
      this.squealUpper = context.createBiquadFilter();
      this.squealUpper.type = "bandpass";
      this.squealUpper.frequency.value = 1800;
      this.squealUpper.Q.value = 8;
      const upperGain = context.createGain();
      upperGain.gain.value = 0.4;
      source.connect(this.squealBand).connect(this.squealGain);
      source.connect(this.squealUpper).connect(upperGain).connect(this.squealGain);
      this.squealGain.connect(voice.destination);
      this.nodes.push(this.squealUpper, upperGain);
    }

    // Real rubber warbles. A clean frequency ramp on a bandpass sounds like a
    // theremin; this modulation is what makes it read as a tyre.
    const warble = context.createGain();
    warble.gain.value = 120;
    voice.jitter.connect(warble);
    warble.connect(this.squealBand.frequency);
    this.nodes.push(warble);

    // Q30 turns white noise into a near-sinusoid that continuously wanders and
    // breathes in amplitude, which is exactly what disc squeal does. An
    // oscillator here gives a dead, static, electronic tone.
    this.discBand = context.createBiquadFilter();
    this.discBand.type = "bandpass";
    this.discBand.frequency.value = 2200;
    this.discBand.Q.value = 30;
    this.discGain = context.createGain();
    this.discGain.gain.value = 0;
    source.connect(this.discBand).connect(this.discGain).connect(voice.destination);

    this.nodes.push(this.squealBand, this.squealGain, this.discBand, this.discGain);
    this.sources.push(source);
    source.start();
  }

  update(params: DriveAudioParams): void {
    const when = this.context.currentTime + CONTINUOUS_LOOKAHEAD;
    const previous = this.previous;
    if (writeIfChanged(this.squealBand.frequency, params.squealHz, previous.squealHz, EPSILON_HZ, when, TAU_SQUEAL_FALL)) {
      previous.squealHz = params.squealHz;
      if (this.squealUpper) {
        this.squealUpper.frequency.setTargetAtTime(params.squealHz * 2, when, TAU_SQUEAL_FALL);
      }
    }
    const squealTau = params.squealGain > previous.squealGain ? TAU_SQUEAL_RISE : TAU_SQUEAL_FALL;
    if (writeIfChanged(this.squealGain.gain, params.squealGain, previous.squealGain, EPSILON_GAIN, when, squealTau)) {
      previous.squealGain = params.squealGain;
    }
    if (writeIfChanged(this.discBand.frequency, params.discHz, previous.discHz, EPSILON_HZ, when, TAU_DISC_HZ)) {
      previous.discHz = params.discHz;
    }
    if (writeIfChanged(this.discGain.gain, params.discGain, previous.discGain, EPSILON_GAIN, when, TAU_DISC_GAIN)) {
      previous.discGain = params.discGain;
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
