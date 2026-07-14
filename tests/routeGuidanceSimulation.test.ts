import { describe, expect, it } from "vitest";
import {
  SimulationCore,
  type SimulationCoreConfig,
  type SimulationLane,
  type SimulationRouteGuidanceStepConfig,
} from "../app/game/simulation";

const routeLanes: readonly SimulationLane[] = [
  {
    id: "route-a",
    points: [{ x: 0, z: 0 }, { x: 0, z: 20 }],
    width: 4,
    speedLimitMps: 12,
    successorLaneIds: ["route-b"],
    loop: false,
  },
  {
    id: "route-b",
    points: [{ x: 0, z: 20 }, { x: 0, z: 40 }],
    width: 4,
    speedLimitMps: 12,
    successorLaneIds: ["route-c"],
    loop: false,
  },
  {
    id: "route-c",
    points: [{ x: 0, z: 40 }, { x: 0, z: 64 }],
    width: 4,
    speedLimitMps: 12,
    successorLaneIds: [],
    loop: false,
  },
];

const routeGuidance: readonly SimulationRouteGuidanceStepConfig[] = [
  {
    id: "route-test:route:0",
    routeIndex: 0,
    fromLaneId: null,
    targetLaneId: "route-a",
    completionAnchor: { laneId: "route-a", distance: 3 },
    cueAnchor: { laneId: "route-a", distance: 7 },
    label: "KEEP THIS LANE",
    required: true,
  },
  {
    id: "route-test:route:1",
    routeIndex: 1,
    fromLaneId: "route-a",
    targetLaneId: "route-b",
    completionAnchor: { laneId: "route-b", distance: 3 },
    cueAnchor: { laneId: "route-b", distance: 7 },
    label: "FOLLOW ROUTE",
    required: true,
  },
  {
    id: "route-test:route:2",
    routeIndex: 2,
    fromLaneId: "route-b",
    targetLaneId: "route-c",
    completionAnchor: { laneId: "route-c", distance: 3 },
    cueAnchor: { laneId: "route-c", distance: 7 },
    label: "FOLLOW ROUTE",
    required: true,
  },
];

function routeConfig(
  overrides: Partial<SimulationCoreConfig> = {},
): SimulationCoreConfig {
  return {
    lessonId: "route-test",
    seed: 42,
    npcCount: 0,
    lanes: routeLanes,
    routeGuidance,
    spawn: { x: 0, z: 0, heading: 0 },
    bounds: { minX: -8, maxX: 8, minZ: -4, maxZ: 68 },
    maxForwardSpeedMps: 12,
    maxReverseSpeedMps: 5,
    ...overrides,
  };
}

function driveUntil(
  simulation: SimulationCore,
  predicate: () => boolean,
  maximumTicks = 1_200,
): void {
  for (let tick = 0; tick < maximumTicks; tick += 1) {
    simulation.step(1 / 60, { throttle: 0.72 });
    if (predicate()) return;
  }
  throw new Error("The route guidance condition was not reached in time.");
}

describe("authoritative route guidance", () => {
  it("owns the first route occurrence and advances only in authored order", () => {
    const simulation = new SimulationCore(routeConfig());

    expect(simulation.getSnapshot().guidance).toMatchObject({
      owner: {
        kind: "route",
        id: "route-test:route",
        stepId: "route-test:route:0",
        routeIndex: 0,
      },
      status: "ready",
      cue: { laneId: "route-a", distanceAlongM: 7 },
      blockingReason: null,
    });

    driveUntil(
      simulation,
      () => simulation.getSnapshot().guidance.owner?.routeIndex === 1,
    );
    expect(simulation.getSnapshot().road.laneId).toBe("route-a");

    driveUntil(
      simulation,
      () => simulation.getSnapshot().guidance.owner?.routeIndex === 2,
    );
    expect(simulation.getSnapshot().road.laneId).toBe("route-b");

    driveUntil(
      simulation,
      () => simulation.getSnapshot().guidance.status === "complete",
    );
    expect(simulation.getSnapshot().road.laneId).toBe("route-c");
  });

  it("does not satisfy an initial occurrence in reverse or outside full-lane containment", () => {
    const reverse = new SimulationCore(
      routeConfig({
        routeGuidance: [routeGuidance[0]],
        spawn: { x: 0, z: 4, heading: 0 },
      }),
    );
    expect(reverse.selectGear("reverse")).toBe(true);
    for (let tick = 0; tick < 70; tick += 1) {
      reverse.step(1 / 60, { throttle: 0.7 });
    }
    expect(reverse.getSnapshot().player.z).toBeLessThan(3);
    expect(reverse.getSnapshot().guidance.owner?.routeIndex).toBe(0);

    const straddling = new SimulationCore(
      routeConfig({
        routeGuidance: [routeGuidance[0]],
        spawn: { x: 0.9, z: 0, heading: 0 },
      }),
    );
    for (let tick = 0; tick < 100; tick += 1) {
      straddling.step(1 / 60, { throttle: 0.5 });
    }
    expect(straddling.getSnapshot().player.z).toBeGreaterThan(3);
    expect(straddling.getSnapshot().guidance.owner?.routeIndex).toBe(0);
  });

  it("does not skip the first unmet occurrence when placed on a later lane", () => {
    const simulation = new SimulationCore(
      routeConfig({ spawn: { x: 0, z: 44, heading: 0 } }),
    );
    for (let tick = 0; tick < 60; tick += 1) {
      simulation.step(1 / 60, { throttle: 0.3 });
    }
    expect(simulation.getSnapshot().guidance).toMatchObject({
      owner: { kind: "route", routeIndex: 0 },
      status: "blocked",
      blockingReason: "off_route",
    });
  });

  it("rolls route progress back to the exact checkpoint occurrence", () => {
    const simulation = new SimulationCore(routeConfig());
    driveUntil(
      simulation,
      () => simulation.getSnapshot().guidance.owner?.routeIndex === 1,
    );
    const checkpointPose = simulation.getSnapshot().player;
    simulation.setCheckpoint({
      id: "after-first-occurrence",
      x: checkpointPose.x,
      z: checkpointPose.z,
      heading: checkpointPose.heading,
    });

    driveUntil(
      simulation,
      () => simulation.getSnapshot().guidance.status === "complete",
    );
    simulation.resetToCheckpoint();

    expect(simulation.getSnapshot().guidance).toMatchObject({
      owner: { kind: "route", routeIndex: 1 },
      status: "ready",
    });
    expect(simulation.getSnapshot().player.z).toBeCloseTo(checkpointPose.z, 5);
  });

  it("guards explicit and proximity completion until required guidance is done", () => {
    const simulation = new SimulationCore(
      routeConfig({ finish: { x: 0, z: 60, radius: 3 } }),
    );
    simulation.completeLesson();
    expect(simulation.getSnapshot().status).toBe("running");

    driveUntil(
      simulation,
      () => simulation.getSnapshot().status === "complete",
    );
    expect(simulation.getSnapshot().guidance.status).toBe("complete");

    const advisory = new SimulationCore(
      routeConfig({
        routeGuidance: routeGuidance.map((step) => ({
          ...step,
          required: false,
        })),
      }),
    );
    advisory.completeLesson();
    expect(advisory.getSnapshot().status).toBe("complete");
  });

  it("lets an active overtake claim guidance while blocked", () => {
    const normalLane: SimulationLane = {
      id: "normal",
      points: [{ x: 0, z: 0 }, { x: 0, z: 100 }],
      width: 4,
      speedLimitMps: 18,
      adjacentLaneId: "passing",
      successorLaneIds: ["after"],
      loop: false,
    };
    const simulation = new SimulationCore({
      trafficSide: "right",
      lessonId: "arbitration",
      npcCount: 0,
      lanes: [
        normalLane,
        {
          id: "passing",
          points: [{ x: -4, z: 0 }, { x: -4, z: 100 }],
          width: 4,
          speedLimitMps: 18,
          adjacentLaneId: "normal",
          loop: false,
        },
        {
          id: "after",
          points: [{ x: 0, z: 100 }, { x: 0, z: 140 }],
          width: 4,
          speedLimitMps: 18,
          loop: false,
        },
      ],
      spawn: { x: 0, z: 10, heading: 0 },
      bounds: { minX: -10, maxX: 10, minZ: -5, maxZ: 145 },
      routeGuidance: [
        {
          id: "arbitration:route:0",
          routeIndex: 0,
          fromLaneId: null,
          targetLaneId: "normal",
          completionAnchor: { laneId: "normal", distance: 20 },
          cueAnchor: { laneId: "normal", distance: 24 },
        },
      ],
      maneuvers: [
        {
          id: "blocking-overtake",
          kind: "overtake",
          normalLaneId: "normal",
          passingLaneId: "passing",
          corridorStart: { laneId: "normal", distance: 0 },
          corridorEnd: { laneId: "normal", distance: 85 },
          leadVehicleStart: { laneId: "normal", distance: 48 },
          phaseAnchors: {
            approach: { laneId: "normal", distance: 2 },
            observe: { laneId: "normal", distance: 5 },
            pass: { laneId: "passing", distance: 25 },
            return: { laneId: "passing", distance: 65 },
            complete: { laneId: "normal", distance: 80 },
          },
        },
      ],
    });

    simulation.step(1 / 60);
    expect(simulation.getSnapshot().guidance).toMatchObject({
      owner: {
        kind: "overtake",
        id: "blocking-overtake",
        stepId: "observe",
        routeIndex: null,
      },
      status: "blocked",
      cue: null,
      blockingReason: "observation_required",
    });
    expect(simulation.getSnapshot().maneuvers[0].phase).toBe("observe");
  });

  it("does not let generic guidance alter deterministic NPC behavior", () => {
    const trafficConfig: SimulationCoreConfig = {
      ...routeConfig(),
      npcCount: 1,
      trafficGates: [
        {
          id: "route-traffic",
          laneId: "route-c",
          distance: 16,
          desiredSpeedMps: 7,
        },
      ],
    };
    const guided = new SimulationCore(trafficConfig);
    const unguided = new SimulationCore({
      ...trafficConfig,
      routeGuidance: [],
    });
    for (let tick = 0; tick < 180; tick += 1) {
      guided.step(1 / 60);
      unguided.step(1 / 60);
    }
    expect(guided.getSnapshot().npcs).toEqual(unguided.getSnapshot().npcs);
    expect(guided.getSnapshot().queuedNpcCount).toBe(
      unguided.getSnapshot().queuedNpcCount,
    );
  });
});
