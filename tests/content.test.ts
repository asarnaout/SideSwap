import { describe, expect, it } from "vitest";
import {
  COUNTRY_PROFILES,
  DESTINATION_PROFILES,
  FINE_BY_COUNTRY,
  FREE_DRIVES,
  GIG_FARE_BY_COUNTRY,
  MAP_PACKS,
  PASSENGER_FARE_BY_COUNTRY,
  STARTING_WALLET_BY_COUNTRY,
  getCountryProfile,
  getDestinationProfile,
  formatMoney,
  getMapPack,
  resolveSteeringSide,
} from "../app/game/content";
import type {
  LaneAnchor,
  LaneSegment,
  WorldPoint,
} from "../app/game/types";
import { resolveCheckpointTargetWidth } from "../app/game/GameCanvas";

const GEOMETRY_EPSILON = 1e-5;
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
    expect(FREE_DRIVES).toHaveLength(5);
    expect(MAP_PACKS).toHaveLength(5);
  });

  it("zones NYC so towers cluster clear of the residential house pocket", () => {
    const nyc = MAP_PACKS.find((m) => m.id === "nyc-upper-west-side");
    expect(nyc).toBeDefined();
    const blocks = nyc!.geometry.blocks;
    const VALID = new Set([
      "nyc-downtown", "nyc-midrise", "nyc-brownstone", "nyc-house", "nyc-shop",
    ]);
    for (const b of blocks) {
      if (b.buildingSet) expect(VALID.has(b.buildingSet), `${b.id}:${b.buildingSet}`).toBe(true);
    }
    const houses = blocks.filter((b) => b.buildingSet === "nyc-house");
    const towers = blocks.filter((b) => b.buildingSet === "nyc-downtown");
    expect(houses.length).toBeGreaterThan(0);
    expect(towers.length).toBeGreaterThan(0);
    // No detached-house block may abut a skyscraper block: their footprints must
    // stay a road's width apart, so "no Empire State next to a random house".
    const footprintGapM = (
      a: (typeof blocks)[number],
      b: (typeof blocks)[number],
    ) => {
      const dx = Math.abs(a.center.x - b.center.x) - (a.size.x + b.size.x) / 2;
      const dz = Math.abs(a.center.z - b.center.z) - (a.size.z + b.size.z) / 2;
      return Math.max(dx, dz);
    };
    for (const house of houses) {
      for (const tower of towers) {
        expect(footprintGapM(house, tower), `${house.id} vs ${tower.id}`).toBeGreaterThan(20);
      }
    }
  });

  it("gives every country a currency and formats money in it", () => {
    const expected: Record<
      string,
      { code: string; symbol: string; minorUnits: number }
    > = {
      us: { code: "USD", symbol: "$", minorUnits: 2 },
      uk: { code: "GBP", symbol: "£", minorUnits: 2 },
      fr: { code: "EUR", symbol: "€", minorUnits: 2 },
      jp: { code: "JPY", symbol: "¥", minorUnits: 0 },
    };
    for (const country of COUNTRY_PROFILES) {
      expect(country.currency, country.id).toEqual(expected[country.id]);
    }
    expect(formatMoney(1250, getCountryProfile("uk"))).toBe("£1,250.00");
    expect(formatMoney(3000, getCountryProfile("jp"))).toBe("¥3,000");
    expect(formatMoney(20, getCountryProfile("us"))).toBe("$20.00");
    expect(formatMoney(1234567.5, getCountryProfile("fr"))).toBe("€1,234,567.50");
  });

  it("anchors every gas station to a real lane within its bounds", () => {
    let count = 0;
    for (const pack of MAP_PACKS) {
      for (const service of pack.geometry.servicePoints ?? []) {
        const lane = pack.laneGraph.lanes.find(
          (candidate) => candidate.id === service.anchor.laneId,
        );
        expect(
          lane,
          `${service.id}: missing lane ${service.anchor.laneId} on ${pack.id}`,
        ).toBeDefined();
        expect(() => resolveAnchor(lane!, service.anchor)).not.toThrow();
        count += 1;
      }
    }
    expect(count).toBe(5); // one gas station per city
  });

  it("anchors every gig venue to a real lane, with enough per city", () => {
    let count = 0;
    for (const pack of MAP_PACKS) {
      const venues = pack.geometry.gigVenues ?? [];
      for (const venue of venues) {
        const lane = pack.laneGraph.lanes.find(
          (candidate) => candidate.id === venue.anchor.laneId,
        );
        expect(
          lane,
          `${venue.id}: missing lane ${venue.anchor.laneId} on ${pack.id}`,
        ).toBeDefined();
        expect(() => resolveAnchor(lane!, venue.anchor)).not.toThrow();
        count += 1;
      }
      // A gig needs a distinct pickup + drop-off, so every city needs >= 2.
      expect(venues.length, `${pack.id} gig venues`).toBeGreaterThanOrEqual(2);
    }
    expect(count).toBe(20); // four venues per city
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

  it("prices deliveries, passenger fares and fines for every country", () => {
    for (const country of COUNTRY_PROFILES) {
      const delivery = GIG_FARE_BY_COUNTRY[country.id];
      const passenger = PASSENGER_FARE_BY_COUNTRY[country.id];
      const fine = FINE_BY_COUNTRY[country.id];
      // Every table covers every country with sane, positive values.
      expect(delivery.base, country.id).toBeGreaterThan(0);
      expect(delivery.ratePerM, country.id).toBeGreaterThan(0);
      expect(passenger.base, country.id).toBeGreaterThan(0);
      expect(passenger.ratePerM, country.id).toBeGreaterThan(0);
      expect(fine, country.id).toBeGreaterThan(0);
      // A ride carries a pickup premium over the same-distance parcel.
      expect(passenger.base, country.id).toBeGreaterThan(delivery.base);
      expect(passenger.ratePerM, country.id).toBeGreaterThanOrEqual(
        delivery.ratePerM,
      );
      // The fine stings but never exceeds the starting wallet: the pivot dropped
      // harsh punishment, so careless driving costs money, not the whole run.
      expect(fine, country.id).toBeLessThan(
        STARTING_WALLET_BY_COUNTRY[country.id],
      );
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

    }

    expect(violations).toEqual([]);
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

  it("keeps circular roundabout islands fully inside the circulating carriageway", () => {
    for (const [mapId, surfaceId, landmarkId] of [
      ["milton-keynes-oldbrook", "uk-roundabout", "uk-roundabout-green"],
      ["calais-coquelles", "fr-roundabout", "fr-roundabout-green"],
    ] as const) {
      const map = getMapPack(mapId);
      const surface = map.geometry.roadSurfaces.find(
        (candidate) => candidate.id === surfaceId,
      );
      const island = map.geometry.landmarks.find(
        (candidate) => candidate.id === landmarkId,
      );

      expect(surface, `${mapId}/${surfaceId}`).toBeDefined();
      expect(island, `${mapId}/${landmarkId}`).toBeDefined();
      if (!surface || !island) continue;

      const innerKerbRadiusM = Math.min(
        ...surface.centerline.map((point) => distanceBetween(point, island.center)),
      ) - surface.widthM / 2;
      const islandRadiusM = Math.min(island.size.x, island.size.z) / 2;
      expect(island.size.x).toBe(island.size.z);
      expect(
        islandRadiusM,
        `${mapId} island must leave a visible paved inner-kerb margin`,
      ).toBeLessThanOrEqual(innerKerbRadiusM - 1);
    }
  });

  it("keeps moved parks and street furniture clear of driveable surfaces", () => {
    const checks = [
      ["nyc-upper-west-side", "nyc-verdi-green"],
      ["nyc-upper-west-side", "nyc-subway"],
      ["tokyo-setagaya", "jp-temple-green"],
      ["london-south-kensington", "london-exhibition-road-public-space"],
    ] as const;

    for (const [mapId, landmarkId] of checks) {
      const map = getMapPack(mapId);
      const landmark = map.geometry.landmarks.find(
        (candidate) => candidate.id === landmarkId,
      );
      expect(landmark, `${mapId}/${landmarkId}`).toBeDefined();
      if (!landmark) continue;

      const closestSurfaceClearanceM = Math.min(
        ...map.geometry.roadSurfaces.flatMap((surface) =>
          surface.centerline.slice(1).map((end, index) => {
            const start = surface.centerline[index];
            const dx = end.x - start.x;
            const dz = end.z - start.z;
            const length = Math.hypot(dx, dz);
            const lateralHalfSpanM =
              length <= GEOMETRY_EPSILON
                ? Math.max(landmark.size.x, landmark.size.z) / 2
                :
                    (Math.abs(dz / length) * landmark.size.x) / 2 +
                    (Math.abs(dx / length) * landmark.size.z) / 2;
            return (
              distanceToSegment(landmark.center, start, end) -
              surface.widthM / 2 -
              lateralHalfSpanM
            );
          }),
        ),
      );
      expect(
        closestSurfaceClearanceM,
        `${mapId}/${landmarkId} overlaps a road surface`,
      ).toBeGreaterThanOrEqual(-GEOMETRY_EPSILON);
    }
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
  });
});
