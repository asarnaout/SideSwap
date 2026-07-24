import { describe, expect, it } from "vitest";
import {
  FREE_DRIVES,
  getCountryProfile,
  getMapPack,
} from "../app/game/content";
import { buildFreeDriveLesson } from "../app/game/freeDriveLesson";
import type { GameCanvasLesson, SpeedUnit as CanvasSpeedUnit } from "../app/game/GameCanvas";
import {
  FIXED_STEP_SECONDS,
  SimulationCore,
  type SimulationCoreConfig,
  type SimulationLane,
  type SimulationSnapshot,
} from "../app/game/simulation";
import { buildSimulationCoreConfig } from "../app/game/simulationAdapter";
import type {
  FreeDriveDefinition,
  MapPack,
  TrafficSide,
} from "../app/game/types";

const STATIONARY_SECONDS = 60;
// The core still advances all fifteen fixed 60 Hz ticks. Sampling the public
// snapshot every 250 ms avoids millions of redundant serialization calls; the
// swept disappearance envelope below covers the full between-sample travel.
const STATIONARY_SAMPLE_SECONDS = 0.25;
const STATIONARY_SAMPLE_TICKS = 15;
const EIGHT_MINUTE_TICKS = 8 * 60 * 60;
const PLAYER_RADIUS_M = 1.05;
const NPC_RADIUS_M = 1;
const PLAYER_NPC_OVERLAP_M = PLAYER_RADIUS_M + NPC_RADIUS_M;
const NPC_NPC_OVERLAP_M = NPC_RADIUS_M * 2;
const RUNTIME_ACTIVATION_CLEARANCE_M = 70;
const POSITION_TOLERANCE_M = 1e-6;
const DISPLACEMENT_TOLERANCE_M = 0.05;
const MAX_REPORTED_FAILURES = 40;

// Fixed independently of authored traffic seeds so every path gets the same
// repeatable 50-seed stress sample in addition to its authored seed.
const ADDITIONAL_TRAFFIC_SEEDS = Array.from(
  { length: 50 },
  (_, index) => (0x5eed_0000 + index * 7_919) >>> 0,
);

interface PlayablePath {
  readonly id: string;
  readonly authoredSeed: number;
  readonly lesson: GameCanvasLesson;
  readonly mapPack: MapPack;
  readonly trafficSide: TrafficSide;
  readonly speedUnit: CanvasSpeedUnit;
}

interface TrafficRunCase {
  readonly name: string;
  readonly config: SimulationCoreConfig;
  readonly requireSuccessorTransition?: boolean;
  readonly requireDeactivation?: boolean;
  readonly requireRuntimeActivation?: boolean;
}

interface TrafficRunResult {
  readonly traceHash: number;
  readonly finalSnapshot: SimulationSnapshot;
  readonly successorTransitions: number;
  readonly deactivations: number;
  readonly runtimeActivations: number;
  readonly peakNpcCount: number;
}

const toCanvasSpeedUnit = (speedUnit: "mph" | "kmh"): CanvasSpeedUnit =>
  speedUnit === "mph" ? "mph" : "km/h";

const freeDrivePath = (freeDrive: FreeDriveDefinition): PlayablePath => {
  const country = getCountryProfile(freeDrive.countryId);
  const mapPack = getMapPack(freeDrive.mapId);
  return {
    id: freeDrive.id,
    authoredSeed: freeDrive.trafficSeed,
    lesson: buildFreeDriveLesson(freeDrive, country.trafficSide),
    mapPack,
    trafficSide: country.trafficSide,
    speedUnit: toCanvasSpeedUnit(country.speedUnit),
  };
};

const PLAYABLE_PATHS: readonly PlayablePath[] = FREE_DRIVES.map(freeDrivePath);

const distance = (
  left: { readonly x: number; readonly z: number },
  right: { readonly x: number; readonly z: number },
): number => Math.hypot(left.x - right.x, left.z - right.z);

const maxNpcSpeedMps = (config: SimulationCoreConfig): number =>
  Math.max(
    1,
    ...(config.lanes ?? []).map((lane) => (lane.speedLimitMps ?? 22) * 1.05),
  );

const firstPlayerOverlap = (snapshot: SimulationSnapshot): string | null => {
  for (const npc of snapshot.npcs) {
    const separation = distance(snapshot.player, npc);
    if (separation + POSITION_TOLERANCE_M < PLAYER_NPC_OVERLAP_M) {
      return `${npc.id}[${npc.laneId}] overlaps the player at ${separation.toFixed(3)}m`;
    }
  }
  return null;
};

const firstNpcOverlap = (snapshot: SimulationSnapshot): string | null => {
  for (let leftIndex = 0; leftIndex < snapshot.npcs.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < snapshot.npcs.length;
      rightIndex += 1
    ) {
      const left = snapshot.npcs[leftIndex];
      const right = snapshot.npcs[rightIndex];
      const separation = distance(left, right);
      if (separation + POSITION_TOLERANCE_M < NPC_NPC_OVERLAP_M) {
        return `${left.id}[${left.laneId}]/${right.id}[${right.laneId}] overlap at ${separation.toFixed(3)}m`;
      }
    }
  }
  return null;
};

const stationaryFailure = (
  simulation: SimulationCore,
  config: SimulationCoreConfig,
): string | null => {
  const expectedPose = simulation.getSnapshot().player;
  let previous = simulation.getSnapshot();
  const initialOverlap = firstPlayerOverlap(previous);
  if (initialOverlap) return `at 0.00s: ${initialOverlap}`;

  const maximumTravelPerSample =
    maxNpcSpeedMps(config) * STATIONARY_SAMPLE_SECONDS +
    DISPLACEMENT_TOLERANCE_M;
  const sampleCount = STATIONARY_SECONDS / STATIONARY_SAMPLE_SECONDS;

  for (let sample = 1; sample <= sampleCount; sample += 1) {
    const snapshot = simulation.step(STATIONARY_SAMPLE_SECONDS);
    const expectedTick = sample * STATIONARY_SAMPLE_TICKS;
    const timeLabel = `${(sample * STATIONARY_SAMPLE_SECONDS).toFixed(2)}s`;

    if (snapshot.status !== "running" || snapshot.activeIncident) {
      return `at ${timeLabel}: status=${snapshot.status}, incident=${snapshot.activeIncident?.code ?? "none"}, evidence=${JSON.stringify(snapshot.activeIncident?.evidence ?? {})}`;
    }
    if (snapshot.tick !== expectedTick) {
      return `at ${timeLabel}: tick ${snapshot.tick} != ${expectedTick} (reset or halted run)`;
    }
    if (snapshot.elapsedMs !== Math.round((expectedTick * 1_000) / 60)) {
      return `at ${timeLabel}: elapsedMs ${snapshot.elapsedMs} did not progress continuously`;
    }
    if (snapshot.score.criticalErrors !== 0) {
      return `at ${timeLabel}: ${snapshot.score.criticalErrors} critical error(s)`;
    }
    if (
      distance(snapshot.player, expectedPose) > POSITION_TOLERANCE_M ||
      Math.abs(snapshot.player.heading - expectedPose.heading) > POSITION_TOLERANCE_M ||
      snapshot.player.distanceTravelledM !== 0 ||
      snapshot.player.speedMps !== 0 ||
      snapshot.checkpointId !== "start"
    ) {
      return `at ${timeLabel}: stationary pose/checkpoint changed (reset or unintended movement)`;
    }

    const overlap = firstPlayerOverlap(snapshot);
    if (overlap) return `at ${timeLabel}: ${overlap}`;

    // NPC-fault collisions are safely requeued by the core rather than raised as
    // player incidents. A disappearing NPC close enough to have crossed the
    // overlap radius between public samples therefore also fails acceptance.
    const currentIds = new Set(snapshot.npcs.map((npc) => npc.id));
    for (const npc of previous.npcs) {
      if (
        !currentIds.has(npc.id) &&
        distance(previous.player, npc) <
          PLAYER_NPC_OVERLAP_M + maximumTravelPerSample
      ) {
        return `at ${timeLabel}: ${npc.id} disappeared from ${npc.laneId} inside the between-sample collision envelope (${distance(previous.player, npc).toFixed(3)}m)`;
      }
    }
    previous = snapshot;
  }

  const criticalEvent = simulation
    .getEvents()
    .find((event) => event.severity === "critical");
  return criticalEvent
    ? `recorded critical event ${criticalEvent.code}`
    : null;
};

const mixHash = (hash: number, value: number): number =>
  Math.imul(hash ^ (value | 0), 16_777_619) >>> 0;

const mixString = (hash: number, value: string): number => {
  let result = hash;
  for (let index = 0; index < value.length; index += 1) {
    result = mixHash(result, value.charCodeAt(index));
  }
  return result;
};

const traceSnapshot = (hash: number, snapshot: SimulationSnapshot): number => {
  let result = mixHash(hash, snapshot.tick);
  result = mixHash(result, snapshot.queuedNpcCount);
  result = mixString(result, snapshot.status);
  for (const npc of snapshot.npcs) {
    result = mixString(result, npc.id);
    result = mixString(result, npc.laneId);
    result = mixHash(result, Math.round(npc.x * 10_000));
    result = mixHash(result, Math.round(npc.z * 10_000));
    result = mixHash(result, Math.round(npc.speedMps * 10_000));
  }
  return result;
};

const laneIndex = (
  lanes: readonly SimulationLane[] | undefined,
): ReadonlyMap<string, SimulationLane> =>
  new Map((lanes ?? []).map((lane) => [lane.id, lane]));

const auditTrafficRun = (
  testCase: TrafficRunCase,
  failures: string[],
  validateSafety: boolean,
): TrafficRunResult => {
  const simulation = new SimulationCore(testCase.config);
  const lanes = laneIndex(testCase.config.lanes);
  const playerPose = simulation.getSnapshot().player;
  let previous = simulation.getSnapshot();
  let traceHash = traceSnapshot(2_166_136_261, previous);
  let successorTransitions = 0;
  let deactivations = 0;
  let runtimeActivations = 0;
  let peakNpcCount = previous.npcs.length;
  const reportedConditions = new Set<string>();

  const report = (message: string, condition = message) => {
    if (
      validateSafety &&
      !reportedConditions.has(condition) &&
      failures.length < MAX_REPORTED_FAILURES
    ) {
      reportedConditions.add(condition);
      failures.push(`${testCase.name}: ${message}`);
    }
  };

  if (validateSafety) {
    const playerOverlap = firstPlayerOverlap(previous);
    const npcOverlap = firstNpcOverlap(previous);
    if (playerOverlap) report(`tick 0: ${playerOverlap}`, "player-overlap");
    if (npcOverlap) report(`tick 0: ${npcOverlap}`, "npc-overlap");
  }

  for (let tick = 1; tick <= EIGHT_MINUTE_TICKS; tick += 1) {
    const snapshot = simulation.step(FIXED_STEP_SECONDS);
    traceHash = traceSnapshot(traceHash, snapshot);
    peakNpcCount = Math.max(peakNpcCount, snapshot.npcs.length);

    // A critical incident intentionally restores the checkpoint and may reflow
    // queued NPCs in that same fixed update. Report the incident itself without
    // misclassifying recovery placement as an ordinary lane transition/jump.
    if (snapshot.status !== "running" || snapshot.activeIncident) {
      if (validateSafety) {
        if (snapshot.tick !== tick) {
          report(
            `tick ${tick}: core tick is ${snapshot.tick} (reset or halted run)`,
            "tick-progression",
          );
        }
        report(
          `tick ${tick}: status=${snapshot.status}, incident=${snapshot.activeIncident?.code ?? "none"}, evidence=${JSON.stringify(snapshot.activeIncident?.evidence ?? {})}`,
          "incident",
        );
        if (snapshot.score.criticalErrors !== 0) {
          report(
            `tick ${tick}: ${snapshot.score.criticalErrors} critical error(s)`,
            "critical-errors",
          );
        }
      }
      previous = snapshot;
      break;
    }

    const previousById = new Map(previous.npcs.map((npc) => [npc.id, npc]));
    const currentById = new Map(snapshot.npcs.map((npc) => [npc.id, npc]));

    for (const npc of previous.npcs) {
      if (!currentById.has(npc.id)) deactivations += 1;
    }

    for (const npc of snapshot.npcs) {
      const prior = previousById.get(npc.id);
      if (!prior) {
        runtimeActivations += 1;
        if (
          validateSafety &&
          distance(snapshot.player, npc) + POSITION_TOLERANCE_M <
            RUNTIME_ACTIVATION_CLEARANCE_M
        ) {
          report(
            `tick ${tick}: ${npc.id} activated on ${npc.laneId} ${distance(snapshot.player, npc).toFixed(3)}m from the player`,
            `close-activation:${npc.id}`,
          );
        }
        continue;
      }

      const displacement = distance(prior, npc);
      const maximumDisplacement =
        npc.speedMps * FIXED_STEP_SECONDS + DISPLACEMENT_TOLERANCE_M;
      if (validateSafety && displacement > maximumDisplacement + POSITION_TOLERANCE_M) {
        report(
          `tick ${tick}: ${npc.id} displaced ${displacement.toFixed(4)}m at ${npc.speedMps.toFixed(3)}m/s (max ${maximumDisplacement.toFixed(4)}m), ${prior.laneId}/${prior.state} -> ${npc.laneId}/${npc.state}`,
          `displacement:${npc.id}`,
        );
      }

      if (npc.laneId !== prior.laneId) {
        const sourceLane = lanes.get(prior.laneId);
        const isSuccessor =
          sourceLane?.successorLaneIds?.includes(npc.laneId) ?? false;
        const isAuthoredAdjacentLane = sourceLane?.adjacentLaneId === npc.laneId;
        if (isSuccessor) successorTransitions += 1;
        if (validateSafety && !isSuccessor && !isAuthoredAdjacentLane) {
          report(
            `tick ${tick}: illegal lane transition ${prior.laneId} -> ${npc.laneId}`,
            `illegal-transition:${prior.laneId}:${npc.laneId}`,
          );
        }
      }
    }

    if (validateSafety) {
      if (snapshot.tick !== tick) {
        report(
          `tick ${tick}: core tick is ${snapshot.tick} (reset or halted run)`,
          "tick-progression",
        );
      }
      if (snapshot.score.criticalErrors !== 0) {
        report(
          `tick ${tick}: ${snapshot.score.criticalErrors} critical error(s)`,
          "critical-errors",
        );
      }
      if (
        distance(snapshot.player, playerPose) > POSITION_TOLERANCE_M ||
        snapshot.player.distanceTravelledM !== 0
      ) {
        report(
          `tick ${tick}: stationary traffic-run player moved or reset`,
          "player-moved",
        );
      }
      const playerOverlap = firstPlayerOverlap(snapshot);
      const npcOverlap = firstNpcOverlap(snapshot);
      if (playerOverlap) {
        report(`tick ${tick}: ${playerOverlap}`, "player-overlap");
      }
      if (npcOverlap) report(`tick ${tick}: ${npcOverlap}`, "npc-overlap");
    }

    previous = snapshot;
  }

  const finalSnapshot = simulation.getSnapshot();
  if (validateSafety) {
    if (peakNpcCount === 0) report("never activated any traffic");
    if (testCase.requireSuccessorTransition && successorTransitions === 0) {
      report("did not exercise a successor transition");
    }
    if (testCase.requireDeactivation && deactivations === 0) {
      report("did not exercise dead-end deactivation");
    }
    if (testCase.requireRuntimeActivation && runtimeActivations === 0) {
      report("did not exercise deferred runtime activation");
    }
  }

  return {
    traceHash,
    finalSnapshot,
    successorTransitions,
    deactivations,
    runtimeActivations,
    peakNpcCount,
  };
};

const syntheticTrafficCases = (): readonly TrafficRunCase[] => {
  const playerLane: SimulationLane = {
    id: "player-lane",
    points: [
      { x: 250, z: 0 },
      { x: 250, z: 120 },
    ],
    speedLimitMps: 12,
    loop: false,
  };

  return [
    {
      name: "connected successor circuit",
      requireSuccessorTransition: true,
      requireRuntimeActivation: true,
      config: {
        seed: 41_001,
        npcCount: 4,
        minRuntimeSpawnDistanceM: RUNTIME_ACTIVATION_CLEARANCE_M,
        lanes: [
          playerLane,
          {
            id: "successor-north",
            points: [
              { x: 0, z: 0 },
              { x: 0, z: 100 },
            ],
            speedLimitMps: 12,
            successorLaneIds: ["successor-east"],
            loop: false,
          },
          {
            id: "successor-east",
            points: [
              { x: 0, z: 100 },
              { x: 100, z: 100 },
            ],
            speedLimitMps: 12,
            successorLaneIds: ["successor-south"],
            loop: false,
          },
          {
            id: "successor-south",
            points: [
              { x: 100, z: 100 },
              { x: 100, z: 0 },
            ],
            speedLimitMps: 12,
            successorLaneIds: ["successor-west"],
            loop: false,
          },
          {
            id: "successor-west",
            points: [
              { x: 100, z: 0 },
              { x: 0, z: 0 },
            ],
            speedLimitMps: 12,
            successorLaneIds: ["successor-north"],
            loop: false,
          },
        ],
        spawn: { x: 250, z: 60, heading: 0 },
        bounds: { minX: -20, maxX: 270, minZ: -20, maxZ: 140 },
        trafficGates: [
          {
            id: "successor-gate-north",
            laneId: "successor-north",
            distance: 5,
            desiredSpeedMps: 9,
          },
          {
            id: "successor-gate-south",
            laneId: "successor-south",
            distance: 5,
            desiredSpeedMps: 9,
          },
        ],
        finish: null,
      },
    },
    {
      name: "dead-end requeue",
      requireDeactivation: true,
      requireRuntimeActivation: true,
      config: {
        seed: 42_001,
        npcCount: 1,
        minRuntimeSpawnDistanceM: RUNTIME_ACTIVATION_CLEARANCE_M,
        lanes: [
          playerLane,
          {
            id: "dead-end",
            points: [
              { x: 0, z: 0 },
              { x: 0, z: 120 },
            ],
            speedLimitMps: 12,
            successorLaneIds: [],
            loop: false,
          },
        ],
        spawn: { x: 250, z: 60, heading: 0 },
        bounds: { minX: -20, maxX: 270, minZ: -20, maxZ: 140 },
        trafficGates: [
          {
            id: "dead-end-gate",
            laneId: "dead-end",
            distance: 5,
            desiredSpeedMps: 10,
          },
        ],
        finish: null,
      },
    },
  ];
};

const authoredTrafficCase = (): TrafficRunCase => {
  const path = PLAYABLE_PATHS.find(
    (candidate) => candidate.id === "free-uk-london",
  );
  if (!path) throw new Error("Missing London traffic acceptance path");
  const adapted = buildSimulationCoreConfig({
    lesson: path.lesson,
    mapPack: path.mapPack,
    trafficSide: path.trafficSide,
    speedUnit: path.speedUnit,
  });
  return {
    name: "authored London signal traffic",
    config: {
      ...adapted,
      seed: 1252,
      checkpoints: [],
      finish: null,
    },
  };
};

describe("traffic safety acceptance", () => {
  it(
    "keeps every playable start and checkpoint safe for 60 seconds across 51 seeds",
    () => {
      expect(PLAYABLE_PATHS).toHaveLength(5);
      expect(new Set(PLAYABLE_PATHS.map((path) => path.id)).size).toBe(5);
      expect(ADDITIONAL_TRAFFIC_SEEDS).toHaveLength(50);
      expect(new Set(ADDITIONAL_TRAFFIC_SEEDS).size).toBe(50);
      expect(
        Object.fromEntries(
          PLAYABLE_PATHS.map((path) => [path.id, path.authoredSeed]),
        ),
      ).toEqual({
        "free-us": 2101,
        "free-uk": 2201,
        "free-uk-london": 2251,
        "free-fr": 2301,
        "free-jp": 2401,
      });

      const failures: string[] = [];
      pathLoop: for (const path of PLAYABLE_PATHS) {
        const adapted = buildSimulationCoreConfig({
          lesson: path.lesson,
          mapPack: path.mapPack,
          trafficSide: path.trafficSide,
          speedUnit: path.speedUnit,
        });
        if (!adapted.spawn) {
          failures.push(`${path.id}: adapter did not resolve a start pose`);
          continue;
        }
        const adaptedCheckpointIds = new Set(
          (adapted.checkpoints ?? []).map((checkpoint) => checkpoint.id),
        );
        const missingCheckpointIds = path.lesson.checkpoints.filter(
          (checkpointId) => !adaptedCheckpointIds.has(checkpointId),
        );
        if (missingCheckpointIds.length) {
          failures.push(
            `${path.id}: adapter did not resolve checkpoint(s) ${missingCheckpointIds.join(", ")}`,
          );
          continue;
        }
        const positions = [
          { id: "path-start", ...adapted.spawn },
          ...(adapted.checkpoints ?? []).map((checkpoint) => ({
            id: `checkpoint:${checkpoint.id}`,
            x: checkpoint.x,
            z: checkpoint.z,
            heading: checkpoint.heading,
          })),
        ];
        const seeds = [path.authoredSeed, ...ADDITIONAL_TRAFFIC_SEEDS];

        for (const position of positions) {
          for (const seed of seeds) {
            const config: SimulationCoreConfig = {
              ...adapted,
              seed,
              spawn: {
                x: position.x,
                z: position.z,
                heading: position.heading,
              },
              checkpoints: [],
              finish: null,
            };
            const failure = stationaryFailure(new SimulationCore(config), config);
            if (failure) {
              failures.push(
                `${path.id} / ${position.id} / seed ${seed}: ${failure}`,
              );
              if (failures.length >= MAX_REPORTED_FAILURES) break pathLoop;
            }
          }
        }
      }

      expect(
        failures,
        failures.length
          ? `Stationary traffic safety failures:\n${failures.join("\n")}`
          : undefined,
      ).toEqual([]);
    },
    // Exhaustive 60 s × 51-seed stationary check over every start on all 5
    // playable free-drive paths. The guarantee (seeds, duration, positions) is
    // fixed; wall-clock scales with map size + density. This body is synchronous,
    // so the budget only labels a completed run — it never truncates coverage.
    2_700_000,
  );

  it(
    "runs deterministic traffic for eight minutes without jumps, illegal transitions, overlaps, or close activation",
    () => {
      const failures: string[] = [];
      const cases = [...syntheticTrafficCases(), authoredTrafficCase()];

      for (const testCase of cases) {
        const first = auditTrafficRun(testCase, failures, true);
        const replay = auditTrafficRun(testCase, [], false);
        if (first.traceHash !== replay.traceHash) {
          failures.push(
            `${testCase.name}: deterministic replay hash ${replay.traceHash} != ${first.traceHash}`,
          );
        }
        if (
          first.finalSnapshot.tick !== EIGHT_MINUTE_TICKS ||
          first.finalSnapshot.elapsedMs !== 8 * 60 * 1_000
        ) {
          failures.push(
            `${testCase.name}: run ended at tick ${first.finalSnapshot.tick} / ${first.finalSnapshot.elapsedMs}ms`,
          );
        }
      }

      expect(
        failures,
        failures.length
          ? `Eight-minute traffic failures:\n${failures.join("\n")}`
          : undefined,
      ).toEqual([]);
    },
    60_000,
  );
});
