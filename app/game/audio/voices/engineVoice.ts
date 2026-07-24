/**
 * The engine: three oscillators, a load-tracking lowpass, some air, and a
 * gearbox whine for reverse.
 *
 * Nothing here starts or stops during play. Every oscillator runs from the
 * moment the voice is built until it is disposed, and "quiet" means a gain
 * ramped to zero — which is what makes the whole class of start/stop clicks
 * impossible rather than merely rare.
 */
import {
  DEFAULT_ENGINE_PROFILE,
  type ResolvedEngineProfile, type DriveAudioParams } from "../audioMath";
import {
  CONTINUOUS_LOOKAHEAD,
  EPSILON_GAIN,
  EPSILON_HZ,
  EPSILON_Q,
  writeIfChanged,
} from "../paramUtils";
import { buildEngineHarmonics, buildEngineTopHarmonics } from "../waveTables";
import { createNoiseSource, periodicWave, type VoiceContext } from "./voiceContext";

/** Static detune between the two body oscillators. Their slow beating is depth. */
const BODY_DETUNE_CENTS = 7;

const TAU_PITCH = 0.03;
const TAU_GAIN = 0.05;
const TAU_TONE_OPEN = 0.04;
/** Slower closing, so brightness blooms after a throttle stab like induction lag. */
const TAU_TONE_CLOSE = 0.11;
const TAU_INDUCTION = 0.06;
const TAU_JITTER = 0.12;
const TAU_WHINE = 0.07;

export class EngineVoice {
  private readonly context: AudioContext;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: (OscillatorNode | AudioBufferSourceNode)[] = [];

  private readonly bodyA: OscillatorNode;
  private readonly bodyB: OscillatorNode | null;
  private readonly top: OscillatorNode;
  private readonly topGain: GainNode;
  private readonly shiftDuck: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly level: GainNode;
  private readonly inductionBand: BiquadFilterNode;
  private readonly inductionGain: GainNode;
  private readonly jitterCents: GainNode;
  private readonly jitterInduction: GainNode;
  private readonly whine: OscillatorNode | null;
  private readonly whineGain: GainNode | null;

  private shiftDucking = false;
  private previous = {
    fundamental: 0,
    firing: 0,
    gain: -1,
    toneHz: 0,
    toneQ: 0,
    topGain: -1,
    inductionHz: 0,
    inductionGain: -1,
    jitter: -1,
    whineHz: 0,
    whineGain: -1,
  };

  constructor(voice: VoiceContext, profile: ResolvedEngineProfile = DEFAULT_ENGINE_PROFILE) {
    const context = voice.context;
    this.context = context;
    // Cylinder count and the harmonic-shape scalars are baked into the
    // wavetable here — the construction-time half of an engine profile.
    const engineWave = periodicWave(
      context,
      buildEngineHarmonics(
        undefined,
        profile.cylinders,
        profile.harmonicRolloff,
        profile.harmonicTilt,
      ),
    );
    const topWave = periodicWave(context, buildEngineTopHarmonics());

    const mix = context.createGain();
    this.shiftDuck = context.createGain();
    this.tone = context.createBiquadFilter();
    const boom = context.createBiquadFilter();
    const growl = context.createBiquadFilter();
    this.level = context.createGain();

    this.tone.type = "lowpass";
    this.tone.frequency.value = 220;
    this.tone.Q.value = 0.9;

    // The resonant body of the car. `growl` sits at 320Hz deliberately: every
    // laptop speaker reproduces that band, so the engine stays legible on
    // hardware that cannot produce the 27-220Hz firing fundamental at all.
    boom.type = "peaking";
    boom.frequency.value = 92;
    boom.Q.value = 1.4;
    boom.gain.value = 5;
    growl.type = "peaking";
    growl.frequency.value = 320;
    growl.Q.value = 1.1;
    growl.gain.value = 4;

    this.level.gain.value = 0;
    this.shiftDuck.gain.value = 1;

    this.bodyA = context.createOscillator();
    this.bodyA.setPeriodicWave(engineWave);
    this.bodyA.frequency.value = 7;

    this.top = context.createOscillator();
    this.top.setPeriodicWave(topWave);
    this.top.frequency.value = 28;
    this.topGain = context.createGain();
    this.topGain.gain.value = 0;

    if (voice.lowPower) {
      this.bodyB = null;
      this.bodyA.connect(mix);
    } else {
      this.bodyB = context.createOscillator();
      this.bodyB.setPeriodicWave(engineWave);
      this.bodyB.frequency.value = 7;
      this.bodyB.detune.value = BODY_DETUNE_CENTS;
      const panA = context.createStereoPanner();
      const panB = context.createStereoPanner();
      panA.pan.value = -0.22;
      panB.pan.value = 0.22;
      this.bodyA.connect(panA).connect(mix);
      this.bodyB.connect(panB).connect(mix);
      this.nodes.push(panA, panB);
    }

    this.top.connect(this.topGain).connect(mix);
    mix.connect(this.shiftDuck);
    this.shiftDuck.connect(this.tone);
    this.tone.connect(boom).connect(growl).connect(this.level);
    this.level.connect(voice.destination);

    // Intake and exhaust turbulence. Without this broadband layer the engine
    // stays recognisably synthetic however good the harmonic table is.
    const noise = createNoiseSource(voice, 1);
    this.inductionBand = context.createBiquadFilter();
    this.inductionBand.type = "bandpass";
    this.inductionBand.frequency.value = 180;
    this.inductionBand.Q.value = 1.8;
    this.inductionGain = context.createGain();
    this.inductionGain.gain.value = 0;
    noise.connect(this.inductionBand).connect(this.inductionGain).connect(this.level);

    // One modulation source drives both the pitch wobble and the induction
    // shimmer, which is physically right — they share a cause.
    this.jitterCents = context.createGain();
    this.jitterCents.gain.value = 35;
    voice.jitter.connect(this.jitterCents);
    this.jitterCents.connect(this.bodyA.detune);
    if (this.bodyB) this.jitterCents.connect(this.bodyB.detune);
    this.jitterCents.connect(this.top.detune);

    this.jitterInduction = context.createGain();
    this.jitterInduction.gain.value = 60;
    voice.jitter.connect(this.jitterInduction);
    this.jitterInduction.connect(this.inductionBand.frequency);

    if (voice.lowPower) {
      this.whine = null;
      this.whineGain = null;
    } else {
      // Straight-cut reverse gears whine at the mesh frequency. A small detail,
      // but it makes reverse identifiable without looking at the HUD.
      this.whine = context.createOscillator();
      this.whine.type = "triangle";
      this.whine.frequency.value = 355;
      const whineBand = context.createBiquadFilter();
      whineBand.type = "bandpass";
      whineBand.frequency.value = 355;
      whineBand.Q.value = 7;
      this.whineGain = context.createGain();
      this.whineGain.gain.value = 0;
      this.whine.connect(whineBand).connect(this.whineGain).connect(voice.destination);
      this.nodes.push(whineBand);
      this.sources.push(this.whine);
    }

    this.nodes.push(mix, this.shiftDuck, this.tone, boom, growl, this.level);
    this.nodes.push(this.inductionBand, this.inductionGain, this.jitterCents, this.jitterInduction);
    if (this.topGain) this.nodes.push(this.topGain);
    if (this.whineGain) this.nodes.push(this.whineGain);
    this.sources.push(this.bodyA, this.top, noise);
    if (this.bodyB) this.sources.push(this.bodyB);

    for (const source of this.sources) source.start();
  }

  update(params: DriveAudioParams): void {
    const when = this.context.currentTime + CONTINUOUS_LOOKAHEAD;
    const previous = this.previous;

    if (writeIfChanged(this.bodyA.frequency, params.engineFundamentalHz, previous.fundamental, EPSILON_HZ, when, TAU_PITCH)) {
      if (this.bodyB) this.bodyB.frequency.setTargetAtTime(params.engineFundamentalHz, when, TAU_PITCH);
      previous.fundamental = params.engineFundamentalHz;
    }
    if (writeIfChanged(this.top.frequency, params.engineFiringHz, previous.firing, EPSILON_HZ, when, TAU_PITCH)) {
      previous.firing = params.engineFiringHz;
    }
    if (writeIfChanged(this.level.gain, params.engineGain, previous.gain, EPSILON_GAIN, when, TAU_GAIN)) {
      previous.gain = params.engineGain;
    }
    if (writeIfChanged(this.topGain.gain, params.engineTopGain, previous.topGain, EPSILON_GAIN, when, TAU_GAIN)) {
      previous.topGain = params.engineTopGain;
    }

    // Asymmetric: opening fast reads as throttle response, closing slow as lag.
    const toneTau = params.engineToneHz > previous.toneHz ? TAU_TONE_OPEN : TAU_TONE_CLOSE;
    if (writeIfChanged(this.tone.frequency, params.engineToneHz, previous.toneHz, EPSILON_HZ, when, toneTau)) {
      previous.toneHz = params.engineToneHz;
    }
    if (writeIfChanged(this.tone.Q, params.engineToneQ, previous.toneQ, EPSILON_Q, when, TAU_GAIN)) {
      previous.toneQ = params.engineToneQ;
    }

    if (writeIfChanged(this.inductionBand.frequency, params.inductionHz, previous.inductionHz, EPSILON_HZ, when, TAU_INDUCTION)) {
      previous.inductionHz = params.inductionHz;
    }
    if (writeIfChanged(this.inductionGain.gain, params.inductionGain, previous.inductionGain, EPSILON_GAIN, when, TAU_INDUCTION)) {
      previous.inductionGain = params.inductionGain;
    }
    if (writeIfChanged(this.jitterCents.gain, params.jitterCents, previous.jitter, EPSILON_GAIN, when, TAU_JITTER)) {
      previous.jitter = params.jitterCents;
    }

    if (this.whine && this.whineGain) {
      if (writeIfChanged(this.whine.frequency, params.reverseWhineHz, previous.whineHz, EPSILON_HZ, when, TAU_WHINE)) {
        previous.whineHz = params.reverseWhineHz;
      }
      if (writeIfChanged(this.whineGain.gain, params.reverseWhineGain, previous.whineGain, EPSILON_GAIN, when, TAU_WHINE)) {
        previous.whineGain = params.reverseWhineGain;
      }
    }

    // A brief torque interrupt on the shift. This has its own gain node so the
    // per-frame level writes above cannot fight the two scheduled ramps.
    if (params.shifted && !this.shiftDucking) {
      this.shiftDucking = true;
      this.shiftDuck.gain.setTargetAtTime(0.45, when, 0.012);
      this.shiftDuck.gain.setTargetAtTime(1, when + 0.085, 0.045);
      window.setTimeout(() => {
        this.shiftDucking = false;
      }, 200);
    }
  }

  stop(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped; double-dispose throws on some implementations.
      }
    }
    for (const node of this.nodes) node.disconnect();
    for (const source of this.sources) source.disconnect();
  }
}
