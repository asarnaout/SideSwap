/**
 * Per-map complexion palettes for the character models.
 *
 * Each of the five CC0 character rigs ships one baked complexion, so a walker's
 * used to be decided by which rig it wore: five values in total, all sitting in
 * a narrow mid-brown band. These palettes override that value per instance
 * instead, which both widens the range and decouples it from the model — the
 * same rig now turns up across the whole ramp. Weights are per map so a crowd
 * reads as belonging to its city rather than to one global average.
 *
 * Tones are linear RGB, the same space as the glbs' `baseColorFactor` (what
 * `readAlbedo` hands back and what the materials already carry), so a
 * substituted tone lights exactly like an authored one. "Complexion" rather
 * than "skin" throughout: skin/skeleton already mean vertex skinning here.
 */
import { hashStringToSeed, seededUnit } from "./visuals";

export interface ComplexionTone {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * Deep to fair, evenly spaced in perceived lightness: as authored these are
 * sRGB rgb(85,67,56) through rgb(234,215,202). The ramp is pitched brighter
 * than the values it replaces because the scene's daylight lands well under
 * full white on a figure — measured against a render, a tone reads roughly one
 * step darker on screen than on paper, so a ramp authored to look right flat
 * would collapse into the same murk this exists to break up.
 */
const TONE_RAMP: readonly ComplexionTone[] = [
  { r: 0.090, g: 0.056, b: 0.040 },
  { r: 0.145, g: 0.096, b: 0.068 },
  { r: 0.225, g: 0.152, b: 0.104 },
  { r: 0.360, g: 0.255, b: 0.170 },
  { r: 0.560, g: 0.430, b: 0.330 },
  { r: 0.820, g: 0.680, b: 0.590 },
];

/**
 * How many palette slots each ramp entry gets, per map. Every row sums to
 * PALETTE_SLOTS so the maps stay comparable, and a row is a rough read of who
 * actually walks that neighbourhood: the Upper West Side draws flat across the
 * ramp, South Kensington leans a little lighter, and Setagaya — a ward of a
 * city that is overwhelmingly Japanese, with a visible but small international
 * population — sits mostly in the upper half without emptying the lower one.
 */
const PALETTE_SLOTS = 24;

const TONE_WEIGHTS: Readonly<Record<string, readonly number[]>> = {
  "nyc-upper-west-side": [4, 4, 4, 4, 4, 4],
  "london-south-kensington": [2, 3, 4, 5, 5, 5],
  "tokyo-setagaya": [0, 1, 2, 6, 8, 7],
};

/** Maps with no row of their own (the orientation yard, the two cities being
 * retired) still get a spread rather than the rigs' five baked values. */
const DEFAULT_TONE_WEIGHTS: readonly number[] = [1, 2, 3, 5, 6, 7];

export function complexionWeightsForMap(mapId: string): readonly number[] {
  return TONE_WEIGHTS[mapId] ?? DEFAULT_TONE_WEIGHTS;
}

/**
 * Expands a map's weights into one tone per palette slot. Consumers take a slot
 * by `index % length`, so the expanded run is shuffled — seeded on the map id,
 * so a map's crowd is identical run to run — otherwise every low index would
 * land on one end of the ramp and short pools would sample only that end.
 */
export function complexionPaletteForMap(mapId: string): readonly ComplexionTone[] {
  const weights = complexionWeightsForMap(mapId);
  const slots: ComplexionTone[] = [];
  for (const [index, weight] of weights.entries()) {
    const tone = TONE_RAMP[index];
    for (let count = 0; count < weight; count += 1) slots.push(tone);
  }
  const random = seededUnit(hashStringToSeed(`${mapId}-complexions`));
  for (let index = slots.length - 1; index > 0; index -= 1) {
    const swap = Math.min(index, Math.floor(random() * (index + 1)));
    const held = slots[index];
    slots[index] = slots[swap];
    slots[swap] = held;
  }
  return slots;
}

export const COMPLEXION_RAMP_LENGTH = TONE_RAMP.length;
export const COMPLEXION_PALETTE_SLOTS = PALETTE_SLOTS;
