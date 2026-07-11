"use client";

import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  UniversalCamera,
  Vector3,
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
} from "./simulation";

export type TrafficSide = "left" | "right";
export type SteeringSide = "left" | "right";
export type CameraMode = "first" | "third";
export type InputFamily = "keyboard" | "gamepad" | "touch";
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
  ruleCode?: "box_junction" | "restricted_lane";
  penalty?: number;
  evidence?: Readonly<Record<string, string | number | boolean>>;
}

/** Structural lesson contract; existing LessonDefinition objects can be passed directly. */
export interface GameCanvasLesson {
  readonly id: string;
  readonly title: string;
  readonly kind: "orientation" | "guided" | "transition" | "free_drive";
  readonly trafficSide: TrafficSide;
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
}

export interface GameCanvasPoint {
  readonly x: number;
  readonly z: number;
}

export interface GameCanvasLane {
  readonly id: string;
  readonly centerline: readonly GameCanvasPoint[];
  readonly role?: string;
  readonly trafficSide?: TrafficSide;
  readonly speedLimit?: number;
  readonly successors?: readonly string[];
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
    spawnPoints: readonly {
      readonly id: string;
      readonly kind: "player" | "vehicle" | "pedestrian" | "cyclist";
      readonly pose: {
        readonly position: GameCanvasPoint;
        readonly headingDeg: number;
      };
      readonly laneId?: string;
    }[];
    checkpoints: readonly {
      readonly id: string;
      readonly label: string;
      readonly pose: {
        readonly position: GameCanvasPoint;
        readonly headingDeg: number;
      };
      readonly laneId: string;
    }[];
  }>;
}

export interface GameCanvasProps {
  trafficSide: TrafficSide;
  steeringSide: SteeringSide;
  /** Selected authored lesson. Pass the domain LessonDefinition directly. */
  lesson?: GameCanvasLesson;
  /** Selected authored map. Pass the domain MapPack directly. */
  mapPack?: GameCanvasMapPack;
  cameraMode?: CameraMode;
  inputFamily?: InputFamily;
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
  onInputFamilyChange?: (family: InputFamily) => void;
  onComplete?: (score: number) => void;
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
  onInputFamilyChange?: (family: InputFamily) => void;
  onComplete?: (score: number) => void;
  onReady?: () => void;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

interface SessionOptions {
  trafficSide: TrafficSide;
  steeringSide: SteeringSide;
  cameraMode: CameraMode;
  inputFamily: InputFamily;
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

interface NpcVehicle {
  node: TransformNode;
  direction: 1 | -1;
  speed: number;
  z: number;
  laneX: number;
  laneId?: string;
  path?: readonly GameCanvasPoint[];
  pathSegment?: number;
  pathDistance?: number;
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
const TRAFFIC_STEP = 1 / 10;
const START_Z = -52;
const FINISH_Z = 72;
const LANE_CENTER = 2.75;
const MAX_FORWARD_SPEED = 18;
const MAX_REVERSE_SPEED = 6;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const eventNow = () =>
  typeof performance === "undefined" ? Date.now() : performance.now();

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

function scenarioStartPose(
  lesson: GameCanvasLesson | undefined,
  mapPack: GameCanvasMapPack | undefined,
  trafficSide: TrafficSide,
): { x: number; z: number; heading: number } {
  if (lesson && mapPack) {
    const firstLaneId = lesson.route[0];
    const spawn =
      mapPack.laneGraph.spawnPoints.find(
        (point) => point.kind === "player" && point.laneId === firstLaneId,
      ) ?? mapPack.laneGraph.spawnPoints.find((point) => point.kind === "player");
    if (spawn) {
      return {
        x: spawn.pose.position.x,
        z: spawn.pose.position.z,
        heading: degreesToRadians(spawn.pose.headingDeg),
      };
    }
    const lane = mapPack.laneGraph.lanes.find((candidate) => candidate.id === firstLaneId);
    if (lane?.centerline.length) {
      const first = lane.centerline[0];
      const next = lane.centerline[1] ?? { x: first.x, z: first.z + 1 };
      return {
        x: first.x,
        z: first.z,
        heading: Math.atan2(next.x - first.x, next.z - first.z),
      };
    }
  }
  return {
    x: trafficSide === "right" ? LANE_CENTER : -LANE_CENTER,
    z: START_Z,
    heading: 0,
  };
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
    return checkpoint
      ? [{
          id: checkpoint.id,
          label: checkpoint.label,
          x: checkpoint.pose.position.x,
          z: checkpoint.pose.position.z,
          heading: degreesToRadians(checkpoint.pose.headingDeg),
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

class BabylonGameSession {
  private readonly canvas: HTMLCanvasElement;
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly player: TransformNode;
  private readonly playerExterior: TransformNode;
  private readonly playerCockpit: TransformNode;
  private readonly thirdCamera: ArcRotateCamera;
  private readonly firstCamera: UniversalCamera;
  private readonly rearCamera: UniversalCamera;
  private readonly leftIndicatorMeshes: Mesh[] = [];
  private readonly rightIndicatorMeshes: Mesh[] = [];
  private readonly npcVehicles: NpcVehicle[] = [];
  private readonly pedestrians: Pedestrian[] = [];
  private signalRedMaterial: StandardMaterial | null = null;
  private signalGreenMaterial: StandardMaterial | null = null;
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
  private lastInputFamily: InputFamily;
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

  constructor(
    canvas: HTMLCanvasElement,
    options: SessionOptions,
    callbacks: SessionCallbacks,
  ) {
    this.canvas = canvas;
    this.options = options;
    this.callbacks = callbacks;
    this.cameraMode = options.cameraMode;
    this.lastInputFamily = options.inputFamily;
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
    const start = scenarioStartPose(options.lesson, options.mapPack, this.activeTrafficSide);
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
    this.checkpointLabel = this.authoredCheckpoints[0]?.label ?? "Start";
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

    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const scale = coarsePointer
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
    this.thirdCamera.fov = options.fieldOfView;

    this.firstCamera = new UniversalCamera(
      "first-person-camera",
      Vector3.Zero(),
      this.scene,
    );
    this.firstCamera.inputs.clear();
    this.firstCamera.minZ = 0.04;
    this.firstCamera.fov = options.fieldOfView;
    this.firstCamera.parent = this.player;

    this.rearCamera = new UniversalCamera(
      "rear-view-camera",
      Vector3.Zero(),
      this.scene,
    );
    this.rearCamera.inputs.clear();
    this.rearCamera.minZ = 0.08;
    this.rearCamera.fov = 0.72;
    this.rearCamera.viewport = new Viewport(0.35, 0.79, 0.3, 0.17);
    this.rearCamera.parent = this.player;

    this.setCameraMode(options.cameraMode, false);
    this.installListeners();
    this.updatePlayerVisuals(1);

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
    if (options.inputFamily) this.lastInputFamily = options.inputFamily;
    this.thirdCamera.fov = this.options.fieldOfView;
    this.firstCamera.fov = this.options.fieldOfView;
    if (options.cameraMode) this.setCameraMode(options.cameraMode, false);
    if (typeof options.paused === "boolean") this.setPaused(options.paused, false);
  }

  setTouchAnalog(control: keyof AnalogInput, value: number) {
    this.touch[control] = clamp(value, -1, 1);
  }

  clearTouch() {
    this.touch = { throttle: 0, brake: 0, steer: 0, quickLook: 0 };
  }

  registerInputFamily(family: InputFamily) {
    if (this.lastInputFamily === family) return;
    this.lastInputFamily = family;
    this.callbacks.onInputFamilyChange?.(family);
  }

  setPaused(paused: boolean, notify = true) {
    if (this.paused === paused) return;
    this.paused = paused;
    this.clearHeldInputs();
    if (notify) this.callbacks.onPauseChange?.(paused);
    this.publishHud(true);
  }

  togglePause() {
    this.setPaused(!this.paused);
  }

  setCameraMode(mode: CameraMode, notify = true) {
    if (this.cameraMode === mode && this.scene.activeCamera) return;
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
    if (this.playerState.speedMps > 0.25) {
      this.coach("Come to a complete stop before changing between Drive and Reverse.");
      return;
    }
    if (this.playerState.gear === gear) return;
    this.playerState.gear = gear;
    this.emit("gear", gear === "D" ? "Drive selected." : "Reverse selected.");
    this.publishHud(true);
  }

  toggleGear() {
    this.setGear(this.playerState.gear === "D" ? "R" : "D");
  }

  setIndicator(indicator: TurnIndicator) {
    this.playerState.indicator =
      this.playerState.indicator === indicator ? "off" : indicator;
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
    this.playHornTone();
    this.emit("horn", "Horn sounded.");
    this.publishHud(true);
  }

  reset(incidentMessage?: string) {
    this.playerState.x = this.checkpoint.x;
    this.playerState.z = this.checkpoint.z;
    this.playerState.previousX = this.checkpoint.x;
    this.playerState.previousZ = this.checkpoint.z;
    this.playerState.heading = this.checkpoint.heading;
    this.playerState.speedMps = 0;
    this.playerState.gear = "D";
    this.wrongSideSeconds = 0;
    this.offRoadSeconds = 0;
    this.restrictedLaneSeconds.clear();
    this.collisionGraceUntil = eventNow() + 1_800;
    this.clearHeldInputs();
    this.displayedX = this.playerState.x;
    this.displayedZ = this.playerState.z;
    this.displayedHeading = this.playerState.heading;
    if (incidentMessage) {
      this.score = Math.max(0, this.score - 12);
      this.instruction = incidentMessage;
      this.emit("incident", incidentMessage, "critical");
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
      while (this.accumulator >= FIXED_STEP) {
        this.fixedUpdate(FIXED_STEP);
        this.accumulator -= FIXED_STEP;
      }
    }

    const interpolation = this.paused ? 1 : this.accumulator / FIXED_STEP;
    this.updatePlayerVisuals(interpolation);
    this.updateCamera(frameSeconds);
    this.updateIndicatorLights(frameSeconds);
    this.scene.render();
    if (now - this.lastHudTime >= 100) this.publishHud();
  };

  private fixedUpdate(dt: number) {
    const input = this.mergedInput();
    const state = this.playerState;
    state.previousX = state.x;
    state.previousZ = state.z;
    this.ruleElapsedSeconds += dt;

    const throttle = input.throttle;
    const brake = input.brake;
    const maxSpeed = state.gear === "D" ? MAX_FORWARD_SPEED : MAX_REVERSE_SPEED;
    const acceleration = throttle * (state.gear === "D" ? 6.5 : 4.2);
    const braking = brake * 12;
    const rollingResistance = state.speedMps > 0 ? 0.65 + state.speedMps * 0.035 : 0;
    state.speedMps = clamp(
      state.speedMps + (acceleration - braking - rollingResistance) * dt,
      0,
      maxSpeed,
    );
    const direction = state.gear === "D" ? 1 : -1;
    const steeringAuthority = (0.38 + Math.min(state.speedMps, 12) * 0.025) *
      this.options.steeringSensitivity;
    if (state.speedMps > 0.08) {
      state.heading += input.steer * steeringAuthority * direction * dt;
    }
    state.x += Math.sin(state.heading) * state.speedMps * direction * dt;
    state.z += Math.cos(state.heading) * state.speedMps * direction * dt;

    this.trafficAccumulator += dt;
    if (this.trafficAccumulator >= TRAFFIC_STEP) {
      this.updateTraffic(this.trafficAccumulator);
      this.trafficAccumulator = 0;
    }
    this.animatePedestrians(dt);
    this.evaluateLesson(dt);
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
        now >= this.collisionGraceUntil &&
        Math.hypot(state.x - npc.laneX, state.z - npc.z) < 2.35
      ) {
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
      this.callbacks.onComplete?.(Math.round(this.score));
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

    const roadTolerance =
      mapPack.geometry.roadWidth * 0.62 + (mapPack.geometry.shoulderWidth ?? 1);
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
        now >= this.collisionGraceUntil &&
        Math.hypot(
          state.x - npc.node.position.x,
          state.z - npc.node.position.z,
        ) < 2.35
      ) {
        npc.pathDistance = (npc.pathDistance ?? 0) + 24;
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

    this.advanceAuthoredCheckpoints(lesson, state);
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
    if (
      !this.completed &&
      lesson.kind !== "free_drive" &&
      checkpointsComplete &&
      (endpointReached || this.routeProgress >= 0.97)
    ) {
      this.completed = true;
      state.speedMps = 0;
      this.routeProgress = 1;
      this.instruction = `${lesson.title} complete — review your score and incident timeline.`;
      this.emit("complete", this.instruction);
      this.callbacks.onComplete?.(Math.round(this.score));
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

  private advanceAuthoredCheckpoints(
    lesson: GameCanvasLesson,
    state: PlayerState,
  ) {
    while (this.checkpointIndex < this.authoredCheckpoints.length) {
      const next = this.authoredCheckpoints[this.checkpointIndex];
      if (Math.hypot(state.x - next.x, state.z - next.z) > 6) break;
      this.checkpoint = { x: next.x, z: next.z, heading: next.heading };
      this.checkpointLabel = next.label;
      this.checkpointIndex += 1;
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
        this.activeTrafficSide =
          transition.toCountryId === "fr" || transition.toCountryId === "us"
            ? "right"
            : "left";
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

  private updateTraffic(dt: number) {
    this.trafficLightSeconds = (this.trafficLightSeconds + dt) % 14;
    this.trafficLightIsRed = this.trafficLightSeconds > 8;
    if (this.signalRedMaterial && this.signalGreenMaterial) {
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
    }
    for (const npc of this.npcVehicles) {
      if (npc.path && npc.path.length >= 2) {
        let segmentIndex = npc.pathSegment ?? 0;
        let distance = (npc.pathDistance ?? 0) + npc.speed * dt;
        let start = npc.path[segmentIndex];
        let end = npc.path[segmentIndex + 1];
        let segmentLength = Math.max(0.01, Math.hypot(end.x - start.x, end.z - start.z));
        while (distance > segmentLength) {
          distance -= segmentLength;
          segmentIndex += 1;
          if (segmentIndex >= npc.path.length - 1) segmentIndex = 0;
          start = npc.path[segmentIndex];
          end = npc.path[segmentIndex + 1];
          segmentLength = Math.max(0.01, Math.hypot(end.x - start.x, end.z - start.z));
        }
        const amount = distance / segmentLength;
        npc.laneX = start.x + (end.x - start.x) * amount;
        npc.z = start.z + (end.z - start.z) * amount;
        npc.pathSegment = segmentIndex;
        npc.pathDistance = distance;
        npc.node.position.x = npc.laneX;
        npc.node.position.z = npc.z;
        npc.node.rotation.y = Math.atan2(end.x - start.x, end.z - start.z);
        continue;
      }
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
  }

  private updateCamera(dt: number) {
    const routeHeading =
      this.playerState.speedMps < 0.2
        ? this.projectToAuthoredRoute(this.displayedX, this.displayedZ)
        : null;
    const cameraHeading =
      routeHeading && routeHeading.distance < 5
        ? routeHeading.heading
        : this.displayedHeading;
    const forward = new Vector3(
      Math.sin(cameraHeading),
      0,
      Math.cos(cameraHeading),
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
            Math.min(0.045, this.playerState.speedMps * 0.0035)
          : 0;
      const headingCorrection = this.angleDifference(
        cameraHeading,
        this.displayedHeading,
      );
      this.firstCamera.position.set(seatSide, 1.58 + headBob, 0.12);
      this.firstCamera.rotation.set(
        0,
        headingCorrection + quickLookAngle,
        0,
      );
      this.rearCamera.position.set(0, 1.76, -0.08);
      this.rearCamera.rotation.set(0, headingCorrection + Math.PI, 0);
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
    const routeMaterial = makeMaterial(
      scene,
      "scenario-route",
      new Color3(0.86, 0.66, 0.19),
      new Color3(0.08, 0.045, 0.005),
    );
    const laneMaterial = makeMaterial(scene, "scenario-marking", new Color3(0.88, 0.88, 0.79));
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

    const routeLaneIds = new Set(this.options.lesson?.route ?? []);
    for (const lane of mapPack.laneGraph.lanes) {
      for (let index = 0; index < lane.centerline.length - 1; index += 1) {
        const start = lane.centerline[index];
        const end = lane.centerline[index + 1];
        this.createFlatSegment(
          `road-${lane.id}-${index}`,
          start,
          end,
          mapPack.geometry.roadWidth,
          0.07,
          asphalt,
        );
        this.createFlatSegment(
          `lane-mark-${lane.id}-${index}`,
          start,
          end,
          routeLaneIds.has(lane.id) ? 0.2 : 0.1,
          0.115,
          routeLaneIds.has(lane.id) ? routeMaterial : laneMaterial,
        );
      }
      if (lane.centerline.length >= 2) {
        const start = lane.centerline[0];
        const end = lane.centerline[1];
        const arrow = createBox(
          scene,
          `direction-${lane.id}`,
          { width: 0.55, height: 0.035, depth: 2.1 },
          new Vector3(start.x, 0.135, start.z),
          routeLaneIds.has(lane.id) ? routeMaterial : laneMaterial,
        );
        arrow.rotation.y = Math.atan2(end.x - start.x, end.z - start.z);
      }
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
    const greenLamp = makeMaterial(scene, "scenario-signal-green", new Color3(0.02, 0.4, 0.12));
    this.signalRedMaterial = redLamp;
    this.signalGreenMaterial = greenLamp;
    for (const control of mapPack.laneGraph.controls) {
      const heading = degreesToRadians(control.headingDeg);
      if (control.type === "crosswalk") {
        for (let stripe = -3; stripe <= 3; stripe += 1) {
          const acrossX = Math.cos(heading) * stripe * 1.1;
          const acrossZ = -Math.sin(heading) * stripe * 1.1;
          const marking = createBox(
            scene,
            `${control.id}-stripe-${stripe}`,
            { width: 0.65, height: 0.035, depth: mapPack.geometry.roadWidth * 0.72 },
            new Vector3(control.position.x + acrossX, 0.14, control.position.z + acrossZ),
            laneMaterial,
          );
          marking.rotation.y = heading;
        }
        continue;
      }
      const pole = createCylinder(
        scene,
        `${control.id}-pole`,
        { height: 3.3, diameter: 0.17 },
        new Vector3(control.position.x, 1.65, control.position.z),
        dark,
      );
      pole.rotation.y = heading;
      if (control.type === "signal" || control.type === "railway_signal") {
        const signalBox = createBox(
          scene,
          `${control.id}-box`,
          { width: 0.65, height: 1.5, depth: 0.48 },
          new Vector3(0, 1.25, 0),
          dark,
          pole,
        );
        createCylinder(scene, `${control.id}-red`, { height: 0.1, diameter: 0.28 }, new Vector3(0, 0.36, -0.28), redLamp, signalBox).rotation.x = Math.PI / 2;
        createCylinder(scene, `${control.id}-green`, { height: 0.1, diameter: 0.28 }, new Vector3(0, -0.36, -0.28), greenLamp, signalBox).rotation.x = Math.PI / 2;
      } else {
        const sign = createCylinder(
          scene,
          `${control.id}-sign`,
          { height: 0.13, diameter: 0.92, tessellation: control.type === "yield" ? 3 : 8 },
          new Vector3(0, 1.2, 0),
          control.type === "yield" ? yieldGold : stopRed,
          pole,
        );
        sign.rotation.x = Math.PI / 2;
      }
    }

    for (const checkpoint of this.authoredCheckpoints) {
      const marker = MeshBuilder.CreateTorus(
        `checkpoint-${checkpoint.id}`,
        { diameter: 4.5, thickness: 0.16, tessellation: 18 },
        scene,
      );
      marker.position.set(checkpoint.x, 0.22, checkpoint.z);
      setMeshMaterial(marker, checkpointMaterial);
    }
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
  ) {
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.01) return;
    const segment = createBox(
      this.scene,
      name,
      { width, height: Math.max(0.025, y * 0.45), depth: length + 0.25 },
      new Vector3((start.x + end.x) / 2, y, (start.z + end.z) / 2),
      material,
    );
    segment.rotation.y = Math.atan2(dx, dz);
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
    this.signalRedMaterial = redLamp;
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
    const dash = makeMaterial(scene, "dashboard", new Color3(0.06, 0.075, 0.08));
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

    createBox(scene, "cockpit-hood", { width: 1.78, height: 0.18, depth: 1.3 }, new Vector3(0, 0.84, 1.42), body, this.playerCockpit);
    createBox(scene, "cockpit-dash", { width: 1.8, height: 0.42, depth: 0.52 }, new Vector3(0, 0.98, 0.56), dash, this.playerCockpit);
    const wheelX = this.options.steeringSide === "left" ? -0.48 : 0.48;
    const steeringWheel = MeshBuilder.CreateTorus(
      "steering-wheel",
      { diameter: 0.48, thickness: 0.07, tessellation: 14 },
      scene,
    );
    steeringWheel.position.set(wheelX, 1.11, 0.31);
    steeringWheel.rotation.x = Math.PI / 2.5;
    steeringWheel.parent = this.playerCockpit;
    setMeshMaterial(steeringWheel, rubber);
    createBox(scene, "wheel-spoke", { width: 0.38, height: 0.055, depth: 0.055 }, new Vector3(wheelX, 1.11, 0.31), rubber, this.playerCockpit);
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
    const count = densityCounts[lesson.trafficDensity];
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
      const lane =
        (spawn?.laneId && usableLanes.find((candidate) => candidate.id === spawn.laneId)) ||
        usableLanes[(index * 3 + Math.floor(random() * usableLanes.length)) % usableLanes.length];
      const path = lane.centerline;
      const segment = Math.min(
        path.length - 2,
        Math.floor(random() * Math.max(1, path.length - 1)),
      );
      const start = path[segment];
      const end = path[segment + 1];
      const segmentLength = Math.max(0.01, Math.hypot(end.x - start.x, end.z - start.z));
      const initialDistance = spawn && index < vehicleSpawns.length
        ? clamp(
            Math.hypot(
              spawn.pose.position.x - start.x,
              spawn.pose.position.z - start.z,
            ),
            0,
            segmentLength,
          )
        : random() * segmentLength;
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
      node.position.set(x, 0.12, z);
      node.rotation.y = heading;
      this.npcVehicles.push({
        node,
        direction: 1,
        speed: Math.max(3.5, limitMps * (0.58 + random() * 0.22)),
        z,
        laneX: x,
        laneId: lane.id,
        path,
        pathSegment: segment,
        pathDistance: initialDistance,
      });
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
      const crosswalk = crosswalks[index % Math.max(1, crosswalks.length)];
      const source = authored?.pose.position ?? crosswalk?.position ?? this.routePoints[index % Math.max(1, this.routePoints.length)] ?? { x: 0, z: 0 };
      const heading = authored
        ? degreesToRadians(authored.pose.headingDeg)
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
      if (drivingKey) this.registerInputFamily("keyboard");
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
      const portraitGateManagedByReact =
        this.options.inputFamily === "touch" ||
        window.matchMedia("(pointer: coarse)").matches;
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
      this.registerInputFamily("touch");
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
      this.gamepad = { throttle: 0, brake: 0, steer: 0, quickLook: 0 };
      this.gamepadButtons = [];
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
      this.gamepad = { throttle: 0, brake: 0, steer: 0, quickLook: 0 };
      this.gamepadButtons = [];
      return;
    }
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
    if (buttonUsed || analogUsed) this.registerInputFamily("gamepad");
    if (edge(0)) this.horn();
    if (edge(1)) this.toggleCamera();
    if (edge(2)) this.setIndicator("left");
    if (edge(3)) this.setIndicator("right");
    if (edge(4)) this.toggleGear();
    if (edge(9)) this.togglePause();
    if (edge(8)) this.reset();
    this.gamepadButtons = pressed;
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
    const metersPerSecond = this.playerState.speedMps;
    const speed = this.options.speedUnit === "mph"
      ? metersPerSecond * 2.236936
      : metersPerSecond * 3.6;
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
      speedUnit: this.options.speedUnit,
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
      trafficSide: this.activeTrafficSide,
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

export const GameCanvas = forwardRef<GameCanvasHandle, GameCanvasProps>(
  function GameCanvas(
    {
      trafficSide,
      steeringSide,
      lesson,
      mapPack,
      cameraMode = "third",
      inputFamily = "keyboard",
      speedUnit = "mph",
      paused = false,
      reducedMotion = false,
      steeringSensitivity = 1,
      fieldOfView = 0.9,
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
      onInputFamilyChange,
      onComplete,
    },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const sessionRef = useRef<BabylonGameSession | null>(null);
    const callbackRef = useRef<SessionCallbacks>({});
    const viewportReadyRef = useRef(false);
    const touchPortraitGateRef = useRef(false);
    const activeInputFamilyRef = useRef<InputFamily>(inputFamily);
    const [runtimeState, setRuntimeState] = useState<
      "loading" | "ready" | "unsupported" | "context-lost" | "error"
    >("loading");
    const [isCoarsePointer, setIsCoarsePointer] = useState(false);
    const [isPortrait, setIsPortrait] = useState(false);
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

    activeInputFamilyRef.current = inputFamily;
    callbackRef.current = {
      onHudUpdate: (snapshot) => {
        setHud(snapshot);
        onHudUpdate?.(snapshot);
      },
      onEvent,
      onPauseChange,
      onCameraChange,
      onInputFamilyChange: (family) => {
        if (activeInputFamilyRef.current === family) return;
        activeInputFamilyRef.current = family;
        onInputFamilyChange?.(family);
      },
      onComplete,
      onReady: () => setRuntimeState("ready"),
      onContextLost: () => setRuntimeState("context-lost"),
      onContextRestored: () => setRuntimeState("ready"),
    };

    useEffect(() => {
      const updateViewportFlags = () => {
        const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
        const portrait = window.matchMedia("(orientation: portrait)").matches;
        const portraitGate = portrait && (inputFamily === "touch" || coarsePointer);
        const wasReady = viewportReadyRef.current;
        const wasPortraitGate = touchPortraitGateRef.current;
        viewportReadyRef.current = true;
        touchPortraitGateRef.current = portraitGate;
        setIsCoarsePointer(coarsePointer);
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
    }, [inputFamily, paused]);

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
            inputFamily,
            speedUnit,
            paused: paused || touchPortraitGateRef.current,
            reducedMotion,
            steeringSensitivity: clamp(steeringSensitivity, 0.45, 1.8),
            fieldOfView: clamp(fieldOfView, 0.65, 1.2),
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
            onInputFamilyChange: (value) =>
              callbackRef.current.onInputFamilyChange?.(value),
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
        inputFamily,
        speedUnit,
        paused: paused || touchPortraitGateRef.current,
        reducedMotion,
        steeringSensitivity: clamp(steeringSensitivity, 0.45, 1.8),
        fieldOfView: clamp(fieldOfView, 0.65, 1.2),
        masterVolume: clamp(masterVolume, 0, 1),
        effectsVolume: clamp(effectsVolume, 0, 1),
        coachVolume: clamp(coachVolume, 0, 1),
        cameraShake,
        headBob,
      });
    }, [cameraMode, inputFamily, speedUnit, paused, reducedMotion, steeringSensitivity, fieldOfView, masterVolume, effectsVolume, coachVolume, cameraShake, headBob]);

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
        sessionRef.current?.registerInputFamily("touch");
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

    const touchVisible = inputFamily === "touch" || isCoarsePointer;
    const touchPortraitGate = touchVisible && isPortrait;
    const criticalOverlay = runtimeState !== "ready";

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
                  top: "2.3%",
                  left: "50%",
                  width: "30%",
                  height: "17%",
                  transform: "translateX(-50%)",
                  border: "3px solid rgba(18,24,25,.9)",
                  borderRadius: 10,
                  boxShadow: "0 3px 14px rgba(0,0,0,.35)",
                  pointerEvents: "none",
                }}
              >
                <span style={{ position: "absolute", bottom: 4, left: 8, font: "700 9px system-ui", letterSpacing: ".12em", opacity: 0.72 }}>
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
            aria-label="Touch driving controls"
            onPointerDownCapture={(event) => registerTouchPointer(event.pointerType)}
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
              <button type="button" style={{ ...actionButtonStyle, width: "auto", paddingInline: 20 }} onClick={() => sessionRef.current?.setPaused(false)}>
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
