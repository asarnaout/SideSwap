// The back-and-forth stroll an ambient pedestrian walks on their patch of
// pavement. Renderer-agnostic on purpose: the previous implementation was a
// sawtooth that snapped the walker back to the start of the strip every cycle,
// which read as people popping into existence, walking a little and vanishing.
// The invariant worth pinning — "never moves further in one step than legs can
// carry" — belongs in a unit test, not the driver's seat.

/** How long a pedestrian stands at the end of the strip before walking back. */
export const PED_TURN_PAUSE_S = 1.1;

export interface StrollState {
  /** Distance along the strip in metres, always within [0, span]. */
  readonly distanceM: number;
  readonly walkDir: 1 | -1;
  /** Seconds left standing at a turnaround before setting off again. */
  readonly pauseRemaining: number;
}

/**
 * Advances a stroll one step: walk to the end of the strip, stand for
 * `pauseSeconds`, turn round, walk back. The step a pause runs out in is spent
 * entirely standing (≤ one frame of extra standstill) so no step ever covers
 * more ground than `metersPerSec * dt`.
 */
export function stepStroll(
  state: StrollState,
  spanM: number,
  metersPerSec: number,
  pauseSeconds: number,
  dt: number,
): StrollState {
  if (state.pauseRemaining > 0) {
    return { ...state, pauseRemaining: Math.max(0, state.pauseRemaining - dt) };
  }
  const distanceM = state.distanceM + state.walkDir * metersPerSec * dt;
  if (distanceM >= spanM) {
    return { distanceM: spanM, walkDir: -1, pauseRemaining: pauseSeconds };
  }
  if (distanceM <= 0) {
    return { distanceM: 0, walkDir: 1, pauseRemaining: pauseSeconds };
  }
  return { distanceM, walkDir: state.walkDir, pauseRemaining: 0 };
}
