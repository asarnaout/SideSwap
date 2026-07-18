/**
 * Async glTF model library (vehicles now; characters follow in a later phase).
 *
 * Models are preloaded into per-scene {@link AssetContainer}s during setup, then
 * instantiated synchronously on demand. This lets the existing synchronous
 * vehicle-build path (`createVehicleMesh`) stay synchronous: it asks whether a
 * model is ready and, if so, instantiates it; otherwise it falls back to the
 * procedural geometry. A slow or failed load therefore never breaks the scene —
 * the vehicle simply stays on its procedural fallback and upgrades in place once
 * the container finishes loading.
 *
 * Containers are keyed by URL (not by VehicleModel) so several models that share
 * one file — e.g. the sedan reused for the hatch and the recoloured taxi — load
 * that file only once.
 */
import {
  AssetContainer,
  InstantiatedEntries,
  LoadAssetContainerAsync,
  Scene,
} from "@babylonjs/core";
// Side-effect import: registers the glTF 2.0 loader so LoadAssetContainerAsync
// can parse our .glb assets. We only author glTF 2.0, so avoid pulling in 1.0.
import "@babylonjs/loaders/glTF/2.0";
import type { VehicleModel } from "./vehicleVisuals";

const CONTAINERS_BY_SCENE = new WeakMap<Scene, Map<string, AssetContainer>>();

function containersFor(scene: Scene): Map<string, AssetContainer> {
  let map = CONTAINERS_BY_SCENE.get(scene);
  if (!map) {
    map = new Map();
    CONTAINERS_BY_SCENE.set(scene, map);
  }
  return map;
}

/**
 * Loads every (de-duplicated) URL into the per-scene container cache. Failures
 * are logged and skipped so a missing or broken asset just leaves the affected
 * models on their procedural fallback. Resolves once all attempts have settled.
 */
export async function preloadModels(
  scene: Scene,
  urls: readonly string[],
): Promise<void> {
  const map = containersFor(scene);
  await Promise.all(
    [...new Set(urls)].map(async (url) => {
      if (map.has(url)) return;
      try {
        const container = await LoadAssetContainerAsync(url, scene);
        if (scene.isDisposed) {
          container.dispose();
          return;
        }
        map.set(url, container);
      } catch (error) {
        console.warn(`[modelLibrary] failed to load ${url}`, error);
      }
    }),
  );
}

export function isModelReady(scene: Scene, url: string): boolean {
  return CONTAINERS_BY_SCENE.get(scene)?.has(url) ?? false;
}

/**
 * Instantiates a preloaded model as independent geometry clones. Materials are
 * NOT cloned here (`cloneMaterials: false`): the caller replaces each mesh's
 * material with its own scene-consistent StandardMaterial (recoloured to the
 * vehicle's paint), so the shared source materials/textures on the container
 * stay untouched. `doNotInstantiate: true` yields real clones rather than
 * InstancedMeshes, which is required because InstancedMeshes cannot carry a
 * per-vehicle material override. Returns null when the model is not loaded,
 * signalling the caller to fall back to procedural geometry.
 */
export function instantiateModel(
  scene: Scene,
  url: string,
): InstantiatedEntries | null {
  const container = CONTAINERS_BY_SCENE.get(scene)?.get(url);
  if (!container) return null;
  return container.instantiateModelsToScene(undefined, false, {
    doNotInstantiate: true,
  });
}

export function disposeModels(scene: Scene): void {
  const map = CONTAINERS_BY_SCENE.get(scene);
  if (!map) return;
  for (const container of map.values()) container.dispose();
  map.clear();
  CONTAINERS_BY_SCENE.delete(scene);
}

/**
 * Per-model import configuration. `bodyMaterialNames` lists the glTF material(s)
 * whose colour is replaced by the vehicle's paint (empty ⇒ keep the model's own
 * materials, e.g. the textured van). `scale` is a uniform factor chosen so the
 * model's length matches the SideSwap vehicle it stands in for; `yawOffset`
 * corrects the facing if the glTF import lands the model's front off +Z.
 */
export interface VehicleModelConfig {
  readonly url: string;
  readonly bodyMaterialNames: readonly string[];
  readonly scale: number;
  readonly yawOffset: number;
}

const V = "/models/vehicles";

/**
 * Maps each VehicleModel onto a CC0/CC-BY low-poly glb. The recolourable
 * Quaternius cars (CC0, solid `Blue`/`White` body material) cover the passenger
 * fleet; the Kenney van keeps its own texture; the recolourable bus stands in
 * for city buses. `london-double-decker` is intentionally absent so it keeps its
 * recognisable procedural two-storey fallback (no CC0/CC-BY glb was available).
 * Scales are length-matched to VEHICLE_DIMENSIONS; the Quaternius cars import
 * front-first (+Z), so yawOffset stays 0 unless a playtest shows otherwise.
 */
export const VEHICLE_MODEL_REGISTRY: Partial<
  Record<VehicleModel, VehicleModelConfig>
> = {
  "electric-fastback": { url: `${V}/sedan.glb`, bodyMaterialNames: ["Blue"], scale: 1.08, yawOffset: 0 },
  "compact-hatch": { url: `${V}/sedan.glb`, bodyMaterialNames: ["Blue"], scale: 0.95, yawOffset: 0 },
  "sport-sedan": { url: `${V}/sports.glb`, bodyMaterialNames: ["White"], scale: 1.15, yawOffset: 0 },
  "urban-crossover": { url: `${V}/suv.glb`, bodyMaterialNames: ["White"], scale: 1.03, yawOffset: 0 },
  "sport-wagon": { url: `${V}/suv.glb`, bodyMaterialNames: ["White"], scale: 1.06, yawOffset: 0 },
  "electric-taxi": { url: `${V}/sedan.glb`, bodyMaterialNames: ["Blue"], scale: 1.09, yawOffset: 0 },
  "delivery-van": { url: `${V}/van.glb`, bodyMaterialNames: [], scale: 1.59, yawOffset: 0 },
  "city-bus": { url: `${V}/bus.glb`, bodyMaterialNames: ["039BE5"], scale: 0.24, yawOffset: 0 },
};

/** De-duplicated list of every glb URL the registry references, for preloading. */
export function vehicleModelUrls(): string[] {
  return [
    ...new Set(
      Object.values(VEHICLE_MODEL_REGISTRY).map((config) => config.url),
    ),
  ];
}
