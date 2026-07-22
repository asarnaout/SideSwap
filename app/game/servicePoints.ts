/**
 * Where a gas station's lot and its fuel pumps actually land in the world.
 *
 * The renderer places the station model set back from its anchored lane, so a
 * station's furniture is nowhere near the lane anchor itself — with the current
 * set-backs the pumps sit 19m or so from it. Anything that asks "is the car at
 * this station?" therefore has to resolve the same placement the renderer uses,
 * which is why that maths lives here rather than being repeated per caller.
 */
import type { WorldPoint } from "./types";
import { resolveSimulationLaneAnchor } from "./laneAnchors";

/**
 * The only lane fields anchor resolution needs. Both the authored `LaneSegment`
 * and the renderer's lighter `GameCanvasLane` satisfy this, so the renderer and
 * the HUD can share one placement implementation instead of each keeping its
 * own copy of the set-back maths.
 */
export interface AnchoredLane {
  readonly id: string;
  readonly centerline: readonly WorldPoint[];
}

/** Likewise the only service-point fields placement needs. */
export interface AnchoredServicePoint {
  readonly anchor: {
    readonly laneId: string;
    readonly distanceAlongM: number;
  };
  readonly setbackM?: number;
}

/** Fallback when a site does not tune its own set-back. */
export const DEFAULT_SERVICE_SETBACK_M = 16;

/** Mirrors PROP_MODEL_REGISTRY.gas_station in modelLibrary. */
const GAS_STATION_MODEL_SCALE = 2.8;
const GAS_STATION_YAW_OFFSET = Math.PI / 2;

/**
 * The four pump bodies, in the station model's own frame (model units, before
 * the 2.8x scale). Measured off the rendered scene rather than read off the
 * glb: the loader's handedness handling makes the model→world transform easy
 * to get subtly wrong, so these were recovered by inverting the placement for
 * three cities whose stations face three different ways (headings pi, pi/2 and
 * 0). All three yielded these same offsets to four decimal places, which is
 * what pins the transform below down. `gasStationPumpPositions` is covered by
 * tests asserting the world positions those three cities actually render.
 */
const GAS_STATION_PUMP_OFFSETS: readonly WorldPoint[] = [
  { x: 3.1946, z: 0.1875 },
  { x: 3.1946, z: 1.425 },
  { x: 0.5518, z: 1.425 },
  { x: 0.5518, z: 0.1875 },
];

/**
 * How close the car has to be to a pump for the refuel prompt to appear. The
 * pumps stand 3.46m apart across an island and 7.4m between islands, so this
 * covers a car drawn up at any one of them while still excluding the rest of
 * the forecourt — the shop is 9m from the nearest pump and the carriageway 19m.
 */
export const FUEL_PUMP_REACH_M = 5;

/** The pose the station model is placed at: lot centre plus its facing. */
export function resolveServicePointLot(
  lanes: readonly AnchoredLane[],
  service: AnchoredServicePoint,
): { readonly x: number; readonly z: number; readonly yaw: number } | null {
  const pose = resolveSimulationLaneAnchor(lanes, service.anchor);
  if (!pose) return null;
  const setback = service.setbackM ?? DEFAULT_SERVICE_SETBACK_M;
  // Set back along the right-hand normal of the lane, matching the renderer.
  return {
    x: pose.x + Math.cos(pose.heading) * setback,
    z: pose.z - Math.sin(pose.heading) * setback,
    yaw: pose.heading + GAS_STATION_YAW_OFFSET,
  };
}

/** World positions of the station's four fuel pumps. */
export function gasStationPumpPositions(
  lanes: readonly AnchoredLane[],
  service: AnchoredServicePoint,
): readonly WorldPoint[] {
  const lot = resolveServicePointLot(lanes, service);
  if (!lot) return [];
  const cos = Math.cos(lot.yaw);
  const sin = Math.sin(lot.yaw);
  return GAS_STATION_PUMP_OFFSETS.map((offset) => ({
    x: lot.x + GAS_STATION_MODEL_SCALE * (offset.x * cos + offset.z * sin),
    z: lot.z + GAS_STATION_MODEL_SCALE * (-offset.x * sin + offset.z * cos),
  }));
}

/** Metres from (x, z) to the station's nearest pump; Infinity if unresolvable. */
export function distanceToNearestPump(
  lanes: readonly AnchoredLane[],
  service: AnchoredServicePoint,
  x: number,
  z: number,
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const pump of gasStationPumpPositions(lanes, service)) {
    const distance = Math.hypot(x - pump.x, z - pump.z);
    if (distance < nearest) nearest = distance;
  }
  return nearest;
}
