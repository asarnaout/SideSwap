import {
  Mesh,
  NullEngine,
  Scene,
  TransformNode,
  VertexBuffer,
} from "@babylonjs/core";
import { describe, expect, it } from "vitest";
import {
  createVehicleMesh,
  type VehicleMeshVisual,
} from "../app/game/vehicleMeshes";
import {
  resolvePlayerVehicleAppearance,
  resolveTrafficVehicleAppearance,
  type PassengerVehicleStyle,
  type VehicleAppearance,
  type VehicleModel,
} from "../app/game/vehicleVisuals";

const PASSENGER_STYLES: readonly PassengerVehicleStyle[] = [
  "electric-fastback",
  "compact-hatch",
  "sport-sedan",
  "urban-crossover",
  "sport-wagon",
];

const ALL_MODELS: readonly VehicleModel[] = [
  ...PASSENGER_STYLES,
  "electric-taxi",
  "delivery-van",
  "city-bus",
  "london-double-decker",
];

interface BuiltVisual {
  readonly appearance: VehicleAppearance;
  readonly prefix: string;
  readonly visual: VehicleMeshVisual;
  readonly meshes: readonly Mesh[];
}

function passengerAppearances(): readonly VehicleAppearance[] {
  const appearances = new Map<PassengerVehicleStyle, VehicleAppearance>();
  for (let index = 1; index <= 500 && appearances.size < PASSENGER_STYLES.length; index += 1) {
    const appearance = resolveTrafficVehicleAppearance({
      vehicleId: `mesh-passenger-${index}`,
      trafficSeed: 612,
      variant: "car",
      mapId: "nyc-upper-west-side",
    });
    if (PASSENGER_STYLES.includes(appearance.model as PassengerVehicleStyle)) {
      appearances.set(appearance.model as PassengerVehicleStyle, appearance);
    }
  }
  return PASSENGER_STYLES.map((model) => {
    const appearance = appearances.get(model);
    if (!appearance) throw new Error(`Could not resolve passenger appearance ${model}`);
    return appearance;
  });
}

function everyModelAppearance(): readonly VehicleAppearance[] {
  return [
    ...passengerAppearances(),
    resolveTrafficVehicleAppearance({
      vehicleId: "nyc-electric-cab",
      trafficSeed: 91,
      variant: "taxi",
      mapId: "nyc-upper-west-side",
    }),
    resolveTrafficVehicleAppearance({
      vehicleId: "delivery-van",
      trafficSeed: 91,
      variant: "van",
      mapId: "calais-coquelles",
    }),
    resolveTrafficVehicleAppearance({
      vehicleId: "city-bus",
      trafficSeed: 91,
      variant: "bus",
      mapId: "tokyo-setagaya",
    }),
    resolveTrafficVehicleAppearance({
      vehicleId: "london-red-bus",
      trafficSeed: 91,
      variant: "bus",
      mapId: "london-south-kensington",
    }),
  ];
}

function buildVisual(
  scene: Scene,
  parent: TransformNode,
  appearance: VehicleAppearance,
  suffix: string = appearance.model,
): BuiltVisual {
  const prefix = `test-${suffix}`;
  const visual = createVehicleMesh(scene, parent, prefix, appearance);
  visual.root.computeWorldMatrix(true);
  const meshes = visual.root.getChildMeshes(false) as Mesh[];
  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    mesh.refreshBoundingInfo();
  }
  return { appearance, prefix, visual, meshes };
}

function namedMesh(built: BuiltVisual, pattern: RegExp): Mesh {
  const mesh = built.meshes.find((candidate) => pattern.test(candidate.name));
  if (!mesh) {
    throw new Error(
      `Expected ${built.appearance.model} to include ${pattern}; found ${built.meshes
        .map((candidate) => candidate.name)
        .join(", ")}`,
    );
  }
  return mesh;
}

/** Counts disconnected indexed components, allowing one draw-call mesh to hold four wheels. */
function connectedGeometryComponents(mesh: Mesh): number {
  const indices = mesh.getIndices();
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!indices || indices.length === 0 || !positions) return 0;
  const parents = Array.from({ length: mesh.getTotalVertices() }, (_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = root;
      index = next;
    }
    return root;
  };
  const join = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  // Babylon geometry commonly duplicates a cuboid's vertices per face to keep
  // its normals crisp. Treat coincident vertices as connected so this counts
  // actual spatial parts rather than six independent faces per cuboid.
  const coincidentVertices = new Map<string, number>();
  for (let index = 0; index < mesh.getTotalVertices(); index += 1) {
    const offset = index * 3;
    const key = [positions[offset], positions[offset + 1], positions[offset + 2]]
      .map((value) => value.toFixed(6))
      .join("|");
    const existing = coincidentVertices.get(key);
    if (existing === undefined) coincidentVertices.set(key, index);
    else join(existing, index);
  }
  const used = new Set<number>();
  for (let index = 0; index + 2 < indices.length; index += 3) {
    const a = Number(indices[index]);
    const b = Number(indices[index + 1]);
    const c = Number(indices[index + 2]);
    used.add(a);
    used.add(b);
    used.add(c);
    join(a, b);
    join(b, c);
  }
  return new Set([...used].map(find)).size;
}

function aggregateBounds(meshes: readonly Mesh[]): readonly number[] {
  const minimum = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const maximum = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const mesh of meshes) {
    const box = mesh.getBoundingInfo().boundingBox;
    const meshMinimum = box.minimumWorld.asArray();
    const meshMaximum = box.maximumWorld.asArray();
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], meshMinimum[axis]);
      maximum[axis] = Math.max(maximum[axis], meshMaximum[axis]);
    }
  }
  return maximum.map((value, axis) => value - minimum[axis]);
}

function passengerStructureSignature(built: BuiltVisual): string {
  const silhouetteMeshes = built.meshes.filter((mesh) =>
    /body-shell|glass-canopy|model-details/.test(mesh.name),
  );
  return silhouetteMeshes
    .map((mesh) => {
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
      const dimensions = built.appearance.dimensions;
      const normalizedProfile = Array.from(positions, (value, index) => {
        const axis = index % 3;
        const scale = axis === 0
          ? dimensions.width
          : axis === 1
            ? dimensions.height
            : dimensions.length;
        return (value / scale).toFixed(3);
      });
      const normalizedName = mesh.name.replace(built.prefix, "vehicle");
      return `${normalizedName}:${mesh.getTotalVertices()}:${normalizedProfile.join(",")}`;
    })
    .sort()
    .join("|");
}

describe("procedural vehicle meshes", () => {
  it("builds every model with a detailed shell, glazing, wheels, lamps and bounded mesh count", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const parent = new TransformNode("fleet-parent", scene);
    const built = everyModelAppearance().map((appearance) =>
      buildVisual(scene, parent, appearance),
    );

    expect(new Set(built.map(({ appearance }) => appearance.model))).toEqual(
      new Set(ALL_MODELS),
    );
    for (const vehicle of built) {
      expect(vehicle.meshes.length).toBeGreaterThanOrEqual(10);
      expect(vehicle.meshes.length).toBeLessThanOrEqual(20);
      expect(vehicle.visual.shadowCasters.length).toBeGreaterThanOrEqual(3);
      expect(vehicle.visual.shadowCasters.every((mesh) => vehicle.meshes.includes(mesh))).toBe(true);

      namedMesh(vehicle, /shell$/);
      namedMesh(vehicle, /glass-canopy$|glazing$/);
      namedMesh(vehicle, /led-headlights$/);
      namedMesh(vehicle, /tail-lights$/);

      const tires = namedMesh(vehicle, /-tires$/);
      const rims = namedMesh(vehicle, /-alloy-rims$/);
      expect(connectedGeometryComponents(tires)).toBeGreaterThanOrEqual(4);
      expect(connectedGeometryComponents(rims)).toBeGreaterThanOrEqual(4);

      if (vehicle.appearance.model !== "city-bus" && vehicle.appearance.model !== "london-double-decker") {
        namedMesh(vehicle, /-mirrors$/);
      }
    }

    for (const vehicle of built) vehicle.visual.dispose();
    parent.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("keeps every generated vertex and world bound finite", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const parent = new TransformNode("bounds-parent", scene);
    const built = everyModelAppearance().map((appearance) =>
      buildVisual(scene, parent, appearance, `bounds-${appearance.model}`),
    );

    for (const vehicle of built) {
      const sizes = aggregateBounds(vehicle.meshes);
      expect(sizes.every((value) => Number.isFinite(value) && value > 0)).toBe(true);
      const { dimensions, model } = vehicle.appearance;
      const widthAllowance = model === "city-bus" || model === "london-double-decker"
        ? 0.6
        : model === "delivery-van"
          ? 0.5
          : 0.45;
      expect(sizes[0]).toBeLessThanOrEqual(dimensions.width + widthAllowance);
      expect(sizes[1]).toBeLessThanOrEqual(dimensions.height + 0.3);
      expect(sizes[2]).toBeLessThanOrEqual(dimensions.length + 0.2);
      expect(sizes[0]).toBeLessThan(3.05);
      if (model === "city-bus" || model === "london-double-decker") {
        // Matches the core's stationary following envelope closely enough to
        // prevent rendered buses from interpenetrating an ordinary queue.
        expect(sizes[2]).toBeLessThanOrEqual(6.05);
      }
      for (const mesh of vehicle.meshes) {
        const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
        expect(positions).not.toBeNull();
        expect(positions?.length).toBeGreaterThan(0);
        expect(positions?.every(Number.isFinite)).toBe(true);
        const box = mesh.getBoundingInfo().boundingBox;
        expect([...box.minimumWorld.asArray(), ...box.maximumWorld.asArray()].every(Number.isFinite)).toBe(true);
      }
    }

    for (const vehicle of built) vehicle.visual.dispose();
    parent.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("gives all five passenger styles structurally distinct silhouettes", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const parent = new TransformNode("silhouette-parent", scene);
    const built = passengerAppearances().map((appearance) =>
      buildVisual(scene, parent, appearance, `silhouette-${appearance.model}`),
    );

    expect(new Set(built.map(({ appearance }) => appearance.model))).toEqual(
      new Set(PASSENGER_STYLES),
    );
    expect(new Set(built.map(passengerStructureSignature)).size).toBe(PASSENGER_STYLES.length);

    for (const vehicle of built) vehicle.visual.dispose();
    parent.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("groups exactly one front and one rear indicator overlay per side for passenger and player cars", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const parent = new TransformNode("indicator-parent", scene);
    const appearances = [...passengerAppearances(), resolvePlayerVehicleAppearance("london-south-kensington")];
    const built = appearances.map((appearance, index) =>
      buildVisual(scene, parent, appearance, `indicators-${appearance.model}-${index}`),
    );

    for (const vehicle of built) {
      expect(vehicle.visual.leftIndicators).toHaveLength(1);
      expect(vehicle.visual.rightIndicators).toHaveLength(1);
      expect(
        vehicle.visual.leftIndicators.reduce(
          (total, mesh) => total + connectedGeometryComponents(mesh),
          0,
        ),
      ).toBe(2);
      expect(
        vehicle.visual.rightIndicators.reduce(
          (total, mesh) => total + connectedGeometryComponents(mesh),
          0,
        ),
      ).toBe(2);
    }

    for (const vehicle of built) vehicle.visual.dispose();
    parent.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("updates signal and brake overlay enable state for every model", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const parent = new TransformNode("state-parent", scene);
    const built = everyModelAppearance().map((appearance) =>
      buildVisual(scene, parent, appearance, `state-${appearance.model}`),
    );

    for (const vehicle of built) {
      const { visual, meshes } = vehicle;
      expect(visual.leftIndicators.every((mesh) => !mesh.isEnabled())).toBe(true);
      expect(visual.rightIndicators.every((mesh) => !mesh.isEnabled())).toBe(true);
      expect(visual.brakeLights.every((mesh) => !mesh.isEnabled())).toBe(true);

      visual.setSignal("left", true);
      expect(visual.leftIndicators.every((mesh) => mesh.isEnabled())).toBe(true);
      expect(visual.rightIndicators.every((mesh) => !mesh.isEnabled())).toBe(true);

      visual.setSignal("right", true);
      expect(visual.leftIndicators.every((mesh) => !mesh.isEnabled())).toBe(true);
      expect(visual.rightIndicators.every((mesh) => mesh.isEnabled())).toBe(true);

      visual.setSignal("right", false);
      expect(visual.leftIndicators.every((mesh) => !mesh.isEnabled())).toBe(true);
      expect(visual.rightIndicators.every((mesh) => !mesh.isEnabled())).toBe(true);

      visual.setBraking(true);
      expect(visual.brakeLights.every((mesh) => mesh.isEnabled())).toBe(true);
      visual.setBraking(false);
      expect(visual.brakeLights.every((mesh) => !mesh.isEnabled())).toBe(true);

      const detailMeshes = meshes.filter((mesh) =>
        /alloy-rims|mirrors|number-plates|model-details|painted-roof-panel|window-pillars|accent-|roof-hardware/.test(
          mesh.name,
        ),
      );
      expect(detailMeshes.length).toBeGreaterThan(0);
      visual.setDetailVisible(false);
      expect(detailMeshes.every((mesh) => !mesh.isEnabled())).toBe(true);
      expect(namedMesh(vehicle, /shell$/).isEnabled()).toBe(true);
      visual.setDetailVisible(true);
      expect(detailMeshes.every((mesh) => mesh.isEnabled())).toBe(true);
    }

    for (const vehicle of built) vehicle.visual.dispose();
    parent.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("disposes only its own hierarchy and remains safely idempotent", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const parent = new TransformNode("dispose-parent", scene);
    const first = buildVisual(scene, parent, resolvePlayerVehicleAppearance("london-south-kensington"), "dispose-first");
    const second = buildVisual(
      scene,
      parent,
      resolveTrafficVehicleAppearance({
        vehicleId: "dispose-second",
        trafficSeed: 4,
        variant: "car",
        mapId: "nyc-upper-west-side",
      }),
      "dispose-second",
    );
    const firstMeshes = [...first.meshes];
    const secondMeshes = [...second.meshes];

    first.visual.dispose();
    expect(first.visual.root.isDisposed()).toBe(true);
    expect(firstMeshes.every((mesh) => mesh.isDisposed())).toBe(true);
    expect(parent.isDisposed()).toBe(false);
    expect(second.visual.root.isDisposed()).toBe(false);
    expect(secondMeshes.every((mesh) => !mesh.isDisposed())).toBe(true);
    expect(() => first.visual.dispose()).not.toThrow();

    second.visual.dispose();
    parent.dispose();
    scene.dispose();
    engine.dispose();
  });
});
