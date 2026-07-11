import { describe, expect, it } from "vitest";
import {
  COUNTRY_PROFILES,
  DESTINATION_PROFILES,
  FREE_DRIVES,
  LESSONS,
  MAP_PACKS,
  getCountryProfile,
  getDestinationProfile,
  getLesson,
  getMapPack,
  getOrientationForTrafficSide,
  isScenarioCompatibleWithDestination,
  resolveSessionConfig,
  resolveSteeringSide,
} from "../app/game/content";
import type {
  DestinationId,
  GameSessionConfig,
  ScenarioId,
  SteeringPreference,
} from "../app/game/types";

const sessionConfig = (
  destinationId: DestinationId,
  scenarioId: ScenarioId,
  steeringPreference: SteeringPreference = "auto",
): GameSessionConfig => ({
  countryId: getDestinationProfile(destinationId).countryId,
  destinationId,
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
  it("keeps four legal country profiles and five destination profiles", () => {
    expect(COUNTRY_PROFILES.map((country) => country.id)).toEqual([
      "us",
      "uk",
      "fr",
      "jp",
    ]);
    expect(DESTINATION_PROFILES.map((destination) => destination.id)).toEqual([
      "uk-london",
      "us-nyc",
      "uk-milton-keynes",
      "fr-calais",
      "jp-tokyo",
    ]);
    expect(DESTINATION_PROFILES[0].promotion).toBe("featured");
    expect(getDestinationProfile("uk-milton-keynes").promotion).toBe("specialist");
    expect(LESSONS).toHaveLength(18);
    expect(FREE_DRIVES).toHaveLength(5);
    expect(MAP_PACKS).toHaveLength(7);
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
    for (const destination of DESTINATION_PROFILES) {
      const country = getCountryProfile(destination.countryId);
      for (const orientationId of [
        "orientation-right",
        "orientation-left",
      ] as const) {
        const expected = orientationId.endsWith(country.trafficSide);
        expect(
          isScenarioCompatibleWithDestination(orientationId, destination.id),
        ).toBe(expected);

        if (expected) {
          const resolved = resolveSessionConfig(
            sessionConfig(destination.id, orientationId),
          );
          expect(resolved.countryId).toBe(country.id);
          expect(resolved.destinationId).toBe(destination.id);
          expect(resolved.trafficSide).toBe(country.trafficSide);
          expect(resolved.steeringSide).toBe(country.defaultSteeringSide);
          expect(resolved.speedUnit).toBe(country.speedUnit);
        } else {
          expect(() =>
            resolveSessionConfig(sessionConfig(destination.id, orientationId)),
          ).toThrow(/not compatible/);
        }
      }
    }
  });

  it("accepts every regular scenario only for its exact destination", () => {
    const destinationScenarios = [
      ...LESSONS.filter((lesson) => lesson.destinationId),
      ...FREE_DRIVES,
    ];

    for (const scenario of destinationScenarios) {
      for (const destination of DESTINATION_PROFILES) {
        expect(
          isScenarioCompatibleWithDestination(scenario.id, destination.id),
          `${scenario.id} with ${destination.id}`,
        ).toBe(scenario.destinationId === destination.id);
      }
    }
  });

  it("rejects traffic-side and destination mismatches", () => {
    expect(() =>
      resolveSessionConfig(sessionConfig("us-nyc", "orientation-left")),
    ).toThrow(/not compatible/);
    expect(() =>
      resolveSessionConfig(sessionConfig("uk-london", "us-one-way-grid")),
    ).toThrow(/not compatible/);
    expect(() => resolveSessionConfig(sessionConfig("fr-calais", "free-jp"))).toThrow(
      /not compatible/,
    );
    expect(() =>
      resolveSessionConfig({
        ...sessionConfig("uk-london", "orientation-left"),
        countryId: "us",
      }),
    ).toThrow(/destination .* not compatible with country/);
  });

  it("keeps wheel overrides independent in every valid country session", () => {
    for (const destination of DESTINATION_PROFILES) {
      const country = getCountryProfile(destination.countryId);
      const orientationId =
        country.trafficSide === "right" ? "orientation-right" : "orientation-left";
      for (const steeringPreference of ["left", "right"] as const) {
        const resolved = resolveSessionConfig(
          sessionConfig(destination.id, orientationId, steeringPreference),
        );
        expect(resolved.steeringSide).toBe(steeringPreference);
        expect(resolved.trafficSide).toBe(country.trafficSide);
      }
    }
  });

  it("starts the travel-transition capstone from either UK destination only", () => {
    for (const destinationId of ["uk-london", "uk-milton-keynes"] as const) {
      expect(
        isScenarioCompatibleWithDestination("uk-fr-side-swap", destinationId),
      ).toBe(true);
    }
    for (const destinationId of ["us-nyc", "fr-calais", "jp-tokyo"] as const) {
      expect(
        isScenarioCompatibleWithDestination("uk-fr-side-swap", destinationId),
      ).toBe(false);
    }

    const resolved = resolveSessionConfig(
      sessionConfig("uk-london", "uk-fr-side-swap"),
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
        expect(source?.reviewedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
