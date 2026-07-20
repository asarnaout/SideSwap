/**
 * Everything the car's sound needs to know, as arithmetic.
 *
 * This module is renderer-agnostic and has no Web Audio imports, so it can be
 * unit-tested directly — the same split `visuals.ts` uses. The voices consume
 * the numbers it produces and do nothing but schedule them.
 *
 * The simulation has no engine model at all: no RPM, no gear ratios, no torque
 * curve, no slip. Its physics is a single scalar speed. So the gearbox and rev
 * range below are invented here rather than read from anywhere, chosen to sit
 * plausibly over the sim's real limits (top speed ~40.3 m/s, braking up to
 * 11.5 m/s²). The tyre-squeal threshold is the one exception: it mirrors the
 * simulation's own lateral-acceleration formula so what you hear and what the
 * game penalises cannot drift apart.
 */
import { seededUnit } from "../visuals";

export const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

/** Rises 0→1 across [edge, 1]; 0 at or below the edge. */
const rampFrom = (value: number, edge: number): number =>
  clamp((value - edge) / (1 - edge), 0, 1);

/**
 * Frame-rate-independent one-pole approach. The naive `x += (t - x) * k` form
 * moves twice as fast at 120fps as at 60fps; this does not.
 */
export const approach = (
  current: number,
  target: number,
  dtSeconds: number,
  tau: number,
): number => current + (target - current) * (1 - Math.exp(-dtSeconds / tau));

// ---------------------------------------------------------------------------
// Engine constants
// ---------------------------------------------------------------------------

export const IDLE_RPM = 820;
/** Where an upshift happens under load — deliberately short of the redline. */
export const SHIFT_RPM = 6200;
export const REDLINE_RPM = 6500;

/** Upper speed bound of each forward gear, m/s. Fifth ends at the sim's cap. */
export const GEAR_TOP_MPS = [8.5, 15.5, 23.5, 31.5, 40.4] as const;

/**
 * RPM gained per m/s in each gear, `(SHIFT_RPM - IDLE_RPM) / GEAR_TOP_MPS`.
 * Because every gear shares the idle intercept, the rpm drop after each shift
 * falls out of the ratios rather than being tuned: 2422, 1815, 1361, 1159. Drops
 * narrowing as you go up is what a real gearset does.
 */
export const GEAR_RPM_PER_MPS = [633, 347, 229, 171, 133] as const;

/** Reverse is geared short and screams: 6 m/s lands near 5220 rpm. */
export const REVERSE_RPM_PER_MPS = 733;

export const MAX_SPEED_MPS = 40.4;
export const MAX_REVERSE_MPS = 6;

/**
 * Multiplies the engine's pitch without touching the gearbox. At 1.0 the note
 * is physically honest — idle firing lands at 27Hz — but laptop speakers roll
 * off below ~150Hz, so the low end is carried entirely by upper harmonics and
 * the `growl` filter. Raise toward 1.6 if it sounds thin on real hardware.
 */
export const ENGINE_PITCH_MULTIPLIER = 1;

/** Four cylinders, four-stroke: two firing events per crank revolution. */
export const ENGINE_CYLINDERS = 4;

/**
 * Peak level of the wind layer, before the speed curve and camera trim. Set this
 * to 0 to remove wind noise entirely — nothing else depends on it, and the road
 * layer alone still conveys speed, just less vividly.
 */
export const WIND_LEVEL = 0.15;

/**
 * How much the wind level wanders, as a fraction of itself. Steady broadband
 * noise is what the ear labels "static"; real wind gusts, and this fluctuation
 * does more to sell it as air than any amount of filtering.
 */
export const WIND_GUST_DEPTH = 0.38;

// Pinned to simulation.ts:1887-1889. If the sim's handling model changes, the
// squeal must move with it, and the test suite asserts these still match.
export const LATERAL_ACCEL_DIVISOR = 3.1;
export const LATERAL_UNSTABLE_MPS2 = 11;

const UPSHIFT_HOLD_S = 0.35;
/** Shorter than the upshift hold so hard braking can chain 5→1 quickly. */
const DOWNSHIFT_HOLD_S = 0.12;

/**
 * Coasting upshifts at this fraction of the wide-open-throttle speed, so lifting
 * off short-shifts the way a real automatic does.
 */
const SHORT_SHIFT_FLOOR = 0.82;

/**
 * Downshift point as a fraction of the gear below's upshift speed.
 *
 * This **must** stay below SHORT_SHIFT_FLOOR, and the test suite asserts it.
 * Upshifts happen at `top × (floor + span × load)`, so the lowest speed you can
 * enter a gear at is `top × floor`; downshifts are checked against
 * `top × (floor + span × load) × hysteresis`, whose highest value is
 * `top × hysteresis`. If hysteresis exceeded the floor, the downshift point at
 * full load would sit above the upshift point at zero load — so lifting off
 * would short-shift up and squeezing back on would immediately drop you again,
 * hunting for as long as the driver kept feathering the throttle.
 */
const HYSTERESIS = 0.8;
const SHIFT_FLASH_S = 0.13;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface DriveAudioTelemetry {
  readonly dtSeconds: number;
  readonly speedMps: number;
  readonly signedSpeedMps: number;
  readonly gear: "D" | "R";
  /** 0-1, already zeroed when out of fuel, matching what the sim acts on. */
  readonly throttle: number;
  readonly brake: number;
  /** -1..1, already scaled by steering sensitivity. */
  readonly steer: number;
  readonly offRoad: boolean;
  readonly outOfFuel: boolean;
  readonly firstPerson: boolean;
}

/** Mutable model state, owned by the caller and advanced in place. */
export interface DriveAudioState {
  rpm: number;
  load: number;
  /** 1-5 forward, 0 in reverse. */
  gear: number;
  secondsInGear: number;
  shiftFlashSeconds: number;
  stallSeconds: number;
  /** Re-rolled per brake application so only some stops squeal. */
  discSquealRoll: number;
  brakeEngaged: boolean;
  random: () => number;
}

/** Everything a voice needs, recomputed each frame into a caller-owned object. */
export interface DriveAudioParams {
  engineFundamentalHz: number;
  engineFiringHz: number;
  engineGain: number;
  engineToneHz: number;
  engineToneQ: number;
  engineTopGain: number;
  inductionGain: number;
  inductionHz: number;
  jitterCents: number;
  reverseWhineHz: number;
  reverseWhineGain: number;
  windGain: number;
  windHz: number;
  /** Upper corner of the wind band. Without it the layer is white noise. */
  windTopHz: number;
  roadGain: number;
  roadHz: number;
  roadQ: number;
  squealGain: number;
  squealHz: number;
  discGain: number;
  discHz: number;
  /** Set for the frame a shift lands on, so the voice can duck the torque. */
  shifted: boolean;
  rpm: number;
  gear: number;
  load: number;
}

export function createAudioState(seed = 20260719): DriveAudioState {
  return {
    rpm: IDLE_RPM,
    load: 0,
    gear: 1,
    secondsInGear: 0,
    shiftFlashSeconds: 0,
    stallSeconds: 0,
    discSquealRoll: 1,
    brakeEngaged: false,
    random: seededUnit(seed),
  };
}

export function createAudioParams(): DriveAudioParams {
  return {
    engineFundamentalHz: IDLE_RPM / 120,
    engineFiringHz: IDLE_RPM / 30,
    engineGain: 0,
    engineToneHz: 220,
    engineToneQ: 0.9,
    engineTopGain: 0,
    inductionGain: 0,
    inductionHz: 180,
    jitterCents: 35,
    reverseWhineHz: 355,
    reverseWhineGain: 0,
    windGain: 0,
    windHz: 180,
    windTopHz: 900,
    roadGain: 0,
    roadHz: 120,
    roadQ: 0.9,
    squealGain: 0,
    squealHz: 900,
    discGain: 0,
    discHz: 2200,
    shifted: false,
    rpm: IDLE_RPM,
    gear: 1,
    load: 0,
  };
}

// ---------------------------------------------------------------------------
// Gearbox
// ---------------------------------------------------------------------------

/**
 * Speed at which gear `gear` (1-based) upshifts. Coasting short-shifts at 82%
 * of the wide-open-throttle speed; full throttle holds on to the redline.
 */
export function upshiftSpeed(gear: number, load: number): number {
  return GEAR_TOP_MPS[gear - 1] * (SHORT_SHIFT_FLOOR + (1 - SHORT_SHIFT_FLOOR) * load);
}

/** Exposed so the suite can assert the no-hunting invariant documented above. */
export const SHIFT_BANDS = { shortShiftFloor: SHORT_SHIFT_FLOOR, hysteresis: HYSTERESIS };

/**
 * Picks a gear, with enough hysteresis that it cannot hunt.
 *
 * Lifting off lowers the upshift speed, so coasting can short-shift you up a
 * gear — intended, and what a real automatic does. What must never happen is the
 * reverse trip on the way back: squeezing the throttle again raises the
 * downshift point, and if it could rise past your current speed you would drop a
 * gear, then short-shift up again the moment you lifted, for as long as you
 * feathered the pedal. Keeping HYSTERESIS below SHORT_SHIFT_FLOOR is what rules
 * that out; the hold timers are belt-and-braces on top.
 */
export function selectGear(
  state: DriveAudioState,
  speedMps: number,
  load: number,
  dtSeconds: number,
): boolean {
  state.secondsInGear += dtSeconds;
  const gear = state.gear;
  if (
    gear < GEAR_TOP_MPS.length &&
    state.secondsInGear >= UPSHIFT_HOLD_S &&
    speedMps > upshiftSpeed(gear, load)
  ) {
    state.gear = gear + 1;
    state.secondsInGear = 0;
    state.shiftFlashSeconds = SHIFT_FLASH_S;
    return true;
  }
  if (
    gear > 1 &&
    state.secondsInGear >= DOWNSHIFT_HOLD_S &&
    speedMps < upshiftSpeed(gear - 1, load) * HYSTERESIS
  ) {
    state.gear = gear - 1;
    state.secondsInGear = 0;
    state.shiftFlashSeconds = SHIFT_FLASH_S;
    return true;
  }
  return false;
}

/**
 * Where the revs want to be. The launch flare matters more than it looks: a real
 * car slips its clutch off the line so revs lead road speed, and below 6 m/s is
 * where city driving actually happens.
 */
export function targetRpm(
  gear: number,
  speedMps: number,
  load: number,
  reverse: boolean,
): number {
  const geared = reverse
    ? IDLE_RPM + speedMps * REVERSE_RPM_PER_MPS
    : IDLE_RPM + speedMps * GEAR_RPM_PER_MPS[gear - 1];
  const flare = 900 * load * clamp(1 - speedMps / 6, 0, 1);
  // Deceleration fuel cut-off pulls the revs slightly under the geared value.
  const overrun = 130 * (1 - load);
  return clamp(geared + flare - overrun, IDLE_RPM * 0.94, REDLINE_RPM);
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/**
 * Advances `state` and writes every synthesis parameter into `out`.
 *
 * Both objects are caller-owned and reused, so this allocates nothing — it runs
 * 60 times a second on the main thread alongside the Babylon render loop.
 */
export function updateAudioModel(
  state: DriveAudioState,
  telemetry: DriveAudioTelemetry,
  out: DriveAudioParams,
): void {
  const dt = clamp(telemetry.dtSeconds, 0, 0.1);
  const speed = Math.max(0, telemetry.speedMps);
  const reverse = telemetry.gear === "R";

  // --- Load -----------------------------------------------------------------
  // Keyboard throttle is binary 0 or 1, so the envelope lives here or the note
  // steps. The 0.25 floor is physical: an engine never jumps from overrun to
  // full load. Engines also pick load up faster than they shed it.
  const loadTarget = telemetry.throttle > 0.02 ? 0.25 + 0.75 * telemetry.throttle : 0;
  state.load = approach(state.load, loadTarget, dt, loadTarget > state.load ? 0.09 : 0.22);
  const load = state.load;

  // --- Gearbox --------------------------------------------------------------
  let shifted = false;
  if (reverse) {
    state.gear = 0;
    state.secondsInGear = 0;
  } else {
    if (state.gear < 1) {
      state.gear = 1;
      state.secondsInGear = 0;
    }
    shifted = selectGear(state, speed, load, dt);
  }
  state.shiftFlashSeconds = Math.max(0, state.shiftFlashSeconds - dt);

  // --- Revs -----------------------------------------------------------------
  const wantRpm = targetRpm(reverse ? 1 : state.gear, speed, load, reverse);
  state.rpm = approach(state.rpm, wantRpm, dt, state.shiftFlashSeconds > 0 ? 0.032 : 0.055);

  // Out of fuel the sim already zeroes throttle, but an engine with no fuel
  // should die rather than idle forever. Fading it out is a clearer signal than
  // the HUD alone, and it recovers the moment the tank does.
  if (telemetry.outOfFuel && speed < 0.3) {
    state.stallSeconds += dt;
  } else {
    state.stallSeconds = 0;
  }
  const alive = clamp(1 - state.stallSeconds / 1.2, 0, 1);
  if (state.stallSeconds > 0) {
    state.rpm = approach(state.rpm, 0, dt, 0.5);
  }

  const rpmNorm = clamp((state.rpm - IDLE_RPM) / (REDLINE_RPM - IDLE_RPM), 0, 1);
  const speedNorm = clamp(speed / MAX_SPEED_MPS, 0, 1);

  // --- Engine voice ---------------------------------------------------------
  // The oscillator runs at the four-stroke *cycle* frequency (two crank
  // revolutions), which makes partial k correspond to engine order k/2 — so the
  // half-orders that give a piston engine its lumpiness are simply the odd
  // partials of the wavetable.
  const cycleHz = (state.rpm / 120) * ENGINE_PITCH_MULTIPLIER;
  out.engineFundamentalHz = Math.max(1, cycleHz);
  out.engineFiringHz = Math.max(1, cycleHz * ENGINE_CYLINDERS);
  out.engineGain = (0.16 + 0.34 * rpmNorm) * (0.42 + 0.58 * load) * alive;

  // The cutoff tracking load is what makes accelerating and coasting sound
  // different at the same road speed — closed throttle means low cylinder
  // pressure and a slow-rising, spectrally poor pulse, so it goes muffled.
  out.engineToneHz = 220 + rpmNorm * 900 + load * (600 + rpmNorm * 3400);
  out.engineToneQ = 0.9 + load * 0.7;
  // Intake howl only appears when the engine is genuinely working.
  out.engineTopGain = 0.11 * rampFrom(rpmNorm, 0.45) * rampFrom(load, 0.35) * alive;

  // Broadband air: intake rush and exhaust turbulence. Without this the engine
  // stays recognisably synthetic however good the harmonic table is.
  out.inductionHz = 180 + rpmNorm * 1500;
  out.inductionGain = 0.055 * (0.3 + 0.7 * load) * (0.25 + 0.75 * rpmNorm) * alive;

  // Idle hunts; a revving engine is steady.
  out.jitterCents = 35 - 29 * rpmNorm;

  // Straight-cut reverse gears whine at the mesh frequency. A small detail, but
  // it makes reverse identifiable without looking at the HUD.
  out.reverseWhineHz = clamp((26 * state.rpm) / 60, 20, 6000);
  out.reverseWhineGain = reverse
    ? (0.018 + 0.045 * clamp(speed / MAX_REVERSE_MPS, 0, 1)) * alive
    : 0;

  // --- Wind and road --------------------------------------------------------
  // Wind is a *band*, not a shelf. Highpassing noise and leaving the top open
  // runs every frequency up to Nyquist straight through, which is the textbook
  // recipe for static; real air rushing past a car has a pronounced rolloff
  // above a couple of kilohertz. Both corners open with speed so it brightens
  // rather than merely getting louder.
  out.windHz = 180 + 420 * speedNorm;
  out.windTopHz = 900 + 2400 * speedNorm;
  // The superlinear curve is the point: barely there in town, dominant near the
  // top end. Scaling it linearly makes 20mph and 60mph sound the same.
  out.windGain =
    WIND_LEVEL * Math.pow(speedNorm, 1.9) * (telemetry.firstPerson ? 0.85 : 1.1);

  out.roadHz = telemetry.offRoad ? 90 + 220 * speedNorm : 120 + 380 * speedNorm;
  out.roadQ = telemetry.offRoad ? 0.4 : 0.9;
  out.roadGain = 0.14 * Math.pow(speedNorm, 1.3) * (telemetry.offRoad ? 1.9 : 1);

  // --- Tyres ----------------------------------------------------------------
  // Same formula the simulation scores against, so the warning arrives before
  // the penalty rather than after it.
  const lateral = (Math.abs(telemetry.steer) * speed * speed) / LATERAL_ACCEL_DIVISOR;
  const corner = clamp((lateral - 6.5) / 6.5, 0, 1) * clamp((speed - 4) / 3, 0, 1);
  const lockup =
    clamp((telemetry.brake - 0.45) / 0.55, 0, 1) * clamp((speed - 6) / 10, 0, 1);
  // Max rather than sum: braking into a corner should not double up and drive
  // the limiter.
  const squeal = Math.max(corner, lockup);
  out.squealGain = 0.2 * Math.pow(squeal, 1.5);
  out.squealHz = 900 + 500 * squeal;

  // --- Brake discs ----------------------------------------------------------
  // A mechanical resonance of pad against rotor: low speed, light brake, narrow
  // band. Re-rolled per application because brakes that squeal on every single
  // stop become unbearable within a few minutes of play.
  const braking = telemetry.brake > 0.15;
  if (braking && !state.brakeEngaged) {
    const roll = state.random();
    state.discSquealRoll = roll < 0.55 ? 0 : roll < 0.82 ? 0.4 : 1;
  }
  state.brakeEngaged = braking;
  const bell = Math.exp(-Math.pow((speed - 2) / 1.5, 2));
  const discActive = speed > 0.4 && speed < 5 && braking ? 1 : 0;
  out.discGain =
    0.07 * clamp(telemetry.brake * 1.4, 0, 1) * bell * discActive * state.discSquealRoll;
  out.discHz = 2200 + 260 * speed;

  out.shifted = shifted;
  out.rpm = state.rpm;
  out.gear = state.gear;
  out.load = load;
}
