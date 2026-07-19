import type {
  NpcVehicleVariant,
  SimulationBoxJunctionDefinition,
  SimulationCheckpoint,
  SimulationCoreConfig,
  SimulationLane,
  SimulationOvertakeExerciseConfig,
  SimulationPoint,
  SimulationRouteGuidanceStepConfig,
  SimulationTrafficGate,
  StopLineDefinition,
  TrafficLightDefinition,
  TrafficLightSequence,
} from "./simulation";
import type { OvertakeExercise } from "./types";
import type {
  GameCanvasLane,
  GameCanvasLesson,
  GameCanvasMapPack,
  SpeedUnit as CanvasSpeedUnit,
  TrafficSide,
} from "./GameCanvas";
import { SCORING_CONFIG, getCountryProfile } from "./content";

const DEFAULT_LANE_WIDTH_M = 3.5;
// The car's top speed models a real vehicle, not a governor pinned to the
// posted limit. 31 m/s (~70 mph, the UK national speed limit) leaves clear
// headroom above every urban route so a driver can physically exceed the
// limit — going over is scored as speeding, never silently prevented.
const DEFAULT_MAX_FORWARD_SPEED_MPS = 31;
const DEFAULT_MAX_REVERSE_SPEED_MPS = 6;

export interface SimulationAdapterOptions {
  readonly lesson?: GameCanvasLesson;
  readonly mapPack?: GameCanvasMapPack;
  readonly trafficSide: TrafficSide;
  readonly speedUnit: CanvasSpeedUnit;
  readonly touchFirst?: boolean;
}

export interface ResolvedSimulationAnchor extends SimulationPoint {
  readonly heading: number;
  readonly segmentIndex: number;
  readonly distanceOnSegment: number;
}

const degreesToRadians = (degrees: number): number =>
  (degrees * Math.PI) / 180;

const speedToMetresPerSecond = (
  speed: number,
  speedUnit: CanvasSpeedUnit,
): number => (speedUnit === "mph" ? speed / 2.236936 : speed / 3.6);

const laneLength = (lane: GameCanvasLane): number =>
  lane.centerline.slice(1).reduce(
    (total, point, index) =>
      total +
      Math.hypot(
        point.x - lane.centerline[index].x,
        point.z - lane.centerline[index].z,
      ),
    0,
  );

export function resolveSimulationLaneAnchor(
  lanes: readonly GameCanvasLane[],
  anchor: { readonly laneId: string; readonly distanceAlongM: number },
): ResolvedSimulationAnchor | null {
  const lane = lanes.find((candidate) => candidate.id === anchor.laneId);
  if (!lane || lane.centerline.length < 2) return null;
  let remaining = Math.max(0, anchor.distanceAlongM);
  for (let index = 0; index < lane.centerline.length - 1; index += 1) {
    const start = lane.centerline[index];
    const end = lane.centerline[index + 1];
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    if (length < 0.001) continue;
    if (remaining <= length || index === lane.centerline.length - 2) {
      const distanceOnSegment = Math.min(remaining, length);
      const amount = distanceOnSegment / length;
      return {
        x: start.x + (end.x - start.x) * amount,
        z: start.z + (end.z - start.z) * amount,
        heading: Math.atan2(end.x - start.x, end.z - start.z),
        segmentIndex: index,
        distanceOnSegment,
      };
    }
    remaining -= length;
  }
  return null;
}

export function resolveSimulationStartPose(
  lesson: GameCanvasLesson | undefined,
  mapPack: GameCanvasMapPack | undefined,
  trafficSide: TrafficSide,
): ResolvedSimulationAnchor {
  if (lesson && mapPack) {
    const firstLaneId = lesson.route[0];
    const usesAuthoredSpawn = Boolean(lesson.startSpawnId);
    const spawn = usesAuthoredSpawn
      ? mapPack.laneGraph.spawnPoints.find(
          (point) => point.kind === "player" && point.id === lesson.startSpawnId,
        )
      : mapPack.laneGraph.spawnPoints.find(
          (point) =>
            point.kind === "player" &&
            ("anchor" in point
              ? point.anchor?.laneId === firstLaneId
              : point.laneId === firstLaneId),
        );
    if (spawn) {
      if (
        "anchor" in spawn &&
        spawn.anchor &&
        (usesAuthoredSpawn || !firstLaneId || spawn.anchor.laneId === firstLaneId)
      ) {
        const anchored = resolveSimulationLaneAnchor(
          mapPack.laneGraph.lanes,
          spawn.anchor,
        );
        if (anchored) return anchored;
      }
      if (
        spawn.pose &&
        (usesAuthoredSpawn || !firstLaneId || spawn.laneId === firstLaneId)
      ) {
        return {
          x: spawn.pose.position.x,
          z: spawn.pose.position.z,
          heading: degreesToRadians(spawn.pose.headingDeg),
          segmentIndex: 0,
          distanceOnSegment: 0,
        };
      }
    }
    const lane = mapPack.laneGraph.lanes.find(
      (candidate) => candidate.id === firstLaneId,
    );
    if (lane?.centerline.length) {
      const first = lane.centerline[0];
      const next = lane.centerline[1] ?? { x: first.x, z: first.z + 1 };
      return {
        x: first.x,
        z: first.z,
        heading: Math.atan2(next.x - first.x, next.z - first.z),
        segmentIndex: 0,
        distanceOnSegment: 0,
      };
    }
  }
  return {
    x: trafficSide === "right" ? 2.75 : -2.75,
    z: -52,
    heading: 0,
    segmentIndex: 0,
    distanceOnSegment: 0,
  };
}

function coreLaneRole(role: string | undefined): SimulationLane["role"] {
  if (role === "passing" || role === "entry" || role === "exit") return role;
  return "travel";
}

function coreLaneKind(role: string | undefined, laneId: string): SimulationLane["kind"] {
  if (role === "roundabout") return "roundabout";
  if (role === "entry" || laneId.toLowerCase().includes("merge")) return "merge";
  return "road";
}

const wrappedAngleDifference = (left: number, right: number): number => {
  let difference = (left - right) % (Math.PI * 2);
  if (difference > Math.PI) difference -= Math.PI * 2;
  if (difference < -Math.PI) difference += Math.PI * 2;
  return difference;
};

function adjacentLaneIdForSimulation(
  lane: GameCanvasLane,
  lanesById: ReadonlyMap<string, GameCanvasLane>,
): string | undefined {
  const sourceMidpoint = resolveSimulationLaneAnchor(
    [lane],
    { laneId: lane.id, distanceAlongM: laneLength(lane) / 2 },
  );
  if (!sourceMidpoint) return undefined;
  return (lane.adjacentLaneIds ?? [])
    .flatMap((candidateId) => {
      const candidate = lanesById.get(candidateId);
      if (!candidate) return [];
      if (lane.roadId && candidate.roadId && lane.roadId !== candidate.roadId) {
        return [];
      }
      if (
        lane.trafficSide &&
        candidate.trafficSide &&
        lane.trafficSide !== candidate.trafficSide
      ) {
        return [];
      }
      const candidateMidpoint = resolveSimulationLaneAnchor(
        [candidate],
        { laneId: candidate.id, distanceAlongM: laneLength(candidate) / 2 },
      );
      if (!candidateMidpoint) return [];
      const headingDifference = Math.abs(
        wrappedAngleDifference(sourceMidpoint.heading, candidateMidpoint.heading),
      );
      const separation = Math.hypot(
        sourceMidpoint.x - candidateMidpoint.x,
        sourceMidpoint.z - candidateMidpoint.z,
      );
      if (headingDifference > Math.PI / 4 || separation < 1.5 || separation > 9) {
        return [];
      }
      return [{ id: candidate.id, separation }];
    })
    .sort((left, right) => left.separation - right.separation)[0]?.id;
}

function projectDistanceAlongLane(
  lane: GameCanvasLane,
  point: SimulationPoint,
): number | null {
  if (lane.centerline.length < 2) return null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestDistanceAlong = 0;
  let accumulated = 0;
  for (let index = 0; index < lane.centerline.length - 1; index += 1) {
    const start = lane.centerline[index];
    const end = lane.centerline[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.001) continue;
    const amount = Math.min(
      1,
      Math.max(0, ((point.x - start.x) * dx + (point.z - start.z) * dz) / (length * length)),
    );
    const x = start.x + dx * amount;
    const z = start.z + dz * amount;
    const distance = Math.hypot(point.x - x, point.z - z);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestDistanceAlong = accumulated + length * amount;
    }
    accumulated += length;
  }
  return Number.isFinite(bestDistance) ? bestDistanceAlong : null;
}

function inferVehicleVariant(spawnId: string): NpcVehicleVariant | undefined {
  const value = spawnId.toLowerCase();
  if (value.includes("bus")) return "bus";
  if (value.includes("taxi") || value.includes("cab")) return "taxi";
  if (value.includes("van") || value.includes("shuttle")) return "van";
  return undefined;
}

function buildTrafficLights(
  mapPack: GameCanvasMapPack,
): {
  readonly lights: TrafficLightDefinition[];
  readonly stopLines: StopLineDefinition[];
} {
  const lanesById = new Map(
    mapPack.laneGraph.lanes.map((lane) => [lane.id, lane]),
  );
  const lights: TrafficLightDefinition[] = [];
  const stopLines: StopLineDefinition[] = [];
  for (const control of mapPack.laneGraph.controls) {
    if (control.type !== "signal" && control.type !== "railway_signal") continue;
    const isRailway = control.type === "railway_signal";
    const approaches = control.approaches?.length
      ? control.approaches
      : control.laneIds.flatMap((laneId, index) => {
          const lane = lanesById.get(laneId);
          const distance = lane
            ? projectDistanceAlongLane(lane, control.position)
            : null;
          return distance === null
            ? []
            : [{
                id: `${control.id}-approach-${index + 1}`,
                laneIds: [laneId],
                stopLine: { laneId, distanceAlongM: distance },
                phaseGroup: `${control.id}-${index + 1}`,
              }];
        });
    const phaseGroups = Array.from(
      new Set(approaches.map((approach) => approach.phaseGroup)),
    ).sort();
    const usesUkSequence = !isRailway && (control.installations ?? []).some(
      (installation) => installation.style === "uk_signal",
    );
    const sequence: TrafficLightSequence = usesUkSequence ? "uk" : "standard";
    const greenSeconds = isRailway ? 8 : 7;
    const amberSeconds = isRailway ? 0.8 : usesUkSequence ? 3 : 2;
    const allRedSeconds = isRailway ? 0.2 : 1;
    const redAmberSeconds = usesUkSequence ? 1.5 : 0;
    const slotSeconds = greenSeconds + amberSeconds + allRedSeconds;
    const slotCount = isRailway ? 2 : Math.max(2, phaseGroups.length);
    const durationSeconds = slotSeconds * slotCount;
    const redSeconds =
      (slotCount - 1) * slotSeconds - redAmberSeconds;
    const groupOffset = new Map(
      phaseGroups.map((group, index) => [
        group,
        (durationSeconds - index * slotSeconds) % durationSeconds,
      ]),
    );
    for (const approach of approaches) {
      const stopPose = resolveSimulationLaneAnchor(
        mapPack.laneGraph.lanes,
        approach.stopLine,
      );
      if (!stopPose) continue;
      lights.push({
        id: approach.id,
        phaseGroup: approach.phaseGroup,
        x: stopPose.x,
        z: stopPose.z,
        cycle: {
          greenSeconds,
          amberSeconds,
          allRedSeconds,
          redSeconds,
          redAmberSeconds,
          sequence,
          offsetSeconds: groupOffset.get(approach.phaseGroup) ?? 0,
        },
      });
      for (const laneId of approach.laneIds) {
        if (!lanesById.has(laneId)) continue;
        stopLines.push({
          id: `${approach.id}-${laneId}-line`,
          laneId,
          distance: approach.stopLine.distanceAlongM,
          kind: isRailway ? "railway" : "traffic_light",
          trafficLightId: approach.id,
        });
      }
    }
  }
  return { lights, stopLines };
}

function buildStopAndYieldLines(
  mapPack: GameCanvasMapPack,
): StopLineDefinition[] {
  const lanesById = new Map(
    mapPack.laneGraph.lanes.map((lane) => [lane.id, lane]),
  );
  const result: StopLineDefinition[] = [];
  for (const control of mapPack.laneGraph.controls) {
    if (control.type !== "stop" && control.type !== "yield") continue;
    const kind = control.type;
    const approaches = control.approaches?.length
      ? control.approaches
      : control.laneIds.flatMap((laneId, index) => {
          const lane = lanesById.get(laneId);
          const distance = lane
            ? projectDistanceAlongLane(lane, control.position)
            : null;
          return distance === null
            ? []
            : [{
                id: `${control.id}-approach-${index + 1}`,
                laneIds: [laneId],
                stopLine: { laneId, distanceAlongM: distance },
              }];
        });
    for (const approach of approaches) {
      for (const laneId of approach.laneIds) {
        if (!lanesById.has(laneId)) continue;
        result.push({
          id: `${approach.id}-${laneId}-line`,
          laneId,
          distance: approach.stopLine.distanceAlongM,
          kind,
          conflictRadius: kind === "yield" ? 14 : undefined,
        });
      }
    }
  }
  return result;
}

function buildBoxJunctions(
  lesson: GameCanvasLesson,
  mapPack: GameCanvasMapPack,
): SimulationBoxJunctionDefinition[] {
  if (
    lesson.kind !== "free_drive" &&
    !lesson.assessedRules?.includes("box_junction")
  ) {
    return [];
  }
  const zonesById = new Map(
    mapPack.laneGraph.conflictZones.map((zone) => [zone.id, zone]),
  );
  const lanesById = new Map(
    mapPack.laneGraph.lanes.map((lane) => [lane.id, lane]),
  );
  return mapPack.laneGraph.controls.flatMap((control) => {
    if (control.type !== "box_junction") return [];
    return (control.conflictZoneIds ?? []).flatMap((zoneId) => {
      const zone = zonesById.get(zoneId);
      if (!zone) return [];
      const laneIds = Array.from(new Set([...control.laneIds, ...zone.laneIds]));
      const exitLaneIds = Array.from(
        new Set(
          laneIds.flatMap((laneId) => lanesById.get(laneId)?.successors ?? []),
        ),
      );
      return [{
        id: `${control.id}-${zone.id}`,
        polygon: zone.polygon,
        laneIds,
        exitLaneIds: exitLaneIds.length ? exitLaneIds : laneIds,
        exitClearanceM: 12,
      }];
    });
  });
}

/** End-to-end unit direction of a lane, used to split a carriageway's lanes
 * into their two opposing travel directions. */
function laneForwardDirection(
  lane: GameCanvasLane,
): { readonly x: number; readonly z: number } | null {
  const start = lane.centerline[0];
  const end = lane.centerline.at(-1);
  if (!start || !end) return null;
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  return length > 0.01 ? { x: dx / length, z: dz / length } : null;
}

/** Arclength fractions for the supplemental oncoming gates on a two-way road. */
const ONCOMING_GATE_FRACTIONS = [0.72, 0.28] as const;

function buildTrafficGates(
  mapPack: GameCanvasMapPack,
): SimulationTrafficGate[] {
  const lanes = mapPack.laneGraph.lanes;
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  const laneIds = new Set(lanes.map((lane) => lane.id));

  const authoredGates: SimulationTrafficGate[] = mapPack.laneGraph.spawnPoints.flatMap((spawn) => {
    if (spawn.kind !== "vehicle") return [];
    const anchor = "anchor" in spawn ? spawn.anchor : undefined;
    if (anchor && laneIds.has(anchor.laneId)) {
      return [{
        id: spawn.id,
        laneId: anchor.laneId,
        distance: anchor.distanceAlongM,
        variant: inferVehicleVariant(spawn.id),
      }];
    }
    const laneId = spawn.laneId;
    const lane = laneId
      ? lanes.find((candidate) => candidate.id === laneId)
      : undefined;
    const distance = lane && spawn.pose
      ? projectDistanceAlongLane(lane, spawn.pose.position)
      : null;
    return lane && distance !== null
      ? [{
          id: spawn.id,
          laneId: lane.id,
          distance,
          variant: inferVehicleVariant(spawn.id),
        }]
      : [];
  });

  // Give every TWO-WAY road oncoming traffic. Authored vehicle spawns only ever
  // sit on same-direction lanes, so without this the player never meets a car
  // coming the other way — the whole point of the game. For each carriageway
  // whose lanes split into two opposing directions, make sure each direction
  // carries a gate; these supplemental gates defer their first spawn
  // (allowInitialSpawn:false), so a parked player is never boxed in and only
  // meets oncoming cars once under way. Fully deterministic (fixed lane order +
  // fractions) so the traffic-safety replay stays reproducible.
  const gatedLaneIds = new Set(authoredGates.map((gate) => gate.laneId));
  const supplementalGates: SimulationTrafficGate[] = [];
  for (const surface of mapPack.geometry.roadSurfaces ?? []) {
    const surfaceLanes = surface.laneIds
      .map((id) => laneById.get(id))
      .filter((lane): lane is GameCanvasLane => Boolean(lane));
    const reference = surfaceLanes.map(laneForwardDirection).find(Boolean);
    if (!reference) continue;
    const forward: GameCanvasLane[] = [];
    const backward: GameCanvasLane[] = [];
    for (const lane of surfaceLanes) {
      const direction = laneForwardDirection(lane);
      if (!direction) continue;
      const aligned = direction.x * reference.x + direction.z * reference.z >= 0;
      (aligned ? forward : backward).push(lane);
    }
    if (!forward.length || !backward.length) continue; // one-way carriageway
    for (const group of [forward, backward]) {
      if (group.some((lane) => gatedLaneIds.has(lane.id))) continue;
      const target = group.reduce((longest, lane) =>
        laneLength(lane) > laneLength(longest) ? lane : longest,
      );
      const length = laneLength(target);
      for (const fraction of ONCOMING_GATE_FRACTIONS) {
        supplementalGates.push({
          id: `oncoming-${target.id}-${Math.round(fraction * 100)}`,
          laneId: target.id,
          distance: length * fraction,
          allowInitialSpawn: false,
        });
      }
      gatedLaneIds.add(target.id);
    }
  }
  return [...authoredGates, ...supplementalGates];
}

function pointInPolygon(
  point: SimulationPoint,
  polygon: readonly SimulationPoint[],
): boolean {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const intersects =
      currentPoint.z > point.z !== previousPoint.z > point.z &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.z - currentPoint.z)) /
          (previousPoint.z - currentPoint.z || Number.EPSILON) +
          currentPoint.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function routeCueDistance(
  lane: GameCanvasLane,
  mapPack: GameCanvasMapPack,
  completionDistance: number,
): number | null {
  const length = laneLength(lane);
  const maximum = Math.max(0, length - 1);
  const firstCandidate = Math.min(
    maximum,
    Math.max(completionDistance, Math.min(7, length / 2)),
  );
  const candidateIsSafe = (distance: number): boolean => {
    if (
      (lane.connectorRanges ?? []).some(
        (range) =>
          distance >= range.startDistanceAlongM - 0.05 &&
          distance <= range.endDistanceAlongM + 0.05,
      )
    ) {
      return false;
    }
    const pose = resolveSimulationLaneAnchor(mapPack.laneGraph.lanes, {
      laneId: lane.id,
      distanceAlongM: distance,
    });
    if (!pose) return false;
    return !mapPack.laneGraph.conflictZones.some(
      (zone) => zone.laneIds.includes(lane.id) && pointInPolygon(pose, zone.polygon),
    );
  };
  for (let distance = firstCandidate; distance <= maximum; distance += 2) {
    if (candidateIsSafe(distance)) return distance;
  }
  return candidateIsSafe(completionDistance) ? completionDistance : null;
}

function routeGuidanceLabel(lane: GameCanvasLane): string {
  if (lane.role === "exit") return "TAKE THIS EXIT";
  if (lane.role === "entry") return "USE THIS ENTRY LANE";
  if (lane.role === "roundabout") return "FOLLOW ROUNDABOUT LANE";
  if (lane.role === "passing") return "PASSING LANE";
  if (lane.role === "normal") return "NORMAL TRAVEL LANE";
  return "FOLLOW THIS LANE";
}

function buildRouteGuidance(
  lesson: GameCanvasLesson,
  mapPack: GameCanvasMapPack,
): SimulationRouteGuidanceStepConfig[] {
  // Free drive deliberately permits arbitrary exploration; its borrowed route
  // is not an assessed sequence and therefore must not gate progress.
  if (lesson.kind === "free_drive") return [];
  const lanes = new Map(mapPack.laneGraph.lanes.map((lane) => [lane.id, lane]));
  const start = resolveSimulationStartPose(lesson, mapPack, lesson.trafficSide);
  return lesson.route.map((targetLaneId, routeIndex) => {
    const fromLaneId = routeIndex > 0 ? lesson.route[routeIndex - 1] : null;
    const fromLane = fromLaneId ? lanes.get(fromLaneId) : null;
    const targetLane = lanes.get(targetLaneId);
    if ((fromLaneId && !fromLane) || !targetLane) {
      throw new Error(
        `Route occurrence ${routeIndex} in lesson ${lesson.id} references a missing lane.`,
      );
    }
    if (fromLane && !(fromLane.successors ?? []).includes(targetLane.id)) {
      throw new Error(
        `Route occurrence ${routeIndex} in lesson ${lesson.id} is not a legal successor transition (${fromLane.id} -> ${targetLane.id}).`,
      );
    }
    const targetLength = laneLength(targetLane);
    const startDistance =
      routeIndex === 0 ? projectDistanceAlongLane(targetLane, start) ?? 0 : 0;
    const finalCheckpoint =
      routeIndex === lesson.route.length - 1
        ? [...lesson.checkpoints]
            .reverse()
            .map((checkpointId) =>
              mapPack.laneGraph.checkpoints.find(
                (checkpoint) => checkpoint.id === checkpointId,
              ),
            )
            .find(
              (checkpoint) => checkpoint?.anchor?.laneId === targetLane.id,
            )
        : null;
    const desiredCompletionDistance =
      Math.max(
        startDistance + 3,
        targetLength - 3,
        finalCheckpoint?.anchor?.distanceAlongM ?? 0,
      );
    const completionDistance = Math.min(
      Math.max(0, targetLength - 0.05),
      desiredCompletionDistance,
    );
    const cueDistance = routeCueDistance(
      targetLane,
      mapPack,
      completionDistance,
    );
    return {
      id: `${lesson.id}:route:${routeIndex}`,
      routeIndex,
      fromLaneId: fromLane?.id ?? null,
      targetLaneId: targetLane.id,
      completionAnchor: {
        laneId: targetLane.id,
        distance: completionDistance,
      },
      ...(cueDistance === null
        ? {}
        : {
            cueAnchor: {
              laneId: targetLane.id,
              distance: cueDistance,
            },
          }),
      label: routeIndex === 0 ? "KEEP THIS LANE" : routeGuidanceLabel(targetLane),
      required: true,
    };
  });
}

function buildOvertakeExercises(
  lesson: GameCanvasLesson,
  mapPack: GameCanvasMapPack,
): SimulationOvertakeExerciseConfig[] {
  const authored = (
    lesson as GameCanvasLesson & {
      readonly maneuvers?: readonly OvertakeExercise[];
    }
  ).maneuvers ?? [];
  const lanes = new Map(mapPack.laneGraph.lanes.map((lane) => [lane.id, lane]));
  const anchor = (value: {
    readonly laneId: string;
    readonly distanceAlongM: number;
  }) => ({
    laneId: value.laneId,
    distance: value.distanceAlongM,
  });
  return authored.map((maneuver) => {
    if (maneuver.kind !== "overtake") {
      throw new Error(
        `Unsupported maneuver ${maneuver.id} in lesson ${lesson.id}.`,
      );
    }
    if (
      !lanes.has(maneuver.normalLaneId) ||
      !lanes.has(maneuver.passingLaneId)
    ) {
      throw new Error(
        `Maneuver ${maneuver.id} in lesson ${lesson.id} references a missing running lane.`,
      );
    }
    const referencedAnchors = [
      maneuver.corridorStart,
      maneuver.corridorEnd,
      maneuver.leadVehicleStart,
      maneuver.phaseAnchors.approach,
      maneuver.phaseAnchors.observe,
      maneuver.phaseAnchors.pass,
      maneuver.phaseAnchors.return,
      maneuver.phaseAnchors.complete,
    ];
    if (
      referencedAnchors.some((candidate) => {
        const lane = lanes.get(candidate.laneId);
        return (
          !lane ||
          !Number.isFinite(candidate.distanceAlongM) ||
          candidate.distanceAlongM < 0 ||
          candidate.distanceAlongM > laneLength(lane)
        );
      })
    ) {
      throw new Error(
        `Maneuver ${maneuver.id} in lesson ${lesson.id} has an invalid lane anchor.`,
      );
    }
    const anchorsUseExpectedLanes =
      maneuver.corridorStart.laneId === maneuver.normalLaneId &&
      maneuver.corridorEnd.laneId === maneuver.normalLaneId &&
      maneuver.leadVehicleStart.laneId === maneuver.normalLaneId &&
      maneuver.phaseAnchors.approach.laneId === maneuver.normalLaneId &&
      maneuver.phaseAnchors.observe.laneId === maneuver.normalLaneId &&
      maneuver.phaseAnchors.pass.laneId === maneuver.passingLaneId &&
      maneuver.phaseAnchors.return.laneId === maneuver.passingLaneId &&
      maneuver.phaseAnchors.complete.laneId === maneuver.normalLaneId;
    if (!anchorsUseExpectedLanes) {
      throw new Error(
        `Maneuver ${maneuver.id} in lesson ${lesson.id} places a phase on the wrong lane.`,
      );
    }
    return {
      id: maneuver.id,
      kind: "overtake" as const,
      normalLaneId: maneuver.normalLaneId,
      passingLaneId: maneuver.passingLaneId,
      corridorStart: anchor(maneuver.corridorStart),
      corridorEnd: anchor(maneuver.corridorEnd),
      leadVehicleStart: anchor(maneuver.leadVehicleStart),
      leadVehicleSpeedFactor: maneuver.leadVehicleSpeedFactor,
      phaseAnchors: {
        approach: anchor(maneuver.phaseAnchors.approach),
        observe: anchor(maneuver.phaseAnchors.observe),
        pass: anchor(maneuver.phaseAnchors.pass),
        return: anchor(maneuver.phaseAnchors.return),
        complete: anchor(maneuver.phaseAnchors.complete),
      },
      predictedClearSeconds: maneuver.predictedClearSeconds,
      returnStandstillGapM: maneuver.returnStandstillGapM,
      returnHeadwaySeconds: maneuver.returnHeadwaySeconds,
      sourceReferenceIds: maneuver.sourceReferenceIds,
    };
  });
}

export function buildSimulationCoreConfig({
  lesson,
  mapPack,
  trafficSide,
  speedUnit,
  touchFirst = false,
}: SimulationAdapterOptions): SimulationCoreConfig {
  if (!lesson || !mapPack) {
    return {
      trafficSide,
      speedUnit: speedUnit === "mph" ? "mph" : "kmh",
      npcCount: touchFirst ? 8 : 10,
      maxForwardSpeedMps: DEFAULT_MAX_FORWARD_SPEED_MPS,
      maxReverseSpeedMps: DEFAULT_MAX_REVERSE_SPEED_MPS,
    };
  }

  const start = resolveSimulationStartPose(lesson, mapPack, trafficSide);
  const sourceLanesById = new Map(
    mapPack.laneGraph.lanes.map((lane) => [lane.id, lane]),
  );
  const lanes: SimulationLane[] = mapPack.laneGraph.lanes
    .filter((lane) => lane.centerline.length >= 2)
    .map((lane) => ({
      id: lane.id,
      points: lane.centerline,
      width: lane.widthM ?? DEFAULT_LANE_WIDTH_M,
      role: coreLaneRole(lane.role),
      kind: coreLaneKind(lane.role, lane.id),
      speedLimitMps: speedToMetresPerSecond(
        lane.speedLimit ??
          ((lane.localSpeedUnit ?? speedUnit) === "mph" ? 30 : 50),
        (lane.localSpeedUnit ?? speedUnit) === "mph" ? "mph" : "km/h",
      ),
      adjacentLaneId: adjacentLaneIdForSimulation(lane, sourceLanesById),
      successorLaneIds: lane.successors ?? [],
      loop: false,
    }));
  const checkpoints: SimulationCheckpoint[] = lesson.checkpoints.flatMap((id) => {
    const checkpoint = mapPack.laneGraph.checkpoints.find(
      (candidate) => candidate.id === id,
    );
    if (!checkpoint) return [];
    const anchored = checkpoint.anchor
      ? resolveSimulationLaneAnchor(mapPack.laneGraph.lanes, checkpoint.anchor)
      : null;
    const checkpointLane = checkpoint.anchor
      ? sourceLanesById.get(checkpoint.anchor.laneId)
      : undefined;
    if (anchored && checkpoint.anchor && checkpointLane) {
      return [{
        id: checkpoint.id,
        x: anchored.x,
        z: anchored.z,
        heading: anchored.heading,
        radius: 6,
        laneId: checkpointLane.id,
        width: checkpointLane.widthM ?? DEFAULT_LANE_WIDTH_M,
        distance: checkpoint.anchor.distanceAlongM,
      }];
    }
    return checkpoint.pose
      ? [{
          id: checkpoint.id,
          x: checkpoint.pose.position.x,
          z: checkpoint.pose.position.z,
          heading: degreesToRadians(checkpoint.pose.headingDeg),
          radius: 6,
        }]
      : [];
  });
  const routeEndLane = mapPack.laneGraph.lanes.find(
    (lane) => lane.id === lesson.route.at(-1),
  );
  const routeEnd = routeEndLane?.centerline.at(-1);
  const traffic = buildTrafficLights(mapPack);
  const stopLines = [
    ...traffic.stopLines,
    ...buildStopAndYieldLines(mapPack),
  ];
  const densityCounts = { none: 0, light: 6, moderate: 12, busy: 18 } as const;
  const configuredCount = densityCounts[lesson.trafficDensity];
  const npcCount = touchFirst ? Math.min(12, configuredCount) : configuredCount;
  const restrictions =
    lesson.kind === "free_drive" || lesson.assessedRules?.includes("restricted_lane")
      ? mapPack.laneGraph.restrictions ?? []
      : [];
  const boundsPadding = Math.max(2, mapPack.geometry.shoulderWidth ?? 0);
  const bounds = {
    minX: -mapPack.geometry.worldSize.x / 2 - boundsPadding,
    maxX: mapPack.geometry.worldSize.x / 2 + boundsPadding,
    minZ: -mapPack.geometry.worldSize.z / 2 - boundsPadding,
    maxZ: mapPack.geometry.worldSize.z / 2 + boundsPadding,
  };
  const routeLaneIds = new Set(lesson.route);
  const routeSpeedLimitMps = lanes.reduce(
    (maximum, lane) =>
      routeLaneIds.has(lane.id)
        ? Math.max(maximum, lane.speedLimitMps ?? 0)
        : maximum,
    0,
  );

  return {
    trafficSide,
    speedUnit: speedUnit === "mph" ? "mph" : "kmh",
    seed: lesson.trafficSeed,
    lessonId: lesson.id,
    lanes,
    bounds,
    spawn: { x: start.x, z: start.z, heading: start.heading },
    checkpoints,
    routeGuidance: buildRouteGuidance(lesson, mapPack),
    maneuvers: buildOvertakeExercises(lesson, mapPack),
    finish:
      lesson.kind !== "free_drive" && routeEnd
        ? { x: routeEnd.x, z: routeEnd.z, radius: 7 }
        : null,
    trafficLights: traffic.lights,
    stopLines,
    trafficGates: buildTrafficGates(mapPack),
    minRuntimeSpawnDistanceM: 70,
    scenarioClock: lesson.scenarioClock,
    scoring: SCORING_CONFIG,
    profileTransitions: (lesson.profileTransitions ?? []).map((transition) => {
      const destination = getCountryProfile(
        transition.toCountryId as Parameters<typeof getCountryProfile>[0],
      );
      return {
        checkpointId: transition.checkpointId,
        trafficSide: destination.trafficSide,
        speedUnit: destination.speedUnit,
      };
    }),
    laneRestrictions: restrictions,
    boxJunctions: buildBoxJunctions(lesson, mapPack),
    npcCount,
    // Top speed is the greater of the car's normal ceiling and the route's
    // fastest posted limit. The default already sits well above urban limits so
    // the car never feels governed; the Math.max only lifts it further on rare
    // routes posting above 70 mph, keeping any authored overtake feasible.
    maxForwardSpeedMps: Math.max(
      DEFAULT_MAX_FORWARD_SPEED_MPS,
      routeSpeedLimitMps,
    ),
    maxReverseSpeedMps: DEFAULT_MAX_REVERSE_SPEED_MPS,
  };
}

export function expectedSimulationNpcCount(
  lesson: GameCanvasLesson | undefined,
  touchFirst: boolean,
): number {
  if (!lesson) return touchFirst ? 8 : 10;
  const densityCounts = { none: 0, light: 6, moderate: 12, busy: 18 } as const;
  const configured = densityCounts[lesson.trafficDensity];
  return touchFirst ? Math.min(12, configured) : configured;
}

export function laneLengthForSimulationAdapter(lane: GameCanvasLane): number {
  return laneLength(lane);
}
