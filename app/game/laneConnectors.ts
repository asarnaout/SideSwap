/**
 * Junction connector geometry for `laneTrue` lanes (issue #19).
 *
 * Every `laneTrue` lane keeps its lateral lane-line offset for its whole run,
 * but its endpoints sit on shared junction nodes so successor lanes stay
 * point-continuous. The original construction bridged that gap with a single
 * elbow point 0.5 m along the road axis: the lane darted ~1.7 m sideways onto
 * the node over half a metre, so the two connector segments pointed up to
 * ~74 degrees off the road axis. NPC heading is the raw centreline segment
 * direction, which turned every junction crossing into a visible spasm —
 * approach 0deg, snap -74deg, snap +164deg on the successor, snap +90deg
 * (issue #19's "90 one way, 180 the other, 90 back").
 *
 * This module replaces the elbow with a sampled S-curve: the lane leaves the
 * node along the road axis and eases onto its lane line over ~6 m with a
 * smoothstep lateral profile, so consecutive segment headings differ by ~10
 * degrees instead of ~74+. Lane endpoints are byte-identical to before —
 * successor continuity (0.01 m in tests, 0.5 m in the simulation) is untouched
 * — and the blend stays short enough that signal stop gates (authored 6 m
 * before the node) still sit on the straight lane line.
 *
 * Shared by `content.ts` and `londonContent.ts`, which otherwise carry private
 * copies of their lane builders.
 */
import type { WorldPoint } from "./types";

export interface LaneTrueGeometry {
  readonly centerline: readonly WorldPoint[];
  readonly startConnectorLengthM: number;
  readonly endConnectorLengthM: number;
  readonly totalLengthM: number;
}

/** Longitudinal run over which an end blend eases onto the lane line. */
export const CONNECTOR_BLEND_RUN_M = 6;
/** Segments per blend; keeps per-segment heading steps around 10 degrees. */
const CONNECTOR_BLEND_STEPS = 6;
/** Legacy elbow advance, used when a blend cannot fit. */
const CONNECTOR_LENGTH_M = 0.5;
/** Below this usable run a blend degenerates; fall back to the elbow. */
const MIN_BLEND_RUN_M = 1.5;
/**
 * A node this far off the target line is not a taper-scale offset — the
 * established path must start on a different alignment entirely, so an eased
 * blend would sweep a huge lateral. Fall back to the elbow.
 */
const MAX_BLEND_LATERAL_M = 3.5;
/** Consecutive centreline points closer than this collapse into one. */
const DUPLICATE_EPSILON_M = 0.01;
/**
 * Arc length recorded as each lane's `connectorRange`: the span inside the
 * junction's compact conflict zone (2.1 m half-width), not the whole blend.
 */
const NODE_CONNECTOR_SPAN_M = 2;

const point = (x: number, z: number): WorldPoint => ({ x, z });

const distanceBetween = (a: WorldPoint, b: WorldPoint): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

const smoothstep01 = (t: number): number => t * t * (3 - 2 * t);

interface ConnectorBlend {
  /** Blend points in path order away from the node, node itself excluded. */
  readonly samples: readonly WorldPoint[];
  /** Whether the blend lands past `lineStart`, which must then be dropped. */
  readonly coversLineStart: boolean;
}

/**
 * Samples the S-curve carrying a lane from its shared junction node onto its
 * lane line. `lineStart` and `lineToward` are the first two points of the
 * line the blend must land on tangentially — the established path's own first
 * segment when it has one, else the legacy elbow point and the single
 * established point beyond it. Returns null when the straight run available
 * on the line is too short for a blend.
 */
function connectorBlendSamples(
  nodePosition: WorldPoint,
  lineStart: WorldPoint,
  lineToward: WorldPoint,
): ConnectorBlend | null {
  const dirX = lineToward.x - lineStart.x;
  const dirZ = lineToward.z - lineStart.z;
  const dirLength = Math.hypot(dirX, dirZ);
  if (dirLength < MIN_BLEND_RUN_M) return null;
  const ux = dirX / dirLength;
  const uz = dirZ / dirLength;
  // Split the node into its projection on the lane line plus a lateral offset.
  const footT =
    (nodePosition.x - lineStart.x) * ux + (nodePosition.z - lineStart.z) * uz;
  const footX = lineStart.x + ux * footT;
  const footZ = lineStart.z + uz * footT;
  const lateralX = nodePosition.x - footX;
  const lateralZ = nodePosition.z - footZ;
  if (Math.hypot(lateralX, lateralZ) > MAX_BLEND_LATERAL_M) return null;
  // Usable straight run from the node's foot toward the established path; the
  // blend must finish before the line itself may bend at `lineToward`.
  const run = (lineToward.x - footX) * ux + (lineToward.z - footZ) * uz;
  const blendRun = Math.min(CONNECTOR_BLEND_RUN_M, run - 0.25);
  if (blendRun < MIN_BLEND_RUN_M) return null;
  const samples: WorldPoint[] = [];
  for (let step = 1; step <= CONNECTOR_BLEND_STEPS; step += 1) {
    const t = step / CONNECTOR_BLEND_STEPS;
    const lateral = 1 - smoothstep01(t);
    samples.push(
      point(
        footX + ux * blendRun * t + lateralX * lateral,
        footZ + uz * blendRun * t + lateralZ * lateral,
      ),
    );
  }
  const lineStartT = -footT;
  return { samples, coversLineStart: lineStartT <= blendRun };
}

/**
 * Builds a `laneTrue` centreline — shared node endpoints, blended connectors,
 * established lane line between — plus the connector-range lengths the lane
 * metadata records. Endpoints are exactly `fromPosition`/`toPosition`.
 */
export function buildLaneTrueGeometry(
  fromPosition: WorldPoint,
  toPosition: WorldPoint,
  establishedPath: readonly WorldPoint[],
): LaneTrueGeometry {
  const first = establishedPath[0];
  const last = establishedPath.at(-1)!;
  const dominantHorizontal =
    Math.abs(toPosition.x - fromPosition.x) >=
    Math.abs(toPosition.z - fromPosition.z);
  const directionX = Math.sign(toPosition.x - fromPosition.x);
  const directionZ = Math.sign(toPosition.z - fromPosition.z);
  const startEstablished =
    distanceBetween(fromPosition, first) <= 2
      ? first
      : dominantHorizontal
        ? point(fromPosition.x + directionX * CONNECTOR_LENGTH_M, first.z)
        : point(first.x, fromPosition.z + directionZ * CONNECTOR_LENGTH_M);
  const endEstablished =
    distanceBetween(toPosition, last) <= 2
      ? last
      : dominantHorizontal
        ? point(toPosition.x - directionX * CONNECTOR_LENGTH_M, last.z)
        : point(last.x, toPosition.z - directionZ * CONNECTOR_LENGTH_M);

  // Blend onto the established path's own first/last segment when it has one;
  // a single-point path only defines its line together with the elbow point.
  // When both ends share the same two-point segment, each blend is capped at
  // its midpoint so the two can never cross.
  const multiPoint = establishedPath.length >= 2;
  const sharedSegmentMidpoint =
    establishedPath.length === 2
      ? point((first.x + last.x) / 2, (first.z + last.z) / 2)
      : null;
  const entryBlend = multiPoint
    ? connectorBlendSamples(
        fromPosition,
        first,
        sharedSegmentMidpoint ?? establishedPath[1],
      )
    : startEstablished === first
      ? null
      : connectorBlendSamples(fromPosition, startEstablished, first);
  const exitBlend = multiPoint
    ? connectorBlendSamples(
        toPosition,
        last,
        sharedSegmentMidpoint ?? establishedPath[establishedPath.length - 2],
      )
    : endEstablished === last
      ? null
      : connectorBlendSamples(toPosition, endEstablished, last);

  const entryPoints = entryBlend
    ? [...entryBlend.samples]
    : [startEstablished];
  const exitPoints = exitBlend
    ? [...exitBlend.samples].reverse()
    : [endEstablished];
  // A blend that lands past the established endpoint replaces it — keeping it
  // would double back along the line. Single-point paths always keep their
  // point: their blend is capped to land short of it.
  const middlePoints = establishedPath.slice(
    multiPoint && entryBlend?.coversLineStart ? 1 : 0,
    multiPoint && exitBlend?.coversLineStart
      ? establishedPath.length - 1
      : establishedPath.length,
  );
  const entryJoin = entryPoints[entryPoints.length - 1];
  const exitJoin = exitPoints[0];

  const centerline: WorldPoint[] = [];
  for (const candidate of [
    fromPosition,
    ...entryPoints,
    ...middlePoints,
    ...exitPoints,
    toPosition,
  ]) {
    const previous = centerline[centerline.length - 1];
    if (previous && distanceBetween(previous, candidate) < DUPLICATE_EPSILON_M) {
      continue;
    }
    centerline.push(candidate);
  }

  const prefix: number[] = [0];
  for (let index = 1; index < centerline.length; index += 1) {
    prefix.push(
      prefix[index - 1] +
        distanceBetween(centerline[index - 1], centerline[index]),
    );
  }
  const totalLengthM = prefix[prefix.length - 1];
  // The recorded connector ranges keep the original contract — the short span
  // of lane inside the junction's compact conflict zone (<= 2 m of the node)
  // — rather than the whole eased blend. The zones gate crossing-priority
  // behaviour in the simulation, so the ranges must not outgrow them.
  const entryJoinIndex = centerline.indexOf(entryJoin);
  const exitJoinIndex = centerline.lastIndexOf(exitJoin);
  const startConnectorLengthM = Math.min(
    NODE_CONNECTOR_SPAN_M,
    entryJoinIndex >= 0 ? prefix[entryJoinIndex] : 0,
  );
  const endConnectorLengthM = Math.min(
    NODE_CONNECTOR_SPAN_M,
    exitJoinIndex >= 0 ? totalLengthM - prefix[exitJoinIndex] : 0,
  );

  return { centerline, startConnectorLengthM, endConnectorLengthM, totalLengthM };
}
