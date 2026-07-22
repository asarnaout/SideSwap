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

/** Door positions in the car's local frame (long forward, lat driver-right). */
const DOOR_LATERAL_M = 1.25;
const FRONT_DOOR_FORWARD_M = 0.35;
const REAR_DOOR_FORWARD_M = -0.55;

/** The body rectangle walk paths must stay out of, and the waypoint ring used
 * to skirt it. Doors sit at |lat| 1.25 — just outside the body half-width. */
const BODY_HALF_LONG_M = 2.45;
const BODY_HALF_LAT_M = 1.1;
const CLEAR_LONG_M = 3.1;
const CLEAR_LAT_M = 1.7;

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
function segmentCrossesBody(a: LocalPoint, b: LocalPoint): boolean {
  const dLong = b.long - a.long;
  const dLat = b.lat - a.lat;
  let t0 = 0;
  let t1 = 1;
  const clips: readonly (readonly [number, number])[] = [
    [-dLong, a.long + BODY_HALF_LONG_M],
    [dLong, BODY_HALF_LONG_M - a.long],
    [-dLat, a.lat + BODY_HALF_LAT_M],
    [dLat, BODY_HALF_LAT_M - a.lat],
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
): WorldPoint[] {
  const a = toLocal(car, from);
  const b = toLocal(car, to);
  if (!segmentCrossesBody(a, b)) return [from, to];
  const endLong = a.long + b.long >= 0 ? CLEAR_LONG_M : -CLEAR_LONG_M;
  const sideA = a.lat >= 0 ? CLEAR_LAT_M : -CLEAR_LAT_M;
  const sideB = b.lat >= 0 ? CLEAR_LAT_M : -CLEAR_LAT_M;
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

const driverLat = (steeringSide: SteeringSide): number =>
  steeringSide === "left" ? -DOOR_LATERAL_M : DOOR_LATERAL_M;

/** The kerb is opposite the traffic side: right-hand traffic parks with its
 * right flank to the kerb. */
const kerbLat = (trafficSide: TrafficSide): number =>
  trafficSide === "right" ? DOOR_LATERAL_M : -DOOR_LATERAL_M;

export function driverDoorPoint(
  car: CutsceneCarPose,
  steeringSide: SteeringSide,
): WorldPoint {
  return toWorld(car, FRONT_DOOR_FORWARD_M, driverLat(steeringSide));
}

export function rearKerbDoorPoint(
  car: CutsceneCarPose,
  trafficSide: TrafficSide,
): WorldPoint {
  return toWorld(car, REAR_DOOR_FORWARD_M, kerbLat(trafficSide));
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
): CutsceneStep[] {
  const door = driverDoorPoint(car, steeringSide);
  const toCar = Math.hypot(car.x - pump.x, car.z - pump.z);
  const stand =
    toCar > 0.001
      ? {
          x: pump.x + ((car.x - pump.x) / toCar) * PUMP_STAND_OFF_M,
          z: pump.z + ((car.z - pump.z) / toCar) * PUMP_STAND_OFF_M,
        }
      : pump;
  const out = routeAroundCar(car, door, stand);
  const back = routeAroundCar(car, stand, door);
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
): CutsceneStep[] {
  const doorPoint = rearKerbDoorPoint(car, trafficSide);
  const approach = routeAroundCar(car, riderSpot, doorPoint);
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
 * The passenger steps out of the rear kerb-side door and wanders to the kerb
 * spot (or a few metres kerbward when the stop has none) before despawning.
 */
export function buildExitScript(
  car: CutsceneCarPose,
  trafficSide: TrafficSide,
  kerbSpot: WorldPoint | null,
): CutsceneStep[] {
  const doorPoint = rearKerbDoorPoint(car, trafficSide);
  const lat = kerbLat(trafficSide);
  const fallback = toWorld(
    car,
    REAR_DOOR_FORWARD_M,
    lat + (lat >= 0 ? EXIT_WANDER_M : -EXIT_WANDER_M),
  );
  const away = routeAroundCar(car, doorPoint, kerbSpot ?? fallback);
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
      path: away,
      seconds: legSeconds(away, WALK_SPEED_MPS),
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
): CutsceneStep[] {
  const door = driverDoorPoint(car, steeringSide);
  const out = routeAroundCar(car, door, buildingDoor);
  const back = routeAroundCar(car, buildingDoor, door);
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
