import { describe, expect, it } from "vitest";
import {
  COUNTRY_PROFILES,
  FREE_DRIVES,
  LESSONS,
  MAP_PACKS,
  getCountryProfile,
  getLesson,
  getMapPack,
  getOrientationForTrafficSide,
  isScenarioCompatibleWithCountry,
  resolveSessionConfig,
  resolveSteeringSide,
} from "../app/game/content";
import type {
  CountryId,
  GameSessionConfig,
  ScenarioId,
  SteeringPreference,
} from "../app/game/types";

const sessionConfig = (
  countryId: CountryId,
  scenarioId: ScenarioId,
  steeringPreference: SteeringPreference = "auto",
): GameSessionConfig => ({
  countryId,
  scenarioId,
  familiarTrafficSide: "right",
  steeringPreference,
  camera: "third_person",
  inputFamily: "keyboard",
  assistance: {
    coachPrompts: true,
    subtitles: true,
    wrongSideWarnings: true,
    autoResetAfterCriticalError: true,
    reducedMotion: false,
  },
});

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

  it("resolves shared orientations against the selected destination", () => {
    for (const country of COUNTRY_PROFILES) {
      for (const orientationId of [
        "orientation-right",
        "orientation-left",
      ] as const) {
        const expected = orientationId.endsWith(country.trafficSide);
        expect(
          isScenarioCompatibleWithCountry(orientationId, country.id),
        ).toBe(expected);

        if (expected) {
          const resolved = resolveSessionConfig(
            sessionConfig(country.id, orientationId),
          );
          expect(resolved.countryId).toBe(country.id);
          expect(resolved.trafficSide).toBe(country.trafficSide);
          expect(resolved.steeringSide).toBe(country.defaultSteeringSide);
          expect(resolved.speedUnit).toBe(country.speedUnit);
        } else {
          expect(() =>
            resolveSessionConfig(sessionConfig(country.id, orientationId)),
          ).toThrow(/not compatible/);
        }
      }
    }
  });

  it("accepts every jurisdiction scenario only for its own destination", () => {
    const countryScenarios = [
      ...LESSONS.filter((lesson) => lesson.countryId),
      ...FREE_DRIVES,
    ];

    for (const scenario of countryScenarios) {
      for (const country of COUNTRY_PROFILES) {
        expect(
          isScenarioCompatibleWithCountry(scenario.id, country.id),
          `${scenario.id} with ${country.id}`,
        ).toBe(scenario.countryId === country.id);
      }
    }
  });

  it("rejects traffic-side and destination mismatches", () => {
    expect(() =>
      resolveSessionConfig(sessionConfig("us", "orientation-left")),
    ).toThrow(/not compatible/);
    expect(() =>
      resolveSessionConfig(sessionConfig("uk", "us-one-way-grid")),
    ).toThrow(/not compatible/);
    expect(() => resolveSessionConfig(sessionConfig("fr", "free-jp"))).toThrow(
      /not compatible/,
    );
  });

  it("keeps wheel overrides independent in every valid country session", () => {
    for (const country of COUNTRY_PROFILES) {
      const orientationId =
        country.trafficSide === "right" ? "orientation-right" : "orientation-left";
      for (const steeringPreference of ["left", "right"] as const) {
        const resolved = resolveSessionConfig(
          sessionConfig(country.id, orientationId, steeringPreference),
        );
        expect(resolved.steeringSide).toBe(steeringPreference);
        expect(resolved.trafficSide).toBe(country.trafficSide);
      }
    }
  });

  it("starts the travel-transition capstone with the UK profile only", () => {
    expect(isScenarioCompatibleWithCountry("uk-fr-side-swap", "uk")).toBe(true);
    for (const countryId of ["us", "fr", "jp"] as const) {
      expect(isScenarioCompatibleWithCountry("uk-fr-side-swap", countryId)).toBe(
        false,
      );
    }

    const resolved = resolveSessionConfig(
      sessionConfig("uk", "uk-fr-side-swap"),
    );
    expect(resolved.trafficSide).toBe("left");
    expect(resolved.speedUnit).toBe("mph");
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
