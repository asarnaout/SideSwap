/**
 * Pure, deterministic helpers for the 3D scene's visual overhaul: per-map
 * palettes, sky gradients, fog ranges, horizon silhouettes, procedural
 * texture specs, planar UVs, and roadside prop placement. Everything here is
 * renderer-agnostic (no Babylon imports) so it can be unit-tested directly;
 * GameCanvas owns the canvas painting and mesh construction.
 */

export function seededUnit(seed: number) {
  let value = (Math.trunc(seed) || 1) >>> 0;
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

export interface VisualPoint {
  readonly x: number;
  readonly z: number;
}

export interface MapVisualPalette {
  readonly skyTop: string;
  readonly skyHorizon: string;
  readonly fogColor: string;
  readonly grassBase: string;
  readonly grassAlt: string;
  readonly dirtShoulder: string;
  readonly silhouetteNear: string;
  readonly silhouetteFar: string;
  readonly sunTint: string;
  /**
   * Paved-city option. When `paved` is set, the base ground renders as concrete
   * (`groundBase`) instead of grass, and the road shoulder band becomes a
   * concrete sidewalk (`pavement`). Parks still paint their own green on top.
   * Omitted on rural/suburban maps, which keep the grass ground + dirt shoulder.
   */
  readonly paved?: boolean;
  readonly groundBase?: string;
  readonly pavement?: string;
  /**
   * Night city. When set, the scene lights dim to a cool moonlight, building
   * materials gain a warm emissive so windows/facades glow, streetlights and
   * signage light up, and bloom is nudged — a night drive lit by the city
   * itself. The sky/fog/silhouette colours above are authored dark to match.
   */
  readonly night?: boolean;
}

export type MapVisualKey =
  | "nyc"
  | "london"
  | "milton"
  | "calais"
  | "tokyo"
  | "orientation";

/**
 * How wide the concrete sidewalk band renders on `paved` maps. Shared by the
 * renderer (sidewalk strips), the pavement rail graph (walkers), and the
 * static-collider clamp that keeps venue lots off the walkable band.
 */
export const PAVED_SIDEWALK_WIDTH_M = 3.4;

// Warm cinematic low-poly palette. Each sky is a saturated blue zenith that
// warms into a COLORED horizon (retiring the old near-white haze that washed
// every map out); fog matches the horizon so distance reads as atmosphere;
// grass is richer, dirt warmer, and distant silhouettes recede into a warm
// haze rather than a cold grey. Per-map moods: NYC golden-hour, London rich
// late-afternoon, Milton Keynes bright pastoral, Calais luminous coast,
// Tokyo soft warm residential.
const MAP_VISUAL_PALETTES: Record<MapVisualKey, MapVisualPalette> = {
  nyc: {
    // Realistic city night: a deep navy zenith easing to a slightly lit
    // night-blue near the horizon, with matching dark-blue fog — so the warm
    // sodium streetlights/windows pop against a cool, properly dark sky rather
    // than the flat grey a blue→amber dusk gradient washed out to.
    skyTop: "#0e1a33",
    skyHorizon: "#22355a",
    fogColor: "#1c2a44",
    grassBase: "#3f6a3c",
    grassAlt: "#4d7c44",
    dirtShoulder: "#6b5a3f",
    silhouetteNear: "#3a3742",
    silhouetteFar: "#6a5d55",
    sunTint: "#ffddab",
    // NYC is a paved city: concrete lots + sidewalks instead of the grass plane.
    paved: true,
    groundBase: "#34363b",
    pavement: "#45474c",
    night: true,
  },
  london: {
    skyTop: "#3f7fb8",
    skyHorizon: "#ecd7bb",
    fogColor: "#e2d0ba",
    grassBase: "#3c6444",
    grassAlt: "#4a7550",
    dirtShoulder: "#5f5540",
    silhouetteNear: "#a6a89f",
    silhouetteFar: "#cdc8b6",
    sunTint: "#ffe6c0",
  },
  milton: {
    skyTop: "#4a90c4",
    skyHorizon: "#eaddb8",
    fogColor: "#e0d6ba",
    grassBase: "#3f6b39",
    grassAlt: "#4f7e43",
    dirtShoulder: "#64583c",
    silhouetteNear: "#a7b39a",
    silhouetteFar: "#cdccae",
    sunTint: "#ffedc6",
  },
  calais: {
    skyTop: "#2f86c9",
    skyHorizon: "#f0e3c4",
    fogColor: "#e6ddc4",
    grassBase: "#4a6c3d",
    grassAlt: "#5c8049",
    dirtShoulder: "#6f6144",
    silhouetteNear: "#b3bfb0",
    silhouetteFar: "#d6d1b8",
    sunTint: "#fff0cc",
  },
  tokyo: {
    skyTop: "#4a8ec2",
    skyHorizon: "#f0dcbd",
    fogColor: "#e6d6bd",
    grassBase: "#40663d",
    grassAlt: "#4f7a45",
    dirtShoulder: "#665a3f",
    silhouetteNear: "#a9b0b0",
    silhouetteFar: "#cfccb8",
    sunTint: "#ffe9c2",
  },
  orientation: {
    skyTop: "#3f86c6",
    skyHorizon: "#ecdcbe",
    fogColor: "#e2d5bc",
    grassBase: "#3d673f",
    grassAlt: "#4c7a46",
    dirtShoulder: "#625740",
    silhouetteNear: "#a8aca2",
    silhouetteFar: "#cdc9b6",
    sunTint: "#ffe9c4",
  },
};

export function resolveMapVisualKey(mapId: string): MapVisualKey {
  const id = mapId.toLowerCase();
  if (id.includes("tokyo")) return "tokyo";
  if (id.includes("london")) return "london";
  if (id.includes("milton")) return "milton";
  if (id.includes("calais") || id.includes("folkestone")) return "calais";
  if (id.includes("orientation") || id.includes("yard")) return "orientation";
  return "nyc";
}

export function resolveMapVisualPalette(mapId: string): MapVisualPalette {
  return MAP_VISUAL_PALETTES[resolveMapVisualKey(mapId)];
}

const clampChannel = (value: number): number =>
  Math.min(255, Math.max(0, Math.round(value)));

export function mixHexColors(from: string, to: string, amount: number): string {
  const parse = (hex: string): [number, number, number] => {
    const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
    if (!match) return [128, 128, 128];
    return [
      parseInt(match[1], 16),
      parseInt(match[2], 16),
      parseInt(match[3], 16),
    ];
  };
  const [fr, fg, fb] = parse(from);
  const [tr, tg, tb] = parse(to);
  const t = Math.min(1, Math.max(0, amount));
  const channel = (a: number, b: number) => clampChannel(a + (b - a) * t);
  return `#${[channel(fr, tr), channel(fg, tg), channel(fb, tb)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

export interface SkyGradientStop {
  readonly offset: number;
  readonly color: string;
}

/**
 * Zenith-to-horizon gradient stops (offset 0 = top of the sky dome). A rich
 * blue holds through the upper dome, then warms into the colored horizon band
 * near eye level; the horizon colour holds to offset 1 so the dome never shows
 * a hard edge under the world. Keeping the blue dominant up high (only a 35%
 * warm mix at the half-way stop) avoids a muddy blue↔warm blend across the
 * middle of the sky.
 */
export function skyGradientStops(
  palette: MapVisualPalette,
): readonly SkyGradientStop[] {
  return [
    { offset: 0, color: palette.skyTop },
    { offset: 0.5, color: mixHexColors(palette.skyTop, palette.skyHorizon, 0.35) },
    { offset: 0.8, color: mixHexColors(palette.skyTop, palette.skyHorizon, 0.78) },
    { offset: 1, color: palette.skyHorizon },
  ];
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export interface FogRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Linear-fog band scaled to the map so small yards fade gently at their
 * edges while the 1.5 km Milton Keynes corridor melts into the horizon
 * instead of hard-clipping.
 */
export function resolveFogRange(worldSize: VisualPoint): FogRange {
  const maxDimension = Math.max(90, worldSize.x, worldSize.z);
  return {
    start: clamp(0.45 * maxDimension, 70, 160),
    end: clamp(1.15 * maxDimension, 340, 1100),
  };
}

export type SilhouetteShapeKind = "box" | "hill" | "spike" | "pylon";

export interface SilhouetteShape {
  readonly kind: SilhouetteShapeKind;
  /** Normalised horizontal centre position, 0..1 around the ring. */
  readonly x: number;
  /** Normalised width, 0..1. */
  readonly w: number;
  /** Normalised height above the horizon base, 0..1. */
  readonly h: number;
  /** 1 = far (painted first, lighter), 0 = near (painted last, darker). */
  readonly layer: 0 | 1;
}

const pushRange = (
  shapes: SilhouetteShape[],
  random: () => number,
  count: number,
  make: (index: number) => SilhouetteShape,
): void => {
  for (let index = 0; index < count; index += 1) {
    shapes.push(make(index));
  }
};

/**
 * Deterministic, per-map skyline recipe in normalised coordinates. NYC gets
 * a dense high-rise wall, London low terraces with one tall spike and a dome
 * hump, Milton Keynes rolling hills with tree bumps, Calais dunes with an
 * open sea gap, and Tokyo hills behind mid-rises and utility pylons.
 */
export function buildHorizonSilhouetteSpec(
  mapId: string,
  seed: number,
): readonly SilhouetteShape[] {
  const key = resolveMapVisualKey(mapId);
  const random = seededUnit(seed);
  const shapes: SilhouetteShape[] = [];

  if (key === "nyc") {
    pushRange(shapes, random, 44, () => ({
      kind: "box",
      x: random(),
      w: 0.012 + random() * 0.02,
      h: 0.22 + random() * 0.3,
      layer: 1,
    }));
    pushRange(shapes, random, 30, () => ({
      kind: "box",
      x: random(),
      w: 0.014 + random() * 0.022,
      h: 0.34 + random() * 0.4,
      layer: 0,
    }));
    pushRange(shapes, random, 4, () => ({
      kind: "spike",
      x: random(),
      w: 0.012,
      h: 0.72 + random() * 0.22,
      layer: 0,
    }));
    return shapes;
  }

  if (key === "london") {
    pushRange(shapes, random, 26, () => ({
      kind: "box",
      x: random(),
      w: 0.03 + random() * 0.05,
      h: 0.12 + random() * 0.14,
      layer: 1,
    }));
    pushRange(shapes, random, 20, () => ({
      kind: "box",
      x: random(),
      w: 0.024 + random() * 0.045,
      h: 0.14 + random() * 0.16,
      layer: 0,
    }));
    shapes.push({ kind: "hill", x: random(), w: 0.07, h: 0.3, layer: 0 });
    shapes.push({
      kind: "spike",
      x: 0.18 + random() * 0.64,
      w: 0.02,
      h: 0.78,
      layer: 0,
    });
    return shapes;
  }

  if (key === "milton") {
    pushRange(shapes, random, 9, () => ({
      kind: "hill",
      x: random(),
      w: 0.16 + random() * 0.18,
      h: 0.12 + random() * 0.14,
      layer: 1,
    }));
    pushRange(shapes, random, 26, () => ({
      kind: "hill",
      x: random(),
      w: 0.012 + random() * 0.022,
      h: 0.05 + random() * 0.08,
      layer: 0,
    }));
    return shapes;
  }

  if (key === "calais") {
    // Leave a flat open gap around x 0.38..0.62 so the Channel reads as sea.
    const dune = (layer: 0 | 1): SilhouetteShape => {
      const inGapHalf = random() < 0.5;
      const x = inGapHalf ? random() * 0.36 : 0.64 + random() * 0.36;
      return {
        kind: "hill",
        x,
        w: 0.08 + random() * 0.12,
        h: 0.06 + random() * (layer === 1 ? 0.06 : 0.1),
        layer,
      };
    };
    pushRange(shapes, random, 8, () => dune(1));
    pushRange(shapes, random, 8, () => dune(0));
    pushRange(shapes, random, 4, () => ({
      kind: "box",
      x: 0.68 + random() * 0.26,
      h: 0.09 + random() * 0.07,
      w: 0.04 + random() * 0.05,
      layer: 0,
    }));
    shapes.push({ kind: "spike", x: 0.08 + random() * 0.2, w: 0.014, h: 0.34, layer: 0 });
    return shapes;
  }

  if (key === "tokyo") {
    pushRange(shapes, random, 8, () => ({
      kind: "hill",
      x: random(),
      w: 0.14 + random() * 0.16,
      h: 0.14 + random() * 0.16,
      layer: 1,
    }));
    pushRange(shapes, random, 22, () => ({
      kind: "box",
      x: random(),
      w: 0.016 + random() * 0.03,
      h: 0.16 + random() * 0.24,
      layer: 0,
    }));
    pushRange(shapes, random, 8, (index) => ({
      kind: "pylon",
      x: (index + 0.5) / 8 + (random() - 0.5) * 0.04,
      w: 0.012,
      h: 0.42 + random() * 0.14,
      layer: 0,
    }));
    return shapes;
  }

  pushRange(shapes, random, 10, () => ({
    kind: "hill",
    x: random(),
    w: 0.14 + random() * 0.18,
    h: 0.08 + random() * 0.12,
    layer: 1,
  }));
  pushRange(shapes, random, 14, () => ({
    kind: "hill",
    x: random(),
    w: 0.01 + random() * 0.02,
    h: 0.05 + random() * 0.07,
    layer: 0,
  }));
  return shapes;
}

export interface AsphaltCrack {
  readonly points: readonly { readonly x: number; readonly y: number }[];
}

export interface AsphaltTextureSpec {
  readonly noiseSeed: number;
  readonly cracks: readonly AsphaltCrack[];
  readonly patches: readonly {
    readonly x: number;
    readonly y: number;
    readonly r: number;
    readonly lighten: number;
  }[];
}

/** Subtle wear spec: wandering thin cracks plus soft lighter patches. */
export function buildAsphaltTextureSpec(seed: number): AsphaltTextureSpec {
  const random = seededUnit(seed);
  const cracks: AsphaltCrack[] = [];
  const crackCount = 6 + Math.floor(random() * 4);
  for (let crack = 0; crack < crackCount; crack += 1) {
    let x = random();
    let y = random();
    const points = [{ x, y }];
    const steps = 4 + Math.floor(random() * 4);
    const drift = random() * Math.PI * 2;
    for (let step = 0; step < steps; step += 1) {
      const angle = drift + (random() - 0.5) * 1.6;
      x = (x + Math.cos(angle) * (0.03 + random() * 0.05) + 1) % 1;
      y = (y + Math.sin(angle) * (0.03 + random() * 0.05) + 1) % 1;
      points.push({ x, y });
    }
    cracks.push({ points });
  }
  const patches = Array.from({ length: 2 + Math.floor(random() * 2) }, () => ({
    x: random(),
    y: random(),
    r: 0.035 + random() * 0.05,
    lighten: 0.015 + random() * 0.02,
  }));
  return { noiseSeed: Math.floor(random() * 0xffff) + 1, cracks, patches };
}

export interface GrassTextureSpec {
  readonly noiseSeed: number;
  readonly blobs: readonly {
    readonly x: number;
    readonly y: number;
    readonly r: number;
    readonly alt: boolean;
  }[];
  readonly speckles: readonly { readonly x: number; readonly y: number }[];
}

/** Two-tone meadow spec: soft colour blobs plus sparse dirt speckles. */
export function buildGrassTextureSpec(seed: number): GrassTextureSpec {
  const random = seededUnit(seed);
  const blobs = Array.from({ length: 150 }, () => ({
    x: random(),
    y: random(),
    r: 0.02 + random() * 0.05,
    alt: random() < 0.5,
  }));
  const speckles = Array.from({ length: 42 }, () => ({
    x: random(),
    y: random(),
  }));
  return { noiseSeed: Math.floor(random() * 0xffff) + 1, blobs, speckles };
}

/**
 * World-planar UVs from interleaved xyz positions so tiled surface textures
 * stay continuous across independently authored road meshes.
 */
export function buildPlanarUVs(
  positions: readonly number[],
  scale: number,
): number[] {
  const uvs: number[] = [];
  for (let index = 0; index + 2 < positions.length; index += 3) {
    uvs.push(positions[index] * scale, positions[index + 2] * scale);
  }
  return uvs;
}

export function distanceToPolylineM(
  point: VisualPoint,
  polyline: readonly VisualPoint[],
): number {
  if (!polyline.length) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const start = polyline[index];
    const end = polyline[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const amount = lengthSquared < 1e-9
      ? 0
      : clamp(
          ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared,
          0,
          1,
        );
    const x = start.x + dx * amount;
    const z = start.z + dz * amount;
    best = Math.min(best, Math.hypot(point.x - x, point.z - z));
  }
  if (polyline.length === 1) {
    best = Math.hypot(point.x - polyline[0].x, point.z - polyline[0].z);
  }
  return best;
}

export interface PropPlacement {
  readonly kind: string;
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
  readonly scale: number;
  readonly variant: number;
}

export interface PropKindConfig {
  readonly kind: string;
  /** Average distance between candidates along a road, in metres. */
  readonly spacingM: number;
  /** Random +/- variation applied to spacing, in metres. */
  readonly jitterM: number;
  /** Extra clearance beyond the road edge + shoulder, in metres (>= 0.9). */
  readonly lateralMarginM: number;
  readonly bothSides: boolean;
  /** Alternate sides along the road (streetlight rhythm). */
  readonly alternateSides?: boolean;
  readonly variants: number;
  readonly minScale?: number;
  readonly maxScale?: number;
  /** Face the carriageway instead of taking a random rotation. */
  readonly faceRoad?: boolean;
}

export interface PropScatterRoadSurface {
  readonly id: string;
  readonly centerline: readonly VisualPoint[];
  readonly widthM: number;
}

export interface PropScatterRect {
  readonly center: VisualPoint;
  readonly size: VisualPoint;
}

export interface PropScatterInput {
  readonly roadSurfaces: readonly PropScatterRoadSurface[];
  readonly blocks: readonly PropScatterRect[];
  readonly landmarks: readonly PropScatterRect[];
  readonly worldSize: VisualPoint;
  readonly shoulderWidthM: number;
  readonly seed: number;
  readonly kinds: readonly PropKindConfig[];
  /** Existing hand-placed furniture that scattered props must keep clear of. */
  readonly occupiedPoints?: readonly VisualPoint[];
}

const PROP_MIN_MUTUAL_SPACING_M = 3;
const PROP_ROAD_CLEARANCE_M = 0.6;
const PROP_WORLD_EDGE_MARGIN_M = 4;
const RECT_INFLATION_M = 1;

interface SpacingGrid {
  readonly cellSize: number;
  readonly cells: Map<string, VisualPoint[]>;
}

const gridKey = (column: number, row: number): string => `${column}:${row}`;

const createSpacingGrid = (cellSize: number): SpacingGrid => ({
  cellSize,
  cells: new Map(),
});

const gridHasNeighborWithin = (
  grid: SpacingGrid,
  point: VisualPoint,
  radius: number,
): boolean => {
  const column = Math.floor(point.x / grid.cellSize);
  const row = Math.floor(point.z / grid.cellSize);
  const reach = Math.ceil(radius / grid.cellSize);
  for (let dc = -reach; dc <= reach; dc += 1) {
    for (let dr = -reach; dr <= reach; dr += 1) {
      const bucket = grid.cells.get(gridKey(column + dc, row + dr));
      if (!bucket) continue;
      for (const existing of bucket) {
        if (Math.hypot(existing.x - point.x, existing.z - point.z) < radius) {
          return true;
        }
      }
    }
  }
  return false;
};

const gridInsert = (grid: SpacingGrid, point: VisualPoint): void => {
  const key = gridKey(
    Math.floor(point.x / grid.cellSize),
    Math.floor(point.z / grid.cellSize),
  );
  const bucket = grid.cells.get(key);
  if (bucket) bucket.push(point);
  else grid.cells.set(key, [point]);
};

const isInsideInflatedRect = (
  point: VisualPoint,
  rect: PropScatterRect,
): boolean =>
  Math.abs(point.x - rect.center.x) <= rect.size.x / 2 + RECT_INFLATION_M &&
  Math.abs(point.z - rect.center.z) <= rect.size.z / 2 + RECT_INFLATION_M;

/**
 * Deterministic roadside prop scatter. Walks each road surface by arclength,
 * offsets candidates beyond the shoulder, and rejects anything that would sit
 * on a carriageway, inside authored blocks/landmarks, outside the world, or
 * too close to another prop or hand-placed furniture.
 */
export function generateRoadsidePropPlacements(
  input: PropScatterInput,
): readonly PropPlacement[] {
  const random = seededUnit(input.seed);
  const placements: PropPlacement[] = [];
  const grid = createSpacingGrid(PROP_MIN_MUTUAL_SPACING_M);
  for (const occupied of input.occupiedPoints ?? []) {
    gridInsert(grid, occupied);
  }

  const halfWorldX = input.worldSize.x / 2 - PROP_WORLD_EDGE_MARGIN_M;
  const halfWorldZ = input.worldSize.z / 2 - PROP_WORLD_EDGE_MARGIN_M;

  const isClearOfRoads = (point: VisualPoint): boolean =>
    input.roadSurfaces.every(
      (surface) =>
        distanceToPolylineM(point, surface.centerline) >=
        surface.widthM / 2 + input.shoulderWidthM + PROP_ROAD_CLEARANCE_M,
    );

  for (const kindConfig of input.kinds) {
    for (const surface of input.roadSurfaces) {
      let sideToggle = random() < 0.5 ? 1 : -1;
      let nextAt = kindConfig.spacingM * (0.3 + random() * 0.7);
      let travelled = 0;
      for (
        let segment = 0;
        segment < surface.centerline.length - 1;
        segment += 1
      ) {
        const start = surface.centerline[segment];
        const end = surface.centerline[segment + 1];
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const segmentLength = Math.hypot(dx, dz);
        if (segmentLength < 1e-6) continue;
        const tangentX = dx / segmentLength;
        const tangentZ = dz / segmentLength;

        while (nextAt <= travelled + segmentLength) {
          const along = nextAt - travelled;
          const baseX = start.x + tangentX * along;
          const baseZ = start.z + tangentZ * along;
          const sides = kindConfig.bothSides
            ? [1, -1]
            : [kindConfig.alternateSides ? sideToggle : random() < 0.5 ? 1 : -1];
          if (kindConfig.alternateSides) sideToggle = -sideToggle;

          for (const side of sides) {
            const lateral =
              surface.widthM / 2 +
              input.shoulderWidthM +
              kindConfig.lateralMarginM +
              random() * 1.5;
            const normalX = tangentZ * side;
            const normalZ = -tangentX * side;
            const candidate = {
              x: baseX + normalX * lateral,
              z: baseZ + normalZ * lateral,
            };
            const rotationY = kindConfig.faceRoad
              ? Math.atan2(baseX - candidate.x, baseZ - candidate.z)
              : random() * Math.PI * 2;
            const scale =
              (kindConfig.minScale ?? 1) +
              random() *
                Math.max(0, (kindConfig.maxScale ?? 1) - (kindConfig.minScale ?? 1));
            const variant = Math.floor(random() * kindConfig.variants);
            if (
              Math.abs(candidate.x) > halfWorldX ||
              Math.abs(candidate.z) > halfWorldZ ||
              !isClearOfRoads(candidate) ||
              input.blocks.some((rect) => isInsideInflatedRect(candidate, rect)) ||
              input.landmarks.some((rect) =>
                isInsideInflatedRect(candidate, rect),
              ) ||
              gridHasNeighborWithin(grid, candidate, PROP_MIN_MUTUAL_SPACING_M)
            ) {
              continue;
            }
            gridInsert(grid, candidate);
            placements.push({
              kind: kindConfig.kind,
              x: candidate.x,
              z: candidate.z,
              rotationY,
              scale,
              variant,
            });
          }

          nextAt += Math.max(
            2,
            kindConfig.spacingM + (random() - 0.5) * 2 * kindConfig.jitterM,
          );
        }
        travelled += segmentLength;
      }
    }
  }
  return placements;
}

/** Small deterministic hash so per-map prop scatter is stable across runs. */
export function hashStringToSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}
