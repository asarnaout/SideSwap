import { describe, expect, it } from "vitest";
import { LESSONS, MAP_PACKS, getMapPack } from "../app/game/content";
import {
  buildRoadSurfaceStripGeometry,
  collectRoadJunctionPatches,
  computeRouteChevronPlacements,
  smoothClosedRoadCenterline,
  type GameCanvasLane,
} from "../app/game/GameCanvas";

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

  it("keeps every lesson route transition on one surface or under a junction apron", () => {
    for (const lesson of LESSONS) {
      const mapPack = getMapPack(lesson.mapId);
      const patches = collectRoadJunctionPatches(mapPack.geometry.roadSurfaces);
      const surfaceForLane = new Map<string, string>();
      for (const surface of mapPack.geometry.roadSurfaces) {
        for (const laneId of surface.laneIds) {
          surfaceForLane.set(laneId, surface.id);
        }
      }
      for (const [index, laneId] of lesson.route.entries()) {
        expect(
          surfaceForLane.has(laneId),
          `${lesson.id}: route lane ${laneId} belongs to no road surface`,
        ).toBe(true);
        if (index === 0) continue;
        const previousLaneId = lesson.route[index - 1];
        if (surfaceForLane.get(previousLaneId) === surfaceForLane.get(laneId)) {
          continue;
        }
        const previousLane = mapPack.laneGraph.lanes.find(
          (lane) => lane.id === previousLaneId,
        );
        const transition = previousLane?.centerline.at(-1);
        expect(transition).toBeDefined();
        const covered = patches.some(
          (patch) =>
            Math.hypot(patch.x - transition!.x, patch.z - transition!.z) <=
            patch.radiusM,
        );
        expect(
          covered,
          `${lesson.id}: transition ${previousLaneId} -> ${laneId} crosses surfaces with no junction apron`,
        ).toBe(true);
      }
    }
  });
});

describe("route guidance coverage on every lesson", () => {
  it("always keeps at least one arrow inside the player's forward window", () => {
    for (const lesson of LESSONS) {
      const mapPack = getMapPack(lesson.mapId);
      const lanesById = new Map(
        mapPack.laneGraph.lanes.map((lane) => [lane.id, lane]),
      );
      const spawn = mapPack.laneGraph.spawnPoints.find(
        (point) => point.id === lesson.startSpawnId,
      );
      const spawnDistance =
        spawn && "anchor" in spawn && spawn.anchor.laneId === lesson.route[0]
          ? spawn.anchor.distanceAlongM
          : 0;

      const occurrences = lesson.route.map((laneId) => {
        const lane = lanesById.get(laneId);
        expect(lane, `${lesson.id}: missing route lane ${laneId}`).toBeDefined();
        return {
          laneId,
          length: polylineLength(lane!.centerline),
          placements: computeRouteChevronPlacements(
            lane as unknown as GameCanvasLane,
            mapPack.laneGraph.conflictZones,
          ).map((placement) => placement.distanceAlongM),
        };
      });

      for (const [index, occurrence] of occurrences.entries()) {
        const next = occurrences[index + 1];
        const guidancePoints = [
          ...occurrence.placements,
          ...(next
            ? next.placements
                .filter((distance) => distance < NEXT_LANE_PREVIEW_M)
                .map((distance) => occurrence.length + distance)
            : []),
        ].sort((left, right) => left - right);

        const startAt = index === 0 ? spawnDistance : 0;
        const checkUntil = next
          ? occurrence.length
          : Math.max(startAt, occurrence.length - FINAL_TAIL_ALLOWANCE_M);
        for (let d = startAt; d <= checkUntil; d += 1) {
          const visible = guidancePoints.some(
            (point) => point > d + 2 && point < d + FORWARD_WINDOW_M,
          );
          expect(
            visible,
            `${lesson.id}: no arrow visible at ${Math.round(d)} m along occurrence ${index} (${occurrence.laneId}, ${Math.round(occurrence.length)} m long)`,
          ).toBe(true);
        }
      }
    }
  });
});
