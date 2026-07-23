/**
 * Storefront re-branding for the NYC street wall (issue #146).
 *
 * The building catalog carries exactly one retail model — "Pizza Corner"
 * (nyc-shop-corner.glb) — so every instanced storefront used to read as the
 * same pizzeria, whole streets of them. Rather than sourcing more assets, the
 * renderer re-brands each placed shop as one of the businesses below: the
 * baked "PIZZA" letter geometry is stripped and a fascia sign plane plus an
 * awning tint are applied per variant (storefrontMaster.ts). Placement count
 * and positions are untouched — variety, not thinning.
 *
 * Pure data + math (no Babylon/DOM) so node tests can import it directly.
 */
import { hashStringToSeed } from "./visuals";

/** Catalog id of the one retail glb the variants re-brand. */
export const STOREFRONT_MODEL_ID = "nyc-shop-corner";

export interface StorefrontVariant {
  readonly id: string;
  /** Fascia text, authored uppercase. */
  readonly signText: string;
  /** Sign background, CSS hex (DynamicTexture clear colour). */
  readonly signBg: string;
  /** Sign lettering + border, CSS hex. */
  readonly signFg: string;
  /** Awning tint (linear 0..1); null keeps the model's authored red. */
  readonly awningColor: { readonly r: number; readonly g: number; readonly b: number } | null;
}

/** Muted, night-legible NYC retail mix. Exactly one pizza remains — the model
 * is authored as a pizzeria, so that variant keeps the stock awning. */
export const STOREFRONT_VARIANTS: readonly StorefrontVariant[] = [
  { id: "pizza", signText: "PIZZA", signBg: "#efe6d2", signFg: "#9c3325", awningColor: null },
  { id: "deli", signText: "DELI & GROCERY", signBg: "#1f4030", signFg: "#efe7c8", awningColor: { r: 0.16, g: 0.34, b: 0.24 } },
  { id: "bagels", signText: "HOT BAGELS", signBg: "#f0e3c0", signFg: "#5a3a1c", awningColor: { r: 0.58, g: 0.44, b: 0.2 } },
  { id: "coffee", signText: "COFFEE", signBg: "#33261d", signFg: "#e9d8b6", awningColor: { r: 0.25, g: 0.18, b: 0.14 } },
  { id: "ramen", signText: "RAMEN", signBg: "#232328", signFg: "#d8564a", awningColor: { r: 0.17, g: 0.17, b: 0.21 } },
  { id: "tacos", signText: "TACOS", signBg: "#a34a26", signFg: "#f6e5c8", awningColor: { r: 0.66, g: 0.34, b: 0.18 } },
  { id: "burgers", signText: "BURGERS", signBg: "#e9dcc2", signFg: "#8a4a1f", awningColor: { r: 0.52, g: 0.34, b: 0.17 } },
  { id: "flowers", signText: "FLOWERS", signBg: "#4c6152", signFg: "#f0e9da", awningColor: { r: 0.36, g: 0.47, b: 0.39 } },
  { id: "books", signText: "BOOKS", signBg: "#2e3a52", signFg: "#e3d9c0", awningColor: { r: 0.21, g: 0.28, b: 0.42 } },
  { id: "pharmacy", signText: "PHARMACY", signBg: "#f0efe9", signFg: "#2a6045", awningColor: { r: 0.2, g: 0.44, b: 0.31 } },
  { id: "laundromat", signText: "LAUNDROMAT", signBg: "#e6edef", signFg: "#33566b", awningColor: { r: 0.34, g: 0.47, b: 0.56 } },
  { id: "barber", signText: "BARBER SHOP", signBg: "#eae4d8", signFg: "#a03030", awningColor: { r: 0.26, g: 0.33, b: 0.51 } },
];

/**
 * Deterministic per-placement pick keyed on rounded world coords — independent
 * of the block RNG stream, so the authored building layout stays byte-identical
 * and survives keepFraction/exclusion filtering unchanged.
 */
export function pickStorefrontVariant(x: number, z: number): StorefrontVariant {
  const seed = hashStringToSeed(`storefront:${Math.round(x)}:${Math.round(z)}`);
  return STOREFRONT_VARIANTS[seed % STOREFRONT_VARIANTS.length];
}

/** One street-face fascia rectangle, in the master-build space the renderer
 * merges in (root at origin, world matrices baked). */
export interface StorefrontSignRect {
  /** Face-normal axis. */
  readonly axis: "x" | "z";
  /** Face coordinate along that axis. */
  readonly plane: number;
  /** Which side of the model the face looks toward (sign of plane − centre). */
  readonly outward: 1 | -1;
  /** Extent along the other horizontal axis. */
  readonly alongMin: number;
  readonly alongMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

const MIN_SLAB_VERTS = 24;
const MAX_THIN_RATIO = 0.15;

/**
 * Splits the baked lettering mesh's vertex cloud into its two perpendicular
 * street-face slabs (the corner shop signs both frontages) and returns one
 * mounting rectangle per face, x-face first. Returns null when the geometry
 * doesn't look like that two-slab lettering any more (asset re-authored) —
 * callers must fall back to the unmodified model rather than guess.
 */
export function extractStorefrontSignRects(
  positions: ArrayLike<number>,
  center: { readonly x: number; readonly z: number },
): readonly [StorefrontSignRect, StorefrontSignRect] | null {
  const count = Math.floor(positions.length / 3);
  if (count < MIN_SLAB_VERTS * 2) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < count; i += 1) {
    const x = positions[i * 3];
    const z = positions[i * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  // Candidate face planes: the cloud extreme farther from the model centre on
  // each horizontal axis (the letters sit flush against the outside walls).
  const planeX = Math.abs(minX - center.x) >= Math.abs(maxX - center.x) ? minX : maxX;
  const planeZ = Math.abs(minZ - center.z) >= Math.abs(maxZ - center.z) ? minZ : maxZ;

  interface Slab {
    verts: number;
    thinMin: number;
    thinMax: number;
    alongMin: number;
    alongMax: number;
    yMin: number;
    yMax: number;
  }
  const makeSlab = (): Slab => ({
    verts: 0,
    thinMin: Infinity,
    thinMax: -Infinity,
    alongMin: Infinity,
    alongMax: -Infinity,
    yMin: Infinity,
    yMax: -Infinity,
  });
  const xSlab = makeSlab();
  const zSlab = makeSlab();
  for (let i = 0; i < count; i += 1) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const toX = Math.abs(x - planeX);
    const toZ = Math.abs(z - planeZ);
    const slab = toX <= toZ ? xSlab : zSlab;
    const thin = toX <= toZ ? x : z;
    const along = toX <= toZ ? z : x;
    slab.verts += 1;
    if (thin < slab.thinMin) slab.thinMin = thin;
    if (thin > slab.thinMax) slab.thinMax = thin;
    if (along < slab.alongMin) slab.alongMin = along;
    if (along > slab.alongMax) slab.alongMax = along;
    if (y < slab.yMin) slab.yMin = y;
    if (y > slab.yMax) slab.yMax = y;
  }

  const toRect = (
    slab: Slab,
    axis: "x" | "z",
    centreCoord: number,
  ): StorefrontSignRect | null => {
    if (slab.verts < MIN_SLAB_VERTS) return null;
    const alongSpan = slab.alongMax - slab.alongMin;
    const ySpan = slab.yMax - slab.yMin;
    const thinSpan = slab.thinMax - slab.thinMin;
    if (alongSpan <= 0 || ySpan <= 0) return null;
    if (thinSpan > alongSpan * MAX_THIN_RATIO) return null;
    const outward: 1 | -1 =
      (slab.thinMin + slab.thinMax) / 2 >= centreCoord ? 1 : -1;
    return {
      axis,
      plane: outward === 1 ? slab.thinMax : slab.thinMin,
      outward,
      alongMin: slab.alongMin,
      alongMax: slab.alongMax,
      yMin: slab.yMin,
      yMax: slab.yMax,
    };
  };

  const xRect = toRect(xSlab, "x", center.x);
  const zRect = toRect(zSlab, "z", center.z);
  if (!xRect || !zRect) return null;
  return [xRect, zRect];
}
