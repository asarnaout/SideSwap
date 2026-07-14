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
import {
  isLaneGuidanceDistanceAllowed,
  resolveCheckpointTargetWidth,
  resolveRouteChevronHalfSpan,
} from "../app/game/GameCanvas";

const GEOMETRY_EPSILON = 1e-5;
const START_ENDPOINT_CLEARANCE_M = 10;
const ROAD_ENVELOPE_SAMPLE_INTERVAL_M = 0.25;
const ROAD_ENVELOPE_EPSILON_M = 0.1;
const JUNCTION_TAPER_LENGTH_M = 2;
const JUNCTION_TAPER_EPSILON_M = 0.15;
const PLAYER_HALF_WIDTH_M = 1.82 / 2;
const PLAYER_LATERAL_CLEARANCE_M = 0.3;

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

const nearestLaneProjection = (
  point: WorldPoint,
  lane: LaneSegment,
): { readonly distanceM: number; readonly headingRad: number } => {
  let best = { distanceM: Number.POSITIVE_INFINITY, headingRad: 0 };
  for (let index = 1; index < lane.centerline.length; index += 1) {
    const start = lane.centerline[index - 1];
    const end = lane.centerline[index];
    const distanceM = distanceToSegment(point, start, end);
    if (distanceM < best.distanceM) {
      best = {
        distanceM,
        headingRad: Math.atan2(end.x - start.x, end.z - start.z),
      };
    }
  }
  return best;
};

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

const pointInPolygon = (
  point: WorldPoint,
  polygon: readonly WorldPoint[],
): boolean => {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const crosses =
      currentPoint.z > point.z !== previousPoint.z > point.z &&
      point.x <
        ((previousPoint.x - currentPoint.x) *
          (point.z - currentPoint.z)) /
          (previousPoint.z - currentPoint.z) +
          currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
};

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

const nearCollinearReverseOverlapM = (
  firstStart: WorldPoint,
  firstEnd: WorldPoint,
  secondStart: WorldPoint,
  secondEnd: WorldPoint,
): number => {
  const firstDx = firstEnd.x - firstStart.x;
  const firstDz = firstEnd.z - firstStart.z;
  const secondDx = secondEnd.x - secondStart.x;
  const secondDz = secondEnd.z - secondStart.z;
  const firstLength = Math.hypot(firstDx, firstDz);
  const secondLength = Math.hypot(secondDx, secondDz);
  if (firstLength <= GEOMETRY_EPSILON || secondLength <= GEOMETRY_EPSILON) {
    return 0;
  }
  const firstUnit = { x: firstDx / firstLength, z: firstDz / firstLength };
  const secondUnit = {
    x: secondDx / secondLength,
    z: secondDz / secondLength,
  };
  if (firstUnit.x * secondUnit.x + firstUnit.z * secondUnit.z > -0.98) {
    return 0;
  }
  const perpendicularDistance = (point: WorldPoint): number =>
    Math.abs(
      (point.x - firstStart.x) * firstUnit.z -
        (point.z - firstStart.z) * firstUnit.x,
    );
  if (
    perpendicularDistance(secondStart) > 0.25 ||
    perpendicularDistance(secondEnd) > 0.25
  ) {
    return 0;
  }
  const project = (point: WorldPoint): number =>
    (point.x - firstStart.x) * firstUnit.x +
    (point.z - firstStart.z) * firstUnit.z;
  const projectedStart = project(secondStart);
  const projectedEnd = project(secondEnd);
  return Math.max(
    0,
    Math.min(firstLength, Math.max(projectedStart, projectedEnd)) -
      Math.max(0, Math.min(projectedStart, projectedEnd)),
  );
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

  it("limits authored junction connectors to two metres and keeps anchors outside them", () => {
    const unsafeAnchors: string[] = [];
    const invalidConnectors: string[] = [];

    for (const map of MAP_PACKS) {
      const lanes = new Map(map.laneGraph.lanes.map((lane) => [lane.id, lane]));
      const conflicts = new Map(
        map.laneGraph.conflictZones.map((zone) => [zone.id, zone]),
      );
      for (const lane of map.laneGraph.lanes) {
        const lengthM = laneLength(lane);
        for (const range of lane.connectorRanges ?? []) {
          const connectorLengthM =
            range.endDistanceAlongM - range.startDistanceAlongM;
          if (
            range.startDistanceAlongM < -GEOMETRY_EPSILON ||
            connectorLengthM <= GEOMETRY_EPSILON ||
            connectorLengthM > 2 + GEOMETRY_EPSILON ||
            range.endDistanceAlongM > lengthM + GEOMETRY_EPSILON
          ) {
            invalidConnectors.push(
              `${map.id}/${lane.id} has invalid ${connectorLengthM.toFixed(2)}m connector`,
            );
          }
          if (!range.conflictZoneId) {
            invalidConnectors.push(
              `${map.id}/${lane.id} connector has no conflict zone`,
            );
            continue;
          }
          const zone = conflicts.get(range.conflictZoneId);
          if (!zone) {
            invalidConnectors.push(
              `${map.id}/${lane.id} references missing ${range.conflictZoneId}`,
            );
            continue;
          }
          if (!zone.laneIds.includes(lane.id)) {
            invalidConnectors.push(
              `${map.id}/${lane.id} is absent from ${zone.id}`,
            );
          }
          for (const amount of [0, 0.25, 0.5, 0.75, 1]) {
            const sampleDistanceM =
              range.startDistanceAlongM + connectorLengthM * amount;
            const sample = resolveAnchor(lane, {
              laneId: lane.id,
              distanceAlongM: sampleDistanceM,
            }).position;
            if (!pointInPolygon(sample, zone.polygon)) {
              invalidConnectors.push(
                `${map.id}/${lane.id} connector sample ${sampleDistanceM.toFixed(2)}m lies outside ${zone.id}`,
              );
            }
          }
        }
      }
      const anchors = [
        ...map.laneGraph.spawnPoints.flatMap((spawn) =>
          spawn.kind === "player"
            ? [{ id: spawn.id, anchor: spawn.anchor }]
            : [],
        ),
        ...map.laneGraph.checkpoints.map((item) => ({
          id: item.id,
          anchor: item.anchor,
        })),
      ];

      for (const item of anchors) {
        const lane = lanes.get(item.anchor.laneId);
        if (!lane) continue;
        const resolved = resolveAnchor(lane, item.anchor);
        for (const range of lane.connectorRanges ?? []) {
          if (
            item.anchor.distanceAlongM >
              range.startDistanceAlongM + GEOMETRY_EPSILON &&
            item.anchor.distanceAlongM <
              range.endDistanceAlongM - GEOMETRY_EPSILON
          ) {
            unsafeAnchors.push(
              `${map.id}/${item.id} lies in ${lane.id} connector`,
            );
          }
        }
        for (const zone of map.laneGraph.conflictZones) {
          if (pointInPolygon(resolved.position, zone.polygon)) {
            unsafeAnchors.push(`${map.id}/${item.id} lies in ${zone.id}`);
          }
        }
      }
    }

    expect(invalidConnectors).toEqual([]);
    expect(unsafeAnchors).toEqual([]);
  });

  it("resolves London starts to their established legal lane positions", () => {
    const map = getMapPack("london-south-kensington");
    const expected = [
      {
        spawnId: "london-player",
        laneId: "london-local-west",
        x: -121.98,
        z: -105.8,
      },
      {
        spawnId: "london-player-queen-gate",
        laneId: "london-queen-gate-north-1",
        x: -109.7,
        z: -92,
      },
    ] as const;

    for (const item of expected) {
      const spawn = map.laneGraph.spawnPoints.find(
        (candidate) => candidate.id === item.spawnId,
      );
      expect(spawn?.kind).toBe("player");
      if (spawn?.kind !== "player") continue;
      const lane = map.laneGraph.lanes.find(
        (candidate) => candidate.id === item.laneId,
      );
      expect(lane).toBeDefined();
      if (!lane) continue;
      const resolved = resolveAnchor(lane, spawn.anchor);
      expect(resolved.position.x).toBeCloseTo(item.x, 1);
      expect(resolved.position.z).toBeCloseTo(item.z, 1);
    }
  });

  it("keeps playable anchors lane-true with vehicle clearance from edges and dividers", () => {
    const unsafeAnchors: string[] = [];
    const requiredClearanceM =
      PLAYER_HALF_WIDTH_M + PLAYER_LATERAL_CLEARANCE_M;

    for (const map of MAP_PACKS) {
      const lanes = new Map(map.laneGraph.lanes.map((lane) => [lane.id, lane]));
      const surfaces = new Map(
        map.geometry.roadSurfaces.map((surface) => [surface.id, surface]),
      );
      const anchors = [
        ...map.laneGraph.spawnPoints.flatMap((spawn) =>
          spawn.kind === "player"
            ? [{ id: spawn.id, anchor: spawn.anchor }]
            : [],
        ),
        ...map.laneGraph.checkpoints.map((item) => ({
          id: item.id,
          anchor: item.anchor,
        })),
      ];

      for (const item of anchors) {
        const lane = lanes.get(item.anchor.laneId);
        if (!lane) continue;
        const surface = surfaces.get(lane.roadId);
        if (!surface) continue;
        const position = resolveAnchor(lane, item.anchor).position;
        const roadEdgeClearanceM =
          surface.widthM / 2 - distanceToPolyline(position, surface.centerline);
        if (roadEdgeClearanceM < requiredClearanceM - GEOMETRY_EPSILON) {
          unsafeAnchors.push(
            `${map.id}/${item.id} has ${roadEdgeClearanceM.toFixed(2)}m road-edge clearance`,
          );
        }
        for (const marking of surface.markings) {
          if (
            marking.style !== "centre_dashed" &&
            marking.style !== "centre_solid" &&
            marking.style !== "lane_dashed" &&
            marking.style !== "lane_solid"
          ) {
            continue;
          }
          const dividerClearanceM = distanceToPolyline(position, marking.points);
          if (dividerClearanceM < requiredClearanceM - GEOMETRY_EPSILON) {
            unsafeAnchors.push(
              `${map.id}/${item.id} has ${dividerClearanceM.toFixed(2)}m clearance from ${marking.id}`,
            );
          }
        }
      }
    }

    expect(unsafeAnchors).toEqual([]);
  });

  it("keeps rendered checkpoint brackets and route chevrons out of dividers, shoulders, and other lanes", () => {
    const violations: string[] = [];
    const dividerStyles = new Set([
      "centre_dashed",
      "centre_solid",
      "lane_dashed",
      "lane_solid",
    ]);
    const checkGuidancePoint = (
      map: (typeof MAP_PACKS)[number],
      lane: LaneSegment,
      point: WorldPoint,
      strokeRadiusM: number,
      label: string,
      headingRad: number,
      restrictedLaneIds: ReadonlySet<string>,
    ) => {
      const surface = map.geometry.roadSurfaces.find(
        (candidate) => candidate.id === lane.roadId,
      );
      if (!surface) {
        violations.push(`${map.id}/${label} has no road surface`);
        return;
      }
      const edgeClearanceM =
        surface.widthM / 2 - distanceToPolyline(point, surface.centerline);
      if (edgeClearanceM < strokeRadiusM - GEOMETRY_EPSILON) {
        violations.push(
          `${map.id}/${label} enters the shoulder by ${(strokeRadiusM - edgeClearanceM).toFixed(2)}m`,
        );
      }
      for (const marking of surface.markings) {
        if (
          dividerStyles.has(marking.style) &&
          distanceToPolyline(point, marking.points) <
            strokeRadiusM - GEOMETRY_EPSILON
        ) {
          violations.push(`${map.id}/${label} intersects ${marking.id}`);
        }
      }
      for (const otherLane of map.laneGraph.lanes) {
        if (otherLane.id === lane.id) continue;
        const otherProjection = nearestLaneProjection(point, otherLane);
        const opposing =
          Math.cos(otherProjection.headingRad - headingRad) < -0.5;
        if (!opposing && !restrictedLaneIds.has(otherLane.id)) continue;
        const otherEnvelopeM = otherLane.widthM / 2 + strokeRadiusM;
        if (
          otherProjection.distanceM <
          otherEnvelopeM - GEOMETRY_EPSILON
        ) {
          violations.push(`${map.id}/${label} enters ${otherLane.id}`);
        }
      }
    };

    for (const map of MAP_PACKS) {
      const laneById = new Map(
        map.laneGraph.lanes.map((lane) => [lane.id, lane]),
      );
      const restrictedLaneIds = new Set(
        (map.laneGraph.restrictions ?? []).map(
          (restriction) => restriction.laneId,
        ),
      );
      for (const checkpoint of map.laneGraph.checkpoints) {
        const lane = laneById.get(checkpoint.anchor.laneId);
        if (!lane) continue;
        if (restrictedLaneIds.has(lane.id)) {
          violations.push(`${map.id}/${checkpoint.id} targets a restricted lane`);
        }
        const resolved = resolveAnchor(lane, checkpoint.anchor);
        const heading = (resolved.headingDeg * Math.PI) / 180;
        const forward = { x: Math.sin(heading), z: Math.cos(heading) };
        const side = { x: Math.cos(heading), z: -Math.sin(heading) };
        const targetWidthM = resolveCheckpointTargetWidth(lane.widthM);
        const halfWidthM = targetWidthM / 2;
        const halfLengthM = 0.72;
        const armLengthM = Math.min(0.42, targetWidthM * 0.22);
        const bracketPoint = (alongM: number, lateralM: number): WorldPoint => ({
          x:
            resolved.position.x +
            forward.x * alongM +
            side.x * lateralM,
          z:
            resolved.position.z +
            forward.z * alongM +
            side.z * lateralM,
        });

        for (const alongSign of [-1, 1]) {
          for (const sideSign of [-1, 1]) {
            const alongM = alongSign * halfLengthM;
            const lateralM = sideSign * halfWidthM;
            const corner = bracketPoint(alongM, lateralM);
            const bracketSegments = [
              [
                corner,
                bracketPoint(
                  alongM - alongSign * armLengthM,
                  lateralM,
                ),
              ],
              [
                corner,
                bracketPoint(
                  alongM,
                  lateralM - sideSign * armLengthM,
                ),
              ],
            ] as const;

            for (const [segmentIndex, [start, end]] of bracketSegments.entries()) {
              // Production renders each arm as a 0.13 m flat segment. Sampling
              // the endpoints and interior covers the complete L-bracket path;
              // the 0.065 m radius below accounts for its rendered footprint.
              for (const [sampleIndex, amount] of [0, 0.25, 0.5, 0.75, 1].entries()) {
                checkGuidancePoint(
                  map,
                  lane,
                  {
                    x: start.x + (end.x - start.x) * amount,
                    z: start.z + (end.z - start.z) * amount,
                  },
                  0.065,
                  `${checkpoint.id}/bracket-${alongSign}-${sideSign}-${segmentIndex}-${sampleIndex}`,
                  heading,
                  restrictedLaneIds,
                );
              }
            }
          }
        }
      }

      const routedLaneIds = new Set(
        LESSONS.filter((lesson) => lesson.mapId === map.id).flatMap(
          (lesson) => lesson.route,
        ),
      );
      for (const laneId of routedLaneIds) {
        const lane = laneById.get(laneId);
        if (!lane) continue;
        if (restrictedLaneIds.has(lane.id)) {
          violations.push(`${map.id}/${lane.id} routes through a restricted lane`);
        }
        const lengthM = laneLength(lane);
        const halfSpanM = resolveRouteChevronHalfSpan(lane.widthM);
        for (let distanceM = 7; distanceM <= lengthM; distanceM += 12) {
          if (!isLaneGuidanceDistanceAllowed(lane, distanceM)) continue;
          const tip = resolveAnchor(lane, {
            laneId: lane.id,
            distanceAlongM: distanceM,
          });
          const heading = (tip.headingDeg * Math.PI) / 180;
          const forward = { x: Math.sin(heading), z: Math.cos(heading) };
          const side = { x: forward.z, z: -forward.x };
          const back = {
            x: tip.position.x - forward.x * 1.45,
            z: tip.position.z - forward.z * 1.45,
          };
          if (
            map.laneGraph.conflictZones.some(
              (zone) =>
                zone.laneIds.includes(lane.id) &&
                (pointInPolygon(tip.position, zone.polygon) ||
                  pointInPolygon(back, zone.polygon)),
            )
          ) {
            continue;
          }
          const points = [
            tip.position,
            {
              x: back.x + side.x * halfSpanM,
              z: back.z + side.z * halfSpanM,
            },
            {
              x: back.x - side.x * halfSpanM,
              z: back.z - side.z * halfSpanM,
            },
          ];
          for (const [pointIndex, guidancePoint] of points.entries()) {
            checkGuidancePoint(
              map,
              lane,
              guidancePoint,
              0.11,
              `${lane.id}/chevron-${distanceM}-${pointIndex}`,
              heading,
              restrictedLaneIds,
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("orders every lesson checkpoint along its authored route", () => {
    const violations: string[] = [];
    const nextRouteOccurrence = (
      route: readonly string[],
      laneId: string,
      distanceAlongM: number,
      previousRouteIndex: number,
      previousDistanceM: number,
    ): number => {
      for (
        let routeIndex = Math.max(0, previousRouteIndex);
        routeIndex < route.length;
        routeIndex += 1
      ) {
        if (route[routeIndex] !== laneId) continue;
        if (
          routeIndex > previousRouteIndex ||
          distanceAlongM > previousDistanceM
        ) {
          return routeIndex;
        }
      }
      return -1;
    };

    for (const lesson of LESSONS) {
      const map = getMapPack(lesson.mapId);
      const checkpoints = new Map(
        map.laneGraph.checkpoints.map((item) => [item.id, item]),
      );
      let previousRouteIndex = -1;
      let previousDistanceM = -1;
      for (const checkpointId of lesson.checkpoints) {
        const item = checkpoints.get(checkpointId);
        if (!item) continue;
        const routeIndex = nextRouteOccurrence(
          lesson.route,
          item.anchor.laneId,
          item.anchor.distanceAlongM,
          previousRouteIndex,
          previousDistanceM,
        );
        if (routeIndex < 0) {
          violations.push(`${lesson.id}/${checkpointId} is not on the route`);
          continue;
        }
        previousRouteIndex = routeIndex;
        previousDistanceM = item.anchor.distanceAlongM;
      }
    }

    expect(violations).toEqual([]);

    const repeatedRoute = ["loop", "connector", "loop"];
    let routeIndex = -1;
    let distanceM = -1;
    const resolvedOccurrences = [
      { laneId: "loop", distanceAlongM: 30 },
      { laneId: "loop", distanceAlongM: 8 },
    ].map((anchor) => {
      routeIndex = nextRouteOccurrence(
        repeatedRoute,
        anchor.laneId,
        anchor.distanceAlongM,
        routeIndex,
        distanceM,
      );
      distanceM = anchor.distanceAlongM;
      return routeIndex;
    });
    expect(resolvedOccurrences).toEqual([0, 2]);
  });

  it("authors the Milton Keynes overtake corridor and reviewed source chain", () => {
    const lesson = getLesson("uk-dual-carriageway");
    const maneuver = lesson.maneuvers?.[0];
    expect(maneuver?.kind).toBe("overtake");
    if (!maneuver || maneuver.kind !== "overtake") return;

    expect(maneuver.normalLaneId).toBe("uk-dual-n-east");
    expect(maneuver.passingLaneId).toBe("uk-dual-n-east-pass");
    expect(
      maneuver.corridorEnd.distanceAlongM -
        maneuver.corridorStart.distanceAlongM,
    ).toBeGreaterThanOrEqual(650);
    expect(
      maneuver.phaseAnchors.return.distanceAlongM -
        maneuver.phaseAnchors.approach.distanceAlongM,
    ).toBeGreaterThanOrEqual(500);
    expect(
      maneuver.phaseAnchors.complete.distanceAlongM -
        maneuver.phaseAnchors.return.distanceAlongM,
    ).toBeGreaterThanOrEqual(100);
    expect(
      maneuver.leadVehicleStart.distanceAlongM -
        maneuver.phaseAnchors.approach.distanceAlongM,
    ).toBeGreaterThanOrEqual(70);
    expect(maneuver.leadVehicleSpeedFactor).toBeCloseTo(0.75);
    expect(maneuver.predictedClearSeconds).toBe(4);
    expect(maneuver.returnStandstillGapM).toBe(4);
    expect(maneuver.returnHeadwaySeconds).toBe(1.8);
    const map = getMapPack(lesson.mapId);
    const normalLane = map.laneGraph.lanes.find(
      (lane) => lane.id === maneuver.normalLaneId,
    );
    expect(normalLane).toBeDefined();
    const limitMps = (normalLane?.speedLimit ?? 0) / 2.236936;
    const leadSpeedMps = limitMps * maneuver.leadVehicleSpeedFactor;
    const steadyStatePassTimeSeconds =
      (maneuver.phaseAnchors.return.distanceAlongM -
        maneuver.phaseAnchors.approach.distanceAlongM) /
      limitMps;
    const availableRelativeGainM =
      (limitMps - leadSpeedMps) * steadyStatePassTimeSeconds;
    const requiredRelativeGainM =
      maneuver.leadVehicleStart.distanceAlongM -
      maneuver.phaseAnchors.approach.distanceAlongM +
      maneuver.returnStandstillGapM +
      leadSpeedMps * maneuver.returnHeadwaySeconds +
      4; // Approximate combined vehicle length in the pure simulation.
    expect(availableRelativeGainM).toBeGreaterThan(requiredRelativeGainM);
    expect(maneuver.sourceReferenceIds).toEqual([
      "uk-highway-code-general",
      "uk-highway-code-road",
      "uk-highway-code-motorways",
    ]);
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

  it("rejects near-collinear reverse overlaps between connected route lanes", () => {
    const overlaps: string[] = [];

    for (const map of MAP_PACKS) {
      for (let firstIndex = 0; firstIndex < map.laneGraph.lanes.length; firstIndex += 1) {
        const first = map.laneGraph.lanes[firstIndex];
        for (
          let secondIndex = firstIndex + 1;
          secondIndex < map.laneGraph.lanes.length;
          secondIndex += 1
        ) {
          const second = map.laneGraph.lanes[secondIndex];
          const routeConnected =
            first.successors.includes(second.id) ||
            second.successors.includes(first.id);
          if (!routeConnected) continue;

          for (let firstSegment = 1; firstSegment < first.centerline.length; firstSegment += 1) {
            for (let secondSegment = 1; secondSegment < second.centerline.length; secondSegment += 1) {
              const overlapM = nearCollinearReverseOverlapM(
                first.centerline[firstSegment - 1],
                first.centerline[firstSegment],
                second.centerline[secondSegment - 1],
                second.centerline[secondSegment],
              );
              // A connector may share a graph node for at most two metres;
              // sustained reverse overlap beyond it is an invalid route.
              if (overlapM > 2 + GEOMETRY_EPSILON) {
                overlaps.push(
                  `${map.id}: ${first.id} reverses over ${second.id} for ${overlapM.toFixed(2)}m`,
                );
              }
            }
          }
        }
      }
    }

    expect(overlaps).toEqual([]);
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

  it("uses the legal left-turn lanes throughout the authored NYC loop", () => {
    const map = getMapPack("nyc-upper-west-side");
    const expectedRoute = [
      "nyc-72-east-2",
      "nyc-72-east-2-after-bway",
      "nyc-columbus-n-1",
      "nyc-columbus-n-1-after-72",
      "nyc-79-west-2",
      "nyc-79-west-2-after-bway",
      "nyc-west-end-s-2",
      "nyc-west-end-s-2-after-79",
    ];

    for (const lessonId of [
      "us-one-way-grid",
      "us-signals-crosswalks",
      "us-lane-choice",
    ] as const) {
      expect(getLesson(lessonId).route).toEqual(expectedRoute);
    }

    const player = map.laneGraph.spawnPoints.find(
      (spawn) => spawn.id === "nyc-player",
    );
    expect(player?.kind).toBe("player");
    if (player?.kind === "player") {
      expect(player.anchor).toEqual({
        laneId: "nyc-72-east-2",
        distanceAlongM: 17,
      });
    }

    const controls = new Map(
      map.laneGraph.controls.map((control) => [control.id, control]),
    );
    expect(controls.get("nyc-signal-72-bway")?.laneIds).toContain(
      "nyc-72-east-2",
    );
    expect(controls.get("nyc-crosswalk-79")?.laneIds).toContain(
      "nyc-79-west-2",
    );
    expect(controls.get("nyc-signal-columbus")?.laneIds).toContain(
      "nyc-columbus-n-2",
    );

    const checkpoints = new Map(
      map.laneGraph.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]),
    );
    expect(checkpoints.get("nyc-79")?.anchor).toEqual({
      laneId: "nyc-79-west-2",
      distanceAlongM: 96,
    });
  });

  it("authors yield controls for every taught east and west roundabout re-entry", () => {
    const uk = getMapPack("milton-keynes-oldbrook");
    const france = getMapPack("calais-coquelles");
    const ukEast = uk.laneGraph.controls.find(
      (control) => control.id === "uk-yield-east",
    );
    const franceWest = france.laneGraph.controls.find(
      (control) => control.id === "fr-yield-west",
    );

    expect(ukEast?.approaches[0]?.stopLine).toEqual({
      laneId: "uk-entry-east",
      distanceAlongM: 86,
    });
    expect(franceWest?.approaches[0]?.stopLine).toEqual({
      laneId: "fr-entry-west",
      distanceAlongM: 94,
    });
  });

  it("keeps the current France curriculum within its supported geometry", () => {
    const priority = getLesson("fr-priority-roundabouts");
    const fasterRoad = getLesson("fr-speed-merging");
    const france = getMapPack("calais-coquelles");

    expect(priority.assessedRules).not.toContain("priority_to_right");
    expect(priority.summary).toContain("signed yields");
    expect(fasterRoad.assessedRules).not.toContain("merge");
    expect(fasterRoad.title).toBe("Faster-Road Lane Discipline");
    expect(fasterRoad.checkpoints.at(-1)).toBe("fr-speed-finish");
    expect(
      france.laneGraph.checkpoints.find(
        (checkpoint) => checkpoint.id === "fr-speed-finish",
      )?.anchor,
    ).toEqual({ laneId: "fr-exit-north", distanceAlongM: 60 });
  });

  it("aligns the visible Tokyo railway and controls both crossing directions", () => {
    const tokyo = getMapPack("tokyo-setagaya");
    const railway = tokyo.geometry.landmarks.find(
      (landmark) => landmark.id === "jp-setagaya-line",
    );
    const railControl = tokyo.laneGraph.controls.find(
      (control) => control.id === "jp-rail-signal",
    );
    const stationCrosswalk = tokyo.laneGraph.controls.find(
      (control) => control.id === "jp-crosswalk-station",
    );

    expect(railway).toMatchObject({
      center: { x: 18, z: -62 },
      size: { x: 5, z: 72 },
    });
    expect(railControl?.laneIds).toEqual([
      "jp-south-east-2",
      "jp-south-west-2",
    ]);
    expect(railControl?.approaches.map((item) => item.stopLine)).toEqual([
      { laneId: "jp-south-east-2", distanceAlongM: 42 },
      { laneId: "jp-south-west-2", distanceAlongM: 48 },
    ]);
    expect(stationCrosswalk?.approaches[1]?.stopLine).toEqual({
      laneId: "jp-narrow-north-1",
      distanceAlongM: 82,
    });
    expect(getLesson("jp-railway-crossings").checkpoints).toContain(
      "jp-rail-clear",
    );
  });

  it("keeps capstone coaching faithful to its authored terminal geometry", () => {
    const capstone = getLesson("uk-fr-side-swap");
    const francePrompt = capstone.coachPrompts.find(
      (prompt) => prompt.id === "xf-fr",
    );
    expect(francePrompt?.message).toContain("marked terminal exit");
    expect(francePrompt?.message.toLowerCase()).not.toContain("roundabout");
  });
});
