import { readFileSync } from "node:fs";
import {
  NullEngine,
  Scene,
  SceneLoader,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { describe, expect, it } from "vitest";
import {
  computeLightBarPlacement,
  computeLiveryPanels,
  computePlatePlacements,
  createVehicleMesh,
  measureRoofPad,
  type RoofPad,
} from "../app/game/vehicleMeshes";
import { VEHICLE_MODEL_REGISTRY } from "../app/game/modelLibrary";
import {
  policeLiveryForMap,
  resolvePlayerVehicleAppearance,
  resolveTrafficVehicleAppearance,
  type TrafficVehicleAppearanceInput,
  type VehicleModel,
} from "../app/game/vehicleVisuals";

// vehicleMeshes now builds vehicles solely from imported glb models (the visual
// result is verified in a real browser, not here). Under the headless NullEngine
// no model is preloaded, so createVehicleMesh returns its empty placeholder — the
// inert visual shown behind the loading gate until the models arrive. These
// tests pin that contract: the entry point never throws, always returns a
// well-formed VehicleMeshVisual parented under the caller's node, and its
// controls are safe no-ops. The London double-decker also exercises the
// double-decker → single-deck fallback branch, which likewise lands on the
// placeholder when neither model is loaded.
describe("createVehicleMesh (no model loaded → placeholder)", () => {
  const trafficInputs: TrafficVehicleAppearanceInput[] = [
    { vehicleId: "npc-1", trafficSeed: 42, variant: "car", mapId: "nyc-upper-west-side" },
    { vehicleId: "van-1", trafficSeed: 42, variant: "van", mapId: "calais-coquelles" },
    { vehicleId: "bus-1", trafficSeed: 42, variant: "bus", mapId: "tokyo-setagaya" },
    { vehicleId: "ldn-bus", trafficSeed: 42, variant: "bus", mapId: "london-south-kensington" },
  ];
  const appearances = [
    resolvePlayerVehicleAppearance("london-south-kensington"),
    ...trafficInputs.map(resolveTrafficVehicleAppearance),
  ];

  it("returns a well-formed placeholder for every appearance, without throwing", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const parent = new TransformNode("fleet", scene);
    for (const appearance of appearances) {
      const visual = createVehicleMesh(scene, parent, `veh-${appearance.model}`, appearance);
      expect(visual.root).toBeTruthy();
      expect(visual.root.parent).toBe(parent);
      expect(visual.shadowCasters.length).toBe(0);
      expect(visual.leftIndicators.length).toBe(0);
      // Controls are inert but callable (a placeholder has no toggleable geometry).
      expect(() => {
        visual.setSignal("left", true);
        visual.setBraking(true);
        visual.setDetailVisible(false);
      }).not.toThrow();
      visual.dispose();
      visual.dispose(); // idempotent
    }
    scene.dispose();
    engine.dispose();
  });
});

// The plates are boxes parented to the model root, which is later spun by the
// model's yawOffset. computePlatePlacements must anticipate that yaw so the
// plates land on the true front/rear face (issue #55: the van imports
// front-along-+X, so a naive +Z assumption stuck its plates on the sides), and
// must orient both to show the box's correct-reading -Z face outward.
describe("computePlatePlacements", () => {
  // Babylon's left-handed Y rotation: x' = x cosθ + z sinθ, z' = -x sinθ + z cosθ.
  const rotateY = (v: Vector3, theta: number) =>
    new Vector3(
      v.x * Math.cos(theta) + v.z * Math.sin(theta),
      v.y,
      -v.x * Math.sin(theta) + v.z * Math.cos(theta),
    );
  const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  const cases = [
    {
      name: "front-first model (yawOffset 0): length on Z, width on X",
      yawOffset: 0,
      // centre offset off-origin to prove the plates track the model centre.
      min: new Vector3(-0.9, 0, -2),
      max: new Vector3(0.9, 1.6, 2),
      expectWidth: 1.8 * 0.28,
    },
    {
      name: "van (yawOffset -90°): length on X, width on Z",
      yawOffset: -Math.PI / 2,
      min: new Vector3(-2, 0, -0.9),
      max: new Vector3(2, 1.6, 0.9),
      expectWidth: 1.8 * 0.28,
    },
  ] as const;

  for (const c of cases) {
    it(c.name, () => {
      const bounds = { min: c.min, max: c.max };
      const { front, rear } = computePlatePlacements(bounds, c.yawOffset);
      const center = c.min.add(c.max).scale(0.5);
      const worldCenter = rotateY(center, c.yawOffset);
      const worldFront = rotateY(front.position, c.yawOffset);
      const worldRear = rotateY(rear.position, c.yawOffset);

      // Front sits ahead (world +Z), rear behind, both on the car's centre line.
      expect(worldFront.z).toBeGreaterThan(worldRear.z);
      expect(worldFront.z).toBeGreaterThan(worldCenter.z + 1); // near the +Z face
      expect(worldRear.z).toBeLessThan(worldCenter.z - 1);
      expect(worldFront.x).toBeCloseTo(worldCenter.x, 6);
      expect(worldRear.x).toBeCloseTo(worldCenter.x, 6);

      // Sized from the true lateral extent (width), not the length.
      expect(front.width).toBeCloseTo(c.expectWidth, 6);
      expect(rear.width).toBeCloseTo(c.expectWidth, 6);
      expect(front.width).toBeGreaterThan(front.height); // landscape plate

      // Both present the box's -Z face outward: net world yaw is 0 at the rear
      // and π at the front (turned 180° so its -Z face aims forward too).
      expect(norm(c.yawOffset + rear.rotationY)).toBeCloseTo(0, 6);
      expect(norm(c.yawOffset + front.rotationY)).toBeCloseTo(Math.PI, 6);
    });
  }

  it("keeps front-first placement identical to a plain +Z/-X layout", () => {
    // Regression guard: for yawOffset 0 the maths must reduce to the original
    // hard-coded layout (centre X, front at max.z, rear at min.z, width 0.28·X).
    const min = new Vector3(-1, 0, -2.5);
    const max = new Vector3(1, 1.4, 2.5);
    const { front, rear } = computePlatePlacements({ min, max }, 0);
    expect(front.position.x).toBeCloseTo(0, 6);
    expect(front.position.z).toBeCloseTo(2.5, 6); // max.z
    expect(rear.position.z).toBeCloseTo(-2.5, 6); // min.z
    expect(front.width).toBeCloseTo(2 * 0.28, 6); // 0.28 · X-extent
  });
});

// --- Patrol light bar -------------------------------------------------------
//
// Issue #117: the bar was bolted to the NPC's parent node at a hard-coded
// y = 1.5m. Measured against the real glbs that floats it 0.19m above an
// electric-fastback's roof and 0.35m above a compact-hatch's, while sinking it
// 0.10-0.15m into the two SUVs — every model has a different roof height, so
// the only correct anchor is the measured one. These tests pin the bar to the
// geometry, so no future model can reintroduce a floating light bar.

describe("computeLightBarPlacement", () => {
  const rotateY = (v: Vector3, theta: number) =>
    new Vector3(
      v.x * Math.cos(theta) + v.z * Math.sin(theta),
      v.y,
      -v.x * Math.sin(theta) + v.z * Math.cos(theta),
    );

  // A roof panel 1.2m across, 0.9m long, 1.35m up, offset off-origin on both
  // axes so nothing can pass by accidentally assuming a centred model.
  const pad: RoofPad = { minX: -0.5, maxX: 0.7, minZ: -1.1, maxZ: -0.2, topY: 1.35 };
  // The same panel as it would be authored in a model that imports front-along-X.
  const rotatedPad: RoofPad = { minX: -1.1, maxX: -0.2, minZ: -0.7, maxZ: 0.5, topY: 1.35 };

  for (const [name, input, yawOffset] of [
    ["front-first model (yawOffset 0)", pad, 0],
    ["side-first model (yawOffset -90°)", rotatedPad, -Math.PI / 2],
  ] as const) {
    it(`seats the bar on the roof of a ${name}`, () => {
      const bar = computeLightBarPlacement(input, yawOffset);

      // The bar's base is exactly the roof height — never above it, never in it.
      expect(bar.position.y).toBeCloseTo(input.topY, 9);

      // Sits toward the front of the panel and stays entirely on it.
      const world = rotateY(bar.position, yawOffset);
      const padWorldMin = rotateY(new Vector3(input.minX, 0, input.minZ), yawOffset);
      const padWorldMax = rotateY(new Vector3(input.maxX, 0, input.maxZ), yawOffset);
      const front = Math.max(padWorldMin.z, padWorldMax.z);
      const back = Math.min(padWorldMin.z, padWorldMax.z);
      const left = Math.min(padWorldMin.x, padWorldMax.x);
      const right = Math.max(padWorldMin.x, padWorldMax.x);
      expect(world.z).toBeGreaterThan((front + back) / 2); // forward half
      expect(world.z + bar.depth / 2).toBeLessThanOrEqual(front + 1e-9);
      expect(world.z - bar.depth / 2).toBeGreaterThanOrEqual(back - 1e-9);
      expect(world.x - bar.width / 2).toBeGreaterThan(left);
      expect(world.x + bar.width / 2).toBeLessThan(right);

      // Runs across the car, not along it, and stays a low-profile bar.
      expect(bar.width).toBeGreaterThan(bar.depth * 2);
      expect(bar.height).toBeLessThan(0.2);
    });
  }

  it("puts both orientations in the same place on the car", () => {
    const straight = computeLightBarPlacement(pad, 0);
    const rotated = computeLightBarPlacement(rotatedPad, -Math.PI / 2);
    expect(rotated.width).toBeCloseTo(straight.width, 9);
    expect(rotated.depth).toBeCloseTo(straight.depth, 9);
    const world = rotateY(rotated.position, -Math.PI / 2);
    expect(world.x).toBeCloseTo(straight.position.x, 9);
    expect(world.z).toBeCloseTo(straight.position.z, 9);
  });
});

// The above proves the maths; this proves it against the actual shipped car
// models — the part that no amount of hand-tuned constants ever got right.
describe("patrol kit on the real vehicle models", () => {
  const modelKeys: VehicleModel[] = [
    "electric-fastback",
    "compact-hatch",
    "sport-sedan",
    "urban-crossover",
    "sport-wagon",
  ];

  interface Loaded {
    root: TransformNode;
    bounds: { min: Vector3; max: Vector3 };
    scale: number;
    yawOffset: number;
  }

  const load = async (scene: Scene, key: VehicleModel): Promise<Loaded> => {
    const config = VEHICLE_MODEL_REGISTRY[key];
    if (!config) throw new Error(`no registry entry for ${key}`);
    const glb = readFileSync(`public${config.url}`);
    const container = await SceneLoader.LoadAssetContainerAsync(
      `data:model/gltf-binary;base64,${glb.toString("base64")}`,
      "",
      scene,
      null,
      ".glb",
    );
    const root = new TransformNode(`test-${key}`, scene);
    const entries = container.instantiateModelsToScene(undefined, false, {
      doNotInstantiate: true,
    });
    entries.rootNodes[0].parent = root;
    root.computeWorldMatrix(true);
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const mesh of root.getChildMeshes(false)) {
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      min.minimizeInPlace(box.minimumWorld);
      max.maximizeInPlace(box.maximumWorld);
    }
    return { root, bounds: { min, max }, scale: config.scale, yawOffset: config.yawOffset };
  };

  it("seats the bar flush on every model's roof, within its footprint", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    for (const key of modelKeys) {
      const { root, bounds, scale, yawOffset } = await load(scene, key);
      const pad = measureRoofPad(root, bounds);
      const bar = computeLightBarPlacement(pad, yawOffset);

      // Flush: no gap above the roof (the visible bug), no sinking into it.
      expect(bar.position.y).toBeCloseTo(bounds.max.y, 9);
      // The measured pad is the flat top, not the whole car.
      expect(pad.maxX - pad.minX).toBeLessThan(bounds.max.x - bounds.min.x);
      expect(pad.maxZ - pad.minZ).toBeLessThan(bounds.max.z - bounds.min.z);
      // Every corner of the bar's base rests on that pad.
      expect(bar.position.x - bar.width / 2).toBeGreaterThanOrEqual(pad.minX - 1e-9);
      expect(bar.position.x + bar.width / 2).toBeLessThanOrEqual(pad.maxX + 1e-9);
      expect(bar.position.z - bar.depth / 2).toBeGreaterThanOrEqual(pad.minZ - 1e-9);
      expect(bar.position.z + bar.depth / 2).toBeLessThanOrEqual(pad.maxZ + 1e-9);
      // Believable hardware once the model reaches its in-world scale.
      expect(bar.width * scale).toBeGreaterThan(0.35);
      expect(bar.width * scale).toBeLessThan(1.2);
      expect(bar.depth * scale).toBeGreaterThan(0.1);
      root.dispose(false, false);
    }
    scene.dispose();
    engine.dispose();
  }, 120_000);

  it("lays the door livery on the real door skin, not out in the air", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    for (const key of modelKeys) {
      const { root, bounds, scale, yawOffset } = await load(scene, key);
      const { left, right } = computeLiveryPanels(root, bounds, yawOffset);
      const halfWidth = (bounds.max.x - bounds.min.x) / 2;

      // Mirrored across the body's own centre line, at the same height.
      const centerX = (bounds.min.x + bounds.max.x) / 2;
      expect(left.position.x - centerX).toBeCloseTo(-(right.position.x - centerX), 9);
      expect(left.position.y).toBeCloseTo(right.position.y, 9);
      expect(left.length).toBeCloseTo(right.length, 9);

      // The panel hugs the doors: hanging off the flank would float it in air,
      // sitting well inside would bury it in the bodywork. A decal is allowed
      // to stand a few mm proud of the widest point, and no more.
      for (const panel of [left, right]) {
        expect(Math.abs(panel.position.x)).toBeLessThanOrEqual(halfWidth + 0.015);
        expect(Math.abs(panel.position.x)).toBeGreaterThan(halfWidth * 0.8);
        // Between the wheel arches and below the glass.
        expect(panel.position.z - panel.length / 2).toBeGreaterThan(bounds.min.z);
        expect(panel.position.z + panel.length / 2).toBeLessThan(bounds.max.z);
        expect(panel.position.y + panel.height / 2).toBeLessThan(bounds.max.y);
        expect(panel.position.y - panel.height / 2).toBeGreaterThan(bounds.min.y);
        expect(panel.height * scale).toBeGreaterThan(0.25);
        expect(panel.length * scale).toBeGreaterThan(1.2);
      }
      root.dispose(false, false);
    }
    scene.dispose();
    engine.dispose();
  }, 120_000);

  it("gives every city's patrol a model whose roof can carry a bar", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    for (const mapId of [
      "nyc-upper-west-side",
      "london-south-kensington",
      "milton-keynes-oldbrook",
      "calais-coquelles",
      "tokyo-setagaya",
    ]) {
      const patrol = Array.from({ length: 40 }, (_, index) =>
        resolveTrafficVehicleAppearance({
          vehicleId: `npc-${index + 1}`,
          trafficSeed: 77,
          variant: "car",
          mapId,
        }),
      ).find((appearance) => appearance.role === "police");
      expect(patrol, `no patrol appeared on ${mapId}`).toBeTruthy();
      expect(patrol?.livery).toEqual(policeLiveryForMap(mapId));

      const { root, bounds, yawOffset } = await load(scene, patrol!.model);
      const pad = measureRoofPad(root, bounds);
      const bar = computeLightBarPlacement(pad, yawOffset);
      expect(bar.position.y).toBeCloseTo(bounds.max.y, 9);
      expect(bar.width).toBeGreaterThan(0);
      root.dispose(false, false);
    }
    scene.dispose();
    engine.dispose();
  }, 120_000);
});
