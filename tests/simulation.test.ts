import { describe, expect, it } from "vitest";
import { SimulationCore } from "../app/game/simulation";

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
});
