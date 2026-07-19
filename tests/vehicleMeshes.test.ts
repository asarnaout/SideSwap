import { NullEngine, Scene, TransformNode } from "@babylonjs/core";
import { describe, expect, it } from "vitest";
import { createVehicleMesh } from "../app/game/vehicleMeshes";
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
