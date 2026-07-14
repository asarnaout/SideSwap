import { afterEach, describe, expect, it, vi } from "vitest";
import { VertexData } from "@babylonjs/core";
import {
  AdaptiveInputRouter,
  COCKPIT_DASH_DRIVER_Z,
  DEFAULT_HORIZONTAL_FOV,
  GUIDANCE_LAYER_MASK,
  INPUT_PROMPT_SWITCH_COOLDOWN_MS,
  MAX_HORIZONTAL_FOV,
  MAX_STEERING_WHEEL_SPIN,
  MIN_HORIZONTAL_FOV,
  PRIMARY_CAMERA_LAYER_MASK,
  TOUCH_CONTROL_DIM_DELAY_MS,
  WORLD_LAYER_MASK,
  buildRoadSurfaceStripGeometry,
  clampHorizontalFieldOfView,
  collectRoadJunctionPatches,
  guidanceCueOverlapsCheckpoint,
  isAuthoredCheckpointCrossing,
  isLaneGuidanceDistanceAllowed,
  isCameraStackActive,
  resolveCockpitPitch,
  resolveCockpitCameraPoses,
  resolveCockpitSteeringGeometry,
  resolveAuthoritativeRouteIndex,
  resolveCheckpointTargetWidth,
  resolveRouteChevronHalfSpan,
  resolveSteeringWheelSpin,
  smoothClosedRoadCenterline,
  type AdaptiveInputPresentation,
} from "../app/game/GameCanvas";

describe("lane-contained driving guidance", () => {
  const lane = {
    id: "travel",
    widthM: 3.4,
    centerline: [
      { x: 0, z: 0 },
      { x: 0, z: 40 },
    ],
  } as const;

  it("caps checkpoint targets and chevrons inside the authored lane", () => {
    expect(resolveCheckpointTargetWidth(3.4)).toBe(2.4);
    expect(resolveCheckpointTargetWidth(2.7)).toBeCloseTo(2.1);
    expect(resolveRouteChevronHalfSpan(2.7) * 2 + 0.24).toBeLessThanOrEqual(
      2.7 - 0.8,
    );
  });

  it("requires a forward checkpoint crossing in the authored lane", () => {
    expect(
      isAuthoredCheckpointCrossing({
        lane,
        distanceAlongM: 20,
        previous: { x: 0.4, z: 19 },
        current: { x: 0.4, z: 21 },
      }),
    ).toBe(true);
    expect(
      isAuthoredCheckpointCrossing({
        lane,
        distanceAlongM: 20,
        previous: { x: 0.8, z: 19 },
        current: { x: 0.8, z: 21 },
      }),
    ).toBe(false);
    expect(
      isAuthoredCheckpointCrossing({
        lane,
        distanceAlongM: 20,
        previous: { x: 3.4, z: 19 },
        current: { x: 3.4, z: 21 },
      }),
    ).toBe(false);
    expect(
      isAuthoredCheckpointCrossing({
        lane,
        distanceAlongM: 20,
        previous: { x: 0, z: 21 },
        current: { x: 0, z: 19 },
      }),
    ).toBe(false);
  });

  it("shows guidance in driving cameras but excludes it from the mirror", () => {
    expect(PRIMARY_CAMERA_LAYER_MASK & GUIDANCE_LAYER_MASK).toBe(
      GUIDANCE_LAYER_MASK,
    );
    expect(WORLD_LAYER_MASK & GUIDANCE_LAYER_MASK).toBe(0);
  });

  it("omits navigation cues from explicit junction connector ranges", () => {
    const connectorLane = {
      ...lane,
      connectorRanges: [
        { startDistanceAlongM: 0, endDistanceAlongM: 1.9 },
        { startDistanceAlongM: 38.1, endDistanceAlongM: 40 },
      ],
    } as const;
    expect(isLaneGuidanceDistanceAllowed(connectorLane, 0.8)).toBe(false);
    expect(isLaneGuidanceDistanceAllowed(connectorLane, 20)).toBe(true);
    expect(isLaneGuidanceDistanceAllowed(connectorLane, 39.2)).toBe(false);
  });

  it("renders one authoritative route occurrence and yields to overtaking", () => {
    expect(
      resolveAuthoritativeRouteIndex(4, {
        owner: { kind: "route", id: "lesson:route", stepId: "step-2", routeIndex: 2 },
        status: "ready",
        blockingReason: null,
      }),
    ).toBe(2);
    expect(
      resolveAuthoritativeRouteIndex(4, {
        owner: { kind: "route", id: "lesson:route", stepId: "step-2", routeIndex: 2 },
        status: "blocked",
        blockingReason: "off_route",
      }),
    ).toBe(2);
    expect(
      resolveAuthoritativeRouteIndex(4, {
        owner: { kind: "overtake", id: "pass", stepId: "observe", routeIndex: null },
        status: "ready",
        blockingReason: null,
      }),
    ).toBeNull();
  });

  it("does not stack a lane cue on the active checkpoint target", () => {
    expect(
      guidanceCueOverlapsCheckpoint(
        { laneId: "travel", distanceAlongM: 20 },
        { laneId: "travel", distanceAlongM: 21.5 },
      ),
    ).toBe(true);
    expect(
      guidanceCueOverlapsCheckpoint(
        { laneId: "travel", distanceAlongM: 20 },
        { laneId: "adjacent", distanceAlongM: 20 },
      ),
    ).toBe(false);
  });
});

describe("continuous road-surface rendering", () => {
  it("builds one mitered surface through a right-angle bend instead of separate chipped boxes", () => {
    const geometry = buildRoadSurfaceStripGeometry(
      [
        { x: 0, z: 0 },
        { x: 0, z: 10 },
        { x: 10, z: 10 },
      ],
      6,
    );

    expect(geometry.closed).toBe(false);
    expect(geometry.positions).toHaveLength(18);
    expect(geometry.indices).toHaveLength(12);
    // The shared corner uses the mitered outer and inner corners of the turn.
    expect(geometry.positions.slice(6, 12)).toEqual([3, 0, 7, -3, 0, 13]);
  });

  it("faces the asphalt upward so Babylon renders it from driving cameras", () => {
    const geometry = buildRoadSurfaceStripGeometry(
      [
        { x: 0, z: 0 },
        { x: 0, z: 10 },
      ],
      6,
    );
    const normals: number[] = [];

    VertexData.ComputeNormals(
      [...geometry.positions],
      [...geometry.indices],
      normals,
    );

    expect(normals.filter((_, index) => index % 3 === 1)).toEqual([
      1,
      1,
      1,
      1,
    ]);
  });

  it("wraps a closed roundabout strip without a final-segment seam", () => {
    const ring = [
      { x: -20, z: -20 },
      { x: 20, z: -20 },
      { x: 20, z: 20 },
      { x: -20, z: 20 },
      { x: -20, z: -20 },
    ] as const;
    const geometry = buildRoadSurfaceStripGeometry(ring, 7.2);

    expect(geometry.closed).toBe(true);
    expect(geometry.positions).toHaveLength(24);
    expect(geometry.indices).toHaveLength(24);
    const smoothed = smoothClosedRoadCenterline(ring);
    expect(smoothed).toHaveLength(16);
    const smoothGeometry = buildRoadSurfaceStripGeometry(smoothed, 7.2, true);
    expect(smoothGeometry).toMatchObject({
      closed: true,
      indices: expect.any(Array),
    });
    expect(smoothGeometry.indices).toHaveLength(96);
  });

  it("adds one asphalt apron only where independently-authored surfaces share a node", () => {
    const patches = collectRoadJunctionPatches([
      {
        id: "north-south",
        widthM: 7.2,
        centerline: [
          { x: 0, z: -40 },
          { x: 0, z: 0 },
          { x: 0, z: 40 },
        ],
      },
      {
        id: "east-west",
        widthM: 10,
        centerline: [
          { x: -40, z: 0 },
          { x: 0, z: 0 },
          { x: 40, z: 0 },
        ],
      },
      {
        id: "isolated",
        widthM: 7.2,
        centerline: [
          { x: 80, z: 80 },
          { x: 100, z: 80 },
        ],
      },
    ]);

    expect(patches).toEqual([{ x: 0, z: 0, radiusM: 5.42 }]);
  });
});

describe("cockpit camera tracking", () => {
  it("does not mistake Babylon's initially active chase camera for cockpit mode", () => {
    expect(
      isCameraStackActive("first", "third-person-camera", []),
    ).toBe(false);
    expect(
      isCameraStackActive("first", "first-person-camera", [
        "first-person-camera",
        "rear-view-camera",
      ]),
    ).toBe(true);
    expect(
      isCameraStackActive("third", "third-person-camera", [
        "third-person-camera",
      ]),
    ).toBe(true);
  });

  it("moves both first-person cameras with the vehicle in world space", () => {
    const start = resolveCockpitCameraPoses({
      x: -2,
      z: 10,
      vehicleHeading: 0,
      cameraHeading: 0,
      seatSide: -0.46,
      headBob: 0,
      quickLookAngle: 0,
    });
    const moved = resolveCockpitCameraPoses({
      x: 4,
      z: 28,
      vehicleHeading: 0,
      cameraHeading: 0,
      seatSide: -0.46,
      headBob: 0,
      quickLookAngle: 0,
    });

    expect(moved.first.x - start.first.x).toBeCloseTo(6);
    expect(moved.first.z - start.first.z).toBeCloseTo(18);
    expect(moved.rear.x - start.rear.x).toBeCloseTo(6);
    expect(moved.rear.z - start.rear.z).toBeCloseTo(18);
  });

  it("keeps the cockpit seat attached to the turning vehicle while looking with the road", () => {
    const pose = resolveCockpitCameraPoses({
      x: 12,
      z: -5,
      vehicleHeading: Math.PI / 2,
      cameraHeading: Math.PI / 2 + 0.1,
      seatSide: 0.46,
      headBob: 0.03,
      quickLookAngle: -0.25,
    });

    expect(pose.first.x).toBeCloseTo(11.4);
    expect(pose.first.z).toBeCloseTo(-5.46);
    expect(pose.first.y).toBeCloseTo(1.52);
    expect(pose.first.rotationX).toBeCloseTo(0.12);
    expect(pose.first.rotationY).toBeCloseTo(Math.PI / 2 - 0.15);
    expect(pose.rear.x).toBeCloseTo(11.48);
    expect(pose.rear.rotationX).toBeCloseTo(0.04);
    expect(pose.rear.rotationY).toBeCloseTo(Math.PI / 2 + 0.1 + Math.PI);
  });

  it("keeps the saved cockpit FOV within the supported horizontal range", () => {
    expect(clampHorizontalFieldOfView(DEFAULT_HORIZONTAL_FOV)).toBe(
      DEFAULT_HORIZONTAL_FOV,
    );
    expect(clampHorizontalFieldOfView(0)).toBe(MIN_HORIZONTAL_FOV);
    expect(clampHorizontalFieldOfView(Math.PI)).toBe(MAX_HORIZONTAL_FOV);
  });

  it("keeps the road sightline stable across landscape aspect ratios", () => {
    expect(resolveCockpitPitch(1.6)).toBeCloseTo(0.1);
    expect(resolveCockpitPitch(2)).toBeCloseTo(0.12);
    expect(resolveCockpitPitch(2.2)).toBeCloseTo(0.12);
  });

  it("spins the steering wheel around its own column axis", () => {
    expect(resolveSteeringWheelSpin(0)).toBe(0);
    expect(resolveSteeringWheelSpin(1)).toBe(-MAX_STEERING_WHEEL_SPIN);
    expect(resolveSteeringWheelSpin(-1)).toBe(MAX_STEERING_WHEEL_SPIN);
    expect(resolveSteeringWheelSpin(4)).toBe(-MAX_STEERING_WHEEL_SPIN);
  });

  it("mirrors the cockpit without embedding the wheel behind the dashboard", () => {
    const left = resolveCockpitSteeringGeometry("left");
    const right = resolveCockpitSteeringGeometry("right");

    expect(left.x).toBe(-right.x);
    expect(left.y).toBe(right.y);
    expect(left.z).toBe(right.z);
    expect(left.mountRotationX).toBe(right.mountRotationX);

    const rimRadius = left.wheelDiameter / 2 + left.rimThickness / 2;
    const deepestRimPoint =
      left.z + Math.abs(Math.cos(left.mountRotationX)) * rimRadius;
    expect(deepestRimPoint).toBeLessThan(COCKPIT_DASH_DRIVER_Z);
    expect(Math.cos(left.mountRotationX)).toBeLessThan(0);
    expect(Math.sin(left.mountRotationX)).toBeGreaterThan(0);
  });
});

describe("adaptive GameCanvas input presentation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses capabilities only for its initial presentation and never treats controller presence as input", () => {
    const updates: AdaptiveInputPresentation[] = [];
    const router = new AdaptiveInputRouter(
      { touchFirst: false, hybridTouch: true },
      false,
      (presentation) => updates.push(presentation),
    );

    expect(router.getPresentation()).toMatchObject({
      activeFamily: "keyboard",
      touchFirst: false,
      touchRevealed: false,
    });
    expect(updates).toHaveLength(0);

    router.registerMeaningfulInput("touch");
    expect(router.getPresentation()).toMatchObject({
      activeFamily: "touch",
      touchRevealed: true,
    });
    router.dispose();
  });

  it("debounces prompt switches but switches immediately when reduced motion is enabled", () => {
    vi.useFakeTimers();
    let now = 0;
    const router = new AdaptiveInputRouter(
      { touchFirst: false, hybridTouch: false },
      false,
      () => undefined,
      () => now,
    );

    router.registerMeaningfulInput("gamepad");
    expect(router.getPresentation().activeFamily).toBe("gamepad");

    now = 100;
    router.registerMeaningfulInput("keyboard");
    expect(router.getPresentation().activeFamily).toBe("gamepad");

    now = INPUT_PROMPT_SWITCH_COOLDOWN_MS;
    vi.advanceTimersByTime(INPUT_PROMPT_SWITCH_COOLDOWN_MS - 100);
    expect(router.getPresentation().activeFamily).toBe("keyboard");

    now += 1;
    router.registerMeaningfulInput("touch");
    router.setReducedMotion(true);
    expect(router.getPresentation().activeFamily).toBe("touch");
    router.dispose();
  });

  it("dims touch-first controls after non-touch use, restores them on touch, and falls back safely after a controller disconnect", () => {
    vi.useFakeTimers();
    let now = 0;
    const router = new AdaptiveInputRouter(
      { touchFirst: true, hybridTouch: false },
      false,
      () => undefined,
      () => now,
    );

    router.registerMeaningfulInput("keyboard");
    expect(router.getPresentation()).toMatchObject({
      activeFamily: "keyboard",
      touchControlsDimmed: false,
    });
    vi.advanceTimersByTime(TOUCH_CONTROL_DIM_DELAY_MS);
    expect(router.getPresentation().touchControlsDimmed).toBe(true);

    now = TOUCH_CONTROL_DIM_DELAY_MS + 1;
    router.registerMeaningfulInput("touch");
    expect(router.getPresentation()).toMatchObject({
      activeFamily: "touch",
      touchControlsDimmed: false,
    });

    now += INPUT_PROMPT_SWITCH_COOLDOWN_MS;
    router.registerMeaningfulInput("gamepad");
    expect(router.getPresentation().activeFamily).toBe("gamepad");
    expect(router.handleGamepadDisconnect()).toBe("touch");
    expect(router.getPresentation()).toMatchObject({
      activeFamily: "touch",
      touchControlsDimmed: false,
    });
    router.dispose();
  });

  it("applies the touch-overlay fallback immediately when reduced motion is enabled", () => {
    const router = new AdaptiveInputRouter(
      { touchFirst: true, hybridTouch: false },
      true,
      () => undefined,
    );

    router.registerMeaningfulInput("keyboard");
    expect(router.getPresentation()).toMatchObject({
      activeFamily: "keyboard",
      touchControlsDimmed: true,
    });
    router.dispose();
  });
});
