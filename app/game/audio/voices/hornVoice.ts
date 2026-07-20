/**
 * The horn.
 *
 * The version this replaces was two square waves at 205 and 258Hz in a fixed
 * 200ms blip, and every one of those choices worked against it. 205Hz is about
 * an octave below where real automotive horns sit, so it read as a foghorn. A
 * square wave has odd harmonics only — the hollow, clarinet-like spectrum that
 * is the single biggest reason a synthesised horn sounds like a game beep, since
 * a real horn is a steel diaphragm driving a flared throat and produces even and
 * odd harmonics alike. A 12ms attack is unphysically fast for a diaphragm, which
 * takes 25-45ms to settle and audibly *rises in pitch* while it does. And real
 * horns are held, not blipped.
 */
import { TRIGGER_LOOKAHEAD } from "../paramUtils";
import { buildHornHarmonics } from "../waveTables";
import { createNoiseSource, periodicWave, type VoiceContext } from "./voiceContext";

/**
 * A minor third apart, with the upper deliberately mistuned — matched horn pairs
 * do not exist on real cars. Near-coincident upper harmonics (3×415 = 1245
 * against 2.5×496 = 1240) beat at about 5Hz, and that beat is the "wah".
 */
const HORN_LOW_HZ = 415;
const HORN_HIGH_HZ = 496;
const HORN_PEAK = 0.34;
/** A tap still has to sound like a horn rather than a click. */
const MIN_BLAST_S = 0.09;
/** Backstop in case a keyup never arrives — a stuck horn is unbearable. */
const MAX_HOLD_MS = 3500;

const driveCurve = (amount: number, points = 1024) => {
  const curve = new Float32Array(points);
  const scale = Math.tanh(amount);
  for (let i = 0; i < points; i += 1) {
    const x = (i / (points - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / scale;
  }
  return curve;
};

export class HornVoice {
  private readonly voice: VoiceContext;
  private readonly context: AudioContext;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: (OscillatorNode | AudioBufferSourceNode)[] = [];
  private readonly oscillators: { node: OscillatorNode; hz: number }[] = [];
  private readonly wave: PeriodicWave;
  private readonly gain: GainNode;
  private readonly rattleGain: GainNode;
  private held = false;
  private downAt = 0;
  private holdTimer: number | null = null;

  constructor(voice: VoiceContext) {
    this.voice = voice;
    const context = voice.context;
    this.context = context;
    this.wave = periodicWave(context, buildHornHarmonics());

    const mix = context.createGain();
    const shaper = context.createWaveShaper();
    shaper.curve = driveCurve(1.6);
    shaper.oversample = "2x";
    // Real horns have essentially no energy below the fundamental, and removing
    // that mud is much of what makes one sound expensive rather than cheap.
    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 260;
    highpass.Q.value = 0.7;
    const formant = context.createBiquadFilter();
    formant.type = "peaking";
    formant.frequency.value = 2600;
    formant.Q.value = 1.4;
    formant.gain.value = 8;
    this.gain = context.createGain();
    this.gain.gain.value = 0;

    for (const [index, hz] of [HORN_LOW_HZ, HORN_HIGH_HZ].entries()) {
      const node = context.createOscillator();
      node.setPeriodicWave(this.wave);
      node.frequency.value = hz;
      const level = context.createGain();
      // Never perfectly matched.
      level.gain.value = index === 0 ? 1 : 0.82;
      node.connect(level).connect(mix);
      this.oscillators.push({ node, hz });
      this.sources.push(node);
      this.nodes.push(level);
    }

    // A breath of air through the flare, on the attack only.
    const rattleSource = createNoiseSource(voice, 1);
    const rattleBand = context.createBiquadFilter();
    rattleBand.type = "bandpass";
    rattleBand.frequency.value = 3000;
    rattleBand.Q.value = 2;
    this.rattleGain = context.createGain();
    this.rattleGain.gain.value = 0;
    rattleSource.connect(rattleBand).connect(this.rattleGain).connect(mix);

    mix.connect(shaper).connect(highpass).connect(formant).connect(this.gain);
    this.gain.connect(voice.destination);

    this.nodes.push(mix, shaper, highpass, formant, this.gain, rattleBand, this.rattleGain);
    this.sources.push(rattleSource);
    for (const source of this.sources) source.start();
  }

  press(): void {
    if (this.held) return;
    this.held = true;
    const when = this.context.currentTime + TRIGGER_LOOKAHEAD;
    this.downAt = when;
    for (const { node, hz } of this.oscillators) {
      node.frequency.cancelScheduledValues(when);
      // The diaphragm spin-up: pitch blooms into the note as it settles.
      node.frequency.setValueAtTime(hz * 0.945, when);
      node.frequency.exponentialRampToValueAtTime(hz, when + 0.055);
    }
    this.gain.gain.cancelScheduledValues(when);
    this.gain.gain.setValueAtTime(0, when);
    // Linear, not exponential: an exponential rise from near-zero over 35ms
    // sounds squishy rather than like something mechanical engaging.
    this.gain.gain.linearRampToValueAtTime(HORN_PEAK, when + 0.035);
    this.rattleGain.gain.cancelScheduledValues(when);
    this.rattleGain.gain.setValueAtTime(0.05, when);
    this.rattleGain.gain.setTargetAtTime(0, when + 0.012, 0.01);

    if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
    this.holdTimer = window.setTimeout(() => this.release(), MAX_HOLD_MS);
  }

  release(): void {
    if (!this.held) return;
    this.held = false;
    if (this.holdTimer !== null) {
      window.clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    const when = Math.max(this.context.currentTime + TRIGGER_LOOKAHEAD, this.downAt + MIN_BLAST_S);
    this.gain.gain.cancelScheduledValues(when);
    this.gain.gain.setTargetAtTime(0, when, 0.022);
    for (const { node, hz } of this.oscillators) {
      node.frequency.cancelScheduledValues(when);
      node.frequency.setTargetAtTime(hz * 0.985, when, 0.03);
    }
  }

  get isHeld(): boolean {
    return this.held;
  }

  /**
   * Somebody else's horn. Built as a throwaway graph rather than sharing the
   * player's oscillators: it has to be pitched differently and filtered darker,
   * or it reads as a phantom press of your own horn instead of another car.
   */
  blip(seconds: number, variant: number): void {
    const context = this.context;
    const when = context.currentTime + TRIGGER_LOOKAHEAD;
    const detune = [0.93, 1, 1.08][Math.abs(Math.trunc(variant)) % 3];
    const gain = context.createGain();
    const muffle = context.createBiquadFilter();
    muffle.type = "lowpass";
    muffle.frequency.value = 2000;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(HORN_PEAK * 0.55, when + 0.03);
    gain.gain.setTargetAtTime(0, when + seconds, 0.03);

    const oscillators = [HORN_LOW_HZ, HORN_HIGH_HZ].map((hz, index) => {
      const node = context.createOscillator();
      node.setPeriodicWave(this.wave);
      node.frequency.setValueAtTime(hz * detune * 0.945, when);
      node.frequency.exponentialRampToValueAtTime(hz * detune, when + 0.05);
      const level = context.createGain();
      level.gain.value = index === 0 ? 1 : 0.82;
      node.connect(level).connect(muffle);
      node.start(when);
      node.stop(when + seconds + 0.4);
      return { node, level };
    });
    muffle.connect(gain).connect(this.voice.destination);
    oscillators[0].node.onended = () => {
      for (const { node, level } of oscillators) {
        node.disconnect();
        level.disconnect();
      }
      muffle.disconnect();
      gain.disconnect();
    };
  }

  stop(): void {
    if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
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
