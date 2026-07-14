"use client";

import {
  ArcRotateCamera,
  Camera,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  UniversalCamera,
  Vector3,
  VertexData,
  Viewport,
} from "@babylonjs/core";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  distanceToPolygon,
  isPointInPolygon,
  isRestrictionWindowActive,
  SimulationCore,
  type SimulationInput,
  type SimulationRuleEvent,
  type SimulationScoreSnapshot,
  type SimulationSnapshot,
} from "./simulation";
import { buildSimulationCoreConfig } from "./simulationAdapter";
import {
  authoredSignalAspectAt,
  authoredSignalRequiresStop,
  type AuthoredSignalAspect,
  type AuthoredSignalStyle,
} from "./trafficSignals";

export type TrafficSide = "left" | "right";
export type SteeringSide = "left" | "right";
export type CameraMode = "first" | "third";
type InputFamily = "keyboard" | "gamepad" | "touch";
export type DriveGear = "D" | "R";
export type TurnIndicator = "left" | "right" | "off";
export type SpeedUnit = "mph" | "km/h";

export interface GameHudSnapshot {
  speed: number;
  speedUnit: SpeedUnit;
  gear: DriveGear;
  cameraMode: CameraMode;
  indicator: TurnIndicator;
  score: number;
  objectiveProgress: number;
  instruction: string;
  paused: boolean;
  honking: boolean;
  rearViewVisible: boolean;
  scenarioId: string;
  scenarioTitle: string;
  objective: string;
  checkpoint: string;
  trafficSide: TrafficSide;
  scenarioClock?: string;
}

export const MIN_HORIZONTAL_FOV = (55 * Math.PI) / 180;
export const MAX_HORIZONTAL_FOV = (100 * Math.PI) / 180;
export const DEFAULT_HORIZONTAL_FOV = (72 * Math.PI) / 180;
export const MAX_STEERING_WHEEL_SPIN = 0.95;
export const COCKPIT_DASH_DRIVER_Z = 0.28;
export const PLAYER_GUIDANCE_HALF_WIDTH_M = 0.91;
export const GUIDANCE_LATERAL_CLEARANCE_M = 0.3;
export const WORLD_LAYER_MASK = 0x0fffffff;
export const GUIDANCE_LAYER_MASK = 0x10000000;
export const PRIMARY_CAMERA_LAYER_MASK = WORLD_LAYER_MASK | GUIDANCE_LAYER_MASK;

/** Keeps a checkpoint target wholly inside its authored lane. */
export function resolveCheckpointTargetWidth(laneWidthM: number): number {
  return Math.max(0, Math.min(2.4, laneWidthM - 0.6));
}

/** Keeps each chevron, including its stroke, inside the guidance envelope. */
export function resolveRouteChevronHalfSpan(laneWidthM: number): number {
  return Math.max(0.32, Math.min(0.72, (laneWidthM - 0.8) / 2 - 0.12));
}

/**
 * Resolves the single simulation-owned route occurrence whose chevrons may be
 * rendered. Overtaking owns the guidance channel while active and suppresses
 * the normal route stream so two competing lanes are never highlighted.
 */
export function resolveAuthoritativeRouteIndex(
  routeLength: number,
  guidance: Pick<SimulationSnapshot["guidance"], "owner" | "status" | "blockingReason">,
): number | null {
  if (
    routeLength <= 0 ||
    guidance.status === "inactive" ||
    guidance.status === "complete" ||
    guidance.owner?.kind !== "route"
  ) {
    return null;
  }
  const authoritativeIndex = guidance.owner.routeIndex;
  if (
    authoritativeIndex !== null &&
    authoritativeIndex >= 0 &&
    authoritativeIndex < routeLength
  ) {
    return authoritativeIndex;
  }
  return null;
}

/** Avoids stacking an amber lane cue directly on the active cyan checkpoint. */
export function guidanceCueOverlapsCheckpoint(
  cue: Pick<NonNullable<SimulationSnapshot["guidance"]["cue"]>, "laneId" | "distanceAlongM"> | null,
  checkpoint: Pick<AuthoredCheckpoint, "laneId" | "distanceAlongM"> | null,
): boolean {
  return Boolean(
    cue &&
      checkpoint &&
      checkpoint.laneId === cue.laneId &&
      checkpoint.distanceAlongM !== null &&
      Math.abs(checkpoint.distanceAlongM - cue.distanceAlongM) <= 2.5,
  );
}

export function clampHorizontalFieldOfView(value: number): number {
  return clamp(value, MIN_HORIZONTAL_FOV, MAX_HORIZONTAL_FOV);
}

export function resolveCockpitPitch(viewportAspectRatio: number): number {
  const wideBlend = clamp((viewportAspectRatio - 1.6) / 0.4, 0, 1);
  return 0.1 + wideBlend * 0.02;
}

/** Returns rotation around the wheel's own steering-column axis. */
export function resolveSteeringWheelSpin(steer: number): number {
  if (steer === 0) return 0;
  return -clamp(steer, -1, 1) * MAX_STEERING_WHEEL_SPIN;
}

export interface CockpitSteeringGeometry {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly mountRotationX: number;
  readonly wheelDiameter: number;
  readonly rimThickness: number;
}

export function resolveCockpitSteeringGeometry(
  steeringSide: SteeringSide,
): CockpitSteeringGeometry {
  return {
    x: steeringSide === "left" ? -0.47 : 0.47,
    y: 1.16,
    z: 0.22,
    mountRotationX: Math.PI / 2 + 0.2,
    wheelDiameter: 0.32,
    rimThickness: 0.027,
  };
}

export interface GameRuntimeEvent {
  type:
    | "ready"
    | "camera"
    | "gear"
    | "indicator"
    | "horn"
    | "coaching"
    | "incident"
    | "reset"
    | "complete"
    | "context-lost"
    | "context-restored";
  message: string;
  severity?: "info" | "warning" | "critical";
  timestamp: number;
  ruleCode?: string;
  penalty?: number;
  evidence?: Readonly<Record<string, string | number | boolean>>;
}

/** Structural lesson contract; existing LessonDefinition objects can be passed directly. */
export interface GameCanvasLesson {
  readonly id: string;
  readonly title: string;
  readonly kind: "orientation" | "guided" | "transition" | "free_drive";
  readonly trafficSide: TrafficSide;
  readonly startSpawnId?: string;
  readonly route: readonly string[];
  readonly objectives: readonly {
    readonly id: string;
    readonly label: string;
    readonly ruleCode?: string;
  }[];
  readonly trafficSeed: number;
  readonly trafficDensity: "none" | "light" | "moderate" | "busy";
  readonly vulnerableRoadUsers?: Readonly<{
    pedestrians: number;
    cyclists: number;
  }>;
  readonly checkpoints: readonly string[];
  readonly coachPrompts: readonly {
    readonly id: string;
    readonly message: string;
    readonly trigger:
      | { readonly type: "start" }
      | { readonly type: "route_progress"; readonly value: number }
      | { readonly type: "checkpoint"; readonly checkpointId: string }
      | {
          readonly type: "maneuver_phase";
          readonly maneuverId: string;
          readonly phase:
            | "approach"
            | "observe"
            | "pass"
            | "establish_clearance"
            | "return"
            | "complete";
        }
      | { readonly type: "rule_event"; readonly ruleCode: string };
  }[];
  readonly assessedRules?: readonly string[];
  readonly scenarioClock?: Readonly<{
    readonly weekday: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
    readonly minutesAfterMidnight: number;
    readonly label: string;
  }>;
  readonly profileTransitions?: readonly {
    readonly checkpointId: string;
    readonly fromCountryId: string;
    readonly toCountryId: string;
    readonly message: string;
  }[];
  readonly maneuvers?: readonly {
    readonly id: string;
    readonly kind: "overtake";
    readonly normalLaneId: string;
    readonly passingLaneId: string;
    readonly corridorStart: { readonly laneId: string; readonly distanceAlongM: number };
    readonly corridorEnd: { readonly laneId: string; readonly distanceAlongM: number };
    readonly leadVehicleStart: {
      readonly laneId: string;
      readonly distanceAlongM: number;
    };
    readonly leadVehicleSpeedFactor: number;
    readonly phaseAnchors: Readonly<{
      approach: { readonly laneId: string; readonly distanceAlongM: number };
      observe: { readonly laneId: string; readonly distanceAlongM: number };
      pass: { readonly laneId: string; readonly distanceAlongM: number };
      return: { readonly laneId: string; readonly distanceAlongM: number };
      complete: { readonly laneId: string; readonly distanceAlongM: number };
    }>;
    readonly predictedClearSeconds: number;
    readonly returnStandstillGapM: number;
    readonly returnHeadwaySeconds: number;
    readonly sourceReferenceIds: readonly string[];
  }[];
}

export interface GameCanvasPoint {
  readonly x: number;
  readonly z: number;
}

export interface GameCanvasLane {
  readonly id: string;
  readonly roadId?: string;
  readonly widthM?: number;
  readonly centerline: readonly GameCanvasPoint[];
  readonly role?: string;
  readonly trafficSide?: TrafficSide;
  readonly speedLimit?: number;
  readonly localSpeedUnit?: "mph" | "kmh" | "km/h";
  readonly successors?: readonly string[];
  readonly adjacentLaneIds?: readonly string[];
  readonly connectorRanges?: readonly {
    readonly startDistanceAlongM: number;
    readonly endDistanceAlongM: number;
    readonly conflictZoneId?: string;
  }[];
}

/** Connector tapers are navigation-free junction geometry, not lane targets. */
export function isLaneGuidanceDistanceAllowed(
  lane: GameCanvasLane,
  distanceAlongM: number,
): boolean {
  return !(lane.connectorRanges ?? []).some(
    (range) =>
      distanceAlongM >= range.startDistanceAlongM - 0.05 &&
      distanceAlongM <= range.endDistanceAlongM + 0.05,
  );
}

/** Structural map contract; existing MapPack objects can be passed directly. */
export interface GameCanvasMapPack {
  readonly id: string;
  readonly name: string;
  readonly areaLabel?: string;
  readonly geometry: Readonly<{
    worldSize: GameCanvasPoint;
    roadWidth: number;
    shoulderWidth?: number;
    roadSurfaces?: readonly {
      readonly id: string;
      readonly centerline: readonly GameCanvasPoint[];
      readonly widthM: number;
      readonly laneIds: readonly string[];
      readonly surfaceType:
        | "standard"
        | "roundabout"
        | "shared_space"
        | "terminal"
        | "orientation";
      readonly markings: readonly {
        readonly id: string;
        readonly style:
          | "centre_dashed"
          | "centre_solid"
          | "lane_dashed"
          | "lane_solid"
          | "edge_solid"
          | "give_way"
          | "box_junction";
        readonly points: readonly GameCanvasPoint[];
        readonly color?: "white" | "yellow";
      }[];
    }[];
    blocks: readonly {
      readonly id: string;
      readonly center: GameCanvasPoint;
      readonly size: GameCanvasPoint;
      readonly heightRange: readonly [number, number];
      readonly density: number;
      readonly material: string;
    }[];
    landmarks: readonly {
      readonly id: string;
      readonly kind: string;
      readonly center: GameCanvasPoint;
      readonly size: GameCanvasPoint;
      readonly color: string;
    }[];
  }>;
  readonly laneGraph: Readonly<{
    lanes: readonly GameCanvasLane[];
    controls: readonly {
      readonly id: string;
      readonly type: string;
      readonly position: GameCanvasPoint;
      readonly headingDeg: number;
      readonly laneIds: readonly string[];
      readonly conflictZoneIds?: readonly string[];
      readonly approaches?: readonly {
        readonly id: string;
        readonly laneIds: readonly string[];
        readonly stopLine: {
          readonly laneId: string;
          readonly distanceAlongM: number;
        };
        readonly conflictZoneIds?: readonly string[];
        readonly phaseGroup: string;
      }[];
      readonly installations?: readonly {
        readonly id: string;
        readonly position: GameCanvasPoint;
        readonly headingDeg: number;
        readonly armHeadingDeg?: number;
        readonly mounting:
          | "roadside_pole"
          | "mast_arm"
          | "secondary_pole"
          | "railway_crossing"
          | "road_marking"
          | "terminal_portal";
        readonly style:
          | "nyc_signal"
          | "uk_signal"
          | "stop_sign"
          | "yield_sign"
          | "restricted_lane"
          | "crosswalk"
          | "box_junction"
          | "japan_railway"
          | "side_swap_gate";
        readonly role: "primary" | "secondary" | "companion" | "warning" | "marking";
        readonly approachIds?: readonly string[];
      }[];
    }[];
    conflictZones: readonly {
      readonly id: string;
      readonly laneIds: readonly string[];
      readonly polygon: readonly GameCanvasPoint[];
    }[];
    restrictions?: readonly {
      readonly id: string;
      readonly laneId: string;
      readonly ruleCode: "restricted_lane";
      readonly activeWindows: readonly {
        readonly weekdays: readonly (
          | "mon"
          | "tue"
          | "wed"
          | "thu"
          | "fri"
          | "sat"
          | "sun"
        )[];
        readonly startMinutes: number;
        readonly endMinutes: number;
      }[];
      readonly sourceReferenceId: string;
      readonly message: string;
    }[];
    spawnPoints: readonly (
      | {
          readonly id: string;
          readonly kind: "player" | "vehicle";
          readonly anchor: {
            readonly laneId: string;
            readonly distanceAlongM: number;
          };
          /** Legacy map compatibility during the v1 map migration. */
          readonly pose?: {
            readonly position: GameCanvasPoint;
            readonly headingDeg: number;
          };
          readonly laneId?: string;
        }
      | {
          readonly id: string;
          readonly kind: "pedestrian" | "cyclist";
          readonly pose: {
            readonly position: GameCanvasPoint;
            readonly headingDeg: number;
          };
          readonly laneId?: string;
          readonly anchor?: never;
        }
      | {
          readonly id: string;
          readonly kind: "player" | "vehicle";
          readonly pose: {
            readonly position: GameCanvasPoint;
            readonly headingDeg: number;
          };
          readonly laneId?: string;
          readonly anchor?: never;
        }
    )[];
    checkpoints: readonly {
      readonly id: string;
      readonly label: string;
      readonly anchor?: {
        readonly laneId: string;
        readonly distanceAlongM: number;
      };
      readonly pose?: {
        readonly position: GameCanvasPoint;
        readonly headingDeg: number;
      };
      readonly laneId?: string;
    }[];
  }>;
}

type GameCanvasTrafficControl = GameCanvasMapPack["laneGraph"]["controls"][number];
type GameCanvasTrafficControlApproach = NonNullable<
  GameCanvasTrafficControl["approaches"]
>[number];

export interface GameCanvasProps {
  trafficSide: TrafficSide;
  steeringSide: SteeringSide;
  /** Selected authored lesson. Pass the domain LessonDefinition directly. */
  lesson?: GameCanvasLesson;
  /** Selected authored map. Pass the domain MapPack directly. */
  mapPack?: GameCanvasMapPack;
  cameraMode?: CameraMode;
  speedUnit?: SpeedUnit;
  paused?: boolean;
  reducedMotion?: boolean;
  steeringSensitivity?: number;
  fieldOfView?: number;
  masterVolume?: number;
  effectsVolume?: number;
  coachVolume?: number;
  cameraShake?: boolean;
  headBob?: boolean;
  visualHonkIndicator?: boolean;
  className?: string;
  style?: CSSProperties;
  showBuiltInHud?: boolean;
  onHudUpdate?: (snapshot: GameHudSnapshot) => void;
  onEvent?: (event: GameRuntimeEvent) => void;
  onPauseChange?: (paused: boolean) => void;
  onCameraChange?: (mode: CameraMode) => void;
  onComplete?: (score: SimulationScoreSnapshot) => void;
}

export interface GameCanvasHandle {
  reset: () => void;
  toggleCamera: () => void;
  togglePause: () => void;
  horn: () => void;
  setGear: (gear: DriveGear) => void;
  setIndicator: (indicator: TurnIndicator) => void;
  focus: () => void;
}

interface SessionCallbacks {
  onHudUpdate?: (snapshot: GameHudSnapshot) => void;
  onEvent?: (event: GameRuntimeEvent) => void;
  onPauseChange?: (paused: boolean) => void;
  onCameraChange?: (mode: CameraMode) => void;
  onInputPresentationChange?: (presentation: AdaptiveInputPresentation) => void;
  onComplete?: (score: SimulationScoreSnapshot) => void;
  onReady?: () => void;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

interface SessionOptions {
  trafficSide: TrafficSide;
  steeringSide: SteeringSide;
  cameraMode: CameraMode;
  inputCapabilities: InputCapabilities;
  speedUnit: SpeedUnit;
  paused: boolean;
  reducedMotion: boolean;
  steeringSensitivity: number;
  fieldOfView: number;
  masterVolume: number;
  effectsVolume: number;
  coachVolume: number;
  cameraShake: boolean;
  headBob: boolean;
  lesson?: GameCanvasLesson;
  mapPack?: GameCanvasMapPack;
}

interface AnalogInput {
  throttle: number;
  brake: number;
  steer: number;
  quickLook: number;
}

interface PlayerState {
  x: number;
  z: number;
  previousX: number;
  previousZ: number;
  heading: number;
  speedMps: number;
  gear: DriveGear;
  indicator: TurnIndicator;
}

interface NpcPathSegment {
  readonly laneId: string;
  readonly start: GameCanvasPoint;
  readonly end: GameCanvasPoint;
  readonly length: number;
}

interface NpcRenderSnapshot {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly active: boolean;
}

interface NpcVehicle {
  node: TransformNode;
  simulationId?: string;
  direction: 1 | -1;
  speed: number;
  z: number;
  laneX: number;
  laneId?: string;
  path?: readonly GameCanvasPoint[];
  pathSegment?: number;
  pathDistance?: number;
  pathSegments?: readonly NpcPathSegment[];
  active?: boolean;
  loop?: boolean;
  currentSpeed?: number;
  respawnAfterSeconds?: number;
  spawnIndex?: number;
  spawnPathSegment?: number;
  spawnPathDistance?: number;
}

interface Pedestrian {
  node: TransformNode;
  phase: number;
  speed: number;
  z: number;
  origin?: GameCanvasPoint;
  heading?: number;
  span?: number;
  kind?: "pedestrian" | "cyclist";
}

interface AuthoredCheckpoint {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly laneId: string | null;
  readonly laneWidthM: number;
  readonly distanceAlongM: number | null;
}

interface GuidanceVisual {
  readonly id: string;
  readonly meshes: readonly Mesh[];
  readonly dispose?: () => void;
}

interface RouteChevronVisual {
  readonly routeIndex: number;
  readonly laneId: string;
  readonly distanceAlongM: number;
  readonly meshes: readonly Mesh[];
}

interface TrafficControlMaterials {
  readonly dark: StandardMaterial;
  readonly pale: StandardMaterial;
  readonly redLamp: StandardMaterial;
  readonly amberLamp: StandardMaterial;
  readonly greenLamp: StandardMaterial;
  readonly stopRed: StandardMaterial;
  readonly yieldGold: StandardMaterial;
  readonly warningYellow: StandardMaterial;
  readonly restrictedBlue: StandardMaterial;
}

interface AuthoredSignalHeadVisual {
  readonly controlId: string;
  readonly trafficLightIds: readonly string[];
  readonly phaseGroup: string;
  readonly phaseGroups: readonly string[];
  readonly style: AuthoredSignalStyle;
  readonly redMaterial: StandardMaterial;
  readonly amberMaterial: StandardMaterial;
  readonly greenMaterial: StandardMaterial;
}

interface RailwayCrossingVisual {
  readonly trafficLightIds: readonly string[];
  readonly lampMaterials: readonly StandardMaterial[];
  readonly barrierPivot: TransformNode;
}

interface RouteProjection {
  readonly segmentIndex: number;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly distance: number;
  readonly distanceAlong: number;
}

interface ScenarioLaneProjection extends RouteProjection {
  readonly laneId: string;
  readonly speedLimit?: number;
}

const FIXED_STEP = 1 / 60;
const START_Z = -52;
const FINISH_Z = 72;
const LANE_CENTER = 2.75;

export const INPUT_PROMPT_SWITCH_COOLDOWN_MS = 750;
export const TOUCH_CONTROL_DIM_DELAY_MS = 1_500;

export interface InputCapabilities {
  readonly touchFirst: boolean;
  readonly hybridTouch: boolean;
}

export interface AdaptiveInputPresentation {
  readonly activeFamily: InputFamily;
  readonly touchFirst: boolean;
  readonly touchRevealed: boolean;
  readonly touchControlsDimmed: boolean;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export interface CockpitCameraPoses {
  readonly first: Readonly<{
    x: number;
    y: number;
    z: number;
    rotationX: number;
    rotationY: number;
  }>;
  readonly rear: Readonly<{
    x: number;
    y: number;
    z: number;
    rotationX: number;
    rotationY: number;
  }>;
}

export function isCameraStackActive(
  mode: CameraMode,
  activeCameraName: string | null,
  activeCameraNames: readonly string[],
): boolean {
  const mainCameraName =
    mode === "first" ? "first-person-camera" : "third-person-camera";
  const expectedCameraNames =
    mode === "first"
      ? [mainCameraName, "rear-view-camera"]
      : [mainCameraName];
  return (
    activeCameraName === mainCameraName &&
    activeCameraNames.length === expectedCameraNames.length &&
    expectedCameraNames.every((name) => activeCameraNames.includes(name))
  );
}

/**
 * Resolves cockpit cameras in world space so their movement never depends on
 * Babylon parent-transform propagation or multi-camera render ordering.
 */
export function resolveCockpitCameraPoses({
  x,
  z,
  vehicleHeading,
  cameraHeading,
  seatSide,
  headBob,
  quickLookAngle,
  viewportAspectRatio = 2,
}: {
  readonly x: number;
  readonly z: number;
  readonly vehicleHeading: number;
  readonly cameraHeading: number;
  readonly seatSide: number;
  readonly headBob: number;
  readonly quickLookAngle: number;
  readonly viewportAspectRatio?: number;
}): CockpitCameraPoses {
  const forwardX = Math.sin(vehicleHeading);
  const forwardZ = Math.cos(vehicleHeading);
  const rightX = forwardZ;
  const rightZ = -forwardX;
  return {
    first: {
      x: x + rightX * seatSide - forwardX * 0.6,
      y: 1.49 + headBob,
      z: z + rightZ * seatSide - forwardZ * 0.6,
      rotationX: resolveCockpitPitch(viewportAspectRatio),
      rotationY: cameraHeading + quickLookAngle,
    },
    rear: {
      x: x - forwardX * 0.52,
      y: 1.59,
      z: z - forwardZ * 0.52,
      rotationX: 0.04,
      rotationY: cameraHeading + Math.PI,
    },
  };
}

const eventNow = () =>
  typeof performance === "undefined" ? Date.now() : performance.now();

export function readInputCapabilities(): InputCapabilities {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return { touchFirst: false, hybridTouch: false };
  }
  const touchFirst = window.matchMedia("(pointer: coarse)").matches;
  const anyCoarsePointer = window.matchMedia("(any-pointer: coarse)").matches;
  return {
    touchFirst,
    hybridTouch: !touchFirst && anyCoarsePointer,
  };
}

export function createInitialInputPresentation(
  capabilities: InputCapabilities,
): AdaptiveInputPresentation {
  return {
    activeFamily: capabilities.touchFirst ? "touch" : "keyboard",
    touchFirst: capabilities.touchFirst,
    touchRevealed: capabilities.touchFirst,
    touchControlsDimmed: false,
  };
}

/**
 * Owns adaptive input presentation for one live drive. It never disables an
 * input method: the active family only controls the prompts and touch-overlay
 * presentation.
 */
export class AdaptiveInputRouter {
  private capabilities: InputCapabilities;
  private presentation: AdaptiveInputPresentation;
  private reducedMotion: boolean;
  private lastPromptSwitchAt = Number.NEGATIVE_INFINITY;
  private pendingFamily: InputFamily | null = null;
  private promptTimer: ReturnType<typeof setTimeout> | null = null;
  private dimTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    capabilities: InputCapabilities,
    reducedMotion: boolean,
    private readonly onPresentationChange: (
      presentation: AdaptiveInputPresentation,
    ) => void,
    private readonly now: () => number = eventNow,
  ) {
    this.capabilities = capabilities;
    this.presentation = createInitialInputPresentation(capabilities);
    this.reducedMotion = reducedMotion;
  }

  getPresentation(): AdaptiveInputPresentation {
    return this.presentation;
  }

  setCapabilities(capabilities: InputCapabilities) {
    const changed =
      capabilities.touchFirst !== this.capabilities.touchFirst ||
      capabilities.hybridTouch !== this.capabilities.hybridTouch;
    if (!changed) return;
    this.capabilities = capabilities;

    let next: AdaptiveInputPresentation = {
      ...this.presentation,
      touchFirst: capabilities.touchFirst,
    };
    if (capabilities.touchFirst && !next.touchRevealed) {
      next = { ...next, touchRevealed: true };
    }
    if (!capabilities.touchFirst && next.touchControlsDimmed) {
      this.clearDimTimer();
      next = { ...next, touchControlsDimmed: false };
    }
    if (next !== this.presentation) {
      this.presentation = next;
      this.emitPresentation();
    }
    if (capabilities.touchFirst && this.presentation.activeFamily !== "touch") {
      this.scheduleTouchDimming();
    }
  }

  setReducedMotion(reducedMotion: boolean) {
    if (this.reducedMotion === reducedMotion) return;
    this.reducedMotion = reducedMotion;
    if (reducedMotion && this.pendingFamily) {
      this.applyActiveFamily(this.pendingFamily, this.now());
    }
    if (
      reducedMotion &&
      this.capabilities.touchFirst &&
      this.presentation.activeFamily !== "touch" &&
      !this.presentation.touchControlsDimmed
    ) {
      this.clearDimTimer();
      this.presentation = { ...this.presentation, touchControlsDimmed: true };
      this.emitPresentation();
    }
  }

  registerMeaningfulInput(family: InputFamily) {
    if (this.disposed) return;
    if (family === "touch") this.revealTouchControls();

    if (family === this.presentation.activeFamily) {
      if (family === "touch") {
        this.restoreTouchControls();
      } else {
        this.scheduleTouchDimming();
      }
      return;
    }

    const now = this.now();
    const elapsed = now - this.lastPromptSwitchAt;
    if (this.reducedMotion || elapsed >= INPUT_PROMPT_SWITCH_COOLDOWN_MS) {
      this.applyActiveFamily(family, now);
      return;
    }

    this.pendingFamily = family;
    this.clearPromptTimer();
    this.promptTimer = setTimeout(() => {
      this.promptTimer = null;
      const pending = this.pendingFamily;
      this.pendingFamily = null;
      if (pending && !this.disposed) this.applyActiveFamily(pending, this.now());
    }, Math.max(0, INPUT_PROMPT_SWITCH_COOLDOWN_MS - elapsed));
  }

  handleGamepadDisconnect(): InputFamily {
    this.pendingFamily = null;
    this.clearPromptTimer();
    const fallback: InputFamily = this.capabilities.touchFirst ? "touch" : "keyboard";
    this.applyActiveFamily(fallback, this.now(), true);
    return fallback;
  }

  dispose() {
    this.disposed = true;
    this.clearPromptTimer();
    this.clearDimTimer();
  }

  private applyActiveFamily(family: InputFamily, now: number, force = false) {
    this.pendingFamily = null;
    this.clearPromptTimer();
    if (!force && family === this.presentation.activeFamily) return;

    this.lastPromptSwitchAt = now;
    this.presentation = {
      ...this.presentation,
      activeFamily: family,
      touchRevealed:
        this.presentation.touchRevealed || family === "touch" || this.capabilities.touchFirst,
    };
    if (family === "touch") {
      this.clearDimTimer();
      this.presentation = { ...this.presentation, touchControlsDimmed: false };
    } else {
      this.scheduleTouchDimming();
    }
    this.emitPresentation();
  }

  private revealTouchControls() {
    const shouldReveal = !this.presentation.touchRevealed;
    const shouldRestore = this.presentation.touchControlsDimmed || this.dimTimer !== null;
    if (!shouldReveal && !shouldRestore) return;
    this.clearDimTimer();
    this.presentation = {
      ...this.presentation,
      touchRevealed: true,
      touchControlsDimmed: false,
    };
    this.emitPresentation();
  }

  private restoreTouchControls() {
    if (!this.presentation.touchControlsDimmed && this.dimTimer === null) return;
    this.clearDimTimer();
    this.presentation = { ...this.presentation, touchControlsDimmed: false };
    this.emitPresentation();
  }

  private scheduleTouchDimming() {
    if (
      !this.capabilities.touchFirst ||
      this.presentation.activeFamily === "touch" ||
      this.presentation.touchControlsDimmed ||
      this.dimTimer !== null
    ) {
      return;
    }
    if (this.reducedMotion) {
      this.presentation = { ...this.presentation, touchControlsDimmed: true };
      this.emitPresentation();
      return;
    }
    this.dimTimer = setTimeout(() => {
      this.dimTimer = null;
      if (
        this.disposed ||
        !this.capabilities.touchFirst ||
        this.presentation.activeFamily === "touch"
      ) {
        return;
      }
      this.presentation = { ...this.presentation, touchControlsDimmed: true };
      this.emitPresentation();
    }, TOUCH_CONTROL_DIM_DELAY_MS);
  }

  private clearPromptTimer() {
    if (this.promptTimer === null) return;
    clearTimeout(this.promptTimer);
    this.promptTimer = null;
  }

  private clearDimTimer() {
    if (this.dimTimer === null) return;
    clearTimeout(this.dimTimer);
    this.dimTimer = null;
  }

  private emitPresentation() {
    if (!this.disposed) this.onPresentationChange(this.presentation);
  }
}

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

function seededUnit(seed: number) {
  let value = (Math.trunc(seed) || 1) >>> 0;
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function colorFromHex(value: string, fallback: Color3): Color3 {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
  if (!match) return fallback;
  return new Color3(
    Number.parseInt(match[1], 16) / 255,
    Number.parseInt(match[2], 16) / 255,
    Number.parseInt(match[3], 16) / 255,
  );
}

function scenarioRoutePoints(
  lesson: GameCanvasLesson | undefined,
  mapPack: GameCanvasMapPack | undefined,
): GameCanvasPoint[] {
  if (!lesson || !mapPack) return [];
  const lanes = new Map(mapPack.laneGraph.lanes.map((lane) => [lane.id, lane]));
  const points: GameCanvasPoint[] = [];
  for (const laneId of lesson.route) {
    const lane = lanes.get(laneId);
    if (!lane) continue;
    for (const point of lane.centerline) {
      const previous = points.at(-1);
      if (!previous || Math.hypot(point.x - previous.x, point.z - previous.z) > 0.01) {
        points.push({ x: point.x, z: point.z });
      }
    }
  }
  return points;
}

interface ResolvedLaneAnchor extends GameCanvasPoint {
  readonly heading: number;
  readonly segmentIndex: number;
  readonly distanceOnSegment: number;
}

interface LanePointProjection {
  readonly distance: number;
  readonly distanceAlongM: number;
  readonly heading: number;
}

function projectPointToLane(
  lane: GameCanvasLane,
  point: GameCanvasPoint,
): LanePointProjection | null {
  let accumulated = 0;
  let best: LanePointProjection | null = null;
  for (let index = 0; index < lane.centerline.length - 1; index += 1) {
    const start = lane.centerline[index];
    const end = lane.centerline[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.001) continue;
    const amount = clamp(
      ((point.x - start.x) * dx + (point.z - start.z) * dz) / (length * length),
      0,
      1,
    );
    const x = start.x + dx * amount;
    const z = start.z + dz * amount;
    const distance = Math.hypot(point.x - x, point.z - z);
    if (!best || distance < best.distance) {
      best = {
        distance,
        distanceAlongM: accumulated + length * amount,
        heading: Math.atan2(dx, dz),
      };
    }
    accumulated += length;
  }
  return best;
}

export interface CheckpointCrossingInput {
  readonly lane: GameCanvasLane;
  readonly distanceAlongM: number;
  readonly previous: GameCanvasPoint;
  readonly current: GameCanvasPoint;
}

/**
 * Requires a forward crossing while the vehicle centre is inside the authored
 * lane envelope. Merely approaching from the adjacent lane never activates it.
 */
export function isAuthoredCheckpointCrossing({
  lane,
  distanceAlongM,
  previous,
  current,
}: CheckpointCrossingInput): boolean {
  const previousProjection = projectPointToLane(lane, previous);
  const currentProjection = projectPointToLane(lane, current);
  if (!previousProjection || !currentProjection) return false;
  const lateralTolerance = Math.max(
    0.1,
    (lane.widthM ?? 3.2) / 2 -
      PLAYER_GUIDANCE_HALF_WIDTH_M -
      GUIDANCE_LATERAL_CLEARANCE_M,
  );
  if (
    previousProjection.distance > lateralTolerance ||
    currentProjection.distance > lateralTolerance
  ) {
    return false;
  }
  const crossingSlopM = 0.12;
  return (
    previousProjection.distanceAlongM < distanceAlongM - crossingSlopM &&
    currentProjection.distanceAlongM >= distanceAlongM - crossingSlopM
  );
}

function resolveLaneAnchor(
  lanes: readonly GameCanvasLane[],
  anchor: { readonly laneId: string; readonly distanceAlongM: number },
): ResolvedLaneAnchor | null {
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

function scenarioCheckpoints(
  lesson: GameCanvasLesson | undefined,
  mapPack: GameCanvasMapPack | undefined,
): AuthoredCheckpoint[] {
  if (!lesson || !mapPack) return [];
  const byId = new Map(
    mapPack.laneGraph.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]),
  );
  return lesson.checkpoints.flatMap((id) => {
    const checkpoint = byId.get(id);
    if (!checkpoint) return [];
    const anchored = checkpoint.anchor
      ? resolveLaneAnchor(mapPack.laneGraph.lanes, checkpoint.anchor)
      : null;
    if (anchored) {
      const lane = mapPack.laneGraph.lanes.find(
        (candidate) => candidate.id === checkpoint.anchor?.laneId,
      );
      return [{
        id: checkpoint.id,
        label: checkpoint.label,
        x: anchored.x,
        z: anchored.z,
        heading: anchored.heading,
        laneId: checkpoint.anchor?.laneId ?? null,
        laneWidthM: lane?.widthM ?? 3.2,
        distanceAlongM: checkpoint.anchor?.distanceAlongM ?? null,
      }];
    }
    const legacyLaneId = checkpoint.laneId ?? null;
    const legacyLane = legacyLaneId
      ? mapPack.laneGraph.lanes.find((candidate) => candidate.id === legacyLaneId)
      : null;
    return checkpoint.pose
      ? [{
          id: checkpoint.id,
          label: checkpoint.label,
          x: checkpoint.pose.position.x,
          z: checkpoint.pose.position.z,
          heading: degreesToRadians(checkpoint.pose.headingDeg),
          laneId: legacyLaneId,
          laneWidthM: legacyLane?.widthM ?? 3.2,
          distanceAlongM: null,
        }]
      : [];
  });
}

function makeMaterial(
  scene: Scene,
  name: string,
  color: Color3,
  emissive?: Color3,
): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color;
  material.specularColor = Color3.Black();
  material.emissiveColor = emissive ?? Color3.Black();
  return material;
}

function setMeshMaterial(mesh: Mesh, material: StandardMaterial) {
  mesh.material = material;
  mesh.receiveShadows = false;
  mesh.isPickable = false;
}

function createBox(
  scene: Scene,
  name: string,
  dimensions: { width: number; height: number; depth: number },
  position: Vector3,
  material: StandardMaterial,
  parent?: TransformNode,
): Mesh {
  const mesh = MeshBuilder.CreateBox(name, dimensions, scene);
  mesh.position.copyFrom(position);
  mesh.parent = parent ?? null;
  setMeshMaterial(mesh, material);
  return mesh;
}

function createCylinder(
  scene: Scene,
  name: string,
  options: {
    height: number;
    diameter?: number;
    diameterTop?: number;
    diameterBottom?: number;
    tessellation?: number;
  },
  position: Vector3,
  material: StandardMaterial,
  parent?: TransformNode,
): Mesh {
  const mesh = MeshBuilder.CreateCylinder(
    name,
    { tessellation: 8, ...options },
    scene,
  );
  mesh.position.copyFrom(position);
  mesh.parent = parent ?? null;
  setMeshMaterial(mesh, material);
  return mesh;
}

function createExtrudedPrism(
  scene: Scene,
  name: string,
  width: number,
  crossSection: readonly Readonly<{ y: number; z: number }>[],
  material: StandardMaterial,
  parent?: TransformNode,
): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const halfWidth = width / 2;
  const pointCount = crossSection.length;

  for (const x of [-halfWidth, halfWidth]) {
    for (const point of crossSection) {
      positions.push(x, point.y, point.z);
    }
  }

  for (let index = 0; index < pointCount; index += 1) {
    const next = (index + 1) % pointCount;
    const left = index;
    const leftNext = next;
    const right = pointCount + index;
    const rightNext = pointCount + next;
    indices.push(left, right, rightNext, left, rightNext, leftNext);
  }
  for (let index = 1; index < pointCount - 1; index += 1) {
    indices.push(0, index, index + 1);
    indices.push(pointCount, pointCount + index + 1, pointCount + index);
  }

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const mesh = new Mesh(name, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.applyToMesh(mesh);
  mesh.convertToFlatShadedMesh();
  mesh.parent = parent ?? null;
  setMeshMaterial(mesh, material);
  return mesh;
}

class BabylonGameSession {
  private readonly canvas: HTMLCanvasElement;
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly player: TransformNode;
  private readonly playerExterior: TransformNode;
  private readonly playerCockpit: TransformNode;
  private steeringAssembly: TransformNode | null = null;
  private readonly thirdCamera: ArcRotateCamera;
  private readonly firstCamera: UniversalCamera;
  private readonly rearCamera: UniversalCamera;
  private readonly simulation: SimulationCore;
  private simulationSnapshot: SimulationSnapshot;
  private readonly leftIndicatorMeshes: Mesh[] = [];
  private readonly rightIndicatorMeshes: Mesh[] = [];
  private readonly npcVehicles: NpcVehicle[] = [];
  private readonly pedestrians: Pedestrian[] = [];
  private signalRedMaterial: StandardMaterial | null = null;
  private signalAmberMaterial: StandardMaterial | null = null;
  private signalGreenMaterial: StandardMaterial | null = null;
  private readonly authoredSignalHeads: AuthoredSignalHeadVisual[] = [];
  private readonly railwayCrossingVisuals: RailwayCrossingVisual[] = [];
  private readonly disposers: Array<() => void> = [];
  private callbacks: SessionCallbacks;
  private options: SessionOptions;
  private cameraMode: CameraMode;
  private paused: boolean;
  private disposed = false;
  private completed = false;
  private contextLost = false;
  private accumulator = 0;
  private trafficAccumulator = 0;
  private lastFrameTime = 0;
  private lastHudTime = 0;
  private lastSpeedingEvent = -10_000;
  private collisionGraceUntil = 0;
  private wrongSideSeconds = 0;
  private offRoadSeconds = 0;
  private score = 100;
  private ruleElapsedSeconds = 0;
  private readonly authoredRuleCooldownUntil = new Map<string, number>();
  private readonly restrictedLaneSeconds = new Map<string, number>();
  private checkpoint = { x: 0, z: START_Z, heading: 0 };
  private instruction = "Settle into the correct lane and drive toward the first junction.";
  private readonly routePoints: readonly GameCanvasPoint[];
  private readonly authoredCheckpoints: readonly AuthoredCheckpoint[];
  private readonly checkpointVisuals: GuidanceVisual[] = [];
  private readonly routeChevronVisuals: RouteChevronVisual[] = [];
  private guidanceCueVisual: GuidanceVisual | null = null;
  private guidanceCueKey: string | null = null;
  private readonly maneuverPhases = new Map<string, string>();
  private readonly triggeredPrompts = new Set<string>();
  private routeLength = 0;
  private routeProgress = 0;
  private routeSegment = 0;
  private checkpointIndex = 0;
  private checkpointLabel = "Start";
  private activeTrafficSide: TrafficSide;
  private hornUntil = 0;
  private audioContext: AudioContext | null = null;
  private keyboard: AnalogInput = { throttle: 0, brake: 0, steer: 0, quickLook: 0 };
  private touch: AnalogInput = { throttle: 0, brake: 0, steer: 0, quickLook: 0 };
  private gamepad: AnalogInput = { throttle: 0, brake: 0, steer: 0, quickLook: 0 };
  private gamepadButtons: boolean[] = [];
  private gamepadConnected = false;
  private readonly inputRouter: AdaptiveInputRouter;
  private indicatorBlinkSeconds = 0;
  private trafficLightSeconds = 0;
  private trafficLightIsRed = false;
  private swipePointer: number | null = null;
  private swipeStartX = 0;
  private playerState: PlayerState;
  private displayedX = 0;
  private displayedZ = START_Z;
  private displayedHeading = 0;
  private cameraMotionSeconds = 0;
  private lastSimulationHonkActive = false;
  private lastSimulationCoachMessage: string | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    options: SessionOptions,
    callbacks: SessionCallbacks,
  ) {
    this.canvas = canvas;
    this.options = options;
    this.callbacks = callbacks;
    this.cameraMode = options.cameraMode;
    this.inputRouter = new AdaptiveInputRouter(
      options.inputCapabilities,
      options.reducedMotion,
      (presentation) => this.callbacks.onInputPresentationChange?.(presentation),
    );
    this.paused = options.paused;
    this.activeTrafficSide = options.lesson?.trafficSide ?? options.trafficSide;
    this.routePoints = scenarioRoutePoints(options.lesson, options.mapPack);
    this.authoredCheckpoints = scenarioCheckpoints(options.lesson, options.mapPack);
    for (let index = 0; index < this.routePoints.length - 1; index += 1) {
      this.routeLength += Math.hypot(
        this.routePoints[index + 1].x - this.routePoints[index].x,
        this.routePoints[index + 1].z - this.routePoints[index].z,
      );
    }
    this.simulation = new SimulationCore(
      buildSimulationCoreConfig({
        lesson: options.lesson,
        mapPack: options.mapPack,
        trafficSide: this.activeTrafficSide,
        speedUnit: options.speedUnit,
        touchFirst: options.inputCapabilities.touchFirst,
      }),
    );
    if (options.paused) this.simulation.setPaused(true);
    this.simulationSnapshot = this.simulation.getSnapshot();
    const start = this.simulationSnapshot.player;
    this.playerState = {
      x: start.x,
      z: start.z,
      previousX: start.x,
      previousZ: start.z,
      heading: start.heading,
      speedMps: 0,
      gear: "D",
      indicator: "off",
    };
    this.collisionGraceUntil = eventNow() + 2_000;
    this.checkpoint = { ...start };
    this.displayedX = start.x;
    this.displayedZ = start.z;
    this.displayedHeading = start.heading;
    while (
      this.checkpointIndex < this.authoredCheckpoints.length &&
      Math.hypot(
        start.x - this.authoredCheckpoints[this.checkpointIndex].x,
        start.z - this.authoredCheckpoints[this.checkpointIndex].z,
      ) < 2.5
    ) {
      this.checkpointLabel = this.authoredCheckpoints[this.checkpointIndex].label;
      this.checkpointIndex += 1;
    }
    this.checkpointLabel =
      this.authoredCheckpoints[Math.max(0, this.checkpointIndex - 1)]?.label ??
      "Start";
    const startPrompt = options.lesson?.coachPrompts.find(
      (prompt) => prompt.trigger.type === "start",
    );
    this.instruction =
      startPrompt?.message ??
      options.lesson?.objectives[0]?.label ??
      this.instruction;
    if (startPrompt) this.triggeredPrompts.add(startPrompt.id);

    this.engine = new Engine(
      canvas,
      true,
      {
        alpha: false,
        antialias: true,
        preserveDrawingBuffer: false,
        stencil: true,
        powerPreference: "high-performance",
      },
      true,
    );
    if (this.engine.webGLVersion < 2) {
      this.engine.dispose();
      throw new Error("SideSwap requires WebGL 2.");
    }

    const scale = options.inputCapabilities.touchFirst
      ? Math.max(1, Math.min(1.65, window.devicePixelRatio / 1.2))
      : Math.max(1, Math.min(1.4, window.devicePixelRatio / 1.6));
    this.engine.setHardwareScalingLevel(scale);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.68, 0.84, 0.9, 1);
    this.scene.ambientColor = new Color3(0.36, 0.39, 0.36);
    this.scene.skipPointerMovePicking = true;

    this.player = new TransformNode("player-root", this.scene);
    this.playerExterior = new TransformNode("player-exterior", this.scene);
    this.playerCockpit = new TransformNode("player-cockpit", this.scene);
    this.playerExterior.parent = this.player;
    this.playerCockpit.parent = this.player;
    this.buildEnvironment();
    this.buildPlayerCar();
    this.buildTraffic();
    this.applySimulationNpcSnapshots(this.simulationSnapshot);

    this.thirdCamera = new ArcRotateCamera(
      "third-person-camera",
      -Math.PI / 2,
      1.12,
      13,
      Vector3.Zero(),
      this.scene,
    );
    this.thirdCamera.inputs.clear();
    this.thirdCamera.lowerRadiusLimit = 8;
    this.thirdCamera.upperRadiusLimit = 16;
    this.thirdCamera.minZ = 0.1;
    this.thirdCamera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    this.thirdCamera.fov = clampHorizontalFieldOfView(options.fieldOfView);
    this.thirdCamera.layerMask = PRIMARY_CAMERA_LAYER_MASK;

    this.firstCamera = new UniversalCamera(
      "first-person-camera",
      Vector3.Zero(),
      this.scene,
    );
    this.firstCamera.inputs.clear();
    this.firstCamera.minZ = 0.04;
    this.firstCamera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    this.firstCamera.fov = clampHorizontalFieldOfView(options.fieldOfView);
    this.firstCamera.layerMask = PRIMARY_CAMERA_LAYER_MASK;

    this.rearCamera = new UniversalCamera(
      "rear-view-camera",
      Vector3.Zero(),
      this.scene,
    );
    this.rearCamera.inputs.clear();
    this.rearCamera.minZ = 0.08;
    this.rearCamera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    this.rearCamera.fov = (64 * Math.PI) / 180;
    this.rearCamera.layerMask = WORLD_LAYER_MASK;
    this.rearCamera.viewport = new Viewport(0.36, 0.845, 0.28, 0.125);

    this.setCameraMode(options.cameraMode, false);
    this.installListeners();
    this.updatePlayerVisuals(1);
    this.callbacks.onInputPresentationChange?.(this.inputRouter.getPresentation());

    this.lastFrameTime = performance.now();
    this.engine.runRenderLoop(this.renderFrame);
    queueMicrotask(() => {
      if (this.disposed) return;
      this.callbacks.onReady?.();
      this.emit("ready", "Training yard ready.");
      this.publishHud(true);
    });
  }

  updateCallbacks(callbacks: SessionCallbacks) {
    this.callbacks = callbacks;
  }

  updateOptions(options: Partial<SessionOptions>) {
    this.options = { ...this.options, ...options };
    if (typeof options.reducedMotion === "boolean") {
      this.inputRouter.setReducedMotion(options.reducedMotion);
    }
    this.thirdCamera.fov = clampHorizontalFieldOfView(this.options.fieldOfView);
    this.firstCamera.fov = clampHorizontalFieldOfView(this.options.fieldOfView);
    if (options.cameraMode) this.setCameraMode(options.cameraMode, false);
    if (typeof options.paused === "boolean") this.setPaused(options.paused, false);
  }

  setTouchAnalog(control: keyof AnalogInput, value: number) {
    this.touch[control] = clamp(value, -1, 1);
    if (value !== 0) this.inputRouter.registerMeaningfulInput("touch");
  }

  clearTouch() {
    this.touch = { throttle: 0, brake: 0, steer: 0, quickLook: 0 };
  }

  registerTouchInput() {
    this.inputRouter.registerMeaningfulInput("touch");
  }

  setInputCapabilities(capabilities: InputCapabilities) {
    this.options = { ...this.options, inputCapabilities: capabilities };
    this.inputRouter.setCapabilities(capabilities);
  }

  setPaused(paused: boolean, notify = true) {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.simulation.setPaused(true);
    } else if (this.simulation.getSnapshot().status === "incident") {
      this.simulation.resumeAfterIncident();
    } else {
      this.simulation.setPaused(false);
    }
    this.applySimulationSnapshot(this.simulation.getSnapshot());
    this.clearHeldInputs();
    if (notify) this.callbacks.onPauseChange?.(paused);
    this.publishHud(true);
  }

  togglePause() {
    this.setPaused(!this.paused);
  }

  setCameraMode(mode: CameraMode, notify = true) {
    const activeCameraNames =
      this.scene.activeCameras?.map((camera) => camera.name) ?? [];
    if (
      this.cameraMode === mode &&
      isCameraStackActive(
        mode,
        this.scene.activeCamera?.name ?? null,
        activeCameraNames,
      )
    ) {
      return;
    }
    this.cameraMode = mode;
    const firstPerson = mode === "first";
    this.playerExterior.setEnabled(!firstPerson);
    this.playerCockpit.setEnabled(firstPerson);
    this.scene.activeCamera = firstPerson ? this.firstCamera : this.thirdCamera;
    this.scene.activeCameras = firstPerson
      ? [this.firstCamera, this.rearCamera]
      : [this.thirdCamera];
    if (notify) {
      this.callbacks.onCameraChange?.(mode);
      this.emit("camera", `${firstPerson ? "First" : "Third"}-person camera selected.`);
    }
    this.publishHud(true);
  }

  toggleCamera() {
    this.setCameraMode(this.cameraMode === "first" ? "third" : "first");
  }

  setGear(gear: DriveGear) {
    const selected = this.simulation.selectGear(gear === "D" ? "drive" : "reverse");
    const snapshot = this.simulation.getSnapshot();
    this.applySimulationSnapshot(snapshot);
    if (!selected) {
      this.publishSimulationCoachMessage(snapshot);
      this.publishHud(true);
      return;
    }
    this.emit("gear", gear === "D" ? "Drive selected." : "Reverse selected.");
    this.publishHud(true);
  }

  toggleGear() {
    this.setGear(this.playerState.gear === "D" ? "R" : "D");
  }

  setIndicator(indicator: TurnIndicator) {
    const action: SimulationInput =
      indicator === "left"
        ? { signalLeft: true }
        : indicator === "right"
          ? { signalRight: true }
          : { cancelSignal: true };
    this.simulation.step(0, action);
    this.simulationSnapshot = this.simulation.step(0, {});
    this.applySimulationSnapshot(this.simulationSnapshot);
    this.indicatorBlinkSeconds = 0;
    this.emit(
      "indicator",
      this.playerState.indicator === "off"
        ? "Indicators cancelled."
        : `${this.playerState.indicator === "left" ? "Left" : "Right"} indicator on.`,
    );
    this.publishHud(true);
  }

  horn() {
    const now = eventNow();
    if (now < this.hornUntil - 80) return;
    this.hornUntil = now + 650;
    this.simulation.step(0, { horn: true });
    this.simulationSnapshot = this.simulation.step(0, {});
    this.applySimulationSnapshot(this.simulationSnapshot);
    this.playHornTone();
    this.emit("horn", "Horn sounded.");
    this.publishHud(true);
  }

  reset(incidentMessage?: string) {
    if (incidentMessage) {
      this.simulation.reportExternalCollision(
        incidentMessage,
        "Review the incident, then continue from the safe checkpoint.",
        { source: "legacy-runtime-bridge" },
      );
    } else {
      this.simulation.resetToCheckpoint();
    }
    this.applySimulationSnapshot(this.simulation.getSnapshot());
    this.processSimulationEvents(this.simulation.drainEvents());
    this.clearHeldInputs();
    this.displayedX = this.playerState.x;
    this.displayedZ = this.playerState.z;
    this.displayedHeading = this.playerState.heading;
    if (incidentMessage) {
      this.instruction = incidentMessage;
      this.setPaused(true);
    } else {
      this.instruction = "Reset to the last safe checkpoint.";
      this.emit("reset", this.instruction);
    }
    this.publishHud(true);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.engine.stopRenderLoop(this.renderFrame);
    this.simulation.dispose();
    this.inputRouter.dispose();
    this.clearHeldInputs();
    for (const dispose of this.disposers.splice(0)) dispose();
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
    this.scene.dispose();
    this.engine.dispose();
  }

  private readonly renderFrame = () => {
    if (this.disposed || this.contextLost) return;
    const now = performance.now();
    const frameSeconds = Math.min(0.1, Math.max(0, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;
    this.pollGamepad();

    if (!this.paused) {
      this.accumulator = Math.min(this.accumulator + frameSeconds, FIXED_STEP * 6);
      while (this.accumulator >= FIXED_STEP && !this.paused) {
        this.fixedUpdate(FIXED_STEP);
        this.accumulator -= FIXED_STEP;
      }
    }

    const interpolation = this.paused ? 1 : this.accumulator / FIXED_STEP;
    this.updatePlayerVisuals(interpolation);
    this.updateGuidanceVisuals();
    this.updateCamera(frameSeconds);
    this.updateIndicatorLights(frameSeconds);
    this.scene.render();
    if (now - this.lastHudTime >= 100) this.publishHud();
  };

  private fixedUpdate(dt: number) {
    const input = this.mergedInput();
    this.ruleElapsedSeconds += dt;
    const quickLookAngle =
      Math.abs(input.quickLook) > 1.5 ? Math.PI : input.quickLook * 1.18;
    const simulationInput: SimulationInput = {
      throttle: input.throttle,
      brake: input.brake,
      steer: clamp(
        input.steer * this.options.steeringSensitivity,
        -1,
        1,
      ),
      viewHeading: this.playerState.heading + quickLookAngle,
      observe:
        input.quickLook <= -0.55
          ? "left"
          : input.quickLook >= 0.55 && input.quickLook < 1.5
            ? "right"
            : undefined,
    };
    const snapshot = this.simulation.step(dt, simulationInput);
    this.applySimulationSnapshot(snapshot);
    const events = this.simulation.drainEvents();
    this.processSimulationEvents(events);
    if (events.length === 0) this.publishSimulationCoachMessage(snapshot);
    this.animatePedestrians(dt);
    this.reportVulnerableRoadUserCollision();
    this.evaluateAuthoredProgress();
  }

  private reportVulnerableRoadUserCollision() {
    if (
      this.simulationSnapshot.status !== "running" ||
      this.playerState.speedMps < 0.25
    ) {
      return;
    }
    for (const roadUser of this.pedestrians) {
      const safetyRadius = roadUser.kind === "cyclist" ? 1.9 : 1.55;
      if (
        Math.hypot(
          this.playerState.x - roadUser.node.position.x,
          this.playerState.z - roadUser.node.position.z,
        ) >= safetyRadius
      ) {
        continue;
      }
      const cyclist = roadUser.kind === "cyclist";
      const reported = this.simulation.reportExternalCollision(
        cyclist
          ? "Your vehicle collided with a cyclist."
          : "Your vehicle entered an occupied pedestrian crossing.",
        cyclist
          ? "Leave more clearance and wait for a safe opportunity to pass."
          : "Brake early and yield until the crossing is completely clear.",
        {
          roadUserType: cyclist ? "cyclist" : "pedestrian",
          impactSpeedMps: Math.round(this.playerState.speedMps * 10) / 10,
        },
      );
      if (!reported) return;
      const snapshot = this.simulation.getSnapshot();
      this.applySimulationSnapshot(snapshot);
      this.processSimulationEvents(this.simulation.drainEvents());
      return;
    }
  }

  private evaluateAuthoredProgress() {
    const lesson = this.options.lesson;
    const mapPack = this.options.mapPack;
    if (!lesson || !mapPack || this.routePoints.length < 2) {
      this.completeFromSimulationIfNeeded();
      return;
    }
    const state = this.playerState;
    const routeProjection = this.projectToAuthoredRoute(state.x, state.z);
    const roadProjection = this.projectToScenarioLanes(
      state.x,
      state.z,
      mapPack.laneGraph.lanes,
    );
    const projectedLane = roadProjection
      ? mapPack.laneGraph.lanes.find((lane) => lane.id === roadProjection.laneId)
      : null;
    const roadTolerance =
      (projectedLane?.widthM ?? Math.min(3.5, mapPack.geometry.roadWidth * 0.45)) / 2 +
      (mapPack.geometry.shoulderWidth ?? 1);

    if (routeProjection && routeProjection.distance < roadTolerance * 1.4) {
      this.routeSegment = Math.max(this.routeSegment, routeProjection.segmentIndex);
      const candidateProgress =
        this.routeLength > 0 ? routeProjection.distanceAlong / this.routeLength : 0;
      if (candidateProgress <= this.routeProgress + 0.2) {
        this.routeProgress = Math.max(
          this.routeProgress,
          clamp(candidateProgress, 0, 1),
        );
      }
    }

    this.advanceAuthoredCheckpoints(lesson);
    for (const prompt of lesson.coachPrompts) {
      if (
        prompt.trigger.type === "route_progress" &&
        this.routeProgress >= prompt.trigger.value &&
        !this.triggeredPrompts.has(prompt.id)
      ) {
        this.triggeredPrompts.add(prompt.id);
        this.coach(prompt.message);
      }
    }

    if (lesson.kind === "free_drive") return;
    const endpoint = this.routePoints[this.routePoints.length - 1];
    const endpointReached = Math.hypot(state.x - endpoint.x, state.z - endpoint.z) <= 7;
    const checkpointsComplete =
      this.authoredCheckpoints.length === 0 ||
      this.checkpointIndex >= this.authoredCheckpoints.length;
    const maneuversComplete = (this.simulationSnapshot.maneuvers ?? []).every(
      (maneuver) => maneuver.phase === "complete",
    );
    if (
      this.simulationSnapshot.status !== "complete" &&
      checkpointsComplete &&
      maneuversComplete &&
      (endpointReached || this.routeProgress >= 0.97)
    ) {
      this.simulation.completeLesson();
      this.applySimulationSnapshot(this.simulation.getSnapshot());
    }
    this.completeFromSimulationIfNeeded();
  }

  private completeFromSimulationIfNeeded() {
    if (this.completed || this.simulationSnapshot.status !== "complete") return;
    this.completed = true;
    this.routeProgress = 1;
    this.instruction = this.options.lesson
      ? `${this.options.lesson.title} complete — review your score and incident timeline.`
      : "Orientation complete — safe positioning achieved.";
    this.emit("complete", this.instruction);
    this.callbacks.onComplete?.({ ...this.simulationSnapshot.score });
    this.publishHud(true);
  }

  private mergedInput(): AnalogInput {
    const strongest = (...values: number[]) =>
      values.reduce((best, value) =>
        Math.abs(value) > Math.abs(best) ? value : best,
      0);
    return {
      throttle: clamp(
        Math.max(this.keyboard.throttle, this.touch.throttle, this.gamepad.throttle),
        0,
        1,
      ),
      brake: clamp(
        Math.max(this.keyboard.brake, this.touch.brake, this.gamepad.brake),
        0,
        1,
      ),
      steer: clamp(
        strongest(this.keyboard.steer, this.touch.steer, this.gamepad.steer),
        -1,
        1,
      ),
      quickLook: strongest(
        this.keyboard.quickLook,
        this.touch.quickLook,
        this.gamepad.quickLook,
      ),
    };
  }

  private evaluateLesson(dt: number) {
    if (this.options.lesson && this.options.mapPack && this.routePoints.length >= 2) {
      this.evaluateAuthoredLesson(dt);
      return;
    }
    const state = this.playerState;
    const now = eventNow();
    const laneSign = this.options.trafficSide === "right" ? 1 : -1;
    const movingForward = Math.cos(state.heading) > 0.45 && state.gear === "D";
    const onWrongHalf = movingForward && state.x * laneSign < -0.55;
    this.wrongSideSeconds = onWrongHalf ? this.wrongSideSeconds + dt : 0;

    if (this.wrongSideSeconds > 2.5) {
      const expected = this.options.trafficSide === "right" ? "right" : "left";
      this.reset(`You crossed onto opposing traffic. Keep to the ${expected} side.`);
      return;
    }

    const onRoad =
      Math.abs(state.x) < 7 ||
      Math.abs(state.z) < 7 ||
      Math.hypot(state.x, state.z - 32) < 13;
    if (!onRoad && Math.abs(state.x) < 24 && state.z > -62 && state.z < 84) {
      this.reset("You left the driveable surface. Slow down before steering and rejoin safely.");
      return;
    }

    for (const npc of this.npcVehicles) {
      if (
        npc.active !== false &&
        now >= this.collisionGraceUntil &&
        Math.hypot(state.x - npc.laneX, state.z - npc.z) < 2.35
      ) {
        if (state.speedMps < 0.2 && (npc.currentSpeed ?? npc.speed) > 0.4) {
          npc.active = false;
          npc.respawnAfterSeconds = 3;
          npc.currentSpeed = 0;
          npc.node.setEnabled(false);
          this.coach("Traffic recovered safely behind you. Continue when you are ready.");
          continue;
        }
        npc.z += npc.direction > 0 ? -22 : 22;
        this.reset("Collision detected. Leave a larger following gap and scan before moving.");
        return;
      }
    }
    for (const pedestrian of this.pedestrians) {
      const x = pedestrian.node.position.x;
      if (Math.hypot(state.x - x, state.z - pedestrian.z) < 1.6) {
        this.reset("A pedestrian was in the crossing. Brake early and yield until it is clear.");
        return;
      }
    }

    if (state.speedMps > 14.2 && now - this.lastSpeedingEvent > 7000) {
      this.lastSpeedingEvent = now;
      this.score = Math.max(0, this.score - 3);
      this.coach("Ease off the accelerator: this training road is limited to 30 mph / 50 km/h.");
    }

    const crossedSignal = state.previousZ < -4 && state.z >= -4;
    if (crossedSignal && this.trafficLightIsRed) {
      this.reset("Red light entered. Stop before the line and wait for a green signal.");
      return;
    }

    if (state.z > -8 && this.checkpoint.z < -8) {
      this.checkpoint = { x: state.x, z: -8, heading: state.heading };
      this.instruction = "Check both sides at the crossing, then continue toward the roundabout.";
      this.coach(this.instruction);
    }
    if (state.z > 39 && this.checkpoint.z < 39) {
      this.checkpoint = { x: state.x, z: 39, heading: state.heading };
      this.instruction = `Keep ${this.options.trafficSide} as you leave the roundabout area.`;
      this.coach(this.instruction);
    }
    if (state.z >= FINISH_Z && !this.completed) {
      this.completed = true;
      state.speedMps = 0;
      this.instruction = "Orientation complete — safe positioning achieved.";
      this.emit("complete", this.instruction);
      this.callbacks.onComplete?.({ ...this.simulationSnapshot.score });
      this.publishHud(true);
    }
  }

  private evaluateAuthoredLesson(dt: number) {
    const lesson = this.options.lesson;
    const mapPack = this.options.mapPack;
    if (!lesson || !mapPack) return;
    const state = this.playerState;
    const routeProjection = this.projectToAuthoredRoute(state.x, state.z);
    const roadProjection = this.projectToScenarioLanes(
      state.x,
      state.z,
      mapPack.laneGraph.lanes,
    );
    const directionHeading = state.gear === "R" ? state.heading + Math.PI : state.heading;
    const headingError = roadProjection
      ? Math.abs(this.angleDifference(directionHeading, roadProjection.heading))
      : 0;
    const wrongWay = state.speedMps > 1.1 && headingError > Math.PI / 2;
    this.wrongSideSeconds = wrongWay
      ? this.wrongSideSeconds + dt
      : Math.max(0, this.wrongSideSeconds - dt * 2);

    const projectedLane = roadProjection
      ? mapPack.laneGraph.lanes.find((lane) => lane.id === roadProjection.laneId)
      : null;
    const roadTolerance =
      (projectedLane?.widthM ?? Math.min(3.5, mapPack.geometry.roadWidth * 0.45)) / 2 +
      (mapPack.geometry.shoulderWidth ?? 1);
    const offRoad = !roadProjection || roadProjection.distance > roadTolerance;
    this.offRoadSeconds = offRoad
      ? this.offRoadSeconds + dt
      : Math.max(0, this.offRoadSeconds - dt * 2);
    if (this.wrongSideSeconds > 2.4) {
      this.reset(
        `Wrong-way travel detected. Follow the marked route and keep ${this.activeTrafficSide}.`,
      );
      this.offRoadSeconds = 0;
      return;
    }
    if (this.offRoadSeconds > 1.25) {
      this.reset(
        "You left the driveable surface. Slow down, look through the turn, and rejoin safely.",
      );
      this.offRoadSeconds = 0;
      return;
    }

    const now = eventNow();
    for (const npc of this.npcVehicles) {
      if (
        npc.active !== false &&
        now >= this.collisionGraceUntil &&
        Math.hypot(
          state.x - npc.node.position.x,
          state.z - npc.node.position.z,
        ) < 2.35
      ) {
        if (state.speedMps < 0.2 && (npc.currentSpeed ?? npc.speed) > 0.4) {
          npc.active = false;
          npc.respawnAfterSeconds = 3;
          npc.currentSpeed = 0;
          npc.node.setEnabled(false);
          this.coach("Traffic recovered safely behind you. Continue when you are ready.");
          continue;
        }
        this.reset("Collision detected. Leave a larger following gap and scan before moving.");
        return;
      }
    }
    for (const roadUser of this.pedestrians) {
      const safetyRadius = roadUser.kind === "cyclist" ? 1.9 : 1.55;
      if (
        Math.hypot(
          state.x - roadUser.node.position.x,
          state.z - roadUser.node.position.z,
        ) < safetyRadius
      ) {
        this.reset(
          roadUser.kind === "cyclist"
            ? "A cyclist was in your path. Leave more clearance and wait for a safe pass."
            : "A pedestrian was in the crossing. Brake early and yield until it is clear.",
        );
        return;
      }
    }

    if (this.evaluateAuthoredSignalEntry(mapPack)) return;

    const displayLimit =
      roadProjection?.speedLimit ?? (this.options.speedUnit === "mph" ? 30 : 50);
    const limitMps =
      this.options.speedUnit === "mph"
        ? displayLimit / 2.236936
        : displayLimit / 3.6;
    if (state.speedMps > limitMps + 1.1 && now - this.lastSpeedingEvent > 7000) {
      this.lastSpeedingEvent = now;
      this.score = Math.max(0, this.score - 3);
      this.coach(
        `Ease off the accelerator. This lane is limited to ${Math.round(displayLimit)} ${this.options.speedUnit}.`,
      );
    }

    this.evaluateAuthoredRuleZones(
      dt,
      lesson,
      mapPack,
      roadProjection,
      roadTolerance,
    );

    if (routeProjection && routeProjection.distance < roadTolerance * 1.4) {
      this.routeSegment = Math.max(this.routeSegment, routeProjection.segmentIndex);
      const candidateProgress =
        this.routeLength > 0 ? routeProjection.distanceAlong / this.routeLength : 0;
      if (candidateProgress <= this.routeProgress + 0.2) {
        this.routeProgress = Math.max(
          this.routeProgress,
          clamp(candidateProgress, 0, 1),
        );
      }
    }

    this.advanceAuthoredCheckpoints(lesson);
    for (const prompt of lesson.coachPrompts) {
      if (
        prompt.trigger.type === "route_progress" &&
        this.routeProgress >= prompt.trigger.value &&
        !this.triggeredPrompts.has(prompt.id)
      ) {
        this.triggeredPrompts.add(prompt.id);
        this.coach(prompt.message);
      }
    }

    const endpoint = this.routePoints[this.routePoints.length - 1];
    const endpointReached = Math.hypot(state.x - endpoint.x, state.z - endpoint.z) <= 7;
    const checkpointsComplete =
      this.authoredCheckpoints.length === 0 ||
      this.checkpointIndex >= this.authoredCheckpoints.length;
    const maneuversComplete = (this.simulationSnapshot.maneuvers ?? []).every(
      (maneuver) => maneuver.phase === "complete",
    );
    if (
      !this.completed &&
      lesson.kind !== "free_drive" &&
      checkpointsComplete &&
      maneuversComplete &&
      (endpointReached || this.routeProgress >= 0.97)
    ) {
      this.completed = true;
      state.speedMps = 0;
      this.routeProgress = 1;
      this.instruction = `${lesson.title} complete — review your score and incident timeline.`;
      this.emit("complete", this.instruction);
      this.callbacks.onComplete?.({ ...this.simulationSnapshot.score });
      this.publishHud(true);
    }
  }

  private evaluateAuthoredRuleZones(
    dt: number,
    lesson: GameCanvasLesson,
    mapPack: GameCanvasMapPack,
    roadProjection: ScenarioLaneProjection | null,
    roadTolerance: number,
  ) {
    if (
      roadProjection &&
      (lesson.kind === "free_drive" || lesson.assessedRules?.includes("box_junction"))
    ) {
      const conflictZones = mapPack.laneGraph.conflictZones ?? [];
      const zonesById = new Map(conflictZones.map((zone) => [zone.id, zone]));
      for (const control of mapPack.laneGraph.controls) {
        if (control.type !== "box_junction") continue;
        for (const zoneId of control.conflictZoneIds ?? []) {
          const zone = zonesById.get(zoneId);
          if (!zone) continue;
          const laneRelevant =
            control.laneIds.includes(roadProjection.laneId) ||
            zone.laneIds.includes(roadProjection.laneId);
          const entered =
            laneRelevant &&
            !isPointInPolygon(
              { x: this.playerState.previousX, z: this.playerState.previousZ },
              zone.polygon,
            ) &&
            isPointInPolygon(this.playerState, zone.polygon);
          if (!entered || this.playerState.speedMps < 0.5) continue;
          const blockingNpc = this.findBlockingAuthoredExit(
            roadProjection,
            zone.polygon,
            mapPack.laneGraph.lanes,
          );
          if (!blockingNpc) continue;
          this.assessAuthoredRule(
            lesson,
            "box_junction",
            "You entered the yellow box before your exit was clear.",
            "Wait before the box until there is room to clear it completely.",
            6,
            {
              junctionId: control.id,
              conflictZoneId: zone.id,
              laneId: roadProjection.laneId,
              blockingVehicle: blockingNpc.node.name,
              exitBlocked: true,
            },
          );
        }
      }
    }

    const restrictions = mapPack.laneGraph.restrictions ?? [];
    const clock = lesson.scenarioClock;
    const assessRestrictions =
      lesson.kind === "free_drive" ||
      Boolean(lesson.assessedRules?.includes("restricted_lane"));
    for (const restriction of restrictions) {
      const activeWindow = clock
        ? restriction.activeWindows.find((window) =>
            isRestrictionWindowActive(clock, window),
          )
        : undefined;
      const usingRestrictedLane =
        assessRestrictions &&
        Boolean(activeWindow) &&
        roadProjection?.laneId === restriction.laneId &&
        roadProjection.distance <= roadTolerance &&
        this.playerState.speedMps >= 0.8;
      const sustainedSeconds = usingRestrictedLane
        ? (this.restrictedLaneSeconds.get(restriction.id) ?? 0) + dt
        : 0;
      this.restrictedLaneSeconds.set(restriction.id, sustainedSeconds);
      if (sustainedSeconds < 2.5 || !clock || !activeWindow) continue;
      this.assessAuthoredRule(
        lesson,
        "restricted_lane",
        restriction.message,
        "Read the signed operating times and move into a general-traffic lane when it is safe.",
        4,
        {
          restrictionId: restriction.id,
          laneId: restriction.laneId,
          weekday: clock.weekday,
          scenarioTime: clock.label,
          sourceReferenceId: restriction.sourceReferenceId,
          activeWindow: `${activeWindow.startMinutes}-${activeWindow.endMinutes}`,
          sustainedSeconds: 2.5,
        },
      );
      this.restrictedLaneSeconds.set(restriction.id, 0);
    }
  }

  private authoredSignalAspect(
    control: GameCanvasTrafficControl,
    approach: GameCanvasTrafficControlApproach,
  ): AuthoredSignalAspect {
    const signalInstallation = (control.installations ?? []).find(
      (installation) =>
        (installation.style === "nyc_signal" || installation.style === "uk_signal") &&
        installation.approachIds?.includes(approach.id),
    );
    const style: AuthoredSignalStyle =
      signalInstallation?.style === "uk_signal" ||
      this.options.mapPack?.id.includes("london")
        ? "uk_signal"
        : "nyc_signal";
    return authoredSignalAspectAt({
      elapsedSeconds: this.trafficLightSeconds,
      controlId: control.id,
      phaseGroup: approach.phaseGroup,
      phaseGroups: (control.approaches ?? []).map((candidate) => candidate.phaseGroup),
      style,
    });
  }

  private evaluateAuthoredSignalEntry(mapPack: GameCanvasMapPack): boolean {
    const state = this.playerState;
    if (state.gear !== "D" || state.speedMps < 0.25) return false;
    for (const control of mapPack.laneGraph.controls) {
      if (control.type !== "signal") continue;
      for (const approach of control.approaches ?? []) {
        const lane = mapPack.laneGraph.lanes.find(
          (candidate) => candidate.id === approach.stopLine.laneId,
        );
        if (!lane) continue;
        const previous = this.projectToScenarioLanes(
          state.previousX,
          state.previousZ,
          [lane],
        );
        const current = this.projectToScenarioLanes(state.x, state.z, [lane]);
        const laneTolerance = (lane.widthM ?? 3.2) / 2 + 0.7;
        const stopDistance = approach.stopLine.distanceAlongM;
        const crossedStopLine =
          Boolean(previous && current) &&
          previous!.distance <= laneTolerance &&
          current!.distance <= laneTolerance &&
          previous!.distanceAlong < stopDistance - 0.08 &&
          current!.distanceAlong >= stopDistance - 0.08;
        if (!crossedStopLine) continue;
        const aspect = this.authoredSignalAspect(control, approach);
        if (!authoredSignalRequiresStop(aspect)) continue;
        this.reset(
          "Red signal entered. Stop before the line and wait for your approach to turn green.",
        );
        return true;
      }
    }
    return false;
  }

  private findBlockingAuthoredExit(
    playerProjection: ScenarioLaneProjection,
    polygon: readonly GameCanvasPoint[],
    lanes: readonly GameCanvasLane[],
  ): NpcVehicle | null {
    const currentLane = lanes.find((lane) => lane.id === playerProjection.laneId);
    if (!currentLane) return null;
    const exitLaneIds = new Set([
      currentLane.id,
      ...(currentLane.successors ?? []),
    ]);
    for (const npc of this.npcVehicles) {
      if (!npc.laneId || !exitLaneIds.has(npc.laneId)) continue;
      const npcPoint = { x: npc.node.position.x, z: npc.node.position.z };
      if (distanceToPolygon(npcPoint, polygon) > 14) continue;
      if (npc.laneId === currentLane.id) {
        const npcProjection = this.projectToScenarioLanes(
          npcPoint.x,
          npcPoint.z,
          [currentLane],
        );
        if (!npcProjection) continue;
        const gap = npcProjection.distanceAlong - playerProjection.distanceAlong;
        if (gap > 0.5 && gap <= 34) return npc;
        continue;
      }
      return npc;
    }
    return null;
  }

  private assessAuthoredRule(
    lesson: GameCanvasLesson,
    ruleCode: "box_junction" | "restricted_lane",
    message: string,
    correction: string,
    penalty: number,
    evidence: Record<string, string | number | boolean>,
  ): boolean {
    if ((this.authoredRuleCooldownUntil.get(ruleCode) ?? 0) > this.ruleElapsedSeconds) {
      return false;
    }
    const prompt = lesson.coachPrompts.find(
      (candidate) =>
        candidate.trigger.type === "rule_event" &&
        candidate.trigger.ruleCode === ruleCode &&
        !this.triggeredPrompts.has(candidate.id),
    );
    if (prompt) this.triggeredPrompts.add(prompt.id);
    const actionableCorrection = prompt?.message ?? correction;
    this.score = Math.max(0, this.score - penalty);
    this.instruction = actionableCorrection;
    this.authoredRuleCooldownUntil.set(
      ruleCode,
      this.ruleElapsedSeconds + (ruleCode === "box_junction" ? 10 : 12),
    );
    this.playCoachTone();
    this.emit(
      "coaching",
      `${message} ${actionableCorrection}`,
      "warning",
      { ruleCode, penalty, evidence },
    );
    this.publishHud(true);
    return true;
  }

  private advanceAuthoredCheckpoints(lesson: GameCanvasLesson) {
    const reachedCheckpointIds = new Set(
      this.simulationSnapshot.reachedCheckpointIds,
    );
    while (this.checkpointIndex < this.authoredCheckpoints.length) {
      const next = this.authoredCheckpoints[this.checkpointIndex];
      if (!reachedCheckpointIds.has(next.id)) break;
      this.checkpoint = { x: next.x, z: next.z, heading: next.heading };
      this.checkpointLabel = next.label;
      this.checkpointIndex += 1;
      this.updateGuidanceVisuals();
      this.emit("coaching", `Checkpoint: ${next.label}.`);
      const checkpointPrompt = lesson.coachPrompts.find(
        (prompt) =>
          prompt.trigger.type === "checkpoint" &&
          prompt.trigger.checkpointId === next.id &&
          !this.triggeredPrompts.has(prompt.id),
      );
      if (checkpointPrompt) {
        this.triggeredPrompts.add(checkpointPrompt.id);
        this.coach(checkpointPrompt.message);
      }
      const transition = lesson.profileTransitions?.find(
        (item) => item.checkpointId === next.id,
      );
      if (transition) {
        this.instruction = transition.message;
        this.emit("coaching", transition.message, "warning");
      }
    }
  }

  private projectToAuthoredRoute(x: number, z: number): RouteProjection | null {
    if (this.routePoints.length < 2) return null;
    let best: RouteProjection | null = null;
    let accumulated = 0;
    for (let index = 0; index < this.routePoints.length - 1; index += 1) {
      const start = this.routePoints[index];
      const end = this.routePoints[index + 1];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.max(0.0001, Math.hypot(dx, dz));
      const amount = clamp(
        ((x - start.x) * dx + (z - start.z) * dz) / (length * length),
        0,
        1,
      );
      const projectedX = start.x + dx * amount;
      const projectedZ = start.z + dz * amount;
      const distance = Math.hypot(x - projectedX, z - projectedZ);
      const nearCurrentRoute =
        index >= Math.max(0, this.routeSegment - 1) &&
        index <= this.routeSegment + 5;
      if (nearCurrentRoute && (!best || distance < best.distance)) {
        best = {
          segmentIndex: index,
          x: projectedX,
          z: projectedZ,
          heading: Math.atan2(dx, dz),
          distance,
          distanceAlong: accumulated + length * amount,
        };
      }
      accumulated += length;
    }
    return best;
  }

  private projectToScenarioLanes(
    x: number,
    z: number,
    lanes: readonly GameCanvasLane[],
  ): ScenarioLaneProjection | null {
    let best: ScenarioLaneProjection | null = null;
    for (const lane of lanes) {
      let accumulated = 0;
      for (let index = 0; index < lane.centerline.length - 1; index += 1) {
        const start = lane.centerline[index];
        const end = lane.centerline[index + 1];
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const length = Math.max(0.0001, Math.hypot(dx, dz));
        const amount = clamp(
          ((x - start.x) * dx + (z - start.z) * dz) / (length * length),
          0,
          1,
        );
        const projectedX = start.x + dx * amount;
        const projectedZ = start.z + dz * amount;
        const distance = Math.hypot(x - projectedX, z - projectedZ);
        if (!best || distance < best.distance) {
          best = {
            laneId: lane.id,
            segmentIndex: index,
            x: projectedX,
            z: projectedZ,
            heading: Math.atan2(dx, dz),
            distance,
            distanceAlong: accumulated + length * amount,
            speedLimit: lane.speedLimit,
          };
        }
        accumulated += length;
      }
    }
    return best;
  }

  private angleDifference(first: number, second: number) {
    let difference = first - second;
    while (difference > Math.PI) difference -= Math.PI * 2;
    while (difference < -Math.PI) difference += Math.PI * 2;
    return difference;
  }

  private buildConnectedNpcPath(
    mapPack: GameCanvasMapPack,
    startLaneId: string,
    branchOffset: number,
  ): { segments: NpcPathSegment[]; loop: boolean } {
    const lanes = new Map(mapPack.laneGraph.lanes.map((lane) => [lane.id, lane]));
    const segments: NpcPathSegment[] = [];
    const visited = new Set<string>();
    let laneId: string | undefined = startLaneId;
    let loop = false;
    for (let hop = 0; laneId && hop < 24; hop += 1) {
      const lane = lanes.get(laneId);
      if (!lane || lane.centerline.length < 2) break;
      if (visited.has(lane.id)) {
        const first = segments[0];
        const last = segments.at(-1);
        loop = Boolean(
          first &&
          last &&
          Math.hypot(last.end.x - first.start.x, last.end.z - first.start.z) < 1.5,
        );
        break;
      }
      visited.add(lane.id);
      for (let index = 0; index < lane.centerline.length - 1; index += 1) {
        const start = lane.centerline[index];
        const end = lane.centerline[index + 1];
        const length = Math.hypot(end.x - start.x, end.z - start.z);
        if (length > 0.01) segments.push({ laneId: lane.id, start, end, length });
      }
      const successors = lane.successors ?? [];
      if (successors.length === 0) break;
      const successorId = successors[(branchOffset + hop) % successors.length];
      const successor = lanes.get(successorId);
      const last = segments.at(-1);
      const firstSuccessorPoint = successor?.centerline[0];
      if (
        !successor ||
        !last ||
        !firstSuccessorPoint ||
        Math.hypot(last.end.x - firstSuccessorPoint.x, last.end.z - firstSuccessorPoint.z) > 2.5
      ) {
        break;
      }
      laneId = successorId;
    }
    return { segments, loop };
  }

  private isNpcPositionSafe(
    npc: NpcVehicle,
    x: number,
    z: number,
    heading: number,
    requireHiddenGate: boolean,
  ): boolean {
    const playerDx = this.playerState.x - x;
    const playerDz = this.playerState.z - z;
    const playerDistance = Math.hypot(playerDx, playerDz);
    const forwardX = Math.sin(heading);
    const forwardZ = Math.cos(heading);
    const longitudinal = playerDx * forwardX + playerDz * forwardZ;
    const lateral = Math.abs(playerDx * forwardZ - playerDz * forwardX);
    const speed = Math.max(0, npc.speed);
    if (lateral < 12) {
      if (longitudinal >= 0 && longitudinal < 20) return false;
      if (longitudinal < 0 && -longitudinal < Math.max(30, speed * 3 + 6)) return false;
    }
    if (playerDistance < 18) return false;
    if (requireHiddenGate) {
      if (playerDistance < 70) return false;
      const playerForwardX = Math.sin(this.playerState.heading);
      const playerForwardZ = Math.cos(this.playerState.heading);
      const gateFromPlayerX = x - this.playerState.x;
      const gateFromPlayerZ = z - this.playerState.z;
      if (gateFromPlayerX * playerForwardX + gateFromPlayerZ * playerForwardZ > 0) return false;
    }
    for (const other of this.npcVehicles) {
      if (other === npc || other.active === false) continue;
      const requiredGap = Math.max(10, Math.max(speed, other.currentSpeed ?? other.speed) * 1.8 + 4);
      if (Math.hypot(other.laneX - x, other.z - z) < requiredGap) return false;
    }
    return true;
  }

  private tryActivateQueuedNpc(npc: NpcVehicle): boolean {
    const segments = npc.pathSegments;
    if (!segments?.length) return false;
    const segmentIndex = Math.min(npc.spawnPathSegment ?? 0, segments.length - 1);
    const segment = segments[segmentIndex];
    const distance = clamp(npc.spawnPathDistance ?? 0, 0, segment.length);
    const amount = distance / segment.length;
    const x = segment.start.x + (segment.end.x - segment.start.x) * amount;
    const z = segment.start.z + (segment.end.z - segment.start.z) * amount;
    const heading = Math.atan2(
      segment.end.x - segment.start.x,
      segment.end.z - segment.start.z,
    );
    if (!this.isNpcPositionSafe(npc, x, z, heading, true)) return false;
    npc.pathSegment = segmentIndex;
    npc.pathDistance = distance;
    npc.laneId = segment.laneId;
    npc.laneX = x;
    npc.z = z;
    npc.currentSpeed = 0;
    npc.active = true;
    npc.respawnAfterSeconds = 0;
    npc.node.setEnabled(true);
    npc.node.position.set(x, 0.12, z);
    npc.node.rotation.y = heading;
    return true;
  }

  private npcTargetSpeed(npc: NpcVehicle, segment: NpcPathSegment): number {
    let target = npc.speed;
    const heading = Math.atan2(segment.end.x - segment.start.x, segment.end.z - segment.start.z);
    const forwardX = Math.sin(heading);
    const forwardZ = Math.cos(heading);
    const desiredGap = 4 + Math.max(0, npc.currentSpeed ?? npc.speed) * 1.8;
    const applyLead = (x: number, z: number, leadSpeed: number) => {
      const dx = x - npc.laneX;
      const dz = z - npc.z;
      const ahead = dx * forwardX + dz * forwardZ;
      const lateral = Math.abs(dx * forwardZ - dz * forwardX);
      if (ahead <= 0 || lateral > 2.2) return;
      if (ahead <= 3) target = 0;
      else if (ahead < desiredGap) target = Math.min(target, Math.max(0, leadSpeed * (ahead / desiredGap)));
    };
    const playerLane = this.options.mapPack
      ? this.projectToScenarioLanes(
          this.playerState.x,
          this.playerState.z,
          this.options.mapPack.laneGraph.lanes,
        )
      : null;
    if (playerLane?.laneId === segment.laneId) {
      applyLead(this.playerState.x, this.playerState.z, this.playerState.speedMps);
    }
    for (const other of this.npcVehicles) {
      if (other === npc || other.active === false || other.laneId !== segment.laneId) continue;
      applyLead(other.laneX, other.z, other.currentSpeed ?? other.speed);
    }
    if (this.options.mapPack) {
      for (const control of this.options.mapPack.laneGraph.controls) {
        if (control.type !== "signal" && control.type !== "railway_signal") continue;
        for (const approach of control.approaches ?? []) {
          if (!approach.laneIds.includes(segment.laneId)) continue;
          const mustStop =
            control.type === "railway_signal"
              ? this.trafficLightIsRed
              : authoredSignalRequiresStop(
                  this.authoredSignalAspect(control, approach),
                  true,
                );
          if (!mustStop) continue;
          const stop = resolveLaneAnchor(this.options.mapPack.laneGraph.lanes, approach.stopLine);
          if (stop) applyLead(stop.x, stop.z, 0);
        }
      }
    }
    return target;
  }

  private computeNpcRenderSnapshots(dt: number): NpcRenderSnapshot[] {
    const snapshots: NpcRenderSnapshot[] = [];
    for (const npc of this.npcVehicles) {
      if (npc.active === false) {
        npc.respawnAfterSeconds = Math.max(0, (npc.respawnAfterSeconds ?? 0) - dt);
        if ((npc.respawnAfterSeconds ?? 0) <= 0) this.tryActivateQueuedNpc(npc);
      }
      const segments = npc.pathSegments;
      if (npc.active === false || !segments?.length) {
        snapshots.push({ x: npc.laneX, z: npc.z, heading: npc.node.rotation.y, active: false });
        continue;
      }
      let segmentIndex = npc.pathSegment ?? 0;
      let segment = segments[segmentIndex];
      const targetSpeed = this.npcTargetSpeed(npc, segment);
      const currentSpeed = npc.currentSpeed ?? npc.speed;
      const speedDelta = clamp(targetSpeed - currentSpeed, -5 * dt, 2.2 * dt);
      npc.currentSpeed = Math.max(0, currentSpeed + speedDelta);
      let distance = (npc.pathDistance ?? 0) + npc.currentSpeed * dt;
      while (distance > segment.length) {
        distance -= segment.length;
        segmentIndex += 1;
        if (segmentIndex >= segments.length) {
          if (npc.loop) segmentIndex = 0;
          else {
            npc.active = false;
            npc.respawnAfterSeconds = 2.5;
            npc.currentSpeed = 0;
            break;
          }
        }
        segment = segments[segmentIndex];
      }
      if (npc.active === false) {
        snapshots.push({ x: npc.laneX, z: npc.z, heading: npc.node.rotation.y, active: false });
        continue;
      }
      segment = segments[segmentIndex];
      const amount = clamp(distance / segment.length, 0, 1);
      npc.pathSegment = segmentIndex;
      npc.pathDistance = distance;
      npc.laneId = segment.laneId;
      npc.laneX = segment.start.x + (segment.end.x - segment.start.x) * amount;
      npc.z = segment.start.z + (segment.end.z - segment.start.z) * amount;
      snapshots.push({
        x: npc.laneX,
        z: npc.z,
        heading: Math.atan2(segment.end.x - segment.start.x, segment.end.z - segment.start.z),
        active: true,
      });
    }
    return snapshots;
  }

  private applyNpcRenderSnapshots(snapshots: readonly NpcRenderSnapshot[]) {
    for (let index = 0; index < snapshots.length; index += 1) {
      const npc = this.npcVehicles[index];
      const snapshot = snapshots[index];
      if (!npc || !snapshot) continue;
      npc.node.setEnabled(snapshot.active);
      if (!snapshot.active) continue;
      npc.node.position.set(snapshot.x, 0.12, snapshot.z);
      npc.node.rotation.y = snapshot.heading;
    }
  }

  private applySimulationNpcSnapshots(snapshot: SimulationSnapshot) {
    for (const npc of this.npcVehicles) {
      npc.active = false;
      npc.node.setEnabled(false);
    }
    for (const vehicle of snapshot.npcs) {
      const numericIndex = Number.parseInt(vehicle.id.replace(/^npc-/, ""), 10) - 1;
      const npc =
        this.npcVehicles.find((candidate) => candidate.simulationId === vehicle.id) ??
        this.npcVehicles[numericIndex] ??
        this.npcVehicles.find((candidate) => !candidate.simulationId);
      if (!npc) continue;
      npc.simulationId = vehicle.id;
      npc.active = true;
      npc.laneId = vehicle.laneId;
      npc.currentSpeed = vehicle.speedMps;
      npc.speed = vehicle.speedMps;
      npc.laneX = vehicle.x;
      npc.z = vehicle.z;
      npc.node.setEnabled(true);
      npc.node.position.set(vehicle.x, 0.12, vehicle.z);
      npc.node.rotation.y = vehicle.heading;
    }
  }

  private applySimulationSnapshot(snapshot: SimulationSnapshot) {
    const previousX = this.playerState.x;
    const previousZ = this.playerState.z;
    this.simulationSnapshot = snapshot;
    this.playerState.previousX = previousX;
    this.playerState.previousZ = previousZ;
    this.playerState.x = snapshot.player.x;
    this.playerState.z = snapshot.player.z;
    this.playerState.heading = snapshot.player.heading;
    this.playerState.speedMps = snapshot.player.speedMps;
    this.playerState.gear = snapshot.player.gear === "drive" ? "D" : "R";
    this.playerState.indicator = snapshot.player.signal;
    this.score = snapshot.score.total;
    this.activeTrafficSide = snapshot.trafficSide;
    this.applySimulationNpcSnapshots(snapshot);
    this.updateAuthoredSignalVisuals();
    this.updateManeuverCoaching(snapshot);

    const npcHonkActive = snapshot.honk.active;
    if (npcHonkActive && !this.lastSimulationHonkActive) {
      this.hornUntil = eventNow() + 1_150;
      this.playHornTone();
    }
    this.lastSimulationHonkActive = npcHonkActive;
  }

  private updateManeuverCoaching(snapshot: SimulationSnapshot) {
    for (const maneuver of snapshot.maneuvers ?? []) {
      const previousPhase = this.maneuverPhases.get(maneuver.id);
      if (previousPhase === maneuver.phase) continue;
      this.maneuverPhases.set(maneuver.id, maneuver.phase);
      const prompt = this.options.lesson?.coachPrompts.find(
        (candidate) =>
          candidate.trigger.type === "maneuver_phase" &&
          candidate.trigger.maneuverId === maneuver.id &&
          candidate.trigger.phase === maneuver.phase &&
          !this.triggeredPrompts.has(candidate.id),
      );
      if (!prompt) continue;
      this.triggeredPrompts.add(prompt.id);
      this.instruction = prompt.message;
      this.emit("coaching", prompt.message, "info");
    }
  }

  private processSimulationEvents(events: readonly SimulationRuleEvent[]) {
    for (const event of events) {
      const prompt = this.options.lesson?.coachPrompts.find(
        (candidate) =>
          candidate.trigger.type === "rule_event" &&
          candidate.trigger.ruleCode === event.code &&
          !this.triggeredPrompts.has(candidate.id),
      );
      if (prompt) this.triggeredPrompts.add(prompt.id);
      const correction = prompt?.message ?? event.correction;
      this.instruction = correction;
      this.lastSimulationCoachMessage = correction;
      this.playCoachTone();
      this.emit(
        event.severity === "critical" ? "incident" : "coaching",
        `${event.message} ${correction}`,
        event.severity === "critical" ? "critical" : "warning",
        {
          ruleCode: event.code,
          penalty: event.penalty,
          evidence: event.evidence,
        },
      );
      if (event.severity === "critical") this.setPaused(true);
    }
  }

  private publishSimulationCoachMessage(snapshot: SimulationSnapshot) {
    const message = snapshot.coachingMessage;
    if (!message || message === this.lastSimulationCoachMessage) return;
    this.lastSimulationCoachMessage = message;
    this.instruction = message;
    this.emit("coaching", message, "info");
  }

  private updateAuthoredSignalVisuals() {
    for (const head of this.authoredSignalHeads) {
      const simulationLight = this.simulationSnapshot.trafficLights.find(
        (light) => head.trafficLightIds.includes(light.id),
      );
      const aspect: AuthoredSignalAspect = simulationLight?.state ??
        authoredSignalAspectAt({
          elapsedSeconds: this.trafficLightSeconds,
          controlId: head.controlId,
          phaseGroup: head.phaseGroup,
          phaseGroups: head.phaseGroups,
          style: head.style,
        });
      const redOn =
        aspect === "red" || aspect === "red_amber" || aspect === "all_red";
      const amberOn = aspect === "amber" || aspect === "red_amber";
      const greenOn = aspect === "green";
      head.redMaterial.emissiveColor.copyFromFloats(
        redOn ? 0.75 : 0.08,
        redOn ? 0.025 : 0.005,
        redOn ? 0.015 : 0.005,
      );
      head.amberMaterial.emissiveColor.copyFromFloats(
        amberOn ? 0.72 : 0.08,
        amberOn ? 0.31 : 0.04,
        amberOn ? 0.015 : 0.005,
      );
      head.greenMaterial.emissiveColor.copyFromFloats(
        greenOn ? 0.01 : 0.005,
        greenOn ? 0.46 : 0.06,
        greenOn ? 0.1 : 0.012,
      );
    }
    for (const crossing of this.railwayCrossingVisuals) {
      const light = this.simulationSnapshot.trafficLights.find((candidate) =>
        crossing.trafficLightIds.includes(candidate.id),
      );
      const warningActive = Boolean(light && light.state !== "green");
      const flashIndex = Math.floor(this.simulationSnapshot.elapsedMs / 360) % 2;
      crossing.lampMaterials.forEach((material, index) => {
        const illuminated = warningActive && index % 2 === flashIndex;
        material.emissiveColor.copyFromFloats(
          illuminated ? 0.92 : 0.08,
          illuminated ? 0.035 : 0.005,
          illuminated ? 0.02 : 0.005,
        );
      });
      const targetBarrierRotation = warningActive ? 0 : -1.22;
      if (this.options.reducedMotion) {
        crossing.barrierPivot.rotation.z = targetBarrierRotation;
      } else {
        crossing.barrierPivot.rotation.z +=
          (targetBarrierRotation - crossing.barrierPivot.rotation.z) * 0.16;
      }
    }
  }

  private updateTraffic(dt: number) {
    this.trafficLightSeconds = (this.trafficLightSeconds + dt) % 3600;
    this.trafficLightIsRed = this.trafficLightSeconds % 14 > 8;
    if (this.signalRedMaterial && this.signalAmberMaterial && this.signalGreenMaterial) {
      this.signalRedMaterial.emissiveColor.copyFromFloats(
        this.trafficLightIsRed ? 0.75 : 0.08,
        this.trafficLightIsRed ? 0.025 : 0.005,
        this.trafficLightIsRed ? 0.015 : 0.005,
      );
      this.signalGreenMaterial.emissiveColor.copyFromFloats(
        this.trafficLightIsRed ? 0.005 : 0.01,
        this.trafficLightIsRed ? 0.06 : 0.46,
        this.trafficLightIsRed ? 0.012 : 0.1,
      );
      this.signalAmberMaterial.emissiveColor.copyFromFloats(0.08, 0.04, 0.005);
    }
    this.updateAuthoredSignalVisuals();
    if (this.options.mapPack && this.options.lesson) {
      this.applyNpcRenderSnapshots(this.computeNpcRenderSnapshots(dt));
      return;
    }
    for (const npc of this.npcVehicles) {
      const nextZ = npc.z + npc.direction * npc.speed * dt;
      const sharesPlayerLane = Math.abs(npc.laneX - this.playerState.x) < 1.1;
      const approachingFromBehind =
        npc.direction > 0 &&
        nextZ < this.playerState.z &&
        this.playerState.z - nextZ < 9;
      if (!(sharesPlayerLane && approachingFromBehind)) {
        npc.z = nextZ;
      }
      if (npc.direction > 0 && npc.z > 87) npc.z = -78;
      if (npc.direction < 0 && npc.z < -78) npc.z = 87;
      npc.node.position.x = npc.laneX;
      npc.node.position.z = npc.z;
      npc.node.rotation.y = npc.direction > 0 ? 0 : Math.PI;
    }
  }

  private animatePedestrians(dt: number) {
    for (const pedestrian of this.pedestrians) {
      pedestrian.phase = (pedestrian.phase + pedestrian.speed * dt) % 18;
      const progress = pedestrian.phase / 18;
      if (pedestrian.origin && pedestrian.heading !== undefined) {
        const span = pedestrian.span ?? 16;
        const along = -span / 2 + progress * span;
        pedestrian.node.position.x = pedestrian.origin.x + Math.sin(pedestrian.heading) * along;
        pedestrian.node.position.z = pedestrian.origin.z + Math.cos(pedestrian.heading) * along;
        pedestrian.node.rotation.y = pedestrian.heading;
      } else {
        pedestrian.node.position.x = -8 + progress * 16;
        pedestrian.node.position.z = pedestrian.z;
        pedestrian.node.rotation.y = Math.PI / 2;
      }
    }
  }

  private updatePlayerVisuals(interpolation: number) {
    const state = this.playerState;
    const positionBlend = this.options.reducedMotion ? 1 : clamp(0.35 + interpolation * 0.65, 0, 1);
    this.displayedX += (state.x - this.displayedX) * positionBlend;
    this.displayedZ += (state.z - this.displayedZ) * positionBlend;
    let headingDelta = state.heading - this.displayedHeading;
    while (headingDelta > Math.PI) headingDelta -= Math.PI * 2;
    while (headingDelta < -Math.PI) headingDelta += Math.PI * 2;
    this.displayedHeading += headingDelta * positionBlend;
    this.player.position.set(this.displayedX, 0.12, this.displayedZ);
    this.player.rotation.y = this.displayedHeading;
    const visualSteer = this.mergedInput().steer;
    if (this.steeringAssembly) {
      this.steeringAssembly.rotation.y = resolveSteeringWheelSpin(visualSteer);
    }
  }

  private updateCamera(dt: number) {
    const routeHeading =
      this.playerState.speedMps < 0.2
        ? this.projectToAuthoredRoute(this.displayedX, this.displayedZ)
        : null;
    const chaseHeading =
      routeHeading && routeHeading.distance < 5
        ? routeHeading.heading
        : this.displayedHeading;
    const forward = new Vector3(
      Math.sin(chaseHeading),
      0,
      Math.cos(chaseHeading),
    );
    const right = new Vector3(forward.z, 0, -forward.x);
    const base = new Vector3(this.displayedX, 0.12, this.displayedZ);
    this.cameraMotionSeconds += dt * this.playerState.speedMps;
    const look = this.mergedInput().quickLook;
    const quickLookAngle = Math.abs(look) > 1.5 ? Math.PI : look * 1.18;

    if (this.cameraMode === "first") {
      const seatSide = this.options.steeringSide === "left" ? -0.46 : 0.46;
      const headBob =
        this.options.headBob && !this.options.reducedMotion
          ? Math.sin(this.cameraMotionSeconds * 1.9) *
            Math.min(0.015, this.playerState.speedMps * 0.0015)
          : 0;
      const poses = resolveCockpitCameraPoses({
        x: this.displayedX,
        z: this.displayedZ,
        vehicleHeading: this.displayedHeading,
        cameraHeading: this.displayedHeading,
        seatSide,
        headBob,
        quickLookAngle,
        viewportAspectRatio:
          this.engine.getRenderWidth() /
          Math.max(1, this.engine.getRenderHeight()),
      });
      this.firstCamera.position.set(
        poses.first.x,
        poses.first.y,
        poses.first.z,
      );
      this.firstCamera.rotation.set(
        poses.first.rotationX,
        poses.first.rotationY,
        0,
      );
      this.rearCamera.position.set(
        poses.rear.x,
        poses.rear.y,
        poses.rear.z,
      );
      this.rearCamera.rotation.set(
        poses.rear.rotationX,
        poses.rear.rotationY,
        0,
      );
    } else {
      const target = base.add(forward.scale(3.5)).add(new Vector3(0, 1.05, 0));
      const cameraShake =
        this.options.cameraShake && !this.options.reducedMotion
          ? Math.sin(this.cameraMotionSeconds * 2.7) *
            Math.min(0.08, this.playerState.speedMps * 0.004)
          : 0;
      const desiredPosition = base
        .subtract(forward.scale(10.5))
        .add(right.scale(cameraShake))
        .add(new Vector3(0, 5.5 + Math.abs(cameraShake) * 0.35, 0));
      if (this.options.reducedMotion) {
        this.thirdCamera.position.copyFrom(desiredPosition);
      } else {
        const smooth = 1 - Math.exp(-7 * dt);
        this.thirdCamera.position.copyFrom(
          Vector3.Lerp(this.thirdCamera.position, desiredPosition, smooth),
        );
      }
      this.thirdCamera.setTarget(target);
    }
  }

  private updateIndicatorLights(dt: number) {
    this.indicatorBlinkSeconds = (this.indicatorBlinkSeconds + dt) % 0.8;
    const blinkOn = this.indicatorBlinkSeconds < 0.4;
    const amberOn = new Color3(1, 0.45, 0.03);
    const amberOff = new Color3(0.18, 0.08, 0.01);
    for (const mesh of this.leftIndicatorMeshes) {
      const material = mesh.material as StandardMaterial;
      material.emissiveColor =
        this.playerState.indicator === "left" && blinkOn ? amberOn : amberOff;
    }
    for (const mesh of this.rightIndicatorMeshes) {
      const material = mesh.material as StandardMaterial;
      material.emissiveColor =
        this.playerState.indicator === "right" && blinkOn ? amberOn : amberOff;
    }
  }

  private buildScenarioEnvironment(mapPack: GameCanvasMapPack) {
    const scene = this.scene;
    const mapId = mapPack.id.toLowerCase();
    const sky = mapId.includes("tokyo")
      ? new Color4(0.72, 0.82, 0.88, 1)
      : mapId.includes("london")
        ? new Color4(0.69, 0.77, 0.81, 1)
      : mapId.includes("milton")
        ? new Color4(0.66, 0.77, 0.8, 1)
        : mapId.includes("calais") || mapId.includes("folkestone")
          ? new Color4(0.67, 0.8, 0.86, 1)
          : new Color4(0.61, 0.79, 0.9, 1);
    scene.clearColor = sky;

    const grass = makeMaterial(scene, "scenario-ground", new Color3(0.24, 0.39, 0.25));
    const asphalt = makeMaterial(scene, "scenario-asphalt", new Color3(0.105, 0.13, 0.145));
    const sharedSpace = makeMaterial(
      scene,
      "scenario-shared-space",
      new Color3(0.25, 0.255, 0.245),
    );
    const terminalSurface = makeMaterial(
      scene,
      "scenario-terminal-surface",
      new Color3(0.145, 0.16, 0.17),
    );
    const routeMaterial = makeMaterial(
      scene,
      "scenario-route",
      new Color3(0.86, 0.66, 0.19),
      new Color3(0.08, 0.045, 0.005),
    );
    routeMaterial.alpha = 0.58;
    const laneMaterial = makeMaterial(scene, "scenario-marking", new Color3(0.88, 0.88, 0.79));
    const yellowMarkingMaterial = makeMaterial(
      scene,
      "scenario-yellow-marking",
      new Color3(0.9, 0.68, 0.08),
    );
    const dark = makeMaterial(scene, "scenario-fixture", new Color3(0.08, 0.1, 0.1));
    const stopRed = makeMaterial(scene, "scenario-stop", new Color3(0.72, 0.08, 0.06));
    const yieldGold = makeMaterial(scene, "scenario-yield", new Color3(0.92, 0.68, 0.13));
    const checkpointMaterial = makeMaterial(
      scene,
      "scenario-checkpoint",
      new Color3(0.12, 0.68, 0.62),
      new Color3(0.025, 0.16, 0.13),
    );

    const hemi = new HemisphericLight("scenario-sky-light", new Vector3(0.1, 1, 0.15), scene);
    hemi.intensity = 0.82;
    hemi.diffuse = new Color3(0.93, 0.96, 1);
    hemi.groundColor = new Color3(0.2, 0.25, 0.22);
    const sun = new DirectionalLight("scenario-sun", new Vector3(-0.42, -1, 0.48), scene);
    sun.intensity = 0.68;

    const ground = MeshBuilder.CreateGround(
      "scenario-world",
      {
        width: Math.max(90, mapPack.geometry.worldSize.x + 36),
        height: Math.max(90, mapPack.geometry.worldSize.z + 36),
        subdivisions: 1,
      },
      scene,
    );
    setMeshMaterial(ground, grass);

    const roadSurfaces = mapPack.geometry.roadSurfaces?.length
      ? mapPack.geometry.roadSurfaces
      : mapPack.laneGraph.lanes.map((lane) => ({
          id: `legacy-${lane.id}`,
          centerline: lane.centerline,
          widthM: lane.widthM ?? mapPack.geometry.roadWidth,
          laneIds: [lane.id],
          surfaceType: "standard" as const,
          markings: [],
        }));
    for (const surface of roadSurfaces) {
      const surfaceMaterial =
        surface.surfaceType === "shared_space"
          ? sharedSpace
          : surface.surfaceType === "terminal"
            ? terminalSurface
            : asphalt;
      for (let index = 0; index < surface.centerline.length - 1; index += 1) {
        const start = surface.centerline[index];
        const end = surface.centerline[index + 1];
        this.createFlatSegment(
          `road-${surface.id}-${index}`,
          start,
          end,
          surface.widthM,
          0.07,
          surfaceMaterial,
        );
      }
      for (const marking of surface.markings) {
        const material =
          marking.color === "yellow" ? yellowMarkingMaterial : laneMaterial;
        if (
          marking.style === "centre_dashed" ||
          marking.style === "lane_dashed" ||
          marking.style === "give_way"
        ) {
          this.createDashedPath(
            `road-marking-${surface.id}-${marking.id}`,
            marking.points,
            marking.style === "give_way" ? 0.24 : 0.11,
            0.12,
            material,
            marking.style === "centre_dashed"
              ? 3.2
              : marking.style === "give_way"
                ? 0.65
                : 2.2,
            marking.style === "centre_dashed"
              ? 4.3
              : marking.style === "give_way"
                ? 0.55
                : 3.4,
          );
          continue;
        }
        this.createSolidPath(
          `road-marking-${surface.id}-${marking.id}`,
          marking.points,
          marking.style === "box_junction" ? 0.18 : 0.11,
          0.12,
          material,
        );
      }
    }
    for (const [routeIndex, laneId] of (this.options.lesson?.route ?? []).entries()) {
      const lane = mapPack.laneGraph.lanes.find((candidate) => candidate.id === laneId);
      if (!lane || lane.role === "connector") continue;
      this.createRouteChevrons(
        lane,
        routeMaterial,
        routeIndex,
        mapPack.laneGraph.conflictZones,
      );
    }

    const random = seededUnit(this.options.lesson?.trafficSeed ?? 47);
    const buildingPalette: Record<string, Color3> = {
      brick: new Color3(0.54, 0.29, 0.22),
      sandstone: new Color3(0.7, 0.61, 0.46),
      stone: new Color3(0.52, 0.53, 0.51),
      concrete: new Color3(0.48, 0.51, 0.52),
      stucco: new Color3(0.74, 0.67, 0.55),
      "pale-concrete": new Color3(0.68, 0.69, 0.66),
      plaster: new Color3(0.72, 0.7, 0.63),
      tile: new Color3(0.48, 0.52, 0.55),
      "wood-plaster": new Color3(0.58, 0.49, 0.39),
      "terracotta-museum": new Color3(0.63, 0.34, 0.25),
      "pale-stone-museum": new Color3(0.77, 0.76, 0.71),
      "red-brick-museum": new Color3(0.55, 0.29, 0.23),
      "london-brick": new Color3(0.49, 0.32, 0.27),
      "white-stucco": new Color3(0.82, 0.81, 0.75),
    };
    for (const block of mapPack.geometry.blocks) {
      const baseColor = buildingPalette[block.material] ?? new Color3(0.56, 0.5, 0.43);
      const material = makeMaterial(scene, `block-${block.id}`, baseColor);
      const isLondonMuseumBlock =
        mapId.includes("london") && block.material.endsWith("-museum");
      if (isLondonMuseumBlock) {
        const wingWidth = Math.max(12, block.size.x * 0.23);
        const wingHeight = Math.max(11, block.heightRange[0] * 0.72);
        for (const side of [-1, 1]) {
          createBox(
            scene,
            `building-${block.id}-wing-${side}`,
            { width: wingWidth, height: wingHeight, depth: block.size.z * 0.82 },
            new Vector3(
              block.center.x + side * block.size.x * 0.37,
              wingHeight / 2,
              block.center.z,
            ),
            material,
          );
        }
        continue;
      }
      const count = Math.max(1, Math.round(3 + block.density * 7));
      for (let index = 0; index < count; index += 1) {
        const columns = Math.ceil(Math.sqrt(count));
        const row = Math.floor(index / columns);
        const column = index % columns;
        const cellWidth = block.size.x / columns;
        const rows = Math.ceil(count / columns);
        const cellDepth = block.size.z / rows;
        const width = Math.max(5, cellWidth * (0.58 + random() * 0.24));
        const depth = Math.max(5, cellDepth * (0.58 + random() * 0.24));
        const height = block.heightRange[0] + random() * (block.heightRange[1] - block.heightRange[0]);
        const x = block.center.x - block.size.x / 2 + cellWidth * (column + 0.5);
        const z = block.center.z - block.size.z / 2 + cellDepth * (row + 0.5);
        createBox(
          scene,
          `building-${block.id}-${index}`,
          { width, height, depth },
          new Vector3(x, height / 2, z),
          material,
        );
      }
    }

    for (const landmark of mapPack.geometry.landmarks) {
      const color = colorFromHex(landmark.color, new Color3(0.35, 0.5, 0.4));
      const material = makeMaterial(scene, `landmark-${landmark.id}`, color);
      if (mapId.includes("london") && this.buildLondonLandmark(landmark, material)) {
        continue;
      }
      if (mapId.includes("orientation") && landmark.id === "yard-cones") {
        for (let index = 0; index < 9; index += 1) {
          const column = index % 3;
          const row = Math.floor(index / 3);
          createCylinder(
            scene,
            `${landmark.id}-${index}`,
            { height: 0.9, diameterTop: 0.08, diameterBottom: 0.58, tessellation: 8 },
            new Vector3(
              landmark.center.x - 3 + column * 3,
              0.48,
              landmark.center.z - 2.5 + row * 2.5,
            ),
            material,
          );
        }
      } else if (landmark.kind === "park") {
        createBox(
          scene,
          landmark.id,
          { width: landmark.size.x, height: 0.2, depth: landmark.size.z },
          new Vector3(landmark.center.x, 0.12, landmark.center.z),
          material,
        );
        createCylinder(
          scene,
          `${landmark.id}-feature`,
          { height: 2.2, diameterTop: 0.5, diameterBottom: 4.5 },
          new Vector3(landmark.center.x, 1.25, landmark.center.z),
          material,
        );
      } else if (landmark.kind === "railway") {
        for (const offset of [-1.25, 1.25]) {
          createBox(
            scene,
            `${landmark.id}-rail-${offset}`,
            { width: landmark.size.x, height: 0.14, depth: 0.2 },
            new Vector3(landmark.center.x, 0.16, landmark.center.z + offset),
            material,
          );
        }
      } else if (landmark.kind === "tower") {
        createCylinder(
          scene,
          landmark.id,
          { height: Math.max(12, landmark.size.z), diameter: Math.max(4, landmark.size.x * 0.4) },
          new Vector3(landmark.center.x, Math.max(12, landmark.size.z) / 2, landmark.center.z),
          material,
        );
      } else {
        const height = landmark.kind === "terminal" ? 8 : 5;
        createBox(
          scene,
          landmark.id,
          { width: landmark.size.x, height, depth: landmark.size.z },
          new Vector3(landmark.center.x, height / 2, landmark.center.z),
          material,
        );
      }
    }

    if (mapId.includes("london")) {
      this.buildLondonStreetFurniture();
    }

    const redLamp = makeMaterial(scene, "scenario-signal-red", new Color3(0.45, 0.02, 0.01));
    const amberLamp = makeMaterial(scene, "scenario-signal-amber", new Color3(0.55, 0.27, 0.015));
    const greenLamp = makeMaterial(scene, "scenario-signal-green", new Color3(0.02, 0.4, 0.12));
    const paleFixture = makeMaterial(scene, "scenario-control-pale", new Color3(0.9, 0.9, 0.82));
    const warningYellow = makeMaterial(scene, "scenario-control-warning", new Color3(0.94, 0.68, 0.08));
    const restrictedBlue = makeMaterial(scene, "scenario-control-restricted", new Color3(0.08, 0.31, 0.56));
    const controlMaterials: TrafficControlMaterials = {
      dark,
      pale: paleFixture,
      redLamp,
      amberLamp,
      greenLamp,
      stopRed,
      yieldGold,
      warningYellow,
      restrictedBlue,
    };
    this.signalRedMaterial = redLamp;
    this.signalAmberMaterial = amberLamp;
    this.signalGreenMaterial = greenLamp;
    for (const control of mapPack.laneGraph.controls) {
      const logicalHeading = degreesToRadians(control.headingDeg);
      const offset = mapPack.geometry.roadWidth / 2 + 1.25;
      const inferredPosition = {
        x: control.position.x + Math.cos(logicalHeading) * offset,
        z: control.position.z - Math.sin(logicalHeading) * offset,
      };
      const installations = control.installations?.length
        ? control.installations
        : [{
            id: `${control.id}-legacy-safe`,
            position:
              control.type === "crosswalk" || control.type === "box_junction"
                ? control.position
                : inferredPosition,
            headingDeg: control.headingDeg,
            mounting:
              control.type === "crosswalk" || control.type === "box_junction"
                ? "road_marking" as const
                : control.type === "railway_signal"
                  ? "railway_crossing" as const
                  : "roadside_pole" as const,
            style:
              control.type === "signal"
                ? (mapId.includes("london") ? "uk_signal" as const : "nyc_signal" as const)
                : control.type === "railway_signal"
                  ? "japan_railway" as const
                  : control.type === "crosswalk"
                    ? "crosswalk" as const
                    : control.type === "box_junction"
                      ? "box_junction" as const
                      : control.type === "restricted_lane"
                        ? "restricted_lane" as const
                        : control.type === "side_swap_gate"
                          ? "side_swap_gate" as const
                          : control.type === "yield"
                            ? "yield_sign" as const
                            : "stop_sign" as const,
            role: "primary" as const,
            approachIds: (control.approaches ?? []).map((approach) => approach.id),
          }];
      const phaseGroups = [
        ...new Set((control.approaches ?? []).map((approach) => approach.phaseGroup)),
      ];
      for (const installation of installations) {
        if (installation.style === "nyc_signal" || installation.style === "uk_signal") {
          const installationApproaches = (installation.approachIds ?? [])
            .map((approachId) =>
              (control.approaches ?? []).find((approach) => approach.id === approachId),
            )
            .filter((approach): approach is NonNullable<typeof approach> => Boolean(approach));
          this.buildSignalInstallation(
            control.id,
            installation,
            mapPack.geometry.roadWidth,
            controlMaterials,
            {
              trafficLightIds: installationApproaches.length
                ? installationApproaches.map((approach) => approach.id)
                : (control.approaches ?? []).map((approach) => approach.id),
              phaseGroup: installationApproaches[0]?.phaseGroup ?? phaseGroups[0] ?? control.id,
              phaseGroups: phaseGroups.length ? phaseGroups : [control.id],
              style: installation.style,
            },
          );
          continue;
        }
        if (installation.style === "japan_railway") {
          this.buildRailwayCrossingInstallation(
            control.id,
            installation,
            controlMaterials,
            installation.approachIds?.length
              ? installation.approachIds
              : (control.approaches ?? []).map((approach) => approach.id),
          );
          continue;
        }
        if (installation.mounting === "road_marking") {
          this.buildRoadMarkingInstallation(
            control,
            installation,
            mapPack.geometry.roadWidth,
            laneMaterial,
            warningYellow,
          );
          continue;
        }
        if (installation.style === "side_swap_gate") {
          this.buildTerminalPortal(
            control.id,
            installation,
            mapPack.geometry.roadWidth,
            controlMaterials,
          );
          continue;
        }
        const pole = createCylinder(
          scene,
          `${control.id}-${installation.id}-pole`,
          { height: 3.1, diameter: 0.17, tessellation: 14 },
          new Vector3(installation.position.x, 1.55, installation.position.z),
          dark,
        );
        pole.rotation.y = degreesToRadians(installation.headingDeg);
        const isYield = installation.style === "yield_sign";
        const sign = createCylinder(
          scene,
          `${control.id}-${installation.id}-sign`,
          { height: 0.13, diameter: 0.92, tessellation: isYield ? 3 : 8 },
          new Vector3(0, 1.2, 0),
          installation.style === "restricted_lane"
            ? restrictedBlue
            : isYield
              ? yieldGold
              : stopRed,
          pole,
        );
        sign.rotation.x = Math.PI / 2;
      }
      for (const approach of control.approaches ?? []) {
        const stop = resolveLaneAnchor(mapPack.laneGraph.lanes, approach.stopLine);
        const lane = mapPack.laneGraph.lanes.find(
          (candidate) => candidate.id === approach.stopLine.laneId,
        );
        if (!stop || !lane) continue;
        const halfWidth = (lane.widthM ?? 3.2) / 2;
        const sideX = Math.cos(stop.heading);
        const sideZ = -Math.sin(stop.heading);
        this.createFlatSegment(
          `${control.id}-${approach.id}-stop-line`,
          { x: stop.x - sideX * halfWidth, z: stop.z - sideZ * halfWidth },
          { x: stop.x + sideX * halfWidth, z: stop.z + sideZ * halfWidth },
          0.28,
          0.147,
          laneMaterial,
        );
      }
    }

    for (const checkpoint of this.authoredCheckpoints) {
      this.checkpointVisuals.push(
        this.createCheckpointTarget(checkpoint, checkpointMaterial),
      );
    }
    this.updateGuidanceVisuals();
  }

  /**
   * Gives the South Kensington miniature a readable silhouette without using
   * imagery, branding, or detailed replicas of the real museum buildings.
   */
  private buildLondonLandmark(
    landmark: GameCanvasMapPack["geometry"]["landmarks"][number],
    material: StandardMaterial,
  ): boolean {
    const scene = this.scene;
    const trim = makeMaterial(scene, `${landmark.id}-trim`, new Color3(0.82, 0.76, 0.65));
    const windows = makeMaterial(scene, `${landmark.id}-windows`, new Color3(0.12, 0.2, 0.23));
    const roof = makeMaterial(scene, `${landmark.id}-roof`, new Color3(0.25, 0.22, 0.2));

    if (landmark.id === "london-natural-history-museum") {
      const height = 12;
      createBox(
        scene,
        landmark.id,
        { width: landmark.size.x, height, depth: landmark.size.z },
        new Vector3(landmark.center.x, height / 2, landmark.center.z),
        material,
      );
      createBox(
        scene,
        `${landmark.id}-parapet`,
        { width: landmark.size.x + 1.2, height: 1.05, depth: landmark.size.z + 1.2 },
        new Vector3(landmark.center.x, height + 0.4, landmark.center.z),
        trim,
      );
      for (let column = -3; column <= 3; column += 1) {
        const x = landmark.center.x + column * (landmark.size.x / 8);
        createBox(
          scene,
          `${landmark.id}-pilaster-${column}`,
          { width: 1.2, height: 9.5, depth: 0.65 },
          new Vector3(x, 5.4, landmark.center.z - landmark.size.z / 2 - 0.35),
          trim,
        );
        if (column !== 0) {
          createBox(
            scene,
            `${landmark.id}-window-${column}`,
            { width: 3.4, height: 2.7, depth: 0.18 },
            new Vector3(
              x + landmark.size.x / 16,
              6.4,
              landmark.center.z - landmark.size.z / 2 - 0.7,
            ),
            windows,
          );
        }
      }
      createBox(
        scene,
        `${landmark.id}-entrance`,
        { width: 7.5, height: 6.2, depth: 0.85 },
        new Vector3(
          landmark.center.x,
          3.1,
          landmark.center.z - landmark.size.z / 2 - 0.5,
        ),
        roof,
      );
      return true;
    }

    if (landmark.id === "london-natural-history-tower") {
      const height = 24;
      createBox(
        scene,
        landmark.id,
        { width: 11, height, depth: 11 },
        new Vector3(landmark.center.x, height / 2, landmark.center.z),
        material,
      );
      createBox(
        scene,
        `${landmark.id}-clock-band`,
        { width: 12.4, height: 2.2, depth: 12.4 },
        new Vector3(landmark.center.x, 19, landmark.center.z),
        trim,
      );
      createCylinder(
        scene,
        `${landmark.id}-roof`,
        { height: 7, diameterTop: 0.8, diameterBottom: 13.5, tessellation: 4 },
        new Vector3(landmark.center.x, height + 3.5, landmark.center.z),
        roof,
      ).rotation.y = Math.PI / 4;
      return true;
    }

    if (
      landmark.id === "london-science-museum" ||
      landmark.id === "london-victoria-and-albert-museum"
    ) {
      const isVictoriaAndAlbert = landmark.id.includes("victoria");
      const height = isVictoriaAndAlbert ? 13 : 10;
      createBox(
        scene,
        landmark.id,
        { width: landmark.size.x, height, depth: landmark.size.z },
        new Vector3(landmark.center.x, height / 2, landmark.center.z),
        material,
      );
      createBox(
        scene,
        `${landmark.id}-roofline`,
        { width: landmark.size.x + 0.8, height: 1.1, depth: landmark.size.z + 0.8 },
        new Vector3(landmark.center.x, height + 0.45, landmark.center.z),
        trim,
      );
      for (let bay = -3; bay <= 3; bay += 1) {
        const x = landmark.center.x + bay * (landmark.size.x / 8);
        createBox(
          scene,
          `${landmark.id}-bay-${bay}`,
          {
            width: isVictoriaAndAlbert ? 2.2 : 4.2,
            height: isVictoriaAndAlbert ? 6.5 : 3.1,
            depth: 0.2,
          },
          new Vector3(
            x,
            isVictoriaAndAlbert ? 6.1 : 5.3,
            landmark.center.z - landmark.size.z / 2 - 0.12,
          ),
          windows,
        );
      }
      return true;
    }

    if (landmark.id === "london-south-kensington-station") {
      createBox(
        scene,
        landmark.id,
        { width: landmark.size.x, height: 5.4, depth: landmark.size.z },
        new Vector3(landmark.center.x, 2.7, landmark.center.z),
        material,
      );
      createBox(
        scene,
        `${landmark.id}-awning`,
        { width: landmark.size.x + 2, height: 0.35, depth: 2.8 },
        new Vector3(landmark.center.x, 3.1, landmark.center.z - landmark.size.z / 2 - 1.2),
        roof,
      );
      createBox(
        scene,
        `${landmark.id}-name-board`,
        { width: 9, height: 1.1, depth: 0.2 },
        new Vector3(landmark.center.x, 4.25, landmark.center.z - landmark.size.z / 2 - 0.14),
        trim,
      );
      return true;
    }

    if (landmark.id === "london-exhibition-road-public-space") {
      const paving = makeMaterial(scene, `${landmark.id}-paving`, new Color3(0.54, 0.54, 0.5));
      createBox(
        scene,
        landmark.id,
        { width: landmark.size.x, height: 0.14, depth: landmark.size.z },
        new Vector3(landmark.center.x, 0.14, landmark.center.z),
        paving,
      );
      for (const zOffset of [-18, -6, 6, 18]) {
        createBox(
          scene,
          `${landmark.id}-paving-band-${zOffset}`,
          { width: landmark.size.x, height: 0.025, depth: 0.35 },
          new Vector3(landmark.center.x, 0.23, landmark.center.z + zOffset),
          trim,
        );
      }
      return true;
    }

    return false;
  }

  private buildLondonStreetFurniture() {
    const scene = this.scene;
    const iron = makeMaterial(scene, "london-street-iron", new Color3(0.055, 0.065, 0.065));
    const lamp = makeMaterial(
      scene,
      "london-street-lamp",
      new Color3(0.78, 0.72, 0.5),
      new Color3(0.16, 0.12, 0.05),
    );
    const planter = makeMaterial(scene, "london-planter", new Color3(0.2, 0.34, 0.19));
    const postBoxRed = makeMaterial(scene, "london-post-box", new Color3(0.62, 0.045, 0.04));

    const lampPositions = [
      [-83, -52],
      [-50, -52],
      [-2, -52],
      [25, -52],
      [28, 2],
      [56, 18],
      [28, 60],
      [56, 72],
    ] as const;
    for (let index = 0; index < lampPositions.length; index += 1) {
      const [x, z] = lampPositions[index];
      createCylinder(
        scene,
        `london-lamp-post-${index}`,
        { height: 4.7, diameter: 0.18 },
        new Vector3(x, 2.35, z),
        iron,
      );
      createBox(
        scene,
        `london-lamp-head-${index}`,
        { width: 0.62, height: 0.78, depth: 0.62 },
        new Vector3(x, 4.68, z),
        lamp,
      );
    }

    for (const [index, z] of [-2, 22, 46, 70].entries()) {
      for (const x of [32, 52]) {
        createCylinder(
          scene,
          `london-bollard-${index}-${x}`,
          { height: 0.95, diameterTop: 0.17, diameterBottom: 0.28 },
          new Vector3(x, 0.49, z),
          iron,
        );
      }
    }

    for (const [index, z] of [-8, 36, 68].entries()) {
      createCylinder(
        scene,
        `london-planter-${index}`,
        { height: 0.72, diameterTop: 1.15, diameterBottom: 0.92 },
        new Vector3(57, 0.38, z),
        planter,
      );
    }

    createCylinder(
      scene,
      "london-generic-post-box",
      { height: 1.55, diameter: 0.62 },
      new Vector3(122, 0.79, 87),
      postBoxRed,
    );
    createCylinder(
      scene,
      "london-generic-post-box-cap",
      { height: 0.28, diameterTop: 0.4, diameterBottom: 0.72 },
      new Vector3(122, 1.69, 87),
      postBoxRed,
    );
  }

  private createFlatSegment(
    name: string,
    start: GameCanvasPoint,
    end: GameCanvasPoint,
    width: number,
    y: number,
    material: StandardMaterial,
  ): Mesh | undefined {
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.01) return undefined;
    const segment = createBox(
      this.scene,
      name,
      { width, height: Math.max(0.025, y * 0.45), depth: length + 0.25 },
      new Vector3((start.x + end.x) / 2, y, (start.z + end.z) / 2),
      material,
    );
    segment.rotation.y = Math.atan2(dx, dz);
    return segment;
  }

  private createOffsetFlatSegment(
    name: string,
    start: GameCanvasPoint,
    end: GameCanvasPoint,
    offset: number,
    width: number,
    y: number,
    material: StandardMaterial,
  ) {
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.01) return;
    const lateralX = (dz / length) * offset;
    const lateralZ = (-dx / length) * offset;
    this.createFlatSegment(
      name,
      { x: start.x + lateralX, z: start.z + lateralZ },
      { x: end.x + lateralX, z: end.z + lateralZ },
      width,
      y,
      material,
    );
  }

  private createDashedPath(
    name: string,
    points: readonly GameCanvasPoint[],
    width: number,
    y: number,
    material: StandardMaterial,
    dashLength = 3,
    gapLength = 4,
  ) {
    let dashIndex = 0;
    let phase = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.hypot(dx, dz);
      if (length < 0.01) continue;
      const ux = dx / length;
      const uz = dz / length;
      for (let distance = -phase; distance < length; distance += dashLength + gapLength) {
        const from = Math.max(0, distance);
        const to = Math.min(length, distance + dashLength);
        if (to - from > 0.2) {
          this.createFlatSegment(
            `${name}-${dashIndex}`,
            { x: start.x + ux * from, z: start.z + uz * from },
            { x: start.x + ux * to, z: start.z + uz * to },
            width,
            y,
            material,
          );
          dashIndex += 1;
        }
      }
      phase = (phase + length) % (dashLength + gapLength);
    }
  }

  private createSolidPath(
    name: string,
    points: readonly GameCanvasPoint[],
    width: number,
    y: number,
    material: StandardMaterial,
  ) {
    for (let index = 0; index < points.length - 1; index += 1) {
      this.createFlatSegment(
        `${name}-${index}`,
        points[index],
        points[index + 1],
        width,
        y,
        material,
      );
    }
  }

  private createRouteChevrons(
    lane: GameCanvasLane,
    material: StandardMaterial,
    routeIndex: number,
    conflictZones: GameCanvasMapPack["laneGraph"]["conflictZones"],
  ) {
    let travelled = 0;
    let nextChevronAt = 7;
    let index = 0;
    const halfSpan = resolveRouteChevronHalfSpan(lane.widthM ?? 3.2);
    for (let segmentIndex = 0; segmentIndex < lane.centerline.length - 1; segmentIndex += 1) {
      const start = lane.centerline[segmentIndex];
      const end = lane.centerline[segmentIndex + 1];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.hypot(dx, dz);
      if (length < 0.01) continue;
      const ux = dx / length;
      const uz = dz / length;
      const sideX = uz;
      const sideZ = -ux;
      while (nextChevronAt <= travelled + length) {
        const along = nextChevronAt - travelled;
        const tip = { x: start.x + ux * along, z: start.z + uz * along };
        const back = { x: tip.x - ux * 1.45, z: tip.z - uz * 1.45 };
        const inConnectorRange = !isLaneGuidanceDistanceAllowed(
          lane,
          nextChevronAt,
        );
        const inConflictZone = conflictZones.some(
          (zone) =>
            zone.laneIds.includes(lane.id) &&
            (isPointInPolygon(tip, zone.polygon) || isPointInPolygon(back, zone.polygon)),
        );
        if (inConnectorRange || inConflictZone) {
          nextChevronAt += 12;
          continue;
        }
        const left = this.createFlatSegment(
          `route-chevron-${lane.id}-${index}-left`,
          { x: back.x + sideX * halfSpan, z: back.z + sideZ * halfSpan },
          tip,
          0.22,
          0.145,
          material,
        );
        const right = this.createFlatSegment(
          `route-chevron-${lane.id}-${index}-right`,
          { x: back.x - sideX * halfSpan, z: back.z - sideZ * halfSpan },
          tip,
          0.22,
          0.145,
          material,
        );
        const meshes = [left, right].filter((mesh): mesh is Mesh => Boolean(mesh));
        for (const mesh of meshes) mesh.layerMask = GUIDANCE_LAYER_MASK;
        this.routeChevronVisuals.push({
          routeIndex,
          laneId: lane.id,
          distanceAlongM: nextChevronAt,
          meshes,
        });
        nextChevronAt += 12;
        index += 1;
      }
      travelled += length;
    }
  }

  private createCheckpointTarget(
    checkpoint: AuthoredCheckpoint,
    material: StandardMaterial,
  ): GuidanceVisual {
    const meshes: Mesh[] = [];
    const targetWidth = resolveCheckpointTargetWidth(checkpoint.laneWidthM);
    const halfWidth = targetWidth / 2;
    const halfLength = 0.72;
    const armLength = Math.min(0.42, targetWidth * 0.22);
    const forward = {
      x: Math.sin(checkpoint.heading),
      z: Math.cos(checkpoint.heading),
    };
    const side = { x: forward.z, z: -forward.x };
    const point = (along: number, lateral: number): GameCanvasPoint => ({
      x: checkpoint.x + forward.x * along + side.x * lateral,
      z: checkpoint.z + forward.z * along + side.z * lateral,
    });
    for (const alongSign of [-1, 1]) {
      for (const sideSign of [-1, 1]) {
        const along = alongSign * halfLength;
        const lateral = sideSign * halfWidth;
        const alongArm = this.createFlatSegment(
          `checkpoint-${checkpoint.id}-${alongSign}-${sideSign}-along`,
          point(along, lateral),
          point(along - alongSign * armLength, lateral),
          0.13,
          0.155,
          material,
        );
        const sideArm = this.createFlatSegment(
          `checkpoint-${checkpoint.id}-${alongSign}-${sideSign}-side`,
          point(along, lateral),
          point(along, lateral - sideSign * armLength),
          0.13,
          0.155,
          material,
        );
        if (alongArm) meshes.push(alongArm);
        if (sideArm) meshes.push(sideArm);
      }
    }

    const texture = new DynamicTexture(
      `checkpoint-${checkpoint.id}-label-texture`,
      { width: 512, height: 128 },
      this.scene,
      false,
    );
    texture.hasAlpha = true;
    const context = texture.getContext() as unknown as CanvasRenderingContext2D;
    context.clearRect(0, 0, 512, 128);
    context.fillStyle = "rgba(8, 29, 31, 0.88)";
    context.beginPath();
    context.roundRect(10, 12, 492, 104, 24);
    context.fill();
    context.fillStyle = "#81fff0";
    context.font = "700 38px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("◆  CHECKPOINT", 256, 64);
    texture.update(false);
    const labelMaterial = new StandardMaterial(
      `checkpoint-${checkpoint.id}-label-material`,
      this.scene,
    );
    labelMaterial.diffuseTexture = texture;
    labelMaterial.opacityTexture = texture;
    labelMaterial.emissiveTexture = texture;
    labelMaterial.disableLighting = true;
    labelMaterial.backFaceCulling = false;
    const label = MeshBuilder.CreatePlane(
      `checkpoint-${checkpoint.id}-label`,
      { width: Math.min(1.75, targetWidth * 0.78), height: 0.44 },
      this.scene,
    );
    label.position.set(
      checkpoint.x - forward.x * 0.03,
      0.165,
      checkpoint.z - forward.z * 0.03,
    );
    label.rotation.x = Math.PI / 2;
    label.rotation.y = checkpoint.heading;
    setMeshMaterial(label, labelMaterial);
    meshes.push(label);
    for (const mesh of meshes) mesh.layerMask = GUIDANCE_LAYER_MASK;
    return { id: checkpoint.id, meshes };
  }

  private updateGuidanceVisuals() {
    for (const [index, visual] of this.checkpointVisuals.entries()) {
      const enabled =
        index === this.checkpointIndex &&
        this.simulationSnapshot.nextCheckpointId === visual.id;
      for (const mesh of visual.meshes) mesh.setEnabled(enabled);
    }

    const lesson = this.options.lesson;
    const mapPack = this.options.mapPack;
    if (!lesson || !mapPack) {
      this.updateGuidanceCueVisual();
      return;
    }
    const visibleRouteIndex = resolveAuthoritativeRouteIndex(
      lesson.route.length,
      this.simulationSnapshot.guidance,
    );
    const currentLaneId =
      visibleRouteIndex === null ? null : lesson.route[visibleRouteIndex];
    const currentLane = mapPack.laneGraph.lanes.find(
      (candidate) => candidate.id === currentLaneId,
    );
    const currentProjection = currentLane
      ? projectPointToLane(currentLane, {
          x: this.playerState.x,
          z: this.playerState.z,
        })
      : null;
    for (const visual of this.routeChevronVisuals) {
      let enabled = visual.routeIndex === visibleRouteIndex;
      const playerOccupiesVisibleLane = Boolean(
        currentProjection &&
          currentLane &&
          currentProjection.distance <= (currentLane.widthM ?? 3.2) / 2 + 0.5,
      );
      if (enabled && playerOccupiesVisibleLane && currentProjection) {
        enabled =
          visual.distanceAlongM > currentProjection.distanceAlongM + 2 &&
          visual.distanceAlongM < currentProjection.distanceAlongM + 58;
      } else if (enabled) {
        enabled = visual.distanceAlongM < 42;
      }
      for (const mesh of visual.meshes) mesh.setEnabled(enabled);
    }
    this.updateGuidanceCueVisual();
  }

  private updateGuidanceCueVisual() {
    const guidance = this.simulationSnapshot.guidance;
    const activeCheckpoint = this.authoredCheckpoints.find(
      (checkpoint) => checkpoint.id === this.simulationSnapshot.nextCheckpointId,
    ) ?? null;
    const cue =
      guidance.owner?.kind === "route" &&
      guidanceCueOverlapsCheckpoint(guidance.cue, activeCheckpoint)
        ? null
        : guidance.cue;
    const key = guidance.owner && cue
      ? `${guidance.owner.kind}:${cue.id}:${cue.label}:${cue.laneId}:${cue.distanceAlongM}:${guidance.status}`
      : null;
    if (key !== this.guidanceCueKey) {
      if (this.guidanceCueVisual) {
        if (this.guidanceCueVisual.dispose) {
          this.guidanceCueVisual.dispose();
        } else {
          for (const mesh of this.guidanceCueVisual.meshes) mesh.dispose();
        }
      }
      this.guidanceCueVisual =
        guidance.owner && cue
          ? this.createGuidanceCueTarget(cue, guidance.owner.kind)
          : null;
      this.guidanceCueKey = key;
    }
    if (!this.guidanceCueVisual || !cue || !guidance.owner) return;
    const enabled =
      guidance.owner.kind === "route" || guidance.status === "ready";
    for (const mesh of this.guidanceCueVisual.meshes) {
      mesh.setEnabled(enabled);
    }
  }

  private createGuidanceCueTarget(
    cue: NonNullable<SimulationSnapshot["guidance"]["cue"]>,
    ownerKind: NonNullable<SimulationSnapshot["guidance"]["owner"]>["kind"],
  ): GuidanceVisual {
    const meshes: Mesh[] = [];
    const width = resolveCheckpointTargetWidth(cue.widthM);
    const halfWidth = width / 2;
    const forward = { x: Math.sin(cue.heading), z: Math.cos(cue.heading) };
    const side = { x: forward.z, z: -forward.x };
    const point = (along: number, lateral: number): GameCanvasPoint => ({
      x: cue.x + forward.x * along + side.x * lateral,
      z: cue.z + forward.z * along + side.z * lateral,
    });
    const isRoute = ownerKind === "route";
    const gateMaterial = makeMaterial(
      this.scene,
      `guidance-${cue.id}-material`,
      isRoute ? new Color3(0.96, 0.64, 0.12) : new Color3(0.12, 0.75, 0.68),
      isRoute ? new Color3(0.23, 0.12, 0.025) : new Color3(0.025, 0.18, 0.14),
    );
    const threshold = this.createFlatSegment(
      `guidance-${cue.id}-threshold`,
      point(0, -halfWidth),
      point(0, halfWidth),
      0.16,
      0.16,
      gateMaterial,
    );
    if (threshold) meshes.push(threshold);
    for (const sideSign of [-1, 1]) {
      const upright = this.createFlatSegment(
        `guidance-${cue.id}-edge-${sideSign}`,
        point(-0.45, sideSign * halfWidth),
        point(0.45, sideSign * halfWidth),
        0.16,
        0.16,
        gateMaterial,
      );
      if (upright) meshes.push(upright);
    }
    const texture = new DynamicTexture(
      `guidance-${cue.id}-texture`,
      { width: 512, height: 128 },
      this.scene,
      false,
    );
    texture.hasAlpha = true;
    const context = texture.getContext() as unknown as CanvasRenderingContext2D;
    context.clearRect(0, 0, 512, 128);
    context.fillStyle = "rgba(8, 29, 31, 0.9)";
    context.fillRect(8, 10, 496, 108);
    context.fillStyle = isRoute ? "#ffd15b" : "#81fff0";
    context.font = "700 34px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(cue.label, 256, 64);
    texture.update(false);
    const labelMaterial = new StandardMaterial(
      `guidance-${cue.id}-label-material`,
      this.scene,
    );
    labelMaterial.diffuseTexture = texture;
    labelMaterial.opacityTexture = texture;
    labelMaterial.emissiveTexture = texture;
    labelMaterial.disableLighting = true;
    labelMaterial.backFaceCulling = false;
    const labelMesh = MeshBuilder.CreatePlane(
      `guidance-${cue.id}-label`,
      { width: Math.min(2.05, width * 0.9), height: 0.48 },
      this.scene,
    );
    labelMesh.position.set(
      cue.x - forward.x * 0.44,
      0.17,
      cue.z - forward.z * 0.44,
    );
    labelMesh.rotation.x = Math.PI / 2;
    labelMesh.rotation.y = cue.heading;
    setMeshMaterial(labelMesh, labelMaterial);
    meshes.push(labelMesh);
    for (const mesh of meshes) mesh.layerMask = GUIDANCE_LAYER_MASK;
    return {
      id: cue.id,
      meshes,
      dispose: () => {
        for (const mesh of meshes) mesh.dispose();
        labelMaterial.dispose();
        texture.dispose();
        gateMaterial.dispose();
      },
    };
  }

  private createSignalHead(
    name: string,
    position: GameCanvasPoint,
    heading: number,
    height: number,
    materials: TrafficControlMaterials,
    runtime: Pick<
      AuthoredSignalHeadVisual,
      "controlId" | "trafficLightIds" | "phaseGroup" | "phaseGroups" | "style"
    >,
  ) {
    const head = new TransformNode(`${name}-head`, this.scene);
    head.position.set(position.x, height, position.z);
    head.rotation.y = heading;
    createBox(
      this.scene,
      `${name}-housing`,
      { width: 0.58, height: 1.48, depth: 0.42 },
      Vector3.Zero(),
      materials.dark,
      head,
    );
    const redMaterial = materials.redLamp.clone(`${name}-red-material`);
    const amberMaterial = materials.amberLamp.clone(`${name}-amber-material`);
    const greenMaterial = materials.greenLamp.clone(`${name}-green-material`);
    redMaterial.emissiveColor.copyFromFloats(0.08, 0.005, 0.005);
    amberMaterial.emissiveColor.copyFromFloats(0.08, 0.04, 0.005);
    greenMaterial.emissiveColor.copyFromFloats(0.005, 0.06, 0.012);
    this.authoredSignalHeads.push({
      ...runtime,
      redMaterial,
      amberMaterial,
      greenMaterial,
    });
    const lamps = [
      { id: "red", y: 0.43, material: redMaterial },
      { id: "amber", y: 0, material: amberMaterial },
      { id: "green", y: -0.43, material: greenMaterial },
    ];
    for (const lamp of lamps) {
      const lens = createCylinder(
        this.scene,
        `${name}-${lamp.id}`,
        { height: 0.1, diameter: 0.25, tessellation: 18 },
        new Vector3(0, lamp.y, -0.25),
        lamp.material,
        head,
      );
      lens.rotation.x = Math.PI / 2;
    }
  }

  private buildSignalInstallation(
    controlId: string,
    installation: NonNullable<
      GameCanvasMapPack["laneGraph"]["controls"][number]["installations"]
    >[number],
    roadWidth: number,
    materials: TrafficControlMaterials,
    runtime: Pick<
      AuthoredSignalHeadVisual,
      "trafficLightIds" | "phaseGroup" | "phaseGroups" | "style"
    >,
  ) {
    const headHeading = degreesToRadians(installation.headingDeg);
    const armHeading = degreesToRadians(
      installation.armHeadingDeg ?? installation.headingDeg,
    );
    const base = installation.position;
    const mastArm = installation.mounting === "mast_arm";
    const poleHeight = mastArm ? 5.4 : 3.7;
    createCylinder(
      this.scene,
      `${controlId}-${installation.id}-pole`,
      { height: poleHeight, diameter: mastArm ? 0.22 : 0.17, tessellation: 14 },
      new Vector3(base.x, poleHeight / 2, base.z),
      materials.dark,
    );
    if (mastArm) {
      const span = Math.max(4.8, Math.min(8.5, roadWidth * 0.68));
      const sideX = Math.cos(armHeading);
      const sideZ = -Math.sin(armHeading);
      const arm = createBox(
        this.scene,
        `${controlId}-${installation.id}-mast-arm`,
        { width: span, height: 0.18, depth: 0.18 },
        new Vector3(
          base.x + sideX * span / 2,
          poleHeight - 0.18,
          base.z + sideZ * span / 2,
        ),
        materials.dark,
      );
      arm.rotation.y = armHeading;
      this.createSignalHead(
        `${controlId}-${installation.id}`,
        { x: base.x + sideX * (span - 0.45), z: base.z + sideZ * (span - 0.45) },
        headHeading,
        poleHeight - 0.95,
        materials,
        { controlId, ...runtime },
      );
      return;
    }
    this.createSignalHead(
      `${controlId}-${installation.id}`,
      base,
      headHeading,
      poleHeight - 0.95,
      materials,
      { controlId, ...runtime },
    );
  }

  private buildRailwayCrossingInstallation(
    controlId: string,
    installation: NonNullable<
      GameCanvasMapPack["laneGraph"]["controls"][number]["installations"]
    >[number],
    materials: TrafficControlMaterials,
    trafficLightIds: readonly string[],
  ) {
    const heading = degreesToRadians(installation.headingDeg);
    const base = installation.position;
    const poleHeight = 3.4;
    createCylinder(
      this.scene,
      `${controlId}-${installation.id}-rail-pole`,
      { height: poleHeight, diameter: 0.18, tessellation: 14 },
      new Vector3(base.x, poleHeight / 2, base.z),
      materials.dark,
    );
    const crossbuck = new TransformNode(`${controlId}-${installation.id}-crossbuck`, this.scene);
    crossbuck.position.set(base.x, 3.15, base.z);
    crossbuck.rotation.y = heading;
    for (const angle of [-0.63, 0.63]) {
      const bar = createBox(
        this.scene,
        `${controlId}-${installation.id}-crossbuck-${angle}`,
        { width: 1.6, height: 0.14, depth: 0.08 },
        Vector3.Zero(),
        materials.pale,
        crossbuck,
      );
      bar.rotation.z = angle;
    }
    const sideX = Math.cos(heading);
    const sideZ = -Math.sin(heading);
    const lampMaterials: StandardMaterial[] = [];
    for (const side of [-1, 1]) {
      const lampMaterial = materials.redLamp.clone(
        `${controlId}-${installation.id}-warning-${side}-material`,
      );
      lampMaterial.emissiveColor.copyFromFloats(0.08, 0.005, 0.005);
      lampMaterials.push(lampMaterial);
      const lamp = createCylinder(
        this.scene,
        `${controlId}-${installation.id}-warning-${side}`,
        { height: 0.11, diameter: 0.35, tessellation: 18 },
        new Vector3(base.x + sideX * side * 0.34, 2.38, base.z + sideZ * side * 0.34),
        lampMaterial,
      );
      lamp.rotation.x = Math.PI / 2;
      lamp.rotation.y = heading;
    }
    const barrierLength = 4.6;
    const barrierPivot = new TransformNode(
      `${controlId}-${installation.id}-barrier-pivot`,
      this.scene,
    );
    barrierPivot.position.set(base.x, 1.25, base.z);
    barrierPivot.rotation.y = heading;
    const barrier = createBox(
      this.scene,
      `${controlId}-${installation.id}-barrier`,
      { width: barrierLength, height: 0.14, depth: 0.14 },
      new Vector3(barrierLength / 2, 0, 0),
      materials.warningYellow,
      barrierPivot,
    );
    barrier.rotation.y = 0;
    barrierPivot.rotation.z = -1.22;
    this.railwayCrossingVisuals.push({
      trafficLightIds,
      lampMaterials,
      barrierPivot,
    });
  }

  private buildRoadMarkingInstallation(
    control: GameCanvasMapPack["laneGraph"]["controls"][number],
    installation: NonNullable<
      GameCanvasMapPack["laneGraph"]["controls"][number]["installations"]
    >[number],
    roadWidth: number,
    laneMaterial: StandardMaterial,
    warningMaterial: StandardMaterial,
  ) {
    const heading = degreesToRadians(installation.headingDeg);
    if (installation.style === "crosswalk") {
      for (let stripe = -3; stripe <= 3; stripe += 1) {
        const acrossX = Math.cos(heading) * stripe * 1.05;
        const acrossZ = -Math.sin(heading) * stripe * 1.05;
        const marking = createBox(
          this.scene,
          `${control.id}-${installation.id}-stripe-${stripe}`,
          { width: 0.62, height: 0.035, depth: roadWidth * 0.82 },
          new Vector3(
            installation.position.x + acrossX,
            0.14,
            installation.position.z + acrossZ,
          ),
          laneMaterial,
        );
        marking.rotation.y = heading;
      }
      return;
    }
    if (installation.style !== "box_junction") return;
    const zones = this.options.mapPack?.laneGraph.conflictZones ?? [];
    for (const zoneId of control.conflictZoneIds ?? []) {
      const zone = zones.find((candidate) => candidate.id === zoneId);
      if (!zone || zone.polygon.length < 3) continue;
      for (let index = 0; index < zone.polygon.length; index += 1) {
        this.createFlatSegment(
          `${control.id}-${installation.id}-box-edge-${index}`,
          zone.polygon[index],
          zone.polygon[(index + 1) % zone.polygon.length],
          0.18,
          0.145,
          warningMaterial,
        );
      }
      const minX = Math.min(...zone.polygon.map((point) => point.x));
      const maxX = Math.max(...zone.polygon.map((point) => point.x));
      const minZ = Math.min(...zone.polygon.map((point) => point.z));
      const maxZ = Math.max(...zone.polygon.map((point) => point.z));
      const span = Math.max(maxX - minX, maxZ - minZ);
      for (let offset = -span; offset <= span; offset += 3) {
        const start = { x: Math.max(minX, minX + offset), z: Math.max(minZ, minZ - offset) };
        const end = { x: Math.min(maxX, maxX + offset), z: Math.min(maxZ, maxZ - offset) };
        if (Math.hypot(end.x - start.x, end.z - start.z) > 1) {
          this.createFlatSegment(
            `${control.id}-${installation.id}-box-hatch-${offset}`,
            start,
            end,
            0.12,
            0.144,
            warningMaterial,
          );
        }
      }
    }
  }

  private buildTerminalPortal(
    controlId: string,
    installation: NonNullable<
      GameCanvasMapPack["laneGraph"]["controls"][number]["installations"]
    >[number],
    roadWidth: number,
    materials: TrafficControlMaterials,
  ) {
    const heading = degreesToRadians(installation.headingDeg);
    const sideX = Math.cos(heading);
    const sideZ = -Math.sin(heading);
    const span = Math.max(6, roadWidth * 0.82);
    for (const side of [-1, 1]) {
      createCylinder(
        this.scene,
        `${controlId}-${installation.id}-portal-post-${side}`,
        { height: 4.8, diameter: 0.28, tessellation: 14 },
        new Vector3(
          installation.position.x + sideX * side * span / 2,
          2.4,
          installation.position.z + sideZ * side * span / 2,
        ),
        materials.dark,
      );
    }
    const beam = createBox(
      this.scene,
      `${controlId}-${installation.id}-portal-beam`,
      { width: span + 0.3, height: 0.32, depth: 0.32 },
      new Vector3(installation.position.x, 4.65, installation.position.z),
      materials.warningYellow,
    );
    beam.rotation.y = heading;
  }

  private buildEnvironment() {
    if (this.options.mapPack && this.options.lesson) {
      this.buildScenarioEnvironment(this.options.mapPack);
      return;
    }
    const scene = this.scene;
    const grass = makeMaterial(scene, "grass", new Color3(0.22, 0.38, 0.24));
    const asphalt = makeMaterial(scene, "asphalt", new Color3(0.12, 0.15, 0.17));
    const paleAsphalt = makeMaterial(scene, "junction-asphalt", new Color3(0.15, 0.18, 0.19));
    const white = makeMaterial(scene, "road-white", new Color3(0.88, 0.87, 0.76));
    const yellow = makeMaterial(scene, "road-yellow", new Color3(0.96, 0.67, 0.13));
    const curb = makeMaterial(scene, "curb", new Color3(0.62, 0.64, 0.61));
    const trunk = makeMaterial(scene, "tree-trunk", new Color3(0.3, 0.19, 0.1));
    const leaves = makeMaterial(scene, "tree-leaves", new Color3(0.12, 0.32, 0.16));
    const lampDark = makeMaterial(scene, "lamp-dark", new Color3(0.08, 0.1, 0.1));
    const redLamp = makeMaterial(
      scene,
      "signal-red",
      new Color3(0.5, 0.03, 0.02),
      new Color3(0.35, 0.01, 0.01),
    );
    const greenLamp = makeMaterial(
      scene,
      "signal-green",
      new Color3(0.03, 0.42, 0.15),
      new Color3(0.01, 0.18, 0.04),
    );
    const amberLamp = makeMaterial(
      scene,
      "signal-amber",
      new Color3(0.58, 0.3, 0.02),
      new Color3(0.08, 0.04, 0.005),
    );
    this.signalRedMaterial = redLamp;
    this.signalAmberMaterial = amberLamp;
    this.signalGreenMaterial = greenLamp;

    const hemi = new HemisphericLight("soft-sky", new Vector3(0.2, 1, 0.1), scene);
    hemi.intensity = 0.82;
    hemi.diffuse = new Color3(0.92, 0.95, 1);
    hemi.groundColor = new Color3(0.22, 0.28, 0.25);
    const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, 0.55), scene);
    sun.intensity = 0.68;

    const ground = MeshBuilder.CreateGround(
      "training-ground",
      { width: 180, height: 180, subdivisions: 1 },
      scene,
    );
    setMeshMaterial(ground, grass);
    createBox(scene, "main-road", { width: 13, height: 0.08, depth: 170 }, new Vector3(0, 0.04, 4), asphalt);
    createBox(scene, "cross-road", { width: 100, height: 0.09, depth: 13 }, new Vector3(0, 0.05, 0), paleAsphalt);

    const roundaboutRoad = MeshBuilder.CreateTorus(
      "roundabout-road",
      { diameter: 17, thickness: 5.6, tessellation: 40 },
      scene,
    );
    roundaboutRoad.position.set(0, 0.05, 32);
    roundaboutRoad.scaling.y = 0.025;
    setMeshMaterial(roundaboutRoad, asphalt);
    createCylinder(scene, "roundabout-island", { height: 0.34, diameter: 10.5, tessellation: 24 }, new Vector3(0, 0.18, 32), grass);
    createCylinder(scene, "roundabout-curb", { height: 0.18, diameter: 11.3, tessellation: 24 }, new Vector3(0, 0.09, 32), curb);
    createCylinder(scene, "roundabout-grass", { height: 0.22, diameter: 10.3, tessellation: 24 }, new Vector3(0, 0.22, 32), grass);

    for (let z = -74; z <= 82; z += 8) {
      if (z > 21 && z < 43) continue;
      createBox(scene, `center-dash-${z}`, { width: 0.14, height: 0.03, depth: 4 }, new Vector3(0, 0.105, z), white);
    }
    for (let x = -45; x <= 45; x += 8) {
      if (Math.abs(x) < 8) continue;
      createBox(scene, `cross-dash-${x}`, { width: 4, height: 0.03, depth: 0.14 }, new Vector3(x, 0.11, 0), white);
    }
    for (const side of [-1, 1]) {
      createBox(scene, `edge-${side}`, { width: 0.16, height: 0.025, depth: 168 }, new Vector3(side * 6.15, 0.105, 4), white);
    }
    if (this.options.trafficSide === "right") {
      createBox(scene, "jurisdiction-line", { width: 0.12, height: 0.035, depth: 168 }, new Vector3(-0.18, 0.11, 4), yellow);
    }

    for (let x = -5; x <= 5; x += 1.45) {
      createBox(scene, `crosswalk-${x}`, { width: 0.75, height: 0.035, depth: 3.2 }, new Vector3(x, 0.12, 4.5), white);
    }
    createBox(scene, "stop-line", { width: 5.8, height: 0.04, depth: 0.32 }, new Vector3(this.options.trafficSide === "right" ? 3 : -3, 0.125, -4), white);

    for (const x of [-8, 8]) {
      const pole = createCylinder(scene, `signal-pole-${x}`, { height: 4.6, diameter: 0.19 }, new Vector3(x, 2.3, -5), lampDark);
      const box = createBox(scene, `signal-box-${x}`, { width: 0.7, height: 1.75, depth: 0.55 }, new Vector3(0, 1.5, 0), lampDark, pole);
      createCylinder(scene, `red-${x}`, { height: 0.12, diameter: 0.31 }, new Vector3(0, 0.45, -0.31), redLamp, box).rotation.x = Math.PI / 2;
      createCylinder(scene, `green-${x}`, { height: 0.12, diameter: 0.31 }, new Vector3(0, -0.45, -0.31), greenLamp, box).rotation.x = Math.PI / 2;
    }

    const buildingColors = [
      new Color3(0.72, 0.42, 0.31),
      new Color3(0.72, 0.67, 0.51),
      new Color3(0.35, 0.53, 0.59),
      new Color3(0.57, 0.43, 0.61),
    ];
    for (let index = 0; index < 24; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const z = -68 + Math.floor(index / 2) * 13;
      const height = 6 + ((index * 7) % 9);
      const buildingMaterial = makeMaterial(
        scene,
        `building-material-${index}`,
        buildingColors[index % buildingColors.length],
      );
      createBox(
        scene,
        `building-${index}`,
        { width: 8 + (index % 3), height, depth: 8 },
        new Vector3(side * (13 + (index % 3) * 2), height / 2, z),
        buildingMaterial,
      );
    }

    for (let index = 0; index < 18; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const z = -70 + index * 8.5;
      const tree = new TransformNode(`tree-${index}`, scene);
      tree.position.set(side * 8.7, 0, z);
      createCylinder(scene, `trunk-${index}`, { height: 2.3, diameter: 0.38 }, new Vector3(0, 1.15, 0), trunk, tree);
      createCylinder(
        scene,
        `crown-${index}`,
        { height: 3.4, diameterTop: 0.4, diameterBottom: 3.2, tessellation: 8 },
        new Vector3(0, 3.4, 0),
        leaves,
        tree,
      );
    }
  }

  private buildPlayerCar() {
    const scene = this.scene;
    const body = makeMaterial(scene, "player-blue", new Color3(0.08, 0.47, 0.63));
    const bodyDark = makeMaterial(scene, "player-blue-dark", new Color3(0.04, 0.23, 0.3));
    const glass = makeMaterial(scene, "player-glass", new Color3(0.08, 0.14, 0.17));
    const rubber = makeMaterial(scene, "tire", new Color3(0.025, 0.03, 0.03));
    const steeringRubber = makeMaterial(
      scene,
      "steering-rubber",
      new Color3(0.05, 0.055, 0.058),
      new Color3(0.008, 0.009, 0.01),
    );
    const dash = makeMaterial(
      scene,
      "dashboard",
      new Color3(0.115, 0.125, 0.13),
      new Color3(0.018, 0.02, 0.022),
    );
    const cockpitTrim = makeMaterial(
      scene,
      "cockpit-trim",
      new Color3(0.175, 0.185, 0.19),
      new Color3(0.012, 0.014, 0.015),
    );
    const instrumentFace = makeMaterial(
      scene,
      "instrument-face",
      new Color3(0.03, 0.06, 0.07),
      new Color3(0.01, 0.055, 0.065),
    );
    const instrumentGlow = makeMaterial(
      scene,
      "instrument-glow",
      new Color3(0.04, 0.13, 0.15),
      new Color3(0.01, 0.035, 0.04),
    );
    const amberLeft = makeMaterial(scene, "amber-left", new Color3(0.45, 0.16, 0.01));
    const amberRight = makeMaterial(scene, "amber-right", new Color3(0.45, 0.16, 0.01));

    createBox(scene, "player-body", { width: 1.82, height: 0.55, depth: 4.15 }, new Vector3(0, 0.62, 0), body, this.playerExterior);
    createBox(scene, "player-cabin", { width: 1.62, height: 0.72, depth: 1.95 }, new Vector3(0, 1.15, -0.2), glass, this.playerExterior);
    createBox(scene, "player-hood", { width: 1.72, height: 0.2, depth: 1.2 }, new Vector3(0, 0.92, 1.45), bodyDark, this.playerExterior);

    for (const x of [-0.91, 0.91]) {
      for (const z of [-1.25, 1.3]) {
        const wheel = createCylinder(scene, `player-wheel-${x}-${z}`, { height: 0.23, diameter: 0.68, tessellation: 12 }, new Vector3(x, 0.48, z), rubber, this.playerExterior);
        wheel.rotation.z = Math.PI / 2;
      }
    }
    for (const side of [-1, 1]) {
      const indicatorMaterial = side < 0 ? amberLeft : amberRight;
      const front = createBox(scene, `front-indicator-${side}`, { width: 0.2, height: 0.18, depth: 0.09 }, new Vector3(side * 0.69, 0.74, 2.09), indicatorMaterial, this.playerExterior);
      const rear = createBox(scene, `rear-indicator-${side}`, { width: 0.2, height: 0.18, depth: 0.09 }, new Vector3(side * 0.69, 0.74, -2.09), indicatorMaterial, this.playerExterior);
      (side < 0 ? this.leftIndicatorMeshes : this.rightIndicatorMeshes).push(front, rear);
    }

    createBox(scene, "cockpit-hood", { width: 1.62, height: 0.045, depth: 0.42 }, new Vector3(0, 0.74, 1.55), bodyDark, this.playerCockpit);
    createExtrudedPrism(
      scene,
      "cockpit-dash-shell",
      1.92,
      [
        { y: 0.68, z: COCKPIT_DASH_DRIVER_Z },
        { y: 0.96, z: COCKPIT_DASH_DRIVER_Z },
        { y: 1.04, z: 0.94 },
        { y: 0.74, z: 0.94 },
      ],
      dash,
      this.playerCockpit,
    );
    createBox(scene, "cockpit-dash-trim", { width: 1.72, height: 0.022, depth: 0.024 }, new Vector3(0, 0.91, 0.255), cockpitTrim, this.playerCockpit);
    createBox(scene, "windshield-sill", { width: 1.9, height: 0.038, depth: 0.08 }, new Vector3(0, 1.04, 0.94), cockpitTrim, this.playerCockpit);
    for (const side of [-1, 1]) {
      createBox(
        scene,
        `cockpit-door-beltline-${side}`,
        { width: 0.12, height: 0.11, depth: 1.12 },
        new Vector3(side * 0.94, 0.82, 0.12),
        cockpitTrim,
        this.playerCockpit,
      );
    }
    const steeringGeometry = resolveCockpitSteeringGeometry(
      this.options.steeringSide,
    );
    const wheelX = steeringGeometry.x;

    const instrumentHood = MeshBuilder.CreateTorus(
      "instrument-hood",
      { diameter: 0.42, thickness: 0.038, tessellation: 28 },
      scene,
    );
    instrumentHood.position.set(wheelX, 1.08, 0.39);
    instrumentHood.rotation.x = Math.PI / 2;
    instrumentHood.scaling.z = 0.5;
    instrumentHood.parent = this.playerCockpit;
    setMeshMaterial(instrumentHood, cockpitTrim);

    const clusterFace = createCylinder(
      scene,
      "instrument-cluster-face",
      { height: 0.024, diameter: 0.38, tessellation: 28 },
      new Vector3(wheelX, 1.07, 0.3),
      instrumentFace,
      this.playerCockpit,
    );
    clusterFace.rotation.x = Math.PI / 2;
    clusterFace.scaling.z = 0.48;

    for (const gaugeOffset of [-0.11, 0.11]) {
      const gaugeRing = createCylinder(
        scene,
        `instrument-gauge-ring-${gaugeOffset}`,
        { height: 0.02, diameter: 0.108, tessellation: 20 },
        new Vector3(wheelX + gaugeOffset, 1.075, 0.279),
        cockpitTrim,
        this.playerCockpit,
      );
      gaugeRing.rotation.x = Math.PI / 2;
      const gaugeFace = createCylinder(
        scene,
        `instrument-gauge-face-${gaugeOffset}`,
        { height: 0.01, diameter: 0.084, tessellation: 20 },
        new Vector3(wheelX + gaugeOffset, 1.075, 0.263),
        instrumentFace,
        this.playerCockpit,
      );
      gaugeFace.rotation.x = Math.PI / 2;
    }
    createBox(scene, "instrument-status", { width: 0.062, height: 0.02, depth: 0.014 }, new Vector3(wheelX, 1.038, 0.252), instrumentGlow, this.playerCockpit);

    for (const x of [-0.06, 0.06]) {
      createBox(scene, `centre-vent-${x}`, { width: 0.09, height: 0.014, depth: 0.012 }, new Vector3(x, 0.955, 0.254), cockpitTrim, this.playerCockpit);
    }

    const steeringMount = new TransformNode("steering-mount", scene);
    steeringMount.position.set(
      steeringGeometry.x,
      steeringGeometry.y,
      steeringGeometry.z,
    );
    steeringMount.rotation.x = steeringGeometry.mountRotationX;
    steeringMount.parent = this.playerCockpit;
    createCylinder(
      scene,
      "steering-column-shroud",
      {
        height: 0.13,
        diameterTop: 0.075,
        diameterBottom: 0.055,
        tessellation: 16,
      },
      new Vector3(0, 0.075, 0),
      steeringRubber,
      steeringMount,
    );

    this.steeringAssembly = new TransformNode("steering-spin", scene);
    this.steeringAssembly.parent = steeringMount;
    const steeringWheel = MeshBuilder.CreateTorus(
      "steering-wheel",
      {
        diameter: steeringGeometry.wheelDiameter,
        thickness: steeringGeometry.rimThickness,
        tessellation: 28,
      },
      scene,
    );
    steeringWheel.parent = this.steeringAssembly;
    setMeshMaterial(steeringWheel, steeringRubber);
    createBox(scene, "wheel-horizontal-spoke", { width: 0.24, height: 0.026, depth: 0.032 }, Vector3.Zero(), steeringRubber, this.steeringAssembly);
    createBox(scene, "wheel-lower-spoke", { width: 0.032, height: 0.026, depth: 0.13 }, new Vector3(0, 0, 0.055), steeringRubber, this.steeringAssembly);
    const steeringHub = createCylinder(
      scene,
      "steering-hub",
      { height: 0.045, diameter: 0.13, tessellation: 20 },
      Vector3.Zero(),
      cockpitTrim,
      this.steeringAssembly,
    );
    steeringHub.scaling.z = 0.56;
  }

  private buildTraffic() {
    if (this.options.mapPack && this.options.lesson) {
      this.buildScenarioTraffic(this.options.mapPack, this.options.lesson);
      return;
    }
    const scene = this.scene;
    const trafficColors = [
      new Color3(0.86, 0.27, 0.18),
      new Color3(0.96, 0.72, 0.15),
      new Color3(0.44, 0.66, 0.45),
      new Color3(0.68, 0.7, 0.73),
    ];
    const playerLaneSign = this.options.trafficSide === "right" ? 1 : -1;
    for (let index = 0; index < 8; index += 1) {
      const sameDirection = index % 2 === 0;
      const direction: 1 | -1 = sameDirection ? 1 : -1;
      const laneX = direction > 0
        ? playerLaneSign * LANE_CENTER
        : -playerLaneSign * LANE_CENTER;
      const z = -35 + index * 20 + (sameDirection ? 25 : 0);
      const node = new TransformNode(`npc-${index}`, scene);
      const body = makeMaterial(scene, `npc-body-${index}`, trafficColors[index % trafficColors.length]);
      const windowMaterial = makeMaterial(scene, `npc-window-${index}`, new Color3(0.07, 0.12, 0.14));
      const tireMaterial = makeMaterial(scene, `npc-tire-${index}`, new Color3(0.025, 0.03, 0.03));
      createBox(scene, `npc-car-${index}`, { width: 1.72, height: 0.58, depth: 3.75 }, new Vector3(0, 0.62, 0), body, node);
      createBox(scene, `npc-cabin-${index}`, { width: 1.48, height: 0.63, depth: 1.65 }, new Vector3(0, 1.12, -0.18), windowMaterial, node);
      for (const x of [-0.87, 0.87]) {
        for (const wheelZ of [-1.1, 1.15]) {
          const wheel = createCylinder(scene, `npc-wheel-${index}-${x}-${wheelZ}`, { height: 0.2, diameter: 0.59 }, new Vector3(x, 0.45, wheelZ), tireMaterial, node);
          wheel.rotation.z = Math.PI / 2;
        }
      }
      this.npcVehicles.push({
        node,
        direction,
        speed: 5.5 + (index % 4) * 0.65,
        z,
        laneX,
      });
      node.position.set(laneX, 0.12, z);
      node.rotation.y = direction > 0 ? 0 : Math.PI;
    }

    const clothes = [new Color3(0.83, 0.38, 0.22), new Color3(0.2, 0.45, 0.72), new Color3(0.68, 0.28, 0.62)];
    const skin = makeMaterial(scene, "pedestrian-skin", new Color3(0.74, 0.52, 0.38));
    for (let index = 0; index < 4; index += 1) {
      const node = new TransformNode(`pedestrian-${index}`, scene);
      const shirt = makeMaterial(scene, `pedestrian-shirt-${index}`, clothes[index % clothes.length]);
      createCylinder(scene, `pedestrian-body-${index}`, { height: 1.05, diameterTop: 0.36, diameterBottom: 0.5 }, new Vector3(0, 0.92, 0), shirt, node);
      createCylinder(scene, `pedestrian-head-${index}`, { height: 0.42, diameter: 0.4 }, new Vector3(0, 1.64, 0), skin, node);
      const z = index < 2 ? 4.5 : -10.5;
      const phase = index * 4.1;
      this.pedestrians.push({ node, phase, speed: 0.7 + index * 0.08, z });
      node.position.set(-8 + (phase / 18) * 16, 0.08, z);
    }
  }

  private buildScenarioTraffic(
    mapPack: GameCanvasMapPack,
    lesson: GameCanvasLesson,
  ) {
    const scene = this.scene;
    const random = seededUnit(lesson.trafficSeed);
    const densityCounts = { none: 0, light: 6, moderate: 12, busy: 18 } as const;
    const count = this.options.inputCapabilities.touchFirst
      ? Math.min(12, densityCounts[lesson.trafficDensity])
      : densityCounts[lesson.trafficDensity];
    const usableLanes = mapPack.laneGraph.lanes.filter((lane) => lane.centerline.length >= 2);
    const vehicleSpawns = mapPack.laneGraph.spawnPoints.filter(
      (spawn) => spawn.kind === "vehicle",
    );
    const trafficColors = [
      new Color3(0.82, 0.21, 0.15),
      new Color3(0.92, 0.66, 0.11),
      new Color3(0.25, 0.51, 0.63),
      new Color3(0.38, 0.59, 0.38),
      new Color3(0.67, 0.68, 0.7),
    ];
    const windowMaterial = makeMaterial(scene, "scenario-npc-window", new Color3(0.055, 0.1, 0.12));
    const tireMaterial = makeMaterial(scene, "scenario-npc-tire", new Color3(0.02, 0.025, 0.025));

    for (let index = 0; index < count && usableLanes.length > 0; index += 1) {
      const spawn = vehicleSpawns[index % Math.max(1, vehicleSpawns.length)];
      const authoredAnchor =
        spawn && "anchor" in spawn && spawn.anchor && index < vehicleSpawns.length
          ? spawn.anchor
          : null;
      const legacyLaneId = spawn && "laneId" in spawn ? spawn.laneId : undefined;
      const lane =
        ((authoredAnchor?.laneId ?? legacyLaneId) &&
          usableLanes.find(
            (candidate) => candidate.id === (authoredAnchor?.laneId ?? legacyLaneId),
          )) ||
        usableLanes[(index * 3 + Math.floor(random() * usableLanes.length)) % usableLanes.length];
      const connectedPath = this.buildConnectedNpcPath(mapPack, lane.id, index);
      if (connectedPath.segments.length === 0) continue;
      const anchored = authoredAnchor
        ? resolveLaneAnchor(mapPack.laneGraph.lanes, authoredAnchor)
        : null;
      const legacyPose = spawn && "pose" in spawn ? spawn.pose : undefined;
      let segment = anchored?.segmentIndex ?? Math.floor(random() * connectedPath.segments.length);
      if (segment >= connectedPath.segments.length) segment = connectedPath.segments.length - 1;
      let pathSegment = connectedPath.segments[segment];
      let initialDistance = anchored?.distanceOnSegment ?? random() * pathSegment.length;
      if (legacyPose && index < vehicleSpawns.length && !anchored) {
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let candidateIndex = 0; candidateIndex < connectedPath.segments.length; candidateIndex += 1) {
          const candidate = connectedPath.segments[candidateIndex];
          const dx = candidate.end.x - candidate.start.x;
          const dz = candidate.end.z - candidate.start.z;
          const amount = clamp(
            ((legacyPose.position.x - candidate.start.x) * dx +
              (legacyPose.position.z - candidate.start.z) * dz) /
              Math.max(0.001, candidate.length * candidate.length),
            0,
            1,
          );
          const x = candidate.start.x + dx * amount;
          const z = candidate.start.z + dz * amount;
          const distance = Math.hypot(legacyPose.position.x - x, legacyPose.position.z - z);
          if (distance < bestDistance) {
            bestDistance = distance;
            segment = candidateIndex;
            pathSegment = candidate;
            initialDistance = candidate.length * amount;
          }
        }
      }
      const start = pathSegment.start;
      const end = pathSegment.end;
      const segmentLength = pathSegment.length;
      const amount = initialDistance / segmentLength;
      const x = start.x + (end.x - start.x) * amount;
      const z = start.z + (end.z - start.z) * amount;
      const heading = Math.atan2(end.x - start.x, end.z - start.z);
      const node = new TransformNode(`scenario-npc-${index}`, scene);
      const isLondonRedBus =
        mapPack.id.toLowerCase().includes("london") && spawn?.id === "london-red-bus";
      const isLondonBlackCab =
        mapPack.id.toLowerCase().includes("london") && spawn?.id === "london-black-cab";
      const body = makeMaterial(
        scene,
        `scenario-npc-body-${index}`,
        isLondonRedBus
          ? new Color3(0.68, 0.035, 0.025)
          : isLondonBlackCab
            ? new Color3(0.035, 0.04, 0.042)
            : trafficColors[index % trafficColors.length],
      );

      if (isLondonRedBus) {
        createBox(
          scene,
          `scenario-london-bus-lower-${index}`,
          { width: 2.28, height: 1.05, depth: 7.35 },
          new Vector3(0, 0.95, 0),
          body,
          node,
        );
        createBox(
          scene,
          `scenario-london-bus-upper-${index}`,
          { width: 2.18, height: 1.62, depth: 6.75 },
          new Vector3(0, 2.22, -0.08),
          body,
          node,
        );
        for (const side of [-1, 1]) {
          createBox(
            scene,
            `scenario-london-bus-windows-${index}-${side}`,
            { width: 0.055, height: 0.62, depth: 5.3 },
            new Vector3(side * 1.105, 2.34, -0.05),
            windowMaterial,
            node,
          );
        }
        createBox(
          scene,
          `scenario-london-bus-front-window-${index}`,
          { width: 1.78, height: 0.7, depth: 0.06 },
          new Vector3(0, 2.3, 3.31),
          windowMaterial,
          node,
        );
        createBox(
          scene,
          `scenario-london-bus-rear-window-${index}`,
          { width: 1.66, height: 0.6, depth: 0.06 },
          new Vector3(0, 2.3, -3.47),
          windowMaterial,
          node,
        );
        for (const wheelX of [-1.11, 1.11]) {
          for (const wheelZ of [-2.35, 2.35]) {
            const wheel = createCylinder(
              scene,
              `scenario-london-bus-wheel-${index}-${wheelX}-${wheelZ}`,
              { height: 0.22, diameter: 0.82 },
              new Vector3(wheelX, 0.5, wheelZ),
              tireMaterial,
              node,
            );
            wheel.rotation.z = Math.PI / 2;
          }
        }
      } else if (isLondonBlackCab) {
        createBox(
          scene,
          `scenario-london-cab-body-${index}`,
          { width: 1.84, height: 0.68, depth: 4.25 },
          new Vector3(0, 0.67, 0),
          body,
          node,
        );
        createBox(
          scene,
          `scenario-london-cab-cabin-${index}`,
          { width: 1.62, height: 0.92, depth: 2.05 },
          new Vector3(0, 1.27, -0.28),
          body,
          node,
        );
        createBox(
          scene,
          `scenario-london-cab-windows-${index}`,
          { width: 1.67, height: 0.54, depth: 1.55 },
          new Vector3(0, 1.35, -0.25),
          windowMaterial,
          node,
        );
        createBox(
          scene,
          `scenario-london-cab-roof-${index}`,
          { width: 1.42, height: 0.16, depth: 1.7 },
          new Vector3(0, 1.82, -0.3),
          body,
          node,
        );
        for (const wheelX of [-0.93, 0.93]) {
          for (const wheelZ of [-1.32, 1.28]) {
            const wheel = createCylinder(
              scene,
              `scenario-london-cab-wheel-${index}-${wheelX}-${wheelZ}`,
              { height: 0.2, diameter: 0.62 },
              new Vector3(wheelX, 0.45, wheelZ),
              tireMaterial,
              node,
            );
            wheel.rotation.z = Math.PI / 2;
          }
        }
      } else {
        createBox(scene, `scenario-car-${index}`, { width: 1.72, height: 0.58, depth: 3.7 }, new Vector3(0, 0.62, 0), body, node);
        createBox(scene, `scenario-cabin-${index}`, { width: 1.46, height: 0.62, depth: 1.6 }, new Vector3(0, 1.12, -0.16), windowMaterial, node);
        for (const wheelX of [-0.87, 0.87]) {
          for (const wheelZ of [-1.08, 1.12]) {
            const wheel = createCylinder(scene, `scenario-wheel-${index}-${wheelX}-${wheelZ}`, { height: 0.2, diameter: 0.58 }, new Vector3(wheelX, 0.45, wheelZ), tireMaterial, node);
            wheel.rotation.z = Math.PI / 2;
          }
        }
      }
      const displayLimit = lane.speedLimit ?? (this.options.speedUnit === "mph" ? 30 : 50);
      const limitMps = this.options.speedUnit === "mph"
        ? displayLimit / 2.236936
        : displayLimit / 3.6;
      const cruiseSpeed = Math.max(3.5, limitMps * (0.58 + random() * 0.22));
      const npc: NpcVehicle = {
        node,
        direction: 1,
        speed: cruiseSpeed,
        currentSpeed: cruiseSpeed,
        z,
        laneX: x,
        laneId: pathSegment.laneId,
        pathSegments: connectedPath.segments,
        pathSegment: segment,
        pathDistance: initialDistance,
        spawnPathSegment: segment,
        spawnPathDistance: initialDistance,
        spawnIndex: index % Math.max(1, vehicleSpawns.length),
        loop: connectedPath.loop,
        active: true,
      };
      const safeAtStart = this.isNpcPositionSafe(npc, x, z, heading, false);
      npc.active = safeAtStart;
      npc.respawnAfterSeconds = safeAtStart ? 0 : 2.5;
      node.position.set(x, 0.12, z);
      node.rotation.y = heading;
      node.setEnabled(safeAtStart);
      this.npcVehicles.push(npc);
    }

    const requestedPedestrians = Math.min(10, lesson.vulnerableRoadUsers?.pedestrians ?? 0);
    const requestedCyclists = Math.min(5, lesson.vulnerableRoadUsers?.cyclists ?? 0);
    const authoredSpawns = mapPack.laneGraph.spawnPoints.filter(
      (spawn) => spawn.kind === "pedestrian" || spawn.kind === "cyclist",
    );
    const crosswalks = mapPack.laneGraph.controls.filter(
      (control) => control.type === "crosswalk",
    );
    const skin = makeMaterial(scene, "scenario-road-user-skin", new Color3(0.71, 0.49, 0.36));
    const roadUserCount = requestedPedestrians + requestedCyclists;
    for (let index = 0; index < roadUserCount; index += 1) {
      const isCyclist = index >= requestedPedestrians;
      const authored = authoredSpawns[index % Math.max(1, authoredSpawns.length)];
      const authoredPose = authored && "pose" in authored ? authored.pose : undefined;
      const crosswalk = crosswalks[index % Math.max(1, crosswalks.length)];
      const source = authoredPose?.position ?? crosswalk?.position ?? this.routePoints[index % Math.max(1, this.routePoints.length)] ?? { x: 0, z: 0 };
      const heading = authoredPose
        ? degreesToRadians(authoredPose.headingDeg)
        : crosswalk
          ? degreesToRadians(crosswalk.headingDeg + 90)
          : (index % 2 === 0 ? Math.PI / 2 : -Math.PI / 2);
      const node = new TransformNode(`scenario-road-user-${index}`, scene);
      const clothing = makeMaterial(
        scene,
        `scenario-road-user-color-${index}`,
        trafficColors[(index + 1) % trafficColors.length],
      );
      if (isCyclist) {
        createBox(scene, `cyclist-frame-${index}`, { width: 0.18, height: 0.48, depth: 1.15 }, new Vector3(0, 0.63, 0), clothing, node);
        for (const wheelZ of [-0.58, 0.58]) {
          const wheel = createCylinder(scene, `cycle-wheel-${index}-${wheelZ}`, { height: 0.1, diameter: 0.66, tessellation: 12 }, new Vector3(0, 0.38, wheelZ), tireMaterial, node);
          wheel.rotation.z = Math.PI / 2;
        }
        createCylinder(scene, `cyclist-body-${index}`, { height: 0.78, diameterTop: 0.3, diameterBottom: 0.42 }, new Vector3(0, 1.08, 0), clothing, node);
        createCylinder(scene, `cyclist-head-${index}`, { height: 0.35, diameter: 0.34 }, new Vector3(0, 1.63, 0), skin, node);
      } else {
        createCylinder(scene, `pedestrian-body-${index}`, { height: 1.02, diameterTop: 0.34, diameterBottom: 0.48 }, new Vector3(0, 0.9, 0), clothing, node);
        createCylinder(scene, `pedestrian-head-${index}`, { height: 0.4, diameter: 0.38 }, new Vector3(0, 1.59, 0), skin, node);
      }
      const phase = random() * 18;
      node.position.set(source.x, 0.08, source.z);
      node.rotation.y = heading;
      this.pedestrians.push({
        node,
        phase,
        speed: isCyclist ? 2.2 + random() : 0.65 + random() * 0.25,
        z: source.z,
        origin: { x: source.x, z: source.z },
        heading,
        span: isCyclist ? 34 : mapPack.geometry.roadWidth + 6,
        kind: isCyclist ? "cyclist" : "pedestrian",
      });
    }
  }

  private installListeners() {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const drivingKey = [
        "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space",
        "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "KeyC",
        "KeyH", "KeyP", "KeyR", "KeyG", "KeyZ", "KeyX", "KeyV", "Escape",
      ].includes(event.code);
      if (drivingKey) event.preventDefault();
      if (drivingKey) this.inputRouter.registerMeaningfulInput("keyboard");
      switch (event.code) {
        case "ArrowUp":
        case "KeyW":
          this.keyboard.throttle = 1;
          break;
        case "ArrowDown":
        case "KeyS":
        case "Space":
          this.keyboard.brake = 1;
          break;
        case "ArrowLeft":
        case "KeyA":
          this.keyboard.steer = -1;
          break;
        case "ArrowRight":
        case "KeyD":
          this.keyboard.steer = 1;
          break;
        case "KeyZ":
          this.keyboard.quickLook = -1;
          break;
        case "KeyX":
          this.keyboard.quickLook = 1;
          break;
        case "KeyV":
          this.keyboard.quickLook = 2;
          break;
        case "KeyQ":
          if (!event.repeat) this.setIndicator("left");
          break;
        case "KeyE":
          if (!event.repeat) this.setIndicator("right");
          break;
        case "KeyC":
          if (!event.repeat) this.toggleCamera();
          break;
        case "KeyH":
          if (!event.repeat) this.horn();
          break;
        case "KeyP":
        case "Escape":
          if (!event.repeat) this.togglePause();
          break;
        case "KeyR":
          if (!event.repeat) this.reset();
          break;
        case "KeyG":
          if (!event.repeat) this.toggleGear();
          break;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      switch (event.code) {
        case "ArrowUp":
        case "KeyW":
          this.keyboard.throttle = 0;
          break;
        case "ArrowDown":
        case "KeyS":
        case "Space":
          this.keyboard.brake = 0;
          break;
        case "ArrowLeft":
        case "KeyA":
          if (this.keyboard.steer < 0) this.keyboard.steer = 0;
          break;
        case "ArrowRight":
        case "KeyD":
          if (this.keyboard.steer > 0) this.keyboard.steer = 0;
          break;
        case "KeyZ":
        case "KeyX":
        case "KeyV":
          this.keyboard.quickLook = 0;
          break;
      }
    };
    const onBlur = () => this.clearHeldInputs();
    const onVisibility = () => {
      if (document.hidden) this.setPaused(true);
      this.clearHeldInputs();
    };
    const onResize = () => this.engine.resize();
    const onOrientationChange = () => {
      this.engine.resize();
      const portraitGateManagedByReact = this.options.inputCapabilities.touchFirst;
      if (!portraitGateManagedByReact) this.setPaused(true);
      this.clearHeldInputs();
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      this.contextLost = true;
      this.setPaused(true);
      this.emit("context-lost", "Graphics context lost. SideSwap is waiting to recover.", "warning");
      this.callbacks.onContextLost?.();
    };
    const onContextRestored = () => {
      this.contextLost = false;
      this.lastFrameTime = performance.now();
      this.emit("context-restored", "Graphics restored. Review your position before continuing.");
      this.callbacks.onContextRestored?.();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || this.swipePointer !== null) return;
      this.registerTouchInput();
      this.swipePointer = event.pointerId;
      this.swipeStartX = event.clientX;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== this.swipePointer) return;
      this.touch.quickLook = clamp((event.clientX - this.swipeStartX) / 90, -1, 1);
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (event.pointerId !== this.swipePointer) return;
      this.swipePointer = null;
      this.touch.quickLook = 0;
    };
    const onGamepadDisconnected = () => {
      const remaining = "getGamepads" in navigator
        ? Array.from(navigator.getGamepads()).find(Boolean)
        : null;
      if (!remaining) this.handleGamepadDisconnected();
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onOrientationChange);
    window.addEventListener("gamepaddisconnected", onGamepadDisconnected);
    document.addEventListener("visibilitychange", onVisibility);
    this.canvas.addEventListener("webglcontextlost", onContextLost, false);
    this.canvas.addEventListener("webglcontextrestored", onContextRestored, false);
    this.canvas.addEventListener("pointerdown", onPointerDown, { passive: true });
    this.canvas.addEventListener("pointermove", onPointerMove, { passive: true });
    this.canvas.addEventListener("pointerup", onPointerEnd, { passive: true });
    this.canvas.addEventListener("pointercancel", onPointerEnd, { passive: true });
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(this.canvas);

    this.disposers.push(() => window.removeEventListener("keydown", onKeyDown));
    this.disposers.push(() => window.removeEventListener("keyup", onKeyUp));
    this.disposers.push(() => window.removeEventListener("blur", onBlur));
    this.disposers.push(() => window.removeEventListener("resize", onResize));
    this.disposers.push(() =>
      window.removeEventListener("orientationchange", onOrientationChange),
    );
    this.disposers.push(() => window.removeEventListener("gamepaddisconnected", onGamepadDisconnected));
    this.disposers.push(() => document.removeEventListener("visibilitychange", onVisibility));
    this.disposers.push(() => this.canvas.removeEventListener("webglcontextlost", onContextLost));
    this.disposers.push(() => this.canvas.removeEventListener("webglcontextrestored", onContextRestored));
    this.disposers.push(() => this.canvas.removeEventListener("pointerdown", onPointerDown));
    this.disposers.push(() => this.canvas.removeEventListener("pointermove", onPointerMove));
    this.disposers.push(() => this.canvas.removeEventListener("pointerup", onPointerEnd));
    this.disposers.push(() => this.canvas.removeEventListener("pointercancel", onPointerEnd));
    this.disposers.push(() => resizeObserver.disconnect());
  }

  private pollGamepad() {
    if (!("getGamepads" in navigator)) return;
    const pad = Array.from(navigator.getGamepads()).find(Boolean);
    if (!pad) {
      if (this.gamepadConnected) this.handleGamepadDisconnected();
      return;
    }
    this.gamepadConnected = true;
    const deadzone = (value: number) =>
      Math.abs(value) < 0.14 ? 0 : Math.sign(value) * ((Math.abs(value) - 0.14) / 0.86);
    const nextGamepad: AnalogInput = {
      steer: clamp(deadzone(pad.axes[0] ?? 0), -1, 1),
      quickLook: clamp(deadzone(pad.axes[2] ?? 0), -1, 1),
      throttle: pad.buttons[7]?.value ?? 0,
      brake: pad.buttons[6]?.value ?? 0,
    };

    const pressed = pad.buttons.map((button) => button.pressed);
    const edge = (index: number) => pressed[index] && !this.gamepadButtons[index];
    const buttonUsed = pressed.some(
      (isPressed, index) => isPressed && !this.gamepadButtons[index],
    );
    const analogUsed = (Object.keys(nextGamepad) as Array<keyof AnalogInput>).some(
      (control) =>
        Math.abs(nextGamepad[control]) >= 0.08 &&
        Math.abs(nextGamepad[control] - this.gamepad[control]) >= 0.04,
    );
    this.gamepad = nextGamepad;
    if (buttonUsed || analogUsed) this.inputRouter.registerMeaningfulInput("gamepad");
    if (this.paused) {
      if (edge(0) || edge(1) || edge(9)) this.setPaused(false);
      this.gamepadButtons = pressed;
      return;
    }
    if (edge(0)) this.horn();
    if (edge(1)) this.toggleCamera();
    if (edge(2)) this.setIndicator("left");
    if (edge(3)) this.setIndicator("right");
    if (edge(4)) this.toggleGear();
    if (edge(9)) this.togglePause();
    if (edge(8)) this.reset();
    this.gamepadButtons = pressed;
  }

  private handleGamepadDisconnected() {
    const wasActive = this.inputRouter.getPresentation().activeFamily === "gamepad";
    this.gamepadConnected = false;
    this.clearHeldInputs();
    this.gamepadButtons = [];
    if (!wasActive) return;

    const fallback = this.inputRouter.handleGamepadDisconnect();
    this.instruction =
      fallback === "touch"
        ? "Controller disconnected. Drive paused — use the touch controls to continue."
        : "Controller disconnected. Drive paused — use the keyboard to continue.";
    this.emit("coaching", this.instruction, "warning");
    this.setPaused(true);
    this.publishHud(true);
  }

  private clearHeldInputs() {
    this.keyboard = { throttle: 0, brake: 0, steer: 0, quickLook: 0 };
    this.touch = { throttle: 0, brake: 0, steer: 0, quickLook: 0 };
    this.gamepad = { throttle: 0, brake: 0, steer: 0, quickLook: 0 };
  }

  private coach(message: string) {
    this.instruction = message;
    this.playCoachTone();
    this.emit("coaching", message, "warning");
    this.publishHud(true);
  }

  private emit(
    type: GameRuntimeEvent["type"],
    message: string,
    severity: GameRuntimeEvent["severity"] = "info",
    rule?: Pick<GameRuntimeEvent, "ruleCode" | "penalty" | "evidence">,
  ) {
    this.callbacks.onEvent?.({
      type,
      message,
      severity,
      timestamp: eventNow(),
      ...rule,
    });
  }

  private publishHud(force = false) {
    const now = performance.now();
    if (!force && now - this.lastHudTime < 90) return;
    this.lastHudTime = now;
    const speed = this.simulationSnapshot.speedDisplay;
    const speedUnit: SpeedUnit =
      this.simulationSnapshot.speedUnit === "kmh" ? "km/h" : "mph";
    const objectives = this.options.lesson?.objectives ?? [];
    const objectiveIndex = objectives.length
      ? Math.min(
          objectives.length - 1,
          Math.floor(this.routeProgress * objectives.length),
        )
      : 0;
    const scenarioProgress = this.options.lesson
      ? this.routeProgress
      : clamp(
          (this.playerState.z - START_Z) / (FINISH_Z - START_Z),
          0,
          1,
        );
    this.callbacks.onHudUpdate?.({
      speed: Math.round(speed),
      speedUnit,
      gear: this.playerState.gear,
      cameraMode: this.cameraMode,
      indicator: this.playerState.indicator,
      score: Math.round(this.score),
      objectiveProgress: scenarioProgress,
      instruction: this.instruction,
      paused: this.paused,
      honking: now < this.hornUntil,
      rearViewVisible: this.cameraMode === "first",
      scenarioId: this.options.lesson?.id ?? "orientation-yard",
      scenarioTitle: this.options.lesson?.title ?? "SideSwap Orientation",
      objective:
        objectives[objectiveIndex]?.label ??
        "Reach the end of the training route",
      checkpoint: this.checkpointLabel,
      trafficSide: this.simulationSnapshot.trafficSide,
      scenarioClock: this.options.lesson?.scenarioClock?.label,
    });
  }

  private playHornTone() {
    if (this.options.masterVolume <= 0 || this.options.effectsVolume <= 0) return;
    try {
      const AudioContextClass = window.AudioContext;
      this.audioContext ??= new AudioContextClass();
      const context = this.audioContext;
      if (context.state === "suspended") void context.resume();
      const oscillatorA = context.createOscillator();
      const oscillatorB = context.createOscillator();
      const gain = context.createGain();
      oscillatorA.type = "square";
      oscillatorB.type = "square";
      oscillatorA.frequency.value = 205;
      oscillatorB.frequency.value = 258;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(
          0.001,
          0.075 * this.options.masterVolume * this.options.effectsVolume,
        ),
        context.currentTime + 0.012,
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.2);
      oscillatorA.connect(gain);
      oscillatorB.connect(gain);
      gain.connect(context.destination);
      oscillatorA.start();
      oscillatorB.start();
      oscillatorA.stop(context.currentTime + 0.21);
      oscillatorB.stop(context.currentTime + 0.21);
    } catch {
      // Audio is a progressive enhancement; the visual horn indicator remains.
    }
  }

  private playCoachTone() {
    if (this.options.masterVolume <= 0 || this.options.coachVolume <= 0) return;
    try {
      const AudioContextClass = window.AudioContext;
      this.audioContext ??= new AudioContextClass();
      const context = this.audioContext;
      if (context.state === "suspended") void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(520, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(
        690,
        context.currentTime + 0.12,
      );
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(
          0.001,
          0.025 * this.options.masterVolume * this.options.coachVolume,
        ),
        context.currentTime + 0.015,
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.19);
    } catch {
      // Text coaching remains available when browser audio cannot start.
    }
  }
}

const shellStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  minHeight: 420,
  overflow: "hidden",
  borderRadius: 24,
  background: "#172226",
  color: "#f6f2e7",
  isolation: "isolate",
};

const canvasStyle: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  minHeight: 420,
  outline: "none",
  touchAction: "none",
};

const glassPanelStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,.17)",
  background: "rgba(10,18,20,.72)",
  boxShadow: "0 10px 35px rgba(0,0,0,.18)",
  backdropFilter: "blur(12px)",
};

const actionButtonStyle: CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,.22)",
  background: "rgba(17,27,29,.82)",
  color: "#fff9ea",
  font: "700 12px/1 system-ui, sans-serif",
  letterSpacing: ".03em",
  touchAction: "none",
  userSelect: "none",
};

const INPUT_GUIDANCE: Record<
  InputFamily,
  { readonly label: string; readonly orientationHint: string; readonly details: string }
> = {
  keyboard: {
    label: "Keyboard",
    orientationHint: "W / ↑ drives · S / ↓ brakes · A / D steers",
    details:
      "W or ↑ drives, S, ↓, or Space brakes, and A/D or ←/→ steers. Q/E signal, C changes camera, G changes gear, H sounds the horn, and P or Escape pauses.",
  },
  gamepad: {
    label: "Controller",
    orientationHint: "Left stick steers · right trigger drives · left trigger brakes",
    details:
      "Use the left stick to steer, right trigger to drive, and left trigger to brake. A sounds the horn, B changes camera, X/Y signal, LB changes gear, and Start pauses.",
  },
  touch: {
    label: "Touch",
    orientationHint: "Use the left steering pad and right Drive / Brake pedals",
    details:
      "Use the left thumb pad to steer and the right Drive and Brake pedals for speed. The upper-right controls handle indicators, camera, horn, gear, and pause. Swipe the road view to look around.",
  },
};

export const GameCanvas = forwardRef<GameCanvasHandle, GameCanvasProps>(
  function GameCanvas(
    {
      trafficSide,
      steeringSide,
      lesson,
      mapPack,
      cameraMode = "third",
      speedUnit = "mph",
      paused = false,
      reducedMotion = false,
      steeringSensitivity = 1,
      fieldOfView = DEFAULT_HORIZONTAL_FOV,
      masterVolume = 0.75,
      effectsVolume = 0.75,
      coachVolume = 0.8,
      cameraShake = false,
      headBob = false,
      visualHonkIndicator = true,
      className,
      style,
      showBuiltInHud = true,
      onHudUpdate,
      onEvent,
      onPauseChange,
      onCameraChange,
      onComplete,
    },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const sessionRef = useRef<BabylonGameSession | null>(null);
    const callbackRef = useRef<SessionCallbacks>({});
    const viewportReadyRef = useRef(false);
    const touchPortraitGateRef = useRef(false);
    const inputCapabilitiesRef = useRef<InputCapabilities>(
      readInputCapabilities(),
    );
    const [runtimeState, setRuntimeState] = useState<
      "loading" | "ready" | "unsupported" | "context-lost" | "error"
    >("loading");
    const [isPortrait, setIsPortrait] = useState(false);
    const [inputPresentation, setInputPresentation] =
      useState<AdaptiveInputPresentation>(() =>
        createInitialInputPresentation(inputCapabilitiesRef.current),
      );
    const [sessionActivation, setSessionActivation] = useState(0);
    const [hud, setHud] = useState<GameHudSnapshot>({
      speed: 0,
      speedUnit,
      gear: "D",
      cameraMode,
      indicator: "off",
      score: 100,
      objectiveProgress: 0,
      instruction: "Preparing the training yard…",
      paused,
      honking: false,
      rearViewVisible: cameraMode === "first",
      scenarioId: lesson?.id ?? "orientation-yard",
      scenarioTitle: lesson?.title ?? "SideSwap Orientation",
      objective:
        lesson?.objectives[0]?.label ??
        "Reach the end of the training route",
      checkpoint: "Start",
      trafficSide: lesson?.trafficSide ?? trafficSide,
    });

    callbackRef.current = {
      onHudUpdate: (snapshot) => {
        setHud(snapshot);
        onHudUpdate?.(snapshot);
      },
      onEvent,
      onPauseChange,
      onCameraChange,
      onComplete,
      onReady: () => setRuntimeState("ready"),
      onContextLost: () => setRuntimeState("context-lost"),
      onContextRestored: () => setRuntimeState("ready"),
    };

    useEffect(() => {
      const updateViewportFlags = () => {
        const capabilities = readInputCapabilities();
        const portrait = window.matchMedia("(orientation: portrait)").matches;
        const portraitGate = portrait && capabilities.touchFirst;
        const wasReady = viewportReadyRef.current;
        const wasPortraitGate = touchPortraitGateRef.current;
        viewportReadyRef.current = true;
        touchPortraitGateRef.current = portraitGate;
        inputCapabilitiesRef.current = capabilities;
        if (!wasReady) {
          setInputPresentation(createInitialInputPresentation(capabilities));
        }
        sessionRef.current?.setInputCapabilities(capabilities);
        setIsPortrait(portrait);

        if (portraitGate) {
          sessionRef.current?.clearTouch();
          sessionRef.current?.setPaused(true);
        } else if (wasReady && wasPortraitGate) {
          if (sessionRef.current) {
            sessionRef.current.setPaused(paused, false);
          } else {
            setSessionActivation((activation) => activation + 1);
          }
        }
      };
      updateViewportFlags();
      window.addEventListener("resize", updateViewportFlags);
      window.addEventListener("orientationchange", updateViewportFlags);
      return () => {
        window.removeEventListener("resize", updateViewportFlags);
        window.removeEventListener("orientationchange", updateViewportFlags);
      };
    }, [paused]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (!viewportReadyRef.current || touchPortraitGateRef.current) {
        setRuntimeState("loading");
        return;
      }
      const testCanvas = document.createElement("canvas");
      if (!testCanvas.getContext("webgl2")) {
        setRuntimeState("unsupported");
        return;
      }

      let alive = true;
      let ownedSession: BabylonGameSession | null = null;
      setRuntimeState("loading");
      try {
        const session = new BabylonGameSession(
          canvas,
          {
            trafficSide,
            steeringSide,
            lesson,
            mapPack,
            cameraMode,
            inputCapabilities: inputCapabilitiesRef.current,
            speedUnit,
            paused: paused || touchPortraitGateRef.current,
            reducedMotion,
            steeringSensitivity: clamp(steeringSensitivity, 0.45, 1.8),
            fieldOfView: clampHorizontalFieldOfView(fieldOfView),
            masterVolume: clamp(masterVolume, 0, 1),
            effectsVolume: clamp(effectsVolume, 0, 1),
            coachVolume: clamp(coachVolume, 0, 1),
            cameraShake,
            headBob,
          },
          {
            onHudUpdate: (snapshot) => callbackRef.current.onHudUpdate?.(snapshot),
            onEvent: (event) => callbackRef.current.onEvent?.(event),
            onPauseChange: (value) => callbackRef.current.onPauseChange?.(value),
            onCameraChange: (value) => callbackRef.current.onCameraChange?.(value),
            onInputPresentationChange: (value) => setInputPresentation(value),
            onComplete: (score) => callbackRef.current.onComplete?.(score),
            onReady: () => callbackRef.current.onReady?.(),
            onContextLost: () => callbackRef.current.onContextLost?.(),
            onContextRestored: () => callbackRef.current.onContextRestored?.(),
          },
        );
        ownedSession = session;
        if (!alive) {
          session.dispose();
          return;
        }
        sessionRef.current = session;
      } catch (error) {
        console.error("Unable to start SideSwap", error);
        setRuntimeState(error instanceof Error && error.message.includes("WebGL 2") ? "unsupported" : "error");
      }
      return () => {
        alive = false;
        if (sessionRef.current === ownedSession) sessionRef.current = null;
        ownedSession?.dispose();
      };
      // Rebuild only when scene-defining jurisdiction/cockpit choices change.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trafficSide, steeringSide, lesson?.id, mapPack?.id, sessionActivation]);

    useEffect(() => {
      sessionRef.current?.updateOptions({
        cameraMode,
        speedUnit,
        paused: paused || touchPortraitGateRef.current,
        reducedMotion,
        steeringSensitivity: clamp(steeringSensitivity, 0.45, 1.8),
        fieldOfView: clampHorizontalFieldOfView(fieldOfView),
        masterVolume: clamp(masterVolume, 0, 1),
        effectsVolume: clamp(effectsVolume, 0, 1),
        coachVolume: clamp(coachVolume, 0, 1),
        cameraShake,
        headBob,
      });
    }, [cameraMode, speedUnit, paused, reducedMotion, steeringSensitivity, fieldOfView, masterVolume, effectsVolume, coachVolume, cameraShake, headBob]);

    useImperativeHandle(
      ref,
      () => ({
        reset: () => sessionRef.current?.reset(),
        toggleCamera: () => sessionRef.current?.toggleCamera(),
        togglePause: () => sessionRef.current?.togglePause(),
        horn: () => sessionRef.current?.horn(),
        setGear: (gear) => sessionRef.current?.setGear(gear),
        setIndicator: (indicator) => sessionRef.current?.setIndicator(indicator),
        focus: () => canvasRef.current?.focus(),
      }),
      [],
    );

    const registerTouchPointer = useCallback((pointerType: string) => {
      if (pointerType === "touch" || pointerType === "pen") {
        sessionRef.current?.registerTouchInput();
      }
    }, []);

    const updateSteeringPad = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const centerX = bounds.left + bounds.width / 2;
      sessionRef.current?.setTouchAnalog(
        "steer",
        clamp((event.clientX - centerX) / (bounds.width * 0.36), -1, 1),
      );
    }, []);

    const endSteering = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      sessionRef.current?.setTouchAnalog("steer", 0);
    }, []);

    const touchVisible =
      inputPresentation.touchFirst || inputPresentation.touchRevealed;
    const touchPortraitGate = inputPresentation.touchFirst && isPortrait;
    const criticalOverlay = runtimeState !== "ready";
    const activeInputGuide = INPUT_GUIDANCE[inputPresentation.activeFamily];
    const showOrientationControlsHint =
      runtimeState === "ready" &&
      !hud.paused &&
      (lesson?.kind ?? "orientation") === "orientation" &&
      hud.objectiveProgress < 0.08;

    return (
      <div className={className} style={{ ...shellStyle, ...style }}>
        <canvas
          ref={canvasRef}
          aria-label={`SideSwap 3D ${trafficSide}-side driving training area`}
          tabIndex={0}
          style={canvasStyle}
        />

        {showBuiltInHud && (
          <>
            <div
              aria-live="polite"
              style={{
                ...glassPanelStyle,
                position: "absolute",
                top: 16,
                left: 16,
                display: "flex",
                alignItems: "center",
                gap: 13,
                padding: "10px 14px",
                borderRadius: 16,
                pointerEvents: "none",
                fontFamily: "system-ui, sans-serif",
              }}
            >
              <div style={{ fontSize: 28, fontWeight: 850, lineHeight: 1 }}>{hud.speed}</div>
              <div style={{ opacity: 0.72, fontSize: 11, lineHeight: 1.2 }}>
                {hud.speedUnit}
                <br />GEAR {hud.gear}
              </div>
              <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,.16)" }} />
              <div style={{ fontSize: 11, lineHeight: 1.45, opacity: 0.9 }}>
                SCORE {hud.score}
                <br />{hud.cameraMode === "first" ? "COCKPIT" : "CHASE"}
                <br />IND {hud.indicator === "off" ? "OFF" : hud.indicator === "left" ? "← LEFT" : "RIGHT →"}
              </div>
            </div>

            {hud.rearViewVisible && (
              <div
                style={{
                  position: "absolute",
                  top: "3%",
                  left: "50%",
                  width: "28%",
                  height: "12.5%",
                  transform: "translateX(-50%)",
                  boxSizing: "border-box",
                  border: "4px solid rgba(18,24,25,.94)",
                  borderRadius: 13,
                  background: "linear-gradient(145deg, rgba(255,255,255,.09), transparent 32%)",
                  boxShadow: "inset 0 0 0 2px rgba(255,255,255,.13), 0 5px 18px rgba(0,0,0,.38)",
                  pointerEvents: "none",
                }}
              >
                <i
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    bottom: -14,
                    left: "50%",
                    width: 22,
                    height: 14,
                    transform: "translateX(-50%)",
                    background: "#182021",
                    clipPath: "polygon(28% 0,72% 0,100% 100%,0 100%)",
                  }}
                />
                <span style={{ position: "absolute", bottom: 5, left: 9, padding: "2px 5px", borderRadius: 5, background: "rgba(10,18,20,.45)", font: "750 8px system-ui", letterSpacing: ".13em", opacity: 0.76 }}>
                  REAR VIEW
                </span>
              </div>
            )}

            <div
              style={{
                ...glassPanelStyle,
                position: "absolute",
                top: 16,
                right: 16,
                width: "min(360px, calc(100% - 180px))",
                padding: "12px 15px",
                borderRadius: 16,
                pointerEvents: "none",
                font: "650 13px/1.35 system-ui, sans-serif",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 7 }}>
                <span style={{ color: "#f2c658", fontSize: 10, letterSpacing: ".1em" }}>COACH</span>
                <span style={{ opacity: 0.62, fontSize: 10 }}>{Math.round(hud.objectiveProgress * 100)}%</span>
              </div>
              <div style={{ marginBottom: 5, fontSize: 10, opacity: 0.62 }}>
                {hud.scenarioTitle} · {hud.objective}
              </div>
              {hud.scenarioClock && (
                <div
                  aria-label={`Scenario time ${hud.scenarioClock}`}
                  style={{
                    marginBottom: 7,
                    color: "#f2c658",
                    fontSize: 9,
                    fontWeight: 800,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                  }}
                >
                  Scenario time · {hud.scenarioClock}
                </div>
              )}
              {hud.instruction}
              <div style={{ height: 3, marginTop: 10, overflow: "hidden", borderRadius: 99, background: "rgba(255,255,255,.12)" }}>
                <div style={{ width: `${hud.objectiveProgress * 100}%`, height: "100%", background: "#f2c658" }} />
              </div>
            </div>

            {showOrientationControlsHint && (
              <div
                role="status"
                aria-label={`${activeInputGuide.label} control hint`}
                style={{
                  ...glassPanelStyle,
                  position: "absolute",
                  left: 16,
                  bottom: touchVisible ? 122 : 20,
                  maxWidth: "min(390px, calc(100% - 32px))",
                  padding: "9px 12px",
                  borderRadius: 13,
                  pointerEvents: "none",
                  font: "650 12px/1.35 system-ui, sans-serif",
                  transition: reducedMotion ? "none" : "opacity 160ms ease",
                }}
              >
                <span style={{ color: "#f2c658", fontSize: 9, fontWeight: 850, letterSpacing: ".09em" }}>
                  {activeInputGuide.label.toUpperCase()} CONTROLS
                </span>
                <span style={{ display: "block", marginTop: 3, opacity: 0.9 }}>
                  {activeInputGuide.orientationHint}
                </span>
              </div>
            )}

            {hud.honking && visualHonkIndicator && (
              <div
                role="status"
                style={{
                  position: "absolute",
                  left: "50%",
                  bottom: touchVisible ? 126 : 50,
                  transform: "translateX(-50%)",
                  padding: "8px 13px",
                  borderRadius: 99,
                  background: "#f2c658",
                  color: "#172226",
                  font: "850 11px system-ui",
                  letterSpacing: ".08em",
                }}
              >
                HORN · AUDIO CUE
              </div>
            )}
          </>
        )}

        {touchVisible && runtimeState === "ready" && !isPortrait && (
          <div
            role="group"
            aria-label={
              inputPresentation.touchControlsDimmed
                ? "Touch driving controls, dimmed while another input is active"
                : "Touch driving controls"
            }
            onPointerDownCapture={(event) => registerTouchPointer(event.pointerType)}
            style={{
              opacity: inputPresentation.touchControlsDimmed ? 0.18 : 1,
              pointerEvents: "auto",
              transition: reducedMotion ? "none" : "opacity 180ms ease",
            }}
          >
            <div
              role="slider"
              aria-label="Steering"
              aria-valuemin={-1}
              aria-valuemax={1}
              aria-valuenow={0}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                updateSteeringPad(event);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) updateSteeringPad(event);
              }}
              onPointerUp={endSteering}
              onPointerCancel={endSteering}
              style={{
                position: "absolute",
                left: "max(18px, env(safe-area-inset-left))",
                bottom: "max(18px, env(safe-area-inset-bottom))",
                width: 132,
                height: 82,
                borderRadius: 44,
                border: "1px solid rgba(255,255,255,.2)",
                background: "rgba(10,18,20,.58)",
                touchAction: "none",
              }}
            >
              <span style={{ position: "absolute", left: 11, top: 31, font: "800 18px system-ui" }}>‹</span>
              <span style={{ position: "absolute", right: 11, top: 31, font: "800 18px system-ui" }}>›</span>
              <span style={{ position: "absolute", left: "50%", top: "50%", width: 46, height: 46, transform: "translate(-50%,-50%)", borderRadius: 999, border: "5px solid rgba(255,255,255,.75)" }} />
            </div>

            <div style={{ position: "absolute", right: "max(18px, env(safe-area-inset-right))", bottom: "max(18px, env(safe-area-inset-bottom))", display: "flex", alignItems: "flex-end", gap: 12 }}>
              <button
                type="button"
                aria-label="Brake"
                style={{ ...actionButtonStyle, width: 62, height: 80, borderRadius: 20, background: "rgba(126,42,36,.84)" }}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  sessionRef.current?.setTouchAnalog("brake", 1);
                }}
                onPointerUp={() => sessionRef.current?.setTouchAnalog("brake", 0)}
                onPointerCancel={() => sessionRef.current?.setTouchAnalog("brake", 0)}
              >
                BRAKE
              </button>
              <button
                type="button"
                aria-label="Accelerator"
                style={{ ...actionButtonStyle, width: 62, height: 104, borderRadius: 20, background: "rgba(36,104,77,.86)" }}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  sessionRef.current?.setTouchAnalog("throttle", 1);
                }}
                onPointerUp={() => sessionRef.current?.setTouchAnalog("throttle", 0)}
                onPointerCancel={() => sessionRef.current?.setTouchAnalog("throttle", 0)}
              >
                DRIVE
              </button>
            </div>

            <div style={{ position: "absolute", right: "max(24px, env(safe-area-inset-right))", top: 82, display: "grid", gridTemplateColumns: "repeat(2, 48px)", gap: 8 }}>
              <button type="button" style={actionButtonStyle} aria-label="Left indicator" onClick={() => sessionRef.current?.setIndicator("left")}>◀</button>
              <button type="button" style={actionButtonStyle} aria-label="Right indicator" onClick={() => sessionRef.current?.setIndicator("right")}>▶</button>
              <button type="button" style={actionButtonStyle} aria-label="Change camera" onClick={() => sessionRef.current?.toggleCamera()}>CAM</button>
              <button type="button" style={actionButtonStyle} aria-label="Sound horn" onClick={() => sessionRef.current?.horn()}>HORN</button>
              <button type="button" style={actionButtonStyle} aria-label="Toggle Drive and Reverse" onClick={() => sessionRef.current?.toggleGear()}>{hud.gear}</button>
              <button type="button" style={actionButtonStyle} aria-label="Pause" onClick={() => sessionRef.current?.togglePause()}>Ⅱ</button>
            </div>

            {hud.cameraMode === "first" && (
              <div style={{ position: "absolute", left: "50%", bottom: 18, transform: "translateX(-50%)", display: "flex", gap: 8 }}>
                <button
                  type="button"
                  style={actionButtonStyle}
                  aria-label="Look left"
                  onPointerDown={() => sessionRef.current?.setTouchAnalog("quickLook", -1)}
                  onPointerUp={() => sessionRef.current?.setTouchAnalog("quickLook", 0)}
                  onPointerCancel={() => sessionRef.current?.setTouchAnalog("quickLook", 0)}
                >LOOK L</button>
                <button
                  type="button"
                  style={actionButtonStyle}
                  aria-label="Look behind"
                  onPointerDown={() => sessionRef.current?.setTouchAnalog("quickLook", 2)}
                  onPointerUp={() => sessionRef.current?.setTouchAnalog("quickLook", 0)}
                  onPointerCancel={() => sessionRef.current?.setTouchAnalog("quickLook", 0)}
                >REAR</button>
                <button
                  type="button"
                  style={actionButtonStyle}
                  aria-label="Look right"
                  onPointerDown={() => sessionRef.current?.setTouchAnalog("quickLook", 1)}
                  onPointerUp={() => sessionRef.current?.setTouchAnalog("quickLook", 0)}
                  onPointerCancel={() => sessionRef.current?.setTouchAnalog("quickLook", 0)}
                >LOOK R</button>
              </div>
            )}
          </div>
        )}

        {hud.paused && runtimeState === "ready" && (
          <div
            role="dialog"
            aria-label="Game paused"
            aria-modal="true"
            onPointerDownCapture={(event) => registerTouchPointer(event.pointerType)}
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              background: "rgba(8,14,16,.54)",
              backdropFilter: "blur(5px)",
            }}
          >
            <div style={{ ...glassPanelStyle, padding: "24px 28px", borderRadius: 20, textAlign: "center", fontFamily: "system-ui" }}>
              <strong style={{ display: "block", marginBottom: 6, fontSize: 24 }}>Paused</strong>
              <span style={{ display: "block", marginBottom: 8, opacity: 0.9, fontSize: 13 }}>{hud.instruction}</span>
              <span style={{ display: "block", marginBottom: 18, opacity: 0.62, fontSize: 11 }}>Inputs have been cleared for safety.</span>
              <details style={{ width: "min(330px, 100%)", margin: "0 auto 18px", textAlign: "left", fontSize: 12, lineHeight: 1.45 }}>
                <summary style={{ cursor: "pointer", color: "#f2c658", fontWeight: 800 }}>
                  How to drive · {activeInputGuide.label}
                </summary>
                <span style={{ display: "block", marginTop: 8, opacity: 0.82 }}>
                  {activeInputGuide.details}
                </span>
              </details>
              <button autoFocus type="button" style={{ ...actionButtonStyle, width: "auto", paddingInline: 20 }} onClick={() => sessionRef.current?.setPaused(false)}>
                RESUME
              </button>
            </div>
          </div>
        )}

        {criticalOverlay && (
          <div
            role="status"
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              padding: 28,
              background: "#172226",
              textAlign: "center",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            <div style={{ maxWidth: 470 }}>
              <div aria-hidden="true" style={{ margin: "0 auto 18px", width: 54, height: 54, borderRadius: 18, border: "5px solid #f2c658", transform: "rotate(45deg)" }} />
              <strong style={{ display: "block", marginBottom: 9, fontSize: 23 }}>
                {runtimeState === "unsupported" && "This browser cannot start the 3D drive"}
                {runtimeState === "context-lost" && "The 3D view was interrupted"}
                {runtimeState === "error" && "The training yard could not load"}
                {runtimeState === "loading" && "Preparing your training drive…"}
              </strong>
              <span style={{ opacity: 0.72, fontSize: 14, lineHeight: 1.5 }}>
                {runtimeState === "unsupported"
                  ? "SideSwap needs WebGL 2 with hardware acceleration. Try an up-to-date Chrome, Edge, Firefox, or Safari browser."
                  : runtimeState === "context-lost"
                    ? "Your position is safe. The lesson is paused while the browser restores graphics."
                    : runtimeState === "error"
                      ? "Refresh the page to rebuild the lesson. Your saved progress is unaffected."
                      : "Building roads, traffic, and your cockpit."}
              </span>
            </div>
          </div>
        )}

        {touchPortraitGate && (
          <div
            role="dialog"
            aria-label="Rotate device"
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              padding: 30,
              background: "rgba(12,20,22,.94)",
              textAlign: "center",
              fontFamily: "system-ui, sans-serif",
              zIndex: 10,
            }}
          >
            <div>
              <div aria-hidden="true" style={{ fontSize: 48, marginBottom: 14 }}>↻</div>
              <strong style={{ display: "block", fontSize: 22, marginBottom: 8 }}>Rotate to landscape</strong>
              <span style={{ opacity: 0.68, fontSize: 14 }}>A wider road view keeps the touch controls clear.</span>
            </div>
          </div>
        )}
      </div>
    );
  },
);

GameCanvas.displayName = "GameCanvas";

export default GameCanvas;
