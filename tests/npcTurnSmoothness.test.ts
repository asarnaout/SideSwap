import { describe, expect, it } from "vitest";
import {
  FREE_DRIVES,
  getCountryProfile,
  getMapPack,
  MAP_PACKS,
} from "../app/game/content";
import {
  FIXED_STEP_SECONDS,
  SimulationCore,
  type SimulationCoreConfig,
} from "../app/game/simulation";
import { buildSimulationCoreConfig } from "../app/game/simulationAdapter";
import type { GameCanvasLesson } from "../app/game/GameCanvas";
import type { FreeDriveDefinition, LaneSegment } from "../app/game/types";

/**
 * Issue #19: NPCs snapped through wild rotations at junctions — approach,
 * snap ~74deg one way, snap ~180deg the other on the successor hop, snap
 * back, drive off. Two layers guard the fix:
 *
 * 1. Geometry — `laneTrue` centrelines ease onto their lane lines through
 *    sampled blends instead of darting sideways onto the shared node, so no
 *    lane carries connector segments pointing ~74deg off the road axis.
 * 2. Dynamics — NPC heading chases the pose at a physical yaw rate and the
 *    rendered pose rides a corner arc across lane hops, so a turning car
 *    sweeps like a steered vehicle and its heading tracks its velocity.
 */

const headingBetween = (
  a: { x: number; z: number },
  b: { x: number; z: number },
): number => Math.atan2(b.x - a.x, b.z - a.z);

const wrapRad = (angle: number): number => {
  let wrapped = angle % (Math.PI * 2);
  if (wrapped > Math.PI) wrapped -= Math.PI * 2;
  if (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
};

const degrees = (rad: number): number => (rad * 180) / Math.PI;

const segmentHeadings = (lane: LaneSegment): number[] => {
  const headings: number[] = [];
  for (let index = 0; index + 1 < lane.centerline.length; index += 1) {
    const start = lane.centerline[index];
    const end = lane.centerline[index + 1];
    if (Math.hypot(end.x - start.x, end.z - start.z) < 1e-9) continue;
    headings.push(headingBetween(start, end));
  }
  return headings;
};

describe("junction geometry stays smooth (#19)", () => {
  it("keeps consecutive centreline points distinct on every map", () => {
    for (const pack of MAP_PACKS) {
      for (const lane of pack.laneGraph.lanes) {
        for (let index = 1; index < lane.centerline.length; index += 1) {
          const previous = lane.centerline[index - 1];
          const current = lane.centerline[index];
          expect(
            Math.hypot(current.x - previous.x, current.z - previous.z),
            `${pack.id}/${lane.id} point ${index}`,
          ).toBeGreaterThan(0.009);
        }
      }
    }
  });

  it("keeps intra-lane segment bends gentle on every map", () => {
    // The legacy node tapers bent 73.6deg+ over 1.77 m at both ends of every
    // laneTrue lane. Authored mid-road corners (MK's east link, Tokyo's
    // curves) legitimately reach ~68deg, so the bound sits just under the
    // taper signature.
    for (const pack of MAP_PACKS) {
      for (const lane of pack.laneGraph.lanes) {
        const headings = segmentHeadings(lane);
        for (let index = 1; index < headings.length; index += 1) {
          const bend = Math.abs(
            degrees(wrapRad(headings[index] - headings[index - 1])),
          );
          expect(
            bend,
            `${pack.id}/${lane.id} bend at point ${index}`,
          ).toBeLessThanOrEqual(72);
        }
      }
    }
  });

  it("keeps NYC lane segments near-collinear", () => {
    // The issue's map is a pure grid: nothing inside a lane should bend more
    // than a connector-blend sample step.
    const pack = getMapPack("nyc-upper-west-side");
    for (const lane of pack.laneGraph.lanes) {
      const headings = segmentHeadings(lane);
      for (let index = 1; index < headings.length; index += 1) {
        const bend = Math.abs(
          degrees(wrapRad(headings[index] - headings[index - 1])),
        );
        expect(
          bend,
          `${lane.id} bend at point ${index}`,
        ).toBeLessThanOrEqual(15);
      }
    }
  });

  it("hands a continuing road over without a heading jolt", () => {
    // Successor pairs whose overall bearings agree are straight continuations
    // across a junction (Broadway block 1 -> block 2). Before the fix that
    // hand-over swung the heading 147deg; now the two lanes must line up.
    const chordBearing = (lane: LaneSegment): number | null => {
      const start = lane.centerline[0];
      const end = lane.centerline[lane.centerline.length - 1];
      if (Math.hypot(end.x - start.x, end.z - start.z) < 10) return null;
      return headingBetween(start, end);
    };
    const headingAtDistance = (lane: LaneSegment, target: number): number | null => {
      let travelled = 0;
      for (let index = 0; index + 1 < lane.centerline.length; index += 1) {
        const start = lane.centerline[index];
        const end = lane.centerline[index + 1];
        const length = Math.hypot(end.x - start.x, end.z - start.z);
        if (length < 1e-9) continue;
        if (travelled + length >= target) return headingBetween(start, end);
        travelled += length;
      }
      return null;
    };
    const laneLength = (lane: LaneSegment): number =>
      lane.centerline.reduce(
        (total, current, index) =>
          index === 0
            ? 0
            : total +
              Math.hypot(
                current.x - lane.centerline[index - 1].x,
                current.z - lane.centerline[index - 1].z,
              ),
        0,
      );
    // A lane is internally straight when its body — clear of the ~7 m
    // connector regions — runs along its own chord. Turning-loop arms and
    // curve lanes fail this and are excluded as genuine turns.
    const straightBody = (lane: LaneSegment): number | null => {
      const bearing = chordBearing(lane);
      if (bearing === null) return null;
      const body = headingAtDistance(lane, Math.min(10, laneLength(lane) / 2));
      if (body === null) return null;
      return Math.abs(degrees(wrapRad(body - bearing))) <= 20 ? bearing : null;
    };
    let checked = 0;
    for (const pack of MAP_PACKS) {
      const byId = new Map(pack.laneGraph.lanes.map((lane) => [lane.id, lane]));
      for (const lane of pack.laneGraph.lanes) {
        const endHeading = segmentHeadings(lane).at(-1);
        const laneBearing = straightBody(lane);
        if (endHeading === undefined || laneBearing === null) continue;
        for (const successorId of lane.successors) {
          const successor = byId.get(successorId);
          if (!successor) continue;
          const successorBearing = straightBody(successor);
          if (successorBearing === null) continue;
          if (Math.abs(degrees(wrapRad(successorBearing - laneBearing))) > 25) {
            continue; // a genuine turn, not a continuation
          }
          const startHeading = segmentHeadings(successor)[0];
          if (startHeading === undefined) continue;
          checked += 1;
          expect(
            Math.abs(degrees(wrapRad(startHeading - endHeading))),
            `${pack.id}: ${lane.id} -> ${successorId}`,
          ).toBeLessThanOrEqual(30);
        }
      }
    }
    expect(checked, "maps have straight continuations").toBeGreaterThan(20);
  });

  it("keeps every NYC successor hop within a real turn's angle", () => {
    // A grid junction never asks for more than ~90deg plus blend allowance.
    // The legacy tapers measured up to 147deg across a straight hand-over.
    const pack = getMapPack("nyc-upper-west-side");
    const byId = new Map(pack.laneGraph.lanes.map((lane) => [lane.id, lane]));
    for (const lane of pack.laneGraph.lanes) {
      const endHeading = segmentHeadings(lane).at(-1);
      if (endHeading === undefined) continue;
      for (const successorId of lane.successors) {
        const successor = byId.get(successorId);
        if (!successor) continue;
        const startHeading = segmentHeadings(successor)[0];
        if (startHeading === undefined) continue;
        expect(
          Math.abs(degrees(wrapRad(startHeading - endHeading))),
          `${lane.id} -> ${successorId}`,
        ).toBeLessThanOrEqual(120);
      }
    }
  });
});

// Mirrors the runtime free-drive contract SideSwapApp assembles (see
// simulationAdapter.test.ts / trafficSafetyAcceptance.test.ts).
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

describe("NPC heading dynamics (#19)", () => {
  // The physical yaw-rate cap in simulation.ts (NPC_YAW_RATE_MAX_RAD_S); the
  // invariant below is what makes it a contract.
  const MAX_YAW_STEP_RAD = 2.6 * FIXED_STEP_SECONDS + 1e-6;
  const RUN_SECONDS = 90;
  const SEEDS = [0, 0x5eed_0000, 0x5eed_1ef7] as const;

  const nycFreeDrive = FREE_DRIVES.find(
    (drive) => drive.mapId === "nyc-upper-west-side",
  )!;

  // ~5 s of pure simulation stepping alone; generous headroom for a loaded
  // parallel test run.
  it("never yaws an NYC car faster than its steering allows", { timeout: 120_000 }, () => {
    const lesson = freeDriveLesson(nycFreeDrive);
    const mapPack = getMapPack(nycFreeDrive.mapId);
    const adapted = buildSimulationCoreConfig({
      lesson,
      mapPack,
      trafficSide: lesson.trafficSide,
      speedUnit: "mph",
    });
    let sweptTurnTicks = 0;
    for (const seedOffset of SEEDS) {
      const config: SimulationCoreConfig = {
        ...adapted,
        seed: (lesson.trafficSeed + seedOffset) >>> 0,
        checkpoints: [],
        finish: null,
      };
      const core = new SimulationCore(config);
      const previousById = new Map<
        string,
        { x: number; z: number; heading: number }
      >();
      const ticks = Math.round(RUN_SECONDS / FIXED_STEP_SECONDS);
      for (let tick = 0; tick < ticks; tick += 1) {
        const snapshot = core.step(FIXED_STEP_SECONDS);
        const seenIds = new Set<string>();
        for (const npc of snapshot.npcs) {
          seenIds.add(npc.id);
          const previous = previousById.get(npc.id);
          previousById.set(npc.id, {
            x: npc.x,
            z: npc.z,
            heading: npc.heading,
          });
          if (!previous) continue;
          const movedX = npc.x - previous.x;
          const movedZ = npc.z - previous.z;
          const moved = Math.hypot(movedX, movedZ);
          if (moved > 3) continue; // recycled through a spawn gate
          if (npc.speedMps < 0.5 && moved < 0.05) continue; // parked; the
          // incident machinery may pop its authored knock lean in one tick
          const yawStep = Math.abs(wrapRad(npc.heading - previous.heading));
          expect(
            yawStep,
            `seed +${seedOffset} tick ${tick}: ${npc.id} yawed ${degrees(yawStep).toFixed(1)}deg in one tick`,
          ).toBeLessThanOrEqual(MAX_YAW_STEP_RAD);
          if (yawStep >= 0.009) sweptTurnTicks += 1;
          // A moving car must point roughly where it travels — the wiper
          // failure mode is a heading detached from the velocity direction.
          if (npc.speedMps >= 1 && moved >= 0.05) {
            const slip = Math.abs(
              wrapRad(npc.heading - headingBetween(previous, npc)),
            );
            expect(
              degrees(slip),
              `seed +${seedOffset} tick ${tick}: ${npc.id} slid ${degrees(slip).toFixed(1)}deg off its velocity`,
            ).toBeLessThanOrEqual(45);
          }
        }
        for (const id of previousById.keys()) {
          if (!seenIds.has(id)) previousById.delete(id);
        }
      }
    }
    // The invariant must not pass vacuously: traffic really turned corners.
    expect(sweptTurnTicks).toBeGreaterThan(200);
  });
});
