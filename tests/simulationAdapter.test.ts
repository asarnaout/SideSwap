import { describe, expect, it } from "vitest";
import {
  LESSONS,
  getLesson,
  getMapPack,
} from "../app/game/content";
import { SimulationCore } from "../app/game/simulation";
import {
  buildSimulationCoreConfig,
  expectedSimulationNpcCount,
  resolveSimulationLaneAnchor,
  resolveSimulationStartPose,
} from "../app/game/simulationAdapter";

describe("simulation runtime adapter", () => {
  it("starts London on its authored left-running lane rather than the road centre", () => {
    const lesson = getLesson("uk-london-left-side-basics");
    const mapPack = getMapPack(lesson.mapId);
    const start = resolveSimulationStartPose(lesson, mapPack, "left");
    const config = buildSimulationCoreConfig({
      lesson,
      mapPack,
      trafficSide: "left",
      speedUnit: "mph",
    });
    const snapshot = new SimulationCore(config).getSnapshot();

    expect(start.x).not.toBe(0);
    expect(config.spawn).toEqual({
      x: start.x,
      z: start.z,
      heading: start.heading,
    });
    expect(snapshot.road.laneId).toBe(lesson.route[0]);
    expect(snapshot.road.wrongWay).toBe(false);
    expect(snapshot.road.offRoad).toBe(false);
  });

  it("keeps stationary players safe from authored traffic in every lesson", () => {
    for (const lesson of LESSONS) {
      const mapPack = getMapPack(lesson.mapId);
      const simulation = new SimulationCore(
        buildSimulationCoreConfig({
          lesson,
          mapPack,
          trafficSide: lesson.trafficSide,
          speedUnit:
            lesson.countryId === "fr" || lesson.countryId === "jp"
              ? "km/h"
              : "mph",
        }),
      );
      for (let tick = 0; tick < 60 * 15; tick += 1) {
        simulation.step(1 / 60);
      }
      const snapshot = simulation.getSnapshot();
      expect(
        snapshot.activeIncident,
        `${lesson.id} caused an incident while the player remained stationary`,
      ).toBeNull();
      expect(snapshot.status).toBe("running");
    }
  });

  it("builds signal stop lines, legal successors, and safe mobile density", () => {
    const lesson = getLesson("us-signals-crosswalks");
    const mapPack = getMapPack(lesson.mapId);
    const config = buildSimulationCoreConfig({
      lesson,
      mapPack,
      trafficSide: "right",
      speedUnit: "mph",
      touchFirst: true,
    });

    expect(config.npcCount).toBe(expectedSimulationNpcCount(lesson, true));
    expect(config.npcCount).toBeLessThanOrEqual(12);
    expect(config.trafficLights?.length).toBeGreaterThan(0);
    expect(
      config.stopLines?.some((line) => line.kind === "traffic_light"),
    ).toBe(true);
    expect(
      config.lanes?.every((lane) => lane.loop === false),
    ).toBe(true);
    expect(
      config.lanes?.some((lane) => (lane.successorLaneIds?.length ?? 0) > 0),
    ).toBe(true);
  });

  it("switches the capstone jurisdiction and speed unit atomically at the French checkpoint", () => {
    const lesson = getLesson("uk-fr-side-swap");
    const mapPack = getMapPack(lesson.mapId);
    const config = buildSimulationCoreConfig({
      lesson,
      mapPack,
      trafficSide: "left",
      speedUnit: "mph",
    });
    const checkpoint = mapPack.laneGraph.checkpoints.find(
      (candidate) => candidate.id === "xf-fr-start",
    );
    const pose = checkpoint?.anchor
      ? resolveSimulationLaneAnchor(mapPack.laneGraph.lanes, checkpoint.anchor)
      : null;
    expect(pose).not.toBeNull();
    const simulation = new SimulationCore({
      ...config,
      npcCount: 0,
      spawn: { x: pose!.x, z: pose!.z, heading: pose!.heading },
    });
    expect(simulation.getSnapshot().trafficSide).toBe("left");
    expect(simulation.getSnapshot().speedUnit).toBe("mph");
    const transitioned = simulation.step(1 / 60);
    expect(transitioned.trafficSide).toBe("right");
    expect(transitioned.speedUnit).toBe("kmh");
    expect(transitioned.checkpointId).toBe("xf-fr-start");
  });

  it("maps Tokyo railway controls to an authoritative warning phase and stop line", () => {
    const lesson = getLesson("jp-railway-crossings");
    const config = buildSimulationCoreConfig({
      lesson,
      mapPack: getMapPack(lesson.mapId),
      trafficSide: "left",
      speedUnit: "km/h",
    });
    const railwayLine = config.stopLines?.find((line) => line.kind === "railway");
    expect(railwayLine?.trafficLightId).toBe("jp-rail-eastbound-approach");
    expect(
      config.trafficLights?.some((light) => light.id === railwayLine?.trafficLightId),
    ).toBe(true);
  });

  it("converts capstone lane limits using each lane's local jurisdiction", () => {
    const lesson = getLesson("uk-fr-side-swap");
    const mapPack = getMapPack(lesson.mapId);
    const config = buildSimulationCoreConfig({
      lesson,
      mapPack,
      trafficSide: "left",
      speedUnit: "mph",
    });
    const ukLane = config.lanes?.find((lane) => lane.id === "xf-uk-approach");
    const frenchLane = config.lanes?.find((lane) => lane.id === "xf-fr-road");

    expect(ukLane?.speedLimitMps).toBeCloseTo(30 / 2.236936, 5);
    expect(frenchLane?.speedLimitMps).toBeCloseTo(50 / 3.6, 5);
  });
});
