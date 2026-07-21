import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LoadAssetContainerAsync,
  Mesh,
  NullEngine,
  Scene,
} from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import { NYC_ENV_MODELS } from "../app/game/buildingCatalog";
import {
  orientMergedFacesOutward,
  windingAgreement,
} from "../app/game/buildingWinding";

// Every environment model placed through the renderer's merged-building path
// (getBuildingMaster) — the building sets and street vendors. The skinned people
// are never merged, so they're excluded.
const MERGED = NYC_ENV_MODELS.filter((m) => m.category !== "person");

describe("merged building winding", () => {
  registerBuiltInLoaders();

  // Mirrors getBuildingMaster: load, instantiate real clones, bake world matrices
  // into one merged mesh. That bake is what can leave a model inside-out.
  const mergeLikeRenderer = async (url: string) => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const buf = fs.readFileSync(path.join(process.cwd(), "public", url));
    const dataUrl = "data:model/gltf-binary;base64," + buf.toString("base64");
    const container = await LoadAssetContainerAsync(dataUrl, scene, {
      pluginExtension: ".glb",
    });
    const entries = container.instantiateModelsToScene(undefined, false, {
      doNotInstantiate: true,
    });
    const root = entries.rootNodes[0];
    root.computeWorldMatrix(true);
    const meshes = root
      .getChildMeshes(false)
      .filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
    for (const m of meshes) m.computeWorldMatrix(true);
    const master = Mesh.MergeMeshes(meshes, true, true, undefined, false, true)!;
    expect(master, url).toBeTruthy();
    return { master, scene, engine };
  };

  // The guard: after the winding fix every merged building's outward faces are
  // the ones drawn, so none render inside-out ("hollow"). Several models (the
  // brownstones, the farm house, the tenement) come out inverted from the merge
  // and rely on this fix — that inversion is the bug this test locks down.
  it.each(MERGED.map((m) => [m.id, m.url] as const))(
    "orients %s so its outward faces are drawn (not hollow)",
    async (_id, url) => {
      const { master, scene, engine } = await mergeLikeRenderer(url);

      // These low-poly models are cleanly one-sided: pre-fix a model is either
      // already correct or fully inverted, never a mix. A mixed model would mean
      // a single flip can't fix it and needs a closer look.
      const before = windingAgreement(master);
      expect(
        before.agree === 0 || before.disagree === 0,
        `${url} winding is mixed (agree=${before.agree}, disagree=${before.disagree})`,
      ).toBe(true);

      orientMergedFacesOutward(master);

      const after = windingAgreement(master);
      expect(after.agree, url).toBeGreaterThan(0);
      expect(after.disagree, url).toBe(0);

      scene.dispose();
      engine.dispose();
    },
  );
});
