import { describe, expect, it } from "vitest";
import { MAP_PACKS } from "../app/game/content";
import {
  buildRoadSurfaceStripGeometry,
  smoothClosedRoadCenterline,
} from "../app/game/GameCanvas";

interface Point {
  readonly x: number;
  readonly z: number;
}

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
