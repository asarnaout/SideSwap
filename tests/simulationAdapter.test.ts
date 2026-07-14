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
    for (const authoredCheckpoint of config.checkpoints ?? []) {
      if (authoredCheckpoint.id === "xf-fr-start") break;
      simulation.setCheckpoint(authoredCheckpoint);
    }
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

  it("derives an occurrence-aware authoritative step for every authored route lane", () => {
    const lesson = getLesson("fr-speed-merging");
    const mapPack = getMapPack(lesson.mapId);
    const config = buildSimulationCoreConfig({
      lesson,
      mapPack,
      trafficSide: "right",
      speedUnit: "km/h",
    });
    const steps = config.routeGuidance ?? [];

    expect(steps).toHaveLength(lesson.route.length);
    expect(steps[0]).toMatchObject({
      id: `${lesson.id}:route:0`,
      routeIndex: 0,
      fromLaneId: null,
      targetLaneId: lesson.route[0],
      required: true,
    });
    for (const [routeIndex, step] of steps.entries()) {
      expect(step.id).toBe(`${lesson.id}:route:${routeIndex}`);
      expect(step.routeIndex).toBe(routeIndex);
      expect(step.targetLaneId).toBe(lesson.route[routeIndex]);
      expect(step.fromLaneId).toBe(
        routeIndex === 0 ? null : lesson.route[routeIndex - 1],
      );
      expect(step.completionAnchor.laneId).toBe(step.targetLaneId);
    }

    const repeatedLaneIndices = lesson.route.flatMap((laneId, routeIndex) =>
      laneId === "fr-rb-e-n" ? [routeIndex] : [],
    );
    expect(repeatedLaneIndices).toHaveLength(2);
    expect(
      steps
        .filter((step) => step.targetLaneId === "fr-rb-e-n")
        .map((step) => step.routeIndex),
    ).toEqual(repeatedLaneIndices);
    expect(new Set(steps.map((step) => step.id)).size).toBe(steps.length);
  });

  it("starts every scored path with one simulation-owned legal lane occurrence", () => {
    for (const lesson of LESSONS) {
      const mapPack = getMapPack(lesson.mapId);
      const config = buildSimulationCoreConfig({
        lesson,
        mapPack,
        trafficSide: lesson.trafficSide,
        speedUnit:
          lesson.countryId === "fr" || lesson.countryId === "jp"
            ? "km/h"
            : "mph",
      });
      const steps = config.routeGuidance ?? [];
      expect(steps, lesson.id).toHaveLength(lesson.route.length);
      expect(steps.map((step) => step.routeIndex), lesson.id).toEqual(
        lesson.route.map((_, routeIndex) => routeIndex),
      );

      const snapshot = new SimulationCore({ ...config, npcCount: 0 }).getSnapshot();
      expect(snapshot.road.laneId, lesson.id).toBe(lesson.route[0]);
      expect(snapshot.road.wrongWay, lesson.id).toBe(false);
      expect(snapshot.road.offRoad, lesson.id).toBe(false);
      expect(snapshot.guidance.owner, lesson.id).toMatchObject({
        kind: "route",
        routeIndex: 0,
      });

      const finalStep = steps.at(-1);
      const finalLane = config.lanes?.find(
        (candidate) => candidate.id === finalStep?.targetLaneId,
      );
      const finalLaneLength = finalLane?.points.slice(1).reduce(
        (total, point, pointIndex) =>
          total +
          Math.hypot(
            point.x - finalLane.points[pointIndex].x,
            point.z - finalLane.points[pointIndex].z,
          ),
        0,
      );
      expect(
        finalStep?.completionAnchor.distance,
        `${lesson.id} final guidance must remain active through the finish`,
      ).toBeGreaterThanOrEqual((finalLaneLength ?? 0) - 3.05);
      if (snapshot.guidance.cue) {
        expect(snapshot.guidance.cue.laneId, lesson.id).toBe(lesson.route[0]);
        const lane = config.lanes?.find(
          (candidate) => candidate.id === snapshot.guidance.cue?.laneId,
        );
        expect(snapshot.guidance.cue.widthM, lesson.id).toBe(lane?.width);
      }
    }
  });

  it("keeps free drive guidance off and honors an explicit spawn with an empty route", () => {
    const lesson = getLesson("uk-left-side-basics");
    const mapPack = getMapPack(lesson.mapId);
    const freeDriveLesson = {
      ...lesson,
      id: "empty-route-free-drive",
      kind: "free_drive" as const,
      route: [],
    };
    const start = resolveSimulationStartPose(freeDriveLesson, mapPack, "left");
    const config = buildSimulationCoreConfig({
      lesson: freeDriveLesson,
      mapPack,
      trafficSide: "left",
      speedUnit: "mph",
    });

    expect(config.spawn).toEqual({
      x: start.x,
      z: start.z,
      heading: start.heading,
    });
    expect(config.routeGuidance).toEqual([]);
    expect(config.finish).toBeNull();
    const authoredSpawn = mapPack.laneGraph.spawnPoints.find(
      (spawn) =>
        spawn.kind === "player" && spawn.id === freeDriveLesson.startSpawnId,
    );
    expect(authoredSpawn).toBeDefined();
    if (authoredSpawn && "anchor" in authoredSpawn && authoredSpawn.anchor) {
      expect(new SimulationCore({ ...config, npcCount: 0 }).getSnapshot().road.laneId).toBe(
        authoredSpawn.anchor.laneId,
      );
    }
  });

  it("rejects an adapter route occurrence that is not a declared successor", () => {
    const lesson = getLesson("uk-left-side-basics");
    const mapPack = getMapPack(lesson.mapId);
    const firstLane = mapPack.laneGraph.lanes.find(
      (lane) => lane.id === lesson.route[0],
    );
    const invalidTarget = mapPack.laneGraph.lanes.find(
      (lane) =>
        lane.id !== firstLane?.id &&
        !(firstLane?.successors ?? []).includes(lane.id),
    );
    expect(firstLane).toBeDefined();
    expect(invalidTarget).toBeDefined();

    expect(() =>
      buildSimulationCoreConfig({
        lesson: {
          ...lesson,
          route: [firstLane!.id, invalidTarget!.id],
        },
        mapPack,
        trafficSide: "left",
        speedUnit: "mph",
      }),
    ).toThrow(/not a legal successor transition/);
  });

  it("maps the authored Milton Keynes overtake and lane-aware checkpoint", () => {
    const lesson = getLesson("uk-dual-carriageway");
    const mapPack = getMapPack(lesson.mapId);
    const config = buildSimulationCoreConfig({
      lesson,
      mapPack,
      trafficSide: "left",
      speedUnit: "mph",
    });

    expect(config.maneuvers?.[0]).toMatchObject({
      id: "uk-mk-guided-overtake",
      kind: "overtake",
      normalLaneId: "uk-dual-n-east",
      passingLaneId: "uk-dual-n-east-pass",
      corridorStart: { laneId: "uk-dual-n-east", distance: 10 },
      corridorEnd: { laneId: "uk-dual-n-east", distance: 680 },
      leadVehicleStart: { laneId: "uk-dual-n-east", distance: 108 },
      leadVehicleSpeedFactor: 0.75,
      phaseAnchors: {
        approach: { laneId: "uk-dual-n-east", distance: 28 },
        observe: { laneId: "uk-dual-n-east", distance: 60 },
        pass: { laneId: "uk-dual-n-east-pass", distance: 190 },
        return: { laneId: "uk-dual-n-east-pass", distance: 540 },
        complete: { laneId: "uk-dual-n-east", distance: 650 },
      },
      predictedClearSeconds: 4,
      returnStandstillGapM: 4,
      returnHeadwaySeconds: 1.8,
    });
    expect(
      config.checkpoints?.find((checkpoint) => checkpoint.id === "uk-dual"),
    ).toMatchObject({
      laneId: "uk-dual-n-east",
      width: 3.5,
      distance: 48,
    });
    const normalLane = config.lanes?.find(
      (lane) => lane.id === "uk-dual-n-east",
    );
    expect(config.maxForwardSpeedMps).toBeGreaterThanOrEqual(
      normalLane?.speedLimitMps ?? Number.POSITIVE_INFINITY,
    );
    expect(config.maxForwardSpeedMps).toBeGreaterThan(
      (normalLane?.speedLimitMps ?? 0) * 0.75,
    );

    const snapshot = new SimulationCore({ ...config, npcCount: 1 }).getSnapshot();
    expect(snapshot.maneuvers[0]).toMatchObject({
      id: "uk-mk-guided-overtake",
      phase: "approach",
      passingSide: "right",
      predictedClearSeconds: 4,
      gate: null,
    });
    expect(
      snapshot.npcs.find(
        (npc) => npc.id === "maneuver-uk-mk-guided-overtake-lead",
      ),
    ).toMatchObject({ laneId: "uk-dual-n-east", speedMps: 0 });
  });

  it("fails loudly when authored maneuver lanes are invalid", () => {
    const lesson = getLesson("uk-dual-carriageway");
    const maneuver = lesson.maneuvers?.[0];
    expect(maneuver).toBeDefined();
    expect(() =>
      buildSimulationCoreConfig({
        lesson: {
          ...lesson,
          maneuvers: [
            {
              ...maneuver!,
              normalLaneId: "missing-running-lane",
            },
          ],
        },
        mapPack: getMapPack(lesson.mapId),
        trafficSide: "left",
        speedUnit: "mph",
      }),
    ).toThrow(/references a missing running lane/);
  });
});
