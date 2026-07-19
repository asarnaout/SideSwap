import { NullEngine, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { describe, expect, it } from "vitest";
import { computePlatePlacements, createVehicleMesh } from "../app/game/vehicleMeshes";
import {
  resolvePlayerVehicleAppearance,
  resolveTrafficVehicleAppearance,
  type TrafficVehicleAppearanceInput,
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
