import { describe, expect, it } from "vitest";
import { MAP_PACKS } from "../app/game/content";
import {
  collectRoadJunctionFills,
  type RoadJunctionSource,
} from "../app/game/GameCanvas";

type Pt = { x: number; z: number };

// Even-odd ray cast; true when p is strictly inside the polygon.
function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const straddles = a.z > p.z !== b.z > p.z;
    if (straddles && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

// A perpendicular 4-way: an E-W avenue and a N-S street sharing node (0,0).
const EW_HALF = 3.2;
const NS_HALF = 2.9;
const CROSSROADS: RoadJunctionSource[] = [
  { id: "ew", centerline: [{ x: -40, z: 0 }, { x: 0, z: 0 }, { x: 40, z: 0 }], widthM: EW_HALF * 2 },
  { id: "ns", centerline: [{ x: 0, z: -40 }, { x: 0, z: 0 }, { x: 0, z: 40 }], widthM: NS_HALF * 2 },
];

describe("collectRoadJunctionFills", () => {
  it("emits exactly one fill where two roads share a crossing node", () => {
    const fills = collectRoadJunctionFills(CROSSROADS);
    expect(fills).toHaveLength(1);
    expect(fills[0].polygon.length).toBeGreaterThanOrEqual(4);
  });

  it("covers all four corner throats so no shoulder shows through as a wedge", () => {
    // The throats are where the carriageway edges cross: (±NS_HALF, ±EW_HALF).
    // These being *inside* the fill is precisely the bug fix — a short-reach hull
    // chamfered them off and left the tan shoulder exposed.
    const [fill] = collectRoadJunctionFills(CROSSROADS);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const throat = { x: sx * (NS_HALF - 0.1), z: sz * (EW_HALF - 0.1) };
        expect(pointInPolygon(throat, fill.polygon)).toBe(true);
      }
    }
  });

  it("does not pave a lone road that crosses nothing", () => {
    expect(collectRoadJunctionFills([CROSSROADS[0]])).toHaveLength(0);
  });

  it("covers the throat of a T-junction where a side road ends on an avenue", () => {
    const tee: RoadJunctionSource[] = [
      CROSSROADS[0], // E-W avenue passing through (0,0)
      { id: "branch", centerline: [{ x: 0, z: 0 }, { x: 0, z: 40 }], widthM: NS_HALF * 2 },
    ];
    const fills = collectRoadJunctionFills(tee);
    expect(fills).toHaveLength(1);
    // The two throats on the branch side must be paved.
    for (const sx of [-1, 1]) {
      expect(
        pointInPolygon({ x: sx * (NS_HALF - 0.1), z: EW_HALF - 0.1 }, fills[0].polygon),
      ).toBe(true);
    }
  });

  it("grows the fill when the sections are inflated for the dirt-shoulder apron", () => {
    const [asphalt] = collectRoadJunctionFills(CROSSROADS, 0);
    const [shoulder] = collectRoadJunctionFills(CROSSROADS, 1.2);
    const spanX = (poly: readonly Pt[]) =>
      Math.max(...poly.map((p) => p.x)) - Math.min(...poly.map((p) => p.x));
    // The inflated apron must extend beyond the bare carriageway fill so it can
    // ring the paved junction with a tan edge.
    expect(spanX(shoulder.polygon)).toBeGreaterThan(spanX(asphalt.polygon));
  });

  it("leaves the pavement corner between the arms unpaved", () => {
    // The reported bug. A convex hull spans the four arms and so swallows the
    // corners between them — the exact ground the traffic-light pole, the
    // streetlight and the waiting pedestrians stand on. A crossroads is a plus.
    const [fill] = collectRoadJunctionFills(CROSSROADS);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const corner = { x: sx * (NS_HALF + 1.5), z: sz * (EW_HALF + 1.5) };
        expect(pointInPolygon(corner, fill.polygon)).toBe(false);
      }
    }
  });

  it("rounds each corner off with a kerb radius", () => {
    const [rounded] = collectRoadJunctionFills(CROSSROADS);
    const [square] = collectRoadJunctionFills(CROSSROADS, 0, 0);
    // Just diagonally outside the sharp corner: asphalt once the kerb curves,
    // pavement when it does not.
    const justOutside = { x: NS_HALF + 0.3, z: EW_HALF + 0.3 };
    expect(pointInPolygon(justOutside, rounded.polygon)).toBe(true);
    expect(pointInPolygon(justOutside, square.polygon)).toBe(false);
  });

  it("closes the notch on the outside of a bend between two surfaces", () => {
    // Two roads meeting end-to-end at a right angle cover the inside of the
    // turn twice over and the outside not at all; the fill has to chamfer it.
    const bend: RoadJunctionSource[] = [
      { id: "west", centerline: [{ x: -40, z: 0 }, { x: 0, z: 0 }], widthM: EW_HALF * 2 },
      { id: "north", centerline: [{ x: 0, z: 0 }, { x: 0, z: 40 }], widthM: EW_HALF * 2 },
    ];
    const [fill] = collectRoadJunctionFills(bend);
    expect(pointInPolygon({ x: EW_HALF - 0.3, z: -EW_HALF + 0.3 }, fill.polygon)).toBe(true);
  });

  it("paves both sides of a ring at the node an approach joins", () => {
    // A roundabout centreline is a closed loop, so its first point has a
    // carriageway either side of it. Treating it as a dead end bites a wedge
    // out of the ring at the one node that always has an approach on it.
    const ring: RoadJunctionSource[] = [
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
    const [fill] = collectRoadJunctionFills(ring);
    // A step along the ring either way from the seam has to be inside the fill.
    for (const sx of [-1, 1]) {
      expect(
        pointInPolygon({ x: sx * 3, z: 20 - 3 }, fill.polygon),
        `ring side ${sx}`,
      ).toBe(true);
    }
  });

  it("keeps every authored junction's corners walkable", () => {
    for (const pack of MAP_PACKS) {
      const surfaces = pack.geometry.roadSurfaces ?? [];
      if (!surfaces.length) continue;
      for (const fill of collectRoadJunctionFills(surfaces)) {
        // No junction may pave a disc wider than the widest carriageway that
        // meets it, plus its kerb radius — anything more is eating pavement.
        const widest = Math.max(
          ...surfaces
            .filter((surface) =>
              surface.centerline.some(
                (point) =>
                  Math.hypot(point.x - fill.pivot.x, point.z - fill.pivot.z) <= 0.08,
              ),
            )
            .map((surface) => surface.widthM / 2),
        );
        for (const point of fill.polygon) {
          const lateral = Math.min(
            Math.abs(point.x - fill.pivot.x),
            Math.abs(point.z - fill.pivot.z),
          );
          expect(
            lateral,
            `${pack.id} junction at ${fill.pivot.x},${fill.pivot.z}`,
          ).toBeLessThanOrEqual(widest + 3.6);
        }
      }
    }
  });
});
