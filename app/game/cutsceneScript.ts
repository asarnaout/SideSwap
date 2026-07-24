/**
 * Choreography for the interaction cutscenes: refuel, rideshare board/exit and
 * the delivery errands. Pure data in, pure data out — a builder turns the car's
 * pose plus a target point into a list of timed steps for one actor, and the
 * session merely executes them. Keeping the waypoint and timing maths here (and
 * free of Babylon) is what lets the geometry invariants be unit-tested: paths
 * that never cross the car body, doors on the correct side for every
 * traffic/steering combination, pump and dwell times inside their brief.
 *
 * All geometry is in the sim's world frame (heading 0 = +z, driver-right
 * normal = (cos h, -sin h)); "local" coordinates put +long out the windscreen
 * and +lat out the driver-right window.
 */
import type { SteeringSide, TrafficSide, WorldPoint } from "./types";

export type CutsceneKind =
  | "refuel"
  | "board"
  | "exit"
  | "food_pickup"
  | "food_dropoff";

export interface CutsceneCarPose {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
}

export type CutsceneAction = "walk" | "run" | "idle" | "show" | "hide";

export type CutsceneSound =
  | "door"
  | "door_close"
  | "pump_start"
  | "pump_stop";

export interface CutsceneStep {
  readonly action: CutsceneAction;
  /** Polyline for walk/run; the single spawn point for show. */
  readonly path?: readonly WorldPoint[];
  readonly seconds: number;
  /** Facing (heading convention) held through show/idle steps. */
  readonly face?: number;
  /** One-shot foley cue fired as the step begins. */
  readonly sound?: CutsceneSound;
  /** Squash the car's suspension as the step begins (someone got in or out). */
  readonly carDip?: boolean;
  /** The refuel fill window: the app pours the tank over this step. */
  readonly fuelWindow?: boolean;
}

export const WALK_SPEED_MPS = 1.5;
export const RUN_SPEED_MPS = 3.2;
/** No walking/jogging leg may exceed this; long paths just move faster. */
export const MAX_LEG_SECONDS = 6;
export const PUMP_BASE_SECONDS = 3;
export const PUMP_EXTRA_SECONDS = 2;
export const STORE_DWELL_SECONDS = 1.5;

/**
 * The vehicle envelope every walk path respects: the body rectangle to stay
 * out of, the waypoint ring used to skirt it, and the door positions in the
 * car's local frame (long forward, lat driver-right). The default is the
 * hand-tuned car envelope these scripts always used; Career Mode derives one
 * per rented vehicle so a van's longer bumpers are actually walked around.
 */
export interface CutsceneBodyProfile {
  readonly bodyHalfLongM: number;
  readonly bodyHalfLatM: number;
  readonly clearLongM: number;
  readonly clearLatM: number;
  readonly doorLateralM: number;
  readonly frontDoorForwardM: number;
  readonly rearDoorForwardM: number;
}

export const DEFAULT_CUTSCENE_BODY: CutsceneBodyProfile = {
  bodyHalfLongM: 2.45,
  bodyHalfLatM: 1.1,
  clearLongM: 3.1,
  clearLatM: 1.7,
  doorLateralM: 1.25,
  frontDoorForwardM: 0.35,
  rearDoorForwardM: -0.55,
};

/** Reference dimensions of the flagship the default envelope was tuned on. */
const REFERENCE_LENGTH_M = 4.55;
const REFERENCE_WIDTH_M = 1.9;

/**
 * Scales the hand-tuned default envelope to a vehicle's footprint. The
 * reference car reproduces DEFAULT_CUTSCENE_BODY exactly, so passing a
 * derived profile for the flagship changes nothing.
 */
export function cutsceneBodyProfile(
  lengthM: number,
  widthM: number,
): CutsceneBodyProfile {
  const long = lengthM / REFERENCE_LENGTH_M;
  const lat = widthM / REFERENCE_WIDTH_M;
  return {
    bodyHalfLongM: DEFAULT_CUTSCENE_BODY.bodyHalfLongM * long,
    bodyHalfLatM: DEFAULT_CUTSCENE_BODY.bodyHalfLatM * lat,
    clearLongM: DEFAULT_CUTSCENE_BODY.clearLongM * long,
    clearLatM: DEFAULT_CUTSCENE_BODY.clearLatM * lat,
    doorLateralM: DEFAULT_CUTSCENE_BODY.doorLateralM * lat,
    frontDoorForwardM: DEFAULT_CUTSCENE_BODY.frontDoorForwardM * long,
    rearDoorForwardM: DEFAULT_CUTSCENE_BODY.rearDoorForwardM * long,
  };
}

/** How far from the pump the driver stands while filling. */
const PUMP_STAND_OFF_M = 1.1;
/** How far a passenger wanders kerbward before despawning, absent a kerb spot. */
const EXIT_WANDER_M = 4.5;

const headingTo = (from: WorldPoint, to: WorldPoint): number =>
  Math.atan2(to.x - from.x, to.z - from.z);

interface LocalPoint {
  readonly long: number;
  readonly lat: number;
}

function toLocal(car: CutsceneCarPose, point: WorldPoint): LocalPoint {
  const dx = point.x - car.x;
  const dz = point.z - car.z;
  const sin = Math.sin(car.heading);
  const cos = Math.cos(car.heading);
  return { long: dx * sin + dz * cos, lat: dx * cos - dz * sin };
}

function toWorld(car: CutsceneCarPose, long: number, lat: number): WorldPoint {
  const sin = Math.sin(car.heading);
  const cos = Math.cos(car.heading);
  return {
    x: car.x + long * sin + lat * cos,
    z: car.z + long * cos - lat * sin,
  };
}

/** Liang–Barsky segment-vs-rect test in the car's local frame. */
function segmentCrossesBody(
  a: LocalPoint,
  b: LocalPoint,
  body: CutsceneBodyProfile,
): boolean {
  const dLong = b.long - a.long;
  const dLat = b.lat - a.lat;
  let t0 = 0;
  let t1 = 1;
  const clips: readonly (readonly [number, number])[] = [
    [-dLong, a.long + body.bodyHalfLongM],
    [dLong, body.bodyHalfLongM - a.long],
    [-dLat, a.lat + body.bodyHalfLatM],
    [dLat, body.bodyHalfLatM - a.lat],
  ];
  for (const [p, q] of clips) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}

/**
 * A polyline from `from` to `to` that never crosses the car body: direct when
 * the straight line already clears it, otherwise skirting the nose or tail
 * (whichever end the walk is nearer) through a waypoint ring just beyond the
 * bumpers.
 */
export function routeAroundCar(
  car: CutsceneCarPose,
  from: WorldPoint,
  to: WorldPoint,
  body: CutsceneBodyProfile = DEFAULT_CUTSCENE_BODY,
): WorldPoint[] {
  const a = toLocal(car, from);
  const b = toLocal(car, to);
  if (!segmentCrossesBody(a, b, body)) return [from, to];
  const endLong = a.long + b.long >= 0 ? body.clearLongM : -body.clearLongM;
  const sideA = a.lat >= 0 ? body.clearLatM : -body.clearLatM;
  const sideB = b.lat >= 0 ? body.clearLatM : -body.clearLatM;
  const path = [from, toWorld(car, endLong, sideA)];
  if (sideA !== sideB) path.push(toWorld(car, endLong, sideB));
  path.push(to);
  return path;
}

export function pathLength(path: readonly WorldPoint[]): number {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    total += Math.hypot(
      path[index].x - path[index - 1].x,
      path[index].z - path[index - 1].z,
    );
  }
  return total;
}

/** Leg duration at a nominal speed, hurrying instead of overrunning the cap. */
function legSeconds(path: readonly WorldPoint[], speedMps: number): number {
  return Math.max(
    0.2,
    Math.min(pathLength(path) / speedMps, MAX_LEG_SECONDS),
  );
}

const driverLat = (
  steeringSide: SteeringSide,
  body: CutsceneBodyProfile,
): number =>
  steeringSide === "left" ? -body.doorLateralM : body.doorLateralM;

/** The kerb is opposite the traffic side: right-hand traffic parks with its
 * right flank to the kerb. */
const kerbLat = (
  trafficSide: TrafficSide,
  body: CutsceneBodyProfile,
): number =>
  trafficSide === "right" ? body.doorLateralM : -body.doorLateralM;

export function driverDoorPoint(
  car: CutsceneCarPose,
  steeringSide: SteeringSide,
  body: CutsceneBodyProfile = DEFAULT_CUTSCENE_BODY,
): WorldPoint {
  return toWorld(car, body.frontDoorForwardM, driverLat(steeringSide, body));
}

export function rearKerbDoorPoint(
  car: CutsceneCarPose,
  trafficSide: TrafficSide,
  body: CutsceneBodyProfile = DEFAULT_CUTSCENE_BODY,
): WorldPoint {
  return toWorld(car, body.rearDoorForwardM, kerbLat(trafficSide, body));
}

/**
 * Driver walks from their door around the car to the nearest pump, fills for
 * 3–5 s (scaling with how empty the tank is), and walks back in.
 */
export function buildRefuelScript(
  car: CutsceneCarPose,
  steeringSide: SteeringSide,
  pump: WorldPoint,
  missingFuelFraction: number,
  body: CutsceneBodyProfile = DEFAULT_CUTSCENE_BODY,
): CutsceneStep[] {
  const door = driverDoorPoint(car, steeringSide, body);
  const toCar = Math.hypot(car.x - pump.x, car.z - pump.z);
  const stand =
    toCar > 0.001
      ? {
          x: pump.x + ((car.x - pump.x) / toCar) * PUMP_STAND_OFF_M,
          z: pump.z + ((car.z - pump.z) / toCar) * PUMP_STAND_OFF_M,
        }
      : pump;
  const out = routeAroundCar(car, door, stand, body);
  const back = routeAroundCar(car, stand, door, body);
  const pumpSeconds =
    PUMP_BASE_SECONDS +
    PUMP_EXTRA_SECONDS * Math.min(1, Math.max(0, missingFuelFraction));
  return [
    {
      action: "show",
      path: [door],
      seconds: 0.35,
      face: headingTo(car, door),
      sound: "door",
    },
    { action: "walk", path: out, seconds: legSeconds(out, WALK_SPEED_MPS) },
    {
      action: "idle",
      seconds: pumpSeconds,
      face: headingTo(stand, car),
      sound: "pump_start",
      fuelWindow: true,
    },
    {
      action: "walk",
      path: back,
      seconds: legSeconds(back, WALK_SPEED_MPS),
      sound: "pump_stop",
    },
    { action: "hide", seconds: 0.45, sound: "door_close", carDip: true },
  ];
}

/**
 * The waiting rider walks from the kerb to the rear kerb-side door, pauses at
 * the handle, and ducks in.
 */
export function buildBoardScript(
  car: CutsceneCarPose,
  trafficSide: TrafficSide,
  riderSpot: WorldPoint,
  body: CutsceneBodyProfile = DEFAULT_CUTSCENE_BODY,
): CutsceneStep[] {
  const doorPoint = rearKerbDoorPoint(car, trafficSide, body);
  const approach = routeAroundCar(car, riderSpot, doorPoint, body);
  return [
    {
      action: "walk",
      path: approach,
      seconds: legSeconds(approach, WALK_SPEED_MPS),
    },
    {
      action: "idle",
      seconds: 0.55,
      face: headingTo(doorPoint, car),
      sound: "door",
    },
    { action: "hide", seconds: 0.5, sound: "door_close", carDip: true },
  ];
}

/**
 * The passenger steps out of the rear kerb-side door and walks a few metres
 * straight off that same kerb side before despawning.
 *
 * The target is deliberately car-relative rather than a fixed venue kerb spot.
 * The player parks wherever they stop, at any heading, so a fixed world point
 * can land across the car in its local frame — which made the passenger detour
 * back around the body ("walks away, then comes back"). Walking straight out
 * the door's own side is always a clean walk-off that never crosses the car,
 * whatever the park, and the scene cuts as soon as they have stepped clear.
 */
export function buildExitScript(
  car: CutsceneCarPose,
  trafficSide: TrafficSide,
  body: CutsceneBodyProfile = DEFAULT_CUTSCENE_BODY,
): CutsceneStep[] {
  const doorPoint = rearKerbDoorPoint(car, trafficSide, body);
  const lat = kerbLat(trafficSide, body);
  const away = toWorld(
    car,
    body.rearDoorForwardM,
    lat + (lat >= 0 ? EXIT_WANDER_M : -EXIT_WANDER_M),
  );
  const walk = [doorPoint, away];
  return [
    {
      action: "show",
      path: [doorPoint],
      seconds: 0.5,
      face: headingTo(car, doorPoint),
      sound: "door",
      carDip: true,
    },
    {
      action: "walk",
      path: walk,
      seconds: legSeconds(walk, WALK_SPEED_MPS),
      sound: "door_close",
    },
    { action: "hide", seconds: 0.2 },
  ];
}

/**
 * The delivery errand, both ends: driver jogs from their door to the venue
 * door / address building line, disappears inside for the dwell, jogs back and
 * gets in. Long forecourts hurry rather than drag (MAX_LEG_SECONDS).
 */
export function buildErrandScript(
  car: CutsceneCarPose,
  steeringSide: SteeringSide,
  buildingDoor: WorldPoint,
  dwellSeconds: number = STORE_DWELL_SECONDS,
  body: CutsceneBodyProfile = DEFAULT_CUTSCENE_BODY,
): CutsceneStep[] {
  const door = driverDoorPoint(car, steeringSide, body);
  const out = routeAroundCar(car, door, buildingDoor, body);
  const back = routeAroundCar(car, buildingDoor, door, body);
  return [
    {
      action: "show",
      path: [door],
      seconds: 0.35,
      face: headingTo(car, door),
      sound: "door",
    },
    {
      action: "run",
      path: out,
      seconds: legSeconds(out, RUN_SPEED_MPS),
      sound: "door_close",
    },
    { action: "hide", seconds: dwellSeconds },
    { action: "show", path: [buildingDoor], seconds: 0.15 },
    { action: "run", path: back, seconds: legSeconds(back, RUN_SPEED_MPS) },
    { action: "hide", seconds: 0.45, sound: "door_close", carDip: true },
  ];
}

/**
 * The bicycle's walk envelope: tiny, door-less. The "door" lateral is where
 * the rider dismounts to, just clear of the frame.
 */
export const BIKE_CUTSCENE_BODY: CutsceneBodyProfile = {
  bodyHalfLongM: 1.0,
  bodyHalfLatM: 0.35,
  clearLongM: 1.5,
  clearLatM: 0.9,
  doorLateralM: 0.6,
  frontDoorForwardM: 0.2,
  rearDoorForwardM: -0.3,
};

/**
 * The courier's errand on a bicycle: dismount beside the parked bike, run to
 * the venue door, dwell inside, run back and remount. No door sounds and no
 * suspension dip — a bike has neither; the session hides the rider on the
 * bike for the scene's duration so the walking actor reads as the same
 * person.
 */
export function buildBikeErrandScript(
  bike: CutsceneCarPose,
  buildingDoor: WorldPoint,
  dwellSeconds: number = STORE_DWELL_SECONDS,
  body: CutsceneBodyProfile = BIKE_CUTSCENE_BODY,
): CutsceneStep[] {
  const mount = toWorld(bike, 0, body.doorLateralM);
  const out = routeAroundCar(bike, mount, buildingDoor, body);
  const back = routeAroundCar(bike, buildingDoor, mount, body);
  return [
    {
      action: "show",
      path: [mount],
      seconds: 0.4,
      face: headingTo(bike, mount),
    },
    { action: "run", path: out, seconds: legSeconds(out, RUN_SPEED_MPS) },
    { action: "hide", seconds: dwellSeconds },
    { action: "show", path: [buildingDoor], seconds: 0.15 },
    { action: "run", path: back, seconds: legSeconds(back, RUN_SPEED_MPS) },
    { action: "hide", seconds: 0.35 },
  ];
}

/** Total running time of a script, for captions and safety timeouts. */
export function scriptSeconds(script: readonly CutsceneStep[]): number {
  let total = 0;
  for (const step of script) total += step.seconds;
  return total;
}

/**
 * The point the camera should frame alongside the car: the step point farthest
 * from it (the pump, the shop door), or the car itself for doorside-only
 * scripts.
 */
export function scriptFocusPoint(
  car: CutsceneCarPose,
  script: readonly CutsceneStep[],
): WorldPoint {
  let focus: WorldPoint = { x: car.x, z: car.z };
  let farthest = 0;
  for (const step of script) {
    for (const point of step.path ?? []) {
      const distance = Math.hypot(point.x - car.x, point.z - car.z);
      if (distance > farthest) {
        farthest = distance;
        focus = point;
      }
    }
  }
  return focus;
}
