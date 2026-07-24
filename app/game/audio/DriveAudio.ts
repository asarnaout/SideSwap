/**
 * The one audio object the game session talks to.
 *
 * Construction is the only expensive part — building the periodic waves runs a
 * per-octave inverse FFT and generating the noise buffers touches a few hundred
 * thousand samples. Both happen once, during the loading overlay, and never on a
 * live frame. After that `update` is allocation-free and schedules only the
 * handful of parameters that actually moved.
 */
import {
  DEFAULT_ENGINE_PROFILE,
  type ResolvedEngineProfile,
  createAudioParams,
  createAudioState,
  updateAudioModel,
  type DriveAudioParams,
  type DriveAudioState,
  type DriveAudioTelemetry,
} from "./audioMath";
import { primeAudioContext } from "./audioContext";
import { MasterBus, type MasterBusVolumes } from "./masterBus";
import { AmbienceVoice } from "./voices/ambienceVoice";
import { EngineVoice } from "./voices/engineVoice";
import { FoleyVoice, type FoleyCue } from "./voices/foleyVoice";
import { HornVoice } from "./voices/hornVoice";
import { ImpactVoice } from "./voices/impactVoice";
import { TyreVoice } from "./voices/tyreVoice";
import {
  createAmbienceBuffer,
  createJitterSource,
  createNoiseBuffer,
  type VoiceContext,
} from "./voices/voiceContext";

export type { DriveAudioTelemetry } from "./audioMath";
export type { MasterBusVolumes as DriveAudioVolumes } from "./masterBus";

export class DriveAudio {
  private readonly bus: MasterBus;
  private readonly jitterSource: AudioBufferSourceNode;
  private readonly engine: EngineVoice | null;
  private readonly ambience: AmbienceVoice;
  private readonly tyres: TyreVoice;
  private readonly horn: HornVoice;
  private readonly impacts: ImpactVoice;
  private readonly foleyVoice: FoleyVoice;
  private readonly state: DriveAudioState;
  private readonly params: DriveAudioParams;
  private readonly profile: ResolvedEngineProfile;
  private disposed = false;

  private constructor(
    context: AudioContext,
    volumes: MasterBusVolumes,
    lowPower: boolean,
    engineless: boolean,
    profile: ResolvedEngineProfile,
  ) {
    this.profile = profile;
    this.state = createAudioState(undefined, profile);
    this.params = createAudioParams(profile);
    this.bus = new MasterBus(context, volumes);
    this.jitterSource = createJitterSource(context);
    this.jitterSource.start();
    const voice: VoiceContext = {
      context,
      destination: this.bus.input,
      noiseBuffer: createNoiseBuffer(context),
      ambienceBuffer: createAmbienceBuffer(context),
      jitter: this.jitterSource,
      lowPower,
    };
    // A bicycle has no engine: the whole synthesized gearbox stays silent
    // while wind, tyres, horn, impacts and foley behave exactly as ever.
    this.engine = engineless ? null : new EngineVoice(voice, profile);
    this.ambience = new AmbienceVoice(voice);
    this.tyres = new TyreVoice(voice);
    this.horn = new HornVoice(voice);
    this.impacts = new ImpactVoice(voice);
    this.foleyVoice = new FoleyVoice(voice);
  }

  /**
   * Returns null when Web Audio is unavailable or refuses to start, so callers
   * can stay `this.audio?.x()` and the game remains fully playable in silence.
   */
  static create(
    volumes: MasterBusVolumes,
    lowPower = false,
    engineless = false,
    profile: ResolvedEngineProfile = DEFAULT_ENGINE_PROFILE,
  ): DriveAudio | null {
    try {
      const context = primeAudioContext();
      if (!context) return null;
      return new DriveAudio(context, volumes, lowPower, engineless, profile);
    } catch {
      return null;
    }
  }

  update(telemetry: DriveAudioTelemetry): void {
    if (this.disposed) return;
    updateAudioModel(this.state, telemetry, this.params, this.profile);
    this.engine?.update(this.params);
    this.ambience.update(this.params);
    this.tyres.update(this.params);
  }

  setVolumes(volumes: MasterBusVolumes): void {
    if (this.disposed) return;
    this.bus.setVolumes(volumes);
  }

  /**
   * Ducks rather than suspending. Held inputs are cleared by the caller when it
   * pauses, so the model settles to idle behind a closed gain and is already at
   * the right revs when play resumes.
   */
  setPaused(paused: boolean): void {
    if (this.disposed) return;
    if (paused) this.horn.release();
    this.bus.setPaused(paused);
  }

  hornPress(): void {
    if (!this.disposed) this.horn.press();
  }

  hornRelease(): void {
    if (!this.disposed) this.horn.release();
  }

  /** Another car's horn, pitched and filtered so it reads as somebody else. */
  hornBlip(seconds: number, variant: number): void {
    if (!this.disposed) this.horn.blip(seconds, variant);
  }

  get hornHeld(): boolean {
    return !this.disposed && this.horn.isHeld;
  }

  impact(impactSpeedMps: number, nowMs: number): void {
    if (!this.disposed) this.impacts.trigger(impactSpeedMps, nowMs);
  }

  /** Cutscene cues: car doors, the fuel pump's latch and glug loop, a chime. */
  foley(cue: FoleyCue): void {
    if (!this.disposed) this.foleyVoice.trigger(cue);
  }

  /** Read by the headless QA harness; never used by gameplay. */
  debugSnapshot(): Readonly<Record<string, number>> {
    return {
      rpm: this.params.rpm,
      gear: this.params.gear,
      load: this.params.load,
      engineGain: this.params.engineGain,
      engineToneHz: this.params.engineToneHz,
      windGain: this.params.windGain,
      roadGain: this.params.roadGain,
      squealGain: this.params.squealGain,
      discGain: this.params.discGain,
      limiterReductionDb: this.bus.reductionDb,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    // Set synchronously so no further update can schedule into the fade window.
    this.disposed = true;
    const settleSeconds = this.bus.beginDispose();
    window.setTimeout(
      () => {
        this.engine?.stop();
        this.ambience.stop();
        this.tyres.stop();
        this.horn.stop();
        this.foleyVoice.stop();
        try {
          this.jitterSource.stop();
        } catch {
          // Already stopped.
        }
        this.jitterSource.disconnect();
        this.bus.disconnect();
      },
      Math.ceil(settleSeconds * 1000),
    );
  }
}
