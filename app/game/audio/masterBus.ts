/**
 * The single output path for every sound the game makes.
 *
 * Before this existed, each effect connected its own gain straight to
 * `destination`, so two sounds that happened to start on the same frame summed
 * past full scale and hard-clipped. That is precisely what the old coach tone
 * did — several identical sines starting at the same timestamp with the same
 * phase — and the crack it produced is the "popping" this rework removes.
 * Routing everything through one limiter makes that failure mode impossible
 * rather than merely unlikely.
 */
import { CONTINUOUS_LOOKAHEAD, targetTo } from "./paramUtils";

export interface MasterBusVolumes {
  readonly master: number;
  readonly effects: number;
}

const VOLUME_TAU = 0.03;
/** ~250ms to silence: slow enough to be inaudible, fast enough to feel instant. */
const PAUSE_TAU = 0.05;
const DISPOSE_TAU = 0.02;

const clamp01 = (value: number) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

export class MasterBus {
  readonly context: AudioContext;
  /** Every voice connects here. Carries the effects-volume setting. */
  readonly input: GainNode;
  private readonly masterGain: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private volumes: MasterBusVolumes;
  private duck = 1;

  constructor(context: AudioContext, volumes: MasterBusVolumes) {
    this.context = context;
    this.volumes = volumes;
    this.input = context.createGain();
    this.masterGain = context.createGain();
    this.limiter = context.createDynamicsCompressor();

    // Static configuration, set once before anything is audible. These are the
    // only sanctioned `.value` writes in the audio layer.
    this.input.gain.value = clamp01(volumes.effects);
    this.masterGain.gain.value = clamp01(volumes.master);

    // A hard knee at a high ratio is limiting, not compression: normal play sits
    // below the threshold and never touches it, but a pile-up is caught instead
    // of clipping — 12dB of overshoot becomes 0.6dB. Voice levels are set so
    // ordinary driving peaks near -8dBFS, leaving this as a safety net rather
    // than a mix element.
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;

    this.input.connect(this.masterGain);
    this.masterGain.connect(this.limiter);
    this.limiter.connect(context.destination);
  }

  setVolumes(volumes: MasterBusVolumes): void {
    this.volumes = volumes;
    const when = this.context.currentTime + CONTINUOUS_LOOKAHEAD;
    targetTo(this.input.gain, clamp01(volumes.effects), when, VOLUME_TAU);
    targetTo(this.masterGain.gain, clamp01(volumes.master) * this.duck, when, VOLUME_TAU);
  }

  /**
   * Ducks to silence without stopping anything. Suspending the context here
   * instead would freeze the ramp mid-flight and leave a DC offset that pops on
   * resume, so the nodes keep running behind a closed gain.
   */
  setPaused(paused: boolean): void {
    this.duck = paused ? 0 : 1;
    const when = this.context.currentTime + CONTINUOUS_LOOKAHEAD;
    targetTo(
      this.masterGain.gain,
      clamp01(this.volumes.master) * this.duck,
      when,
      PAUSE_TAU,
    );
  }

  /**
   * dB of gain reduction the limiter is applying — negative while it is working.
   * Surfaced for tuning: if this sits below -3dB during ordinary driving, the
   * individual voice levels are too hot.
   */
  get reductionDb(): number {
    return this.limiter.reduction;
  }

  /**
   * Begins the fade to silence and reports how long callers must wait before it
   * is safe to stop nodes. Tearing down mid-note is itself a click.
   */
  beginDispose(): number {
    const when = this.context.currentTime;
    this.masterGain.gain.cancelScheduledValues(when);
    targetTo(this.masterGain.gain, 0, when, DISPOSE_TAU);
    return DISPOSE_TAU * 8;
  }

  disconnect(): void {
    this.input.disconnect();
    this.masterGain.disconnect();
    this.limiter.disconnect();
  }
}
