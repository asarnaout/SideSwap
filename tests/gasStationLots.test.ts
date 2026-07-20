import { describe, expect, it } from "vitest";
import { MAP_PACKS } from "../app/game/content";
import { resolveSimulationLaneAnchor } from "../app/game/simulationAdapter";
import type { ProceduralMapGeometry, WorldPoint } from "../app/game/types";

/**
 * Every gas station is a square glb lot dropped beside a lane. It has to land
 * in the same place on all five maps: hard against the dirt shoulder, never on
 * it and never floating out in a field. Judging that by eye took hours per
 * city, so the rule is pinned down numerically here instead.
 */

// The model rides on a square base slab that measures 23.28 m a side once the
// prop registry's 2.8x scale is applied, so the lot reaches 11.64 m out from
// the anchored centre in every direction.
const LOT_HALF_M = 11.64;
// GameCanvas floors the authored shoulder width when it builds the dirt band.
const shoulderWidthFor = (geometry: ProceduralMapGeometry): number =>
  Math.max(0.9, geometry.shoulderWidth ?? 1.2);
// Mirrors the fallback in GameCanvas's service-point loop.
const DEFAULT_SETBACK_M = 16;
// A lot further than this from its nearest road reads as an orphaned slab in a
// field rather than a forecourt on the kerb.
const MAX_KERB_GAP_M = 0.6;

type LotPoint = { readonly u: number; readonly v: number };

/** Projects a world point into the lot's own frame (u = right, v = forward). */
const toLotFrame = (
  point: WorldPoint,
  centre: WorldPoint,
  heading: number,
): LotPoint => {
  const dx = point.x - centre.x;
  const dz = point.z - centre.z;
  return {
    u: dx * Math.cos(heading) - dz * Math.sin(heading),
    v: dx * Math.sin(heading) + dz * Math.cos(heading),
  };
};

/** Liang-Barsky clip: does the segment touch the square centred on the origin? */
const segmentTouchesLot = (a: LotPoint, b: LotPoint, half: number): boolean => {
  const du = b.u - a.u;
  const dv = b.v - a.v;
  const edges: readonly (readonly [number, number])[] = [
    [-du, a.u + half],
    [du, half - a.u],
    [-dv, a.v + half],
    [dv, half - a.v],
  ];
  let enter = 0;
  let exit = 1;
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > exit) return false;
      if (t > enter) enter = t;
    } else {
      if (t < enter) return false;
      if (t < exit) exit = t;
    }
  }
  return enter <= exit;
};

const pointToLotDistance = (p: LotPoint, half: number): number =>
  Math.hypot(Math.max(Math.abs(p.u) - half, 0), Math.max(Math.abs(p.v) - half, 0));

const pointToSegmentDistance = (p: LotPoint, a: LotPoint, b: LotPoint): number => {
  const du = b.u - a.u;
  const dv = b.v - a.v;
  const lengthSquared = du * du + dv * dv;
  if (lengthSquared < 1e-12) return Math.hypot(p.u - a.u, p.v - a.v);
  const t = Math.min(
    1,
    Math.max(0, ((p.u - a.u) * du + (p.v - a.v) * dv) / lengthSquared),
  );
  return Math.hypot(p.u - (a.u + du * t), p.v - (a.v + dv * t));
};

/**
 * Exact 2D distance between a segment and the lot square. Two disjoint convex
 * shapes always realise their gap at a vertex of one against the other, so the
 * endpoints and the four corners cover every case once overlap is ruled out.
 */
const segmentToLotDistance = (a: LotPoint, b: LotPoint, half: number): number => {
  if (segmentTouchesLot(a, b, half)) return 0;
  const corners: readonly LotPoint[] = [
    { u: -half, v: -half },
    { u: half, v: -half },
    { u: half, v: half },
    { u: -half, v: half },
  ];
  return Math.min(
    pointToLotDistance(a, half),
    pointToLotDistance(b, half),
    ...corners.map((corner) => pointToSegmentDistance(corner, a, b)),
  );
};

describe("gas-station lots", () => {
  it("parks every lot hard against the shoulder without touching it", () => {
    const reviewed: string[] = [];

    for (const pack of MAP_PACKS) {
      const shoulderWidth = shoulderWidthFor(pack.geometry);
      const stations = (pack.geometry.servicePoints ?? []).filter(
        (service) => service.kind === "gas_station",
      );
      expect(stations.length, `${pack.id} has no gas station`).toBeGreaterThan(0);

      for (const station of stations) {
        const pose = resolveSimulationLaneAnchor(pack.laneGraph.lanes, station.anchor);
        expect(pose, `${station.id} anchor does not resolve`).not.toBeNull();
        if (!pose) continue;

        // Matches GameCanvas: the lot is set back along the right-hand normal.
        const setback = station.setbackM ?? DEFAULT_SETBACK_M;
        const centre: WorldPoint = {
          x: pose.x + Math.cos(pose.heading) * setback,
          z: pose.z - Math.sin(pose.heading) * setback,
        };

        let nearestGap = Number.POSITIVE_INFINITY;
        let nearestSurfaceId = "";
        for (const surface of pack.geometry.roadSurfaces) {
          // The drivable strip plus its dirt shoulder, either side of centre.
          const reach = surface.widthM / 2 + shoulderWidth;
          for (let index = 0; index < surface.centerline.length - 1; index += 1) {
            const gap =
              segmentToLotDistance(
                toLotFrame(surface.centerline[index], centre, pose.heading),
                toLotFrame(surface.centerline[index + 1], centre, pose.heading),
                LOT_HALF_M,
              ) - reach;
            if (gap < nearestGap) {
              nearestGap = gap;
              nearestSurfaceId = surface.id;
            }
          }
        }

        expect(
          nearestGap,
          `${station.id} bleeds ${(-nearestGap).toFixed(2)}m into ${nearestSurfaceId}`,
        ).toBeGreaterThanOrEqual(0);
        expect(
          nearestGap,
          `${station.id} floats ${nearestGap.toFixed(2)}m off ${nearestSurfaceId}`,
        ).toBeLessThanOrEqual(MAX_KERB_GAP_M);
        reviewed.push(station.id);
      }
    }

    expect(reviewed).toHaveLength(MAP_PACKS.length);
  });
});
