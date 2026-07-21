import { describe, expect, it } from "vitest";
import { MAP_PACKS } from "../app/game/content";
import {
  splitMarkingAtCrossings,
  type MarkingPoint,
} from "../app/game/roadMarkings";

const p = (x: number, z: number): MarkingPoint => ({ x, z });

const lengthOf = (run: readonly MarkingPoint[]): number =>
  run
    .slice(1)
    .reduce((total, point, index) => total + Math.hypot(point.x - run[index].x, point.z - run[index].z), 0);

const nearestDistance = (
  point: MarkingPoint,
  runs: readonly (readonly MarkingPoint[])[],
): number => {
  let best = Number.POSITIVE_INFINITY;
  for (const run of runs) {
    for (let index = 0; index < run.length - 1; index += 1) {
      const a = run[index];
      const b = run[index + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lengthSquared = dx * dx + dz * dz;
      const amount =
        lengthSquared < 1e-9
          ? 0
          : Math.max(
              0,
              Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared),
            );
      best = Math.min(
        best,
        Math.hypot(point.x - (a.x + dx * amount), point.z - (a.z + dz * amount)),
      );
    }
  }
  return best;
};

describe("lane paint stops at a junction", () => {
  it("leaves an untouched road in one piece", () => {
    const runs = splitMarkingAtCrossings([p(0, 0), p(0, 100)], []);
    expect(runs).toEqual([[p(0, 0), p(0, 100)]]);
  });

  it("bites a gap out where a carriageway crosses", () => {
    const runs = splitMarkingAtCrossings(
      [p(0, -50), p(0, 50)],
      [{ centerline: [p(-40, 0), p(40, 0)], widthM: 10 }],
    );
    expect(runs).toHaveLength(2);
    // 5 m of half-width plus the 0.8 m margin either side of z=0.
    expect(runs[0].at(-1)!.z).toBeCloseTo(-5.8, 6);
    expect(runs[1][0].z).toBeCloseTo(5.8, 6);
  });

  it("breaks where a side road merely ends on it", () => {
    // A T-junction: the stem's centreline stops dead on the through road, so
    // the two never properly cross and an endpoint touch has to count.
    const runs = splitMarkingAtCrossings(
      [p(-50, 0), p(50, 0)],
      [{ centerline: [p(0, 0), p(0, 60)], widthM: 9 }],
    );
    expect(runs).toHaveLength(2);
    expect(runs[0].at(-1)!.x).toBeCloseTo(-5.3, 6);
  });

  it("merges junctions that sit on top of each other", () => {
    const runs = splitMarkingAtCrossings(
      [p(0, -50), p(0, 50)],
      [
        { centerline: [p(-40, -2), p(40, -2)], widthM: 10 },
        { centerline: [p(-40, 2), p(40, 2)], widthM: 10 },
      ],
    );
    expect(runs).toHaveLength(2);
    expect(runs[0].at(-1)!.z).toBeCloseTo(-7.8, 6);
    expect(runs[1][0].z).toBeCloseTo(7.8, 6);
  });

  it("drops a run too short to be worth painting", () => {
    const runs = splitMarkingAtCrossings(
      [p(0, -6), p(0, 50)],
      [{ centerline: [p(-40, 0), p(40, 0)], widthM: 10 }],
    );
    // The 0.2 m stub south of the junction goes; the long run north stays.
    expect(runs).toHaveLength(1);
    expect(runs[0][0].z).toBeCloseTo(5.8, 6);
  });

  it("keeps the authored vertices of a curve inside a run", () => {
    const runs = splitMarkingAtCrossings(
      [p(0, -50), p(2, -20), p(4, 20), p(6, 50)],
      [{ centerline: [p(-40, 0), p(40, 0)], widthM: 4 }],
    );
    expect(runs).toHaveLength(2);
    expect(runs[0]).toContainEqual(p(2, -20));
    expect(runs[1]).toContainEqual(p(4, 20));
  });

  it("ignores a road running parallel to the marking", () => {
    const runs = splitMarkingAtCrossings(
      [p(0, -50), p(0, 50)],
      [{ centerline: [p(8, -50), p(8, 50)], widthM: 10 }],
    );
    expect(runs).toHaveLength(1);
  });

  it("clears every NYC junction box of through paint", () => {
    // The visible bug: Broadway's yellow centre line and West 79th's crossed
    // in the middle of the intersection. Nothing should be painted within a
    // carriageway half-width of any junction node.
    const nyc = MAP_PACKS.find((pack) => pack.id === "nyc-upper-west-side")!;
    const surfaces = nyc.geometry.roadSurfaces;
    const runs = surfaces.flatMap((surface) =>
      surface.markings.flatMap((marking) =>
        splitMarkingAtCrossings(
          marking.points,
          surfaces.filter((other) => other.id !== surface.id),
        ),
      ),
    );
    expect(runs.length).toBeGreaterThan(surfaces.length);
    for (const node of nyc.laneGraph.nodes) {
      expect(
        nearestDistance(node.position, runs),
        `paint through ${node.id}`,
      ).toBeGreaterThan(4.5);
    }
  });

  it("still paints the long stretches between NYC's junctions", () => {
    const nyc = MAP_PACKS.find((pack) => pack.id === "nyc-upper-west-side")!;
    const surfaces = nyc.geometry.roadSurfaces;
    for (const surface of surfaces) {
      for (const marking of surface.markings) {
        const runs = splitMarkingAtCrossings(
          marking.points,
          surfaces.filter((other) => other.id !== surface.id),
        );
        const painted = runs.reduce((total, run) => total + lengthOf(run), 0);
        const whole = lengthOf(marking.points);
        // Junction gaps cost a little; losing more than a fifth of a road's
        // paint would mean the bites are far too greedy.
        expect(painted / whole, `${surface.id}/${marking.id}`).toBeGreaterThan(0.8);
        expect(runs.length, `${surface.id}/${marking.id}`).toBeGreaterThan(1);
      }
    }
  });
});
