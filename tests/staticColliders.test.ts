import { describe, expect, it } from "vitest";
import {
  FREE_DRIVES,
  getCountryProfile,
  getMapPack,
} from "../app/game/content";
import type {
  GameCanvasLesson,
  SpeedUnit as CanvasSpeedUnit,
} from "../app/game/GameCanvas";
import {
  buildSimulationCoreConfig,
  buildStaticObstacles,
  distanceToStaticObstacle,
} from "../app/game/simulationAdapter";
import type {
  FreeDriveDefinition,
  StaticObstacle,
} from "../app/game/types";

// Mirrors the core's player capsule: circles of this radius trail/lead the
// centre. Driving centred along a lane, the car's lateral reach is exactly
// the capsule radius.
const PLAYER_CAPSULE_RADIUS_M = 1.0;
const PLAYER_CAPSULE_HALF_LENGTH_M = 1.15;
const LANE_SAMPLE_SPACING_M = 2;

const toCanvasSpeedUnit = (speedUnit: "mph" | "kmh"): CanvasSpeedUnit =>
  speedUnit === "mph" ? "mph" : "km/h";

const freeDriveLesson = (freeDrive: FreeDriveDefinition): GameCanvasLesson => {
  const country = getCountryProfile(freeDrive.countryId);
  return {
    id: freeDrive.id,
    title: freeDrive.title,
    kind: "free_drive",
    trafficSide: country.trafficSide,
    startSpawnId: freeDrive.startSpawnId,
    route: [],
    objectives: [{ id: `${freeDrive.id}-explore`, label: "Explore" }],
    trafficSeed: freeDrive.trafficSeed,
    trafficDensity: "moderate",
    vulnerableRoadUsers: { pedestrians: 8, cyclists: 4 },
    checkpoints: [],
    coachPrompts: [],
    assessedRules: [],
    scenarioClock: freeDrive.scenarioClock,
  };
};

interface DriveWorld {
  readonly freeDrive: FreeDriveDefinition;
  readonly obstacles: readonly StaticObstacle[];
  readonly lanes: NonNullable<
    ReturnType<typeof buildSimulationCoreConfig>["lanes"]
  >;
  readonly spawn: NonNullable<
    ReturnType<typeof buildSimulationCoreConfig>["spawn"]
  >;
}

const driveWorlds: DriveWorld[] = FREE_DRIVES.map((freeDrive) => {
  const country = getCountryProfile(freeDrive.countryId);
  const config = buildSimulationCoreConfig({
    lesson: freeDriveLesson(freeDrive),
    mapPack: getMapPack(freeDrive.mapId),
    trafficSide: country.trafficSide,
    speedUnit: toCanvasSpeedUnit(country.speedUnit),
  });
  if (!config.staticObstacles || !config.lanes || !config.spawn) {
    throw new Error(`free drive ${freeDrive.id} produced an incomplete config`);
  }
  return {
    freeDrive,
    obstacles: config.staticObstacles,
    lanes: config.lanes,
    spawn: config.spawn,
  };
});

const clearanceToNearestObstacle = (
  obstacles: readonly StaticObstacle[],
  x: number,
  z: number,
): { distance: number; id: string } => {
  let best = Number.POSITIVE_INFINITY;
  let bestId = "";
  for (const obstacle of obstacles) {
    const distance = distanceToStaticObstacle(obstacle, x, z);
    if (distance < best) {
      best = distance;
      bestId = obstacle.id;
    }
  }
  return { distance: best, id: bestId };
};

describe("static obstacle build", () => {
  it("produces a solid world for every free-drive map", () => {
    for (const world of driveWorlds) {
      expect(world.obstacles.length).toBeGreaterThan(4);
      // The four world-edge fences are always present.
      const edges = world.obstacles.filter((o) => o.tag === "worldEdge");
      expect(edges).toHaveLength(4);
      // Every authored block stands somewhere in the set (museum blocks as
      // wings, everything else as its own rect).
      const buildings = world.obstacles.filter((o) => o.tag === "building");
      const blockCount = getMapPack(world.freeDrive.mapId).geometry.blocks
        .length;
      expect(buildings.length).toBeGreaterThanOrEqual(blockCount);
      const ids = new Set(world.obstacles.map((o) => o.id));
      expect(ids.size).toBe(world.obstacles.length);
      for (const obstacle of world.obstacles) {
        for (const value of Object.values(obstacle)) {
          if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
        }
      }
    }
  });

  it("never turns a gas station lot solid — the car has to reach the pumps", () => {
    for (const world of driveWorlds) {
      const mapPack = getMapPack(world.freeDrive.mapId);
      const serviceIds = new Set(
        (mapPack.geometry.servicePoints ?? []).map((service) => service.id),
      );
      for (const obstacle of world.obstacles) {
        expect(serviceIds.has(obstacle.id)).toBe(false);
      }
    }
  });

  it("is deterministic — two builds are identical", () => {
    for (const world of driveWorlds) {
      const mapPack = getMapPack(world.freeDrive.mapId);
      // Mirrors the adapter's bounds formula (worldSize/2 + shoulder padding).
      const padding = Math.max(2, mapPack.geometry.shoulderWidth ?? 0);
      const again = buildStaticObstacles(mapPack, {
        minX: -mapPack.geometry.worldSize.x / 2 - padding,
        maxX: mapPack.geometry.worldSize.x / 2 + padding,
        minZ: -mapPack.geometry.worldSize.z / 2 - padding,
        maxZ: mapPack.geometry.worldSize.z / 2 + padding,
      });
      expect(again).toEqual(world.obstacles);
    }
  });
});

describe("the drivable world stays open", () => {
  it("keeps every lane corridor clear of every solid obstacle", () => {
    const failures: string[] = [];
    for (const world of driveWorlds) {
      for (const lane of world.lanes) {
        const laneWidth = lane.width ?? 3.5;
        const required = laneWidth / 2 + PLAYER_CAPSULE_RADIUS_M - 0.05;
        const points = lane.points;
        for (let index = 0; index < points.length - 1; index += 1) {
          const start = points[index];
          const end = points[index + 1];
          const length = Math.hypot(end.x - start.x, end.z - start.z);
          const steps = Math.max(1, Math.ceil(length / LANE_SAMPLE_SPACING_M));
          for (let step = 0; step <= steps; step += 1) {
            const t = step / steps;
            const x = start.x + (end.x - start.x) * t;
            const z = start.z + (end.z - start.z) * t;
            const nearest = clearanceToNearestObstacle(world.obstacles, x, z);
            if (nearest.distance < required) {
              failures.push(
                `${world.freeDrive.mapId} lane ${lane.id} @ (${x.toFixed(1)}, ${z.toFixed(1)}): ${nearest.id} within ${nearest.distance.toFixed(2)}m (< ${required.toFixed(2)}m)`,
              );
            }
          }
        }
      }
    }
    expect(failures.slice(0, 25)).toEqual([]);
  });

  it("keeps every free-drive spawn pose clear of the solid world", () => {
    for (const world of driveWorlds) {
      const nearest = clearanceToNearestObstacle(
        world.obstacles,
        world.spawn.x,
        world.spawn.z,
      );
      expect(
        nearest.distance,
        `${world.freeDrive.id} spawns ${nearest.distance.toFixed(2)}m from ${nearest.id}`,
      ).toBeGreaterThanOrEqual(
        PLAYER_CAPSULE_RADIUS_M + PLAYER_CAPSULE_HALF_LENGTH_M,
      );
    }
  });
});
