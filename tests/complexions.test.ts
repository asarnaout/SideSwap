import { describe, expect, it } from "vitest";
import {
  COMPLEXION_PALETTE_SLOTS,
  COMPLEXION_RAMP_LENGTH,
  complexionPaletteForMap,
  complexionWeightsForMap,
  type ComplexionTone,
} from "../app/game/complexions";

const MAPS = [
  "nyc-upper-west-side",
  "london-south-kensington",
  "tokyo-setagaya",
  "calais-coquelles",
  "milton-keynes-oldbrook",
  "orientation-yard",
];

const lightness = (tone: ComplexionTone) => (tone.r + tone.g + tone.b) / 3;

const meanLightness = (tones: readonly ComplexionTone[]) =>
  tones.reduce((total, tone) => total + lightness(tone), 0) / tones.length;

/** Distinct tones in ramp order, so a palette can be described by tone index. */
function rampIndex(palette: readonly ComplexionTone[], tone: ComplexionTone): number {
  const ordered = [...new Set(palette.map((entry) => lightness(entry)))].sort((a, b) => a - b);
  return ordered.indexOf(lightness(tone));
}

describe("complexion palettes", () => {
  it("gives every map the same number of slots, one per unit of weight", () => {
    for (const mapId of MAPS) {
      const weights = complexionWeightsForMap(mapId);
      expect(weights).toHaveLength(COMPLEXION_RAMP_LENGTH);
      expect(weights.reduce((total, weight) => total + weight, 0)).toBe(
        COMPLEXION_PALETTE_SLOTS,
      );
      expect(complexionPaletteForMap(mapId)).toHaveLength(COMPLEXION_PALETTE_SLOTS);
    }
  });

  it("honours each map's weights exactly", () => {
    for (const mapId of MAPS) {
      const weights = complexionWeightsForMap(mapId);
      const palette = complexionPaletteForMap(mapId);
      const counts = new Array<number>(COMPLEXION_RAMP_LENGTH).fill(0);
      // Ramp positions are recovered from a map that actually uses every tone.
      const reference = complexionPaletteForMap("nyc-upper-west-side");
      for (const tone of palette) counts[rampIndex(reference, tone)] += 1;
      expect(counts).toEqual([...weights]);
    }
  });

  it("is deterministic per map and ordered differently between maps", () => {
    for (const mapId of MAPS) {
      expect(complexionPaletteForMap(mapId)).toEqual(complexionPaletteForMap(mapId));
    }
    const nyc = complexionPaletteForMap("nyc-upper-west-side").map(lightness);
    const london = complexionPaletteForMap("london-south-kensington").map(lightness);
    expect(nyc).not.toEqual(london);
  });

  it("spreads the Upper West Side evenly across the whole ramp", () => {
    const palette = complexionPaletteForMap("nyc-upper-west-side");
    const distinct = new Set(palette.map(lightness));
    expect(distinct.size).toBe(COMPLEXION_RAMP_LENGTH);
    const counts = [...distinct].map(
      (value) => palette.filter((tone) => lightness(tone) === value).length,
    );
    expect(Math.max(...counts) - Math.min(...counts)).toBe(0);
  });

  it("weights Setagaya toward the upper half of the ramp", () => {
    const reference = complexionPaletteForMap("nyc-upper-west-side");
    const tokyo = complexionPaletteForMap("tokyo-setagaya");
    const upperHalf = tokyo.filter(
      (tone) => rampIndex(reference, tone) >= COMPLEXION_RAMP_LENGTH / 2,
    );
    expect(upperHalf.length / tokyo.length).toBeGreaterThan(0.8);
    expect(meanLightness(tokyo)).toBeGreaterThan(meanLightness(reference));
    // Still a spread, not a single value: a ward with an international
    // population should not read as uniform.
    expect(new Set(tokyo.map(lightness)).size).toBeGreaterThanOrEqual(4);
  });

  it("keeps short pools representative, since walkers take slots by index", () => {
    for (const mapId of MAPS) {
      const palette = complexionPaletteForMap(mapId);
      const shortPool = palette.slice(0, 8);
      expect(Math.abs(meanLightness(shortPool) - meanLightness(palette))).toBeLessThan(
        0.12,
      );
      expect(new Set(shortPool.map(lightness)).size).toBeGreaterThanOrEqual(3);
    }
  });

  it("reproduces the map's weights across a real pool size", () => {
    // What the game does: every walker takes `poolIndex % palette.length`,
    // so a pool has to land on the intended spread, not just the palette.
    const reference = complexionPaletteForMap("nyc-upper-west-side");
    for (const [mapId, poolSize] of [
      ["nyc-upper-west-side", 96],
      ["london-south-kensington", 64],
      ["tokyo-setagaya", 56],
    ] as const) {
      const palette = complexionPaletteForMap(mapId);
      const drawn = Array.from(
        { length: poolSize },
        (_, index) => palette[index % palette.length],
      );
      const share = (from: number) =>
        drawn.filter((tone) => rampIndex(reference, tone) >= from).length / poolSize;
      const expected = complexionWeightsForMap(mapId);
      const expectedShare =
        expected.slice(COMPLEXION_RAMP_LENGTH / 2).reduce((a, b) => a + b, 0) /
        COMPLEXION_PALETTE_SLOTS;
      expect(share(COMPLEXION_RAMP_LENGTH / 2)).toBeCloseTo(expectedShare, 1);
      // Nobody's complexion is decided by which rig they wear any more: each
      // model index must span more than one tone.
      const byModel = new Map<number, Set<number>>();
      for (const [index, tone] of drawn.entries()) {
        const model = index % 5;
        const tones = byModel.get(model) ?? new Set<number>();
        tones.add(rampIndex(reference, tone));
        byModel.set(model, tones);
      }
      for (const tones of byModel.values()) expect(tones.size).toBeGreaterThan(1);
    }
  });

  it("keeps every tone a plausible, in-gamut colour", () => {
    for (const tone of complexionPaletteForMap("nyc-upper-west-side")) {
      for (const channel of [tone.r, tone.g, tone.b] as const) {
        expect(channel).toBeGreaterThan(0);
        expect(channel).toBeLessThan(1);
      }
      // Warm hue: red leads green leads blue, as complexions do.
      expect(tone.r).toBeGreaterThan(tone.g);
      expect(tone.g).toBeGreaterThan(tone.b);
    }
  });
});
