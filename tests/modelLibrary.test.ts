import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NullEngine, Scene, LoadAssetContainerAsync } from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import { PROP_MODEL_REGISTRY } from "../app/game/modelLibrary";
import { NYC_ENV_MODELS } from "../app/game/buildingCatalog";

// Guards the Babylon 9 loader-registration path that modelLibrary.preloadModels
// depends on. The old `import "@babylonjs/loaders/glTF/2.0"` side effect did NOT
// register a plugin, so LoadAssetContainerAsync threw and every vehicle silently
// fell back to procedural geometry. If registration regresses, these fail loudly.
describe("vehicle model assets", () => {
  registerBuiltInLoaders();
  const dir = path.join(process.cwd(), "public/models/vehicles");
  // Every registered vehicle glb is texture-free (solid materials only), so the
  // headless NullEngine can parse them all and prove loader registration. (The
  // former Kenney van.glb was excluded because it referenced an external PNG that
  // 404'd and silently fell the van back to procedural; the replacement is a
  // self-contained, recolourable CC-BY van with no textures.)
  const files = ["sedan.glb", "sports.glb", "suv.glb", "bus.glb", "van.glb"];

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

    const van = await load("van.glb");
    expect(van.container.materials.some((m) => m.name === "bodywork")).toBe(true);
    van.scene.dispose();
    van.engine.dispose();
  });

  // The London double-decker is a purchased Envato asset: gitignored (absent in
  // CI), present after a local `node tools/build-london-bus.mjs` build. Validate
  // it when present — semantic `body` material the registry recolours — and skip
  // where the file is absent so CI stays green without the asset.
  const busPath = path.join(dir, "london-double-decker.glb");
  it.skipIf(!fs.existsSync(busPath))(
    "loads the local London double-decker with a recolourable body",
    async () => {
      const { container, scene, engine } = await load("london-double-decker.glb");
      expect(container.meshes.length).toBeGreaterThan(0);
      expect(container.materials.some((m) => m.name === "body")).toBe(true);
      scene.dispose();
      engine.dispose();
    },
  );
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
});

describe("prop (environment building) model assets", () => {
  registerBuiltInLoaders();
  const dir = path.join(process.cwd(), "public/models/props");
  const files = Object.values(PROP_MODEL_REGISTRY).map((config) =>
    config.url.replace("/models/props/", ""),
  );

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

  // Every venue/service kind the render loops look up must have a registry entry,
  // else it silently falls back to a procedural box forever.
  it("registers a model for every authored gig-venue + service kind", () => {
    for (const kind of [
      "gas_station",
      "restaurant",
      "shop",
      "residence",
      "office",
    ]) {
      expect(PROP_MODEL_REGISTRY[kind], kind).toBeDefined();
    }
  });

  // Each committed glb must parse as real geometry (self-contained, no external
  // textures), so preloadModels loads it instead of silently 404ing to a box.
  it.each(files)("ships a parseable low-poly glb: %s", async (file) => {
    const { container, scene, engine } = await load(file);
    expect(container.meshes.length).toBeGreaterThan(0);
    scene.dispose();
    engine.dispose();
  });
});

// The NYC Nightfall overhaul adds a catalogue of CC0/CC-BY environment models
// (towers, brownstones, houses, bodega, vendors, extra pedestrians) that later
// phases place via the instanced building-set system. Guard the catalogue here:
// every committed glb must exist and parse, and every CC-BY entry must ship its
// required attribution string (else a licence obligation silently goes unmet).
describe("NYC environment model catalogue", () => {
  registerBuiltInLoaders();

  const load = async (url: string) => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const buf = fs.readFileSync(path.join(process.cwd(), "public", url));
    const dataUrl = "data:model/gltf-binary;base64," + buf.toString("base64");
    const container = await LoadAssetContainerAsync(dataUrl, scene, {
      pluginExtension: ".glb",
    });
    return { container, scene, engine };
  };

  it("gives every CC-BY model a required attribution string (and CC0 none)", () => {
    for (const model of NYC_ENV_MODELS) {
      if (model.license === "CC-BY 3.0") {
        expect(model.attribution, model.id).toBeTruthy();
      } else {
        expect(model.attribution, model.id).toBeUndefined();
      }
    }
  });

  it.each(NYC_ENV_MODELS.map((m) => [m.id, m.url] as const))(
    "ships a parseable glb for %s",
    async (_id, url) => {
      const { container, scene, engine } = await load(url);
      expect(container.meshes.length).toBeGreaterThan(0);
      scene.dispose();
      engine.dispose();
    },
  );
});
