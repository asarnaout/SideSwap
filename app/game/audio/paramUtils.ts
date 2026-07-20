/**
 * Web Audio parameter-scheduling primitives.
 *
 * Both classes of click this game used to make came from mistakes these helpers
 * exist to prevent. Writing `param.value` on a live graph is one: the setter is
 * defined as an immediate `setValueAtTime`, so a per-frame write is a staircase
 * — zipper noise at best, an audible step at worst. Scheduling against a
 * `currentTime` that was read several milliseconds earlier is the other: on a
 * frame that overruns, the ramp is already in the past and the browser applies
 * it instantly as a 0-to-full discontinuity.
 *
 * So: never assign `.value` after construction, and always schedule at least
 * one lookahead ahead of now.
 */

/**
 * Lookahead for continuous per-frame updates. Longer than both a 128-sample
 * render quantum (2.7ms at 48kHz) and a 60fps frame (16.7ms), so even a frame
 * that overruns its budget cannot schedule into the past.
 */
export const CONTINUOUS_LOOKAHEAD = 0.02;

/**
 * Lookahead for triggered one-shots. These are scheduled at trigger time rather
 * than from a frame timestamp that may already be stale, so they need far less
 * headroom — and 20ms of latency on a horn is perceptible.
 */
export const TRIGGER_LOOKAHEAD = 0.005;

/**
 * Only schedule when the value has actually moved. A 60fps update touching ~20
 * parameters would otherwise queue 1200 automation events a second, nearly all
 * of them inaudible no-ops; these thresholds cut it to single digits per frame.
 */
export const EPSILON_HZ = 0.5;
export const EPSILON_GAIN = 0.002;
export const EPSILON_Q = 0.02;

/** Moves `param` toward `value` along a one-pole curve. The workhorse. */
export function targetTo(param: AudioParam, value: number, when: number, tau: number): void {
  param.setTargetAtTime(value, when, tau);
}

/**
 * Ramps linearly, first freezing any in-flight automation where it actually is.
 * Without the cancel-and-hold, a linear ramp starts from the value at the
 * *previous* scheduled event's time rather than from the parameter's current
 * value — so following a `setTargetAtTime` with a bare `linearRamp` jumps.
 */
export function rampTo(param: AudioParam, value: number, when: number, seconds: number): void {
  const holdable = param as AudioParam & { cancelAndHoldAtTime?: (time: number) => void };
  if (typeof holdable.cancelAndHoldAtTime === "function") {
    holdable.cancelAndHoldAtTime(when);
  } else {
    // Firefox before 126 has no cancelAndHoldAtTime; pin the current value by hand.
    param.cancelScheduledValues(when);
    param.setValueAtTime(param.value, when);
  }
  param.linearRampToValueAtTime(value, when + seconds);
}

/**
 * Schedules `next` only if it differs from `previous` by more than `epsilon`.
 * Returns whether it wrote, so callers can keep their shadow copy in step.
 */
export function writeIfChanged(
  param: AudioParam,
  next: number,
  previous: number,
  epsilon: number,
  when: number,
  tau: number,
): boolean {
  if (Math.abs(next - previous) < epsilon) return false;
  param.setTargetAtTime(next, when, tau);
  return true;
}

/**
 * Number of time constants to wait after a `setTargetAtTime(0, …)` before the
 * tail is inaudible. A one-pole approach never actually reaches its target, so
 * stopping a node needs a decay budget: five constants is -43dB.
 *
 * `exponentialRampToValueAtTime` is not an option for fades to silence — a zero
 * target throws.
 */
export const SILENCE_TAU_MULTIPLE = 5;
