import { describe, expect, it } from "vitest";
import {
  buildAsphaltTextureSpec,
  buildGrassTextureSpec,
  buildHorizonSilhouetteSpec,
  buildPlanarUVs,
  distanceToPolylineM,
  generateRoadsidePropPlacements,
  hashStringToSeed,
  mixHexColors,
  resolveFogRange,
  resolveMapVisualKey,
  resolveMapVisualPalette,
  seededUnit,
  skyGradientStops,
  type PropScatterInput,
} from "../app/game/visuals";

const HEX_PATTERN = /^#[\da-f]{6}$/i;

const STRAIGHT_ROAD = {
  id: "straight",
  centerline: [
    { x: -100, z: 0 },
    { x: 100, z: 0 },
  ],
  widthM: 7,
} as const;

const SCATTER_FIXTURE: PropScatterInput = {
  roadSurfaces: [STRAIGHT_ROAD],
  blocks: [{ center: { x: 40, z: 20 }, size: { x: 30, z: 16 } }],
  landmarks: [{ center: { x: -50, z: -22 }, size: { x: 18, z: 12 } }],
  worldSize: { x: 240, z: 120 },
  shoulderWidthM: 1.2,
  seed: 1234,
  kinds: [
    {
      kind: "tree",
      spacingM: 14,
      jitterM: 4,
      lateralMarginM: 2,
      bothSides: true,
      variants: 3,
      minScale: 0.85,
      maxScale: 1.3,
    },
    {
      kind: "streetlight",
      spacingM: 22,
      jitterM: 3,
      lateralMarginM: 1,
      bothSides: false,
      alternateSides: true,
      variants: 1,
      faceRoad: true,
    },
  ],
};

describe("map visual palettes", () => {
  it("resolves the expected visual key for every shipped map", () => {
    expect(resolveMapVisualKey("nyc-upper-west-side")).toBe("nyc");
    expect(resolveMapVisualKey("london-south-kensington")).toBe("london");
    expect(resolveMapVisualKey("milton-keynes-oldbrook")).toBe("milton");
    expect(resolveMapVisualKey("calais-coquelles")).toBe("calais");
    expect(resolveMapVisualKey("folkestone-coquelles")).toBe("calais");
    expect(resolveMapVisualKey("tokyo-setagaya")).toBe("tokyo");
    expect(resolveMapVisualKey("orientation-yard")).toBe("orientation");
  });

  it("provides complete hex palettes and ordered sky gradients", () => {
    for (const mapId of [
      "nyc-upper-west-side",
      "london-south-kensington",
      "milton-keynes-oldbrook",
      "calais-coquelles",
      "tokyo-setagaya",
      "orientation-yard",
    ]) {
      const palette = resolveMapVisualPalette(mapId);
      for (const value of Object.values(palette)) {
        // Palettes are all hex colours except the optional `paved` boolean flag.
        if (typeof value !== "string") continue;
        expect(value).toMatch(HEX_PATTERN);
      }
      const stops = skyGradientStops(palette);
      expect(stops[0]).toEqual({ offset: 0, color: palette.skyTop });
      expect(stops.at(-1)).toEqual({ offset: 1, color: palette.skyHorizon });
      for (let index = 1; index < stops.length; index += 1) {
        expect(stops[index].offset).toBeGreaterThan(stops[index - 1].offset);
        expect(stops[index].color).toMatch(HEX_PATTERN);
      }
    }
  });

  it("mixes hex colors channel-wise", () => {
    expect(mixHexColors("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHexColors("#204060", "#204060", 0.7)).toBe("#204060");
    expect(mixHexColors("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHexColors("#000000", "#ffffff", 1)).toBe("#ffffff");
  });
});

describe("fog ranges", () => {
  it("clamps small maps to a gentle band", () => {
    expect(resolveFogRange({ x: 140, z: 110 })).toEqual({ start: 70, end: 340 });
  });

  it("stretches with the Milton Keynes corridor but stays bounded", () => {
    expect(resolveFogRange({ x: 1500, z: 300 })).toEqual({
      start: 160,
      end: 1100,
    });
  });
});

describe("horizon silhouettes", () => {
  it("is deterministic and stays in normalised bounds", () => {
    for (const mapId of [
      "nyc-upper-west-side",
      "london-south-kensington",
      "milton-keynes-oldbrook",
      "calais-coquelles",
      "tokyo-setagaya",
      "orientation-yard",
    ]) {
      const seed = hashStringToSeed(mapId);
      const first = buildHorizonSilhouetteSpec(mapId, seed);
      const second = buildHorizonSilhouetteSpec(mapId, seed);
      expect(second).toEqual(first);
      expect(first.length).toBeGreaterThan(0);
      for (const shape of first) {
        expect(shape.x).toBeGreaterThanOrEqual(0);
        expect(shape.x).toBeLessThanOrEqual(1);
        expect(shape.w).toBeGreaterThan(0);
        expect(shape.h).toBeGreaterThan(0);
        expect(shape.h).toBeLessThanOrEqual(1);
        expect([0, 1]).toContain(shape.layer);
      }
    }
  });

  it("keeps recognisable per-map ingredients", () => {
    const seed = 99;
    const tokyoKinds = new Set(
      buildHorizonSilhouetteSpec("tokyo-setagaya", seed).map((shape) => shape.kind),
    );
    expect(tokyoKinds.has("pylon")).toBe(true);
    const nycKinds = new Set(
      buildHorizonSilhouetteSpec("nyc-upper-west-side", seed).map((shape) => shape.kind),
    );
    expect(nycKinds.has("box")).toBe(true);
    expect(nycKinds.has("spike")).toBe(true);
    const miltonKinds = new Set(
      buildHorizonSilhouetteSpec("milton-keynes-oldbrook", seed).map(
        (shape) => shape.kind,
      ),
    );
    expect(miltonKinds).toEqual(new Set(["hill"]));
    // Calais keeps an open Channel gap in the middle of the skyline.
    for (const shape of buildHorizonSilhouetteSpec("calais-coquelles", seed)) {
      expect(shape.x < 0.4 || shape.x > 0.6).toBe(true);
    }
  });
});

describe("texture specs", () => {
  it("builds deterministic asphalt and grass specs in bounds", () => {
    expect(buildAsphaltTextureSpec(7)).toEqual(buildAsphaltTextureSpec(7));
    expect(buildGrassTextureSpec(7)).toEqual(buildGrassTextureSpec(7));
    const asphalt = buildAsphaltTextureSpec(7);
    expect(asphalt.cracks.length).toBeGreaterThanOrEqual(6);
    for (const crack of asphalt.cracks) {
      for (const point of crack.points) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThan(1);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThan(1);
      }
    }
    const grass = buildGrassTextureSpec(11);
    expect(grass.blobs.length).toBeGreaterThan(100);
  });
});

describe("planar UVs", () => {
  it("maps world x/z through the scale", () => {
    expect(buildPlanarUVs([0, 0.07, 0, 10, 0.07, 20], 0.1)).toEqual([
      0, 0, 1, 2,
    ]);
  });
});

describe("distanceToPolylineM", () => {
  it("measures point-to-segment distance", () => {
    const line = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ];
    expect(distanceToPolylineM({ x: 5, z: 0 }, line)).toBe(0);
    expect(distanceToPolylineM({ x: 5, z: 4 }, line)).toBeCloseTo(4, 6);
    expect(distanceToPolylineM({ x: -3, z: 4 }, line)).toBeCloseTo(5, 6);
    expect(distanceToPolylineM({ x: 2, z: 1 }, [{ x: 0, z: 0 }])).toBeCloseTo(
      Math.hypot(2, 1),
      6,
    );
  });
});

describe("roadside prop scatter", () => {
  it("is deterministic for the same seed", () => {
    expect(generateRoadsidePropPlacements(SCATTER_FIXTURE)).toEqual(
      generateRoadsidePropPlacements(SCATTER_FIXTURE),
    );
  });

  it("produces placements that respect every clearance rule", () => {
    const placements = generateRoadsidePropPlacements(SCATTER_FIXTURE);
    expect(placements.length).toBeGreaterThan(6);
    const clearance =
      STRAIGHT_ROAD.widthM / 2 + SCATTER_FIXTURE.shoulderWidthM + 0.6;
    for (const placement of placements) {
      expect(
        distanceToPolylineM(
          { x: placement.x, z: placement.z },
          STRAIGHT_ROAD.centerline,
        ),
      ).toBeGreaterThanOrEqual(clearance);
      for (const rect of [
        ...SCATTER_FIXTURE.blocks,
        ...SCATTER_FIXTURE.landmarks,
      ]) {
        const inside =
          Math.abs(placement.x - rect.center.x) <= rect.size.x / 2 + 1 &&
          Math.abs(placement.z - rect.center.z) <= rect.size.z / 2 + 1;
        expect(inside).toBe(false);
      }
      expect(Math.abs(placement.x)).toBeLessThanOrEqual(240 / 2 - 4);
      expect(Math.abs(placement.z)).toBeLessThanOrEqual(120 / 2 - 4);
    }
    for (const [index, placement] of placements.entries()) {
      for (const other of placements.slice(index + 1)) {
        expect(
          Math.hypot(placement.x - other.x, placement.z - other.z),
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("turns face-road props toward the carriageway", () => {
    const placements = generateRoadsidePropPlacements(SCATTER_FIXTURE).filter(
      (placement) => placement.kind === "streetlight",
    );
    expect(placements.length).toBeGreaterThan(0);
    for (const placement of placements) {
      // Local +z maps to (sin rotationY, cos rotationY); on a straight road
      // along x the carriageway sits at z = 0, so the facing vector must point
      // from the prop back toward the centreline.
      const facingZ = Math.cos(placement.rotationY);
      expect(facingZ * -Math.sign(placement.z)).toBeGreaterThan(0.99);
    }
  });

  it("respects hand-placed furniture through occupiedPoints", () => {
    const occupiedPoints: { x: number; z: number }[] = [];
    for (let x = -104; x <= 104; x += 2) {
      for (const z of [-6.5, 6.5]) {
        occupiedPoints.push({ x, z });
      }
    }
    const placements = generateRoadsidePropPlacements({
      ...SCATTER_FIXTURE,
      kinds: [
        {
          kind: "streetlight",
          spacingM: 22,
          jitterM: 3,
          lateralMarginM: 1,
          bothSides: false,
          alternateSides: true,
          variants: 1,
          faceRoad: true,
        },
      ],
      occupiedPoints,
    });
    expect(placements).toEqual([]);
  });
});

describe("deterministic seeds", () => {
  it("hashes strings to stable non-zero seeds", () => {
    expect(hashStringToSeed("nyc-upper-west-side")).toBe(
      hashStringToSeed("nyc-upper-west-side"),
    );
    expect(hashStringToSeed("a")).not.toBe(hashStringToSeed("b"));
    expect(hashStringToSeed("")).toBeGreaterThan(0);
  });

  it("seededUnit repeats its stream and stays in [0, 1)", () => {
    const first = seededUnit(42);
    const second = seededUnit(42);
    for (let index = 0; index < 32; index += 1) {
      const value = first();
      expect(second()).toBe(value);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
