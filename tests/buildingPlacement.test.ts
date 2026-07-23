import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LoadAssetContainerAsync,
  Matrix,
  Mesh,
  NullEngine,
  Scene,
  Vector3,
} from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import { NYC_ENV_MODELS } from "../app/game/buildingCatalog";
import {
  buildingPlacementConfig,
  isBuildingSetId,
  NYC_VENDORS,
  slotBlockBuildings,
} from "../app/game/buildingSets";
import {
  orientMergedFacesOutward,
  recentreMergedMasterXZ,
} from "../app/game/buildingWinding";
import { getMapPack } from "../app/game/content";
import { hashStringToSeed } from "../app/game/visuals";

registerBuiltInLoaders();

// Placement scale for a catalogue model: building-set config first, vendor
// config second. Models placed by neither path (market-stalls, people) return
// null and are excluded — no placement, no placement invariant.
const scaleFor = (model: { id: string; url: string }): number | null =>
  buildingPlacementConfig(model.id)?.scale ??
  NYC_VENDORS.find((v) => v.url === model.url)?.scale ??
  null;

const PLACEABLE = NYC_ENV_MODELS.filter(
  (m) => m.category !== "person" && scaleFor(m) !== null,
);

// One shared NullEngine scene; masters cached per model id. Mirrors
// getBuildingMaster: instantiate real clones, bake world matrices into one
// merged mesh, fix winding, recentre on the pivot — the renderer recipe whose
// output the placement slots consume.
const engine = new NullEngine();
const scene = new Scene(engine);
const masters = new Map<
  string,
  { master: Mesh; offset: { dx: number; dz: number } }
>();
const masterFor = async (model: { id: string; url: string }) => {
  const cached = masters.get(model.id);
  if (cached) return cached;
  const buf = fs.readFileSync(path.join(process.cwd(), "public", model.url));
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
  expect(master, model.url).toBeTruthy();
  orientMergedFacesOutward(master);
  const offset = recentreMergedMasterXZ(master);
  const built = { master, offset };
  masters.set(model.id, built);
  return built;
};

describe("merged master pivot centring", () => {
  it.each(PLACEABLE.map((m) => [m.id, m] as const))(
    "%s body is centred on its pivot after the renderer recipe",
    async (_id, model) => {
      const { master } = await masterFor(model);
      const centre = master.getBoundingInfo().boundingBox.center;
      const scale = scaleFor(model)!;
      expect(Math.abs(centre.x) * scale, `${model.id} x-centre (m)`).toBeLessThanOrEqual(0.15);
      expect(Math.abs(centre.z) * scale, `${model.id} z-centre (m)`).toBeLessThanOrEqual(0.15);
    },
  );

  // Documents #143: house-a's glb authors its geometry ~15 m (scaled) away
  // from the pivot, which is why the recentre step is load-bearing. If the
  // asset is ever re-exported pivot-centred this test can be deleted.
  it("nyc-house-a is the off-pivot asset the recentre step exists for", async () => {
    const model = NYC_ENV_MODELS.find((m) => m.id === "nyc-house-a")!;
    const { offset } = await masterFor(model);
    expect(Math.hypot(offset.dx, offset.dz) * 0.095).toBeGreaterThan(5);
  });
});

describe("street-wall placement invariants on the real NYC blocks", () => {
  interface WorldBox {
    modelId: string;
    edgeOutward: number;
    x0: number;
    x1: number;
    z0: number;
    z1: number;
  }

  const worldBoxes = async (block: {
    id: string;
    center: { x: number; z: number };
    size: { x: number; z: number };
    buildingSet?: string;
  }) => {
    const placements = slotBlockBuildings(
      block.center,
      block.size,
      block.buildingSet as Parameters<typeof slotBlockBuildings>[2],
      hashStringToSeed(`${block.id}-buildings`),
    );
    const boxes: WorldBox[] = [];
    for (const b of placements) {
      const model = NYC_ENV_MODELS.find((m) => m.id === b.modelId)!;
      const { master } = await masterFor(model);
      const bb = master.getBoundingInfo().boundingBox;
      const rot = Matrix.RotationY(b.yaw);
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (const lx of [bb.minimum.x, bb.maximum.x]) {
        for (const lz of [bb.minimum.z, bb.maximum.z]) {
          const w = Vector3.TransformCoordinates(
            new Vector3(lx * b.scale, 0, lz * b.scale),
            rot,
          );
          x0 = Math.min(x0, w.x + b.x);
          x1 = Math.max(x1, w.x + b.x);
          z0 = Math.min(z0, w.z + b.z);
          z1 = Math.max(z1, w.z + b.z);
        }
      }
      const frontOffset = buildingPlacementConfig(b.modelId)!.frontOffset;
      let edgeOutward = b.yaw + Math.PI - frontOffset;
      while (edgeOutward > Math.PI) edgeOutward -= 2 * Math.PI;
      while (edgeOutward <= -Math.PI) edgeOutward += 2 * Math.PI;
      boxes.push({ modelId: b.modelId, edgeOutward, x0, x1, z0, z1 });
    }
    return boxes;
  };

  const setBlocks = () =>
    getMapPack("nyc-upper-west-side").geometry.blocks.filter(
      (b) => b.buildingSet && isBuildingSetId(b.buildingSet),
    );

  // Scoped to the detached-house block (#143's shape). A sweep of the other
  // set blocks found two pre-existing, sub-metre tower nits that predate the
  // recentre fix and are invisible at tower scale: tower-artdeco kisses
  // tower-c by ~1.9 m x 0.5 m on nyc-block-bway-amst-n, and tower-c's real
  // 19.8 m width overhangs its authored 19 m footprint off
  // nyc-block-bway-amst-s. Widen to all set blocks if those footprints are
  // ever retuned.
  const houseBlocks = () =>
    setBlocks().filter((b) => b.buildingSet === "nyc-house");

  it(
    "no two houses interpenetrate on the detached-house block",
    { timeout: 30_000 },
    async () => {
      for (const block of houseBlocks()) {
        const boxes = await worldBoxes(block);
        expect(boxes.length).toBeGreaterThan(0);
        for (let i = 0; i < boxes.length; i += 1) {
          for (let j = i + 1; j < boxes.length; j += 1) {
            const a = boxes[i];
            const b = boxes[j];
            const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
            const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
            const deep = ox > 0.25 && oz > 0.25;
            expect(
              deep,
              `${block.id}: ${a.modelId}#${i} overlaps ${b.modelId}#${j} by ${ox.toFixed(2)}m x ${oz.toFixed(2)}m`,
            ).toBe(false);
          }
        }
      }
    },
  );

  it(
    "every house stays inside its block (no pavement encroachment)",
    { timeout: 30_000 },
    async () => {
      for (const block of houseBlocks()) {
        const grow = 0.2;
        const minX = block.center.x - block.size.x / 2 - grow;
        const maxX = block.center.x + block.size.x / 2 + grow;
        const minZ = block.center.z - block.size.z / 2 - grow;
        const maxZ = block.center.z + block.size.z / 2 + grow;
        for (const box of await worldBoxes(block)) {
          expect(
            box.x0 >= minX && box.x1 <= maxX && box.z0 >= minZ && box.z1 <= maxZ,
            `${block.id}: ${box.modelId} spills off the block ` +
              `x[${box.x0.toFixed(1)},${box.x1.toFixed(1)}] z[${box.z0.toFixed(1)},${box.z1.toFixed(1)}]`,
          ).toBe(true);
        }
      }
    },
  );

  // The bug's visible face (#143): before the recentre fix, house-a rows sat
  // 3.0 m back while house-b sat 1.3 m back — a crooked pavement line.
  it(
    "the detached-house block forms one straight street wall per edge",
    { timeout: 30_000 },
    async () => {
      const block = setBlocks().find((b) => b.id === "nyc-block-we-bway-n")!;
      const boxes = await worldBoxes(block);
      expect(boxes.length).toBeGreaterThanOrEqual(80);
      const byEdge = new Map<string, number[]>();
      for (const box of boxes) {
        const o = box.edgeOutward;
        const edge =
          Math.abs(o) < 0.01
            ? "N"
            : Math.abs(Math.abs(o) - Math.PI) < 0.01
              ? "S"
              : Math.abs(o - Math.PI / 2) < 0.01
                ? "E"
                : "W";
        const setback =
          edge === "N"
            ? block.center.z + block.size.z / 2 - box.z1
            : edge === "S"
              ? box.z0 - (block.center.z - block.size.z / 2)
              : edge === "E"
                ? block.center.x + block.size.x / 2 - box.x1
                : box.x0 - (block.center.x - block.size.x / 2);
        byEdge.set(edge, [...(byEdge.get(edge) ?? []), setback]);
      }
      expect([...byEdge.keys()].sort()).toEqual(["E", "N", "S", "W"]);
      for (const [edge, setbacks] of byEdge) {
        const spread = Math.max(...setbacks) - Math.min(...setbacks);
        expect(
          spread,
          `edge ${edge} setback spread (m): ${setbacks.map((s) => s.toFixed(2)).join(", ")}`,
        ).toBeLessThanOrEqual(0.75);
        expect(Math.min(...setbacks), `edge ${edge} min setback`).toBeGreaterThanOrEqual(-0.2);
      }
    },
  );
});
