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
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import type { VehicleModel } from "./vehicleVisuals";

// Babylon 9 registers loaders as dynamic factories: the old
// `import "@babylonjs/loaders/glTF/2.0"` side effect no longer registers a
// plugin for LoadAssetContainerAsync (it silently returns no plugin, so every
// load throws and the caller falls back to procedural geometry). Register
// explicitly instead — once, lazily, on first preload.
let loadersRegistered = false;
function ensureLoadersRegistered(): void {
  if (loadersRegistered) return;
  registerBuiltInLoaders();
  loadersRegistered = true;
}

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
  ensureLoadersRegistered();
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
 * fleet; a recolourable CC-BY panel van (solid `bodywork` material) covers
 * delivery vans; a recolourable CC-BY single-deck bus (`039BE5`) covers city
 * buses, and a red Routemaster-style double-decker (LinderMedia, purchased Envato
 * licence; solid `body` material, OBJ recoloured to sensible part colours at
 * import) covers London. Scales are
 * length-matched to VEHICLE_DIMENSIONS. Most models import front-first (+Z,
 * yawOffset 0); the van imports front-along-+X, so it needs a -90° yawOffset.
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
  "delivery-van": { url: `${V}/van.glb`, bodyMaterialNames: ["bodywork"], scale: 0.85, yawOffset: -Math.PI / 2 },
  "city-bus": { url: `${V}/bus.glb`, bodyMaterialNames: ["039BE5"], scale: 0.24, yawOffset: 0 },
  "london-double-decker": { url: `${V}/london-double-decker.glb`, bodyMaterialNames: ["body"], scale: 0.0503, yawOffset: 0 },
};

/** De-duplicated list of every glb URL the registry references, for preloading. */
export function vehicleModelUrls(): string[] {
  return [
    ...new Set(
      Object.values(VEHICLE_MODEL_REGISTRY).map((config) => config.url),
    ),
  ];
}

const P = "/models/props";

/**
 * Per-prop import configuration for static environment models (gig venues + gas
 * stations). Unlike vehicles, props keep their own materials — no recolour — so
 * there is no material-name list. `scale` normalises the model to roughly its
 * on-map footprint; `yawOffset` corrects facing so the model's front lands toward
 * the road (the venue loop rotates the holder by the lane heading + this offset).
 */
export interface PropModelConfig {
  readonly url: string;
  readonly scale: number;
  readonly yawOffset: number;
}

/**
 * Maps a venue/service kind to its low-poly building glb — keyed by the
 * ServicePoint kind ("gas_station") and by GigVenueKind. Any kind absent here,
 * or whose glb has not preloaded, falls back to the procedural box in GameCanvas.
 * All CC0/CC-BY low-poly glbs live under public/models/props/ (see CREDITS.md).
 */
export const PROP_MODEL_REGISTRY: Readonly<Record<string, PropModelConfig>> = {
  // Scales derived from each glb's measured bounding box (native sizes vary
  // wildly — the diner is authored at ~300 units, the shop at ~2) then set to a
  // sensible real-world footprint per building type. yawOffset 0: the buildings
  // read from any side; exact facing/height is a playtest tweak.
  gas_station: { url: `${P}/gas-station.glb`, scale: 2.2, yawOffset: 0 },
  restaurant: { url: `${P}/restaurant.glb`, scale: 0.045, yawOffset: 0 },
  shop: { url: `${P}/shop.glb`, scale: 4, yawOffset: 0 },
  residence: { url: `${P}/residence.glb`, scale: 2.6, yawOffset: 0 },
  office: { url: `${P}/office.glb`, scale: 2.8, yawOffset: 0 },
};

/** De-duplicated list of every prop glb URL the registry references, for preload. */
export function propModelUrls(): string[] {
  return [
    ...new Set(Object.values(PROP_MODEL_REGISTRY).map((config) => config.url)),
  ];
}
