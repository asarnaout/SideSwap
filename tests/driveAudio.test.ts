import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENGINE_PROFILE,
  ENGINE,
  ENGINE_CYLINDERS,
  GEAR_TOP_MPS,
  MAX_SPEED_MPS,
  MOTORBIKE_ENGINE_PROFILE,
  SHIFT_BANDS,
  approach,
  createAudioParams,
  createAudioState,
  targetRpm,
  updateAudioModel,
  upshiftSpeed,
  type DriveAudioParams,
  type DriveAudioTelemetry,
} from "../app/game/audio/audioMath";
import {
  buildEngineHarmonics,
  buildHornHarmonics,
  fillPinkNoise,
  fillValueNoise,
  fillWhiteNoise,
} from "../app/game/audio/waveTables";

const telemetry = (patch: Partial<DriveAudioTelemetry> = {}): DriveAudioTelemetry => ({
  dtSeconds: 1 / 60,
  speedMps: 0,
  signedSpeedMps: 0,
  gear: "D",
  throttle: 0,
  brake: 0,
  steer: 0,
  offRoad: false,
  outOfFuel: false,
  firstPerson: false,
  ...patch,
});

/** Runs the model for `seconds` at 60Hz with fixed inputs. */
const run = (
  patch: Partial<DriveAudioTelemetry>,
  seconds: number,
  state = createAudioState(),
  out = createAudioParams(),
) => {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i += 1) updateAudioModel(state, telemetry(patch), out);
  return { state, out };
};

describe("gearbox", () => {
  it("settles into the gear whose band the speed falls in", () => {
    for (let gear = 1; gear <= GEAR_TOP_MPS.length; gear += 1) {
      const midpoint = gear === 1 ? 5 : (GEAR_TOP_MPS[gear - 2] + GEAR_TOP_MPS[gear - 1]) / 2;
      const { state } = run({ speedMps: midpoint, throttle: 1 }, 12);
      expect(state.gear, `${midpoint.toFixed(1)} m/s`).toBe(gear);
    }
  });

  it("holds the higher gear on the way back down (hysteresis)", () => {
    const state = createAudioState();
    const out = createAudioParams();
    // Accelerate through the 1→2 boundary at 8.5 m/s...
    for (let i = 0; i < 180; i += 1) {
      updateAudioModel(state, telemetry({ speedMps: 9, throttle: 1 }), out);
    }
    expect(state.gear).toBe(2);
    // ...then drop just below it. Second gear must hold: the downshift point is
    // 12% under the gear-1 upshift speed, not at it.
    for (let i = 0; i < 180; i += 1) {
      updateAudioModel(state, telemetry({ speedMps: 8, throttle: 1 }), out);
    }
    expect(state.gear).toBe(2);
  });

  it("does not hunt when speed dithers across a boundary", () => {
    for (let gear = 1; gear < GEAR_TOP_MPS.length; gear += 1) {
      const boundary = GEAR_TOP_MPS[gear - 1];
      const state = createAudioState();
      const out = createAudioParams();
      // Settle first, then count shifts caused purely by the dither.
      for (let i = 0; i < 120; i += 1) {
        updateAudioModel(state, telemetry({ speedMps: boundary, throttle: 1 }), out);
      }
      let shifts = 0;
      for (let i = 0; i < 200; i += 1) {
        const speedMps = boundary + (i % 2 === 0 ? 0.2 : -0.2);
        updateAudioModel(state, telemetry({ speedMps, throttle: 1 }), out);
        if (out.shifted) shifts += 1;
      }
      expect(shifts, `boundary ${boundary}`).toBeLessThanOrEqual(1);
    }
  });

  it("short-shifts at most once on a throttle lift, and never hunts", () => {
    // Feathering the throttle at fixed speed may short-shift up once — that is
    // the intended behaviour. What it must never do is drop back down when the
    // throttle returns, because that loop repeats for as long as the driver
    // keeps modulating the pedal.
    for (const speedMps of [5, 8.5, 12, 15.5, 20, 23.5, 28, 31.5, 36]) {
      const state = createAudioState();
      const out = createAudioParams();
      for (let i = 0; i < 240; i += 1) {
        updateAudioModel(state, telemetry({ speedMps, throttle: 1 }), out);
      }
      let shifts = 0;
      let lowest = state.gear;
      let previous = state.gear;
      for (let cycle = 0; cycle < 3; cycle += 1) {
        for (let i = 0; i < 400; i += 1) {
          const phase = i / 400;
          const throttle = phase < 0.5 ? 1 - phase * 2 : (phase - 0.5) * 2;
          updateAudioModel(state, telemetry({ speedMps, throttle }), out);
          if (out.shifted) shifts += 1;
          // Never backwards: a downshift here is the hunting signature.
          expect(state.gear, `${speedMps} m/s downshifted`).toBeGreaterThanOrEqual(previous);
          previous = state.gear;
          lowest = Math.min(lowest, state.gear);
        }
      }
      expect(shifts, `${speedMps} m/s`).toBeLessThanOrEqual(1);
      expect(lowest, `${speedMps} m/s`).toBeGreaterThan(0);
    }
  });

  it("keeps the downshift point below the coasting upshift point", () => {
    // The invariant that makes the test above hold at every speed, not just the
    // ones sampled. Raising HYSTERESIS past the short-shift floor reintroduces
    // throttle-driven hunting.
    expect(SHIFT_BANDS.hysteresis).toBeLessThan(SHIFT_BANDS.shortShiftFloor);
  });
});

describe("rpm", () => {
  it("rises with speed inside a gear and stays inside the rev range", () => {
    for (let gear = 1; gear <= GEAR_TOP_MPS.length; gear += 1) {
      const floor = gear === 1 ? 0 : GEAR_TOP_MPS[gear - 2];
      let previous = -Infinity;
      for (let speed = floor; speed <= GEAR_TOP_MPS[gear - 1]; speed += 0.25) {
        const rpm = targetRpm(gear, speed, 1, false);
        expect(rpm).toBeGreaterThanOrEqual(ENGINE.idleRpm * 0.94);
        expect(rpm).toBeLessThanOrEqual(ENGINE.redlineRpm);
        // The launch flare deliberately leads road speed below 6 m/s, so
        // monotonicity is only claimed once it has decayed.
        if (speed > 6) {
          expect(rpm, `gear ${gear} at ${speed}`).toBeGreaterThan(previous);
        }
        previous = rpm;
      }
    }
  });

  it("stays continuous across every shift", () => {
    // The highest-value test here: it exercises the smoothed output rather than
    // the raw map, so it catches gearbox bugs that boundary tests walk past.
    const state = createAudioState();
    const out = createAudioParams();
    let previous: number = ENGINE.idleRpm;
    let worst = 0;
    for (let speed = 0; speed <= MAX_SPEED_MPS; speed += 0.05) {
      updateAudioModel(state, telemetry({ speedMps: speed, throttle: 1 }), out);
      worst = Math.max(worst, Math.abs(out.rpm - previous));
      previous = out.rpm;
    }
    // The largest designed shift drop is bounded by the rev range, and the 32ms
    // shift time constant completes ~40% of it in one 60Hz frame. A gap in the
    // gear ladder would teleport the revs well past that.
    const span = ENGINE.shiftRpm - ENGINE.idleRpm;
    expect(worst).toBeLessThan(span * 0.55);
  });

  it("behaves identically at 30fps and 60fps", () => {
    // Catches the `x += (target - x) * k` bug class, which runs twice as fast
    // at double the frame rate.
    const at = (dtSeconds: number) => {
      const state = createAudioState();
      state.gear = 3;
      const out = createAudioParams();
      const steps = Math.round(1 / dtSeconds);
      for (let i = 0; i < steps; i += 1) {
        updateAudioModel(state, telemetry({ dtSeconds, speedMps: 20, throttle: 1 }), out);
      }
      return out;
    };
    const slow = at(1 / 30);
    const fast = at(1 / 60);
    expect(slow.gear).toBe(fast.gear);
    expect(slow.load).toBeCloseTo(fast.load, 2);
    expect(Math.abs(slow.rpm - fast.rpm) / fast.rpm).toBeLessThan(0.01);
  });

  it("approaches a target without overshooting", () => {
    expect(approach(0, 1, 0, 0.1)).toBeCloseTo(0, 6);
    expect(approach(0, 1, 10, 0.1)).toBeCloseTo(1, 6);
    expect(approach(0, 1, 0.1, 0.1)).toBeCloseTo(1 - Math.exp(-1), 6);
  });
});

describe("engine character", () => {
  it("sounds brighter and louder under load than coasting at the same speed", () => {
    // This is the explicit requirement: accelerating and coasting must not sound
    // the same at identical road speed.
    const shared = { speedMps: 20 };
    const loaded = run({ ...shared, throttle: 1 }, 3);
    const coasting = run({ ...shared, throttle: 0 }, 3);
    expect(loaded.out.engineToneHz).toBeGreaterThan(coasting.out.engineToneHz * 2);
    expect(loaded.out.engineGain).toBeGreaterThan(coasting.out.engineGain * 1.5);
  });

  it("ramps load smoothly from a binary throttle input", () => {
    // Keyboard throttle is 0 or 1, so a step must not reach the engine.
    const state = createAudioState();
    const out = createAudioParams();
    updateAudioModel(state, telemetry({ speedMps: 10, throttle: 1 }), out);
    // One frame of a 90ms time constant, not the full step the key press gave.
    expect(out.load).toBeLessThan(0.25);
    for (let i = 0; i < 24; i += 1) {
      updateAudioModel(state, telemetry({ speedMps: 10, throttle: 1 }), out);
    }
    expect(out.load).toBeGreaterThan(0.9);
  });

  it("dies when the tank runs dry and recovers when it is refilled", () => {
    const { state, out } = run({ speedMps: 0, throttle: 0, outOfFuel: true }, 2.5);
    expect(out.engineGain).toBeCloseTo(0, 3);
    const revived = run({ speedMps: 0, throttle: 1 }, 2, state, out);
    expect(revived.out.engineGain).toBeGreaterThan(0.05);
  });

  it("whines only in reverse", () => {
    expect(run({ speedMps: 4, gear: "R", throttle: 1 }, 2).out.reverseWhineGain).toBeGreaterThan(0);
    expect(run({ speedMps: 4, gear: "D", throttle: 1 }, 2).out.reverseWhineGain).toBe(0);
  });
});

describe("engine character", () => {
  /** Runs the engine up to speed under a fixed load and returns the params. */
  const settle = (speedMps: number, throttle: number) => {
    const state = createAudioState();
    const out = createAudioParams();
    for (let i = 0; i < 240; i += 1) {
      updateAudioModel(state, telemetry({ speedMps, throttle }), out);
    }
    return out;
  };

  it("shifts like a road car, not a race car", () => {
    // A car that pulls to 6000rpm in every gear sounds like it is on a track,
    // whatever its timbre — this is the strongest character cue, and it is the
    // one the previous version got wrong.
    expect(ENGINE.shiftRpm).toBeLessThan(3400);
    expect(ENGINE.redlineRpm).toBeLessThan(4800);
  });

  it("keeps the cutoff dark even at full load", () => {
    // How far the lowpass opens is the "sharpness" that was reported. A race
    // engine runs to ~5kHz; this stays well under 2.
    for (const speedMps of [8, 16, 24, 32, 40.4]) {
      expect(settle(speedMps, 1).engineToneHz, `${speedMps} m/s`).toBeLessThan(2000);
    }
  });

  it("has no performance intake howl", () => {
    // The bright saw layer at the firing frequency is the aggressive bark; a
    // small hatchback has none.
    expect(ENGINE.topGain).toBe(0);
    expect(settle(30, 1).engineTopGain).toBe(0);
  });

  it("still sounds different accelerating and coasting", () => {
    // Softening the engine must not cost the load-vs-coast distinction.
    const loaded = settle(22, 1);
    const coasting = settle(22, 0);
    expect(loaded.engineToneHz).toBeGreaterThan(coasting.engineToneHz * 1.6);
    expect(loaded.engineGain).toBeGreaterThan(coasting.engineGain);
  });

  it("stays inside its rev range at every speed", () => {
    for (const speedMps of [0, 5, 12, 22, 33, 40.4]) {
      const rpm = settle(speedMps, 1).rpm;
      expect(rpm, `${speedMps} m/s`).toBeGreaterThanOrEqual(ENGINE.idleRpm * 0.9);
      expect(rpm, `${speedMps} m/s`).toBeLessThanOrEqual(ENGINE.redlineRpm);
    }
  });
});

describe("wind, road and tyres", () => {
  it("scales wind superlinearly with speed", () => {
    // Linear scaling is what makes 20mph and 60mph sound identical.
    const slow = run({ speedMps: 10 }, 1).out.windGain;
    const fast = run({ speedMps: 40 }, 1).out.windGain;
    expect(fast / slow).toBeGreaterThan(6);
  });

  it("keeps wind inside a band at every speed", () => {
    // A highpass with nothing above it passes every frequency up to Nyquist,
    // which is white noise by definition — this is what made it sound like
    // static rather than moving air.
    for (let speedMps = 0; speedMps <= MAX_SPEED_MPS; speedMps += 0.5) {
      const { out } = run({ speedMps, throttle: 1 }, 0.5);
      expect(out.windTopHz, `${speedMps} m/s`).toBeGreaterThan(out.windHz * 2);
      expect(out.windTopHz, `${speedMps} m/s`).toBeLessThan(6000);
    }
  });

  it("never lets wind drown the engine", () => {
    // Wind conveys speed; the car is still the subject.
    for (const speedMps of [10, 20, 30, 40.4]) {
      const { out } = run({ speedMps, throttle: 1 }, 3);
      expect(out.windGain, `${speedMps} m/s`).toBeLessThan(out.engineGain);
    }
  });

  it("gets louder and muddier off the tarmac", () => {
    const paved = run({ speedMps: 20 }, 1).out;
    const rough = run({ speedMps: 20, offRoad: true }, 1).out;
    expect(rough.roadGain).toBeGreaterThan(paved.roadGain * 1.7);
    expect(rough.roadHz).toBeLessThan(paved.roadHz);
  });

  it("squeals on a hard brake at speed", () => {
    expect(run({ speedMps: 30, brake: 1 }, 1).out.squealGain).toBeGreaterThan(0);
  });

  it("does not squeal on cornering — only braking", () => {
    // The tyre squeal is brake-lockup only; steering hard, however far, stays
    // silent. Braking through that same corner still squeals — from the brake.
    expect(run({ speedMps: 30, steer: 1 }, 1).out.squealGain).toBe(0);
    expect(run({ speedMps: 30, steer: -1 }, 1).out.squealGain).toBe(0);
    expect(run({ speedMps: 30, steer: 1, brake: 1 }, 1).out.squealGain).toBeGreaterThan(0);
  });

  it("squeals the discs only when rolling slowly to a stop", () => {
    // A brake application that rolls the dice favourably; the roll is seeded.
    const found = [0.5, 1.5, 2, 3, 4.5].some((speedMps) => {
      const state = createAudioState();
      const out = createAudioParams();
      for (let seed = 0; seed < 40; seed += 1) {
        updateAudioModel(state, telemetry({ speedMps, brake: 0 }), out);
        updateAudioModel(state, telemetry({ speedMps, brake: 0.8 }), out);
        if (out.discGain > 0) return true;
      }
      return false;
    });
    expect(found).toBe(true);
    // Never at a standstill, and never at road speed.
    expect(run({ speedMps: 0, brake: 1 }, 1).out.discGain).toBe(0);
    expect(run({ speedMps: 25, brake: 1 }, 1).out.discGain).toBe(0);
  });

  it("leaves some stops silent", () => {
    // Brakes that squeal on every single stop are maddening within minutes.
    const state = createAudioState();
    const out = createAudioParams();
    const rolls = new Set<number>();
    for (let i = 0; i < 60; i += 1) {
      updateAudioModel(state, telemetry({ speedMps: 2, brake: 0 }), out);
      updateAudioModel(state, telemetry({ speedMps: 2, brake: 0.8 }), out);
      rolls.add(state.discSquealRoll);
    }
    expect(rolls.has(0)).toBe(true);
    expect(rolls.size).toBeGreaterThan(1);
  });
});

describe("parameter safety", () => {
  it("produces finite, in-range values across the whole input space", () => {
    // A NaN or out-of-range value reaching an AudioParam either throws or makes
    // a genuinely horrible noise, so this sweeps the cube rather than sampling.
    const state = createAudioState();
    const out = createAudioParams();
    const gains: (keyof DriveAudioParams)[] = [
      "engineGain",
      "engineTopGain",
      "inductionGain",
      "reverseWhineGain",
      "windGain",
      "roadGain",
      "squealGain",
      "discGain",
    ];
    const frequencies: (keyof DriveAudioParams)[] = [
      "engineFundamentalHz",
      "engineFiringHz",
      "engineToneHz",
      "inductionHz",
      "reverseWhineHz",
      "windHz",
      "windTopHz",
      "roadHz",
      "squealHz",
      "discHz",
    ];
    for (const speedMps of [0, 0.3, 2, 6, 12, 20, 31, 40.4]) {
      for (const throttle of [0, 0.3, 1]) {
        for (const brake of [0, 0.5, 1]) {
          for (const steer of [-1, -0.4, 0, 0.4, 1]) {
            for (const gear of ["D", "R"] as const) {
              for (const offRoad of [false, true]) {
                for (const outOfFuel of [false, true]) {
                  for (let i = 0; i < 4; i += 1) {
                    updateAudioModel(
                      state,
                      telemetry({ speedMps, throttle, brake, steer, gear, offRoad, outOfFuel }),
                      out,
                    );
                  }
                  for (const key of gains) {
                    const value = out[key] as number;
                    expect(Number.isFinite(value), key).toBe(true);
                    expect(value, key).toBeGreaterThanOrEqual(0);
                    expect(value, key).toBeLessThanOrEqual(1);
                  }
                  for (const key of frequencies) {
                    const value = out[key] as number;
                    expect(Number.isFinite(value), key).toBe(true);
                    expect(value, key).toBeGreaterThanOrEqual(1);
                    expect(value, key).toBeLessThanOrEqual(18_000);
                  }
                  expect(out.engineToneQ).toBeGreaterThan(0.1);
                  expect(out.engineToneQ).toBeLessThan(40);
                }
              }
            }
          }
        }
      }
    }
  });
});

describe("wave tables", () => {
  it("makes the firing order louder than the fundamental", () => {
    // The central claim of the engine design. A sawtooth peaks at the
    // fundamental and a square has no even harmonics at all; neither can sound
    // like a four-cylinder, and this inversion is why.
    const harmonics = buildEngineHarmonics(384, ENGINE_CYLINDERS);
    expect(harmonics).toHaveLength(385);
    expect(harmonics[0]).toBe(0);
    expect(harmonics[ENGINE_CYLINDERS]).toBeGreaterThan(harmonics[1]);
    expect(harmonics[ENGINE_CYLINDERS]).toBeGreaterThan(harmonics[2]);
    expect(harmonics.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
  });

  it("carries half-orders, but well under the firing order", () => {
    const harmonics = buildEngineHarmonics(384, ENGINE_CYLINDERS);
    expect(harmonics[1]).toBeGreaterThan(0);
    expect(harmonics[3]).toBeGreaterThan(0);
    expect(harmonics[1]).toBeLessThan(harmonics[ENGINE_CYLINDERS] * 0.4);
  });

  it("gives the horn a flare formant and both harmonic families", () => {
    const horn = buildHornHarmonics();
    // A square wave's missing even harmonics are why the old horn sounded hollow.
    expect(horn[2]).toBeGreaterThan(0.5);
    expect(horn[4]).toBeGreaterThan(horn[3]);
    expect(horn[horn.length - 1]).toBeLessThan(horn[1]);
  });

  it("makes pink noise substantially darker than white", () => {
    // The mean step between adjacent samples is a cheap proxy for
    // high-frequency energy. White noise carries half its power in the top
    // octave, which is exactly the bright electronic hiss that reads as static;
    // pink spreads energy per octave the way real air does.
    const step = (fill: (out: Float32Array, random: () => number) => void) => {
      const buffer = new Float32Array(48_000);
      let seed = 3;
      fill(buffer, () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      });
      let total = 0;
      for (let i = 1; i < buffer.length; i += 1) total += Math.abs(buffer[i] - buffer[i - 1]);
      return total / (buffer.length - 1);
    };
    expect(step(fillPinkNoise)).toBeLessThan(step(fillWhiteNoise) * 0.5);
  });

  it("generates value noise that is bounded, centred and genuinely slow", () => {
    // Two seconds, so an 8Hz wobble gets sixteen whole cycles to average out.
    const buffer = new Float32Array(96_000);
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    fillValueNoise(buffer, 48_000, 8, random);
    let peak = 0;
    let sum = 0;
    let biggestStep = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      peak = Math.max(peak, Math.abs(buffer[i]));
      sum += buffer[i];
      if (i > 0) biggestStep = Math.max(biggestStep, Math.abs(buffer[i] - buffer[i - 1]));
    }
    expect(peak).toBeCloseTo(1, 5);
    expect(Math.abs(sum / buffer.length)).toBeLessThan(0.5);
    // Low-frequency by construction: adjacent samples barely differ.
    expect(biggestStep).toBeLessThan(0.02);
  });
});

describe("shift points", () => {
  it("short-shifts when coasting and holds on under load", () => {
    for (let gear = 1; gear <= GEAR_TOP_MPS.length; gear += 1) {
      expect(upshiftSpeed(gear, 0)).toBeLessThan(upshiftSpeed(gear, 1));
      expect(upshiftSpeed(gear, 1)).toBeCloseTo(GEAR_TOP_MPS[gear - 1], 5);
    }
  });

  it("reports the shift on exactly the frame it happens", () => {
    const state = createAudioState();
    const out = createAudioParams();
    let flagged = 0;
    let changes = 0;
    let last = state.gear;
    for (let speed = 0; speed <= MAX_SPEED_MPS; speed += 0.05) {
      updateAudioModel(state, telemetry({ speedMps: speed, throttle: 1 }), out);
      if (out.shifted) flagged += 1;
      if (state.gear !== last) changes += 1;
      last = state.gear;
    }
    expect(flagged).toBe(changes);
    expect(changes).toBe(GEAR_TOP_MPS.length - 1);
  });
});

// Guards the assumption the whole gear ladder is built on.
describe("gear ratios", () => {
  it("tops every gear out at the same shift speed", () => {
    for (let gear = 1; gear <= GEAR_TOP_MPS.length; gear += 1) {
      const atTop = targetRpm(gear, GEAR_TOP_MPS[gear - 1], 1, false);
      expect(atTop).toBeGreaterThan(ENGINE.shiftRpm * 0.94);
      expect(atTop).toBeLessThanOrEqual(ENGINE.redlineRpm);
    }
  });

  it("drops fewer revs per shift as the gears close up", () => {
    const drops: number[] = [];
    for (let gear = 1; gear < GEAR_TOP_MPS.length; gear += 1) {
      const speed = GEAR_TOP_MPS[gear - 1];
      drops.push(targetRpm(gear, speed, 1, false) - targetRpm(gear + 1, speed, 1, false));
    }
    for (let i = 1; i < drops.length; i += 1) {
      expect(drops[i]).toBeLessThan(drops[i - 1]);
      expect(drops[i]).toBeGreaterThan(0);
    }
  });
});

describe("engine profiles", () => {
  it("omitting the profile is byte-identical to passing the default explicitly", () => {
    // The seeded `random` field is a closure — compare everything but it.
    const bare = (state: ReturnType<typeof createAudioState>) => ({
      ...state,
      random: undefined,
    });
    const implicitState = createAudioState();
    const explicitState = createAudioState(undefined, DEFAULT_ENGINE_PROFILE);
    const implicitParams = createAudioParams();
    const explicitParams = createAudioParams(DEFAULT_ENGINE_PROFILE);
    expect(bare(explicitState)).toEqual(bare(implicitState));
    expect(explicitParams).toEqual(implicitParams);
    for (let tick = 0; tick < 600; tick += 1) {
      const input = telemetry({
        throttle: tick < 400 ? 0.9 : 0,
        speedMps: Math.min(30, tick * 0.06),
      });
      updateAudioModel(implicitState, input, implicitParams);
      updateAudioModel(explicitState, input, explicitParams, DEFAULT_ENGINE_PROFILE);
    }
    expect(bare(explicitState)).toEqual(bare(implicitState));
    expect(explicitParams).toEqual(implicitParams);
  });

  it("the motorbike revs its own range with two-cylinder firing", () => {
    const profile = MOTORBIKE_ENGINE_PROFILE;
    const state = createAudioState(undefined, profile);
    const params = createAudioParams(profile);
    expect(state.rpm).toBe(1300);
    for (let tick = 0; tick < 900; tick += 1) {
      updateAudioModel(
        state,
        telemetry({ throttle: 1, speedMps: Math.min(24, tick * 0.05) }),
        params,
        profile,
      );
    }
    // Held wide open at its 24 m/s cap the twin sits far above the car's
    // 4200 redline, in top gear, firing two cylinders per cycle.
    expect(state.rpm).toBeGreaterThan(5000);
    expect(state.rpm).toBeLessThanOrEqual(profile.redlineRpm);
    expect(state.gear).toBe(profile.gearTopMps.length);
    expect(params.engineFiringHz).toBeCloseTo(params.engineFundamentalHz * 2, 5);
    // The brighter character actually reaches the filter: cutoff beyond the
    // car's ~1.4 kHz ceiling and the intake bark switched on.
    expect(params.engineToneHz).toBeGreaterThan(1400);
    expect(params.engineTopGain).toBeGreaterThan(0);
  });
});
