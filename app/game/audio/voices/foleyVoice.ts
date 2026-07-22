/**
 * The small diegetic cues the interaction cutscenes make: a car door, the fuel
 * pump, a job-done chime. Like the impact voice, every cue builds its own tiny
 * node graph, ramps from silence and tears itself down after its tail — nothing
 * stays resident except the pump's glug loop while a fill is running.
 */
import { TRIGGER_LOOKAHEAD } from "../paramUtils";
import { createNoiseSource, type VoiceContext } from "./voiceContext";

export type FoleyCue =
  | "door"
  | "door_close"
  | "pump_start"
  | "pump_stop"
  | "chime";

interface PumpLoop {
  readonly source: AudioBufferSourceNode;
  readonly lfo: OscillatorNode;
  readonly nodes: readonly AudioNode[];
}

export class FoleyVoice {
  private readonly voice: VoiceContext;
  private pumpLoop: PumpLoop | null = null;

  constructor(voice: VoiceContext) {
    this.voice = voice;
  }

  trigger(cue: FoleyCue): void {
    switch (cue) {
      case "door":
        this.thunk(90, 42, 520, 0.16);
        return;
      case "door_close":
        this.thunk(115, 48, 760, 0.2);
        return;
      case "pump_start":
        this.latch();
        this.startPumpLoop();
        return;
      case "pump_stop":
        this.stopPumpLoop();
        this.latch();
        return;
      case "chime":
        this.chime();
        return;
    }
  }

  /** A door (or nozzle holster): a falling sine body under a low noise burst. */
  private thunk(
    fromHz: number,
    toHz: number,
    noiseHz: number,
    peak: number,
  ): void {
    const context = this.voice.context;
    const when = context.currentTime + TRIGGER_LOOKAHEAD;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.004);
    gain.gain.setTargetAtTime(0, when + 0.004, 0.05);
    gain.connect(this.voice.destination);

    const body = context.createOscillator();
    body.type = "sine";
    body.frequency.setValueAtTime(fromHz, when);
    body.frequency.exponentialRampToValueAtTime(toHz, when + 0.09);
    body.connect(gain);

    const rattle = createNoiseSource(this.voice, 1);
    const rattleFilter = context.createBiquadFilter();
    rattleFilter.type = "lowpass";
    rattleFilter.frequency.setValueAtTime(noiseHz, when);
    const rattleGain = context.createGain();
    rattleGain.gain.setValueAtTime(0.5 * peak, when);
    rattleGain.gain.setTargetAtTime(0, when, 0.028);
    rattle.connect(rattleFilter).connect(rattleGain).connect(gain);

    const end = when + 0.4;
    body.start(when);
    body.stop(end);
    rattle.start(when);
    rattle.stop(end);
    body.onended = () => {
      body.disconnect();
      rattle.disconnect();
      rattleFilter.disconnect();
      rattleGain.disconnect();
      gain.disconnect();
    };
  }

  /** The nozzle latch: a short bright click. */
  private latch(): void {
    const context = this.voice.context;
    const when = context.currentTime + TRIGGER_LOOKAHEAD;
    const click = createNoiseSource(this.voice, 1);
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1900, when);
    filter.Q.setValueAtTime(3, when);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.11, when + 0.002);
    gain.gain.setTargetAtTime(0, when + 0.002, 0.014);
    click.connect(filter).connect(gain).connect(this.voice.destination);
    click.start(when);
    click.stop(when + 0.12);
    click.onended = () => {
      click.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  /** Fuel gurgling into the filler neck: band-limited noise pulsed by an LFO. */
  private startPumpLoop(): void {
    if (this.pumpLoop) return;
    const context = this.voice.context;
    const when = context.currentTime + TRIGGER_LOOKAHEAD;

    const source = createNoiseSource(this.voice, 1);
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(230, when);
    filter.Q.setValueAtTime(1.6, when);

    const gain = context.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.055, when + 0.2);

    // The glug: a sub-audio oscillator wobbling the loop's level.
    const lfo = context.createOscillator();
    lfo.type = "sine";
    lfo.frequency.setValueAtTime(7.2, when);
    const lfoDepth = context.createGain();
    lfoDepth.gain.setValueAtTime(0.035, when);
    lfo.connect(lfoDepth).connect(gain.gain);

    source.connect(filter).connect(gain).connect(this.voice.destination);
    source.start(when);
    lfo.start(when);
    this.pumpLoop = { source, lfo, nodes: [filter, gain, lfoDepth] };
  }

  private stopPumpLoop(): void {
    const loop = this.pumpLoop;
    if (!loop) return;
    this.pumpLoop = null;
    const context = this.voice.context;
    const when = context.currentTime + TRIGGER_LOOKAHEAD;
    // Fade via the source's stop tail rather than re-scheduling the shared
    // gain, which may have LFO modulation summed into it.
    loop.source.stop(when + 0.12);
    loop.lfo.stop(when + 0.12);
    loop.source.onended = () => {
      loop.source.disconnect();
      loop.lfo.disconnect();
      for (const node of loop.nodes) node.disconnect();
    };
  }

  /** Two rising blips: the job is done. */
  private chime(): void {
    const context = this.voice.context;
    const start = context.currentTime + TRIGGER_LOOKAHEAD;
    const notes: readonly (readonly [number, number])[] = [
      [659.26, 0],
      [880, 0.13],
    ];
    for (const [frequency, offset] of notes) {
      const when = start + offset;
      const tone = context.createOscillator();
      tone.type = "sine";
      tone.frequency.setValueAtTime(frequency, when);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(0.085, when + 0.008);
      gain.gain.setTargetAtTime(0, when + 0.02, 0.09);
      tone.connect(gain).connect(this.voice.destination);
      tone.start(when);
      tone.stop(when + 0.5);
      tone.onended = () => {
        tone.disconnect();
        gain.disconnect();
      };
    }
  }

  stop(): void {
    this.stopPumpLoop();
  }
}
