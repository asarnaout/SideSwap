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
  resolveSimulationLaneAnchor,
} from "../app/game/simulationAdapter";
import {
  buildPavementGraph,
  samplePavementEdge,
} from "../app/game/pavementPaths";
import {
  gasStationPumpPositions,
  resolveServicePointLot,
} from "../app/game/servicePoints";
import { PROP_MODEL_FOOTPRINTS_M } from "../app/game/propFootprints";
import {
  PAVED_SIDEWALK_WIDTH_M,
  resolveMapVisualPalette,
} from "../app/game/visuals";
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

  it("never walls off the walkable pavement — anywhere across the band", () => {
    // Where a walker can stroll, the car must never hit an invisible face:
    // an oversized venue footprint once stopped the car a whole pavement
    // short of the visible storefront (and its successor bug hid in the band
    // edges the rail centreline missed). Box solids must stay clear of the
    // FULL walkable band — rail centre plus both edges; buildings standing
    // flush against the band's back edge are fine. Small street-furniture
    // circles (the London pillar box, park feature trees) legitimately stand
    // on the pavement and walkers route around them.
    const failures: string[] = [];
    for (const world of driveWorlds) {
      const mapPack = getMapPack(world.freeDrive.mapId);
      const palette = resolveMapVisualPalette(mapPack.id);
      const sidewalkWidthM = palette.paved
        ? PAVED_SIDEWALK_WIDTH_M
        : Math.max(0.9, mapPack.geometry.shoulderWidth ?? 1.2);
      const graph = buildPavementGraph(mapPack.geometry.roadSurfaces, {
        sidewalkWidthM,
      });
      const lateralOffsets = [
        -(sidewalkWidthM / 2 - 0.4),
        0,
        sidewalkWidthM / 2 - 0.4,
      ];
      const solids = world.obstacles.filter(
        (obstacle) =>
          obstacle.tag !== "worldEdge" &&
          !(obstacle.kind === "circle" && obstacle.radius <= 2.5),
      );
      for (const edge of graph.edges) {
        const steps = Math.max(1, Math.ceil(edge.lengthM / 1.5));
        for (let step = 0; step <= steps; step += 1) {
          const pose = samplePavementEdge(edge, (edge.lengthM * step) / steps);
          const lateralX = Math.cos(pose.headingRad);
          const lateralZ = -Math.sin(pose.headingRad);
          for (const offset of lateralOffsets) {
            const x = pose.x + lateralX * offset;
            const z = pose.z + lateralZ * offset;
            for (const obstacle of solids) {
              const distance = distanceToStaticObstacle(obstacle, x, z);
              if (distance < 0.3) {
                failures.push(
                  `${world.freeDrive.mapId}: ${obstacle.id} covers the pavement at (${x.toFixed(1)}, ${z.toFixed(1)}) — ${distance.toFixed(2)}m`,
                );
              }
            }
          }
        }
      }
    }
    expect(failures.slice(0, 20)).toEqual([]);
  });

  it("keeps every gas station enterable, with a clear stop beside each pump", () => {
    for (const world of driveWorlds) {
      const mapPack = getMapPack(world.freeDrive.mapId);
      for (const service of mapPack.geometry.servicePoints ?? []) {
        const lot = resolveServicePointLot(mapPack.laneGraph.lanes, service);
        expect(lot, `${service.id} lot`).not.toBeNull();
        if (!lot) continue;
        const pose = resolveSimulationLaneAnchor(
          mapPack.laneGraph.lanes,
          service.anchor,
        );
        expect(pose, `${service.id} anchor`).not.toBeNull();
        if (!pose) continue;
        // The drive-in line: from the anchor on the road to the aisle between
        // the two pump islands (holder-frame point (2, -5.15)).
        const heading = lot.yaw - Math.PI / 2;
        const cos = Math.cos(heading);
        const sin = Math.sin(heading);
        const aisle = {
          x: lot.x + 2 * cos + -5.15 * sin,
          z: lot.z - 2 * sin + -5.15 * cos,
        };
        const approachLength = Math.hypot(aisle.x - pose.x, aisle.z - pose.z);
        const approachSteps = Math.ceil(approachLength);
        for (let step = 0; step <= approachSteps; step += 1) {
          const t = step / approachSteps;
          const x = pose.x + (aisle.x - pose.x) * t;
          const z = pose.z + (aisle.z - pose.z) * t;
          const nearest = clearanceToNearestObstacle(world.obstacles, x, z);
          expect(
            nearest.distance,
            `${service.id} approach blocked by ${nearest.id} at (${x.toFixed(1)}, ${z.toFixed(1)})`,
          ).toBeGreaterThanOrEqual(1.05);
        }
        // Each pump must offer at least one capsule-clear stop within the
        // refuel prompt's reach.
        for (const pump of gasStationPumpPositions(
          mapPack.laneGraph.lanes,
          service,
        )) {
          let reachable = false;
          for (let angle = 0; angle < 16 && !reachable; angle += 1) {
            const theta = (angle / 16) * Math.PI * 2;
            const x = pump.x + Math.cos(theta) * 2.2;
            const z = pump.z + Math.sin(theta) * 2.2;
            if (Math.hypot(x - lot.x, z - lot.z) > 13) continue;
            const nearest = clearanceToNearestObstacle(world.obstacles, x, z);
            reachable = nearest.distance >= 1.05;
          }
          expect(
            reachable,
            `${service.id} pump at (${pump.x.toFixed(1)}, ${pump.z.toFixed(1)}) has no clear stop`,
          ).toBe(true);
        }
        // And the station's own furniture is solid: pump islands + shop.
        const stationSolids = world.obstacles.filter((obstacle) =>
          obstacle.id.includes("-pumps-") || obstacle.id.includes("-shop"),
        );
        expect(stationSolids.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("aligns venue colliders with their measured models, off the pavement", () => {
    for (const world of driveWorlds) {
      const mapPack = getMapPack(world.freeDrive.mapId);
      for (const venue of mapPack.geometry.gigVenues ?? []) {
        const footprint = PROP_MODEL_FOOTPRINTS_M[venue.modelId ?? venue.kind];
        if (!footprint) continue;
        const obstacle = world.obstacles.find((o) => o.id === venue.id);
        expect(obstacle?.kind, venue.id).toBe("obb");
        if (obstacle?.kind !== "obb") continue;
        // Collider footprint must match the measured model exactly.
        expect(obstacle.halfU).toBeCloseTo(
          (footprint.maxZ - footprint.minZ) / 2,
          6,
        );
        expect(obstacle.halfV).toBeCloseTo(
          (footprint.maxX - footprint.minX) / 2,
          6,
        );
      }
    }
  });
});
