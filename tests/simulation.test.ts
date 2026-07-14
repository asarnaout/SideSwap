import { describe, expect, it } from "vitest";
import {
  SimulationCore,
  isRestrictionWindowActive,
} from "../app/game/simulation";
import { SCORING_CONFIG } from "../app/game/content";

describe("deterministic simulation", () => {
  it("produces the same snapshots for the same seed and inputs", () => {
    const left = new SimulationCore({ seed: 42, npcCount: 6 });
    const right = new SimulationCore({ seed: 42, npcCount: 6 });
    for (let index = 0; index < 180; index += 1) {
      const input = { throttle: 0.72, steer: index > 80 ? 0.08 : 0 };
      left.step(1 / 60, input);
      right.step(1 / 60, input);
    }
    expect(left.getSnapshot()).toEqual(right.getSnapshot());
  });

  it("requires a stop before switching direction and never reverses via brake", () => {
    const simulation = new SimulationCore({ npcCount: 0 });
    for (let index = 0; index < 60; index += 1) {
      simulation.step(1 / 60, { throttle: 1 });
    }
    expect(simulation.toggleGear()).toBe(false);
    expect(simulation.getSnapshot().player.gear).toBe("drive");
    for (let index = 0; index < 120; index += 1) {
      simulation.step(1 / 60, { brake: 1 });
    }
    expect(simulation.getSnapshot().player.signedSpeedMps).toBe(0);
    expect(simulation.getSnapshot().player.gear).toBe("drive");
    expect(simulation.toggleGear()).toBe(true);
    expect(simulation.getSnapshot().player.gear).toBe("reverse");
  });

  it("keeps snapshots serializable and uses weighted scoring", () => {
    const simulation = new SimulationCore({
      trafficSide: "left",
      speedUnit: "kmh",
      seed: 7,
    });
    const snapshot = simulation.step(1 / 30, { throttle: 0.4 });
    expect(() => JSON.stringify(snapshot)).not.toThrow();
    expect(snapshot.trafficSide).toBe("left");
    expect(snapshot.speedUnit).toBe("kmh");
    expect(snapshot.score.total).toBe(
      Math.round(
        snapshot.score.safety * 0.5 +
          snapshot.score.ruleUse * 0.35 +
          snapshot.score.vehicleControl * 0.15,
      ),
    );
  });

  it("maps the passing lane to the jurisdiction-appropriate side", () => {
    const rightTraffic = new SimulationCore({
      trafficSide: "right",
      npcCount: 0,
      spawn: { x: 1.75, z: -75, heading: 0 },
    });
    const leftTraffic = new SimulationCore({
      trafficSide: "left",
      npcCount: 0,
      spawn: { x: -1.75, z: -75, heading: 0 },
    });
    expect(rightTraffic.getSnapshot().road.laneRole).toBe("passing");
    expect(leftTraffic.getSnapshot().road.laneRole).toBe("passing");
    expect(rightTraffic.getSnapshot().player.x).toBeGreaterThan(0);
    expect(leftTraffic.getSnapshot().player.x).toBeLessThan(0);
  });

  it("pauses on sustained wrong-way driving and explains recovery", () => {
    const simulation = new SimulationCore({
      lessonId: "wrong-way-check",
      trafficSide: "right",
      npcCount: 0,
      lanes: [
        {
          id: "wide-lane",
          points: [
            { x: 0, z: -100 },
            { x: 0, z: 100 },
          ],
          width: 20,
          speedLimitMps: 20,
          loop: false,
        },
      ],
      spawn: { x: 0, z: 0, heading: Math.PI },
      bounds: { minX: -30, maxX: 30, minZ: -120, maxZ: 120 },
    });

    for (let index = 0; index < 240; index += 1) {
      simulation.step(1 / 60, { throttle: 1 });
      if (simulation.getSnapshot().status === "incident") break;
    }

    const snapshot = simulation.getSnapshot();
    expect(snapshot.status).toBe("incident");
    expect(snapshot.activeIncident?.code).toBe("wrong_way");
    expect(snapshot.activeIncident?.penalty).toBe(
      SCORING_CONFIG.penalties.wrong_way,
    );
    expect(snapshot.activeIncident?.correction).toContain("Keep to the right");
    expect(snapshot.score.criticalErrors).toBe(1);
    expect(snapshot.player.speedMps).toBe(0);
  });

  it("returns to an authored checkpoint without clearing earned score", () => {
    const simulation = new SimulationCore({ npcCount: 0 });
    simulation.setCheckpoint({ id: "safe-turn", x: 5.25, z: -20, heading: 0 });
    for (let index = 0; index < 90; index += 1) {
      simulation.step(1 / 60, { throttle: 0.7 });
    }
    const scoreBefore = simulation.getSnapshot().score.total;
    simulation.resetToCheckpoint();
    const restored = simulation.getSnapshot();
    expect(restored.checkpointId).toBe("safe-turn");
    expect(restored.player.x).toBe(5.25);
    expect(restored.player.z).toBe(-20);
    expect(restored.player.speedMps).toBe(0);
    expect(restored.score.total).toBe(scoreBefore);
  });

  it("assesses a blocked box-junction exit once the player enters the conflict zone", () => {
    const simulation = new SimulationCore({
      lessonId: "london-box-test",
      seed: 12,
      npcCount: 1,
      lanes: [
        {
          id: "cromwell-east",
          points: [
            { x: 0, z: -20 },
            { x: 0, z: 20 },
          ],
          width: 6,
          speedLimitMps: 20,
          loop: false,
        },
      ],
      spawn: { x: 0, z: -12, heading: 0 },
      bounds: { minX: -10, maxX: 10, minZ: -24, maxZ: 24 },
      trafficGates: [
        {
          id: "slow-blocker",
          laneId: "cromwell-east",
          distance: 28,
          desiredSpeedMps: 1,
        },
      ],
      boxJunctions: [
        {
          id: "cromwell-yellow-box",
          laneIds: ["cromwell-east"],
          polygon: [
            { x: -3, z: -8 },
            { x: 3, z: -8 },
            { x: 3, z: -2 },
            { x: -3, z: -2 },
          ],
          exitClearanceM: 24,
        },
      ],
    });

    for (let index = 0; index < 180; index += 1) {
      simulation.step(1 / 60, { throttle: 0.8 });
    }

    const event = simulation
      .getEvents()
      .find((candidate) => candidate.code === "box_junction");
    expect(event?.severity).toBe("minor");
    expect(event?.penalty).toBe(SCORING_CONFIG.penalties.box_junction);
    expect(event?.message).toContain("exit was clear");
    expect(event?.evidence).toMatchObject({
      junctionId: "cromwell-yellow-box",
      laneId: "cromwell-east",
      blockingVehicleId: "npc-1",
    });
    expect(simulation.getSnapshot().score.ruleUse).toBe(
      100 - (SCORING_CONFIG.penalties.box_junction ?? 0),
    );
  });

  it("does not penalize a box-junction entry when its exit is clear", () => {
    const simulation = new SimulationCore({
      npcCount: 0,
      lanes: [
        {
          id: "clear-exit",
          points: [
            { x: 0, z: -20 },
            { x: 0, z: 20 },
          ],
          width: 6,
          speedLimitMps: 20,
          loop: false,
        },
      ],
      spawn: { x: 0, z: -12, heading: 0 },
      bounds: { minX: -10, maxX: 10, minZ: -24, maxZ: 24 },
      boxJunctions: [
        {
          id: "clear-box",
          laneIds: ["clear-exit"],
          polygon: [
            { x: -3, z: -8 },
            { x: 3, z: -8 },
            { x: 3, z: -2 },
            { x: -3, z: -2 },
          ],
        },
      ],
    });
    for (let index = 0; index < 180; index += 1) {
      simulation.step(1 / 60, { throttle: 0.8 });
    }
    expect(simulation.getEvents().some((event) => event.code === "box_junction")).toBe(false);
    expect(simulation.getSnapshot().score.ruleUse).toBe(100);
  });

  it("uses the fixed scenario clock for sustained restricted-lane assessment and cooldown", () => {
    const simulation = new SimulationCore({
      lessonId: "london-restricted-lane-test",
      npcCount: 0,
      lanes: [
        {
          id: "signed-bus-lane",
          points: [
            { x: 0, z: -500 },
            { x: 0, z: 500 },
          ],
          width: 6,
          speedLimitMps: 20,
          loop: false,
        },
      ],
      spawn: { x: 0, z: -400, heading: 0 },
      bounds: { minX: -10, maxX: 10, minZ: -510, maxZ: 510 },
      scenarioClock: {
        weekday: "mon",
        minutesAfterMidnight: 8 * 60 + 30,
        label: "Monday 08:30",
      },
      laneRestrictions: [
        {
          id: "museum-bus-lane-hours",
          laneId: "signed-bus-lane",
          ruleCode: "restricted_lane",
          activeWindows: [
            {
              weekdays: ["mon", "tue", "wed", "thu", "fri"],
              startMinutes: 7 * 60,
              endMinutes: 19 * 60,
            },
          ],
          sourceReferenceId: "uk-highway-code-140",
          message: "This signed lane is restricted at the displayed lesson time.",
        },
      ],
    });

    for (let index = 0; index < 360; index += 1) {
      simulation.step(1 / 60, { throttle: 0.55 });
    }
    const firstEvents = simulation
      .getEvents()
      .filter((event) => event.code === "restricted_lane");
    expect(firstEvents).toHaveLength(1);
    expect(firstEvents[0].evidence).toMatchObject({
      restrictionId: "museum-bus-lane-hours",
      laneId: "signed-bus-lane",
      scenarioTime: "Monday 08:30",
      sourceReferenceId: "uk-highway-code-140",
      sustainedSeconds: 2.5,
    });
    expect(simulation.getSnapshot().scenarioClock?.label).toBe("Monday 08:30");
    expect(simulation.getSnapshot().score.ruleUse).toBe(96);

    for (let index = 0; index < 300; index += 1) {
      simulation.step(1 / 60, { throttle: 0.55 });
    }
    expect(
      simulation.getEvents().filter((event) => event.code === "restricted_lane"),
    ).toHaveLength(1);

    for (let index = 0; index < 420; index += 1) {
      simulation.step(1 / 60, { throttle: 0.55 });
    }
    expect(
      simulation.getEvents().filter((event) => event.code === "restricted_lane"),
    ).toHaveLength(2);
  });

  it("handles inactive and overnight signed restriction windows deterministically", () => {
    expect(
      isRestrictionWindowActive(
        { weekday: "sat", minutesAfterMidnight: 9 * 60, label: "Saturday 09:00" },
        {
          weekdays: ["mon", "tue", "wed", "thu", "fri"],
          startMinutes: 7 * 60,
          endMinutes: 19 * 60,
        },
      ),
    ).toBe(false);
    expect(
      isRestrictionWindowActive(
        { weekday: "tue", minutesAfterMidnight: 60, label: "Tuesday 01:00" },
        {
          weekdays: ["mon"],
          startMinutes: 23 * 60,
          endMinutes: 2 * 60,
        },
      ),
    ).toBe(true);
    expect(
      isRestrictionWindowActive(
        { weekday: "tue", minutesAfterMidnight: 3 * 60, label: "Tuesday 03:00" },
        {
          weekdays: ["mon"],
          startMinutes: 23 * 60,
          endMinutes: 2 * 60,
        },
      ),
    ).toBe(false);
  });

  it("moves NPCs continuously through authored successor lanes", () => {
    const simulation = new SimulationCore({
      npcCount: 1,
      lanes: [
        {
          id: "player-lane",
          points: [{ x: 50, z: 0 }, { x: 50, z: 100 }],
          loop: false,
        },
        {
          id: "approach",
          points: [{ x: 0, z: 0 }, { x: 0, z: 20 }],
          successorLaneIds: ["exit"],
          loop: false,
        },
        {
          id: "exit",
          points: [{ x: 0, z: 20 }, { x: 20, z: 20 }],
          loop: false,
        },
      ],
      spawn: { x: 50, z: 10, heading: 0 },
      bounds: { minX: -10, maxX: 60, minZ: -10, maxZ: 110 },
      trafficGates: [
        { id: "approach-edge", laneId: "approach", distance: 18, desiredSpeedMps: 6 },
      ],
    });

    let previous = simulation.getSnapshot().npcs[0];
    let enteredSuccessor = false;
    for (let index = 0; index < 180; index += 1) {
      const current = simulation.step(1 / 60).npcs[0];
      if (!current) continue;
      const displacement = Math.hypot(current.x - previous.x, current.z - previous.z);
      expect(displacement).toBeLessThanOrEqual(current.speedMps / 60 + 0.05);
      enteredSuccessor ||= current.laneId === "exit";
      previous = current;
    }
    expect(enteredSuccessor).toBe(true);
    expect(simulation.getSnapshot().status).toBe("running");
  });

  it("queues an NPC at a dead end instead of wrapping it to the lane start", () => {
    const simulation = new SimulationCore({
      npcCount: 1,
      minRuntimeSpawnDistanceM: 200,
      lanes: [
        {
          id: "player-lane",
          points: [{ x: 100, z: 0 }, { x: 100, z: 100 }],
          loop: false,
        },
        {
          id: "dead-end",
          points: [{ x: 0, z: 0 }, { x: 0, z: 10 }],
          loop: false,
        },
      ],
      spawn: { x: 100, z: 10, heading: 0 },
      bounds: { minX: -10, maxX: 110, minZ: -10, maxZ: 110 },
      trafficGates: [
        { id: "dead-end-edge", laneId: "dead-end", distance: 8, desiredSpeedMps: 6 },
      ],
    });
    for (let index = 0; index < 180; index += 1) simulation.step(1 / 60);
    expect(simulation.getSnapshot().npcs).toHaveLength(0);
    expect(simulation.getSnapshot().queuedNpcCount).toBe(1);
  });

  it("keeps a runtime gate 150 metres directly ahead queued inside camera range", () => {
    const simulation = new SimulationCore({
      npcCount: 1,
      minRuntimeSpawnDistanceM: 70,
      lanes: [
        {
          id: "visibility-lane",
          points: [{ x: 0, z: 0 }, { x: 0, z: 500 }],
          width: 3.5,
          speedLimitMps: 20,
          loop: false,
        },
      ],
      spawn: { x: 0, z: 0, heading: 0 },
      bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 510 },
      trafficGates: [
        {
          id: "visible-forward-gate",
          laneId: "visibility-lane",
          distance: 150,
          desiredSpeedMps: 10,
          allowInitialSpawn: false,
        },
      ],
    });

    for (let tick = 0; tick < 60; tick += 1) {
      simulation.step(1 / 60, { viewHeading: 0 });
    }
    expect(simulation.getSnapshot()).toMatchObject({
      npcs: [],
      queuedNpcCount: 1,
    });
  });

  it("activates an otherwise safe runtime gate about 200 metres ahead", () => {
    const simulation = new SimulationCore({
      npcCount: 1,
      minRuntimeSpawnDistanceM: 70,
      lanes: [
        {
          id: "visibility-lane",
          points: [{ x: 0, z: 0 }, { x: 0, z: 500 }],
          width: 3.5,
          speedLimitMps: 20,
          loop: false,
        },
      ],
      spawn: { x: 0, z: 0, heading: 0 },
      bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 510 },
      trafficGates: [
        {
          id: "clear-forward-gate",
          laneId: "visibility-lane",
          distance: 200,
          desiredSpeedMps: 10,
          allowInitialSpawn: false,
        },
      ],
    });

    for (let tick = 0; tick < 12; tick += 1) {
      simulation.step(1 / 60, { viewHeading: 0 });
    }
    expect(simulation.getSnapshot()).toMatchObject({
      queuedNpcCount: 0,
      npcs: [{ laneId: "visibility-lane" }],
    });
  });

  it("keeps a runtime gate within the rear mirror envelope queued", () => {
    const simulation = new SimulationCore({
      npcCount: 1,
      minRuntimeSpawnDistanceM: 70,
      lanes: [
        {
          id: "visibility-lane",
          points: [{ x: 0, z: 0 }, { x: 0, z: 500 }],
          width: 3.5,
          speedLimitMps: 20,
          loop: false,
        },
      ],
      spawn: { x: 0, z: 200, heading: 0 },
      bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 510 },
      trafficGates: [
        {
          id: "visible-rear-gate",
          laneId: "visibility-lane",
          distance: 100,
          desiredSpeedMps: 10,
          allowInitialSpawn: false,
        },
      ],
    });

    for (let tick = 0; tick < 60; tick += 1) {
      simulation.step(1 / 60, { viewHeading: 0 });
    }
    expect(simulation.getSnapshot()).toMatchObject({
      npcs: [],
      queuedNpcCount: 1,
    });
  });

  it("keeps a safe gap behind a stationary legal player for sixty seconds", () => {
    const simulation = new SimulationCore({
      seed: 1251,
      npcCount: 1,
      lanes: [
        {
          id: "london-left-lane",
          points: [{ x: 0, z: 0 }, { x: 0, z: 300 }],
          speedLimitMps: 13,
          loop: false,
        },
      ],
      spawn: { x: 0, z: 100, heading: 0 },
      bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 310 },
      trafficGates: [
        { id: "london-rear-gate", laneId: "london-left-lane", distance: 40, desiredSpeedMps: 12 },
      ],
    });
    for (let index = 0; index < 60 * 60; index += 1) simulation.step(1 / 60);
    const snapshot = simulation.getSnapshot();
    expect(snapshot.status).toBe("running");
    expect(snapshot.score.criticalErrors).toBe(0);
    expect(snapshot.npcs[0].z).toBeLessThanOrEqual(95);
  });

  it("requeues traffic that conflicts with a restored checkpoint", () => {
    const simulation = new SimulationCore({
      npcCount: 1,
      minRuntimeSpawnDistanceM: 200,
      lanes: [
        {
          id: "recovery-lane",
          points: [{ x: 0, z: 0 }, { x: 0, z: 300 }],
          loop: false,
        },
      ],
      spawn: { x: 0, z: 100, heading: 0 },
      bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 310 },
      trafficGates: [
        { id: "recovery-gate", laneId: "recovery-lane", distance: 20, desiredSpeedMps: 4 },
      ],
    });
    expect(simulation.getSnapshot().npcs).toHaveLength(1);
    simulation.setCheckpoint({ id: "near-traffic", x: 0, z: 22, heading: 0 });
    simulation.resetToCheckpoint();
    expect(simulation.getSnapshot().npcs).toHaveLength(0);
    expect(simulation.getSnapshot().queuedNpcCount).toBe(1);
    expect(simulation.getSnapshot().score.criticalErrors).toBe(0);
  });

  it("supports UK red-amber and all-red clearance phases per approach", () => {
    const simulation = new SimulationCore({
      npcCount: 0,
      lanes: [
        { id: "signal-lane", points: [{ x: 0, z: 0 }, { x: 0, z: 100 }], loop: false },
      ],
      spawn: { x: 0, z: 10, heading: 0 },
      trafficLights: [
        {
          id: "uk-primary",
          phaseGroup: "north-south",
          x: 0,
          z: 50,
          cycle: {
            sequence: "uk",
            greenSeconds: 1,
            amberSeconds: 1,
            allRedSeconds: 1,
            redSeconds: 1,
            redAmberSeconds: 1,
          },
        },
      ],
    });
    const state = () => simulation.getSnapshot().trafficLights[0];
    const advance = (seconds: number) => {
      for (let index = 0; index < Math.ceil(seconds * 60); index += 1) {
        simulation.step(1 / 60);
      }
    };
    expect(state()).toMatchObject({ state: "green", phaseGroup: "north-south" });
    advance(1.05);
    expect(state().state).toBe("amber");
    advance(1);
    expect(state().state).toBe("all_red");
    advance(1);
    expect(state().state).toBe("red");
    advance(1);
    expect(state().state).toBe("red_amber");
  });

  it("stops NPC traffic at an active railway warning and assesses a player crossing", () => {
    const sharedConfig = {
      lanes: [
        {
          id: "rail-approach",
          points: [{ x: 0, z: 0 }, { x: 0, z: 100 }],
          width: 3.2,
          speedLimitMps: 12,
          loop: false,
        },
        {
          id: "player-safe-lane",
          points: [{ x: 50, z: 0 }, { x: 50, z: 100 }],
          width: 3.2,
          speedLimitMps: 12,
          loop: false,
        },
      ],
      bounds: { minX: -10, maxX: 60, minZ: -10, maxZ: 110 },
      trafficLights: [
        {
          id: "rail-warning",
          phaseGroup: "railway",
          x: 0,
          z: 20,
          cycle: {
            sequence: "standard" as const,
            greenSeconds: 1,
            amberSeconds: 0.5,
            allRedSeconds: 0.5,
            redSeconds: 20,
            redAmberSeconds: 0,
            offsetSeconds: 2.1,
          },
        },
      ],
      stopLines: [
        {
          id: "rail-stop-line",
          laneId: "rail-approach",
          distance: 20,
          kind: "railway" as const,
          trafficLightId: "rail-warning",
        },
      ],
    };

    const traffic = new SimulationCore({
      ...sharedConfig,
      spawn: { x: 50, z: 10, heading: 0 },
      npcCount: 1,
      trafficGates: [
        {
          id: "rail-traffic-gate",
          laneId: "rail-approach",
          distance: 2,
          desiredSpeedMps: 8,
        },
      ],
    });
    for (let tick = 0; tick < 6 * 60; tick += 1) traffic.step(1 / 60);
    const railNpc = traffic.getSnapshot().npcs[0];
    expect(railNpc?.z).toBeLessThan(20);
    expect(railNpc?.speedMps).toBeLessThan(0.4);

    const player = new SimulationCore({
      ...sharedConfig,
      spawn: { x: 0, z: 10, heading: 0 },
      npcCount: 0,
      scoring: SCORING_CONFIG,
    });
    for (let tick = 0; tick < 5 * 60; tick += 1) {
      player.step(1 / 60, { throttle: 1 });
    }
    const railwayEvent = player
      .getEvents()
      .find((event) => event.code === "railway_crossing");
    expect(railwayEvent?.penalty).toBe(
      SCORING_CONFIG.penalties.railway_crossing,
    );
    expect(railwayEvent?.evidence).toMatchObject({ warningActive: true });
  });
});
