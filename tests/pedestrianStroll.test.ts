import { describe, expect, it } from "vitest";
import {
  PED_TURN_PAUSE_S,
  stepStroll,
  type StrollState,
} from "../app/game/pedestrianStroll";

const DT = 1 / 60;

// Deterministic LCG so the fuzz cases are reproducible.
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe("stepStroll", () => {
  it("never moves further in one step than legs can carry", () => {
    // The reported bug: the old sawtooth teleported a pedestrian back to the
    // start of the strip once per cycle — an 12 m jump in a single frame.
    const random = lcg(7);
    let state: StrollState = { distanceM: 3, walkDir: 1, pauseRemaining: 0 };
    for (let step = 0; step < 10_000; step += 1) {
      const speed = 0.5 + random() * 2;
      const next = stepStroll(state, 12, speed, PED_TURN_PAUSE_S, DT);
      expect(Math.abs(next.distanceM - state.distanceM)).toBeLessThanOrEqual(
        speed * DT + 1e-9,
      );
      state = next;
    }
  });

  it("keeps the walker on the strip", () => {
    const random = lcg(11);
    let state: StrollState = { distanceM: 0, walkDir: 1, pauseRemaining: 0 };
    for (let step = 0; step < 10_000; step += 1) {
      state = stepStroll(state, 16, 1 + random(), 0.6, DT);
      expect(state.distanceM).toBeGreaterThanOrEqual(0);
      expect(state.distanceM).toBeLessThanOrEqual(16);
    }
  });

  it("stops at the end, waits out the pause, then walks back", () => {
    let state: StrollState = { distanceM: 11.99, walkDir: 1, pauseRemaining: 0 };
    state = stepStroll(state, 12, 1.4, PED_TURN_PAUSE_S, DT);
    expect(state.distanceM).toBe(12);
    expect(state.walkDir).toBe(-1);
    expect(state.pauseRemaining).toBe(PED_TURN_PAUSE_S);
    // Standing still for the whole pause, not sliding.
    const pauseSteps = Math.ceil(PED_TURN_PAUSE_S / DT);
    for (let step = 0; step < pauseSteps; step += 1) {
      state = stepStroll(state, 12, 1.4, PED_TURN_PAUSE_S, DT);
      expect(state.distanceM).toBe(12);
    }
    expect(state.pauseRemaining).toBe(0);
    state = stepStroll(state, 12, 1.4, PED_TURN_PAUSE_S, DT);
    expect(state.distanceM).toBeLessThan(12);
    expect(state.walkDir).toBe(-1);
  });

  it("turns around at the near end too", () => {
    let state: StrollState = { distanceM: 0.01, walkDir: -1, pauseRemaining: 0 };
    state = stepStroll(state, 12, 1.4, 0.5, DT);
    expect(state.distanceM).toBe(0);
    expect(state.walkDir).toBe(1);
    expect(state.pauseRemaining).toBe(0.5);
  });

  it("covers a full leg at the commanded ground speed", () => {
    // GameCanvas derives metersPerSec as span*speed/18 to preserve the tuned
    // speeds; a leg of the strip must take span/metersPerSec seconds.
    const span = 12;
    const metersPerSec = (span * 1.24) / 18;
    let state: StrollState = { distanceM: 0, walkDir: 1, pauseRemaining: 0 };
    let steps = 0;
    while (state.distanceM < span) {
      state = stepStroll(state, span, metersPerSec, 0, DT);
      steps += 1;
    }
    const expected = span / metersPerSec / DT;
    expect(steps).toBeGreaterThan(expected * 0.99);
    expect(steps).toBeLessThan(expected * 1.01 + 2);
  });

  it("is pure: identical inputs give identical outputs and no mutation", () => {
    const state: StrollState = { distanceM: 5, walkDir: 1, pauseRemaining: 0.2 };
    const frozen = { ...state };
    const a = stepStroll(state, 12, 1.4, 1, DT);
    const b = stepStroll(state, 12, 1.4, 1, DT);
    expect(a).toEqual(b);
    expect(state).toEqual(frozen);
    expect(a).not.toBe(state);
  });
});
