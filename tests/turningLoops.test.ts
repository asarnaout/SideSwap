import { describe, expect, it } from "vitest";
import { MAP_PACKS, getMapPack } from "../app/game/content";
import type { LaneSegment, MapId, RoadSurface, WorldPoint } from "../app/game/types";

type Pt = { x: number; z: number };
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.z - b.z);

// Shortest distance from point p to segment ab.
function pointSegDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-9) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * dx, z: a.z + t * dz });
}

const end = (cl: readonly WorldPoint[]) => cl[cl.length - 1];
const start = (cl: readonly WorldPoint[]) => cl[0];

// The four dead-end stubs that were converted into single-arm turning loops.
const LOOPS: ReadonlyArray<{
  map: MapId;
  prefix: string;
  arrive: string; // lane arriving at the old dead node (now feeds the loop)
  depart: string; // lane leaving the old dead node (fed by the loop's return arc)
}> = [
  { map: "milton-keynes-oldbrook", prefix: "uk-westloop", arrive: "uk-westgrid-out", depart: "uk-westgrid-in" },
  { map: "calais-coquelles", prefix: "fr-westloop", arrive: "fr-westgrid-out", depart: "fr-westgrid-in" },
  { map: "london-south-kensington", prefix: "london-brompton-loop", arrive: "london-cromwell-east-3", depart: "london-cromwell-west-0" },
  { map: "london-south-kensington", prefix: "london-gloucester-loop", arrive: "london-gloucester-s-2", depart: "london-gloucester-n-1" },
];

describe("turning loops", () => {
  for (const loop of LOOPS) {
    it(`${loop.prefix} forms a drivable one-way ring with no dead-end`, () => {
      const pack = getMapPack(loop.map);
      const lanes = new Map(pack.laneGraph.lanes.map((l) => [l.id, l]));
      const surfaces = new Map(pack.geometry.roadSurfaces.map((s) => [s.id, s]));
      const a = lanes.get(`${loop.prefix}-a`) as LaneSegment;
      const b = lanes.get(`${loop.prefix}-b`) as LaneSegment;
      const arrive = lanes.get(loop.arrive) as LaneSegment;
      const depart = lanes.get(loop.depart) as LaneSegment;
      const ring = surfaces.get(loop.prefix) as RoadSurface;
      expect(a, `${loop.prefix}-a`).toBeDefined();
      expect(b, `${loop.prefix}-b`).toBeDefined();
      expect(arrive, loop.arrive).toBeDefined();
      expect(depart, loop.depart).toBeDefined();
      expect(ring, loop.prefix).toBeDefined();

      // The old dead-end now feeds the loop instead of terminating (was []).
      expect(arrive.successors).toContain(`${loop.prefix}-a`);
      // The ring cycles: a -> b -> back into the network via the departing lane.
      expect(a.successors).toEqual([`${loop.prefix}-b`]);
      expect(b.successors).toContain(loop.depart);
      // The network is never left dangling: the departing lane keeps flowing.
      expect(depart.successors.length).toBeGreaterThan(0);

      // Sim continuity: every successor's start is within 0.5 m of its source end.
      expect(dist(end(arrive.centerline), start(a.centerline))).toBeLessThan(0.5);
      expect(dist(end(a.centerline), start(b.centerline))).toBeLessThan(0.5);
      expect(dist(end(b.centerline), start(depart.centerline))).toBeLessThan(0.5);

      // The ring surface is a closed loop that hosts both arcs.
      expect(ring.surfaceType).toBe("roundabout");
      expect(ring.laneIds).toEqual([`${loop.prefix}-a`, `${loop.prefix}-b`]);
      expect(dist(start(ring.centerline), end(ring.centerline))).toBeLessThan(0.5);
      // Both arcs lie within the ring's paved width.
      for (const arc of [a, b]) {
        for (const p of arc.centerline) {
          let minToRing = Infinity;
          for (let i = 0; i + 1 < ring.centerline.length; i += 1) {
            minToRing = Math.min(minToRing, pointSegDist(p, ring.centerline[i], ring.centerline[i + 1]));
          }
          expect(minToRing + arc.widthM / 2).toBeLessThanOrEqual(ring.widthM / 2 + 0.6);
        }
      }
    });
  }

  it("leaves no road surface dead-ending in open ground (interior stubs)", () => {
    const offenders: string[] = [];
    for (const pack of MAP_PACKS) {
      const surfaces = pack.geometry.roadSurfaces ?? [];
      const halfW = pack.geometry.worldSize.x / 2;
      // worldSize is a WorldPoint {x, z}; its second axis is `z`.
      const halfZ = (pack.geometry.worldSize as unknown as { z: number }).z / 2;
      for (const s of surfaces) {
        const cl = s.centerline as readonly Pt[];
        if (cl.length < 2) continue;
        if (dist(cl[0], cl[cl.length - 1]) < 0.08) continue; // closed ring, no ends
        for (const node of [cl[0], cl[cl.length - 1]]) {
          let minOther = Infinity;
          for (const o of surfaces) {
            if (o.id === s.id) continue;
            const ocl = o.centerline as readonly Pt[];
            for (let i = 0; i + 1 < ocl.length; i += 1) {
              minOther = Math.min(minOther, pointSegDist(node, ocl[i], ocl[i + 1]));
            }
          }
          const edgeGap = Math.min(halfW - Math.abs(node.x), halfZ - Math.abs(node.z));
          // An interior dead-end is isolated from other roads AND well inside the
          // world (roads that reach the map edge legitimately run off it).
          if (minOther > (s.widthM ?? 7) && edgeGap > 25) {
            offenders.push(`${pack.id}/${s.id} @ (${node.x.toFixed(0)},${node.z.toFixed(0)})`);
          }
        }
      }
    }
    expect(offenders, `interior dead-ends: ${offenders.join(", ")}`).toEqual([]);
  });
});
