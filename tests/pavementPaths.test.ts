import { describe, expect, it } from "vitest";
import { MAP_PACKS } from "../app/game/content";
import { collectRoadJunctionFills } from "../app/game/GameCanvas";
import {
  buildPavementGraph,
  EDGE_KIND_SCATTER,
  LATERAL_TAPER_M,
  samplePavementEdge,
  samplePavementEdgeOffset,
  type PavementGraph,
  type PavementPoint,
  type PavementSurface,
} from "../app/game/pavementPaths";

type Pt = PavementPoint;

function distanceToPolyline(point: Pt, polyline: readonly Pt[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < polyline.length; index += 1) {
    const a = polyline[index];
    const b = polyline[index + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    const t =
      lengthSquared > 1e-9
        ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared))
        : 0;
    best = Math.min(best, Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t)));
  }
  return best;
}

/**
 * True when the point is on (or within `margin` of) the surface's asphalt. A
 * carriageway is a chain of rectangles, not a capsule: a point sitting past a
 * road's end face — like the pavement corner beside a wide stub that merges
 * into a junction — is clear even when it is radially near the endpoint.
 */
function onCarriageway(point: Pt, surface: PavementSurface, margin: number): boolean {
  const half = surface.widthM / 2 + margin;
  const line = surface.centerline;
  for (let index = 0; index + 1 < line.length; index += 1) {
    const a = line[index];
    const b = line[index + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-9) continue;
    const along = ((point.x - a.x) * dx + (point.z - a.z) * dz) / length;
    const lateral = ((point.x - a.x) * dz - (point.z - a.z) * dx) / length;
    if (along >= -margin && along <= length + margin && Math.abs(lateral) < half) {
      return true;
    }
  }
  return false;
}

/** True when segment a→b crosses either kerb line of the surface. */
function segmentCrossesKerb(a: Pt, b: Pt, surface: PavementSurface): boolean {
  const cross = (o: Pt, p: Pt, q: Pt) =>
    (p.x - o.x) * (q.z - o.z) - (p.z - o.z) * (q.x - o.x);
  const intersects = (c: Pt, d: Pt) => {
    const d1 = cross(c, d, a);
    const d2 = cross(c, d, b);
    const d3 = cross(a, b, c);
    const d4 = cross(a, b, d);
    return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0;
  };
  const line = surface.centerline;
  for (let index = 0; index + 1 < line.length; index += 1) {
    const start = line[index];
    const end = line[index + 1];
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    if (length < 1e-9) continue;
    const nx = (end.z - start.z) / length;
    const nz = -(end.x - start.x) / length;
    const half = surface.widthM / 2;
    for (const side of [1, -1]) {
      if (
        intersects(
          { x: start.x + nx * half * side, z: start.z + nz * half * side },
          { x: end.x + nx * half * side, z: end.z + nz * half * side },
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function componentLengths(graph: PavementGraph): number[] {
  const parent = graph.nodes.map((node) => node.id);
  const find = (id: number): number => {
    while (parent[id] !== id) {
      parent[id] = parent[parent[id]];
      id = parent[id];
    }
    return id;
  };
  for (const edge of graph.edges) parent[find(edge.a)] = find(edge.b);
  const totals = new Map<number, number>();
  for (const edge of graph.edges) {
    const root = find(edge.a);
    totals.set(root, (totals.get(root) ?? 0) + edge.lengthM);
  }
  return [...totals.values()];
}

// A perpendicular 4-way: an E-W avenue and a N-S street sharing node (0,0),
// matching the fixture the junction-fill tests use.
const EW_HALF = 3.2;
const NS_HALF = 2.9;
const CROSSROADS: PavementSurface[] = [
  { id: "ew", centerline: [{ x: -40, z: 0 }, { x: 0, z: 0 }, { x: 40, z: 0 }], widthM: EW_HALF * 2 },
  { id: "ns", centerline: [{ x: 0, z: -40 }, { x: 0, z: 0 }, { x: 0, z: 40 }], widthM: NS_HALF * 2 },
];
const SIDEWALK = 3.4;

// The three maps that keep their crowds; Calais and Milton Keynes are being
// retired. Sidewalk widths mirror GameCanvas's shoulder derivation: paved maps
// get the 3.4 m band, the rest max(0.9, geometry.shoulderWidth ?? 1.2).
const TARGET_MAPS = [
  "nyc-upper-west-side",
  "tokyo-setagaya",
  "london-south-kensington",
].map((id) => {
  const pack = MAP_PACKS.find((candidate) => candidate.id === id)!;
  const sidewalkWidthM =
    id === "nyc-upper-west-side"
      ? 3.4
      : Math.max(0.9, pack.geometry.shoulderWidth ?? 1.2);
  return { pack, sidewalkWidthM };
});

describe("buildPavementGraph", () => {
  it("keeps every rail on its own pavement band", () => {
    const graph = buildPavementGraph(CROSSROADS, { sidewalkWidthM: SIDEWALK });
    for (const edge of graph.edges) {
      for (const point of edge.points) {
        const nearest = Math.min(
          ...CROSSROADS.map((surface) => distanceToPolyline(point, surface.centerline)),
        );
        expect(nearest).toBeLessThanOrEqual(
          Math.max(EW_HALF, NS_HALF) + SIDEWALK + 0.01,
        );
      }
    }
  });

  it("never lets a rail encroach on any carriageway", () => {
    const graph = buildPavementGraph(CROSSROADS, { sidewalkWidthM: SIDEWALK });
    for (const edge of graph.edges) {
      for (const point of edge.points) {
        for (const surface of CROSSROADS) {
          expect(
            onCarriageway(point, surface, 0.3),
            `edge ${edge.id} vs ${surface.id}`,
          ).toBe(false);
        }
      }
    }
  });

  it("rounds each block corner with a fillet arc", () => {
    const graph = buildPavementGraph(CROSSROADS, { sidewalkWidthM: SIDEWALK });
    // 8 rail runs (two per arm) + 4 corner links; the corner links carry the
    // arc, so at least four edges must have the arc's 6 vertices.
    const arcs = graph.edges.filter((edge) => edge.points.length >= 6);
    expect(arcs.length).toBeGreaterThanOrEqual(4);
    // Every corner link stays out beyond both kerbs — on the pavement corner.
    for (const edge of arcs) {
      for (const point of edge.points) {
        expect(Math.abs(point.x)).toBeGreaterThan(NS_HALF);
        expect(Math.abs(point.z)).toBeGreaterThan(EW_HALF);
      }
    }
  });

  it("leaves no node a walker can get stuck at", () => {
    const graph = buildPavementGraph(CROSSROADS, { sidewalkWidthM: SIDEWALK });
    for (const node of graph.nodes) {
      expect(node.edgeIds.length, `node ${node.id}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("carries the pavement straight across the mouth of a T-junction", () => {
    const tee: PavementSurface[] = [
      CROSSROADS[0],
      { id: "stem", centerline: [{ x: 0, z: 0 }, { x: 0, z: 40 }], widthM: NS_HALF * 2 },
    ];
    const graph = buildPavementGraph(tee, { sidewalkWidthM: SIDEWALK });
    // The far side of the through road has no stem: its two rail runs must be
    // joined by a straight link along z = -(EW_HALF + SIDEWALK/2).
    const railZ = -(EW_HALF + SIDEWALK / 2);
    const throughLink = graph.edges.find(
      (edge) =>
        edge.points.every((point) => Math.abs(point.z - railZ) < 0.01) &&
        edge.points[0].x * edge.points.at(-1)!.x < 0,
    );
    expect(throughLink).toBeDefined();
  });

  it("turns a walker around at a dead end instead of stranding them", () => {
    const lone: PavementSurface[] = [CROSSROADS[0]];
    const graph = buildPavementGraph(lone, { sidewalkWidthM: SIDEWALK });
    // Two rails + two end caps forming one loop around the whole road.
    expect(graph.edges).toHaveLength(4);
    for (const node of graph.nodes) {
      expect(node.edgeIds.length).toBe(2);
    }
    const [total] = componentLengths(graph);
    const railOffset = EW_HALF + SIDEWALK / 2;
    expect(total).toBeGreaterThan(2 * 80 + 2 * Math.PI * railOffset * 0.9);
  });

  it("squares off the outside of a bend between two surfaces", () => {
    const bend: PavementSurface[] = [
      { id: "west", centerline: [{ x: -40, z: 0 }, { x: 0, z: 0 }], widthM: EW_HALF * 2 },
      { id: "north", centerline: [{ x: 0, z: 0 }, { x: 0, z: 40 }], widthM: EW_HALF * 2 },
    ];
    const graph = buildPavementGraph(bend, { sidewalkWidthM: SIDEWALK });
    const railOffset = EW_HALF + SIDEWALK / 2;
    // The outside link passes through the miter point at (railOffset, -railOffset).
    const miter = graph.edges.some((edge) =>
      edge.points.some(
        (point) =>
          Math.abs(point.x - railOffset) < 0.05 && Math.abs(point.z + railOffset) < 0.05,
      ),
    );
    expect(miter).toBe(true);
    for (const node of graph.nodes) {
      expect(node.edgeIds.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps a ring walkable, including the seam an approach joins at", () => {
    const ring: PavementSurface[] = [
      {
        id: "ring",
        centerline: [
          { x: 0, z: 20 }, { x: 20, z: 0 }, { x: 0, z: -20 }, { x: -20, z: 0 },
          { x: 0, z: 20 },
        ],
        widthM: 7.2,
      },
      { id: "approach", centerline: [{ x: 0, z: 20 }, { x: 0, z: 60 }], widthM: 7.2 },
    ];
    const graph = buildPavementGraph(ring, { sidewalkWidthM: 1.2 });
    for (const node of graph.nodes) {
      expect(node.edgeIds.length, `node ${node.id}`).toBeGreaterThanOrEqual(2);
    }
    // The ring's outer rail must survive as runs on both sides of the seam;
    // total pavement length has to comfortably exceed the approach's alone.
    const lengths = componentLengths(graph);
    expect(Math.max(...lengths)).toBeGreaterThan(80);
  });

  it("emits one closed loop per side for a lone ring", () => {
    const ring: PavementSurface[] = [
      {
        id: "ring",
        centerline: [
          { x: 0, z: 20 }, { x: 20, z: 0 }, { x: 0, z: -20 }, { x: -20, z: 0 },
          { x: 0, z: 20 },
        ],
        widthM: 7.2,
      },
    ];
    const graph = buildPavementGraph(ring, { sidewalkWidthM: 1.2 });
    expect(graph.edges).toHaveLength(2);
    for (const edge of graph.edges) {
      expect(edge.closed).toBe(true);
      expect(edge.a).toBe(edge.b);
      // The polyline closes on itself so sampling wraps seamlessly.
      const start = samplePavementEdge(edge, 0);
      const end = samplePavementEdge(edge, edge.lengthM);
      expect(Math.hypot(start.x - end.x, start.z - end.z)).toBeLessThan(1e-6);
    }
  });

  it("is deterministic", () => {
    const first = buildPavementGraph(CROSSROADS, { sidewalkWidthM: SIDEWALK });
    const second = buildPavementGraph(CROSSROADS, { sidewalkWidthM: SIDEWALK });
    expect(first).toEqual(second);
  });

  it("finds every junction the asphalt fill paves, on every kept map", () => {
    // The pavement graph may know a FEW more junctions than the fill: a road
    // end recentred off the shared node (Cromwell Road) or a vertex landing on
    // another road's asphalt mid-segment (the quiet loop's corner) are
    // physical crossings the fill papers over with overlapping strips, but a
    // walker has to be routed around them. It must never know fewer.
    for (const { pack, sidewalkWidthM } of TARGET_MAPS) {
      const surfaces = pack.geometry.roadSurfaces;
      const graph = buildPavementGraph(surfaces, { sidewalkWidthM });
      const fills = collectRoadJunctionFills(surfaces);
      for (const fill of fills) {
        const match = graph.junctions.some(
          (junction) =>
            Math.hypot(fill.pivot.x - junction.x, fill.pivot.z - junction.z) <= 0.1,
        );
        expect(match, `${pack.id} fill at ${fill.pivot.x},${fill.pivot.z}`).toBe(true);
      }
      expect(graph.junctions.length, pack.id).toBeGreaterThanOrEqual(fills.length);
      expect(graph.junctions.length, pack.id).toBeLessThanOrEqual(fills.length + 2);
    }
  });

  it("keeps every kept map's rails off the carriageways and walkable", () => {
    for (const { pack, sidewalkWidthM } of TARGET_MAPS) {
      const surfaces = pack.geometry.roadSurfaces;
      const graph = buildPavementGraph(surfaces, { sidewalkWidthM });
      expect(graph.edges.length, pack.id).toBeGreaterThan(0);
      const maxRailOffset = Math.max(
        ...surfaces.map((surface) => surface.widthM / 2 + sidewalkWidthM / 2),
      );
      for (const edge of graph.edges) {
        for (const point of edge.points) {
          let nearest = Number.POSITIVE_INFINITY;
          for (const surface of surfaces) {
            nearest = Math.min(nearest, distanceToPolyline(point, surface.centerline));
            expect(
              onCarriageway(point, surface, 0.25),
              `${pack.id} edge ${edge.id} inside ${surface.id}`,
            ).toBe(false);
          }
          // And never wanders off past the building line either. The slack
          // covers the squared-off miter on the outside of a right-angle bend,
          // which legitimately sits railOffset·√2 from the bend node.
          expect(
            nearest,
            `${pack.id} edge ${edge.id} adrift`,
          ).toBeLessThanOrEqual(maxRailOffset * 1.5 + sidewalkWidthM);
        }
      }
      // A rail SEGMENT must not cross a kerb line either — endpoints clear of
      // the asphalt do not prove the straight line between them is.
      for (const edge of graph.edges) {
        for (let i = 0; i + 1 < edge.points.length; i += 1) {
          for (const surface of surfaces) {
            expect(
              segmentCrossesKerb(edge.points[i], edge.points[i + 1], surface),
              `${pack.id} edge ${edge.id} segment ${i} crosses ${surface.id}`,
            ).toBe(false);
          }
        }
      }
      for (const node of graph.nodes) {
        expect(node.edgeIds.length, `${pack.id} node ${node.id}`).toBeGreaterThanOrEqual(2);
      }
      // Every connected piece of pavement is a walkable circuit, not a crumb.
      for (const length of componentLengths(graph)) {
        expect(length, pack.id).toBeGreaterThan(40);
      }
    }
  });
});

describe("samplePavementEdge", () => {
  it("returns the hint-independent pose along a rail", () => {
    const graph = buildPavementGraph(CROSSROADS, { sidewalkWidthM: SIDEWALK });
    const edge = graph.edges.reduce((longest, candidate) =>
      candidate.lengthM > longest.lengthM ? candidate : longest,
    );
    for (let step = 0; step <= 20; step += 1) {
      const s = (edge.lengthM * step) / 20;
      const cold = samplePavementEdge(edge, s);
      const hinted = samplePavementEdge(edge, s, cold.segmentIndex);
      expect(hinted).toEqual(cold);
      // Pose is on the polyline.
      expect(distanceToPolyline({ x: cold.x, z: cold.z }, edge.points)).toBeLessThan(1e-6);
    }
  });

  it("uses the project heading convention (atan2(dx, dz))", () => {
    const graph = buildPavementGraph([CROSSROADS[0]], { sidewalkWidthM: SIDEWALK });
    // The avenue runs +x; its rails must head ±π/2, never 0.
    const rail = graph.edges.find((edge) => edge.points.length > 2)!;
    const pose = samplePavementEdge(rail, rail.lengthM / 2);
    expect(Math.abs(Math.abs(pose.headingRad) - Math.PI / 2)).toBeLessThan(0.01);
  });
});

describe("samplePavementEdgeOffset", () => {
  it("offsets mid-run by exactly the asked lateral, to the heading's right", () => {
    const graph = buildPavementGraph([CROSSROADS[0]], { sidewalkWidthM: SIDEWALK });
    const rail = graph.edges.reduce((longest, candidate) =>
      candidate.lengthM > longest.lengthM ? candidate : longest,
    );
    const s = rail.lengthM / 2;
    const base = samplePavementEdge(rail, s);
    for (const lateral of [0.9, -0.6]) {
      const pose = samplePavementEdgeOffset(rail, s, lateral);
      // Right of travel is (cos h, -sin h) in the heading convention.
      expect(pose.x - base.x).toBeCloseTo(Math.cos(base.headingRad) * lateral, 6);
      expect(pose.z - base.z).toBeCloseTo(-Math.sin(base.headingRad) * lateral, 6);
      expect(pose.headingRad).toBe(base.headingRad);
    }
  });

  it("tapers the offset away at both edge ends", () => {
    const graph = buildPavementGraph([CROSSROADS[0]], { sidewalkWidthM: SIDEWALK });
    const rail = graph.edges.reduce((longest, candidate) =>
      candidate.lengthM > longest.lengthM ? candidate : longest,
    );
    const drift = (s: number) => {
      const base = samplePavementEdge(rail, s);
      const pose = samplePavementEdgeOffset(rail, s, 1);
      return Math.hypot(pose.x - base.x, pose.z - base.z);
    };
    expect(drift(0)).toBe(0);
    expect(drift(rail.lengthM)).toBe(0);
    expect(drift(LATERAL_TAPER_M / 2)).toBeCloseTo(0.5, 6);
    expect(drift(rail.lengthM - LATERAL_TAPER_M / 2)).toBeCloseTo(0.5, 6);
    expect(drift(rail.lengthM / 2)).toBeCloseTo(1, 6);
  });

  it("is hint-independent like the base sampler", () => {
    const graph = buildPavementGraph(CROSSROADS, { sidewalkWidthM: SIDEWALK });
    for (const edge of graph.edges) {
      for (let step = 0; step <= 10; step += 1) {
        const s = (edge.lengthM * step) / 10;
        const cold = samplePavementEdgeOffset(edge, s, 0.7);
        const hinted = samplePavementEdgeOffset(edge, s, 0.7, cold.segmentIndex);
        expect(hinted).toEqual(cold);
      }
    }
  });

  it("never sidesteps: consecutive samples stay within a stride everywhere", () => {
    // A naive per-segment normal pops sideways at each polyline vertex — up
    // to 2·offset·sin(turn/2), ~0.5 m on a fillet arc step. Walked at 5 cm
    // increments with the full band, the offset path must move smoothly.
    const graph = buildPavementGraph(CROSSROADS, { sidewalkWidthM: SIDEWALK });
    const ds = 0.05;
    for (const edge of graph.edges) {
      for (const lateral of [0.9, -0.9]) {
        let previous = samplePavementEdgeOffset(edge, 0, lateral);
        for (let s = ds; s <= edge.lengthM; s += ds) {
          const pose = samplePavementEdgeOffset(edge, s, lateral, previous.segmentIndex);
          const moved = Math.hypot(pose.x - previous.x, pose.z - previous.z);
          expect(moved, `edge ${edge.id} (${edge.kind}) at s=${s.toFixed(2)}`)
            .toBeLessThanOrEqual(ds * 2);
          previous = pose;
        }
      }
    }
  });

  it("keeps a closed ring's seam continuous under offset", () => {
    const ring: PavementSurface[] = [
      {
        id: "ring",
        centerline: [
          { x: 0, z: 20 }, { x: 20, z: 0 }, { x: 0, z: -20 }, { x: -20, z: 0 },
          { x: 0, z: 20 },
        ],
        widthM: 7.2,
      },
    ];
    const graph = buildPavementGraph(ring, { sidewalkWidthM: 1.2 });
    for (const edge of graph.edges) {
      expect(edge.closed).toBe(true);
      const before = samplePavementEdgeOffset(edge, edge.lengthM - 0.05, 0.4);
      const at = samplePavementEdgeOffset(edge, edge.lengthM, 0.4);
      const after = samplePavementEdgeOffset(edge, 0.05, 0.4);
      expect(Math.hypot(before.x - at.x, before.z - at.z)).toBeLessThan(0.1);
      expect(Math.hypot(after.x - at.x, after.z - at.z)).toBeLessThan(0.1);
    }
  });

  it("keeps a fully scattered crowd off every kept map's carriageways", () => {
    // The whole point of the taper and the per-kind scaling: even a walker
    // holding the extreme edge of the scatter band, on every edge of every
    // kept map, never has a foot on the asphalt. Mirrors GameCanvas's
    // crowdScatterHalfM derivation (band half-width minus standing room).
    const violations: string[] = [];
    for (const { pack, sidewalkWidthM } of TARGET_MAPS) {
      const surfaces = pack.geometry.roadSurfaces;
      const graph = buildPavementGraph(surfaces, { sidewalkWidthM });
      const scatterHalf = Math.max(0, sidewalkWidthM / 2 - 0.55);
      if (scatterHalf === 0) continue;
      for (const edge of graph.edges) {
        const band = scatterHalf * EDGE_KIND_SCATTER[edge.kind];
        for (let s = 0; s <= edge.lengthM; s += 0.75) {
          for (const sign of [1, -1]) {
            const pose = samplePavementEdgeOffset(edge, s, sign * band);
            for (const surface of surfaces) {
              if (onCarriageway(pose, surface, 0.05)) {
                violations.push(
                  `${pack.id} edge ${edge.id} (${edge.kind}) s=${s.toFixed(1)} ` +
                    `offset ${(sign * band).toFixed(2)} inside ${surface.id}`,
                );
              }
            }
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
