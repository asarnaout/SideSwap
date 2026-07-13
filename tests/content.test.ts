import { describe, expect, it } from "vitest";
import {
  COUNTRY_PROFILES,
  DESTINATION_PROFILES,
  FREE_DRIVES,
  LESSONS,
  MAP_PACKS,
  getCountryProfile,
  getDestinationProfile,
  getLesson,
  getMapPack,
  getOrientationForTrafficSide,
  isScenarioCompatibleWithDestination,
  resolveSessionConfig,
  resolveSteeringSide,
} from "../app/game/content";
import type {
  DestinationId,
  GameSessionConfig,
  LaneAnchor,
  LaneSegment,
  ScenarioId,
  SteeringPreference,
  WorldPoint,
} from "../app/game/types";

const GEOMETRY_EPSILON = 1e-5;
const START_ENDPOINT_CLEARANCE_M = 10;
const ROAD_ENVELOPE_SAMPLE_INTERVAL_M = 0.25;
const ROAD_ENVELOPE_EPSILON_M = 0.1;
const JUNCTION_TAPER_LENGTH_M = 2;
const JUNCTION_TAPER_EPSILON_M = 0.15;

const distanceBetween = (a: WorldPoint, b: WorldPoint): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

const laneLength = (lane: LaneSegment): number =>
  lane.centerline.slice(1).reduce(
    (total, point, index) =>
      total + distanceBetween(lane.centerline[index], point),
    0,
  );

const resolveAnchor = (
  lane: LaneSegment,
  anchor: LaneAnchor,
): {
  readonly position: WorldPoint;
  readonly headingDeg: number;
  readonly laneLengthM: number;
} => {
  if (anchor.laneId !== lane.id) {
    throw new Error(`${anchor.laneId} cannot resolve against ${lane.id}`);
  }

  const totalLength = laneLength(lane);
  if (
    anchor.distanceAlongM < -GEOMETRY_EPSILON ||
    anchor.distanceAlongM > totalLength + GEOMETRY_EPSILON
  ) {
    throw new Error(
      `${lane.id} anchor ${anchor.distanceAlongM}m exceeds ${totalLength.toFixed(2)}m`,
    );
  }

  let distanceRemaining = Math.min(anchor.distanceAlongM, totalLength);
  for (let index = 1; index < lane.centerline.length; index += 1) {
    const start = lane.centerline[index - 1];
    const end = lane.centerline[index];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const segmentLength = Math.hypot(dx, dz);
    if (segmentLength <= GEOMETRY_EPSILON) {
      continue;
    }
    if (
      distanceRemaining <= segmentLength + GEOMETRY_EPSILON ||
      index === lane.centerline.length - 1
    ) {
      const amount = Math.min(1, Math.max(0, distanceRemaining / segmentLength));
      return {
        position: {
          x: start.x + dx * amount,
          z: start.z + dz * amount,
        },
        headingDeg: (Math.atan2(dx, dz) * 180) / Math.PI,
        laneLengthM: totalLength,
      };
    }
    distanceRemaining -= segmentLength;
  }

  throw new Error(`${lane.id} does not contain a non-zero centreline segment`);
};

const distanceToSegment = (
  point: WorldPoint,
  start: WorldPoint,
  end: WorldPoint,
): number => {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const amount =
    lengthSquared === 0
      ? 0
      : Math.min(
          1,
          Math.max(
            0,
            ((point.x - start.x) * dx + (point.z - start.z) * dz) /
              lengthSquared,
          ),
        );
  return Math.hypot(
    point.x - (start.x + dx * amount),
    point.z - (start.z + dz * amount),
  );
};

const distanceToPolyline = (
  point: WorldPoint,
  centerline: readonly WorldPoint[],
): number =>
  Math.min(
    ...centerline
      .slice(1)
      .map((end, index) =>
        distanceToSegment(point, centerline[index], end),
      ),
  );

const distanceToLaneCenterline = (
  point: WorldPoint,
  lane: LaneSegment,
): number => distanceToPolyline(point, lane.centerline);

const samplePolyline = (
  centerline: readonly WorldPoint[],
  intervalM: number,
): readonly {
  readonly point: WorldPoint;
  readonly distanceAlongM: number;
  readonly totalLengthM: number;
}[] => {
  const segmentLengths = centerline
    .slice(1)
    .map((point, index) => distanceBetween(centerline[index], point));
  const totalLengthM = segmentLengths.reduce(
    (total, length) => total + length,
    0,
  );
  const samples: {
    point: WorldPoint;
    distanceAlongM: number;
    totalLengthM: number;
  }[] = [];
  let traversedM = 0;

  for (let segmentIndex = 1; segmentIndex < centerline.length; segmentIndex += 1) {
    const start = centerline[segmentIndex - 1];
    const end = centerline[segmentIndex];
    const segmentLengthM = segmentLengths[segmentIndex - 1];
    const sampleCount = Math.max(1, Math.ceil(segmentLengthM / intervalM));
    const firstSample = segmentIndex === 1 ? 0 : 1;
    for (let sampleIndex = firstSample; sampleIndex <= sampleCount; sampleIndex += 1) {
      const amount = sampleIndex / sampleCount;
      samples.push({
        point: {
          x: start.x + (end.x - start.x) * amount,
          z: start.z + (end.z - start.z) * amount,
        },
        distanceAlongM: traversedM + segmentLengthM * amount,
        totalLengthM,
      });
    }
    traversedM += segmentLengthM;
  }

  return samples;
};

const pointsMatch = (a: WorldPoint, b: WorldPoint): boolean =>
  distanceBetween(a, b) <= GEOMETRY_EPSILON;

type SegmentIntersection =
  | { readonly kind: "point"; readonly point: WorldPoint }
  | { readonly kind: "overlap"; readonly lengthM: number };

const segmentIntersection = (
  a: WorldPoint,
  b: WorldPoint,
  c: WorldPoint,
  d: WorldPoint,
): SegmentIntersection | null => {
  const r = { x: b.x - a.x, z: b.z - a.z };
  const s = { x: d.x - c.x, z: d.z - c.z };
  const fromAToC = { x: c.x - a.x, z: c.z - a.z };
  const cross = (left: WorldPoint, right: WorldPoint): number =>
    left.x * right.z - left.z * right.x;
  const dot = (left: WorldPoint, right: WorldPoint): number =>
    left.x * right.x + left.z * right.z;
  const denominator = cross(r, s);

  if (Math.abs(denominator) <= GEOMETRY_EPSILON) {
    if (Math.abs(cross(fromAToC, r)) > GEOMETRY_EPSILON) {
      return null;
    }
    const lengthSquared = dot(r, r);
    if (lengthSquared <= GEOMETRY_EPSILON) {
      return pointsMatch(a, c) ? { kind: "point", point: a } : null;
    }
    const cAmount = dot(fromAToC, r) / lengthSquared;
    const dAmount =
      dot({ x: d.x - a.x, z: d.z - a.z }, r) / lengthSquared;
    const overlapStart = Math.max(0, Math.min(cAmount, dAmount));
    const overlapEnd = Math.min(1, Math.max(cAmount, dAmount));
    if (overlapEnd < overlapStart - GEOMETRY_EPSILON) {
      return null;
    }
    if (overlapEnd - overlapStart <= GEOMETRY_EPSILON) {
      return {
        kind: "point",
        point: {
          x: a.x + r.x * overlapStart,
          z: a.z + r.z * overlapStart,
        },
      };
    }
    return {
      kind: "overlap",
      lengthM: (overlapEnd - overlapStart) * Math.sqrt(lengthSquared),
    };
  }

  const aAmount = cross(fromAToC, s) / denominator;
  const cAmount = cross(fromAToC, r) / denominator;
  if (
    aAmount < -GEOMETRY_EPSILON ||
    aAmount > 1 + GEOMETRY_EPSILON ||
    cAmount < -GEOMETRY_EPSILON ||
    cAmount > 1 + GEOMETRY_EPSILON
  ) {
    return null;
  }
  return {
    kind: "point",
    point: {
      x: a.x + r.x * aAmount,
      z: a.z + r.z * aAmount,
    },
  };
};

const sessionConfig = (
  destinationId: DestinationId,
  scenarioId: ScenarioId,
  steeringPreference: SteeringPreference = "auto",
): GameSessionConfig => ({
  countryId: getDestinationProfile(destinationId).countryId,
  destinationId,
  scenarioId,
  familiarTrafficSide: "right",
  steeringPreference,
  camera: "third_person",
  assistance: {
    coachPrompts: true,
    subtitles: true,
    wrongSideWarnings: true,
    autoResetAfterCriticalError: true,
    reducedMotion: false,
  },
});

describe("SideSwap content", () => {
  it("keeps four legal country profiles and five destination profiles", () => {
    expect(COUNTRY_PROFILES.map((country) => country.id)).toEqual([
      "us",
      "uk",
      "fr",
      "jp",
    ]);
    expect(DESTINATION_PROFILES.map((destination) => destination.id)).toEqual([
      "uk-london",
      "us-nyc",
      "uk-milton-keynes",
      "fr-calais",
      "jp-tokyo",
    ]);
    expect(DESTINATION_PROFILES[0].promotion).toBe("featured");
    expect(getDestinationProfile("uk-milton-keynes").promotion).toBe("specialist");
    expect(LESSONS).toHaveLength(18);
    expect(FREE_DRIVES).toHaveLength(5);
    expect(MAP_PACKS).toHaveLength(7);
    expect(getLesson("uk-fr-side-swap").profileTransitions).toHaveLength(1);
  });

  it("keeps traffic side independent from steering-wheel side", () => {
    const us = getCountryProfile("us");
    const uk = getCountryProfile("uk");
    expect(us.trafficSide).toBe("right");
    expect(us.defaultSteeringSide).toBe("left");
    expect(uk.trafficSide).toBe("left");
    expect(uk.defaultSteeringSide).toBe("right");
    expect(resolveSteeringSide("right", us)).toBe("right");
    expect(us.trafficSide).toBe("right");
  });

  it("keeps London left-side and New York right-side regardless of familiar-side metadata", () => {
    const london = resolveSessionConfig({
      ...sessionConfig("uk-london", "orientation-left"),
      familiarTrafficSide: "right",
    });
    const newYork = resolveSessionConfig({
      ...sessionConfig("us-nyc", "orientation-right"),
      familiarTrafficSide: "left",
    });

    expect(london.trafficSide).toBe("left");
    expect(newYork.trafficSide).toBe("right");
  });

  it("resolves every traffic-side and steering-side combination independently", () => {
    for (const country of COUNTRY_PROFILES) {
      expect(resolveSteeringSide("auto", country)).toBe(
        country.defaultSteeringSide,
      );
      expect(resolveSteeringSide("left", country)).toBe("left");
      expect(resolveSteeringSide("right", country)).toBe("right");
      expect(country.trafficSide).toBe(
        country.id === "us" || country.id === "fr" ? "right" : "left",
      );
    }
  });

  it("maps each traffic side to its mirrored orientation", () => {
    expect(getOrientationForTrafficSide("right").id).toBe("orientation-right");
    expect(getOrientationForTrafficSide("left").id).toBe("orientation-left");
  });

  it("resolves shared orientations against the selected destination", () => {
    for (const destination of DESTINATION_PROFILES) {
      const country = getCountryProfile(destination.countryId);
      for (const orientationId of [
        "orientation-right",
        "orientation-left",
      ] as const) {
        const expected = orientationId.endsWith(country.trafficSide);
        expect(
          isScenarioCompatibleWithDestination(orientationId, destination.id),
        ).toBe(expected);

        if (expected) {
          const resolved = resolveSessionConfig(
            sessionConfig(destination.id, orientationId),
          );
          expect(resolved.countryId).toBe(country.id);
          expect(resolved.destinationId).toBe(destination.id);
          expect(resolved.trafficSide).toBe(country.trafficSide);
          expect(resolved.steeringSide).toBe(country.defaultSteeringSide);
          expect(resolved.speedUnit).toBe(country.speedUnit);
        } else {
          expect(() =>
            resolveSessionConfig(sessionConfig(destination.id, orientationId)),
          ).toThrow(/not compatible/);
        }
      }
    }
  });

  it("accepts every regular scenario only for its exact destination", () => {
    const destinationScenarios = [
      ...LESSONS.filter((lesson) => lesson.destinationId),
      ...FREE_DRIVES,
    ];

    for (const scenario of destinationScenarios) {
      for (const destination of DESTINATION_PROFILES) {
        expect(
          isScenarioCompatibleWithDestination(scenario.id, destination.id),
          `${scenario.id} with ${destination.id}`,
        ).toBe(scenario.destinationId === destination.id);
      }
    }
  });

  it("rejects traffic-side and destination mismatches", () => {
    expect(() =>
      resolveSessionConfig(sessionConfig("us-nyc", "orientation-left")),
    ).toThrow(/not compatible/);
    expect(() =>
      resolveSessionConfig(sessionConfig("uk-london", "us-one-way-grid")),
    ).toThrow(/not compatible/);
    expect(() => resolveSessionConfig(sessionConfig("fr-calais", "free-jp"))).toThrow(
      /not compatible/,
    );
    expect(() =>
      resolveSessionConfig({
        ...sessionConfig("uk-london", "orientation-left"),
        countryId: "us",
      }),
    ).toThrow(/destination .* not compatible with country/);
  });

  it("keeps wheel overrides independent in every valid country session", () => {
    for (const destination of DESTINATION_PROFILES) {
      const country = getCountryProfile(destination.countryId);
      const orientationId =
        country.trafficSide === "right" ? "orientation-right" : "orientation-left";
      for (const steeringPreference of ["left", "right"] as const) {
        const resolved = resolveSessionConfig(
          sessionConfig(destination.id, orientationId, steeringPreference),
        );
        expect(resolved.steeringSide).toBe(steeringPreference);
        expect(resolved.trafficSide).toBe(country.trafficSide);
      }
    }
  });

  it("starts the travel-transition capstone from either UK destination only", () => {
    for (const destinationId of ["uk-london", "uk-milton-keynes"] as const) {
      expect(
        isScenarioCompatibleWithDestination("uk-fr-side-swap", destinationId),
      ).toBe(true);
    }
    for (const destinationId of ["us-nyc", "fr-calais", "jp-tokyo"] as const) {
      expect(
        isScenarioCompatibleWithDestination("uk-fr-side-swap", destinationId),
      ).toBe(false);
    }

    const resolved = resolveSessionConfig(
      sessionConfig("uk-london", "uk-fr-side-swap"),
    );
    expect(resolved.trafficSide).toBe("left");
    expect(resolved.speedUnit).toBe("mph");
  });

  it("links every assessed lesson to reviewed official sources", () => {
    for (const lesson of LESSONS) {
      expect(lesson.sourceReferenceIds.length).toBeGreaterThan(0);
      for (const sourceId of lesson.sourceReferenceIds) {
        const source = COUNTRY_PROFILES.flatMap(
          (country) => country.officialReferences,
        ).find((candidate) => candidate.id === sourceId);
        expect(source, `${lesson.id} → ${sourceId}`).toBeDefined();
        expect(source?.url.startsWith("https://")).toBe(true);
        expect(source?.reviewedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("validates lane references, legal successors, controls, and checkpoints", () => {
    const invalidSuccessors: string[] = [];
    for (const map of MAP_PACKS) {
      const lanes = new Map(map.laneGraph.lanes.map((lane) => [lane.id, lane]));
      const conflicts = new Set(
        map.laneGraph.conflictZones.map((zone) => zone.id),
      );
      const roadSurfaces = new Map(
        map.geometry.roadSurfaces.map((surface) => [surface.id, surface]),
      );

      for (const lane of map.laneGraph.lanes) {
        expect(lane.centerline.length, lane.id).toBeGreaterThanOrEqual(2);
        expect(lane.widthM, lane.id).toBeGreaterThanOrEqual(2.7);
        const surface = roadSurfaces.get(lane.roadId);
        expect(surface, `${lane.id} → road ${lane.roadId}`).toBeDefined();
        expect(surface?.laneIds, `${lane.id} on ${lane.roadId}`).toContain(lane.id);
        for (const successorId of lane.successors) {
          const successor = lanes.get(successorId);
          if (!successor) {
            invalidSuccessors.push(`${lane.id} → missing ${successorId}`);
            continue;
          }
          const end = lane.centerline.at(-1)!;
          const start = successor.centerline[0];
          if (Math.hypot(end.x - start.x, end.z - start.z) >= 0.01) {
            invalidSuccessors.push(`${lane.id} ⇥ ${successorId}`);
          }
        }
      }

      for (const control of map.laneGraph.controls) {
        for (const laneId of control.laneIds) {
          expect(lanes.has(laneId), `${control.id} → ${laneId}`).toBe(true);
        }
        for (const conflictId of control.conflictZoneIds ?? []) {
          expect(
            conflicts.has(conflictId),
            `${control.id} → ${conflictId}`,
          ).toBe(true);
        }
        for (const controlApproach of control.approaches) {
          expect(controlApproach.laneIds).toContain(
            controlApproach.stopLine.laneId,
          );
          expect(
            lanes.has(controlApproach.stopLine.laneId),
            `${control.id} → ${controlApproach.stopLine.laneId}`,
          ).toBe(true);
          expect(controlApproach.stopLine.distanceAlongM).toBeGreaterThanOrEqual(0);
        }
        expect(control.installations.length, control.id).toBeGreaterThan(0);
      }

      for (const checkpoint of map.laneGraph.checkpoints) {
        expect(
          lanes.has(checkpoint.anchor.laneId),
          `${checkpoint.id} → ${checkpoint.anchor.laneId}`,
        ).toBe(true);
        expect(checkpoint.anchor.distanceAlongM).toBeGreaterThan(0);
      }

      for (const spawn of map.laneGraph.spawnPoints) {
        if (spawn.kind === "player" || spawn.kind === "vehicle") {
          expect(lanes.has(spawn.anchor.laneId), `${spawn.id} → ${spawn.anchor.laneId}`).toBe(true);
          expect(spawn.anchor.distanceAlongM).toBeGreaterThan(0);
        } else if ("pose" in spawn && spawn.laneId) {
          expect(lanes.has(spawn.laneId), `${spawn.id} → ${spawn.laneId}`).toBe(true);
        }
      }
    }
    expect(invalidSuccessors).toEqual([]);
  });

  it("contains every sampled lane envelope within its authored road surface", () => {
    const envelopeViolations: string[] = [];
    let sampledPointCount = 0;

    for (const map of MAP_PACKS) {
      const roadSurfaces = new Map(
        map.geometry.roadSurfaces.map((surface) => [surface.id, surface]),
      );
      for (const lane of map.laneGraph.lanes) {
        const surface = roadSurfaces.get(lane.roadId);
        expect(surface, `${map.id}/${lane.id} → ${lane.roadId}`).toBeDefined();
        if (!surface) {
          continue;
        }
        expect(surface.centerline.length, surface.id).toBeGreaterThanOrEqual(2);

        let worstOverflowM = Number.NEGATIVE_INFINITY;
        let worstPoint: WorldPoint | null = null;
        for (const sample of samplePolyline(
          lane.centerline,
          ROAD_ENVELOPE_SAMPLE_INTERVAL_M,
        )) {
          sampledPointCount += 1;
          const distanceFromEndpointM = Math.min(
            sample.distanceAlongM,
            sample.totalLengthM - sample.distanceAlongM,
          );
          const junctionTaper = Math.max(
            0,
            1 - distanceFromEndpointM / JUNCTION_TAPER_LENGTH_M,
          );
          const allowedEpsilonM =
            ROAD_ENVELOPE_EPSILON_M +
            junctionTaper * JUNCTION_TAPER_EPSILON_M;
          const laneEnvelopeRadiusM =
            distanceToPolyline(sample.point, surface.centerline) +
            lane.widthM / 2;
          const overflowM =
            laneEnvelopeRadiusM - surface.widthM / 2 - allowedEpsilonM;
          if (overflowM > worstOverflowM) {
            worstOverflowM = overflowM;
            worstPoint = sample.point;
          }
        }

        if (worstOverflowM > GEOMETRY_EPSILON && worstPoint) {
          envelopeViolations.push(
            `${map.id}/${lane.id} exceeds ${surface.id} by ${worstOverflowM.toFixed(2)}m at (${worstPoint.x.toFixed(2)}, ${worstPoint.z.toFixed(2)})`,
          );
        }
      }
    }

    expect(sampledPointCount).toBeGreaterThan(1_000);
    expect(envelopeViolations).toEqual([]);
  });

  it("keeps every lesson route connected and inside its declared map", () => {
    const brokenRoutes: string[] = [];
    for (const lesson of LESSONS) {
      const map = getMapPack(lesson.mapId);
      const lanes = new Map(map.laneGraph.lanes.map((lane) => [lane.id, lane]));
      for (const laneId of lesson.route) {
        expect(lanes.has(laneId), `${lesson.id} → ${laneId}`).toBe(true);
      }
      const start = map.laneGraph.spawnPoints.find(
        (spawn) => spawn.id === lesson.startSpawnId,
      );
      expect(start?.kind, `${lesson.id} → ${lesson.startSpawnId}`).toBe("player");
      if (start?.kind === "player") {
        expect(start.anchor.laneId).toBe(lesson.route[0]);
      }
      for (let index = 0; index < lesson.route.length - 1; index += 1) {
        const lane = lanes.get(lesson.route[index])!;
        const successorId = lesson.route[index + 1];
        if (!lane.successors.includes(successorId)) {
          brokenRoutes.push(`${lesson.id}: ${lane.id} ⇥ ${successorId}`);
        }
      }
      const checkpointIds = new Set(
        map.laneGraph.checkpoints.map((checkpoint) => checkpoint.id),
      );
      for (const checkpointId of lesson.checkpoints) {
        expect(
          checkpointIds.has(checkpointId),
          `${lesson.id} → ${checkpointId}`,
        ).toBe(true);
      }
    }
    expect(brokenRoutes).toEqual([]);
  });

  it("anchors all 23 playable paths to route zero with safe endpoint clearance", () => {
    const playablePaths = [
      ...LESSONS.map((lesson) => ({
        id: lesson.id,
        mapId: lesson.mapId,
        route: lesson.route,
        startSpawnId: lesson.startSpawnId,
      })),
      ...FREE_DRIVES.map((freeDrive) => {
        const firstDestinationLesson = getLesson(
          getDestinationProfile(freeDrive.destinationId).lessonIds[0],
        );
        return {
          id: freeDrive.id,
          mapId: freeDrive.mapId,
          route: firstDestinationLesson.route,
          startSpawnId: freeDrive.startSpawnId,
        };
      }),
    ];

    expect(playablePaths).toHaveLength(23);
    for (const path of playablePaths) {
      expect(path.route.length, `${path.id} has a route`).toBeGreaterThan(0);
      const map = getMapPack(path.mapId);
      const start = map.laneGraph.spawnPoints.find(
        (spawn) => spawn.id === path.startSpawnId,
      );
      expect(start?.kind, `${path.id} → ${path.startSpawnId}`).toBe("player");
      if (start?.kind !== "player") {
        continue;
      }

      expect(start.anchor.laneId, `${path.id} starts on route[0]`).toBe(
        path.route[0],
      );
      const lane = map.laneGraph.lanes.find(
        (candidate) => candidate.id === start.anchor.laneId,
      );
      expect(lane, `${path.id} → ${start.anchor.laneId}`).toBeDefined();
      if (!lane) {
        continue;
      }

      const resolved = resolveAnchor(lane, start.anchor);
      expect(
        start.anchor.distanceAlongM,
        `${path.id} start clearance from lane entry`,
      ).toBeGreaterThanOrEqual(START_ENDPOINT_CLEARANCE_M);
      expect(
        resolved.laneLengthM - start.anchor.distanceAlongM,
        `${path.id} start clearance from lane exit`,
      ).toBeGreaterThanOrEqual(START_ENDPOINT_CLEARANCE_M);
      expect(Number.isFinite(resolved.position.x), path.id).toBe(true);
      expect(Number.isFinite(resolved.position.z), path.id).toBe(true);
      expect(Number.isFinite(resolved.headingDeg), path.id).toBe(true);

      // Starts store only a lane anchor. Their position and heading are both
      // derived from the same directed centreline, so the two cannot disagree.
      expect(start).not.toHaveProperty("pose");
      expect(start.anchor).not.toHaveProperty("headingDeg");
    }
  });

  it("resolves every checkpoint, stop line, and anchored spawn within its lane", () => {
    for (const map of MAP_PACKS) {
      const lanes = new Map(map.laneGraph.lanes.map((lane) => [lane.id, lane]));

      for (const checkpoint of map.laneGraph.checkpoints) {
        const lane = lanes.get(checkpoint.anchor.laneId);
        expect(
          lane,
          `${map.id}/${checkpoint.id} → ${checkpoint.anchor.laneId}`,
        ).toBeDefined();
        if (!lane) {
          continue;
        }
        const resolved = resolveAnchor(lane, checkpoint.anchor);
        expect(Number.isFinite(resolved.headingDeg), checkpoint.id).toBe(true);
        expect(checkpoint).not.toHaveProperty("pose");
      }

      for (const control of map.laneGraph.controls) {
        for (const controlApproach of control.approaches) {
          const lane = lanes.get(controlApproach.stopLine.laneId);
          expect(
            lane,
            `${map.id}/${control.id}/${controlApproach.id} → ${controlApproach.stopLine.laneId}`,
          ).toBeDefined();
          if (lane) {
            resolveAnchor(lane, controlApproach.stopLine);
          }
        }
      }

      for (const spawn of map.laneGraph.spawnPoints) {
        if (spawn.kind !== "player" && spawn.kind !== "vehicle") {
          continue;
        }
        const lane = lanes.get(spawn.anchor.laneId);
        expect(
          lane,
          `${map.id}/${spawn.id} → ${spawn.anchor.laneId}`,
        ).toBeDefined();
        if (lane) {
          resolveAnchor(lane, spawn.anchor);
        }
      }
    }
  });

  it("keeps opposing lane centrelines disjoint outside shared junction endpoints", () => {
    const unexpectedIntersections: string[] = [];
    let opposingPairCount = 0;

    for (const map of MAP_PACKS) {
      for (let firstIndex = 0; firstIndex < map.laneGraph.lanes.length; firstIndex += 1) {
        const first = map.laneGraph.lanes[firstIndex];
        for (
          let secondIndex = firstIndex + 1;
          secondIndex < map.laneGraph.lanes.length;
          secondIndex += 1
        ) {
          const second = map.laneGraph.lanes[secondIndex];
          const isOpposingPair =
            first.roadId === second.roadId &&
            first.from === second.to &&
            first.to === second.from;
          if (!isOpposingPair) {
            continue;
          }
          opposingPairCount += 1;
          const firstEndpoints = [
            first.centerline[0],
            first.centerline.at(-1)!,
          ];
          const secondEndpoints = [
            second.centerline[0],
            second.centerline.at(-1)!,
          ];
          const sharedJunctionEndpoints = firstEndpoints.filter((point) =>
            secondEndpoints.some((candidate) => pointsMatch(point, candidate)),
          );

          for (let firstSegment = 1; firstSegment < first.centerline.length; firstSegment += 1) {
            for (
              let secondSegment = 1;
              secondSegment < second.centerline.length;
              secondSegment += 1
            ) {
              const intersection = segmentIntersection(
                first.centerline[firstSegment - 1],
                first.centerline[firstSegment],
                second.centerline[secondSegment - 1],
                second.centerline[secondSegment],
              );
              if (!intersection) {
                continue;
              }
              if (intersection.kind === "overlap") {
                unexpectedIntersections.push(
                  `${map.id}: ${first.id} overlaps ${second.id} by ${intersection.lengthM.toFixed(2)}m`,
                );
                continue;
              }
              if (
                !sharedJunctionEndpoints.some((endpoint) =>
                  pointsMatch(endpoint, intersection.point),
                )
              ) {
                unexpectedIntersections.push(
                  `${map.id}: ${first.id} crosses ${second.id} at (${intersection.point.x.toFixed(2)}, ${intersection.point.z.toFixed(2)})`,
                );
              }
            }
          }
        }
      }
    }

    expect(opposingPairCount).toBeGreaterThanOrEqual(20);
    expect(unexpectedIntersections).toEqual([]);
  });

  it("places physical traffic-control supports outside every lane envelope", () => {
    const unsafeInstallations: string[] = [];
    let physicalInstallationCount = 0;

    for (const map of MAP_PACKS) {
      for (const control of map.laneGraph.controls) {
        for (const installation of control.installations) {
          // Road markings belong on the carriageway, while the side-swap
          // portal is explicitly an overhead structure spanning its lane.
          if (
            installation.mounting === "road_marking" ||
            installation.mounting === "terminal_portal"
          ) {
            continue;
          }
          physicalInstallationCount += 1;
          for (const lane of map.laneGraph.lanes) {
            const clearance =
              distanceToLaneCenterline(installation.position, lane) -
              lane.widthM / 2;
            if (clearance < 0.25 - GEOMETRY_EPSILON) {
              unsafeInstallations.push(
                `${map.id}/${installation.id} is ${clearance.toFixed(2)}m outside ${lane.id}`,
              );
            }
          }
        }
      }
    }

    expect(physicalInstallationCount).toBeGreaterThan(0);
    expect(unsafeInstallations).toEqual([]);
  });

  it("gives every free drive an anchored player start on its destination map", () => {
    for (const freeDrive of FREE_DRIVES) {
      const map = getMapPack(freeDrive.mapId);
      const start = map.laneGraph.spawnPoints.find(
        (spawn) => spawn.id === freeDrive.startSpawnId,
      );
      expect(start?.kind, `${freeDrive.id} → ${freeDrive.startSpawnId}`).toBe(
        "player",
      );
    }
  });
});
