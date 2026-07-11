/**
 * Deterministic, renderer-agnostic simulation for SideSwap.
 *
 * This module deliberately has no React, DOM, audio, or Babylon dependencies.
 * Consumers provide normalized inputs and render the serializable snapshots.
 */
import type {
  Gear,
  LaneRestriction,
  RestrictionWindow,
  RuleCode,
  RuleEvent,
  ScenarioClock,
  SpeedUnit,
  TrafficSide,
} from "./types";

export const SIMULATION_HZ = 60;
export const FIXED_STEP_SECONDS = 1 / SIMULATION_HZ;

const TRAFFIC_DECISION_SECONDS = 0.1;
const MAX_FRAME_SECONDS = 0.25;
const PLAYER_RADIUS_METRES = 1.05;
const NPC_RADIUS_METRES = 1.0;
const STOPPED_SPEED_MPS = 0.2;
const MAX_EVENT_HISTORY = 80;
const DEFAULT_HONK_CAPTION =
  "A driver is asking you to leave the passing lane when it is safe — never speed up beyond the limit.";

export type SimulationRuleEvent = RuleEvent;
export type SimulationStatus =
  | "running"
  | "paused"
  | "incident"
  | "complete"
  | "disposed";
export type TurnSignal = "off" | "left" | "right";
export type LaneRole = "travel" | "passing" | "entry" | "exit";
export type LaneKind = "road" | "roundabout" | "merge";
export type NpcDrivingState =
  | "cruising"
  | "following"
  | "stopping"
  | "yielding"
  | "signaling"
  | "roundabout"
  | "merging"
  | "lane-changing"
  | "recovering";
export type TrafficLightState = "green" | "amber" | "red";

export interface SimulationPoint {
  readonly x: number;
  readonly z: number;
}

export interface SimulationPose extends SimulationPoint {
  /** Radians, with zero pointing toward positive Z. */
  readonly heading: number;
}

export interface SimulationLane {
  readonly id: string;
  /** Points are ordered in the legal direction of travel. */
  readonly points: readonly SimulationPoint[];
  readonly width?: number;
  readonly role?: LaneRole;
  readonly kind?: LaneKind;
  readonly speedLimitMps?: number;
  readonly adjacentLaneId?: string;
  readonly loop?: boolean;
}

export interface SimulationBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface SimulationCheckpoint extends SimulationPose {
  readonly id: string;
  readonly radius?: number;
}

export interface TrafficLightCycle {
  readonly greenSeconds: number;
  readonly amberSeconds: number;
  readonly redSeconds: number;
  readonly offsetSeconds?: number;
}

export interface TrafficLightDefinition extends SimulationPoint {
  readonly id: string;
  readonly cycle?: Partial<TrafficLightCycle>;
}

export interface StopLineDefinition {
  readonly id: string;
  readonly laneId: string;
  /** Distance in metres from the beginning of the lane. */
  readonly distance: number;
  readonly kind: "traffic_light" | "stop" | "yield";
  readonly trafficLightId?: string;
  readonly turnDirection?: Exclude<TurnSignal, "off">;
  readonly conflictRadius?: number;
}

/** A renderer-neutral box-junction conflict zone authored in world metres. */
export interface SimulationBoxJunctionDefinition {
  readonly id: string;
  readonly polygon: readonly SimulationPoint[];
  /** Lanes that pass through the box. */
  readonly laneIds: readonly string[];
  /** Lanes immediately beyond the box; defaults to `laneIds`. */
  readonly exitLaneIds?: readonly string[];
  /** How far beyond the polygon an occupied exit counts as blocked. */
  readonly exitClearanceM?: number;
}

export interface SimulationCoreConfig {
  readonly trafficSide?: TrafficSide;
  readonly speedUnit?: SpeedUnit;
  readonly seed?: number;
  readonly lessonId?: string;
  readonly lanes?: readonly SimulationLane[];
  readonly bounds?: SimulationBounds;
  readonly spawn?: SimulationPose;
  readonly checkpoints?: readonly SimulationCheckpoint[];
  readonly finish?: (SimulationPoint & { readonly radius?: number }) | null;
  readonly trafficLights?: readonly TrafficLightDefinition[];
  readonly stopLines?: readonly StopLineDefinition[];
  /** Fixed authored time used for signed, time-based restrictions. */
  readonly scenarioClock?: ScenarioClock;
  readonly laneRestrictions?: readonly LaneRestriction[];
  readonly boxJunctions?: readonly SimulationBoxJunctionDefinition[];
  readonly npcCount?: number;
  readonly maxForwardSpeedMps?: number;
  readonly maxReverseSpeedMps?: number;
}

export interface SimulationInput {
  /** Accelerator pressure from 0 to 1. */
  readonly throttle?: number;
  /** Brake pressure from 0 to 1. Braking never selects reverse. */
  readonly brake?: number;
  /** Steering from -1 (left) to 1 (right). */
  readonly steer?: number;
  /** Edge-triggered actions. Holding them does not repeatedly toggle. */
  readonly toggleGear?: boolean;
  readonly selectDrive?: boolean;
  readonly selectReverse?: boolean;
  readonly signalLeft?: boolean;
  readonly signalRight?: boolean;
  readonly cancelSignal?: boolean;
  readonly horn?: boolean;
  readonly pause?: boolean;
  readonly reset?: boolean;
  readonly acknowledgeIncident?: boolean;
}

export interface PlayerSimulationSnapshot extends SimulationPose {
  readonly speedMps: number;
  readonly signedSpeedMps: number;
  readonly gear: Gear;
  readonly signal: TurnSignal;
  readonly hornActive: boolean;
  readonly canChangeGear: boolean;
  readonly distanceTravelledM: number;
}

export interface NpcSimulationSnapshot extends SimulationPose {
  readonly id: string;
  readonly laneId: string;
  readonly speedMps: number;
  readonly state: NpcDrivingState;
  readonly signal: TurnSignal;
  readonly honking: boolean;
}

export interface TrafficLightSnapshot extends SimulationPoint {
  readonly id: string;
  readonly state: TrafficLightState;
  readonly secondsUntilChange: number;
}

export interface SimulationScoreSnapshot {
  readonly safety: number;
  readonly ruleUse: number;
  readonly vehicleControl: number;
  readonly total: number;
  readonly criticalErrors: number;
  readonly mastered: boolean;
}

export interface SimulationRoadSnapshot {
  readonly laneId: string | null;
  readonly laneRole: LaneRole | null;
  readonly distanceFromLaneCentreM: number;
  readonly speedLimitMps: number;
  readonly speedLimitDisplay: number;
  readonly onCorrectSide: boolean;
  readonly wrongWay: boolean;
  readonly offRoad: boolean;
}

export interface SimulationSnapshot {
  readonly tick: number;
  readonly elapsedMs: number;
  readonly lessonId: string;
  readonly status: SimulationStatus;
  readonly trafficSide: TrafficSide;
  readonly speedUnit: SpeedUnit;
  readonly scenarioClock: ScenarioClock | null;
  readonly speedDisplay: number;
  readonly player: PlayerSimulationSnapshot;
  readonly road: SimulationRoadSnapshot;
  readonly npcs: readonly NpcSimulationSnapshot[];
  readonly trafficLights: readonly TrafficLightSnapshot[];
  readonly score: SimulationScoreSnapshot;
  readonly checkpointId: string;
  readonly latestEvent: SimulationRuleEvent | null;
  readonly recentEvents: readonly SimulationRuleEvent[];
  readonly activeIncident: SimulationRuleEvent | null;
  readonly coachingMessage: string | null;
  readonly honk: Readonly<{
    active: boolean;
    sourceNpcId: string | null;
    caption: string | null;
  }>;
}

interface MutablePose {
  x: number;
  z: number;
  heading: number;
}

interface NormalizedLane {
  id: string;
  points: SimulationPoint[];
  width: number;
  role: LaneRole;
  kind: LaneKind;
  speedLimitMps: number;
  adjacentLaneId?: string;
  loop: boolean;
  segmentLengths: number[];
  length: number;
}

interface NormalizedTrafficLight extends SimulationPoint {
  id: string;
  cycle: TrafficLightCycle;
}

interface LaneProjection {
  lane: NormalizedLane;
  distance: number;
  distanceAlong: number;
  heading: number;
  x: number;
  z: number;
}

interface NpcInternal extends MutablePose {
  id: string;
  laneId: string;
  distance: number;
  speedMps: number;
  desiredSpeedMps: number;
  targetSpeedMps: number;
  state: NpcDrivingState;
  signal: TurnSignal;
  targetLaneId?: string;
  laneChangeProgress: number;
  signalSeconds: number;
  stoppedSeconds: number;
  decisionCooldown: number;
  previousX: number;
  previousZ: number;
}

interface ScoreState {
  safety: number;
  ruleUse: number;
  vehicleControl: number;
  criticalErrors: number;
}

interface ContinuousInput {
  throttle: number;
  brake: number;
  steer: number;
}

interface InternalConfig {
  trafficSide: TrafficSide;
  speedUnit: SpeedUnit;
  seed: number;
  lessonId: string;
  bounds: SimulationBounds;
  spawn: SimulationPose;
  checkpoints: SimulationCheckpoint[];
  finish: (SimulationPoint & { readonly radius?: number }) | null;
  scenarioClock: ScenarioClock | null;
  npcCount: number;
  maxForwardSpeedMps: number;
  maxReverseSpeedMps: number;
}

interface RoadState {
  projection: LaneProjection | null;
  wrongWay: boolean;
  offRoad: boolean;
}

type ScoreCategory = "safety" | "ruleUse" | "vehicleControl";

const RULE_COOLDOWNS: Readonly<Partial<Record<RuleCode, number>>> = {
  speeding: 8,
  following_distance: 7,
  lane_misuse: 12,
  box_junction: 10,
  restricted_lane: 12,
  missing_indicator: 5,
  incomplete_stop: 5,
  unsafe_gap: 5,
  observation: 8,
};

const CRITICAL_PENALTIES: Readonly<Record<
  "collision" | "wrong_way" | "red_light" | "out_of_bounds",
  number
>> = {
  collision: 30,
  wrong_way: 25,
  red_light: 25,
  out_of_bounds: 22,
};

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function moveTowards(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

function wrapAngle(angle: number): number {
  let wrapped = angle % (Math.PI * 2);
  if (wrapped > Math.PI) wrapped -= Math.PI * 2;
  if (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

function angleDifference(a: number, b: number): number {
  return wrapAngle(a - b);
}

function lerpAngle(a: number, b: number, amount: number): number {
  return wrapAngle(a + angleDifference(b, a) * amount);
}

function smoothStep(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function distanceSquared(a: SimulationPoint, b: SimulationPoint): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** Returns whether a signed restriction window is active at the fixed lesson time. */
export function isRestrictionWindowActive(
  clock: ScenarioClock,
  window: RestrictionWindow,
): boolean {
  if (
    !Number.isFinite(clock.minutesAfterMidnight) ||
    clock.minutesAfterMidnight < 0 ||
    clock.minutesAfterMidnight >= 24 * 60 ||
    !Number.isFinite(window.startMinutes) ||
    !Number.isFinite(window.endMinutes)
  ) {
    return false;
  }
  const start = clamp(window.startMinutes, 0, 24 * 60);
  const end = clamp(window.endMinutes, 0, 24 * 60);
  const todayIsSigned = window.weekdays.includes(clock.weekday);
  if (start === end) return todayIsSigned;
  if (start < end) {
    return todayIsSigned && clock.minutesAfterMidnight >= start && clock.minutesAfterMidnight < end;
  }

  // Overnight restrictions start on the signed weekday and remain active after
  // midnight on the following day.
  const weekdayIndex = WEEKDAYS.indexOf(clock.weekday);
  const previousWeekday = WEEKDAYS[(weekdayIndex + WEEKDAYS.length - 1) % WEEKDAYS.length];
  return (
    (todayIsSigned && clock.minutesAfterMidnight >= start) ||
    (window.weekdays.includes(previousWeekday) && clock.minutesAfterMidnight < end)
  );
}

export function isLaneRestrictionActive(
  restriction: LaneRestriction,
  clock: ScenarioClock | null | undefined,
): boolean {
  return Boolean(
    clock &&
      restriction.activeWindows.some((window) =>
        isRestrictionWindowActive(clock, window),
      ),
  );
}

/** Boundary points count as inside so entry detection is stable at 60 Hz. */
export function isPointInPolygon(
  point: SimulationPoint,
  polygon: readonly SimulationPoint[],
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const start = polygon[previous];
    const end = polygon[index];
    if (
      distanceToSegmentSquared(
        point.x,
        point.z,
        start.x,
        start.z,
        end.x,
        end.z,
      ) <= 1e-8
    ) {
      return true;
    }
    const crosses =
      (end.z > point.z) !== (start.z > point.z) &&
      point.x <
        ((start.x - end.x) * (point.z - end.z)) / (start.z - end.z) + end.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function distanceToPolygon(
  point: SimulationPoint,
  polygon: readonly SimulationPoint[],
): number {
  if (isPointInPolygon(point, polygon)) return 0;
  let bestSquared = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    bestSquared = Math.min(
      bestSquared,
      distanceToSegmentSquared(
        point.x,
        point.z,
        start.x,
        start.z,
        end.x,
        end.z,
      ),
    );
  }
  return Math.sqrt(bestSquared);
}

function distanceToSegmentSquared(
  pointX: number,
  pointZ: number,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): number {
  const dx = endX - startX;
  const dz = endZ - startZ;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= Number.EPSILON) {
    const px = pointX - startX;
    const pz = pointZ - startZ;
    return px * px + pz * pz;
  }
  const amount = clamp(
    ((pointX - startX) * dx + (pointZ - startZ) * dz) / lengthSquared,
    0,
    1,
  );
  const nearestX = startX + dx * amount;
  const nearestZ = startZ + dz * amount;
  const px = pointX - nearestX;
  const pz = pointZ - nearestZ;
  return px * px + pz * pz;
}

function normalizeSeed(seed: number | undefined): number {
  const normalized = Number.isFinite(seed) ? Math.trunc(seed as number) >>> 0 : 1;
  return normalized || 0x6d2b79f5;
}

function normalizeLane(lane: SimulationLane): NormalizedLane {
  const points = lane.points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.z))
    .map((point) => ({ x: point.x, z: point.z }));
  if (points.length < 2) {
    throw new Error(`Simulation lane "${lane.id}" needs at least two finite points.`);
  }
  const segmentLengths: number[] = [];
  let length = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const segmentLength = Math.sqrt(distanceSquared(points[index], points[index + 1]));
    segmentLengths.push(segmentLength);
    length += segmentLength;
  }
  if (length <= Number.EPSILON) {
    throw new Error(`Simulation lane "${lane.id}" has no usable length.`);
  }
  return {
    id: lane.id,
    points,
    width: clamp(lane.width ?? 3.5, 2.4, 8),
    role: lane.role ?? "travel",
    kind: lane.kind ?? "road",
    speedLimitMps: clamp(lane.speedLimitMps ?? 13.4, 2, 45),
    adjacentLaneId: lane.adjacentLaneId,
    loop: lane.loop ?? true,
    segmentLengths,
    length,
  };
}

function buildDefaultLanes(trafficSide: TrafficSide): NormalizedLane[] {
  const side = trafficSide === "right" ? 1 : -1;
  const northStart = -90;
  const northEnd = 90;
  const travelOffset = side * 5.25;
  const passingOffset = side * 1.75;
  return [
    normalizeLane({
      id: "north-travel",
      points: [
        { x: travelOffset, z: northStart },
        { x: travelOffset, z: northEnd },
      ],
      role: "travel",
      adjacentLaneId: "north-passing",
      speedLimitMps: 13.4,
    }),
    normalizeLane({
      id: "north-passing",
      points: [
        { x: passingOffset, z: northStart },
        { x: passingOffset, z: northEnd },
      ],
      role: "passing",
      adjacentLaneId: "north-travel",
      speedLimitMps: 13.4,
    }),
    normalizeLane({
      id: "south-travel",
      points: [
        { x: -travelOffset, z: northEnd },
        { x: -travelOffset, z: northStart },
      ],
      role: "travel",
      adjacentLaneId: "south-passing",
      speedLimitMps: 13.4,
    }),
    normalizeLane({
      id: "south-passing",
      points: [
        { x: -passingOffset, z: northEnd },
        { x: -passingOffset, z: northStart },
      ],
      role: "passing",
      adjacentLaneId: "south-travel",
      speedLimitMps: 13.4,
    }),
  ];
}

function normalizeTrafficLight(
  light: TrafficLightDefinition,
): NormalizedTrafficLight {
  return {
    id: light.id,
    x: light.x,
    z: light.z,
    cycle: {
      greenSeconds: clamp(light.cycle?.greenSeconds ?? 9, 1, 120),
      amberSeconds: clamp(light.cycle?.amberSeconds ?? 2, 0.5, 10),
      redSeconds: clamp(light.cycle?.redSeconds ?? 9, 1, 120),
      offsetSeconds: light.cycle?.offsetSeconds ?? 0,
    },
  };
}

/** Small deterministic PRNG whose state advances only on traffic decision ticks. */
class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = normalizeSeed(seed);
  }

  next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x1_0000_0000;
  }
}

/**
 * A fixed-step arcade driving simulation. `step` may receive render-frame delta
 * times; the core internally advances at exactly 60 Hz and makes traffic
 * decisions at exactly 10 Hz.
 */
export class SimulationCore {
  readonly fixedStepSeconds = FIXED_STEP_SECONDS;

  private readonly config: InternalConfig;
  private readonly lanes: NormalizedLane[];
  private readonly lanesById: Map<string, NormalizedLane>;
  private readonly trafficLights: NormalizedTrafficLight[];
  private readonly trafficLightsById: Map<string, NormalizedTrafficLight>;
  private readonly stopLines: StopLineDefinition[];
  private readonly laneRestrictions: LaneRestriction[];
  private readonly boxJunctions: SimulationBoxJunctionDefinition[];
  private readonly initialSeed: number;

  private random: SeededRandom;
  private player: MutablePose;
  private signedSpeedMps = 0;
  private gear: Gear = "drive";
  private signal: TurnSignal = "off";
  private signalStartHeading = 0;
  private signalAutoCancelSeconds = 0;
  private continuousInput: ContinuousInput = { throttle: 0, brake: 0, steer: 0 };
  private previousActions: Record<string, boolean> = {};
  private accumulatorSeconds = 0;
  private trafficDecisionAccumulator = 0;
  private elapsedSeconds = 0;
  private tick = 0;
  private status: SimulationStatus = "running";
  private disposed = false;
  private npcs: NpcInternal[] = [];
  private score: ScoreState = {
    safety: 100,
    ruleUse: 100,
    vehicleControl: 100,
    criticalErrors: 0,
  };
  private events: SimulationRuleEvent[] = [];
  private eventCounter = 0;
  private activeIncident: SimulationRuleEvent | null = null;
  private latestEvent: SimulationRuleEvent | null = null;
  private transientCoach: string | null = null;
  private transientCoachSeconds = 0;
  private ruleCooldowns = new Map<RuleCode, number>();
  private roadState: RoadState = {
    projection: null,
    wrongWay: false,
    offRoad: false,
  };
  private currentCheckpoint: SimulationCheckpoint;
  private reachedCheckpoints = new Set<string>();
  private distanceTravelledM = 0;
  private wrongWaySeconds = 0;
  private offRoadSeconds = 0;
  private speedingSeconds = 0;
  private followingSeconds = 0;
  private passingLaneSeconds = 0;
  private unstableControlSeconds = 0;
  private honkSeconds = 0;
  private honkSourceNpcId: string | null = null;
  private playerHornSeconds = 0;
  private stopApproachSpeeds = new Map<string, number>();
  private restrictedLaneSeconds = new Map<string, number>();

  constructor(configuration: SimulationCoreConfig = {}) {
    const trafficSide = configuration.trafficSide ?? "right";
    this.lanes = configuration.lanes?.length
      ? configuration.lanes.map(normalizeLane)
      : buildDefaultLanes(trafficSide);
    this.lanesById = new Map(this.lanes.map((lane) => [lane.id, lane]));

    const defaultSpawnLane =
      this.lanes.find((lane) => lane.role === "travel") ?? this.lanes[0];
    const defaultSpawn = this.pointOnLane(defaultSpawnLane, 15);
    const spawn: SimulationPose = configuration.spawn
      ? {
          x: configuration.spawn.x,
          z: configuration.spawn.z,
          heading: wrapAngle(configuration.spawn.heading),
        }
      : defaultSpawn;
    const initialCheckpoint: SimulationCheckpoint = {
      id: "start",
      x: spawn.x,
      z: spawn.z,
      heading: spawn.heading,
      radius: 3,
    };
    const checkpoints = [
      initialCheckpoint,
      ...(configuration.checkpoints ?? [])
        .filter((checkpoint) => checkpoint.id !== "start")
        .map((checkpoint) => ({ ...checkpoint })),
    ];

    const defaultBounds = this.boundsForLanes(this.lanes);
    this.initialSeed = normalizeSeed(configuration.seed);
    this.config = {
      trafficSide,
      speedUnit: configuration.speedUnit ?? "mph",
      seed: this.initialSeed,
      lessonId: configuration.lessonId ?? "free-drive",
      bounds: configuration.bounds ?? defaultBounds,
      spawn,
      checkpoints,
      finish: configuration.finish ?? null,
      scenarioClock: configuration.scenarioClock
        ? { ...configuration.scenarioClock }
        : null,
      npcCount: Math.trunc(clamp(configuration.npcCount ?? 10, 0, 32)),
      maxForwardSpeedMps: clamp(configuration.maxForwardSpeedMps ?? 22, 5, 50),
      maxReverseSpeedMps: clamp(configuration.maxReverseSpeedMps ?? 7, 2, 15),
    };

    const defaultLights: TrafficLightDefinition[] = [
      {
        id: "north-signal",
        x: defaultSpawnLane.points[0].x,
        z: -5,
        cycle: { offsetSeconds: 0 },
      },
      {
        id: "south-signal",
        x: -defaultSpawnLane.points[0].x,
        z: 5,
        cycle: { offsetSeconds: 11 },
      },
    ];
    this.trafficLights = (
      configuration.trafficLights ?? (configuration.lanes ? [] : defaultLights)
    ).map(normalizeTrafficLight);
    this.trafficLightsById = new Map(
      this.trafficLights.map((light) => [light.id, light]),
    );

    const northLane = this.lanesById.get("north-travel");
    const southLane = this.lanesById.get("south-travel");
    const defaultStopLines: StopLineDefinition[] = [];
    if (northLane) {
      defaultStopLines.push({
        id: "north-signal-line",
        laneId: northLane.id,
        distance: clamp(85, 1, northLane.length - 1),
        kind: "traffic_light",
        trafficLightId: "north-signal",
      });
    }
    if (southLane) {
      defaultStopLines.push({
        id: "south-signal-line",
        laneId: southLane.id,
        distance: clamp(85, 1, southLane.length - 1),
        kind: "traffic_light",
        trafficLightId: "south-signal",
      });
    }
    this.stopLines = (configuration.stopLines ?? defaultStopLines)
      .filter((line) => this.lanesById.has(line.laneId))
      .map((line) => ({ ...line }));
    this.laneRestrictions = (configuration.laneRestrictions ?? [])
      .filter((restriction) => this.lanesById.has(restriction.laneId))
      .map((restriction) => ({
        ...restriction,
        activeWindows: restriction.activeWindows.map((window) => ({
          ...window,
          weekdays: [...window.weekdays],
        })),
      }));
    this.boxJunctions = (configuration.boxJunctions ?? [])
      .filter(
        (junction) =>
          junction.polygon.length >= 3 &&
          junction.laneIds.some((laneId) => this.lanesById.has(laneId)),
      )
      .map((junction) => ({
        ...junction,
        polygon: junction.polygon.map((point) => ({ ...point })),
        laneIds: junction.laneIds.filter((laneId) => this.lanesById.has(laneId)),
        exitLaneIds: (junction.exitLaneIds ?? junction.laneIds).filter((laneId) =>
          this.lanesById.has(laneId),
        ),
        exitClearanceM: clamp(junction.exitClearanceM ?? 12, 3, 40),
      }));

    this.random = new SeededRandom(this.initialSeed);
    this.player = { ...spawn };
    this.currentCheckpoint = initialCheckpoint;
    this.reset();
  }

  /** Advances the simulation and returns the post-step serializable snapshot. */
  step(deltaSeconds: number, input: SimulationInput = {}): SimulationSnapshot {
    if (this.disposed) return this.getSnapshot();

    this.handleDiscreteActions(input);
    this.continuousInput = {
      throttle: clamp(input.throttle ?? 0, 0, 1),
      brake: clamp(input.brake ?? 0, 0, 1),
      steer: clamp(input.steer ?? 0, -1, 1),
    };

    if (this.status !== "running") return this.getSnapshot();
    this.accumulatorSeconds += clamp(deltaSeconds, 0, MAX_FRAME_SECONDS);
    while (
      this.accumulatorSeconds + Number.EPSILON >= FIXED_STEP_SECONDS &&
      this.status === "running"
    ) {
      this.fixedUpdate(FIXED_STEP_SECONDS);
      this.accumulatorSeconds -= FIXED_STEP_SECONDS;
    }
    return this.getSnapshot();
  }

  /** Alias used by render loops that prefer update-style naming. */
  update(deltaSeconds: number, input: SimulationInput = {}): SimulationSnapshot {
    return this.step(deltaSeconds, input);
  }

  /** Selects the other gear, but only while the vehicle is stopped. */
  toggleGear(): boolean {
    return this.selectGear(this.gear === "drive" ? "reverse" : "drive");
  }

  selectGear(nextGear: Gear): boolean {
    if (Math.abs(this.signedSpeedMps) > STOPPED_SPEED_MPS) {
      this.showCoach("Come to a complete stop before selecting Drive or Reverse.", 3);
      return false;
    }
    this.gear = nextGear;
    this.signedSpeedMps = 0;
    this.showCoach(nextGear === "drive" ? "Drive selected." : "Reverse selected.", 1.4);
    return true;
  }

  /** Restarts the run from its initial seed, pose, traffic, score, and clock. */
  reset(): SimulationSnapshot {
    if (this.disposed) return this.getSnapshot();
    this.random = new SeededRandom(this.initialSeed);
    this.player = { ...this.config.spawn };
    this.signedSpeedMps = 0;
    this.gear = "drive";
    this.signal = "off";
    this.signalStartHeading = this.player.heading;
    this.signalAutoCancelSeconds = 0;
    this.continuousInput = { throttle: 0, brake: 0, steer: 0 };
    this.previousActions = {};
    this.accumulatorSeconds = 0;
    this.trafficDecisionAccumulator = 0;
    this.elapsedSeconds = 0;
    this.tick = 0;
    this.status = "running";
    this.score = {
      safety: 100,
      ruleUse: 100,
      vehicleControl: 100,
      criticalErrors: 0,
    };
    this.events = [];
    this.eventCounter = 0;
    this.activeIncident = null;
    this.latestEvent = null;
    this.transientCoach = null;
    this.transientCoachSeconds = 0;
    this.ruleCooldowns.clear();
    this.currentCheckpoint = this.config.checkpoints[0];
    this.reachedCheckpoints = new Set([this.currentCheckpoint.id]);
    this.distanceTravelledM = 0;
    this.wrongWaySeconds = 0;
    this.offRoadSeconds = 0;
    this.speedingSeconds = 0;
    this.followingSeconds = 0;
    this.passingLaneSeconds = 0;
    this.unstableControlSeconds = 0;
    this.honkSeconds = 0;
    this.honkSourceNpcId = null;
    this.playerHornSeconds = 0;
    this.stopApproachSpeeds.clear();
    this.restrictedLaneSeconds.clear();
    this.spawnNpcs();
    this.updateRoadState();
    return this.getSnapshot();
  }

  /** Manually records a safe recovery pose, useful for authored routes. */
  setCheckpoint(checkpoint: SimulationCheckpoint): void {
    this.currentCheckpoint = { ...checkpoint };
    this.reachedCheckpoints.add(checkpoint.id);
  }

  /** Returns to the latest checkpoint without clearing score or event history. */
  resetToCheckpoint(): void {
    this.restoreCheckpointPose();
    if (this.status !== "disposed") this.status = "running";
    this.activeIncident = null;
    this.showCoach("Returned to the last safe checkpoint.", 2.5);
  }

  setPaused(paused: boolean): void {
    if (this.disposed || this.status === "incident" || this.status === "complete") return;
    this.status = paused ? "paused" : "running";
    this.clearActiveInput();
  }

  /** Continues after the player has read a critical-incident explanation. */
  resumeAfterIncident(): void {
    if (this.status !== "incident") return;
    this.activeIncident = null;
    this.status = "running";
    this.clearActiveInput();
  }

  completeLesson(): void {
    if (!this.disposed && this.status !== "incident") {
      this.status = "complete";
      this.clearActiveInput();
    }
  }

  getEvents(): readonly SimulationRuleEvent[] {
    return this.events.slice();
  }

  /** Returns and clears queued events without changing the score. */
  drainEvents(): SimulationRuleEvent[] {
    const events = this.events.slice();
    this.events = [];
    return events;
  }

  getSnapshot(): SimulationSnapshot {
    const projection = this.roadState.projection;
    const speedLimitMps = projection?.lane.speedLimitMps ?? 0;
    const score = this.scoreSnapshot();
    const recentEvents = this.events.slice(-12).map((event) => ({
      ...event,
      evidence: { ...event.evidence },
    }));
    return {
      tick: this.tick,
      elapsedMs: Math.round(this.elapsedSeconds * 1000),
      lessonId: this.config.lessonId,
      status: this.status,
      trafficSide: this.config.trafficSide,
      speedUnit: this.config.speedUnit,
      scenarioClock: this.config.scenarioClock
        ? { ...this.config.scenarioClock }
        : null,
      speedDisplay: this.toDisplaySpeed(Math.abs(this.signedSpeedMps)),
      player: {
        x: this.player.x,
        z: this.player.z,
        heading: this.player.heading,
        speedMps: Math.abs(this.signedSpeedMps),
        signedSpeedMps: this.signedSpeedMps,
        gear: this.gear,
        signal: this.signal,
        hornActive: this.playerHornSeconds > 0,
        canChangeGear: Math.abs(this.signedSpeedMps) <= STOPPED_SPEED_MPS,
        distanceTravelledM: this.distanceTravelledM,
      },
      road: {
        laneId: projection?.lane.id ?? null,
        laneRole: projection?.lane.role ?? null,
        distanceFromLaneCentreM: projection?.distance ?? Number.MAX_SAFE_INTEGER,
        speedLimitMps,
        speedLimitDisplay: this.toDisplaySpeed(speedLimitMps),
        onCorrectSide: Boolean(projection) && !this.roadState.wrongWay && !this.roadState.offRoad,
        wrongWay: this.roadState.wrongWay,
        offRoad: this.roadState.offRoad,
      },
      npcs: this.npcs.map((npc) => ({
        id: npc.id,
        laneId: npc.laneId,
        x: npc.x,
        z: npc.z,
        heading: npc.heading,
        speedMps: npc.speedMps,
        state: npc.state,
        signal: npc.signal,
        honking: this.honkSeconds > 0 && this.honkSourceNpcId === npc.id,
      })),
      trafficLights: this.trafficLights.map((light) => {
        const timing = this.trafficLightTiming(light);
        return {
          id: light.id,
          x: light.x,
          z: light.z,
          state: timing.state,
          secondsUntilChange: timing.secondsUntilChange,
        };
      }),
      score,
      checkpointId: this.currentCheckpoint.id,
      latestEvent: this.latestEvent
        ? { ...this.latestEvent, evidence: { ...this.latestEvent.evidence } }
        : null,
      recentEvents,
      activeIncident: this.activeIncident
        ? { ...this.activeIncident, evidence: { ...this.activeIncident.evidence } }
        : null,
      coachingMessage: this.coachingMessage(),
      honk: {
        active: this.honkSeconds > 0,
        sourceNpcId: this.honkSeconds > 0 ? this.honkSourceNpcId : null,
        caption: this.honkSeconds > 0 ? DEFAULT_HONK_CAPTION : null,
      },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.status = "disposed";
    this.clearActiveInput();
    this.npcs = [];
    this.ruleCooldowns.clear();
    this.stopApproachSpeeds.clear();
    this.restrictedLaneSeconds.clear();
  }

  private fixedUpdate(deltaSeconds: number): void {
    this.tick += 1;
    this.elapsedSeconds += deltaSeconds;
    this.updateTimers(deltaSeconds);

    const oldPlayer = { ...this.player };
    const previousProjection = this.projectToRoad(oldPlayer.x, oldPlayer.z);
    this.movePlayer(deltaSeconds);

    this.trafficDecisionAccumulator += deltaSeconds;
    while (this.trafficDecisionAccumulator + Number.EPSILON >= TRAFFIC_DECISION_SECONDS) {
      this.makeTrafficDecisions();
      this.trafficDecisionAccumulator -= TRAFFIC_DECISION_SECONDS;
    }
    this.moveNpcs(deltaSeconds);
    this.updateRoadState();

    if (this.status !== "running") return;
    this.checkBoxJunctions(oldPlayer);
    this.monitorRestrictedLanes(deltaSeconds);
    this.checkStopLines(previousProjection, this.roadState.projection);
    if (this.status !== "running") return;
    this.monitorRoadRules(deltaSeconds);
    if (this.status !== "running") return;
    this.checkCollisions(oldPlayer);
    if (this.status !== "running") return;
    this.updateCheckpointProgress();
    this.checkFinish();
  }

  private handleDiscreteActions(input: SimulationInput): void {
    const action = (key: keyof SimulationInput): boolean => {
      const active = Boolean(input[key]);
      const edge = active && !this.previousActions[key];
      this.previousActions[key] = active;
      return edge;
    };

    if (action("acknowledgeIncident")) this.resumeAfterIncident();
    if (action("reset")) this.resetToCheckpoint();
    if (action("pause")) {
      if (this.status === "running") this.setPaused(true);
      else if (this.status === "paused") this.setPaused(false);
    }
    if (action("selectDrive")) this.selectGear("drive");
    if (action("selectReverse")) this.selectGear("reverse");
    if (action("toggleGear")) this.toggleGear();
    if (action("signalLeft")) this.setSignal(this.signal === "left" ? "off" : "left");
    if (action("signalRight")) this.setSignal(this.signal === "right" ? "off" : "right");
    if (action("cancelSignal")) this.setSignal("off");
    if (action("horn")) this.playerHornSeconds = 0.35;
  }

  private setSignal(signal: TurnSignal): void {
    this.signal = signal;
    this.signalStartHeading = this.player.heading;
    this.signalAutoCancelSeconds = 0;
  }

  private clearActiveInput(): void {
    this.continuousInput = { throttle: 0, brake: 0, steer: 0 };
    this.accumulatorSeconds = 0;
  }

  private movePlayer(deltaSeconds: number): void {
    const throttle = this.continuousInput.throttle;
    const brake = this.continuousInput.brake;
    const direction = this.gear === "drive" ? 1 : -1;

    if (brake > 0) {
      this.signedSpeedMps = moveTowards(
        this.signedSpeedMps,
        0,
        (3 + brake * 8.5) * deltaSeconds,
      );
    } else {
      const acceleration = direction > 0 ? 5.6 : 4.1;
      this.signedSpeedMps += direction * throttle * acceleration * deltaSeconds;
      const drag = 0.25 + Math.abs(this.signedSpeedMps) * 0.035;
      this.signedSpeedMps = moveTowards(
        this.signedSpeedMps,
        0,
        drag * deltaSeconds,
      );
    }

    this.signedSpeedMps = clamp(
      this.signedSpeedMps,
      -this.config.maxReverseSpeedMps,
      this.config.maxForwardSpeedMps,
    );
    if (Math.abs(this.signedSpeedMps) < 0.015 && throttle === 0) {
      this.signedSpeedMps = 0;
    }

    const absoluteSpeed = Math.abs(this.signedSpeedMps);
    if (absoluteSpeed > 0.04) {
      const steeringAuthority = Math.min(1, absoluteSpeed / 5.5);
      const reverseSteering = this.signedSpeedMps < 0 ? -1 : 1;
      this.player.heading = wrapAngle(
        this.player.heading +
          this.continuousInput.steer *
            reverseSteering *
            (0.32 + steeringAuthority * 0.95) *
            deltaSeconds,
      );
    }
    const travelled = this.signedSpeedMps * deltaSeconds;
    this.player.x += Math.sin(this.player.heading) * travelled;
    this.player.z += Math.cos(this.player.heading) * travelled;
    this.distanceTravelledM += Math.abs(travelled);

    const lateralAcceleration =
      (Math.abs(this.continuousInput.steer) * absoluteSpeed * absoluteSpeed) / 3.1;
    if (lateralAcceleration > 11) {
      this.unstableControlSeconds += deltaSeconds;
      this.signedSpeedMps *= 1 - 0.12 * deltaSeconds;
    } else {
      this.unstableControlSeconds = Math.max(
        0,
        this.unstableControlSeconds - deltaSeconds * 2,
      );
    }
    if (this.unstableControlSeconds >= 0.7) {
      this.emitEvent({
        code: "observation",
        severity: "minor",
        message: "Your steering input was too abrupt for this speed.",
        correction: "Ease off the accelerator before making a strong steering input.",
        penalty: 4,
        category: "vehicleControl",
        evidence: { lateralAccelerationMps2: Math.round(lateralAcceleration * 10) / 10 },
      });
      this.unstableControlSeconds = 0;
    }

    if (this.signal !== "off") {
      if (Math.abs(angleDifference(this.player.heading, this.signalStartHeading)) > 0.48) {
        this.signalAutoCancelSeconds = Math.max(this.signalAutoCancelSeconds, 1.1);
      }
      if (this.signalAutoCancelSeconds > 0) {
        this.signalAutoCancelSeconds -= deltaSeconds;
        if (this.signalAutoCancelSeconds <= 0) this.setSignal("off");
      }
    }
  }

  private spawnNpcs(): void {
    this.npcs = [];
    for (let index = 0; index < this.config.npcCount; index += 1) {
      const lane = this.lanes[index % this.lanes.length];
      let laneDistance =
        (((index + 1) / (this.config.npcCount + 1)) * lane.length +
          this.random.next() * 7) %
        lane.length;
      const point = this.pointOnLane(lane, laneDistance);
      if (distanceSquared(point, this.player) < 24 * 24) {
        laneDistance = (laneDistance + Math.min(30, lane.length * 0.3)) % lane.length;
      }
      const pose = this.pointOnLane(lane, laneDistance);
      const desiredSpeedMps =
        lane.speedLimitMps * (0.68 + this.random.next() * 0.24);
      this.npcs.push({
        id: `npc-${index + 1}`,
        laneId: lane.id,
        distance: laneDistance,
        speedMps: desiredSpeedMps * 0.55,
        desiredSpeedMps,
        targetSpeedMps: desiredSpeedMps,
        state: lane.kind === "roundabout" ? "roundabout" : "cruising",
        signal: "off",
        targetLaneId: undefined,
        laneChangeProgress: 0,
        signalSeconds: 0,
        stoppedSeconds: 0,
        decisionCooldown: 4 + this.random.next() * 8,
        x: pose.x,
        z: pose.z,
        heading: pose.heading,
        previousX: pose.x,
        previousZ: pose.z,
      });
    }
  }

  private makeTrafficDecisions(): void {
    for (const npc of this.npcs) {
      const lane = this.lanesById.get(npc.laneId);
      if (!lane) continue;
      npc.decisionCooldown = Math.max(0, npc.decisionCooldown - TRAFFIC_DECISION_SECONDS);

      if (npc.state === "signaling") {
        npc.signalSeconds -= TRAFFIC_DECISION_SECONDS;
        if (npc.signalSeconds <= 0 && npc.targetLaneId) {
          npc.state = "lane-changing";
          npc.laneChangeProgress = 0;
        }
        continue;
      }

      const stoppingGap = this.redLightGapForLane(lane, npc.distance);
      const yieldGap = this.yieldGapForLane(lane, npc.distance);
      const leadGap = this.leadVehicleGap(lane, npc.distance, npc.id);
      const desiredGap = Math.max(7, npc.speedMps * 1.6);
      if (stoppingGap !== null && stoppingGap < Math.max(10, npc.speedMps * 2.2)) {
        npc.state = "stopping";
        npc.targetSpeedMps = stoppingGap < 3 ? 0 : Math.min(npc.desiredSpeedMps, stoppingGap * 0.45);
      } else if (yieldGap !== null && yieldGap < Math.max(9, npc.speedMps * 1.8)) {
        npc.state = "yielding";
        npc.targetSpeedMps = yieldGap < 2.5 ? 0 : Math.min(4, yieldGap * 0.4);
      } else if (leadGap !== null && leadGap < desiredGap) {
        npc.state = "following";
        npc.targetSpeedMps = Math.max(0, (leadGap - 3) * 0.5);
      } else if (lane.kind === "roundabout") {
        npc.state = "roundabout";
        npc.targetSpeedMps = Math.min(npc.desiredSpeedMps, 8);
      } else if (lane.kind === "merge") {
        npc.state = "merging";
        npc.targetSpeedMps = npc.desiredSpeedMps * 0.9;
      } else if (npc.state === "recovering") {
        npc.targetSpeedMps = Math.min(4, npc.desiredSpeedMps);
      } else {
        npc.state = "cruising";
        npc.targetSpeedMps = npc.desiredSpeedMps;
      }

      if (npc.speedMps < 0.1 && npc.targetSpeedMps > 0.5) {
        npc.stoppedSeconds += TRAFFIC_DECISION_SECONDS;
      } else {
        npc.stoppedSeconds = 0;
      }
      if (npc.stoppedSeconds > 7 && stoppingGap === null) {
        npc.state = "recovering";
        npc.targetSpeedMps = 3;
        npc.stoppedSeconds = 0;
      }

      const adjacent = lane.adjacentLaneId
        ? this.lanesById.get(lane.adjacentLaneId)
        : undefined;
      if (
        adjacent &&
        npc.decisionCooldown <= 0 &&
        npc.state === "cruising" &&
        this.random.next() < 0.025 &&
        this.isNpcLaneChangeClear(npc, adjacent)
      ) {
        const currentPose = this.pointOnLane(lane, npc.distance);
        const adjacentDistance = (npc.distance / lane.length) * adjacent.length;
        const targetPose = this.pointOnLane(adjacent, adjacentDistance);
        const localRightX = Math.cos(currentPose.heading);
        const localRightZ = -Math.sin(currentPose.heading);
        const side =
          (targetPose.x - currentPose.x) * localRightX +
            (targetPose.z - currentPose.z) * localRightZ >
          0
            ? "right"
            : "left";
        npc.targetLaneId = adjacent.id;
        npc.signal = side;
        npc.signalSeconds = 1.2;
        npc.state = "signaling";
        npc.decisionCooldown = 9 + this.random.next() * 7;
      }
    }
  }

  private moveNpcs(deltaSeconds: number): void {
    for (const npc of this.npcs) {
      npc.previousX = npc.x;
      npc.previousZ = npc.z;
      const deceleration = npc.targetSpeedMps < npc.speedMps ? 4.4 : 0;
      const acceleration = deceleration || 2.2;
      npc.speedMps = moveTowards(
        npc.speedMps,
        npc.targetSpeedMps,
        acceleration * deltaSeconds,
      );
      const sourceLane = this.lanesById.get(npc.laneId);
      if (!sourceLane) continue;
      npc.distance += npc.speedMps * deltaSeconds;
      if (npc.distance > sourceLane.length) {
        if (sourceLane.loop) npc.distance %= sourceLane.length;
        else npc.distance = sourceLane.length;
      }

      const sourcePose = this.pointOnLane(sourceLane, npc.distance);
      if (npc.state === "lane-changing" && npc.targetLaneId) {
        const targetLane = this.lanesById.get(npc.targetLaneId);
        if (targetLane) {
          npc.laneChangeProgress += deltaSeconds / 1.8;
          const amount = smoothStep(npc.laneChangeProgress);
          const targetDistance = (npc.distance / sourceLane.length) * targetLane.length;
          const targetPose = this.pointOnLane(targetLane, targetDistance);
          npc.x = sourcePose.x + (targetPose.x - sourcePose.x) * amount;
          npc.z = sourcePose.z + (targetPose.z - sourcePose.z) * amount;
          npc.heading = lerpAngle(sourcePose.heading, targetPose.heading, amount);
          if (npc.laneChangeProgress >= 1) {
            npc.laneId = targetLane.id;
            npc.distance = targetDistance;
            npc.targetLaneId = undefined;
            npc.laneChangeProgress = 0;
            npc.signal = "off";
            npc.state = targetLane.kind === "merge" ? "merging" : "cruising";
          }
          continue;
        }
      }
      npc.x = sourcePose.x;
      npc.z = sourcePose.z;
      npc.heading = sourcePose.heading;
    }
  }

  private monitorRoadRules(deltaSeconds: number): void {
    const projection = this.roadState.projection;
    const speed = Math.abs(this.signedSpeedMps);

    if (this.roadState.wrongWay && speed > 1.4) {
      this.wrongWaySeconds += deltaSeconds;
    } else {
      this.wrongWaySeconds = Math.max(0, this.wrongWaySeconds - deltaSeconds * 2);
    }
    if (this.wrongWaySeconds >= 2) {
      this.triggerCritical(
        "wrong_way",
        "You continued against the legal direction of traffic.",
        `Keep to the ${this.config.trafficSide} and follow the direction shown by the lane arrows.`,
        CRITICAL_PENALTIES.wrong_way,
        { sustainedSeconds: Math.round(this.wrongWaySeconds * 10) / 10 },
      );
      return;
    }

    if (this.roadState.offRoad) this.offRoadSeconds += deltaSeconds;
    else this.offRoadSeconds = Math.max(0, this.offRoadSeconds - deltaSeconds * 2);
    if (this.offRoadSeconds >= 0.8) {
      this.triggerCritical(
        "out_of_bounds",
        "The vehicle left the driveable area.",
        "Slow down, steer smoothly, and remain between the lane boundaries.",
        CRITICAL_PENALTIES.out_of_bounds,
        { offRoadSeconds: Math.round(this.offRoadSeconds * 10) / 10 },
      );
      return;
    }

    if (!projection) return;
    const speedingThreshold = Math.max(1.3, projection.lane.speedLimitMps * 0.08);
    if (speed > projection.lane.speedLimitMps + speedingThreshold) {
      this.speedingSeconds += deltaSeconds;
    } else {
      this.speedingSeconds = Math.max(0, this.speedingSeconds - deltaSeconds * 1.5);
    }
    if (this.speedingSeconds >= 2.2) {
      this.emitEvent({
        code: "speeding",
        severity: "minor",
        message: "You stayed above the posted speed limit.",
        correction: "Ease off the accelerator and return smoothly to the posted limit.",
        penalty: 4,
        category: "ruleUse",
        evidence: {
          speedMps: Math.round(speed * 10) / 10,
          limitMps: Math.round(projection.lane.speedLimitMps * 10) / 10,
        },
      });
      this.speedingSeconds = 0;
    }

    this.monitorFollowingDistance(projection, deltaSeconds);
    this.monitorPassingLane(projection, deltaSeconds);
  }

  private checkBoxJunctions(previousPlayer: SimulationPoint): void {
    const projection = this.roadState.projection;
    if (!projection || Math.abs(this.signedSpeedMps) < 0.5) return;

    for (const junction of this.boxJunctions) {
      if (!junction.laneIds.includes(projection.lane.id)) continue;
      const entered =
        !isPointInPolygon(previousPlayer, junction.polygon) &&
        isPointInPolygon(this.player, junction.polygon);
      if (!entered) continue;

      const blockingNpc = this.findBlockedBoxExit(junction, projection);
      if (!blockingNpc) continue;
      const clearance = junction.exitClearanceM ?? 12;
      this.emitEvent({
        code: "box_junction",
        severity: "minor",
        message: "You entered the yellow box before your exit was clear.",
        correction:
          "Wait before the box until there is enough room to clear it completely.",
        penalty: 6,
        category: "ruleUse",
        evidence: {
          junctionId: junction.id,
          laneId: projection.lane.id,
          blockingVehicleId: blockingNpc.id,
          exitClearanceM: Math.round(clearance * 10) / 10,
          speedMps: Math.round(Math.abs(this.signedSpeedMps) * 10) / 10,
        },
      });
    }
  }

  private findBlockedBoxExit(
    junction: SimulationBoxJunctionDefinition,
    playerProjection: LaneProjection,
  ): NpcInternal | null {
    const exitLaneIds = junction.exitLaneIds?.length
      ? junction.exitLaneIds
      : junction.laneIds;
    const clearance = junction.exitClearanceM ?? 12;
    for (const npc of this.npcs) {
      if (!exitLaneIds.includes(npc.laneId)) continue;
      if (distanceToPolygon(npc, junction.polygon) > clearance) continue;
      if (npc.laneId === playerProjection.lane.id) {
        const gap = this.distanceAhead(
          playerProjection.lane,
          playerProjection.distanceAlong,
          npc.distance,
        );
        if (gap > 0.5 && gap <= clearance + 24) return npc;
        continue;
      }
      return npc;
    }
    return null;
  }

  private monitorRestrictedLanes(deltaSeconds: number): void {
    const projection = this.roadState.projection;
    const clock = this.config.scenarioClock;
    for (const restriction of this.laneRestrictions) {
      const usingRestrictedLane =
        Boolean(clock) &&
        projection?.lane.id === restriction.laneId &&
        projection.distance <= projection.lane.width / 2 + 0.75 &&
        Math.abs(this.signedSpeedMps) >= 0.8 &&
        isLaneRestrictionActive(restriction, clock);
      const sustainedSeconds = usingRestrictedLane
        ? (this.restrictedLaneSeconds.get(restriction.id) ?? 0) + deltaSeconds
        : 0;
      this.restrictedLaneSeconds.set(restriction.id, sustainedSeconds);
      if (sustainedSeconds < 2.5 || !clock) continue;

      const activeWindow = restriction.activeWindows.find((window) =>
        isRestrictionWindowActive(clock, window),
      );
      this.emitEvent({
        code: "restricted_lane",
        severity: "minor",
        message: restriction.message,
        correction:
          "Read the signed operating times and move into a general-traffic lane when it is safe.",
        penalty: 4,
        category: "ruleUse",
        evidence: {
          restrictionId: restriction.id,
          laneId: restriction.laneId,
          weekday: clock.weekday,
          scenarioTime: clock.label,
          sourceReferenceId: restriction.sourceReferenceId,
          sustainedSeconds: 2.5,
          activeWindow: activeWindow
            ? `${activeWindow.startMinutes}-${activeWindow.endMinutes}`
            : "unknown",
        },
      });
      this.restrictedLaneSeconds.set(restriction.id, 0);
    }
  }

  private monitorFollowingDistance(
    projection: LaneProjection,
    deltaSeconds: number,
  ): void {
    const speed = Math.abs(this.signedSpeedMps);
    if (speed < 2 || projection.distance > projection.lane.width) {
      this.followingSeconds = 0;
      return;
    }
    const gap = this.leadVehicleGap(projection.lane, projection.distanceAlong);
    const safeGap = Math.max(6, speed * 1.5);
    if (gap !== null && gap < safeGap) this.followingSeconds += deltaSeconds;
    else this.followingSeconds = Math.max(0, this.followingSeconds - deltaSeconds * 2);

    if (this.followingSeconds >= 1.8 && gap !== null) {
      this.emitEvent({
        code: "following_distance",
        severity: "minor",
        message: "Your following gap became too short.",
        correction: "Brake gently and rebuild at least a two-second gap.",
        penalty: 5,
        category: "safety",
        evidence: {
          gapM: Math.round(gap * 10) / 10,
          recommendedGapM: Math.round(safeGap * 10) / 10,
        },
      });
      this.followingSeconds = 0;
    }
  }

  private monitorPassingLane(
    projection: LaneProjection,
    deltaSeconds: number,
  ): void {
    const speed = Math.abs(this.signedSpeedMps);
    const lane = projection.lane;
    const follower = this.followingNpc(lane, projection.distanceAlong);
    const adjacent = lane.adjacentLaneId
      ? this.lanesById.get(lane.adjacentLaneId)
      : undefined;
    const safeOpportunity = adjacent
      ? this.isPlayerLaneChangeClear(adjacent, projection.distanceAlong / lane.length)
      : false;
    const obstructing =
      lane.role === "passing" &&
      speed > 2 &&
      speed < lane.speedLimitMps * 0.82 &&
      follower !== null &&
      follower.gap < 34 &&
      follower.npc.speedMps > speed + 0.8 &&
      safeOpportunity;

    if (obstructing) this.passingLaneSeconds += deltaSeconds;
    else this.passingLaneSeconds = Math.max(0, this.passingLaneSeconds - deltaSeconds * 2);

    if (this.passingLaneSeconds >= 4 && follower) {
      const emitted = this.emitEvent({
        code: "lane_misuse",
        severity: "minor",
        message: "You are holding up traffic in the passing lane.",
        correction: "When the adjacent travel lane is clear, signal and move back. Do not exceed the speed limit.",
        penalty: 5,
        category: "ruleUse",
        evidence: {
          passingSide: this.config.trafficSide === "right" ? "left" : "right",
          followerGapM: Math.round(follower.gap * 10) / 10,
          safeReturnAvailable: true,
        },
      });
      if (emitted) {
        this.honkSeconds = 1.15;
        this.honkSourceNpcId = follower.npc.id;
      }
      this.passingLaneSeconds = 0;
    }
  }

  private checkStopLines(
    previousProjection: LaneProjection | null,
    currentProjection: LaneProjection | null,
  ): void {
    if (!currentProjection) return;
    const speed = Math.abs(this.signedSpeedMps);
    for (const stopLine of this.stopLines) {
      if (stopLine.laneId !== currentProjection.lane.id) continue;
      const distanceAhead = stopLine.distance - currentProjection.distanceAlong;
      if (distanceAhead >= 0 && distanceAhead <= 14) {
        const previousMinimum = this.stopApproachSpeeds.get(stopLine.id) ?? Number.POSITIVE_INFINITY;
        this.stopApproachSpeeds.set(stopLine.id, Math.min(previousMinimum, speed));
      }
      if (
        !previousProjection ||
        previousProjection.lane.id !== currentProjection.lane.id ||
        previousProjection.distanceAlong >= stopLine.distance ||
        currentProjection.distanceAlong < stopLine.distance ||
        currentProjection.distanceAlong - previousProjection.distanceAlong > 8
      ) {
        continue;
      }

      if (stopLine.kind === "traffic_light" && stopLine.trafficLightId) {
        const light = this.trafficLightsById.get(stopLine.trafficLightId);
        if (light && this.trafficLightTiming(light).state === "red") {
          this.triggerCritical(
            "red_light",
            "You entered the junction after the signal turned red.",
            "Stop before the line and wait for a green signal.",
            CRITICAL_PENALTIES.red_light,
            { trafficLightId: light.id, speedMps: Math.round(speed * 10) / 10 },
          );
          return;
        }
      } else if (stopLine.kind === "stop") {
        const minimumSpeed = this.stopApproachSpeeds.get(stopLine.id) ?? speed;
        if (minimumSpeed > 0.35) {
          this.emitEvent({
            code: "incomplete_stop",
            severity: "minor",
            message: "The vehicle did not come to a complete stop at the line.",
            correction: "Stop fully before the line, check for conflicts, then proceed.",
            penalty: 6,
            category: "ruleUse",
            evidence: { minimumApproachSpeedMps: Math.round(minimumSpeed * 10) / 10 },
          });
        }
      } else if (stopLine.kind === "yield") {
        const conflictRadius = stopLine.conflictRadius ?? 12;
        const linePose = this.pointOnLane(currentProjection.lane, stopLine.distance);
        const conflictingNpc = this.npcs.find(
          (npc) => distanceSquared(npc, linePose) < conflictRadius * conflictRadius,
        );
        if (conflictingNpc && speed > 1.5) {
          this.emitEvent({
            code: "unsafe_gap",
            severity: "minor",
            message: "You entered without a safe gap in traffic.",
            correction: "Reduce speed, observe the conflict area, and wait for a larger gap.",
            penalty: 7,
            category: "safety",
            evidence: { conflictingVehicleId: conflictingNpc.id, speedMps: Math.round(speed * 10) / 10 },
          });
        }
      }

      if (stopLine.turnDirection && this.signal !== stopLine.turnDirection) {
        this.emitEvent({
          code: "missing_indicator",
          severity: "minor",
          message: `You began the ${stopLine.turnDirection} turn without the correct indicator.`,
          correction: "Signal early enough for other road users to understand your intention.",
          penalty: 4,
          category: "ruleUse",
          evidence: { expectedSignal: stopLine.turnDirection, actualSignal: this.signal },
        });
      }
      this.stopApproachSpeeds.delete(stopLine.id);
    }
  }

  private checkCollisions(oldPlayer: SimulationPoint): void {
    const collisionRadius = PLAYER_RADIUS_METRES + NPC_RADIUS_METRES;
    for (const npc of this.npcs) {
      const relativeOldX = oldPlayer.x - npc.previousX;
      const relativeOldZ = oldPlayer.z - npc.previousZ;
      const relativeNewX = this.player.x - npc.x;
      const relativeNewZ = this.player.z - npc.z;
      const sweptDistanceSquared = distanceToSegmentSquared(
        0,
        0,
        relativeOldX,
        relativeOldZ,
        relativeNewX,
        relativeNewZ,
      );
      if (sweptDistanceSquared < collisionRadius * collisionRadius) {
        this.triggerCritical(
          "collision",
          "Your vehicle collided with another road user.",
          "Brake earlier, keep a safe gap, and check the space around the vehicle.",
          CRITICAL_PENALTIES.collision,
          { vehicleId: npc.id, impactSpeedMps: Math.round(Math.abs(this.signedSpeedMps) * 10) / 10 },
        );
        return;
      }
    }
  }

  private updateRoadState(): void {
    const projection = this.projectToRoad(this.player.x, this.player.z);
    const withinBounds =
      this.player.x >= this.config.bounds.minX &&
      this.player.x <= this.config.bounds.maxX &&
      this.player.z >= this.config.bounds.minZ &&
      this.player.z <= this.config.bounds.maxZ;
    if (!projection) {
      this.roadState = { projection: null, wrongWay: false, offRoad: true };
      return;
    }
    const effectiveHeading =
      this.signedSpeedMps < -STOPPED_SPEED_MPS
        ? wrapAngle(this.player.heading + Math.PI)
        : this.player.heading;
    const wrongWay =
      Math.abs(this.signedSpeedMps) > 1.2 &&
      Math.abs(angleDifference(effectiveHeading, projection.heading)) > Math.PI / 2;
    const allowedDistance = projection.lane.width / 2 + 2.1;
    this.roadState = {
      projection,
      wrongWay,
      offRoad: !withinBounds || projection.distance > allowedDistance,
    };
  }

  private projectToRoad(x: number, z: number): LaneProjection | null {
    let best: LaneProjection | null = null;
    for (const lane of this.lanes) {
      let accumulated = 0;
      for (let index = 0; index < lane.points.length - 1; index += 1) {
        const start = lane.points[index];
        const end = lane.points[index + 1];
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const lengthSquared = dx * dx + dz * dz;
        const amount =
          lengthSquared > Number.EPSILON
            ? clamp(((x - start.x) * dx + (z - start.z) * dz) / lengthSquared, 0, 1)
            : 0;
        const nearestX = start.x + dx * amount;
        const nearestZ = start.z + dz * amount;
        const offsetX = x - nearestX;
        const offsetZ = z - nearestZ;
        const distance = Math.sqrt(offsetX * offsetX + offsetZ * offsetZ);
        if (!best || distance < best.distance) {
          best = {
            lane,
            distance,
            distanceAlong: accumulated + lane.segmentLengths[index] * amount,
            heading: Math.atan2(dx, dz),
            x: nearestX,
            z: nearestZ,
          };
        }
        accumulated += lane.segmentLengths[index];
      }
    }
    return best;
  }

  private pointOnLane(lane: NormalizedLane, rawDistance: number): SimulationPose {
    let distance = rawDistance;
    if (lane.loop) {
      distance = ((distance % lane.length) + lane.length) % lane.length;
    } else {
      distance = clamp(distance, 0, lane.length);
    }
    let accumulated = 0;
    for (let index = 0; index < lane.segmentLengths.length; index += 1) {
      const segmentLength = lane.segmentLengths[index];
      if (distance <= accumulated + segmentLength || index === lane.segmentLengths.length - 1) {
        const amount = segmentLength > 0 ? (distance - accumulated) / segmentLength : 0;
        const start = lane.points[index];
        const end = lane.points[index + 1];
        return {
          x: start.x + (end.x - start.x) * clamp(amount, 0, 1),
          z: start.z + (end.z - start.z) * clamp(amount, 0, 1),
          heading: Math.atan2(end.x - start.x, end.z - start.z),
        };
      }
      accumulated += segmentLength;
    }
    const final = lane.points[lane.points.length - 1];
    return { x: final.x, z: final.z, heading: 0 };
  }

  private distanceAhead(lane: NormalizedLane, from: number, to: number): number {
    const direct = to - from;
    if (direct >= 0) return direct;
    return lane.loop ? direct + lane.length : Number.POSITIVE_INFINITY;
  }

  private leadVehicleGap(
    lane: NormalizedLane,
    distance: number,
    excludedNpcId?: string,
  ): number | null {
    let best = Number.POSITIVE_INFINITY;
    for (const npc of this.npcs) {
      if (npc.id === excludedNpcId || npc.laneId !== lane.id) continue;
      const gap = this.distanceAhead(lane, distance, npc.distance);
      if (gap > 0.1 && gap < best) best = gap;
    }
    const playerProjection = this.roadState.projection;
    if (
      excludedNpcId &&
      playerProjection?.lane.id === lane.id &&
      playerProjection.distance < lane.width
    ) {
      const playerGap = this.distanceAhead(lane, distance, playerProjection.distanceAlong);
      if (playerGap > 0.1 && playerGap < best) best = playerGap;
    }
    return Number.isFinite(best) ? best : null;
  }

  private followingNpc(
    lane: NormalizedLane,
    playerDistance: number,
  ): { npc: NpcInternal; gap: number } | null {
    let result: { npc: NpcInternal; gap: number } | null = null;
    for (const npc of this.npcs) {
      if (npc.laneId !== lane.id) continue;
      const gap = this.distanceAhead(lane, npc.distance, playerDistance);
      if (gap <= 0.1 || gap > lane.length * 0.5) continue;
      if (!result || gap < result.gap) result = { npc, gap };
    }
    return result;
  }

  private redLightGapForLane(
    lane: NormalizedLane,
    distance: number,
  ): number | null {
    let best = Number.POSITIVE_INFINITY;
    for (const stopLine of this.stopLines) {
      if (
        stopLine.laneId !== lane.id ||
        stopLine.kind !== "traffic_light" ||
        !stopLine.trafficLightId
      ) {
        continue;
      }
      const light = this.trafficLightsById.get(stopLine.trafficLightId);
      if (!light || this.trafficLightTiming(light).state === "green") continue;
      const gap = this.distanceAhead(lane, distance, stopLine.distance);
      if (gap < best) best = gap;
    }
    return Number.isFinite(best) ? best : null;
  }

  private yieldGapForLane(
    lane: NormalizedLane,
    distance: number,
  ): number | null {
    let best = Number.POSITIVE_INFINITY;
    for (const stopLine of this.stopLines) {
      if (stopLine.laneId !== lane.id || stopLine.kind !== "yield") continue;
      const linePose = this.pointOnLane(lane, stopLine.distance);
      const conflictRadius = stopLine.conflictRadius ?? 12;
      const hasConflict = this.npcs.some(
        (other) =>
          other.laneId !== lane.id &&
          distanceSquared(other, linePose) < conflictRadius * conflictRadius,
      );
      if (!hasConflict) continue;
      const gap = this.distanceAhead(lane, distance, stopLine.distance);
      if (gap < best) best = gap;
    }
    return Number.isFinite(best) ? best : null;
  }

  private isNpcLaneChangeClear(npc: NpcInternal, targetLane: NormalizedLane): boolean {
    const sourceLane = this.lanesById.get(npc.laneId);
    if (!sourceLane) return false;
    const targetDistance = (npc.distance / sourceLane.length) * targetLane.length;
    return this.npcs.every((other) => {
      if (other.id === npc.id || other.laneId !== targetLane.id) return true;
      const forward = this.distanceAhead(targetLane, targetDistance, other.distance);
      const backward = this.distanceAhead(targetLane, other.distance, targetDistance);
      return forward > 15 && backward > 11;
    });
  }

  private isPlayerLaneChangeClear(
    targetLane: NormalizedLane,
    normalizedDistance: number,
  ): boolean {
    const targetDistance = normalizedDistance * targetLane.length;
    return this.npcs.every((npc) => {
      if (npc.laneId !== targetLane.id) return true;
      const forward = this.distanceAhead(targetLane, targetDistance, npc.distance);
      const backward = this.distanceAhead(targetLane, npc.distance, targetDistance);
      return forward > 16 && backward > 13;
    });
  }

  private trafficLightTiming(light: NormalizedTrafficLight): {
    state: TrafficLightState;
    secondsUntilChange: number;
  } {
    const { greenSeconds, amberSeconds, redSeconds, offsetSeconds = 0 } = light.cycle;
    const duration = greenSeconds + amberSeconds + redSeconds;
    const phase = ((this.elapsedSeconds + offsetSeconds) % duration + duration) % duration;
    if (phase < greenSeconds) {
      return { state: "green", secondsUntilChange: greenSeconds - phase };
    }
    if (phase < greenSeconds + amberSeconds) {
      return {
        state: "amber",
        secondsUntilChange: greenSeconds + amberSeconds - phase,
      };
    }
    return { state: "red", secondsUntilChange: duration - phase };
  }

  private updateCheckpointProgress(): void {
    for (const checkpoint of this.config.checkpoints) {
      if (this.reachedCheckpoints.has(checkpoint.id)) continue;
      const radius = checkpoint.radius ?? 4;
      if (distanceSquared(checkpoint, this.player) <= radius * radius) {
        this.currentCheckpoint = { ...checkpoint };
        this.reachedCheckpoints.add(checkpoint.id);
        this.showCoach("Checkpoint reached.", 2);
      }
    }
  }

  private checkFinish(): void {
    const finish = this.config.finish;
    if (!finish) return;
    const radius = finish.radius ?? 5;
    if (distanceSquared(finish, this.player) <= radius * radius) {
      this.completeLesson();
    }
  }

  private restoreCheckpointPose(): void {
    this.player = {
      x: this.currentCheckpoint.x,
      z: this.currentCheckpoint.z,
      heading: this.currentCheckpoint.heading,
    };
    this.signedSpeedMps = 0;
    this.gear = "drive";
    this.signal = "off";
    this.signalAutoCancelSeconds = 0;
    this.accumulatorSeconds = 0;
    this.wrongWaySeconds = 0;
    this.offRoadSeconds = 0;
    this.speedingSeconds = 0;
    this.followingSeconds = 0;
    this.passingLaneSeconds = 0;
    this.stopApproachSpeeds.clear();
    this.restrictedLaneSeconds.clear();
    this.updateRoadState();
  }

  private triggerCritical(
    code: "collision" | "wrong_way" | "red_light" | "out_of_bounds",
    message: string,
    correction: string,
    penalty: number,
    evidence: Record<string, string | number | boolean>,
  ): void {
    const event = this.emitEvent({
      code,
      severity: "critical",
      message,
      correction,
      penalty,
      category: "safety",
      evidence,
      ignoreCooldown: true,
    });
    if (!event) return;
    this.score.criticalErrors += 1;
    this.activeIncident = event;
    this.status = "incident";
    this.restoreCheckpointPose();
    this.status = "incident";
    this.clearActiveInput();
  }

  private emitEvent(details: {
    code: RuleCode;
    severity: SimulationRuleEvent["severity"];
    message: string;
    correction: string;
    penalty: number;
    category: ScoreCategory;
    evidence: Record<string, string | number | boolean>;
    ignoreCooldown?: boolean;
  }): SimulationRuleEvent | null {
    if (!details.ignoreCooldown && (this.ruleCooldowns.get(details.code) ?? 0) > 0) {
      return null;
    }
    const penalty = Math.max(0, details.penalty);
    this.score[details.category] = clamp(this.score[details.category] - penalty, 0, 100);
    const event: SimulationRuleEvent = {
      id: `${this.config.lessonId}:${this.tick}:${++this.eventCounter}`,
      code: details.code,
      severity: details.severity,
      timestampMs: Math.round(this.elapsedSeconds * 1000),
      message: details.message,
      correction: details.correction,
      penalty,
      evidence: { ...details.evidence },
      checkpointId: this.currentCheckpoint.id,
    };
    this.events.push(event);
    if (this.events.length > MAX_EVENT_HISTORY) this.events.shift();
    this.latestEvent = event;
    this.ruleCooldowns.set(details.code, RULE_COOLDOWNS[details.code] ?? 2);
    return event;
  }

  private updateTimers(deltaSeconds: number): void {
    for (const [code, remaining] of this.ruleCooldowns) {
      const next = remaining - deltaSeconds;
      if (next <= 0) this.ruleCooldowns.delete(code);
      else this.ruleCooldowns.set(code, next);
    }
    this.honkSeconds = Math.max(0, this.honkSeconds - deltaSeconds);
    if (this.honkSeconds <= 0) this.honkSourceNpcId = null;
    this.playerHornSeconds = Math.max(0, this.playerHornSeconds - deltaSeconds);
    this.transientCoachSeconds = Math.max(0, this.transientCoachSeconds - deltaSeconds);
    if (this.transientCoachSeconds <= 0) this.transientCoach = null;
  }

  private showCoach(message: string, seconds: number): void {
    this.transientCoach = message;
    this.transientCoachSeconds = seconds;
  }

  private coachingMessage(): string | null {
    if (this.activeIncident) return this.activeIncident.correction;
    if (this.honkSeconds > 0) return DEFAULT_HONK_CAPTION;
    if (this.transientCoach) return this.transientCoach;
    if (
      this.latestEvent &&
      this.elapsedSeconds * 1000 - this.latestEvent.timestampMs < 7000
    ) {
      return this.latestEvent.correction;
    }
    return null;
  }

  private scoreSnapshot(): SimulationScoreSnapshot {
    const total =
      this.score.safety * 0.5 +
      this.score.ruleUse * 0.35 +
      this.score.vehicleControl * 0.15;
    return {
      safety: Math.round(this.score.safety * 10) / 10,
      ruleUse: Math.round(this.score.ruleUse * 10) / 10,
      vehicleControl: Math.round(this.score.vehicleControl * 10) / 10,
      total: Math.round(total * 10) / 10,
      criticalErrors: this.score.criticalErrors,
      mastered:
        this.status === "complete" && total >= 80 && this.score.criticalErrors === 0,
    };
  }

  private toDisplaySpeed(speedMps: number): number {
    const multiplier = this.config.speedUnit === "mph" ? 2.236936 : 3.6;
    return Math.round(speedMps * multiplier);
  }

  private boundsForLanes(lanes: readonly NormalizedLane[]): SimulationBounds {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const lane of lanes) {
      for (const point of lane.points) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minZ = Math.min(minZ, point.z);
        maxZ = Math.max(maxZ, point.z);
      }
    }
    return {
      minX: minX - 10,
      maxX: maxX + 10,
      minZ: minZ - 5,
      maxZ: maxZ + 5,
    };
  }
}
