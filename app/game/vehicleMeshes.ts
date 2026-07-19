import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexData,
} from "@babylonjs/core";
import type { Material } from "@babylonjs/core";
import type {
  PlateRegion,
  VehicleAppearance,
  VehicleDimensions,
  VehicleModel,
} from "./vehicleVisuals";
import {
  instantiateModel,
  isModelReady,
  VEHICLE_MODEL_REGISTRY,
  type VehicleModelConfig,
} from "./modelLibrary";

/** Signals are expressed in vehicle space: -X is left and +X is right. */
export type VehicleMeshSignal = "left" | "right" | "off";

export interface VehicleMeshVisual {
  readonly root: TransformNode;
  /** Deliberately coarse: decorative meshes do not need a shadow-map pass. */
  readonly shadowCasters: readonly Mesh[];
  readonly leftIndicators: readonly Mesh[];
  readonly rightIndicators: readonly Mesh[];
  readonly brakeLights: readonly Mesh[];
  setSignal(signal: VehicleMeshSignal, blinkOn: boolean): void;
  setBraking(active: boolean): void;
  /** Hides small trim outside useful gameplay range without changing silhouette. */
  setDetailVisible(visible: boolean): void;
  /** Disposes only this visual's nodes and meshes; scene-cached materials survive. */
  dispose(): void;
}

interface VehicleMaterialCache {
  readonly paint: Map<string, StandardMaterial>;
  readonly glass: StandardMaterial;
  readonly tire: StandardMaterial;
  readonly alloy: StandardMaterial;
  readonly darkTrim: StandardMaterial;
  readonly grille: StandardMaterial;
  readonly headlamp: StandardMaterial;
  readonly tailLamp: StandardMaterial;
  readonly indicator: StandardMaterial;
  readonly brakeLamp: StandardMaterial;
  readonly plate: StandardMaterial;
}

interface LoftStation {
  readonly z: number;
  readonly halfWidth: number;
  readonly bottomY: number;
  readonly topY: number;
  /** Fraction of the ring's smaller dimension used for its four chamfers. */
  readonly chamfer?: number;
}

interface CuboidPart {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

interface WheelLayout {
  readonly trackWidth: number;
  readonly wheelbase: number;
  readonly diameter: number;
  readonly groundY: number;
  readonly tireDepth: number;
}

interface BuiltVehicleParts {
  readonly shadowCasters: Mesh[];
  readonly leftIndicators: Mesh[];
  readonly rightIndicators: Mesh[];
  readonly brakeLights: Mesh[];
}

const MATERIALS_BY_SCENE = new WeakMap<Scene, VehicleMaterialCache>();
const WHEEL_TESSELLATION = 16;
// GameCanvas currently positions a moving vehicle parent at Y=.12 while the
// road top is approximately Y=.07. A local tire bottom of -.05 therefore sits
// on the road without changing any simulation coordinates.
const LOCAL_GROUND_Y = -0.05;

function parseColor(hex: string, fallback: string): Color3 {
  return Color3.FromHexString(/^#[\da-f]{6}$/i.test(hex) ? hex : fallback);
}

function frozenMaterial(
  scene: Scene,
  name: string,
  diffuse: Color3,
  options: {
    readonly specular?: Color3;
    readonly specularPower?: number;
    readonly emissive?: Color3;
  } = {},
): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = diffuse;
  material.ambientColor = diffuse.scale(0.09);
  material.specularColor = options.specular ?? Color3.Black();
  material.specularPower = options.specularPower ?? 32;
  material.emissiveColor = options.emissive ?? Color3.Black();
  material.alpha = 1;
  material.freeze();
  return material;
}

function materialsForScene(scene: Scene): VehicleMaterialCache {
  const existing = MATERIALS_BY_SCENE.get(scene);
  if (existing) return existing;

  const cache: VehicleMaterialCache = {
    paint: new Map<string, StandardMaterial>(),
    glass: frozenMaterial(
      scene,
      "vehicle-glass",
      new Color3(0.025, 0.055, 0.072),
      {
        specular: new Color3(0.58, 0.72, 0.82),
        specularPower: 128,
        emissive: new Color3(0.004, 0.009, 0.012),
      },
    ),
    tire: frozenMaterial(
      scene,
      "vehicle-tire",
      new Color3(0.018, 0.021, 0.024),
      { specular: new Color3(0.045, 0.05, 0.055), specularPower: 20 },
    ),
    alloy: frozenMaterial(
      scene,
      "vehicle-alloy",
      new Color3(0.36, 0.4, 0.43),
      { specular: new Color3(0.72, 0.76, 0.8), specularPower: 96 },
    ),
    darkTrim: frozenMaterial(
      scene,
      "vehicle-dark-trim",
      new Color3(0.028, 0.037, 0.043),
      { specular: new Color3(0.16, 0.19, 0.21), specularPower: 48 },
    ),
    grille: frozenMaterial(
      scene,
      "vehicle-grille",
      new Color3(0.012, 0.017, 0.02),
      { specular: new Color3(0.08, 0.09, 0.1), specularPower: 40 },
    ),
    headlamp: frozenMaterial(
      scene,
      "vehicle-led-headlamp",
      new Color3(0.68, 0.78, 0.84),
      {
        specular: Color3.White(),
        specularPower: 128,
        emissive: new Color3(0.44, 0.58, 0.68),
      },
    ),
    tailLamp: frozenMaterial(
      scene,
      "vehicle-tail-lamp",
      new Color3(0.36, 0.012, 0.018),
      {
        specular: new Color3(0.42, 0.08, 0.09),
        specularPower: 72,
        emissive: new Color3(0.14, 0.006, 0.009),
      },
    ),
    indicator: frozenMaterial(
      scene,
      "vehicle-indicator-lit",
      new Color3(1, 0.28, 0.015),
      {
        specular: new Color3(1, 0.55, 0.12),
        specularPower: 96,
        emissive: new Color3(0.95, 0.23, 0.008),
      },
    ),
    brakeLamp: frozenMaterial(
      scene,
      "vehicle-brake-lit",
      new Color3(0.92, 0.015, 0.02),
      {
        specular: new Color3(0.95, 0.12, 0.12),
        specularPower: 96,
        emissive: new Color3(0.9, 0.012, 0.014),
      },
    ),
    plate: frozenMaterial(
      scene,
      "vehicle-number-plate",
      new Color3(0.78, 0.81, 0.8),
      { specular: new Color3(0.2, 0.22, 0.22), specularPower: 48 },
    ),
  };
  MATERIALS_BY_SCENE.set(scene, cache);
  return cache;
}

function paintMaterial(
  scene: Scene,
  cache: VehicleMaterialCache,
  hex: string,
): StandardMaterial {
  const key = (/^#[\da-f]{6}$/i.test(hex) ? hex : "#76838b").toLowerCase();
  const existing = cache.paint.get(key);
  if (existing) return existing;
  const color = parseColor(key, "#76838b");
  const material = frozenMaterial(
    scene,
    `vehicle-paint-${key.slice(1)}`,
    color,
    {
      specular: new Color3(0.58, 0.62, 0.66),
      specularPower: 104,
      emissive: color.scale(0.006),
    },
  );
  cache.paint.set(key, material);
  return material;
}

function finishMesh(mesh: Mesh, material: StandardMaterial, parent: TransformNode): Mesh {
  mesh.material = material;
  mesh.parent = parent;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  return mesh;
}

/**
 * Creates a closed, chamfered loft from rear-to-front cross sections. Unlike
 * the previous box stack, longitudinal taper and roof/hood rake are intrinsic
 * to the body geometry.
 */
function createLoftMesh(
  scene: Scene,
  name: string,
  stations: readonly LoftStation[],
  material: StandardMaterial,
  parent: TransformNode,
): Mesh {
  if (stations.length < 2) {
    throw new Error(`Vehicle loft ${name} needs at least two stations.`);
  }
  const positions: number[] = [];
  const indices: number[] = [];
  const ringSize = 8;

  for (const station of stations) {
    const height = Math.max(0.025, station.topY - station.bottomY);
    const amount = Math.min(
      station.halfWidth * 0.32,
      height * 0.34,
      Math.max(0.018, Math.min(station.halfWidth, height) * (station.chamfer ?? 0.14)),
    );
    const left = -station.halfWidth;
    const right = station.halfWidth;
    const bottom = station.bottomY;
    const top = station.topY;
    positions.push(
      left + amount, bottom, station.z,
      right - amount, bottom, station.z,
      right, bottom + amount, station.z,
      right, top - amount, station.z,
      right - amount, top, station.z,
      left + amount, top, station.z,
      left, top - amount, station.z,
      left, bottom + amount, station.z,
    );
  }

  for (let stationIndex = 0; stationIndex < stations.length - 1; stationIndex += 1) {
    const rear = stationIndex * ringSize;
    const front = rear + ringSize;
    for (let edge = 0; edge < ringSize; edge += 1) {
      const next = (edge + 1) % ringSize;
      const rearStart = rear + edge;
      const rearEnd = rear + next;
      const frontEnd = front + next;
      const frontStart = front + edge;
      indices.push(
        rearStart, rearEnd, frontEnd,
        rearStart, frontEnd, frontStart,
      );
    }
  }

  const rearRing = 0;
  const frontRing = (stations.length - 1) * ringSize;
  for (let index = 1; index < ringSize - 1; index += 1) {
    indices.push(rearRing, rearRing + index + 1, rearRing + index);
    indices.push(frontRing, frontRing + index, frontRing + index + 1);
  }

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  const mesh = new Mesh(name, scene);
  vertexData.applyToMesh(mesh);
  return finishMesh(mesh, material, parent);
}

function appendCuboid(
  positions: number[],
  indices: number[],
  part: CuboidPart,
): void {
  const x0 = part.x - part.width / 2;
  const x1 = part.x + part.width / 2;
  const y0 = part.y - part.height / 2;
  const y1 = part.y + part.height / 2;
  const z0 = part.z - part.depth / 2;
  const z1 = part.z + part.depth / 2;
  const faces = [
    // +Z, -Z, +X, -X, +Y, -Y. Each face owns its vertices for crisp normals.
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
    [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
    [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
  ] as const;
  for (const face of faces) {
    const base = positions.length / 3;
    for (const vertex of face) positions.push(vertex[0], vertex[1], vertex[2]);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function createCuboidGroup(
  scene: Scene,
  name: string,
  parts: readonly CuboidPart[],
  material: StandardMaterial,
  parent: TransformNode,
): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const part of parts) appendCuboid(positions, indices, part);
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  const mesh = new Mesh(name, scene);
  vertexData.applyToMesh(mesh);
  return finishMesh(mesh, material, parent);
}

function appendCylinderAlongX(
  positions: number[],
  indices: number[],
  center: Readonly<{ x: number; y: number; z: number }>,
  depth: number,
  diameter: number,
  tessellation: number,
): void {
  const radius = diameter / 2;
  const x0 = center.x - depth / 2;
  const x1 = center.x + depth / 2;
  const sideBase = positions.length / 3;
  for (const x of [x0, x1]) {
    for (let segment = 0; segment < tessellation; segment += 1) {
      const angle = (segment / tessellation) * Math.PI * 2;
      positions.push(
        x,
        center.y + Math.cos(angle) * radius,
        center.z + Math.sin(angle) * radius,
      );
    }
  }
  for (let segment = 0; segment < tessellation; segment += 1) {
    const next = (segment + 1) % tessellation;
    const left = sideBase + segment;
    const leftNext = sideBase + next;
    const right = sideBase + tessellation + segment;
    const rightNext = sideBase + tessellation + next;
    indices.push(left, rightNext, right, left, leftNext, rightNext);
  }

  const leftCenter = positions.length / 3;
  positions.push(x0, center.y, center.z);
  const leftRing = positions.length / 3;
  for (let segment = 0; segment < tessellation; segment += 1) {
    const angle = (segment / tessellation) * Math.PI * 2;
    positions.push(x0, center.y + Math.cos(angle) * radius, center.z + Math.sin(angle) * radius);
  }
  const rightCenter = positions.length / 3;
  positions.push(x1, center.y, center.z);
  const rightRing = positions.length / 3;
  for (let segment = 0; segment < tessellation; segment += 1) {
    const angle = (segment / tessellation) * Math.PI * 2;
    positions.push(x1, center.y + Math.cos(angle) * radius, center.z + Math.sin(angle) * radius);
  }
  for (let segment = 0; segment < tessellation; segment += 1) {
    const next = (segment + 1) % tessellation;
    indices.push(leftCenter, leftRing + next, leftRing + segment);
    indices.push(rightCenter, rightRing + segment, rightRing + next);
  }
}

function createCylinderGroup(
  scene: Scene,
  name: string,
  cylinders: readonly Readonly<{
    x: number;
    y: number;
    z: number;
    depth: number;
    diameter: number;
  }>[],
  material: StandardMaterial,
  parent: TransformNode,
): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const cylinder of cylinders) {
    appendCylinderAlongX(
      positions,
      indices,
      cylinder,
      cylinder.depth,
      cylinder.diameter,
      WHEEL_TESSELLATION,
    );
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  const mesh = new Mesh(name, scene);
  vertexData.applyToMesh(mesh);
  return finishMesh(mesh, material, parent);
}

function createWheelMeshes(
  scene: Scene,
  name: string,
  layout: WheelLayout,
  cache: VehicleMaterialCache,
  parent: TransformNode,
): { readonly tires: Mesh; readonly rims: Mesh } {
  const radius = layout.diameter / 2;
  const centerY = layout.groundY + radius;
  const wheelX = layout.trackWidth / 2;
  const axleZ = layout.wheelbase / 2;
  const tires = [-1, 1].flatMap((side) =>
    [-axleZ, axleZ].map((z) => ({
      x: side * wheelX,
      y: centerY,
      z,
      depth: layout.tireDepth,
      diameter: layout.diameter,
    })),
  );
  const rims = [-1, 1].flatMap((side) =>
    [-axleZ, axleZ].map((z) => ({
      x: side * (wheelX + layout.tireDepth * 0.53),
      y: centerY,
      z,
      depth: 0.035,
      diameter: layout.diameter * 0.56,
    })),
  );
  return {
    tires: createCylinderGroup(scene, `${name}-tires`, tires, cache.tire, parent),
    rims: createCylinderGroup(scene, `${name}-alloy-rims`, rims, cache.alloy, parent),
  };
}

function passengerBodyStations(
  model: VehicleModel,
  dimensions: VehicleDimensions,
  beltY: number,
): readonly LoftStation[] {
  const halfLength = dimensions.length / 2;
  const halfWidth = dimensions.width / 2;
  const shape = model === "compact-hatch"
    ? {
        rearTipWidth: 0.86, rearTipTop: 0.88,
        rearShoulderOffset: 0.12, rearShoulderWidth: 0.99, rearShoulderTop: 1.02,
        rearAxleTop: 1.02, frontAxleTop: 0.98,
        frontShoulderOffset: 0.2, frontShoulderWidth: 0.94, frontShoulderTop: 0.82,
        frontTipWidth: 0.72, frontTipTop: 0.62,
      }
    : model === "sport-sedan"
      ? {
          rearTipWidth: 0.76, rearTipTop: 0.63,
          rearShoulderOffset: 0.34, rearShoulderWidth: 0.95, rearShoulderTop: 0.78,
          rearAxleTop: 0.98, frontAxleTop: 0.96,
          frontShoulderOffset: 0.38, frontShoulderWidth: 0.94, frontShoulderTop: 0.78,
          frontTipWidth: 0.68, frontTipTop: 0.58,
        }
      : model === "urban-crossover"
        ? {
            rearTipWidth: 0.84, rearTipTop: 0.82,
            rearShoulderOffset: 0.16, rearShoulderWidth: 1, rearShoulderTop: 1.03,
            rearAxleTop: 1.04, frontAxleTop: 1.03,
            frontShoulderOffset: 0.18, frontShoulderWidth: 0.97, frontShoulderTop: 0.92,
            frontTipWidth: 0.78, frontTipTop: 0.75,
          }
        : model === "sport-wagon"
          ? {
              rearTipWidth: 0.86, rearTipTop: 0.86,
              rearShoulderOffset: 0.14, rearShoulderWidth: 1, rearShoulderTop: 1.02,
              rearAxleTop: 1.02, frontAxleTop: 0.98,
              frontShoulderOffset: 0.26, frontShoulderWidth: 0.95, frontShoulderTop: 0.84,
              frontTipWidth: 0.7, frontTipTop: 0.62,
            }
          : model === "electric-taxi"
            ? {
                rearTipWidth: 0.8, rearTipTop: 0.78,
                rearShoulderOffset: 0.2, rearShoulderWidth: 0.99, rearShoulderTop: 0.99,
                rearAxleTop: 1.02, frontAxleTop: 1.01,
                frontShoulderOffset: 0.22, frontShoulderWidth: 0.96, frontShoulderTop: 0.9,
                frontTipWidth: 0.74, frontTipTop: 0.7,
              }
            : {
                rearTipWidth: 0.72, rearTipTop: 0.7,
                rearShoulderOffset: 0.24, rearShoulderWidth: 0.98, rearShoulderTop: 0.93,
                rearAxleTop: 1, frontAxleTop: 0.98,
                frontShoulderOffset: 0.25, frontShoulderWidth: 0.95, frontShoulderTop: 0.84,
                frontTipWidth: 0.7, frontTipTop: 0.61,
              };
  const bottom = dimensions.rideHeight;
  return [
    {
      z: -halfLength,
      halfWidth: halfWidth * shape.rearTipWidth,
      bottomY: bottom + 0.035,
      topY: beltY * shape.rearTipTop,
    },
    {
      z: -halfLength + shape.rearShoulderOffset,
      halfWidth: halfWidth * shape.rearShoulderWidth,
      bottomY: bottom,
      topY: beltY * shape.rearShoulderTop,
    },
    {
      z: -dimensions.wheelbase / 2 - 0.24,
      halfWidth,
      bottomY: bottom,
      topY: beltY * shape.rearAxleTop,
    },
    {
      z: dimensions.wheelbase / 2 + 0.24,
      halfWidth,
      bottomY: bottom,
      topY: beltY * shape.frontAxleTop,
    },
    {
      z: halfLength - shape.frontShoulderOffset,
      halfWidth: halfWidth * shape.frontShoulderWidth,
      bottomY: bottom,
      topY: beltY * shape.frontShoulderTop,
    },
    {
      z: halfLength,
      halfWidth: halfWidth * shape.frontTipWidth,
      bottomY: bottom + 0.045,
      topY: beltY * shape.frontTipTop,
    },
  ];
}

function passengerCanopyStations(
  model: VehicleModel,
  dimensions: VehicleDimensions,
  beltY: number,
): readonly LoftStation[] {
  const rear = dimensions.cabinRearZ;
  const front = dimensions.cabinFrontZ;
  const span = front - rear;
  const base = beltY - 0.015;
  const roof = dimensions.height - 0.025;
  const rearRise = model === "electric-fastback" ? 0.48
    : model === "compact-hatch" ? 0.12
      : model === "sport-wagon" ? 0.14
        : model === "urban-crossover" || model === "electric-taxi" ? 0.18
          : 0.27;
  const frontDrop = model === "electric-fastback" ? 0.38
    : model === "compact-hatch" ? 0.24
      : model === "sport-wagon" ? 0.28
        : model === "urban-crossover" || model === "electric-taxi" ? 0.2
          : 0.32;
  const roofWidth = dimensions.width * (
    model === "urban-crossover" || model === "electric-taxi" ? 0.43
      : model === "sport-wagon" ? 0.41
        : model === "compact-hatch" ? 0.39
          : 0.4
  );
  const rearRoofHeight = model === "electric-fastback" ? roof * 0.82
    : model === "sport-sedan" ? roof * 0.92
      : model === "compact-hatch" || model === "sport-wagon" ? roof * 0.99
        : roof * 0.97;
  return [
    { z: rear - 0.055, halfWidth: roofWidth * 0.84, bottomY: base, topY: base + 0.035 },
    { z: rear + rearRise, halfWidth: roofWidth * 0.98, bottomY: base, topY: rearRoofHeight },
    { z: rear + span * 0.42, halfWidth: roofWidth, bottomY: base, topY: roof },
    { z: rear + span * 0.68, halfWidth: roofWidth * 0.985, bottomY: base, topY: roof * 0.985 },
    { z: front - frontDrop, halfWidth: roofWidth * 0.94, bottomY: base, topY: roof * 0.9 },
    { z: front + 0.045, halfWidth: roofWidth * 0.82, bottomY: base, topY: base + 0.035 },
  ];
}

function passengerModelDetails(
  model: VehicleModel,
  dimensions: VehicleDimensions,
  beltY: number,
): readonly CuboidPart[] {
  const halfLength = dimensions.length / 2;
  const roofSpan = dimensions.cabinFrontZ - dimensions.cabinRearZ;
  if (model === "compact-hatch") {
    return [{
      x: 0,
      y: dimensions.height + 0.015,
      z: dimensions.cabinRearZ - 0.07,
      width: dimensions.width * 0.72,
      height: 0.055,
      depth: 0.24,
    }];
  }
  if (model === "sport-sedan") {
    return [
      { x: 0, y: beltY + 0.06, z: -halfLength + 0.11, width: dimensions.width * 0.66, height: 0.045, depth: 0.2 },
      { x: 0, y: dimensions.rideHeight + 0.015, z: halfLength - 0.08, width: dimensions.width * 0.72, height: 0.045, depth: 0.2 },
    ];
  }
  if (model === "urban-crossover" || model === "sport-wagon") {
    return [-1, 1].map((side) => ({
      x: side * dimensions.width * 0.28,
      y: dimensions.height + 0.035,
      z: (dimensions.cabinFrontZ + dimensions.cabinRearZ) / 2,
      width: 0.045,
      height: 0.055,
      depth: roofSpan * 0.82,
    }));
  }
  if (model === "electric-taxi") {
    return [{
      x: 0,
      y: dimensions.height + 0.09,
      z: -0.08,
      width: 0.54,
      height: 0.18,
      depth: 0.34,
    }];
  }
  return [{
    x: 0,
    y: beltY + 0.055,
    z: -halfLength + 0.12,
    width: dimensions.width * 0.64,
    height: 0.045,
    depth: 0.2,
  }];
}

function buildPassengerVehicle(
  scene: Scene,
  root: TransformNode,
  name: string,
  appearance: VehicleAppearance,
  cache: VehicleMaterialCache,
  paint: StandardMaterial,
  accent: StandardMaterial,
): BuiltVehicleParts {
  const d = appearance.dimensions;
  const halfLength = d.length / 2;
  const halfWidth = d.width / 2;
  const wheelRadius = d.wheelDiameter / 2;
  const beltY = Math.min(
    d.height * (appearance.model === "urban-crossover" || appearance.model === "electric-taxi" ? 0.57 : 0.55),
    Math.max(d.rideHeight + 0.48, LOCAL_GROUND_Y + wheelRadius * 1.92),
  );
  const body = createLoftMesh(
    scene,
    `${name}-body-shell`,
    passengerBodyStations(appearance.model, d, beltY),
    paint,
    root,
  );
  const canopy = createLoftMesh(
    scene,
    `${name}-glass-canopy`,
    passengerCanopyStations(appearance.model, d, beltY),
    cache.glass,
    root,
  );
  const cabinMidZ = (d.cabinFrontZ + d.cabinRearZ) / 2;
  const cabinSpan = d.cabinFrontZ - d.cabinRearZ;
  createCuboidGroup(
    scene,
    `${name}-painted-roof-panel`,
    [{
      x: 0,
      y: d.height + 0.004,
      z: cabinMidZ + cabinSpan * 0.04,
      width: d.width * 0.62,
      height: 0.038,
      depth: cabinSpan * (appearance.model === "electric-fastback" ? 0.3 : 0.38),
    }],
    paint,
    root,
  );
  createCuboidGroup(
    scene,
    `${name}-window-pillars`,
    [-1, 1].map((side) => ({
      x: side * d.width * 0.405,
      y: beltY + (d.height - beltY) * 0.48,
      z: cabinMidZ,
      width: 0.035,
      height: (d.height - beltY) * 0.68,
      depth: 0.085,
    })),
    cache.darkTrim,
    root,
  );
  const wheels = createWheelMeshes(
    scene,
    name,
    {
      trackWidth: d.width * 0.96,
      wheelbase: d.wheelbase,
      diameter: d.wheelDiameter,
      groundY: LOCAL_GROUND_Y,
      tireDepth: Math.max(0.2, d.width * 0.13),
    },
    cache,
    root,
  );

  const electric =
    appearance.model === "electric-fastback" ||
    appearance.model === "electric-taxi";
  const lampY = Math.max(d.rideHeight + wheelRadius * 0.95, beltY * 0.7);
  const lampX = d.width * 0.26;
  createCuboidGroup(
    scene,
    `${name}-led-headlights`,
    [-1, 1].map((side) => ({
      x: side * lampX,
      y: lampY,
      z: halfLength + 0.025,
      width: d.width * 0.24,
      height: 0.075,
      depth: 0.045,
    })),
    cache.headlamp,
    root,
  );
  createCuboidGroup(
    scene,
    `${name}-tail-lights`,
    [-1, 1].map((side) => ({
      x: side * lampX,
      y: lampY,
      z: -halfLength - 0.025,
      width: d.width * 0.24,
      height: 0.08,
      depth: 0.045,
    })),
    cache.tailLamp,
    root,
  );
  if (electric) {
    createCuboidGroup(
      scene,
      `${name}-rear-light-bar`,
      [{
        x: 0,
        y: lampY + 0.015,
        z: -halfLength - 0.028,
        width: d.width * 0.74,
        height: 0.035,
        depth: 0.04,
      }],
      cache.tailLamp,
      root,
    );
  }

  const leftIndicator = createCuboidGroup(
    scene,
    `${name}-left-indicators`,
    [
      { x: -d.width * 0.42, y: lampY, z: halfLength + 0.052, width: d.width * 0.09, height: 0.045, depth: 0.024 },
      { x: -d.width * 0.42, y: lampY, z: -halfLength - 0.052, width: d.width * 0.09, height: 0.045, depth: 0.024 },
    ],
    cache.indicator,
    root,
  );
  const rightIndicator = createCuboidGroup(
    scene,
    `${name}-right-indicators`,
    [
      { x: d.width * 0.42, y: lampY, z: halfLength + 0.052, width: d.width * 0.09, height: 0.045, depth: 0.024 },
      { x: d.width * 0.42, y: lampY, z: -halfLength - 0.052, width: d.width * 0.09, height: 0.045, depth: 0.024 },
    ],
    cache.indicator,
    root,
  );
  const brakeLights = createCuboidGroup(
    scene,
    `${name}-brake-lights`,
    [-1, 1].map((side) => ({
      x: side * lampX,
      y: lampY + 0.005,
      z: -halfLength - 0.054,
      width: d.width * 0.17,
      height: 0.04,
      depth: 0.022,
    })),
    cache.brakeLamp,
    root,
  );
  leftIndicator.setEnabled(false);
  rightIndicator.setEnabled(false);
  brakeLights.setEnabled(false);

  createCuboidGroup(
    scene,
    `${name}-lower-grille`,
    [{
      x: 0,
      y: d.rideHeight + 0.13,
      z: halfLength + 0.028,
      width: d.width * (electric ? 0.42 : 0.62),
      height: electric ? 0.075 : 0.13,
      depth: 0.045,
    }],
    cache.grille,
    root,
  );
  createCuboidGroup(
    scene,
    `${name}-rear-diffuser`,
    [{ x: 0, y: d.rideHeight + 0.08, z: -halfLength - 0.026, width: d.width * 0.68, height: 0.1, depth: 0.05 }],
    cache.darkTrim,
    root,
  );
  createCuboidGroup(
    scene,
    `${name}-side-skirts`,
    [-1, 1].map((side) => ({
      x: side * (halfWidth + 0.018),
      y: d.rideHeight + 0.09,
      z: 0,
      width: 0.05,
      height: 0.12,
      depth: d.length * 0.64,
    })),
    cache.darkTrim,
    root,
  );
  createCuboidGroup(
    scene,
    `${name}-mirrors`,
    [-1, 1].map((side) => ({
      x: side * (halfWidth + 0.09),
      y: beltY + (d.height - beltY) * 0.3,
      z: d.cabinFrontZ - 0.2,
      width: 0.18,
      height: 0.1,
      depth: 0.23,
    })),
    paint,
    root,
  );
  createCuboidGroup(
    scene,
    `${name}-number-plates`,
    [
      { x: 0, y: d.rideHeight + 0.23, z: halfLength + 0.056, width: 0.46, height: 0.12, depth: 0.018 },
      { x: 0, y: d.rideHeight + 0.23, z: -halfLength - 0.056, width: 0.46, height: 0.12, depth: 0.018 },
    ],
    cache.plate,
    root,
  );
  createCuboidGroup(
    scene,
    `${name}-model-details`,
    passengerModelDetails(appearance.model, d, beltY),
    accent,
    root,
  );

  return {
    shadowCasters: [body, canopy, wheels.tires],
    leftIndicators: [leftIndicator],
    rightIndicators: [rightIndicator],
    brakeLights: [brakeLights],
  };
}

function buildDeliveryVan(
  scene: Scene,
  root: TransformNode,
  name: string,
  appearance: VehicleAppearance,
  cache: VehicleMaterialCache,
  paint: StandardMaterial,
  accent: StandardMaterial,
): BuiltVehicleParts {
  const d = appearance.dimensions;
  const halfLength = d.length / 2;
  const halfWidth = d.width / 2;
  const body = createLoftMesh(
    scene,
    `${name}-van-body-shell`,
    [
      { z: -halfLength, halfWidth: halfWidth * 0.87, bottomY: d.rideHeight + 0.04, topY: d.height * 0.91 },
      { z: -halfLength + 0.24, halfWidth: halfWidth * 0.98, bottomY: d.rideHeight, topY: d.height * 0.98 },
      { z: d.cabinRearZ, halfWidth, bottomY: d.rideHeight, topY: d.height },
      { z: d.cabinFrontZ - 0.2, halfWidth: halfWidth * 0.97, bottomY: d.rideHeight, topY: d.height * 0.92 },
      { z: halfLength - 0.18, halfWidth: halfWidth * 0.92, bottomY: d.rideHeight, topY: d.height * 0.72 },
      { z: halfLength, halfWidth: halfWidth * 0.72, bottomY: d.rideHeight + 0.05, topY: d.height * 0.59 },
    ],
    paint,
    root,
  );
  const glass = createCuboidGroup(
    scene,
    `${name}-van-glazing`,
    [
      { x: 0, y: d.height * 0.69, z: halfLength + 0.026, width: d.width * 0.72, height: d.height * 0.29, depth: 0.045 },
      { x: -halfWidth - 0.018, y: d.height * 0.68, z: 1.05, width: 0.04, height: d.height * 0.28, depth: 1.12 },
      { x: halfWidth + 0.018, y: d.height * 0.68, z: 1.05, width: 0.04, height: d.height * 0.28, depth: 1.12 },
    ],
    cache.glass,
    root,
  );
  const wheels = createWheelMeshes(
    scene,
    name,
    {
      trackWidth: d.width * 0.95,
      wheelbase: d.wheelbase,
      diameter: d.wheelDiameter,
      groundY: LOCAL_GROUND_Y,
      tireDepth: 0.27,
    },
    cache,
    root,
  );
  const lampY = d.rideHeight + d.wheelDiameter * 0.62;
  createCuboidGroup(scene, `${name}-led-headlights`, [-1, 1].map((side) => ({ x: side * d.width * 0.27, y: lampY, z: halfLength + 0.055, width: d.width * 0.2, height: 0.1, depth: 0.03 })), cache.headlamp, root);
  createCuboidGroup(scene, `${name}-tail-lights`, [-1, 1].map((side) => ({ x: side * d.width * 0.42, y: d.height * 0.48, z: -halfLength - 0.04, width: 0.1, height: d.height * 0.24, depth: 0.03 })), cache.tailLamp, root);
  const leftIndicator = createCuboidGroup(scene, `${name}-left-indicators`, [
    { x: -d.width * 0.43, y: lampY, z: halfLength + 0.075, width: 0.11, height: 0.055, depth: 0.022 },
    { x: -d.width * 0.43, y: d.height * 0.5, z: -halfLength - 0.06, width: 0.09, height: 0.12, depth: 0.022 },
  ], cache.indicator, root);
  const rightIndicator = createCuboidGroup(scene, `${name}-right-indicators`, [
    { x: d.width * 0.43, y: lampY, z: halfLength + 0.075, width: 0.11, height: 0.055, depth: 0.022 },
    { x: d.width * 0.43, y: d.height * 0.5, z: -halfLength - 0.06, width: 0.09, height: 0.12, depth: 0.022 },
  ], cache.indicator, root);
  const brakeLights = createCuboidGroup(scene, `${name}-brake-lights`, [-1, 1].map((side) => ({ x: side * d.width * 0.42, y: d.height * 0.56, z: -halfLength - 0.062, width: 0.075, height: d.height * 0.13, depth: 0.02 })), cache.brakeLamp, root);
  leftIndicator.setEnabled(false);
  rightIndicator.setEnabled(false);
  brakeLights.setEnabled(false);
  createCuboidGroup(scene, `${name}-van-lower-trim`, [
    { x: 0, y: d.rideHeight + 0.12, z: halfLength + 0.04, width: d.width * 0.62, height: 0.14, depth: 0.06 },
    { x: 0, y: d.rideHeight + 0.1, z: -halfLength - 0.035, width: d.width * 0.68, height: 0.13, depth: 0.055 },
    { x: -halfWidth - 0.018, y: d.rideHeight + 0.1, z: 0, width: 0.05, height: 0.14, depth: d.length * 0.68 },
    { x: halfWidth + 0.018, y: d.rideHeight + 0.1, z: 0, width: 0.05, height: 0.14, depth: d.length * 0.68 },
  ], cache.darkTrim, root);
  createCuboidGroup(scene, `${name}-van-accent-stripe`, [-1, 1].map((side) => ({ x: side * (halfWidth + 0.025), y: d.height * 0.46, z: -0.42, width: 0.035, height: 0.08, depth: d.length * 0.58 })), accent, root);
  createCuboidGroup(scene, `${name}-mirrors`, [-1, 1].map((side) => ({ x: side * (halfWidth + 0.12), y: d.height * 0.66, z: d.cabinFrontZ - 0.22, width: 0.2, height: 0.24, depth: 0.16 })), cache.darkTrim, root);
  createCuboidGroup(scene, `${name}-number-plates`, [
    { x: 0, y: d.rideHeight + 0.3, z: halfLength + 0.075, width: 0.5, height: 0.13, depth: 0.02 },
    { x: 0, y: d.rideHeight + 0.3, z: -halfLength - 0.07, width: 0.5, height: 0.13, depth: 0.02 },
  ], cache.plate, root);
  return {
    shadowCasters: [body, glass, wheels.tires],
    leftIndicators: [leftIndicator],
    rightIndicators: [rightIndicator],
    brakeLights: [brakeLights],
  };
}

function buildBus(
  scene: Scene,
  root: TransformNode,
  name: string,
  appearance: VehicleAppearance,
  cache: VehicleMaterialCache,
  paint: StandardMaterial,
  accent: StandardMaterial,
): BuiltVehicleParts {
  const d = appearance.dimensions;
  const halfLength = d.length / 2;
  const halfWidth = d.width / 2;
  const doubleDecker = appearance.model === "london-double-decker";
  const body = createLoftMesh(
    scene,
    `${name}-${doubleDecker ? "double-decker" : "city-bus"}-shell`,
    [
      { z: -halfLength, halfWidth: halfWidth * 0.86, bottomY: d.rideHeight + 0.05, topY: d.height * 0.92 },
      { z: -halfLength + 0.34, halfWidth: halfWidth * 0.98, bottomY: d.rideHeight, topY: d.height * 0.985 },
      { z: -d.wheelbase / 2, halfWidth, bottomY: d.rideHeight, topY: d.height },
      { z: d.wheelbase / 2, halfWidth, bottomY: d.rideHeight, topY: d.height },
      { z: halfLength - 0.36, halfWidth: halfWidth * 0.97, bottomY: d.rideHeight, topY: d.height * 0.98 },
      { z: halfLength, halfWidth: halfWidth * 0.84, bottomY: d.rideHeight + 0.05, topY: d.height * 0.9 },
    ],
    paint,
    root,
  );
  const lowerWindowY = doubleDecker ? d.height * 0.38 : d.height * 0.59;
  const windowHeight = doubleDecker ? d.height * 0.19 : d.height * 0.31;
  const glassParts: CuboidPart[] = [
    { x: -halfWidth - 0.018, y: lowerWindowY, z: 0, width: 0.04, height: windowHeight, depth: d.length * 0.82 },
    { x: halfWidth + 0.018, y: lowerWindowY, z: 0, width: 0.04, height: windowHeight, depth: d.length * 0.82 },
    { x: 0, y: lowerWindowY, z: halfLength + 0.026, width: d.width * 0.76, height: windowHeight * 0.95, depth: 0.045 },
    { x: 0, y: lowerWindowY, z: -halfLength - 0.026, width: d.width * 0.72, height: windowHeight * 0.88, depth: 0.045 },
  ];
  if (doubleDecker) {
    const upperY = d.height * 0.73;
    glassParts.push(
      { x: -halfWidth - 0.02, y: upperY, z: 0, width: 0.042, height: d.height * 0.2, depth: d.length * 0.83 },
      { x: halfWidth + 0.02, y: upperY, z: 0, width: 0.042, height: d.height * 0.2, depth: d.length * 0.83 },
      { x: 0, y: upperY, z: halfLength + 0.028, width: d.width * 0.74, height: d.height * 0.19, depth: 0.046 },
      { x: 0, y: upperY, z: -halfLength - 0.028, width: d.width * 0.7, height: d.height * 0.18, depth: 0.046 },
    );
  }
  const glass = createCuboidGroup(scene, `${name}-bus-glazing`, glassParts, cache.glass, root);
  const wheels = createWheelMeshes(
    scene,
    name,
    {
      trackWidth: d.width * 0.94,
      wheelbase: d.wheelbase,
      diameter: d.wheelDiameter,
      groundY: LOCAL_GROUND_Y,
      tireDepth: 0.31,
    },
    cache,
    root,
  );
  const lampY = d.rideHeight + d.wheelDiameter * 0.57;
  createCuboidGroup(scene, `${name}-led-headlights`, [-1, 1].map((side) => ({ x: side * d.width * 0.3, y: lampY, z: halfLength + 0.06, width: d.width * 0.2, height: 0.11, depth: 0.035 })), cache.headlamp, root);
  createCuboidGroup(scene, `${name}-tail-lights`, [-1, 1].map((side) => ({ x: side * d.width * 0.41, y: lampY + 0.18, z: -halfLength - 0.05, width: 0.1, height: 0.38, depth: 0.03 })), cache.tailLamp, root);
  const leftIndicator = createCuboidGroup(scene, `${name}-left-indicators`, [
    { x: -d.width * 0.43, y: lampY + 0.04, z: halfLength + 0.08, width: 0.11, height: 0.065, depth: 0.022 },
    { x: -d.width * 0.43, y: lampY + 0.18, z: -halfLength - 0.07, width: 0.09, height: 0.13, depth: 0.022 },
  ], cache.indicator, root);
  const rightIndicator = createCuboidGroup(scene, `${name}-right-indicators`, [
    { x: d.width * 0.43, y: lampY + 0.04, z: halfLength + 0.08, width: 0.11, height: 0.065, depth: 0.022 },
    { x: d.width * 0.43, y: lampY + 0.18, z: -halfLength - 0.07, width: 0.09, height: 0.13, depth: 0.022 },
  ], cache.indicator, root);
  const brakeLights = createCuboidGroup(scene, `${name}-brake-lights`, [-1, 1].map((side) => ({ x: side * d.width * 0.41, y: lampY + 0.3, z: -halfLength - 0.072, width: 0.075, height: 0.18, depth: 0.02 })), cache.brakeLamp, root);
  leftIndicator.setEnabled(false);
  rightIndicator.setEnabled(false);
  brakeLights.setEnabled(false);
  createCuboidGroup(scene, `${name}-bus-lower-trim`, [
    { x: 0, y: d.rideHeight + 0.12, z: halfLength + 0.05, width: d.width * 0.66, height: 0.16, depth: 0.065 },
    { x: 0, y: d.rideHeight + 0.1, z: -halfLength - 0.04, width: d.width * 0.7, height: 0.14, depth: 0.06 },
    { x: -halfWidth - 0.02, y: d.rideHeight + 0.12, z: 0, width: 0.055, height: 0.17, depth: d.length * 0.75 },
    { x: halfWidth + 0.02, y: d.rideHeight + 0.12, z: 0, width: 0.055, height: 0.17, depth: d.length * 0.75 },
  ], cache.darkTrim, root);
  createCuboidGroup(scene, `${name}-bus-accent-band`, [-1, 1].map((side) => ({ x: side * (halfWidth + 0.026), y: doubleDecker ? d.height * 0.54 : d.height * 0.37, z: 0, width: 0.035, height: 0.11, depth: d.length * 0.84 })), accent, root);
  createCuboidGroup(scene, `${name}-destination-display`, [{ x: 0, y: doubleDecker ? d.height * 0.87 : d.height * 0.79, z: halfLength + 0.058, width: d.width * 0.62, height: 0.25, depth: 0.025 }], cache.grille, root);
  createCuboidGroup(scene, `${name}-bus-mirrors`, [-1, 1].map((side) => ({ x: side * (halfWidth + 0.16), y: d.height * 0.65, z: halfLength - 0.32, width: 0.22, height: 0.3, depth: 0.16 })), cache.darkTrim, root);
  createCuboidGroup(scene, `${name}-roof-hardware`, [
    { x: 0, y: d.height + 0.07, z: -d.length * 0.18, width: d.width * 0.48, height: 0.13, depth: d.length * 0.16 },
    { x: 0, y: d.height + 0.055, z: d.length * 0.17, width: d.width * 0.4, height: 0.1, depth: d.length * 0.12 },
  ], accent, root);
  createCuboidGroup(scene, `${name}-number-plates`, [
    { x: 0, y: d.rideHeight + 0.31, z: halfLength + 0.078, width: 0.56, height: 0.14, depth: 0.02 },
    { x: 0, y: d.rideHeight + 0.31, z: -halfLength - 0.074, width: 0.56, height: 0.14, depth: 0.02 },
  ], cache.plate, root);
  return {
    shadowCasters: [body, glass, wheels.tires],
    leftIndicators: [leftIndicator],
    rightIndicators: [rightIndicator],
    brakeLights: [brakeLights],
  };
}

// Emissive glow for the small toggleable lamps the imported models lack, plus a
// resting/braking tail tint so brakes actually read on a modelled car.
const MODEL_TAIL_GLOW = new Color3(0.32, 0.03, 0.02);
const MODEL_BRAKE_GLOW = new Color3(0.95, 0.06, 0.03);
const MODEL_HEAD_GLOW = new Color3(0.5, 0.46, 0.3);

export function readAlbedo(material: Material): Color3 {
  if (material instanceof PBRMaterial) return material.albedoColor;
  if (material instanceof StandardMaterial) return material.diffuseColor;
  return Color3.White();
}

export function readAlbedoTexture(material: Material) {
  if (material instanceof PBRMaterial) return material.albedoTexture;
  if (material instanceof StandardMaterial) return material.diffuseTexture;
  return null;
}

/** World-space AABB of every mesh under a node (root is at the origin here, so
 * world extents equal local extents). Avoids relying on a hierarchy-bounds
 * helper that TransformNode may not expose. */
function modelHierarchyBounds(root: TransformNode): {
  min: Vector3;
  max: Vector3;
} {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const mesh of root.getChildMeshes(false)) {
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    min.minimizeInPlace(box.minimumWorld);
    max.maximizeInPlace(box.maximumWorld);
  }
  return { min, max };
}

const BLOB_SHADOW_BY_SCENE = new WeakMap<Scene, StandardMaterial>();

/**
 * Shared soft radial-gradient "blob" shadow material, used to ground vehicles
 * with a contact shadow directly beneath them. The dynamic sun shadow falls
 * offset from the body at a low angle, which reads as "floating" from the
 * top-down chase camera; the blob keeps the car grounded in every view. Cached
 * once per scene (one texture + material shared by the whole fleet).
 */
export function blobShadowMaterial(scene: Scene): StandardMaterial {
  const existing = BLOB_SHADOW_BY_SCENE.get(scene);
  if (existing) return existing;
  const size = 128;
  const texture = new DynamicTexture(
    "contact-shadow-texture",
    size,
    scene,
    false,
  );
  const context = texture.getContext();
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.06,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(0,0,0,0.5)");
  gradient.addColorStop(0.55, "rgba(0,0,0,0.26)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  texture.hasAlpha = true;
  texture.update();
  const material = new StandardMaterial("contact-shadow-material", scene);
  material.diffuseTexture = texture;
  material.useAlphaFromDiffuseTexture = true;
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.emissiveColor = Color3.Black();
  material.disableLighting = true;
  material.backFaceCulling = false;
  BLOB_SHADOW_BY_SCENE.set(scene, material);
  return material;
}

// --- Per-vehicle number plates ---------------------------------------------
//
// The imported models ship without plates, so buildModelVehicle synthesizes
// them. Each vehicle carries its own registration (appearance.plateNumber) in
// its country's design, drawn into a DynamicTexture that the vehicle owns and
// disposes with itself — so no two cars read the same plate, and live plate
// textures stay bounded to the active fleet. Kept bold and simple: a plate is
// only ever a few pixels tall on screen, so colour and layout carry the
// recognition, not fine text.

/** Plate silhouette aspect (width : height). Tuned to sit in the models'
 * moulded plate recess while reading as a plate rather than a sticker. */
const PLATE_ASPECT = 3.6;

/**
 * Creates a fresh plate material + texture for one vehicle. NOT cached across
 * vehicles (every car's number differs); the caller adds it to the instance's
 * owned materials so it disposes with the car.
 */
function createPlateMaterial(
  scene: Scene,
  region: PlateRegion,
  position: "front" | "rear",
  plateNumber: string,
): StandardMaterial {
  const height = 128;
  const width = Math.round(height * PLATE_ASPECT);
  const texture = new DynamicTexture(
    `plate-${region}-${position}`,
    { width, height },
    scene,
    true,
  );
  // The real backing context is a browser CanvasRenderingContext2D (this runs
  // only in-browser, since models never instantiate headlessly); Babylon's
  // narrower ICanvasRenderingContext type omits textAlign/textBaseline.
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  const sans = "Arial, 'Helvetica Neue', sans-serif";

  // Shrink the font until the text fits maxWidth, so no plate string overflows.
  const fitFont = (text: string, maxWidth: number, startPx: number, family: string) => {
    let size = startPx;
    ctx.font = `bold ${size}px ${family}`;
    while (ctx.measureText(text).width > maxWidth && size > 8) {
      size -= 2;
      ctx.font = `bold ${size}px ${family}`;
    }
  };
  const starRing = (cx: number, cy: number, radius: number) => {
    ctx.fillStyle = "#f6cf1c";
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, Math.max(1.6, radius * 0.18), 0, Math.PI * 2);
      ctx.fill();
    }
  };

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (region === "uk") {
    // White front plate, yellow rear plate — the authentic UK pairing.
    ctx.fillStyle = position === "rear" ? "#f4cb17" : "#eceee9";
    ctx.fillRect(0, 0, width, height);
    const band = Math.round(width * 0.13);
    ctx.fillStyle = "#0b3aa8";
    ctx.fillRect(0, 0, band, height);
    starRing(band / 2, height * 0.4, height * 0.14);
    ctx.fillStyle = "#ffffff";
    fitFont("UK", band * 0.82, Math.round(height * 0.2), sans);
    ctx.fillText("UK", band / 2, height * 0.76);
    ctx.fillStyle = "#161616";
    fitFont(plateNumber, width - band - width * 0.08, Math.round(height * 0.52), sans);
    ctx.fillText(plateNumber, band + (width - band) / 2, height * 0.54);
  } else if (region === "us") {
    // New York State: white ground, blue legend, gold accent.
    ctx.fillStyle = "#f5f5f1";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#123a7a";
    fitFont("NEW YORK", width * 0.66, Math.round(height * 0.2), sans);
    ctx.fillText("NEW YORK", width / 2, height * 0.18);
    fitFont(plateNumber, width * 0.86, Math.round(height * 0.46), sans);
    ctx.fillText(plateNumber, width / 2, height * 0.55);
    ctx.fillStyle = "#c1901c";
    fitFont("EMPIRE STATE", width * 0.5, Math.round(height * 0.12), sans);
    ctx.fillText("EMPIRE STATE", width / 2, height * 0.87);
  } else if (region === "fr") {
    // France: white ground, blue EU band left (F), blue département band right.
    ctx.fillStyle = "#f1f1ee";
    ctx.fillRect(0, 0, width, height);
    const band = Math.round(width * 0.1);
    ctx.fillStyle = "#0b3aa8";
    ctx.fillRect(0, 0, band, height);
    ctx.fillRect(width - band, 0, band, height);
    starRing(band / 2, height * 0.33, height * 0.12);
    ctx.fillStyle = "#ffffff";
    fitFont("F", band * 0.72, Math.round(height * 0.2), sans);
    ctx.fillText("F", band / 2, height * 0.74);
    fitFont("62", band * 0.72, Math.round(height * 0.18), sans);
    ctx.fillText("62", width - band / 2, height * 0.3);
    ctx.fillStyle = "#161616";
    fitFont(plateNumber, width - band * 2 - width * 0.08, Math.round(height * 0.46), sans);
    ctx.fillText(plateNumber, width / 2, height * 0.54);
  } else {
    // Japan: white ground, green legend (private car). Area line is fixed for
    // the map; plateNumber is the lower hiragana + serial line.
    const cjk = "'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', sans-serif";
    ctx.fillStyle = "#f4f4ee";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#0b7a3a";
    fitFont("世田谷 300", width * 0.66, Math.round(height * 0.28), cjk);
    ctx.fillText("世田谷 300", width / 2, height * 0.27);
    fitFont(plateNumber, width * 0.78, Math.round(height * 0.42), cjk);
    ctx.fillText(plateNumber, width / 2, height * 0.65);
  }

  const borderColor =
    region === "jp" ? "#0b7a3a" : region === "us" ? "#123a7a" : "#22262c";
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = Math.max(2, height * 0.045);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, width - ctx.lineWidth, height - ctx.lineWidth);

  texture.update();

  const material = new StandardMaterial(`plate-${region}-${position}-material`, scene);
  material.diffuseTexture = texture;
  // A little self-illumination keeps the plate legible when the car's tail is in
  // shadow (real plates are retroreflective), without tripping the bloom.
  material.emissiveTexture = texture;
  material.emissiveColor = new Color3(0.3, 0.3, 0.3);
  material.specularColor = new Color3(0.12, 0.12, 0.12);
  material.specularPower = 48;
  return material;
}

/**
 * Builds a vehicle from a preloaded glb, honouring the same VehicleMeshVisual
 * contract as the procedural path. Returns null when no model is registered for
 * this appearance or its container has not loaded, so the caller falls back to
 * procedural geometry.
 *
 * Flow: instantiate independent clones -> convert each glTF material to a
 * scene-consistent StandardMaterial (recolouring the body to the paint colour,
 * giving head/tail lamps a gentle glow) -> synthesize the small toggleable
 * indicator + brake lamps the models omit -> normalise scale, facing and ground
 * contact so the model sits like the procedural cars it replaces.
 */
function buildModelVehicle(
  scene: Scene,
  parent: TransformNode,
  name: string,
  appearance: VehicleAppearance,
): VehicleMeshVisual | null {
  const config: VehicleModelConfig | undefined =
    VEHICLE_MODEL_REGISTRY[appearance.model];
  if (!config || !isModelReady(scene, config.url)) return null;
  const instance = instantiateModel(scene, config.url);
  const modelRoot = instance?.rootNodes[0];
  if (!modelRoot) return null;

  const root = new TransformNode(`${name}-model-root`, scene);
  modelRoot.parent = root;

  const paint = parseColor(appearance.paintHex, "#c9ccce");
  const bodyNames = new Set(config.bodyMaterialNames);
  const converted = new Map<Material, StandardMaterial>();
  const ownedMaterials: StandardMaterial[] = [];
  const taillightMaterials: StandardMaterial[] = [];
  const shadowCasters: Mesh[] = [];

  for (const mesh of root.getChildMeshes(false)) {
    if (!/wheel/i.test(mesh.name) && mesh instanceof Mesh) {
      shadowCasters.push(mesh);
    }
    const source = mesh.material;
    if (!source) continue;
    let standard = converted.get(source);
    if (!standard) {
      standard = new StandardMaterial(`${name}-${source.name}`, scene);
      const texture = readAlbedoTexture(source);
      if (texture) standard.diffuseTexture = texture;
      standard.diffuseColor = bodyNames.has(source.name)
        ? paint
        : texture
          ? Color3.White()
          : readAlbedo(source).clone();
      standard.specularColor = new Color3(0.22, 0.22, 0.22);
      standard.specularPower = 44;
      if (/headlight/i.test(source.name)) {
        standard.emissiveColor = MODEL_HEAD_GLOW;
      } else if (/taillight/i.test(source.name)) {
        standard.emissiveColor = MODEL_TAIL_GLOW;
        taillightMaterials.push(standard);
      }
      converted.set(source, standard);
      ownedMaterials.push(standard);
    }
    mesh.material = standard;
  }

  // Soft blob contact shadow directly under the car so it reads as grounded in
  // the top-down chase view. Anchored in the model's own (pre-scale) space just
  // above its lowest point, so it scales + moves with the car, sits on the road,
  // and disposes with it.
  root.computeWorldMatrix(true);
  const bounds = modelHierarchyBounds(root);
  const contactShadow = MeshBuilder.CreateGround(
    `${name}-contact-shadow`,
    {
      width: (bounds.max.x - bounds.min.x) * 1.18,
      height: (bounds.max.z - bounds.min.z) * 1.12,
    },
    scene,
  );
  contactShadow.material = blobShadowMaterial(scene);
  contactShadow.position.set(
    (bounds.min.x + bounds.max.x) / 2,
    bounds.min.y + 0.01,
    (bounds.min.z + bounds.max.z) / 2,
  );
  contactShadow.parent = root;
  contactShadow.isPickable = false;
  contactShadow.receiveShadows = false;

  // Synthesize the front + rear number plates the imported models omit, each
  // wearing this vehicle's own registration in its country's design. Authored in
  // the model's pre-scale space (like the contact shadow) and sized from its
  // bounds, so the plates land correctly whatever the model's dimensions or
  // config.scale. Front sits at +Z (every model imports front-first, yawOffset
  // 0). The front recess sits lower on these models than the rear, so the front
  // plate drops below the rear rather than sharing one height.
  const region = appearance.plateRegion;
  const rearPlateMaterial = createPlateMaterial(scene, region, "rear", appearance.plateNumber);
  // Front and rear differ only for the UK (white front / yellow rear); every
  // other region shares one texture across both plates.
  const frontPlateMaterial =
    region === "uk"
      ? createPlateMaterial(scene, region, "front", appearance.plateNumber)
      : rearPlateMaterial;
  const ownedPlateMaterials =
    frontPlateMaterial === rearPlateMaterial
      ? [rearPlateMaterial]
      : [rearPlateMaterial, frontPlateMaterial];
  const bodyWidth = bounds.max.x - bounds.min.x;
  const bodyHeight = bounds.max.y - bounds.min.y;
  const plateWidth = bodyWidth * 0.28;
  const plateHeight = plateWidth / PLATE_ASPECT;
  const plateThickness = plateWidth * 0.045;
  const plateCenterX = (bounds.min.x + bounds.max.x) / 2;
  const plateMeshes = [1, -1].map((frontSign) => {
    const front = frontSign > 0;
    const plate = MeshBuilder.CreateBox(
      `${name}-number-plate-${front ? "front" : "rear"}`,
      { width: plateWidth, height: plateHeight, depth: plateThickness },
      scene,
    );
    plate.material = front ? frontPlateMaterial : rearPlateMaterial;
    plate.position.set(
      plateCenterX,
      bounds.min.y + bodyHeight * (front ? 0.3 : 0.42),
      front ? bounds.max.z : bounds.min.z,
    );
    plate.parent = root;
    plate.isPickable = false;
    plate.receiveShadows = false;
    return plate;
  });

  // Normalise scale, facing and ground contact (lowest point at LOCAL_GROUND_Y).
  root.scaling.setAll(config.scale);
  root.rotation.y = config.yawOffset;
  root.computeWorldMatrix(true);
  const scaled = modelHierarchyBounds(root);
  root.position.y = LOCAL_GROUND_Y - scaled.min.y;
  root.parent = parent;

  let disposed = false;
  let detailVisible = true;
  return {
    root,
    shadowCasters,
    leftIndicators: [],
    rightIndicators: [],
    brakeLights: [],
    setSignal() {
      // Imported models have no separate indicator geometry, and their single
      // tail-lamp material can't blink one side; the player's signal state is
      // shown in the HUD. (A later pass could add modelled corner blinkers.)
    },
    setBraking(active) {
      if (disposed) return;
      // No toggleable brake mesh on the models — brighten their own tail-lamp
      // material instead, which reads as real brake lights.
      for (const material of taillightMaterials) {
        material.emissiveColor = active ? MODEL_BRAKE_GLOW : MODEL_TAIL_GLOW;
      }
    },
    setDetailVisible(visible) {
      // The synthesized number plates are the model's only removable trim; cull
      // them past the LOD distance, matching the procedural cars.
      if (disposed || detailVisible === visible) return;
      detailVisible = visible;
      for (const plate of plateMeshes) plate.setEnabled(visible);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // Keep the shared source materials/textures (owned by the container);
      // dispose only this instance's geometry and the materials we created.
      root.dispose(false, false);
      for (const material of ownedMaterials) material.dispose(true, false);
      // The plate materials own per-vehicle DynamicTextures, so dispose those
      // textures too (unlike the glTF materials, whose textures are shared).
      for (const material of ownedPlateMaterials) material.dispose(true, true);
    },
  };
}

/**
 * Builds one contemporary procedural vehicle. Geometry is expressed in local
 * metres with FRONT at +Z and the returned root at Y=0; the caller owns world
 * placement and heading. Used as the fallback when the imported model for this
 * appearance has not loaded (or none is registered for it).
 */
export function createVehicleMesh(
  scene: Scene,
  parent: TransformNode,
  name: string,
  appearance: VehicleAppearance,
): VehicleMeshVisual {
  const modelVisual = buildModelVehicle(scene, parent, name, appearance);
  if (modelVisual) return modelVisual;
  const root = new TransformNode(`${name}-visual-root`, scene);
  root.parent = parent;
  const cache = materialsForScene(scene);
  const paint = paintMaterial(scene, cache, appearance.paintHex);
  const accent = paintMaterial(scene, cache, appearance.accentHex);
  const parts = appearance.model === "delivery-van"
    ? buildDeliveryVan(scene, root, name, appearance, cache, paint, accent)
    : appearance.model === "city-bus" || appearance.model === "london-double-decker"
      ? buildBus(scene, root, name, appearance, cache, paint, accent)
      : buildPassengerVehicle(scene, root, name, appearance, cache, paint, accent);
  const detailMeshes = root.getChildMeshes(false).filter((mesh) =>
    /alloy-rims|mirrors|number-plates|model-details|painted-roof-panel|window-pillars|accent-|roof-hardware/.test(
      mesh.name,
    ),
  );
  let detailVisible = true;
  let disposed = false;

  return {
    root,
    shadowCasters: parts.shadowCasters,
    leftIndicators: parts.leftIndicators,
    rightIndicators: parts.rightIndicators,
    brakeLights: parts.brakeLights,
    setSignal(signal, blinkOn) {
      if (disposed) return;
      const leftOn = signal === "left" && blinkOn;
      const rightOn = signal === "right" && blinkOn;
      for (const mesh of parts.leftIndicators) mesh.setEnabled(leftOn);
      for (const mesh of parts.rightIndicators) mesh.setEnabled(rightOn);
    },
    setBraking(active) {
      if (disposed) return;
      for (const mesh of parts.brakeLights) mesh.setEnabled(active);
    },
    setDetailVisible(visible) {
      if (disposed || detailVisible === visible) return;
      detailVisible = visible;
      for (const mesh of detailMeshes) mesh.setEnabled(visible);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // `disposeMaterialAndTextures=false` is essential: these are scene-cached
      // fleet materials shared by other live vehicles.
      root.dispose(false, false);
    },
  };
}
