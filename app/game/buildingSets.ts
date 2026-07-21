/**
 * Building-set zoning + placement math for the NYC overhaul (Phase 2/3).
 *
 * A `ProceduralBlock` may name a `buildingSet`; each set is a list of catalogue
 * models (see {@link ./buildingCatalog}) with a per-model placement config
 * (scale + ground offset, derived from each glb's measured native bounding box).
 * {@link slotBlockBuildings} lays a set's models around a block's perimeter as a
 * street wall facing the surrounding roads — pure and deterministic, so the
 * renderer just instantiates what it returns and the layout is unit-testable.
 *
 * Renderer-agnostic (no Babylon imports): GameCanvas instantiates GPU instances
 * (`instantiateModelInstanced`) at the positions/rotations produced here.
 */
import { NYC_ENV_MODELS } from "./buildingCatalog";
import { seededUnit, type VisualPoint } from "./visuals";

/** Per-model placement: uniform scale + ground offset + post-scale footprint. */
export interface BuildingPlacementConfig {
  /** Uniform scale that normalises the glb to a real-world footprint. */
  readonly scale: number;
  /** Y offset (m) that sits the model's base on the ground (= -nativeMinY·scale). */
  readonly groundY: number;
  /** Post-scale footprint (max of width/depth, m) used to space the street wall. */
  readonly footprintM: number;
  /**
   * Facing correction (radians) added to the holder yaw. The instancing path
   * rotates a building so its front faces the street; models whose authored
   * front is not on local -Z (the glTF-loader-flipped default) set this.
   */
  readonly frontOffset: number;
}

// Scales/ground offsets derived from each glb's native bounds (see tools note in
// buildingCatalog): Kenney towers are authored ~1 unit, the art-deco tower ~147
// units, the houses ~100+ units — so scales span two orders of magnitude. Ground
// offsets sit each base on y=0. Footprints are the post-scale plan size used to
// space the street wall. frontOffset is tuned per model from in-game captures.
const PLACEMENTS: Record<string, BuildingPlacementConfig> = {
  // Downtown towers
  "nyc-tower-a": { scale: 13, groundY: 0, footprintM: 16, frontOffset: 0 },
  "nyc-tower-b": { scale: 12, groundY: 0, footprintM: 14, frontOffset: 0 },
  "nyc-tower-c": { scale: 16, groundY: 0, footprintM: 19, frontOffset: 0 },
  "nyc-tower-artdeco": { scale: 0.15, groundY: 0.22, footprintM: 22, frontOffset: 0 },
  "nyc-tower-spire": { scale: 17, groundY: 29.2, footprintM: 12, frontOffset: 0 },
  // Mid-rise
  "nyc-midrise-a": { scale: 7, groundY: 0, footprintM: 9, frontOffset: 0 },
  "nyc-midrise-b": { scale: 8, groundY: 0, footprintM: 18, frontOffset: 0 },
  "nyc-midrise-low": { scale: 9, groundY: 0, footprintM: 6, frontOffset: 0 },
  // Brownstone / rowhouse (scaled by width so heights vary for a real rowhouse run)
  // These low-poly kits author their facade (windows/awning/fire escape) on
  // local +Z, not the -Z the slotting assumes — so they need a half-turn to
  // face the street (verified per-model from a 4-side render).
  "nyc-brownstone-a": { scale: 5.5, groundY: 0, footprintM: 11, frontOffset: Math.PI },
  "nyc-brownstone-b": { scale: 5.5, groundY: 0, footprintM: 11, frontOffset: Math.PI },
  "nyc-brownstone-c": { scale: 5.5, groundY: 0, footprintM: 11, frontOffset: Math.PI },
  "nyc-brownstone-d": { scale: 5.5, groundY: 0, footprintM: 11, frontOffset: Math.PI },
  "nyc-tenement": { scale: 1.1, groundY: 0, footprintM: 12, frontOffset: Math.PI },
  // Detached houses
  // house-a's door is on local -Z (already faces the street); house-b's is on +Z.
  "nyc-house-a": { scale: 0.095, groundY: 0.11, footprintM: 11, frontOffset: 0 },
  "nyc-house-b": { scale: 0.44, groundY: 0, footprintM: 11, frontOffset: Math.PI },
  // Ground-floor retail (storefront on local +Z)
  "nyc-shop-corner": { scale: 7.5, groundY: 0, footprintM: 10, frontOffset: Math.PI },
};

export type BuildingSetId =
  | "nyc-downtown"
  | "nyc-midrise"
  | "nyc-brownstone"
  | "nyc-house"
  | "nyc-shop";

/** Which catalogue models make up each zone's street wall. */
const SETS: Record<BuildingSetId, readonly string[]> = {
  "nyc-downtown": [
    "nyc-tower-a", "nyc-tower-b", "nyc-tower-c", "nyc-tower-artdeco",
    "nyc-tower-spire", "nyc-midrise-b",
  ],
  "nyc-midrise": [
    "nyc-midrise-a", "nyc-midrise-b", "nyc-midrise-low", "nyc-tenement",
    "nyc-tower-a", "nyc-shop-corner",
  ],
  "nyc-brownstone": [
    "nyc-brownstone-a", "nyc-brownstone-b", "nyc-brownstone-c",
    "nyc-brownstone-d", "nyc-tenement",
  ],
  "nyc-house": ["nyc-house-a", "nyc-house-b"],
  "nyc-shop": ["nyc-shop-corner", "nyc-brownstone-a", "nyc-tenement"],
};

const URL_BY_ID = new Map(NYC_ENV_MODELS.map((m) => [m.id, m.url]));

export const ALL_BUILDING_SET_IDS = Object.keys(SETS) as BuildingSetId[];

export function isBuildingSetId(id: string): id is BuildingSetId {
  return id in SETS;
}

/** Model ids that make up a set's street wall (for tests / tooling). */
export function buildingSetModelIds(setId: BuildingSetId): readonly string[] {
  return SETS[setId];
}

/**
 * Set-referenced model ids that lack a catalogue URL or a placement config —
 * a typo guard: any non-empty result would silently drop that building.
 */
export function missingBuildingConfigs(): string[] {
  const missing = new Set<string>();
  for (const ids of Object.values(SETS)) {
    for (const id of ids) {
      if (!URL_BY_ID.has(id) || !PLACEMENTS[id]) missing.add(id);
    }
  }
  return [...missing];
}

/** A street-life prop (vendor cart) placed on the sidewalk, instanced like a
 * building. Scale/groundY derived from each glb's measured native bounds. */
export interface StreetPropConfig {
  readonly url: string;
  readonly scale: number;
  readonly groundY: number;
  /** Post-scale footprint (m) — used to keep vendors clear of each other. */
  readonly footprintM: number;
}

const VENDOR_CONFIGS: Record<string, Omit<StreetPropConfig, "url">> = {
  "vendor-stand": { scale: 2.1, groundY: 0, footprintM: 2.5 },
  "vendor-cart": { scale: 2.4, groundY: 0, footprintM: 2.2 },
  "vendor-food": { scale: 0.8, groundY: 1.2, footprintM: 3.6 },
};

/** Light street-vendor carts placed along the sidewalks (market-stalls is left
 * out here — it's a heavy cluster, reserved for the odd hero spot). */
export const NYC_VENDORS: readonly StreetPropConfig[] = Object.entries(
  VENDOR_CONFIGS,
)
  .map(([id, cfg]) => {
    const url = URL_BY_ID.get(id);
    return url ? { url, ...cfg } : null;
  })
  .filter((v): v is StreetPropConfig => v !== null);

export function nycVendorUrls(): string[] {
  return NYC_VENDORS.map((v) => v.url);
}

/** De-duplicated glb URLs referenced by the given sets (for map-scoped preload). */
export function buildingSetUrls(setIds: readonly BuildingSetId[]): string[] {
  const urls = new Set<string>();
  for (const id of setIds) {
    for (const modelId of SETS[id]) {
      const url = URL_BY_ID.get(modelId);
      if (url) urls.add(url);
    }
  }
  return [...urls];
}

/** A single placed building instance the renderer should instantiate. */
export interface PlacedBuilding {
  readonly modelId: string;
  readonly url: string;
  readonly x: number;
  readonly z: number;
  /** Holder yaw (already folds in facing-the-street + the model's frontOffset). */
  readonly yaw: number;
  readonly scale: number;
  readonly groundY: number;
}

interface Edge {
  /** Outward street direction as a heading atan2(dx,dz): +Z=0, +X=π/2. */
  readonly outward: number;
  /** Fixed coordinate of the edge line + which axis it runs along. */
  readonly runAxis: "x" | "z";
  readonly runStart: number;
  readonly runEnd: number;
  readonly fixed: number;
  /** Unit inward direction (into the block) as (dx,dz). */
  readonly inX: number;
  readonly inZ: number;
}

const GAP_M = 1.6;

/**
 * Lays a set's models around a block's perimeter as a street wall: buildings hug
 * each edge, inset so their front sits at the block edge and faces the road.
 * Deterministic in `seed`. N/S edges run full width; E/W edges are trimmed by a
 * building's reach at each end so corners don't double up.
 */
export function slotBlockBuildings(
  center: VisualPoint,
  size: VisualPoint,
  setId: BuildingSetId,
  seed: number,
  /** Fraction of the street wall to keep (1 = full). Weak devices thin it for
   * frame rate; deterministic so the same buildings survive each load. */
  keepFraction = 1,
): PlacedBuilding[] {
  const models = SETS[setId]
    .map((id) => ({ id, url: URL_BY_ID.get(id), cfg: PLACEMENTS[id] }))
    .filter((m): m is { id: string; url: string; cfg: BuildingPlacementConfig } =>
      Boolean(m.url && m.cfg),
    );
  if (!models.length) return [];
  const rng = seededUnit(seed);
  const halfW = size.x / 2;
  const halfD = size.z / 2;
  const maxFoot = Math.max(...models.map((m) => m.cfg.footprintM));

  const edges: Edge[] = [
    // North (+Z)
    { outward: 0, runAxis: "x", runStart: center.x - halfW, runEnd: center.x + halfW, fixed: center.z + halfD, inX: 0, inZ: -1 },
    // South (-Z)
    { outward: Math.PI, runAxis: "x", runStart: center.x - halfW, runEnd: center.x + halfW, fixed: center.z - halfD, inX: 0, inZ: 1 },
    // East (+X), trimmed so N/S corner buildings own the corners
    { outward: Math.PI / 2, runAxis: "z", runStart: center.z - halfD + maxFoot, runEnd: center.z + halfD - maxFoot, fixed: center.x + halfW, inX: -1, inZ: 0 },
    // West (-X)
    { outward: -Math.PI / 2, runAxis: "z", runStart: center.z - halfD + maxFoot, runEnd: center.z + halfD - maxFoot, fixed: center.x - halfW, inX: 1, inZ: 0 },
  ];

  const placed: PlacedBuilding[] = [];
  let slot = 0;
  for (const edge of edges) {
    let cursor = edge.runStart;
    // Guard against absurd loops on degenerate blocks.
    let guard = 0;
    while (cursor < edge.runEnd && guard++ < 256) {
      const model = models[Math.floor(rng() * models.length)];
      const foot = model.cfg.footprintM;
      const along = cursor + foot / 2;
      if (along + foot / 2 > edge.runEnd + 0.01) break;
      // Thin the wall on weak devices: advance the cursor regardless so spacing
      // stays stable, but skip this slot when it falls outside keepFraction.
      const keep =
        keepFraction >= 1 ||
        ((slot * 2654435761) >>> 0) / 4294967296 < keepFraction;
      slot += 1;
      if (keep) {
        const inset = foot / 2;
        const x = edge.runAxis === "x" ? along : edge.fixed + edge.inX * inset;
        const z = edge.runAxis === "z" ? along : edge.fixed + edge.inZ * inset;
        // Front is on local -Z (glTF-loader flip); front world dir = yaw+π, so to
        // face outward `edge.outward` set yaw = outward - π (+ per-model offset).
        const yaw = edge.outward - Math.PI + model.cfg.frontOffset;
        placed.push({ modelId: model.id, url: model.url, x, z, yaw, scale: model.cfg.scale, groundY: model.cfg.groundY });
      }
      cursor = along + foot / 2 + GAP_M;
    }
  }
  return placed;
}
