/**
 * Lane-anchor resolution: the one function that turns an authored
 * `{laneId, distanceAlongM}` anchor into a world pose. Lives in its own leaf
 * module (no game imports) so every layer — the adapter, servicePoints,
 * the renderer and the app shell — can share the exact same placement math
 * without import cycles.
 */

export interface AnchorableLane {
  readonly id: string;
  readonly centerline: readonly { readonly x: number; readonly z: number }[];
}

export interface ResolvedSimulationAnchor {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly segmentIndex: number;
  readonly distanceOnSegment: number;
}

export function resolveSimulationLaneAnchor(
  lanes: readonly AnchorableLane[],
  anchor: { readonly laneId: string; readonly distanceAlongM: number },
): ResolvedSimulationAnchor | null {
  const lane = lanes.find((candidate) => candidate.id === anchor.laneId);
  if (!lane || lane.centerline.length < 2) return null;
  let remaining = Math.max(0, anchor.distanceAlongM);
  for (let index = 0; index < lane.centerline.length - 1; index += 1) {
    const start = lane.centerline[index];
    const end = lane.centerline[index + 1];
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    if (length < 0.001) continue;
    if (remaining <= length || index === lane.centerline.length - 2) {
      const distanceOnSegment = Math.min(remaining, length);
      const amount = distanceOnSegment / length;
      return {
        x: start.x + (end.x - start.x) * amount,
        z: start.z + (end.z - start.z) * amount,
        heading: Math.atan2(end.x - start.x, end.z - start.z),
        segmentIndex: index,
        distanceOnSegment,
      };
    }
    remaining -= length;
  }
  return null;
}
