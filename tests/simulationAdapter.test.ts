import { describe, expect, it } from "vitest";
import {
  FREE_DRIVES,
  getCountryProfile,
  getMapPack,
} from "../app/game/content";
import { SimulationCore } from "../app/game/simulation";
import {
  buildSimulationCoreConfig,
  resolveSimulationStartPose,
} from "../app/game/simulationAdapter";
import type { GameCanvasLesson } from "../app/game/GameCanvas";
import type { FreeDriveDefinition } from "../app/game/types";

// Lessons were removed in the gig overhaul, so the adapter now only ever
// receives free drives. This mirrors the runtime GameCanvasLesson SideSwapApp
// assembles for an open-world session.
const freeDriveLesson = (freeDrive: FreeDriveDefinition): GameCanvasLesson => {
  const country = getCountryProfile(freeDrive.countryId);
  return {
    id: freeDrive.id,
    title: freeDrive.title,
    kind: "free_drive",
    trafficSide: country.trafficSide,
    startSpawnId: freeDrive.startSpawnId,
    route: [],
    objectives: [{ id: `${freeDrive.id}-explore`, label: "Explore the city" }],
    trafficSeed: freeDrive.trafficSeed,
    trafficDensity: "moderate",
    vulnerableRoadUsers: { pedestrians: 8, cyclists: 4 },
    checkpoints: [],
    coachPrompts: [],
    assessedRules: [],
    scenarioClock: freeDrive.scenarioClock,
  };
};

const canvasSpeedUnit = (freeDrive: FreeDriveDefinition) =>
  getCountryProfile(freeDrive.countryId).speedUnit === "kmh" ? "km/h" : "mph";

describe("simulation runtime adapter (free-roam)", () => {
  it("spawns each city drive on its authored player lane, on-lane and legal", () => {
    for (const freeDrive of FREE_DRIVES) {
      const lesson = freeDriveLesson(freeDrive);
      const mapPack = getMapPack(freeDrive.mapId);
      const start = resolveSimulationStartPose(
        lesson,
        mapPack,
        lesson.trafficSide,
      );
      const config = buildSimulationCoreConfig({
        lesson,
        mapPack,
        trafficSide: lesson.trafficSide,
        speedUnit: canvasSpeedUnit(freeDrive),
      });

      expect(config.spawn, freeDrive.id).toEqual({
        x: start.x,
        z: start.z,
        heading: start.heading,
      });
      expect((config.lanes ?? []).length, freeDrive.id).toBeGreaterThan(0);
      // Free drives carry no route guidance and no forced finish line.
      expect(config.routeGuidance, freeDrive.id).toEqual([]);
      expect(config.finish, freeDrive.id).toBeNull();

      const snapshot = new SimulationCore(config).getSnapshot();
      expect(snapshot.road.wrongWay, freeDrive.id).toBe(false);
      expect(snapshot.road.offRoad, freeDrive.id).toBe(false);
    }
  });

  it("keeps a stationary player safe from authored traffic in every city", () => {
    for (const freeDrive of FREE_DRIVES) {
      const mapPack = getMapPack(freeDrive.mapId);
      const lesson = freeDriveLesson(freeDrive);
      const simulation = new SimulationCore(
        buildSimulationCoreConfig({
          lesson,
          mapPack,
          trafficSide: lesson.trafficSide,
          speedUnit: canvasSpeedUnit(freeDrive),
        }),
      );
      for (let tick = 0; tick < 60 * 15; tick += 1) {
        simulation.step(1 / 60);
      }
      const snapshot = simulation.getSnapshot();
      expect(
        snapshot.activeIncident,
        `${freeDrive.id} caused an incident while the player remained stationary`,
      ).toBeNull();
      expect(snapshot.status).toBe("running");
    }
  });
});
