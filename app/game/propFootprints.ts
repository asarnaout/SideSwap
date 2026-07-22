/**
 * Measured world-space footprints of the venue/service glb models, in the
 * frame the game places them in: a holder rotated by the model's yawOffset
 * (heading 0), model scale applied, strip-pattern meshes removed — so +z runs
 * along the facade and the road lies on the -x side. Measured once under
 * NullEngine from the real glbs (the same technique tests/vehicleMeshes.test.ts
 * uses); re-measure and update if a model, its scale, or its yawOffset in
 * PROP_MODEL_REGISTRY changes — tests/staticColliders.test.ts pins the collider
 * consequences.
 *
 * These are what make a venue's collision exactly the building you can see,
 * instead of its (much larger) authored fallback footprint — which is what
 * used to stop the car an entire pavement short of a facade.
 */

export interface PropModelFootprint {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export const PROP_MODEL_FOOTPRINTS_M: Readonly<
  Record<string, PropModelFootprint>
> = {
  restaurant: { minX: -5.23, maxX: 8.46, minZ: -5.82, maxZ: 10.04 },
  "restaurant-pizzeria": { minX: -5.85, maxX: 4.87, minZ: -5.79, maxZ: 4.84 },
  shop: { minX: -4.0, maxX: 4.0, minZ: -4.0, maxZ: 4.0 },
  residence: { minX: -5.45, maxX: 4.61, minZ: -3.32, maxZ: 3.33 },
  office: { minX: -6.15, maxX: 6.15, minZ: -6.59, maxZ: 6.59 },
};

/** Half-extent of the gas station's square base slab (its drivable lot). */
export const GAS_STATION_SLAB_HALF_M = 11.64;

/**
 * The station's solid furniture, same measured frame as above: the shop
 * (convenience store, with the road sign on its roof) and the two pump
 * islands — each island box spans its two pump stands, their kerb and the
 * canopy pillars at the ends, so one box per island is the whole obstacle.
 * The canopy roof itself is far above the car and stays open under.
 */
export const GAS_STATION_SOLIDS_M: readonly ({
  readonly id: string;
} & PropModelFootprint)[] = [
  { id: "shop", minX: 6.69, maxX: 10.97, minZ: -0.7, maxZ: 4.78 },
  { id: "pumps-a", minX: -1.14, maxX: 5.33, minZ: -1.93, maxZ: -0.98 },
  { id: "pumps-b", minX: -1.14, maxX: 5.33, minZ: -9.33, maxZ: -8.37 },
];
