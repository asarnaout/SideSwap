import { describe, expect, it } from "vitest";
import { MAP_PACKS, getMapPack } from "../app/game/content";
import {
  buildRoadSurfaceStripGeometry,
  collectRoadJunctionFills,
  computeRouteChevronPlacements,
  smoothClosedRoadCenterline,
  type GameCanvasLane,
} from "../app/game/GameCanvas";
import { isPointInPolygon } from "../app/game/simulation";

interface Point {
  readonly x: number;
  readonly z: number;
}

const polylineLength = (points: readonly Point[]): number =>
  points.slice(1).reduce(
    (total, point, index) =>
      total + Math.hypot(point.x - points[index].x, point.z - points[index].z),
    0,
  );

const isAuthoredLoop = (centerline: readonly Point[]): boolean => {
  const first = centerline[0];
  const last = centerline.at(-1);
  return Boolean(
    first &&
      last &&
      centerline.length > 3 &&
      Math.hypot(first.x - last.x, first.z - last.z) <= 0.08,
  );
};

/**
 * Mirrors the renderer's visibility model in updateGuidanceVisuals: while the
 * player is at distance d on the active occurrence, chevrons on that lane are
 * visible in (d + 2, d + 58) and the first 42 m of the next occurrence is
 * always previewed.
 */
const FORWARD_WINDOW_M = 58;
const NEXT_LANE_PREVIEW_M = 42;
/** The finish gate / final checkpoint covers the tail of the last lane. */
const FINAL_TAIL_ALLOWANCE_M = 24;

describe("road surface continuity on every map", () => {
  it("renders every authored loop closed and every surface non-empty", () => {
    for (const mapPack of MAP_PACKS) {
      for (const surface of mapPack.geometry.roadSurfaces) {
        const isRoundabout = surface.surfaceType === "roundabout";
        // Exactly the policy used by createRoadSurfaceMesh.
        const geometry = buildRoadSurfaceStripGeometry(
          isRoundabout
            ? smoothClosedRoadCenterline(surface.centerline)
            : surface.centerline,
          surface.widthM,
          isRoundabout ? true : undefined,
        );
        expect(
          geometry.positions.length,
          `${mapPack.id}/${surface.id} produced empty road geometry`,
        ).toBeGreaterThan(0);
        expect(
          geometry.closed,
          `${mapPack.id}/${surface.id} authored ${
            isAuthoredLoop(surface.centerline) ? "a loop" : "an open road"
          } but rendered ${geometry.closed ? "closed" : "open"}`,
        ).toBe(isRoundabout || isAuthoredLoop(surface.centerline));
      }
    }
  });
});
