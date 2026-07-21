// The route an ambient traffic car drives, walked off the lane graph's
// successor links. Renderer-agnostic on purpose: this is the thing that decides
// whether a car circulates for ever or drives into a corner and despawns, and
// that is a property of the map's authored turns, so it has to be assertable in
// a unit test rather than only visible from the driver's seat.

export interface NpcPathPoint {
  readonly x: number;
  readonly z: number;
}

export interface NpcPathLane {
  readonly id: string;
  readonly centerline: readonly NpcPathPoint[];
  readonly successors?: readonly string[];
}

export interface NpcPathSegment {
  readonly laneId: string;
  readonly start: NpcPathPoint;
  readonly end: NpcPathPoint;
  readonly length: number;
}

/** Hops before we stop extending a route, however much road is still ahead. */
export const NPC_PATH_MAX_HOPS = 24;
/** A successor must start where the previous lane ended, within this slack. */
const CONTINUITY_TOLERANCE_M = 2.5;

/**
 * Walks `successors` from `startLaneId`, taking the `branchOffset`-th choice at
 * each fork so different cars spread over different turns.
 *
 * A walk through a road network almost never returns to the exact lane it began
 * on — it rejoins itself somewhere in the middle, tracing a lollipop: a one-off
 * approach and then a circuit it can drive for ever. So `loop` says only "the
 * route closed on itself", and `loopStartSegment` says where the circuit began;
 * the car drives the approach once, then wraps to that segment rather than to
 * segment zero. Wrapping is seamless because the walk only ever follows a
 * successor whose first point coincides with the previous lane's last.
 *
 * `loop` is false when the walk instead ran out of successors, which is the map
 * telling us a driver could reach a junction with nowhere legal to go. The
 * caller despawns those cars and respawns them a couple of seconds later, which
 * from the driver's seat reads as traffic blinking out of existence.
 */
export function buildConnectedNpcPath(
  laneList: readonly NpcPathLane[],
  startLaneId: string,
  branchOffset: number,
): { segments: NpcPathSegment[]; loop: boolean; loopStartSegment: number } {
  const lanes = new Map(laneList.map((lane) => [lane.id, lane]));
  const segments: NpcPathSegment[] = [];
  const visited = new Set<string>();
  let laneId: string | undefined = startLaneId;
  let loop = false;
  let loopStartSegment = 0;
  for (let hop = 0; laneId && hop < NPC_PATH_MAX_HOPS; hop += 1) {
    const lane = lanes.get(laneId);
    if (!lane || lane.centerline.length < 2) break;
    if (visited.has(lane.id)) {
      const rejoin = segments.findIndex((segment) => segment.laneId === lane.id);
      loop = rejoin >= 0;
      loopStartSegment = Math.max(0, rejoin);
      break;
    }
    visited.add(lane.id);
    for (let index = 0; index < lane.centerline.length - 1; index += 1) {
      const start = lane.centerline[index];
      const end = lane.centerline[index + 1];
      const length = Math.hypot(end.x - start.x, end.z - start.z);
      if (length > 0.01) segments.push({ laneId: lane.id, start, end, length });
    }
    const successors = lane.successors ?? [];
    if (successors.length === 0) break;
    const successorId = successors[(branchOffset + hop) % successors.length];
    const successor = lanes.get(successorId);
    const last = segments.at(-1);
    const firstSuccessorPoint = successor?.centerline[0];
    if (
      !successor ||
      !last ||
      !firstSuccessorPoint ||
      Math.hypot(
        last.end.x - firstSuccessorPoint.x,
        last.end.z - firstSuccessorPoint.z,
      ) > CONTINUITY_TOLERANCE_M
    ) {
      break;
    }
    laneId = successorId;
  }
  return { segments, loop, loopStartSegment };
}
