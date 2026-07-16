import { describe, expect, it } from "vitest";
import {
  SimulationCore,
  type SimulationCheckpoint,
  type SimulationCoreConfig,
  type SimulationLane,
  type SimulationRouteGuidanceStepConfig,
} from "../app/game/simulation";

/**
 * Regression coverage for the corner soft-lock: on a closed practice loop each
 * route leg's completion anchor sits at the lane end (the turn), so a car that
 * rounds the corner—its projection flipping to the next lane before it ever
 * reaches the previous lane's very end—misses every intermediate leg's anchor.
 * Before guidance recovery that permanently stalled `requiredGuidanceComplete`
 * and the lesson could never finish. The loop mirrors the orientation-yard
 * geometry (a rectangle whose route lanes meet at 90° corners).
 */

const HALF = 30;
const CORNERS = {
  topLeft: { x: -HALF, z: HALF },
  topRight: { x: HALF, z: HALF },
  bottomRight: { x: HALF, z: -HALF },
  bottomLeft: { x: -HALF, z: -HALF },
} as const;

// Wide lanes so a rounded corner stays on-road; the anchor-at-lane-end miss is
// guaranteed by geometry (the projection flips to the next lane before the car
// ever reaches the previous lane's exact end), not by how sharply it cuts.
const LANE_WIDTH = 12;
const LANE_LENGTH = HALF * 2;

const loopLanes: readonly SimulationLane[] = [
  {
    id: "top",
    points: [CORNERS.topLeft, CORNERS.topRight],
    width: LANE_WIDTH,
    speedLimitMps: 10,
    successorLaneIds: ["right"],
    loop: false,
  },
  {
    id: "right",
    points: [CORNERS.topRight, CORNERS.bottomRight],
    width: LANE_WIDTH,
    speedLimitMps: 10,
    successorLaneIds: ["bottom"],
    loop: false,
  },
  {
    id: "bottom",
    points: [CORNERS.bottomRight, CORNERS.bottomLeft],
    width: LANE_WIDTH,
    speedLimitMps: 10,
    successorLaneIds: ["left"],
    loop: false,
  },
  {
    id: "left",
    points: [CORNERS.bottomLeft, CORNERS.topLeft],
    width: LANE_WIDTH,
    speedLimitMps: 10,
    successorLaneIds: ["top"],
    loop: false,
  },
];

// Every completion anchor sits at the lane end: a turning car never satisfies
// it, so completion depends entirely on progress recovery (except the final
// leg, which the car reaches head-on and satisfies normally).
const loopGuidance: readonly SimulationRouteGuidanceStepConfig[] = [
  {
    id: "loop:route:0",
    routeIndex: 0,
    fromLaneId: null,
    targetLaneId: "top",
    completionAnchor: { laneId: "top", distance: LANE_LENGTH },
    label: "KEEP THIS LANE",
    required: true,
  },
  {
    id: "loop:route:1",
    routeIndex: 1,
    fromLaneId: "top",
    targetLaneId: "right",
    completionAnchor: { laneId: "right", distance: LANE_LENGTH },
    label: "FOLLOW ROUTE",
    required: true,
  },
  {
    id: "loop:route:2",
    routeIndex: 2,
    fromLaneId: "right",
    targetLaneId: "bottom",
    completionAnchor: { laneId: "bottom", distance: LANE_LENGTH },
    label: "FOLLOW ROUTE",
    required: true,
  },
  {
    id: "loop:route:3",
    routeIndex: 3,
    fromLaneId: "bottom",
    targetLaneId: "left",
    completionAnchor: { laneId: "left", distance: LANE_LENGTH },
    label: "FOLLOW ROUTE",
    required: true,
  },
];

const loopCheckpoints: readonly SimulationCheckpoint[] = [
  // Index 0 is the spawn checkpoint (auto-reached on reset).
  { id: "cp-start", x: -HALF + 3, z: HALF, heading: Math.PI / 2 },
  // Sits at the bottom-right corner, so it too is missed while turning and can
  // only be satisfied by checkpoint banking during recovery.
  {
    id: "cp-corner",
    x: HALF,
    z: -HALF,
    heading: Math.PI,
    laneId: "right",
    distance: LANE_LENGTH,
    width: LANE_WIDTH,
    radius: 6,
  },
];

function loopConfig(
  overrides: Partial<SimulationCoreConfig> = {},
): SimulationCoreConfig {
  return {
    trafficSide: "right",
    lessonId: "loop-recovery",
    seed: 7,
    npcCount: 0,
    lanes: loopLanes,
    routeGuidance: loopGuidance,
    checkpoints: loopCheckpoints,
    finish: { x: CORNERS.topLeft.x, z: CORNERS.topLeft.z, radius: 7 },
    spawn: { x: -HALF + 3, z: HALF, heading: Math.PI / 2 },
    bounds: { minX: -52, maxX: 52, minZ: -52, maxZ: 52 },
    maxForwardSpeedMps: 10,
    maxReverseSpeedMps: 4,
    ...overrides,
  };
}

const wrapAngle = (angle: number): number =>
  Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * A minimal pure-pursuit driver: steer toward the active waypoint (world +x is
 * sin(heading), +z is cos(heading)), easing the throttle in sharp turns so the
 * car rounds—and inevitably cuts—each corner.
 */
function driveWaypoints(
  simulation: SimulationCore,
  waypoints: readonly { x: number; z: number }[],
  options: { maxTicks?: number; stopWhen?: () => boolean; arriveM?: number } = {},
): boolean {
  const { maxTicks = 6000, stopWhen, arriveM = 9 } = options;
  let index = 0;
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (stopWhen?.()) return true;
    const player = simulation.getSnapshot().player;
    const target = waypoints[Math.min(index, waypoints.length - 1)];
    const dx = target.x - player.x;
    const dz = target.z - player.z;
    if (Math.hypot(dx, dz) <= arriveM && index < waypoints.length - 1) {
      index += 1;
    }
    const desiredHeading = Math.atan2(dx, dz);
    const error = wrapAngle(desiredHeading - player.heading);
    const steer = Math.max(-1, Math.min(1, error * 1.8));
    const throttle = 0.25 + 0.35 * (1 - Math.min(1, Math.abs(error) / 0.8));
    simulation.step(1 / 60, { throttle, steer });
  }
  return stopWhen?.() ?? false;
}

describe("route guidance corner recovery", () => {
  it("completes a wide-cornered lap that misses every intermediate leg anchor", () => {
    const simulation = new SimulationCore(loopConfig());

    const completed = driveWaypoints(
      simulation,
      [
        CORNERS.topRight,
        CORNERS.bottomRight,
        CORNERS.bottomLeft,
        CORNERS.topLeft,
      ],
      { stopWhen: () => simulation.getSnapshot().status === "complete" },
    );

    expect(completed).toBe(true);
    expect(simulation.getSnapshot().status).toBe("complete");
    // The bottom-right corner checkpoint was passed while turning, so it must
    // have been banked by recovery rather than crossed cleanly.
    expect(simulation.getSnapshot().guidance.status).toBe("complete");
  });

  it("still refuses to complete when a leg is never driven", () => {
    // Start already on the third leg and drive only the back half of the loop,
    // so the top and right legs are never visited. Recovery must not bank them.
    const simulation = new SimulationCore(
      loopConfig({
        spawn: { x: HALF - 3, z: -HALF, heading: Math.PI },
        checkpoints: [
          { id: "cp-start", x: HALF - 3, z: -HALF, heading: Math.PI },
        ],
      }),
    );

    driveWaypoints(simulation, [CORNERS.bottomLeft, CORNERS.topLeft], {
      maxTicks: 4000,
    });

    expect(simulation.getSnapshot().status).not.toBe("complete");
    expect(simulation.getSnapshot().guidance.owner?.routeIndex).toBe(0);
  });

  it("completes at the finish when the last leg is coasted out in a parallel lane", () => {
    // The reported end-of-route stall: the driver reaches the route end but
    // stops slightly off the final lane's centreline—nearer a parallel lane—so
    // the strict "moving and fully in-lane" completion never fires and there is
    // no later leg for forward recovery. Arriving at the finish with the route
    // driven must still complete.
    const laneA: SimulationLane = {
      id: "lane-a",
      points: [{ x: 0, z: 0 }, { x: 0, z: 50 }],
      width: 4,
      speedLimitMps: 10,
      successorLaneIds: ["final"],
      loop: false,
    };
    const finalLane: SimulationLane = {
      id: "final",
      points: [{ x: 0, z: 50 }, { x: 0, z: 100 }],
      width: 4,
      speedLimitMps: 10,
      adjacentLaneId: "final-parallel",
      successorLaneIds: [],
      loop: false,
    };
    const finalParallel: SimulationLane = {
      id: "final-parallel",
      points: [{ x: 3, z: 50 }, { x: 3, z: 100 }],
      width: 4,
      speedLimitMps: 10,
      adjacentLaneId: "final",
      loop: false,
    };
    const simulation = new SimulationCore({
      trafficSide: "right",
      lessonId: "finish-drift",
      seed: 5,
      npcCount: 0,
      lanes: [laneA, finalLane, finalParallel],
      routeGuidance: [
        {
          id: "finish-drift:route:0",
          routeIndex: 0,
          fromLaneId: null,
          targetLaneId: "lane-a",
          completionAnchor: { laneId: "lane-a", distance: 25 },
          required: true,
        },
        {
          id: "finish-drift:route:1",
          routeIndex: 1,
          fromLaneId: "lane-a",
          targetLaneId: "final",
          completionAnchor: { laneId: "final", distance: 48 },
          required: true,
        },
      ],
      checkpoints: [
        { id: "cp-start", x: 0, z: 0, heading: 0 },
        { id: "cp-a", x: 0, z: 25, heading: 0, laneId: "lane-a", width: 4, distance: 25 },
      ],
      finish: { x: 0, z: 100, radius: 7 },
      spawn: { x: 0, z: 0, heading: 0 },
      bounds: { minX: -10, maxX: 12, minZ: -6, maxZ: 108 },
      maxForwardSpeedMps: 10,
      maxReverseSpeedMps: 4,
    });

    const completed = driveWaypoints(
      simulation,
      [{ x: 0, z: 55 }, { x: 3, z: 80 }, { x: 3, z: 98 }],
      {
        stopWhen: () => simulation.getSnapshot().status === "complete",
        maxTicks: 4000,
      },
    );

    expect(completed).toBe(true);
    expect(simulation.getSnapshot().status).toBe("complete");
  });
});
