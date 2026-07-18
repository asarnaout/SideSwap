import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NullEngine, Scene, LoadAssetContainerAsync } from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";

// Guards the Babylon 9 loader-registration path that modelLibrary.preloadModels
// depends on. The old `import "@babylonjs/loaders/glTF/2.0"` side effect did NOT
// register a plugin, so LoadAssetContainerAsync threw and every vehicle silently
// fell back to procedural geometry. If registration regresses, these fail loudly.
describe("vehicle model assets", () => {
  registerBuiltInLoaders();
  const dir = path.join(process.cwd(), "public/models/vehicles");
  // van.glb is excluded: it carries an embedded PNG texture that the headless
  // NullEngine cannot decode (no GPU/image decoder). It loads fine in-browser;
  // the untextured models below already prove loader registration + parsing.
  const files = ["sedan.glb", "sports.glb", "suv.glb", "bus.glb"];

  const load = async (file: string) => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const buf = fs.readFileSync(path.join(dir, file));
    const dataUrl = "data:model/gltf-binary;base64," + buf.toString("base64");
    const container = await LoadAssetContainerAsync(dataUrl, scene, {
      pluginExtension: ".glb",
    });
    return { container, scene, engine };
  };

  it.each(files)("registers a loader and parses %s", async (file) => {
    const { container, scene, engine } = await load(file);
    expect(container.meshes.length).toBeGreaterThan(0);
    scene.dispose();
    engine.dispose();
  });

  it("exposes the recolourable solid body materials the registry targets", async () => {
    const sedan = await load("sedan.glb");
    expect(sedan.container.materials.some((m) => m.name === "Blue")).toBe(true);
    sedan.scene.dispose();
    sedan.engine.dispose();

    const bus = await load("bus.glb");
    expect(bus.container.materials.some((m) => m.name === "039BE5")).toBe(true);
    bus.scene.dispose();
    bus.engine.dispose();
  });
});

describe("character model assets", () => {
  registerBuiltInLoaders();
  const dir = path.join(process.cwd(), "public/models/characters");

  const load = async (file: string) => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const buf = fs.readFileSync(path.join(dir, file));
    const dataUrl = "data:model/gltf-binary;base64," + buf.toString("base64");
    const container = await LoadAssetContainerAsync(dataUrl, scene, {
      pluginExtension: ".glb",
    });
    return { container, scene, engine };
  };

  // Pedestrians must be rigged AND carry a Walk clip, and expose the "Shirt"
  // material the recolour targets — the whole point of Phase 3 over cylinders.
  it.each(["person-a.glb", "person-b.glb", "person-c.glb"])(
    "loads %s as a rigged character with a Walk animation",
    async (file) => {
      const { container, scene, engine } = await load(file);
      expect(container.skeletons.length).toBeGreaterThan(0);
      expect(
        container.animationGroups.some((group) => /walk/i.test(group.name)),
      ).toBe(true);
      expect(container.materials.some((m) => m.name === "Shirt")).toBe(true);
      scene.dispose();
      engine.dispose();
    },
  );

  it("loads the bicycle prop", async () => {
    const { container, scene, engine } = await load("bicycle.glb");
    expect(container.meshes.length).toBeGreaterThan(0);
    scene.dispose();
    engine.dispose();
  });

  // Self-contained cyclist (rider + bike). Uses KHR_mesh_quantization, so this
  // also guards that the loader dequantizes it.
  it("loads the self-contained cyclist model", async () => {
    const { container, scene, engine } = await load("cyclist.glb");
    expect(container.meshes.length).toBeGreaterThan(0);
    scene.dispose();
    engine.dispose();
  });
});
