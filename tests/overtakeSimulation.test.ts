import { describe, expect, it } from "vitest";
import {
  SimulationCore,
  type SimulationCoreConfig,
  type SimulationInput,
} from "../app/game/simulation";

type AttemptOptions = Readonly<{
  blocker?: boolean;
  missingPassObservation?: boolean;
  wrongPassIndicator?: boolean;
  speed?: boolean;
  earlyReturn?: boolean;
}>;

const NORMAL_LANE_ID = "training-normal";
const PASSING_LANE_ID = "training-passing";
const MANEUVER_ID = "training-overtake";

function returnStartFor(options: AttemptOptions): number {
  return options.earlyReturn ? 220 : 500;
}

function overtakeConfig(options: AttemptOptions = {}): SimulationCoreConfig {
  const returnStart = returnStartFor(options);
  return {
    trafficSide: "left",
    speedUnit: "mph",
    seed: 41,
    lessonId: "overtake-test",
    lanes: [
      {
        id: NORMAL_LANE_ID,
        points: [
          { x: -1.75, z: 0 },
          { x: -1.75, z: 900 },
        ],
        width: 3.5,
        role: "travel",
        adjacentLaneId: PASSING_LANE_ID,
        speedLimitMps: 20,
        loop: false,
      },
      {
        id: PASSING_LANE_ID,
        points: [
          { x: 1.75, z: 0 },
          { x: 1.75, z: 900 },
        ],
        width: 3.5,
        role: "passing",
        adjacentLaneId: NORMAL_LANE_ID,
        speedLimitMps: 20,
        loop: false,
      },
    ],
    bounds: { minX: -12, maxX: 12, minZ: -10, maxZ: 910 },
    spawn: { x: -1.75, z: 0, heading: 0 },
    trafficGates: options.blocker
      ? [
          {
            id: "passing-blocker",
            laneId: PASSING_LANE_ID,
            distance: 150,
            desiredSpeedMps: 1,
          },
        ]
      : [],
    npcCount: options.blocker ? 2 : 1,
    maxForwardSpeedMps: options.speed ? 28 : 20,
    maxReverseSpeedMps: 6,
    maneuvers: [
      {
        id: MANEUVER_ID,
        kind: "overtake",
        normalLaneId: NORMAL_LANE_ID,
        passingLaneId: PASSING_LANE_ID,
        corridorStart: { laneId: NORMAL_LANE_ID, distance: 10 },
        corridorEnd: { laneId: NORMAL_LANE_ID, distance: 840 },
        leadVehicleStart: {
          laneId: NORMAL_LANE_ID,
          distance: options.earlyReturn ? 180 : 105,
        },
        leadVehicleSpeedFactor: 0.75,
        phaseAnchors: {
          approach: { laneId: NORMAL_LANE_ID, distance: 20 },
          observe: { laneId: NORMAL_LANE_ID, distance: 60 },
          pass: { laneId: PASSING_LANE_ID, distance: 180 },
          return: { laneId: PASSING_LANE_ID, distance: returnStart - 30 },
          complete: { laneId: NORMAL_LANE_ID, distance: returnStart + 100 },
        },
        predictedClearSeconds: 4,
        returnStandstillGapM: 4,
        returnHeadwaySeconds: 1.8,
        sourceReferenceIds: ["training-rule"],
      },
    ],
  };
}

function runAttempt(options: AttemptOptions = {}) {
  const simulation = new SimulationCore(overtakeConfig(options));
  let passActionSent = false;
  let returnActionSent = false;
  const gateLabels = new Set<string>();
  const eventsById = new Map<string, ReturnType<SimulationCore["getSnapshot"]>["recentEvents"][number]>();

  for (let tick = 0; tick < 60 * 48; tick += 1) {
    const before = simulation.getSnapshot();
    const maneuver = before.maneuvers[0];
    let observe: SimulationInput["observe"];
    let signalLeft = false;
    let signalRight = false;
    if (maneuver?.phase === "observe" && !passActionSent) {
      if (!options.missingPassObservation) observe = "right";
      if (options.wrongPassIndicator) signalLeft = true;
      else signalRight = true;
      passActionSent = true;
    }
    if (
      ((options.earlyReturn &&
        (maneuver?.phase === "pass" ||
          maneuver?.phase === "establish_clearance") &&
        before.player.z >= returnStartFor(options) - 30) ||
        (!options.earlyReturn && maneuver?.safeToReturn === true)) &&
      !returnActionSent
    ) {
      observe = "left";
      signalLeft = true;
      returnActionSent = true;
    }
    const targetLaneX =
      maneuver?.phase === "observe" ||
      maneuver?.phase === "pass" ||
      maneuver?.phase === "establish_clearance" ||
      maneuver?.phase === "return"
        ? 1.75
        : -1.75;
    const targetX = returnActionSent ? -1.75 : targetLaneX;
    const desiredHeading = Math.atan2(targetX - before.player.x, 18);
    const headingError = Math.atan2(
      Math.sin(desiredHeading - before.player.heading),
      Math.cos(desiredHeading - before.player.heading),
    );
    const input: SimulationInput = {
      throttle: 1,
      steer: Math.max(-1, Math.min(1, headingError * 3.4)),
      viewHeading: Math.PI,
      ...(observe ? { observe } : {}),
      ...(signalLeft ? { signalLeft: true } : {}),
      ...(signalRight ? { signalRight: true } : {}),
    };
    const after = simulation.step(1 / 60, input);
    for (const event of after.recentEvents) eventsById.set(event.id, event);
    const gate = after.maneuvers[0]?.gate;
    if (gate) gateLabels.add(gate.label);
    if (after.maneuvers[0]?.phase === "complete") break;
    if (
      options.blocker &&
      after.recentEvents.some(
        (event) => event.code === "unsafe_gap" && event.evidence.maneuverPhase === "pass",
      )
    ) {
      break;
    }
    if (
      options.earlyReturn &&
      after.recentEvents.some(
        (event) => event.code === "unsafe_gap" && event.evidence.cutIn === true,
      )
    ) {
      break;
    }
  }

  return {
    simulation,
    snapshot: simulation.getSnapshot(),
    gateLabels,
    allEvents: [...eventsById.values()],
  };
}

describe("guided overtaking simulation", () => {
  it("keeps PASS hidden and rejects a lane entry that lacks a four-second predicted gap", () => {
    const { snapshot, allEvents, gateLabels } = runAttempt({ blocker: true });
    const event = allEvents.find(
      (candidate) =>
        candidate.code === "unsafe_gap" &&
        candidate.evidence.maneuverPhase === "pass",
    );
    expect(event?.evidence).toMatchObject({
      maneuverId: MANEUVER_ID,
      predictedClearSeconds: 4,
      targetLaneClear: false,
      cutIn: false,
    });
    expect(snapshot.maneuvers[0].passEntryValid).toBe(false);
    expect(snapshot.maneuvers[0].phase).not.toBe("complete");
    expect(gateLabels.has("PASS WHEN CLEAR")).toBe(false);
  });

  it("records the expected and actual signal and refuses completion for a wrong indicator", () => {
    const { snapshot } = runAttempt({ wrongPassIndicator: true });
    const event = snapshot.recentEvents.find(
      (candidate) =>
        candidate.code === "missing_indicator" &&
        candidate.evidence.maneuverPhase === "pass",
    );
    expect(event?.evidence).toMatchObject({
      maneuverId: MANEUVER_ID,
      expectedSignal: "right",
      actualSignal: "left",
      passingSide: "right",
    });
    expect(snapshot.maneuvers[0].passEntryValid).toBe(false);
    expect(snapshot.maneuvers[0].phase).not.toBe("complete");
  });

  it("requires a fresh passing-side observation before lane entry", () => {
    const { snapshot } = runAttempt({ missingPassObservation: true });
    const event = snapshot.recentEvents.find(
      (candidate) =>
        candidate.code === "observation" &&
        candidate.evidence.maneuverPhase === "pass",
    );
    expect(event?.evidence).toMatchObject({
      maneuverId: MANEUVER_ID,
      expectedObservationSide: "right",
      observed: false,
    });
    expect(snapshot.maneuvers[0].passEntryValid).toBe(false);
    expect(snapshot.maneuvers[0].phase).not.toBe("complete");
  });

  it("penalizes speeding without silently soft-locking the maneuver", () => {
    const { snapshot } = runAttempt({ speed: true });
    const event = snapshot.recentEvents.find(
      (candidate) => candidate.code === "speeding",
    );
    expect(event?.evidence).toMatchObject({
      maneuverId: MANEUVER_ID,
      passingSide: "right",
    });
    expect(snapshot.maneuvers[0].speedCompliant).toBe(false);
    expect(snapshot.maneuvers[0].phase).toBe("complete");
    expect(snapshot.score.total).toBeLessThan(100);
  });

  it("identifies a premature return as a cut-in and refuses completion", () => {
    const { snapshot } = runAttempt({ earlyReturn: true });
    const event = snapshot.recentEvents.find(
      (candidate) =>
        candidate.code === "unsafe_gap" && candidate.evidence.cutIn === true,
    );
    expect(event?.evidence).toMatchObject({
      maneuverId: MANEUVER_ID,
      maneuverPhase: "return",
      leadVehicleId: `maneuver-${MANEUVER_ID}-lead`,
      cutIn: true,
    });
    expect(event?.evidence.actualClearanceM).toBeLessThan(
      event?.evidence.requiredClearanceM as number,
    );
    expect(snapshot.maneuvers[0].returnEntryValid).toBe(false);
    expect(snapshot.maneuvers[0].phase).not.toBe("complete");
  });

  it("completes only the observed, correctly signalled, speed-compliant safe sequence", () => {
    const { snapshot, gateLabels } = runAttempt();
    expect(snapshot.maneuvers[0]).toMatchObject({
      phase: "complete",
      passingSide: "right",
      passEntryValid: true,
      returnEntryValid: true,
      speedCompliant: true,
      safeToReturn: true,
      gate: null,
    });
    expect(gateLabels).toEqual(
      new Set(["CHECK RIGHT", "PASS WHEN CLEAR", "RETURN LEFT"]),
    );
    expect(
      snapshot.recentEvents.some((event) =>
        ["unsafe_gap", "missing_indicator", "observation", "speeding"].includes(
          event.code,
        ),
      ),
    ).toBe(false);
  });

  it("initializes the lead before the first frame and preserves a recoverable head start for a waiting player", () => {
    const leadId = `maneuver-${MANEUVER_ID}-lead`;
    const waitingSimulation = new SimulationCore(overtakeConfig());
    const initialized = waitingSimulation
      .getSnapshot()
      .npcs.find((npc) => npc.id === leadId);
    expect(initialized).toMatchObject({
      laneId: NORMAL_LANE_ID,
      speedMps: 0,
    });
    for (let tick = 0; tick < 60 * 45; tick += 1) {
      waitingSimulation.step(1 / 60, { brake: 1, viewHeading: Math.PI });
    }
    const held = waitingSimulation
      .getSnapshot()
      .npcs.find((npc) => npc.id === leadId);
    expect(held?.laneId).toBe(NORMAL_LANE_ID);
    expect((held?.z ?? 0) - (initialized?.z ?? 0)).toBeGreaterThan(40);
    expect((held?.z ?? 0) - (initialized?.z ?? 0)).toBeLessThan(65);
    expect(held?.speedMps).toBeLessThan(0.2);

    const releasedSimulation = new SimulationCore(overtakeConfig());
    let pacedSpeedMps = 0;
    for (let tick = 0; tick < 60 * 25; tick += 1) {
      const snapshot = releasedSimulation.step(1 / 60, {
        throttle: 1,
        viewHeading: Math.PI,
      });
      pacedSpeedMps =
        snapshot.npcs.find((npc) => npc.id === leadId)?.speedMps ?? 0;
      if (pacedSpeedMps >= 14.5) break;
    }
    expect(pacedSpeedMps).toBeCloseTo(15, 0);
  });
});

describe("lane-authoritative checkpoints", () => {
  it("does not activate from a nearby parallel lane or skip a later checkpoint", () => {
    const simulation = new SimulationCore({
      npcCount: 0,
      lanes: [
        {
          id: "checkpoint-lane",
          points: [{ x: 0, z: 0 }, { x: 0, z: 120 }],
          width: 3.5,
          loop: false,
        },
        {
          id: "parallel-lane",
          points: [{ x: 3.5, z: 0 }, { x: 3.5, z: 120 }],
          width: 3.5,
          loop: false,
        },
      ],
      spawn: { x: 3.5, z: 18, heading: 0 },
      checkpoints: [
        {
          id: "first",
          x: 0,
          z: 80,
          heading: 0,
          laneId: "checkpoint-lane",
          width: 3.5,
          distance: 80,
        },
        {
          id: "later-but-near",
          x: 0,
          z: 20,
          heading: 0,
          laneId: "checkpoint-lane",
          width: 3.5,
          distance: 20,
        },
      ],
    });
    for (let tick = 0; tick < 60; tick += 1) {
      simulation.step(1 / 60, { throttle: 0.4 });
    }
    expect(simulation.getSnapshot()).toMatchObject({
      reachedCheckpointIds: ["start"],
      nextCheckpointId: "first",
      checkpointId: "start",
    });
  });

  it("requires the full player footprint to be inside the authored lane", () => {
    const simulation = new SimulationCore({
      npcCount: 0,
      lanes: [
        {
          id: "checkpoint-lane",
          points: [{ x: 0, z: 0 }, { x: 0, z: 120 }],
          width: 3.5,
          loop: false,
        },
        {
          id: "parallel-lane",
          points: [{ x: 3.5, z: 0 }, { x: 3.5, z: 120 }],
          width: 3.5,
          loop: false,
        },
      ],
      // The centre is in checkpoint-lane, but the car overlaps its boundary.
      spawn: { x: 1.3, z: 70, heading: 0 },
      checkpoints: [
        {
          id: "footprint-check",
          x: 0,
          z: 80,
          heading: 0,
          laneId: "checkpoint-lane",
          width: 3.5,
          distance: 80,
        },
      ],
    });
    for (let tick = 0; tick < 60 * 3; tick += 1) {
      simulation.step(1 / 60, { throttle: 1 });
    }
    expect(simulation.getSnapshot()).toMatchObject({
      reachedCheckpointIds: ["start"],
      nextCheckpointId: "footprint-check",
    });
  });
});
