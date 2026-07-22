import { describe, expect, it } from "vitest";
import {
  createCrowdSim,
  type CrowdConfig,
  type CrowdSim,
} from "../app/game/crowdWalkers";
import {
  buildPavementGraph,
  samplePavementEdge,
  type PavementSurface,
} from "../app/game/pavementPaths";

// A small city block fixture: a 2×2 grid of roads, so the graph has block
// circuits, corner links and a perimeter — every transition kind but rings.
const GRID: PavementSurface[] = [
  { id: "ew-north", centerline: [{ x: -80, z: 40 }, { x: 0, z: 40 }, { x: 80, z: 40 }], widthM: 6 },
  { id: "ew-south", centerline: [{ x: -80, z: -40 }, { x: 0, z: -40 }, { x: 80, z: -40 }], widthM: 6 },
  { id: "ns-west", centerline: [{ x: -80, z: -40 }, { x: -80, z: 40 }], widthM: 6 },
  { id: "ns-mid", centerline: [{ x: 0, z: -40 }, { x: 0, z: 40 }], widthM: 6 },
  { id: "ns-east", centerline: [{ x: 80, z: -40 }, { x: 80, z: 40 }], widthM: 6 },
];
const GRAPH = buildPavementGraph(GRID, { sidewalkWidthM: 2 });

const CONFIG: CrowdConfig = {
  count: 24,
  seed: 1234,
  innerRadiusM: 10,
  outerRadiusM: 70,
  recycleRadiusM: 100,
  minSpeedMps: 0.9,
  maxSpeedMps: 1.7,
  turnPauseSeconds: 1,
  modelCount: 3,
  tintCount: 5,
  complexionCount: 7,
  hairCount: 11,
};
const DT = 1 / 60;
const CENTRE = { x: 0, z: 0 };
const never = () => false;
const always = () => true;

function makeSim(overrides: Partial<CrowdConfig> = {}): CrowdSim {
  const sim = createCrowdSim(GRAPH, { ...CONFIG, ...overrides });
  expect(sim).not.toBeNull();
  return sim!;
}

describe("createCrowdSim", () => {
  it("returns null when there is nothing to walk on", () => {
    expect(createCrowdSim({ nodes: [], edges: [], junctions: [] }, CONFIG)).toBeNull();
    expect(createCrowdSim(GRAPH, { ...CONFIG, count: 0 })).toBeNull();
  });

  it("fills the pool on the first step, spread across the rails", () => {
    const sim = makeSim();
    sim.step(DT, CENTRE, never);
    expect(sim.walkers).toHaveLength(CONFIG.count);
    const edges = new Set(sim.walkers.map((walker) => walker.edgeId));
    expect(edges.size).toBeGreaterThan(4);
    for (const walker of sim.walkers) {
      const distance = Math.hypot(walker.x - CENTRE.x, walker.z - CENTRE.z);
      expect(distance).toBeGreaterThanOrEqual(CONFIG.innerRadiusM);
      expect(distance).toBeLessThanOrEqual(CONFIG.outerRadiusM);
    }
  });
});

describe("CrowdSim.step", () => {
  it("keeps every walker exactly on the rails", () => {
    const sim = makeSim();
    for (let step = 0; step < 5_000; step += 1) {
      sim.step(DT, CENTRE, never);
    }
    for (const walker of sim.walkers) {
      const edge = GRAPH.edges[walker.edgeId];
      expect(walker.s).toBeGreaterThanOrEqual(0);
      expect(walker.s).toBeLessThanOrEqual(edge.lengthM);
      const pose = samplePavementEdge(edge, walker.s);
      expect(Math.hypot(walker.x - pose.x, walker.z - pose.z)).toBeLessThan(1e-6);
    }
  });

  it("never teleports a walker except by an out-of-view recycle", () => {
    const sim = makeSim();
    sim.step(DT, CENTRE, never);
    const previous = sim.walkers.map((walker) => ({ x: walker.x, z: walker.z }));
    for (let step = 0; step < 10_000; step += 1) {
      sim.step(DT, CENTRE, never);
      for (const [index, walker] of sim.walkers.entries()) {
        const moved = Math.hypot(
          walker.x - previous[index].x,
          walker.z - previous[index].z,
        );
        if (walker.justRecycled) {
          // Recycles must land back inside the annulus, not on screen.
          const distance = Math.hypot(walker.x - CENTRE.x, walker.z - CENTRE.z);
          expect(distance).toBeGreaterThanOrEqual(CONFIG.innerRadiusM);
          expect(distance).toBeLessThanOrEqual(CONFIG.outerRadiusM);
        } else {
          expect(moved, `walker ${index} step ${step}`).toBeLessThanOrEqual(
            walker.speedMps * DT + 1e-9,
          );
        }
        previous[index].x = walker.x;
        previous[index].z = walker.z;
      }
    }
  });

  it("turns watched walkers around at the bubble edge instead of vanishing them", () => {
    const sim = makeSim();
    sim.step(DT, CENTRE, never);
    let turnarounds = 0;
    for (let step = 0; step < 20_000; step += 1) {
      const before = sim.walkers.map((walker) => walker.dir);
      sim.step(DT, CENTRE, always);
      for (const [index, walker] of sim.walkers.entries()) {
        // Fully visible: nothing may ever recycle inside the hard radius.
        expect(walker.justRecycled).toBe(false);
        const distance = Math.hypot(walker.x - CENTRE.x, walker.z - CENTRE.z);
        expect(distance).toBeLessThanOrEqual(
          CONFIG.recycleRadiusM + CONFIG.maxSpeedMps * DT,
        );
        if (
          walker.dir !== before[index] &&
          distance > CONFIG.outerRadiusM &&
          walker.state === "pause"
        ) {
          turnarounds += 1;
        }
      }
    }
    expect(turnarounds).toBeGreaterThan(0);
  });

  it("recycles unseen walkers stranded outside the bubble", () => {
    const sim = makeSim();
    sim.step(DT, CENTRE, never);
    // The focus leaps away, so every walker is now far outside the annulus.
    const elsewhere = { x: 4_000, z: 4_000 };
    sim.step(DT, elsewhere, never);
    for (const walker of sim.walkers) {
      expect(walker.justRecycled).toBe(true);
    }
  });

  it("keeps variants, tints and palette slots stable across recycles", () => {
    const sim = makeSim();
    sim.step(DT, CENTRE, never);
    const appearance = sim.walkers.map((walker) => [
      walker.variant,
      walker.tintIndex,
      walker.complexionIndex,
      walker.hairIndex,
    ]);
    sim.step(DT, { x: 4_000, z: 4_000 }, never);
    sim.step(DT, CENTRE, never);
    expect(
      sim.walkers.map((walker) => [
        walker.variant,
        walker.tintIndex,
        walker.complexionIndex,
        walker.hairIndex,
      ]),
    ).toEqual(appearance);
    expect(sim.walkers).toHaveLength(CONFIG.count);
  });

  it("does not pin a walker's hair to their complexion", () => {
    // Both slots are drawn from the pool index, so the naive `index % count`
    // for each would make hair a fixed function of complexion: a crowd would
    // show only `count` of the possible pairings, and the same complexion
    // would never appear under two different hair colours.
    const sim = makeSim({ count: 96, complexionCount: 24, hairCount: 24 });
    const hairByComplexion = new Map<number, Set<number>>();
    for (const walker of sim.walkers) {
      const seen = hairByComplexion.get(walker.complexionIndex) ?? new Set<number>();
      seen.add(walker.hairIndex);
      hairByComplexion.set(walker.complexionIndex, seen);
    }
    for (const seen of hairByComplexion.values()) {
      expect(seen.size).toBeGreaterThan(1);
    }
    const pairs = new Set(
      sim.walkers.map((walker) => `${walker.complexionIndex}:${walker.hairIndex}`),
    );
    expect(pairs.size).toBeGreaterThan(24);

    // The rotation must still be a permutation per cycle, so weights hold.
    const counts = new Map<number, number>();
    for (const walker of sim.walkers) {
      counts.set(walker.hairIndex, (counts.get(walker.hairIndex) ?? 0) + 1);
    }
    expect(counts.size).toBe(24);
    expect([...counts.values()].every((count) => count === 4)).toBe(true);
  });

  it("never bounces straight back off a junction", () => {
    // Every node in the grid fixture has degree >= 2, so a same-edge
    // direction flip mid-graph would mean a walker walked into a corner and
    // reflected — the strip sawtooth all over again. Bubble turnarounds are
    // excluded by keeping everything unseen and the bubble huge.
    const sim = makeSim({ outerRadiusM: 4_000, recycleRadiusM: 5_000 });
    sim.step(DT, CENTRE, never);
    const previous = sim.walkers.map((walker) => ({ edge: walker.edgeId, dir: walker.dir }));
    let transitions = 0;
    for (let step = 0; step < 20_000; step += 1) {
      sim.step(DT, CENTRE, never);
      for (const [index, walker] of sim.walkers.entries()) {
        if (walker.edgeId !== previous[index].edge) transitions += 1;
        else if (walker.dir !== previous[index].dir) {
          throw new Error(`walker ${index} reflected off a junction at step ${step}`);
        }
        previous[index] = { edge: walker.edgeId, dir: walker.dir };
      }
    }
    expect(transitions).toBeGreaterThan(50);
  });

  it("is deterministic for a given seed and inputs", () => {
    const first = makeSim();
    const second = makeSim();
    for (let step = 0; step < 2_000; step += 1) {
      const focus = { x: Math.sin(step / 100) * 30, z: Math.cos(step / 130) * 30 };
      first.step(DT, focus, never);
      second.step(DT, focus, never);
    }
    expect(first.walkers).toEqual(second.walkers);
  });

  it("differs across seeds", () => {
    const first = makeSim({ seed: 1 });
    const second = makeSim({ seed: 2 });
    first.step(DT, CENTRE, never);
    second.step(DT, CENTRE, never);
    expect(first.walkers).not.toEqual(second.walkers);
  });
});
