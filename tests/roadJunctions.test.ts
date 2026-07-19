import { describe, expect, it } from "vitest";
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
});
