/**
 * The thud when you hit something.
 *
 * Built per collision rather than kept resident: impacts are rare, and a
 * one-shot that ramps from silence and stops only after its tail has decayed
 * cannot click. The downward pitch sweep is the whole trick — a static low tone
 * reads as a beep, a falling one reads as mass hitting mass.
 */
import { TRIGGER_LOOKAHEAD } from "../paramUtils";
import { createNoiseSource, type VoiceContext } from "./voiceContext";

/** The sim can emit several collision events in a burst; take the worst. */
const RATE_LIMIT_MS = 120;
/** Impacts above this are simply "as bad as it gets". */
const SEVERE_MPS = 18;

export class ImpactVoice {
  private readonly voice: VoiceContext;
  private lastAt = -Infinity;

  constructor(voice: VoiceContext) {
    this.voice = voice;
  }

  trigger(impactSpeedMps: number, nowMs: number): void {
    if (nowMs - this.lastAt < RATE_LIMIT_MS) return;
    this.lastAt = nowMs;
    const context = this.voice.context;
    const severity = Math.min(1, Math.max(0, impactSpeedMps / SEVERE_MPS));
    const when = context.currentTime + TRIGGER_LOOKAHEAD;
    const duration = 0.1 + 0.12 * severity;

    const gain = context.createGain();
    const peak = 0.1 + 0.42 * severity;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.003);
    gain.gain.setTargetAtTime(0, when + 0.003, 0.045 + 0.09 * severity);
    gain.connect(this.voice.destination);

    const body = context.createOscillator();
    body.type = "sine";
    body.frequency.setValueAtTime(70 + 50 * severity, when);
    body.frequency.exponentialRampToValueAtTime(28, when + duration);
    body.connect(gain);

    const crunch = createNoiseSource(this.voice, 1);
    const crunchFilter = context.createBiquadFilter();
    crunchFilter.type = "lowpass";
    crunchFilter.frequency.setValueAtTime(900 + 2600 * severity, when);
    const crunchGain = context.createGain();
    crunchGain.gain.setValueAtTime(0.6 * peak, when);
    crunchGain.gain.setTargetAtTime(0, when, 0.03 + 0.05 * severity);
    crunch.connect(crunchFilter).connect(crunchGain).connect(gain);

    let ring: BiquadFilterNode | null = null;
    let ringGain: GainNode | null = null;
    if (severity > 0.35) {
      // Panel and glass on a hard hit only.
      ring = context.createBiquadFilter();
      ring.type = "bandpass";
      ring.frequency.value = 1400;
      ring.Q.value = 12;
      ringGain = context.createGain();
      ringGain.gain.setValueAtTime(0.25 * peak, when + 0.01);
      ringGain.gain.setTargetAtTime(0, when + 0.01, 0.08);
      crunch.connect(ring).connect(ringGain).connect(gain);
    }

    const end = when + duration + 0.35;
    body.start(when);
    body.stop(end);
    crunch.start(when);
    crunch.stop(end);
    body.onended = () => {
      body.disconnect();
      crunch.disconnect();
      crunchFilter.disconnect();
      crunchGain.disconnect();
      ring?.disconnect();
      ringGain?.disconnect();
      gain.disconnect();
    };
  }
}
