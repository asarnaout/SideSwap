import { describe, expect, it } from "vitest";
import {
  COUNTRY_PROFILES,
  LESSONS,
  MAP_PACKS,
  getCountryProfile,
  getLesson,
  getMapPack,
  getOrientationForTrafficSide,
  resolveSteeringSide,
} from "../app/game/content";

describe("SideSwap content", () => {
  it("ships the four destinations and complete 15-lesson curriculum", () => {
    expect(COUNTRY_PROFILES.map((country) => country.id)).toEqual([
      "us",
      "uk",
      "fr",
      "jp",
    ]);
    expect(LESSONS).toHaveLength(15);
    expect(MAP_PACKS).toHaveLength(6);
    expect(getLesson("uk-fr-side-swap").profileTransitions).toHaveLength(1);
  });

  it("keeps traffic side independent from steering-wheel side", () => {
    const us = getCountryProfile("us");
    const uk = getCountryProfile("uk");
    expect(us.trafficSide).toBe("right");
    expect(us.defaultSteeringSide).toBe("left");
    expect(uk.trafficSide).toBe("left");
    expect(uk.defaultSteeringSide).toBe("right");
    expect(resolveSteeringSide("right", us)).toBe("right");
    expect(us.trafficSide).toBe("right");
  });

  it("resolves every traffic-side and steering-side combination independently", () => {
    for (const country of COUNTRY_PROFILES) {
      expect(resolveSteeringSide("auto", country)).toBe(
        country.defaultSteeringSide,
      );
      expect(resolveSteeringSide("left", country)).toBe("left");
      expect(resolveSteeringSide("right", country)).toBe("right");
      expect(country.trafficSide).toBe(
        country.id === "us" || country.id === "fr" ? "right" : "left",
      );
    }
  });

  it("maps each traffic side to its mirrored orientation", () => {
    expect(getOrientationForTrafficSide("right").id).toBe("orientation-right");
    expect(getOrientationForTrafficSide("left").id).toBe("orientation-left");
  });

  it("links every assessed lesson to reviewed official sources", () => {
    for (const lesson of LESSONS) {
      expect(lesson.sourceReferenceIds.length).toBeGreaterThan(0);
      for (const sourceId of lesson.sourceReferenceIds) {
        const source = COUNTRY_PROFILES.flatMap(
          (country) => country.officialReferences,
        ).find((candidate) => candidate.id === sourceId);
        expect(source, `${lesson.id} → ${sourceId}`).toBeDefined();
        expect(source?.url.startsWith("https://")).toBe(true);
        expect(source?.reviewedOn).toBe("2026-07-10");
      }
    }
  });

  it("validates lane references, legal successors, controls, and checkpoints", () => {
    const invalidSuccessors: string[] = [];
    for (const map of MAP_PACKS) {
      const lanes = new Map(map.laneGraph.lanes.map((lane) => [lane.id, lane]));
      const conflicts = new Set(
        map.laneGraph.conflictZones.map((zone) => zone.id),
      );

      for (const lane of map.laneGraph.lanes) {
        expect(lane.centerline.length, lane.id).toBeGreaterThanOrEqual(2);
        for (const successorId of lane.successors) {
          const successor = lanes.get(successorId);
          if (!successor) {
            invalidSuccessors.push(`${lane.id} → missing ${successorId}`);
            continue;
          }
          const end = lane.centerline.at(-1)!;
          const start = successor.centerline[0];
          if (Math.hypot(end.x - start.x, end.z - start.z) >= 0.01) {
            invalidSuccessors.push(`${lane.id} ⇥ ${successorId}`);
          }
        }
      }

      for (const control of map.laneGraph.controls) {
        for (const laneId of control.laneIds) {
          expect(lanes.has(laneId), `${control.id} → ${laneId}`).toBe(true);
        }
        for (const conflictId of control.conflictZoneIds ?? []) {
          expect(
            conflicts.has(conflictId),
            `${control.id} → ${conflictId}`,
          ).toBe(true);
        }
      }

      for (const checkpoint of map.laneGraph.checkpoints) {
        expect(
          lanes.has(checkpoint.laneId),
          `${checkpoint.id} → ${checkpoint.laneId}`,
        ).toBe(true);
      }
    }
    expect(invalidSuccessors).toEqual([]);
  });

  it("keeps every lesson route connected and inside its declared map", () => {
    const brokenRoutes: string[] = [];
    for (const lesson of LESSONS) {
      const map = getMapPack(lesson.mapId);
      const lanes = new Map(map.laneGraph.lanes.map((lane) => [lane.id, lane]));
      for (const laneId of lesson.route) {
        expect(lanes.has(laneId), `${lesson.id} → ${laneId}`).toBe(true);
      }
      for (let index = 0; index < lesson.route.length - 1; index += 1) {
        const lane = lanes.get(lesson.route[index])!;
        const successorId = lesson.route[index + 1];
        if (!lane.successors.includes(successorId)) {
          brokenRoutes.push(`${lesson.id}: ${lane.id} ⇥ ${successorId}`);
        }
      }
      const checkpointIds = new Set(
        map.laneGraph.checkpoints.map((checkpoint) => checkpoint.id),
      );
      for (const checkpointId of lesson.checkpoints) {
        expect(
          checkpointIds.has(checkpointId),
          `${lesson.id} → ${checkpointId}`,
        ).toBe(true);
      }
    }
    expect(brokenRoutes).toEqual([]);
  });
});
