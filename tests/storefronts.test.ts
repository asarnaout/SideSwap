import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LoadAssetContainerAsync,
  Mesh,
  MultiMaterial,
  NullEngine,
  Scene,
  StandardMaterial,
  Vector3,
  VertexBuffer,
} from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import { NYC_ENV_MODELS } from "../app/game/buildingCatalog";
import { isBuildingSetId, slotBlockBuildings } from "../app/game/buildingSets";
import { getMapPack } from "../app/game/content";
import { assembleStorefrontVariantMaster } from "../app/game/storefrontMaster";
import {
  extractStorefrontSignRects,
  pickStorefrontVariant,
  STOREFRONT_MODEL_ID,
  STOREFRONT_VARIANTS,
} from "../app/game/storefronts";
import { hashStringToSeed } from "../app/game/visuals";

registerBuiltInLoaders();

// Mirrors getStorefrontMaster's instantiate step (buildingWinding.test.ts does
// the same for the plain merge): real clones with world matrices computed,
// ready either for slab extraction or for assembleStorefrontVariantMaster.
const loadShopMeshes = async () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const url = NYC_ENV_MODELS.find((m) => m.id === STOREFRONT_MODEL_ID)!.url;
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
  return { meshes, scene, engine };
};

const modelCentre = (meshes: Mesh[]) => {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const mesh of meshes) {
    for (const corner of mesh.getBoundingInfo().boundingBox.vectorsWorld) {
      min.minimizeInPlace(corner);
      max.maximizeInPlace(corner);
    }
  }
  return { x: (min.x + max.x) / 2, z: (min.z + max.z) / 2 };
};

const letteringWorldPositions = (meshes: Mesh[]) => {
  const lettering = meshes.find((m) => m.material?.name === "white");
  expect(lettering, "shop glb should carry the baked lettering").toBeTruthy();
  const local = lettering!.getVerticesData(VertexBuffer.PositionKind)!;
  const world = lettering!.getWorldMatrix();
  const positions: number[] = [];
  for (let i = 0; i + 2 < local.length; i += 3) {
    const p = Vector3.TransformCoordinates(
      new Vector3(local[i], local[i + 1], local[i + 2]),
      world,
    );
    positions.push(p.x, p.y, p.z);
  }
  return positions;
};

describe("storefront variant table", () => {
  it("is a broad, well-formed retail mix with exactly one pizzeria", () => {
    expect(STOREFRONT_VARIANTS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(STOREFRONT_VARIANTS.map((v) => v.id)).size).toBe(
      STOREFRONT_VARIANTS.length,
    );
    expect(new Set(STOREFRONT_VARIANTS.map((v) => v.signText)).size).toBe(
      STOREFRONT_VARIANTS.length,
    );
    const pizzas = STOREFRONT_VARIANTS.filter((v) => /pizza/i.test(v.signText));
    expect(pizzas).toHaveLength(1);
    // The model is authored as a pizzeria — that variant keeps the stock awning.
    expect(pizzas[0].awningColor).toBeNull();
    for (const v of STOREFRONT_VARIANTS) {
      expect(v.signBg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(v.signFg).toMatch(/^#[0-9a-f]{6}$/i);
      if (v.awningColor) {
        for (const c of [v.awningColor.r, v.awningColor.g, v.awningColor.b]) {
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("pickStorefrontVariant", () => {
  it("is deterministic and keyed on rounded coordinates", () => {
    expect(pickStorefrontVariant(120, -340).id).toBe(
      pickStorefrontVariant(120, -340).id,
    );
    expect(pickStorefrontVariant(1.4, 2.4).id).toBe(
      pickStorefrontVariant(0.6, 1.6).id,
    );
  });

  it("spreads picks across the table rather than clumping", () => {
    const ids = new Set<string>();
    for (let x = 0; x < 100; x += 10) {
      for (let z = 0; z < 60; z += 10) {
        ids.add(pickStorefrontVariant(x, z).id);
      }
    }
    expect(ids.size).toBeGreaterThanOrEqual(6);
  });
});

describe("extractStorefrontSignRects", () => {
  it("finds the two street-face fascia rects on the real glb", async () => {
    const { meshes, scene, engine } = await loadShopMeshes();
    const rects = extractStorefrontSignRects(
      letteringWorldPositions(meshes),
      modelCentre(meshes),
    );
    expect(rects).not.toBeNull();
    const [xRect, zRect] = rects!;
    expect(xRect.axis).toBe("x");
    expect(zRect.axis).toBe("z");
    // Measured against the current asset: lettering slabs flush against the
    // -x and +z walls, fascia band just above the awning.
    expect(xRect.plane).toBeGreaterThanOrEqual(-0.7);
    expect(xRect.plane).toBeLessThanOrEqual(-0.55);
    expect(xRect.outward).toBe(-1);
    expect(zRect.plane).toBeGreaterThanOrEqual(0.55);
    expect(zRect.plane).toBeLessThanOrEqual(0.7);
    expect(zRect.outward).toBe(1);
    const centre = modelCentre(meshes);
    for (const rect of rects!) {
      expect(rect.yMin).toBeGreaterThanOrEqual(0.85);
      expect(rect.yMax).toBeLessThanOrEqual(1.05);
      const ySpan = rect.yMax - rect.yMin;
      expect(ySpan).toBeGreaterThanOrEqual(0.08);
      expect(ySpan).toBeLessThanOrEqual(0.2);
      const along = rect.alongMax - rect.alongMin;
      expect(along).toBeGreaterThanOrEqual(0.3);
      expect(along).toBeLessThanOrEqual(0.6);
      const centreCoord = rect.axis === "x" ? centre.x : centre.z;
      expect(Math.sign(rect.plane - centreCoord)).toBe(rect.outward);
    }
    scene.dispose();
    engine.dispose();
  });

  it("rejects a single-slab cloud (asset-changed guard)", () => {
    const positions: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      positions.push(1, 0.9 + (i % 5) * 0.01, (i % 10) * 0.05);
    }
    expect(
      extractStorefrontSignRects(positions, { x: 0, z: 0 }),
    ).toBeNull();
  });
});

describe("street mix on the real NYC map", () => {
  it("brands the placed shops as several distinct businesses", () => {
    const pack = getMapPack("nyc-upper-west-side");
    const ids: string[] = [];
    for (const block of pack.geometry.blocks) {
      const setId = block.buildingSet;
      if (!setId || !isBuildingSetId(setId)) continue;
      const placements = slotBlockBuildings(
        block.center,
        block.size,
        setId,
        hashStringToSeed(`${block.id}-buildings`),
      );
      for (const b of placements) {
        if (b.modelId !== STOREFRONT_MODEL_ID) continue;
        ids.push(pickStorefrontVariant(b.x, b.z).id);
      }
    }
    // The issue was a street of identical pizzerias: there must be a healthy
    // number of shops (variety, not thinning) and a real mix among them.
    expect(ids.length).toBeGreaterThanOrEqual(10);
    const distinct = new Set(ids);
    expect(distinct.size).toBeGreaterThanOrEqual(6);
    for (const id of distinct) {
      const share = ids.filter((v) => v === id).length / ids.length;
      expect(share, `variant ${id} dominates the street wall`).toBeLessThanOrEqual(0.5);
    }
  });
});

describe("assembleStorefrontVariantMaster", () => {
  it("merges a re-branded master: lettering gone, sign in, awning tinted", async () => {
    const { meshes, scene, engine } = await loadShopMeshes();
    const deli = STOREFRONT_VARIANTS.find((v) => v.id === "deli")!;
    const master = assembleStorefrontVariantMaster(
      scene,
      meshes,
      deli,
      new StandardMaterial("sign-test", scene),
    );
    // A null here is the silent sideOrientation trap: a fresh plane whose
    // orientation differs from the glTF meshes makes MergeMeshes refuse.
    expect(master).not.toBeNull();
    expect(master!.material).toBeInstanceOf(MultiMaterial);
    const names = (master!.material as MultiMaterial).subMaterials.map(
      (m) => m?.name,
    );
    expect(names).toContain("sign-test");
    expect(names).toContain("nyc-shop-awning-deli");
    expect(names).not.toContain("white");
    expect(names).not.toContain("red");
    expect(master!.getVerticesData(VertexBuffer.UVKind)).toBeTruthy();
    expect(master!.subMeshes.length).toBeGreaterThanOrEqual(9);
    scene.dispose();
    engine.dispose();
  });

  it("keeps the authored red awning for the pizza variant", async () => {
    const { meshes, scene, engine } = await loadShopMeshes();
    const pizza = STOREFRONT_VARIANTS.find((v) => v.awningColor === null)!;
    const master = assembleStorefrontVariantMaster(
      scene,
      meshes,
      pizza,
      new StandardMaterial("sign-test", scene),
    );
    expect(master).not.toBeNull();
    const names = (master!.material as MultiMaterial).subMaterials.map(
      (m) => m?.name,
    );
    expect(names).toContain("red");
    expect(names).not.toContain("white");
    scene.dispose();
    engine.dispose();
  });
});
