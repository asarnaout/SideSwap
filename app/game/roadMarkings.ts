// Breaking lane paint at junctions.
//
// Road markings are authored as one polyline down the whole length of a road,
// which is how a highway engineer describes them but not how they are painted:
// no line is carried across an intersection. Left unbroken, Broadway's centre
// line and West 79th's centre line meet in a painted X in the middle of the
// box. This splits a marking into the runs between the junctions it passes
// through, so the renderer draws those and leaves the box bare.

export interface MarkingPoint {
  readonly x: number;
  readonly z: number;
}

/** A carriageway that interrupts the marking where it crosses. */
export interface MarkingCrossing {
  readonly centerline: readonly MarkingPoint[];
  readonly widthM: number;
}

/** Extra clearance past the crossing kerb, so paint stops short of the box. */
const CROSSING_MARGIN_M = 0.8;
/** Runs shorter than this are stubs not worth a mesh. */
const MIN_RUN_M = 1.2;
/** Touching counts as crossing: a side road's centreline *ends* on the through road. */
const TOUCH_EPSILON = 1e-6;

const distance = (a: MarkingPoint, b: MarkingPoint): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Distances along `points` at which it meets segment `c0`→`c1`, ignoring the
 * parallel case — two lines that never converge cannot interrupt each other,
 * and collinear roads (a marking laid over its own carriageway) would otherwise
 * report an intersection at every vertex.
 */
function crossingDistances(
  points: readonly MarkingPoint[],
  cumulative: readonly number[],
  c0: MarkingPoint,
  c1: MarkingPoint,
): number[] {
  const hits: number[] = [];
  const cx = c1.x - c0.x;
  const cz = c1.z - c0.z;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index];
    const p1 = points[index + 1];
    const px = p1.x - p0.x;
    const pz = p1.z - p0.z;
    const denominator = px * cz - pz * cx;
    if (Math.abs(denominator) < 1e-9) continue;
    const dx = c0.x - p0.x;
    const dz = c0.z - p0.z;
    const t = (dx * cz - dz * cx) / denominator;
    const u = (dx * pz - dz * px) / denominator;
    if (t < -TOUCH_EPSILON || t > 1 + TOUCH_EPSILON) continue;
    if (u < -TOUCH_EPSILON || u > 1 + TOUCH_EPSILON) continue;
    hits.push(cumulative[index] + t * distance(p0, p1));
  }
  return hits;
}

/** Point at `target` metres along the polyline. */
function pointAt(
  points: readonly MarkingPoint[],
  cumulative: readonly number[],
  target: number,
): MarkingPoint {
  for (let index = 0; index < points.length - 1; index += 1) {
    const segmentLength = cumulative[index + 1] - cumulative[index];
    if (segmentLength <= 0) continue;
    if (target <= cumulative[index + 1] || index === points.length - 2) {
      const amount = Math.min(
        1,
        Math.max(0, (target - cumulative[index]) / segmentLength),
      );
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * amount,
        z: points[index].z + (points[index + 1].z - points[index].z) * amount,
      };
    }
  }
  return points[points.length - 1];
}

/**
 * Splits a marking into the runs left over once every crossing carriageway has
 * taken its bite out. Returns the whole marking as a single run when nothing
 * crosses it, so an isolated road is unaffected.
 */
export function splitMarkingAtCrossings(
  points: readonly MarkingPoint[],
  crossings: readonly MarkingCrossing[],
): MarkingPoint[][] {
  if (points.length < 2) return [];
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + distance(points[index - 1], points[index]));
  }
  const total = cumulative[cumulative.length - 1];
  if (total <= 0) return [];

  const gaps: { start: number; end: number }[] = [];
  for (const crossing of crossings) {
    const reach = crossing.widthM / 2 + CROSSING_MARGIN_M;
    for (let index = 0; index < crossing.centerline.length - 1; index += 1) {
      for (const hit of crossingDistances(
        points,
        cumulative,
        crossing.centerline[index],
        crossing.centerline[index + 1],
      )) {
        gaps.push({ start: hit - reach, end: hit + reach });
      }
    }
  }
  if (!gaps.length) return [[...points]];

  gaps.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const gap of gaps) {
    const last = merged[merged.length - 1];
    if (last && gap.start <= last.end) last.end = Math.max(last.end, gap.end);
    else merged.push({ ...gap });
  }

  const runs: MarkingPoint[][] = [];
  let cursor = 0;
  for (const gap of [...merged, { start: total, end: total }]) {
    const end = Math.min(gap.start, total);
    if (end - cursor >= MIN_RUN_M) {
      // Keep the authored vertices inside the run so curves stay curves.
      const interior = points.filter(
        (_, index) => cumulative[index] > cursor && cumulative[index] < end,
      );
      runs.push([
        pointAt(points, cumulative, cursor),
        ...interior,
        pointAt(points, cumulative, end),
      ]);
    }
    cursor = Math.max(cursor, gap.end);
    if (cursor >= total) break;
  }
  return runs;
}
