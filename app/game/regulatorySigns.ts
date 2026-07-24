/**
 * Regulatory sign placement for one-way roads, derived from the lane graph.
 *
 * The simulation already fines wrong-way driving, but the world gave the
 * driver none of the cues a real street does — so at a junction there was no
 * way to tell a legal turn from a wrong-way one. This module derives the
 * MUTCD sign set every US one-way street carries, straight from the same
 * lanes the rules run on, so signage can never disagree with enforcement:
 *
 * - ONE WAY blades at every mouth where a one-way road may be entered,
 * - DO NOT ENTER pairs at every mouth where it may not,
 * - WRONG WAY repeater pairs facing down each one-way block, readable only
 *   against the flow — a legal driver only ever sees their gray backs.
 *
 * Lane endpoints sit exactly on shared junction nodes, so incident lane-ends
 * cluster into junction "arms" (per road, per direction). An arm with only
 * departing lanes is an enterable one-way mouth; only arriving lanes, a
 * forbidden one; both, an ordinary two-way road that needs nothing.
 */
import type { WorldPoint } from "./types";

export type RegulatorySignKind = "one_way" | "do_not_enter" | "wrong_way";

export interface RegulatorySignPlacement {
  readonly kind: RegulatorySignKind;
  readonly x: number;
  readonly z: number;
  /**
   * Heading (rad, 0 = +z north) of legal travel on the arm's road at the
   * sign. DO NOT ENTER / WRONG WAY message faces point along it (into the
   * junction / at the wrong-way driver); ONE WAY arrows point along it.
   */
  readonly flowHeadingRad: number;
  /** Stable id for tests and QA, e.g. "nyc-amsterdam@40,0:dne:l". */
  readonly refId: string;
}

export interface RegulatorySignLaneInput {
  readonly id: string;
  readonly roadId?: string;
  readonly role?: string;
  readonly centerline: readonly WorldPoint[];
}

export interface RegulatorySignSurfaceInput {
  readonly widthM: number;
  readonly laneIds: readonly string[];
}

export interface RegulatorySignInput {
  readonly lanes: readonly RegulatorySignLaneInput[];
  readonly roadSurfaces?: readonly RegulatorySignSurfaceInput[];
  /** Carriageway width used when no surface lists an arm's lanes. */
  readonly defaultRoadWidthM: number;
}

/** Longitudinal distance from the junction node to a mouth sign post. */
const MOUTH_OFFSET_M = 10;
/** Posts stand this far past the kerb (carriageway edge), on the sidewalk. */
const KERB_MARGIN_M = 0.9;
/** First WRONG WAY station past a forbidden mouth. */
const WRONG_WAY_NEAR_M = 35;
/** Blocks longer than this also get a mid-block WRONG WAY station. */
const WRONG_WAY_MIDBLOCK_MIN_M = 320;
/** Shared-node tolerance, matching the map's 0.08 m authoring convention. */
const NODE_EPSILON_M = 0.08;

const TWO_PI = Math.PI * 2;

const normalizeRad = (angle: number): number => {
  let wrapped = angle % TWO_PI;
  if (wrapped > Math.PI) wrapped -= TWO_PI;
  if (wrapped <= -Math.PI) wrapped += TWO_PI;
  return wrapped;
};

/**
 * Mesh `rotation.y` for a placement. DO NOT ENTER / WRONG WAY carry their
 * message on the box's -Z face, so the mesh faces away from the flow and the
 * -Z normal points along it; ONE WAY blades hang perpendicular, the -Z face
 * reading left-arrow to one side of the road and the +Z face right-arrow to
 * the other.
 */
export function regulatorySignYawRad(
  kind: RegulatorySignKind,
  flowHeadingRad: number,
): number {
  return normalizeRad(
    kind === "one_way" ? flowHeadingRad + Math.PI / 2 : flowHeadingRad + Math.PI,
  );
}

interface LaneEnd {
  readonly lane: RegulatorySignLaneInput;
  /** True when the lane departs the node (its centerline starts here). */
  readonly departing: boolean;
  /** The lane's opposite endpoint — the far end of the arm. */
  readonly opposite: WorldPoint;
}

const nodeKey = (point: WorldPoint): string =>
  `${Math.round(point.x / NODE_EPSILON_M)}:${Math.round(point.z / NODE_EPSILON_M)}`;

export function regulatorySignPlacements(
  input: RegulatorySignInput,
): readonly RegulatorySignPlacement[] {
  const nodes = new Map<string, { position: WorldPoint; ends: LaneEnd[] }>();
  const addEnd = (position: WorldPoint, end: LaneEnd) => {
    const key = nodeKey(position);
    const existing = nodes.get(key);
    if (existing) existing.ends.push(end);
    else nodes.set(key, { position, ends: [end] });
  };
  // Roundabouts and turning loops are one-way by construction and carry
  // their own signage conventions — skip every node they touch, not just
  // their lanes, so their entry/exit arms don't sprout mouth signs either.
  const roundaboutNodes = new Set<string>();
  for (const lane of input.lanes) {
    if (lane.role !== "roundabout" || lane.centerline.length < 2) continue;
    roundaboutNodes.add(nodeKey(lane.centerline[0]));
    roundaboutNodes.add(nodeKey(lane.centerline[lane.centerline.length - 1]));
  }
  for (const lane of input.lanes) {
    if (lane.role === "roundabout") continue;
    if (lane.centerline.length < 2) continue;
    const start = lane.centerline[0];
    const end = lane.centerline[lane.centerline.length - 1];
    if (nodeKey(start) === nodeKey(end)) continue; // self-loop
    if (!roundaboutNodes.has(nodeKey(start))) {
      addEnd(start, { lane, departing: true, opposite: end });
    }
    if (!roundaboutNodes.has(nodeKey(end))) {
      addEnd(end, { lane, departing: false, opposite: start });
    }
  }

  const widthFor = (arm: readonly LaneEnd[]): number => {
    for (const surface of input.roadSurfaces ?? []) {
      if (arm.some((end) => surface.laneIds.includes(end.lane.id))) {
        return surface.widthM;
      }
    }
    return input.defaultRoadWidthM;
  };

  const placements: RegulatorySignPlacement[] = [];
  for (const node of nodes.values()) {
    const arms = new Map<string, LaneEnd[]>();
    for (const end of node.ends) {
      const bearing = Math.atan2(
        end.opposite.x - node.position.x,
        end.opposite.z - node.position.z,
      );
      // Bucket by the direction to the far endpoint — exact for straight
      // arms, and immune to the connector blend's local tilt near the node.
      const bucket =
        ((Math.round(bearing / (Math.PI / 4)) % 8) + 8) % 8;
      const key = `${end.lane.roadId ?? end.lane.id}|${bucket}`;
      const arm = arms.get(key);
      if (arm) arm.push(end);
      else arms.set(key, [end]);
    }
    // Mouth signs only make sense where roads actually meet — a mid-road
    // node linking two blocks of the same road offers no turn to warn about.
    const roadIds = new Set(
      node.ends.map((end) => end.lane.roadId ?? end.lane.id),
    );
    if (roadIds.size < 2) continue;

    for (const arm of arms.values()) {
      const departing = arm.some((end) => end.departing);
      const arriving = arm.some((end) => !end.departing);
      if (departing === arriving) continue; // two-way (or empty) — no signs
      const sorted = [...arm].sort((a, b) => a.lane.id.localeCompare(b.lane.id));
      const reference = sorted[0];
      const armDx = reference.opposite.x - node.position.x;
      const armDz = reference.opposite.z - node.position.z;
      const armLength = Math.hypot(armDx, armDz);
      if (armLength < MOUTH_OFFSET_M * 2) continue;
      const ux = armDx / armLength;
      const uz = armDz / armLength;
      const armHeading = Math.atan2(ux, uz);
      const lateral = widthFor(arm) / 2 + KERB_MARGIN_M;
      // Right normal of the arm axis; the two kerbs sit at +/- lateral.
      const rx = Math.cos(armHeading);
      const rz = -Math.sin(armHeading);
      const roadId = reference.lane.roadId ?? reference.lane.id;
      const nodeRef = `${roadId}@${Math.round(node.position.x * 10) / 10},${Math.round(node.position.z * 10) / 10}`;
      const post = (
        kind: RegulatorySignKind,
        distance: number,
        flowHeadingRad: number,
        suffix: string,
      ) => {
        for (const side of [-1, 1] as const) {
          placements.push({
            kind,
            x: node.position.x + ux * distance + rx * lateral * side,
            z: node.position.z + uz * distance + rz * lateral * side,
            flowHeadingRad,
            refId: `${nodeRef}:${suffix}:${side < 0 ? "l" : "r"}`,
          });
        }
      };
      if (departing) {
        // Enterable one-way mouth: blades tell cross traffic the only legal
        // direction, which here points away from the junction.
        post("one_way", MOUTH_OFFSET_M, armHeading, "oneway");
        continue;
      }
      // Forbidden mouth: flow arrives along the arm, so legal travel at the
      // mouth points INTO the junction — and so do the message faces.
      const flowHeading = normalizeRad(armHeading + Math.PI);
      post("do_not_enter", MOUTH_OFFSET_M, flowHeading, "dne");
      post("wrong_way", WRONG_WAY_NEAR_M, flowHeading, `ww${WRONG_WAY_NEAR_M}`);
      if (armLength > WRONG_WAY_MIDBLOCK_MIN_M) {
        const midBlock = Math.round(armLength / 2);
        post("wrong_way", armLength / 2, flowHeading, `ww${midBlock}`);
      }
    }
  }
  return placements.sort((a, b) => a.refId.localeCompare(b.refId));
}
