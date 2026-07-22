// Where a pedestrian is allowed to walk: one rail down the middle of each
// pavement band, one band per side of every carriageway, trimmed back at every
// junction and reconnected around each street corner. Renderer-agnostic on
// purpose — whether a walker can round a corner without stepping into the
// carriageway is a property of the authored roads, so it has to be assertable
// in a unit test rather than only visible from the driver's seat.
//
// A little junction math is deliberately duplicated from GameCanvas.tsx
// (normalising, node clustering, the kerb-corner intersection): GameCanvas
// imports this module, so importing back would be a cycle. A parity test pins
// the duplicate to `collectRoadJunctionFills` on the real maps.

export interface PavementPoint {
  readonly x: number;
  readonly z: number;
}

export interface PavementSurface {
  readonly id: string;
  readonly centerline: readonly PavementPoint[];
  readonly widthM: number;
}

export interface PavementConfig {
  /** Width of the walkable band flanking each carriageway. */
  readonly sidewalkWidthM: number;
  /** Centreline points closer than this share a junction node. */
  readonly nodeEpsilonM?: number;
  /** How generously a walker's path rounds a street corner. */
  readonly kerbRadiusM?: number;
}

export interface PavementNode {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly edgeIds: readonly number[];
}

export interface PavementEdge {
  readonly id: number;
  /** Node ids; a ring edge has a === b and wraps rather than turning. */
  readonly a: number;
  readonly b: number;
  readonly points: readonly PavementPoint[];
  /** Arclength at each point; cumulativeM.at(-1) === lengthM. */
  readonly cumulativeM: readonly number[];
  readonly lengthM: number;
  readonly closed: boolean;
}

export interface PavementGraph {
  readonly nodes: readonly PavementNode[];
  readonly edges: readonly PavementEdge[];
  /** Junction cluster centres (two or more surfaces sharing a node). */
  readonly junctions: readonly PavementPoint[];
}

const DEFAULT_NODE_EPSILON_M = 0.08;
const DEFAULT_KERB_RADIUS_M = 1.5;
const CORNER_ARC_STEPS = 3;
/** Mirror of MAX_ROAD_MITER_RATIO: past this a hairpin miter becomes a spike. */
const MAX_MITER_RATIO = 3.25;
/** Corners tighter than this get a bare point instead of a fillet arc. */
const MIN_FILLET_WEDGE_RAD = (30 * Math.PI) / 180;
const MIN_EDGE_LENGTH_M = 0.05;
const NODE_MERGE_EPSILON_M = 0.05;

interface Direction {
  readonly x: number;
  readonly z: number;
}

function pointDistance(a: PavementPoint, b: PavementPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function normalizeDirection(vector: Direction): Direction | null {
  const length = Math.hypot(vector.x, vector.z);
  return length > 0.0001
    ? { x: vector.x / length, z: vector.z / length }
    : null;
}

/** Right-hand normal; faces the next leg round a node in heading order. */
function lateralOf(direction: Direction): Direction {
  return { x: direction.z, z: -direction.x };
}

function dot(first: Direction, second: Direction): number {
  return first.x * second.x + first.z * second.z;
}

/** One prepared surface: normalised points plus arclength bookkeeping. */
interface Rail {
  readonly id: string;
  readonly points: readonly PavementPoint[];
  readonly closed: boolean;
  readonly railOffset: number;
  readonly carriagewayHalf: number;
  readonly segmentDirs: readonly Direction[];
  /** Arclength at each point; for closed surfaces `length` includes the wrap. */
  readonly cumulative: readonly number[];
  readonly length: number;
}

function prepareSurface(
  surface: PavementSurface,
  sidewalkWidthM: number,
  epsilon: number,
): Rail | null {
  // Mirror of GameCanvas's normalizeRoadCenterline: compact near-duplicates,
  // detect closure, pop the duplicate closing point.
  const compact: PavementPoint[] = [];
  for (const point of surface.centerline) {
    if (!compact.length || pointDistance(compact.at(-1)!, point) > epsilon) {
      compact.push(point);
    }
  }
  const closed =
    compact.length > 2 && pointDistance(compact[0], compact.at(-1)!) <= epsilon;
  if (closed) compact.pop();
  if (compact.length < 2) return null;

  const segmentCount = closed ? compact.length : compact.length - 1;
  const segmentDirs: Direction[] = [];
  const cumulative: number[] = [0];
  for (let index = 0; index < segmentCount; index += 1) {
    const start = compact[index];
    const end = compact[(index + 1) % compact.length];
    const direction = normalizeDirection({ x: end.x - start.x, z: end.z - start.z });
    if (!direction) return null;
    segmentDirs.push(direction);
    if (index < compact.length - 1) {
      cumulative.push(cumulative[index] + pointDistance(start, end));
    }
  }
  const length = closed
    ? cumulative.at(-1)! + pointDistance(compact.at(-1)!, compact[0])
    : cumulative.at(-1)!;
  return {
    id: surface.id,
    points: compact,
    closed,
    railOffset: surface.widthM / 2 + sidewalkWidthM / 2,
    carriagewayHalf: surface.widthM / 2,
    segmentDirs,
    cumulative,
    length,
  };
}

/** The flat-offset rail point at centreline arclength `t`, side `sigma`. */
function offsetPointAt(rail: Rail, sigma: 1 | -1, t: number): PavementPoint {
  let param = t;
  if (rail.closed) {
    param = ((param % rail.length) + rail.length) % rail.length;
  } else {
    param = Math.min(Math.max(param, 0), rail.length);
  }
  let segment = rail.cumulative.length - 1;
  while (segment > 0 && rail.cumulative[segment] > param) segment -= 1;
  if (!rail.closed) segment = Math.min(segment, rail.points.length - 2);
  const segmentStart = rail.cumulative[segment];
  const segmentEnd =
    segment < rail.cumulative.length - 1 ? rail.cumulative[segment + 1] : rail.length;
  const span = segmentEnd - segmentStart;
  const local = span > 1e-9 ? (param - segmentStart) / span : 0;
  const start = rail.points[segment];
  const end = rail.points[(segment + 1) % rail.points.length];
  const lateral = lateralOf(rail.segmentDirs[segment]);
  return {
    x: start.x + (end.x - start.x) * local + lateral.x * sigma * rail.railOffset,
    z: start.z + (end.z - start.z) * local + lateral.z * sigma * rail.railOffset,
  };
}

/** The mitred rail point at interior vertex `index` — same scheme (and clamp)
 * as buildRoadSurfaceStripGeometry, so rails hug curves like the strips do. */
function mitredVertex(rail: Rail, sigma: 1 | -1, index: number): PavementPoint {
  const count = rail.segmentDirs.length;
  const incoming = rail.closed
    ? rail.segmentDirs[(index - 1 + count) % count]
    : rail.segmentDirs[Math.max(0, index - 1)];
  const outgoing = rail.closed
    ? rail.segmentDirs[index % count]
    : rail.segmentDirs[Math.min(index, count - 1)];
  const incomingLateral = lateralOf(incoming);
  const outgoingLateral = lateralOf(outgoing);
  const miter = normalizeDirection({
    x: incomingLateral.x + outgoingLateral.x,
    z: incomingLateral.z + outgoingLateral.z,
  });
  const alignment = miter ? dot(miter, outgoingLateral) : 0;
  const offset = rail.railOffset;
  const miterLength =
    miter && alignment > 0.12
      ? Math.min(offset / alignment, offset * MAX_MITER_RATIO)
      : offset;
  const lateral = miter
    ? { x: miter.x * miterLength, z: miter.z * miterLength }
    : { x: outgoingLateral.x * offset, z: outgoingLateral.z * offset };
  const point = rail.points[index];
  return { x: point.x + lateral.x * sigma, z: point.z + lateral.z * sigma };
}

/** One carriageway leaving a junction node, as the pavement sees it. */
interface PavementLeg {
  readonly rail: Rail;
  /** The leg's own centreline point. Usually the cluster centre, but a road
   * whose authored end sits slightly off the shared node (Cromwell Road's
   * recentred dual carriageway) keeps its own origin so the rail-line corner
   * math stays exact. */
  readonly origin: PavementPoint;
  readonly direction: Direction;
  readonly lateral: Direction;
  readonly half: number;
  /** Surface side that lies on this leg's +lateral flank (−1 for the leg that
   * walks the centreline backwards, whose left is the surface's right). */
  readonly plusSigma: 1 | -1;
  /** Centreline arclength of the node this leg leaves. */
  readonly tNode: number;
  /** Straight-line distance to the neighbouring centreline point. */
  readonly neighbourDist: number;
  /** Arclength gap to the next junction in this leg's direction (∞ if none). */
  readonly junctionGap: number;
  /** How far along the leg the rails are trimmed back; set once the cluster's
   * legs are known, because an acute crossing needs a longer run-up than a
   * perpendicular one before its rail clears the diagonal carriageway. */
  reach: number;
  /** Centreline arclength of the leg's trim point (tNode ± reach). */
  tCut: number;
}

/** One surface's presence at a junction: where it sits along its own
 * arclength and which way its carriageway leaves the node. Usually an
 * authored vertex; a "virtual" member is a surface another road's vertex
 * lands on mid-segment, which has no authored point of its own there. */
interface ClusterMember {
  readonly rail: Rail;
  readonly t: number;
  readonly origin: PavementPoint;
  /** Authored point index; virtual mid-segment members have none. */
  readonly pointIndex?: number;
  readonly arms: Array<{
    readonly direction: Direction;
    readonly forward: boolean;
    readonly neighbourDist: number;
  }>;
}

interface Cluster {
  x: number;
  z: number;
  readonly surfaceIds: Set<string>;
  maxRailHalf: number;
  maxCarriagewayHalf: number;
  readonly members: ClusterMember[];
  legs: PavementLeg[];
  /** One leg per physical carriageway direction — coincident legs (a road
   * stretch authored twice) collapse to the widest, so corner links pair
   * across real corners instead of between the duplicates. */
  pairing: PavementLeg[];
}

/**
 * Where leg `a`'s +lateral rail line meets leg `b`'s −lateral rail line, as a
 * distance along each leg from its origin. Mirror of junctionKerbCorner with
 * the carriageway half-width swapped for the rail offset (plus each leg's own
 * origin, which differ when an authored road end sits off the shared node):
 * both positive is a street corner in front of the node, both negative the
 * squared-off outside of a bend, null two parallel rails that never meet.
 */
function railCorner(
  a: PavementLeg,
  b: PavementLeg,
): { alongA: number; alongB: number } | null {
  const offsetX =
    b.origin.x - a.origin.x - b.lateral.x * b.half - a.lateral.x * a.half;
  const offsetZ =
    b.origin.z - a.origin.z - b.lateral.z * b.half - a.lateral.z * a.half;
  const determinant = b.direction.x * a.direction.z - a.direction.x * b.direction.z;
  if (Math.abs(determinant) < 1e-6) return null;
  return {
    alongA: (b.direction.x * offsetZ - offsetX * b.direction.z) / determinant,
    alongB: (a.direction.x * offsetZ - offsetX * a.direction.z) / determinant,
  };
}

/**
 * The walker's path from leg `a`'s pavement round to leg `b`'s: a fillet arc
 * at a street corner, the squared-off miter on the outside of a bend, and a
 * straight link when the rails run parallel (the far side of a T-junction,
 * where the pavement simply carries on across the stem's mouth).
 */
function cornerLinkPoints(
  a: PavementLeg,
  b: PavementLeg,
  kerbRadiusM: number,
): PavementPoint[] {
  const entry = offsetPointAt(a.rail, a.plusSigma, a.tCut);
  const exit = offsetPointAt(b.rail, (-b.plusSigma) as 1 | -1, b.tCut);
  const at = (leg: PavementLeg, lateralSign: number, along: number) => ({
    x: leg.origin.x + leg.lateral.x * leg.half * lateralSign + leg.direction.x * along,
    z: leg.origin.z + leg.lateral.z * leg.half * lateralSign + leg.direction.z * along,
  });
  const straight = [entry, exit];
  const meeting = railCorner(a, b);
  if (!meeting) return straight;
  if (meeting.alongA <= 1e-3 && meeting.alongB <= 1e-3) {
    const miter = at(a, 1, meeting.alongA);
    return Math.hypot(miter.x - a.origin.x, miter.z - a.origin.z) <=
      Math.min(a.half, b.half) * MAX_MITER_RATIO
      ? [entry, miter, exit]
      : straight;
  }
  if (meeting.alongA <= 1e-3 || meeting.alongB <= 1e-3) return straight;
  if (meeting.alongA > a.reach - 0.05 || meeting.alongB > b.reach - 0.05) {
    return straight;
  }
  const corner = at(a, 1, meeting.alongA);
  const wedge = Math.acos(Math.min(1, Math.max(-1, dot(a.direction, b.direction))));
  const tangent = Math.tan(wedge / 2);
  const radius = Math.min(
    kerbRadiusM,
    // The arc's tangent points have to stay between the corner and each trim.
    (a.reach - meeting.alongA) * tangent,
    (b.reach - meeting.alongB) * tangent,
  );
  if (wedge < MIN_FILLET_WEDGE_RAD || radius < 0.15) return [entry, corner, exit];
  const setback = radius / tangent;
  const bisector = normalizeDirection({
    x: a.direction.x + b.direction.x,
    z: a.direction.z + b.direction.z,
  });
  if (!bisector) return [entry, corner, exit];
  const centreX = corner.x + (bisector.x * radius) / Math.sin(wedge / 2);
  const centreZ = corner.z + (bisector.z * radius) / Math.sin(wedge / 2);
  const start = {
    x: corner.x + a.direction.x * setback,
    z: corner.z + a.direction.z * setback,
  };
  const end = {
    x: corner.x + b.direction.x * setback,
    z: corner.z + b.direction.z * setback,
  };
  const startAngle = Math.atan2(start.z - centreZ, start.x - centreX);
  let sweep = Math.atan2(end.z - centreZ, end.x - centreX) - startAngle;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  const arc: PavementPoint[] = [entry];
  for (let step = 0; step <= CORNER_ARC_STEPS; step += 1) {
    const angle = startAngle + (sweep * step) / CORNER_ARC_STEPS;
    arc.push({
      x: centreX + Math.cos(angle) * radius,
      z: centreZ + Math.sin(angle) * radius,
    });
  }
  arc.push(exit);
  return arc;
}

/** Semicircle around a dead-ended road's tip, joining its two pavements. */
function deadEndCapPoints(rail: Rail, atStart: boolean): PavementPoint[] {
  const tip = atStart ? rail.points[0] : rail.points.at(-1)!;
  const outward = atStart
    ? { x: -rail.segmentDirs[0].x, z: -rail.segmentDirs[0].z }
    : rail.segmentDirs.at(-1)!;
  const t = atStart ? 0 : rail.length;
  const lateral = lateralOf(atStart ? rail.segmentDirs[0] : rail.segmentDirs.at(-1)!);
  const points: PavementPoint[] = [offsetPointAt(rail, 1, t)];
  const steps = 4;
  for (let step = 1; step < steps; step += 1) {
    const angle = (Math.PI * step) / steps;
    points.push({
      x: tip.x + (lateral.x * Math.cos(angle) + outward.x * Math.sin(angle)) * rail.railOffset,
      z: tip.z + (lateral.z * Math.cos(angle) + outward.z * Math.sin(angle)) * rail.railOffset,
    });
  }
  points.push(offsetPointAt(rail, -1, t));
  return points;
}

/** Merged cut intervals along one surface's arclength, circular when closed. */
function mergeCuts(
  cuts: Array<{ start: number; end: number }>,
  rail: Rail,
): Array<{ start: number; end: number }> {
  if (!cuts.length) return [];
  if (!rail.closed) {
    const clamped = cuts
      .map((cut) => ({
        start: Math.max(0, cut.start),
        end: Math.min(rail.length, cut.end),
      }))
      .sort((first, second) => first.start - second.start);
    const merged = [clamped[0]];
    for (const cut of clamped.slice(1)) {
      const last = merged.at(-1)!;
      if (cut.start <= last.end + 1e-6) last.end = Math.max(last.end, cut.end);
      else merged.push({ ...cut });
    }
    return merged;
  }
  // Circular: shift everything into [0, length), merge linearly, then check
  // whether the last interval wraps round into the first.
  const length = rail.length;
  const shifted = cuts
    .map((cut) => {
      const start = ((cut.start % length) + length) % length;
      return { start, end: start + (cut.end - cut.start) };
    })
    .sort((first, second) => first.start - second.start);
  const merged = [shifted[0]];
  for (const cut of shifted.slice(1)) {
    const last = merged.at(-1)!;
    if (cut.start <= last.end + 1e-6) last.end = Math.max(last.end, cut.end);
    else merged.push({ ...cut });
  }
  if (merged.length > 1 && merged.at(-1)!.end >= merged[0].start + length - 1e-6) {
    merged[0].start = merged.at(-1)!.start - length;
    merged.pop();
  }
  return merged;
}

/** The rail run for interval [a, b] on one side: trims plus mitred vertices. */
function runPoints(rail: Rail, sigma: 1 | -1, a: number, b: number): PavementPoint[] {
  const vertices: Array<{ t: number; index: number }> = [];
  const wraps = rail.closed ? [0, rail.length] : [0];
  for (let index = 0; index < rail.points.length; index += 1) {
    // Skip open endpoints: offsetPointAt covers them with the same flat offset.
    if (!rail.closed && (index === 0 || index === rail.points.length - 1)) continue;
    for (const wrap of wraps) {
      const t = rail.cumulative[index] + wrap;
      if (t > a + 1e-6 && t < b - 1e-6) vertices.push({ t, index });
    }
  }
  vertices.sort((first, second) => first.t - second.t);
  return [
    offsetPointAt(rail, sigma, a),
    ...vertices.map((vertex) => mitredVertex(rail, sigma, vertex.index)),
    offsetPointAt(rail, sigma, b),
  ];
}

export function buildPavementGraph(
  surfaces: readonly PavementSurface[],
  config: PavementConfig,
): PavementGraph {
  const epsilon = config.nodeEpsilonM ?? DEFAULT_NODE_EPSILON_M;
  const kerbRadius = config.kerbRadiusM ?? DEFAULT_KERB_RADIUS_M;
  const rails = surfaces
    .map((surface) => prepareSurface(surface, config.sidewalkWidthM, epsilon))
    .filter((rail): rail is Rail => rail !== null);

  // The arms an authored vertex sends out: toward each neighbouring
  // centreline point, wrapping when the surface is a closed ring.
  const authoredMember = (rail: Rail, pointIndex: number): ClusterMember => {
    const origin = rail.points[pointIndex];
    const count = rail.points.length;
    const arms: ClusterMember["arms"] = [];
    const pushArm = (neighbourIndex: number, forward: boolean) => {
      const neighbour = rail.points[neighbourIndex];
      const direction = normalizeDirection({
        x: neighbour.x - origin.x,
        z: neighbour.z - origin.z,
      });
      if (!direction) return;
      arms.push({ direction, forward, neighbourDist: pointDistance(origin, neighbour) });
    };
    if (pointIndex > 0) pushArm(pointIndex - 1, false);
    else if (rail.closed) pushArm(count - 1, false);
    if (pointIndex < count - 1) pushArm(pointIndex + 1, true);
    else if (rail.closed) pushArm(0, true);
    return { rail, t: rail.cumulative[pointIndex], origin, pointIndex, arms };
  };
  const joinCluster = (cluster: Cluster, member: ClusterMember) => {
    cluster.surfaceIds.add(member.rail.id);
    cluster.maxRailHalf = Math.max(cluster.maxRailHalf, member.rail.railOffset);
    cluster.maxCarriagewayHalf = Math.max(
      cluster.maxCarriagewayHalf,
      member.rail.carriagewayHalf,
    );
    cluster.members.push(member);
  };

  // Pass 1: cluster centreline points into shared nodes, as the junction fill
  // does, keeping the widest rail offset so every leg's trim clears it.
  // `membership` records every cluster an authored vertex belongs to — the
  // later passes must see adoptions too, or they invent duplicate junctions
  // centimetres from the adopted one.
  const clusters: Cluster[] = [];
  const membership = new Map<string, Cluster[]>();
  const recordMembership = (rail: Rail, pointIndex: number, cluster: Cluster) => {
    const key = `${rail.id}:${pointIndex}`;
    const list = membership.get(key) ?? [];
    list.push(cluster);
    membership.set(key, list);
  };
  for (const rail of rails) {
    for (let index = 0; index < rail.points.length; index += 1) {
      const point = rail.points[index];
      let cluster = clusters.find(
        (candidate) => Math.hypot(candidate.x - point.x, candidate.z - point.z) <= epsilon,
      );
      if (!cluster) {
        cluster = {
          x: point.x,
          z: point.z,
          surfaceIds: new Set(),
          maxRailHalf: 0,
          maxCarriagewayHalf: 0,
          members: [],
          legs: [],
          pairing: [],
        };
        clusters.push(cluster);
      }
      joinCluster(cluster, authoredMember(rail, index));
      recordMembership(rail, index, cluster);
    }
  }

  // Adoption pass: a road whose authored END sits a little off a shared node
  // (Cromwell Road's recentred dual carriageway ends 1.7 m from the junction
  // it visually merges into) still physically overlaps that junction. Adopt
  // such endpoints into the cluster their carriageway reaches, or its rails
  // are never trimmed and the crossing road's pavement walks its asphalt.
  for (const rail of rails) {
    if (rail.closed) continue;
    for (const pointIndex of [0, rail.points.length - 1]) {
      const tip = rail.points[pointIndex];
      const own = clusters.find(
        (candidate) => Math.hypot(candidate.x - tip.x, candidate.z - tip.z) <= epsilon,
      );
      if (own && own.surfaceIds.size > 1) continue;
      let adopter: Cluster | null = null;
      let best = Number.POSITIVE_INFINITY;
      for (const cluster of clusters) {
        if (cluster === own) continue;
        const distance = Math.hypot(cluster.x - tip.x, cluster.z - tip.z);
        if (
          distance <= cluster.maxCarriagewayHalf + rail.carriagewayHalf &&
          distance < best
        ) {
          adopter = cluster;
          best = distance;
        }
      }
      if (adopter) {
        joinCluster(adopter, authoredMember(rail, pointIndex));
        recordMembership(rail, pointIndex, adopter);
      }
    }
  }

  // Virtual junctions: an authored vertex sitting on ANOTHER road's asphalt
  // mid-segment (London's quiet loop turns its corner right on Cromwell Road,
  // which has no vertex there) is a physical crossing neither pass above can
  // see. The crossed road joins the vertex's cluster as a virtual member at
  // the projected arclength, so its rails get trimmed and corner-linked too.
  for (const rail of rails) {
    for (let index = 0; index < rail.points.length; index += 1) {
      const point = rail.points[index];
      const owners = membership.get(`${rail.id}:${index}`) ?? [];
      const cluster = owners[0];
      if (!cluster) continue;
      for (const other of rails) {
        if (
          other === rail ||
          owners.some((owner) => owner.surfaceIds.has(other.id))
        ) {
          continue;
        }
        const segmentCount = other.closed ? other.points.length : other.points.length - 1;
        let bestT: number | null = null;
        let bestDistance = other.carriagewayHalf;
        let bestOrigin: PavementPoint = point;
        for (let segment = 0; segment < segmentCount; segment += 1) {
          const start = other.points[segment];
          const end = other.points[(segment + 1) % other.points.length];
          const dx = end.x - start.x;
          const dz = end.z - start.z;
          const lengthSquared = dx * dx + dz * dz;
          if (lengthSquared < 1e-9) continue;
          const along =
            ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared;
          if (along < 0 || along > 1) continue;
          const projection = { x: start.x + dx * along, z: start.z + dz * along };
          const distance = pointDistance(point, projection);
          const tProjection = other.cumulative[segment] + along * Math.sqrt(lengthSquared);
          // Near the other road's own vertices the point clusters (or adopts)
          // normally; the virtual member is for genuine mid-segment landings.
          const nearOwnVertex = other.points.some(
            (vertex) => pointDistance(projection, vertex) < 1.0,
          );
          if (!nearOwnVertex && distance < bestDistance) {
            bestDistance = distance;
            bestT = tProjection;
            bestOrigin = projection;
          }
        }
        if (bestT === null) continue;
        const segment = (() => {
          let index2 = other.cumulative.length - 1;
          while (index2 > 0 && other.cumulative[index2] > bestT) index2 -= 1;
          return other.closed ? index2 : Math.min(index2, other.points.length - 2);
        })();
        const direction = other.segmentDirs[segment];
        const segmentEnd =
          segment < other.cumulative.length - 1
            ? other.cumulative[segment + 1]
            : other.length;
        joinCluster(cluster, {
          rail: other,
          t: bestT,
          origin: bestOrigin,
          arms: [
            {
              direction: { x: -direction.x, z: -direction.z },
              forward: false,
              neighbourDist: bestT - other.cumulative[segment],
            },
            { direction, forward: true, neighbourDist: segmentEnd - bestT },
          ],
        });
      }
    }
  }

  const junctions = clusters.filter((cluster) => cluster.surfaceIds.size > 1);
  const junctionMemberKeys = new Set(
    junctions.flatMap((cluster) =>
      cluster.members
        .filter((member) => member.pointIndex !== undefined)
        .map((member) => `${member.rail.id}:${member.pointIndex}`),
    ),
  );

  // Pass 2: build the legs. Each junction member contributes one leg per arm.
  const junctionTs = new Map<Rail, number[]>();
  for (const cluster of junctions) {
    for (const member of cluster.members) {
      const list = junctionTs.get(member.rail) ?? [];
      list.push(member.t);
      junctionTs.set(member.rail, list);
    }
  }
  for (const list of junctionTs.values()) list.sort((f, s) => f - s);
  // Arclength to the next junction in the given direction, so two nearby
  // crossings never chew away the rail between them entirely.
  const gapToNextJunction = (rail: Rail, t: number, forward: boolean): number => {
    const ts = junctionTs.get(rail)!;
    if (forward) {
      for (const candidate of ts) {
        if (candidate > t + 1e-6) return candidate - t;
      }
      return rail.closed ? ts[0] + rail.length - t : Number.POSITIVE_INFINITY;
    }
    for (let index = ts.length - 1; index >= 0; index -= 1) {
      if (ts[index] < t - 1e-6) return t - ts[index];
    }
    return rail.closed ? t - (ts.at(-1)! - rail.length) : Number.POSITIVE_INFINITY;
  };

  const cutsBySurface = new Map<Rail, Array<{ start: number; end: number }>>();
  for (const cluster of junctions) {
    for (const member of cluster.members) {
      for (const arm of member.arms) {
        cluster.legs.push({
          rail: member.rail,
          origin: member.origin,
          direction: arm.direction,
          lateral: lateralOf(arm.direction),
          half: member.rail.railOffset,
          plusSigma: arm.forward ? 1 : -1,
          tNode: member.t,
          neighbourDist: arm.neighbourDist,
          junctionGap: gapToNextJunction(member.rail, member.t, arm.forward),
          reach: 0,
          tCut: member.t,
        });
      }
    }
    cluster.legs.sort(
      (first, second) =>
        Math.atan2(first.direction.x, first.direction.z) -
        Math.atan2(second.direction.x, second.direction.z),
    );

    // Coincident legs — a stretch of road authored twice, like the quiet
    // loop's north arm lying on Cromwell Road — collapse to the widest for
    // corner pairing, or the "corner" between the duplicates cuts straight
    // across their shared asphalt. Every duplicate still gets trimmed, and
    // its trim coincides with its keeper's, so the runs knit back together.
    const groups: PavementLeg[][] = [];
    for (const leg of cluster.legs) {
      const group = groups.find((candidate) => {
        const first = candidate[0];
        if (dot(first.direction, leg.direction) < 0.9999) return false;
        const dx = leg.origin.x - first.origin.x;
        const dz = leg.origin.z - first.origin.z;
        return Math.abs(dx * first.lateral.x + dz * first.lateral.z) < 1.0;
      });
      if (group) group.push(leg);
      else groups.push([leg]);
    }
    cluster.pairing = groups.map((group) =>
      group.reduce((widest, leg) => (leg.half > widest.half ? leg : widest)),
    );

    // Trim reaches. A perpendicular crossing only needs to clear the crossing
    // road's own pavement, but an acute one (Tokyo's junction road leaves at
    // ~46°) needs the run-up to reach the rail-line corner with each adjacent
    // leg, or the surviving rail still walks through the diagonal carriageway.
    const required = new Map<PavementLeg, number>();
    for (const [index, leg] of cluster.pairing.entries()) {
      const next = cluster.pairing[(index + 1) % cluster.pairing.length];
      if (next === leg) continue;
      const meeting = railCorner(leg, next);
      if (!meeting) continue;
      const cap = cluster.maxRailHalf * MAX_MITER_RATIO;
      if (meeting.alongA > 0) {
        required.set(leg, Math.max(required.get(leg) ?? 0, Math.min(meeting.alongA, cap)));
      }
      if (meeting.alongB > 0) {
        required.set(next, Math.max(required.get(next) ?? 0, Math.min(meeting.alongB, cap)));
      }
    }
    for (const [index, group] of groups.entries()) {
      const keeper = cluster.pairing[index];
      for (const leg of group) {
        leg.reach = Math.min(
          Math.max(
            cluster.maxRailHalf + config.sidewalkWidthM * 0.5,
            (required.get(keeper) ?? 0) + config.sidewalkWidthM,
          ),
          leg.neighbourDist * 0.9,
          leg.junctionGap * 0.45,
        );
        leg.tCut = leg.plusSigma === 1 ? leg.tNode + leg.reach : leg.tNode - leg.reach;
        const cuts = cutsBySurface.get(leg.rail) ?? [];
        cuts.push(
          leg.plusSigma === 1
            ? { start: leg.tNode, end: leg.tCut }
            : { start: leg.tCut, end: leg.tNode },
        );
        cutsBySurface.set(leg.rail, cuts);
      }
    }
  }

  // Assembly: edges accumulate; endpoints dedupe into nodes by proximity.
  const nodes: Array<{ x: number; z: number; edgeIds: number[] }> = [];
  const edges: PavementEdge[] = [];
  const nodeAt = (point: PavementPoint): number => {
    for (let index = 0; index < nodes.length; index += 1) {
      if (
        Math.hypot(nodes[index].x - point.x, nodes[index].z - point.z) <=
        NODE_MERGE_EPSILON_M
      ) {
        return index;
      }
    }
    nodes.push({ x: point.x, z: point.z, edgeIds: [] });
    return nodes.length - 1;
  };
  const addEdge = (rawPoints: readonly PavementPoint[], closed: boolean) => {
    const points: PavementPoint[] = [];
    for (const point of rawPoints) {
      if (!points.length || pointDistance(points.at(-1)!, point) > 1e-6) {
        points.push(point);
      }
    }
    if (points.length < 2) return;
    const cumulativeM = [0];
    for (let index = 1; index < points.length; index += 1) {
      cumulativeM.push(
        cumulativeM[index - 1] + pointDistance(points[index - 1], points[index]),
      );
    }
    const lengthM = cumulativeM.at(-1)!;
    if (lengthM < MIN_EDGE_LENGTH_M) return;
    const id = edges.length;
    const a = nodeAt(points[0]);
    const b = closed ? a : nodeAt(points.at(-1)!);
    edges.push({ id, a, b, points, cumulativeM, lengthM, closed });
    nodes[a].edgeIds.push(id);
    if (b !== a) nodes[b].edgeIds.push(id);
  };

  // Rail runs: the complement of the merged junction cuts, per side.
  for (const rail of rails) {
    const merged = mergeCuts(cutsBySurface.get(rail) ?? [], rail);
    for (const sigma of [1, -1] as const) {
      if (!merged.length) {
        if (rail.closed) {
          const ring = rail.points.map((_, index) => mitredVertex(rail, sigma, index));
          ring.push({ ...ring[0] });
          addEdge(ring, true);
        } else {
          addEdge(runPoints(rail, sigma, 0, rail.length), false);
        }
        continue;
      }
      if (!rail.closed) {
        let cursor = 0;
        for (const cut of merged) {
          if (cut.start > cursor + 1e-6) {
            addEdge(runPoints(rail, sigma, cursor, cut.start), false);
          }
          cursor = Math.max(cursor, cut.end);
        }
        if (cursor < rail.length - 1e-6) {
          addEdge(runPoints(rail, sigma, cursor, rail.length), false);
        }
      } else {
        for (let index = 0; index < merged.length; index += 1) {
          const runStart = merged[index].end;
          const nextCut = merged[(index + 1) % merged.length];
          const runEnd =
            index + 1 < merged.length ? nextCut.start : nextCut.start + rail.length;
          if (runEnd > runStart + 1e-6) {
            addEdge(runPoints(rail, sigma, runStart, runEnd), false);
          }
        }
      }
    }
  }

  // Corner links: adjacent legs in heading order, exactly like the junction
  // fill walks its outline — `lateral` faces the next leg round, so each
  // link joins one leg's +lateral pavement to the next leg's −lateral one.
  for (const cluster of junctions) {
    const legs = cluster.pairing;
    if (legs.length < 2) continue;
    for (const [index, leg] of legs.entries()) {
      addEdge(
        cornerLinkPoints(leg, legs[(index + 1) % legs.length], kerbRadius),
        false,
      );
    }
  }

  // Dead-end caps: a road tip nothing else touches gets a turnaround loop.
  for (const rail of rails) {
    if (rail.closed) continue;
    for (const pointIndex of [0, rail.points.length - 1]) {
      if (!junctionMemberKeys.has(`${rail.id}:${pointIndex}`)) {
        addEdge(deadEndCapPoints(rail, pointIndex === 0), false);
      }
    }
  }

  return {
    nodes: nodes.map((node, id) => ({ id, x: node.x, z: node.z, edgeIds: node.edgeIds })),
    edges,
    junctions: junctions.map((cluster) => ({ x: cluster.x, z: cluster.z })),
  };
}

/**
 * The pose at arclength `s` along an edge. `segmentHint` (a previous call's
 * `segmentIndex`) makes the usual advance-a-little resample O(1). Heading is
 * the project's atan2(dx, dz) convention, facing increasing `s`; callers
 * walking an edge backwards add π themselves.
 */
export function samplePavementEdge(
  edge: PavementEdge,
  s: number,
  segmentHint = 0,
): { x: number; z: number; headingRad: number; segmentIndex: number } {
  const clamped = Math.min(Math.max(s, 0), edge.lengthM);
  let segment = Math.min(Math.max(segmentHint, 0), edge.points.length - 2);
  while (segment > 0 && edge.cumulativeM[segment] > clamped) segment -= 1;
  while (
    segment < edge.points.length - 2 &&
    edge.cumulativeM[segment + 1] < clamped
  ) {
    segment += 1;
  }
  const start = edge.points[segment];
  const end = edge.points[segment + 1];
  const span = edge.cumulativeM[segment + 1] - edge.cumulativeM[segment];
  const local = span > 1e-9 ? (clamped - edge.cumulativeM[segment]) / span : 0;
  return {
    x: start.x + (end.x - start.x) * local,
    z: start.z + (end.z - start.z) * local,
    headingRad: Math.atan2(end.x - start.x, end.z - start.z),
    segmentIndex: segment,
  };
}
