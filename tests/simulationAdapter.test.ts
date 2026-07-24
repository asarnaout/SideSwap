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
import { buildFreeDriveLesson } from "../app/game/freeDriveLesson";
import type { GameCanvasLesson } from "../app/game/GameCanvas";
import type { FreeDriveDefinition } from "../app/game/types";

// Lessons were removed in the gig overhaul, so the adapter now only ever
// receives free drives — the same contract SideSwapApp assembles for an
// open-world session.
const freeDriveLesson = (freeDrive: FreeDriveDefinition): GameCanvasLesson =>
  buildFreeDriveLesson(
    freeDrive,
    getCountryProfile(freeDrive.countryId).trafficSide,
  );

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

  it("carries Cromwell Road's bus lane through the Exhibition Road signal", () => {
    // The bus lane used to dead-end at the junction, so `advanceNpcAlongLegalRoute`
    // recycled the double-decker the moment the light went green and it popped
    // out of existence in front of the player (#128).
    const BUS_LANE_ID = "london-cromwell-east-bus";
    const CONTINUATION_LANE_IDS = new Set([
      "london-cromwell-east-2",
      "london-exhibition-shared-1",
    ]);
    const freeDrive = FREE_DRIVES.find(
      (candidate) => candidate.mapId === "london-south-kensington",
    );
    expect(freeDrive).toBeDefined();
    if (!freeDrive) return;
    const lesson = freeDriveLesson(freeDrive);
    const simulation = new SimulationCore(
      buildSimulationCoreConfig({
        lesson,
        mapPack: getMapPack(freeDrive.mapId),
        trafficSide: lesson.trafficSide,
        speedUnit: canvasSpeedUnit(freeDrive),
      }),
    );

    const vanished: string[] = [];
    let continuations = 0;
    let previousLaneIds = new Map<string, string>();
    for (let tick = 0; tick < 60 * 120; tick += 1) {
      simulation.step(1 / 60);
      const laneIds = new Map(
        simulation.getSnapshot().npcs.map((npc) => [npc.id, npc.laneId]),
      );
      for (const [npcId, laneId] of previousLaneIds) {
        if (laneId !== BUS_LANE_ID) continue;
        const current = laneIds.get(npcId);
        if (current === undefined) {
          vanished.push(`${npcId} vanished out of the bus lane at tick ${tick}`);
        } else if (CONTINUATION_LANE_IDS.has(current)) {
          continuations += 1;
        }
      }
      previousLaneIds = laneIds;
    }

    expect(vanished).toEqual([]);
    expect(continuations).toBeGreaterThan(0);
  });
});
