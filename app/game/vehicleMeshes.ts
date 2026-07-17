import {
  Color3,
  Mesh,
  Scene,
  StandardMaterial,
  TransformNode,
  VertexData,
} from "@babylonjs/core";
import type {
  VehicleAppearance,
  VehicleDimensions,
  VehicleModel,
} from "./vehicleVisuals";

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

/**
 * Builds one contemporary procedural vehicle. Geometry is expressed in local
 * metres with FRONT at +Z and the returned root at Y=0; the caller owns world
 * placement and heading.
 */
export function createVehicleMesh(
  scene: Scene,
  parent: TransformNode,
  name: string,
  appearance: VehicleAppearance,
): VehicleMeshVisual {
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
