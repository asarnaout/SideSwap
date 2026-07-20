/**
 * Harmonic tables and noise buffers. Pure: these return plain Float32Arrays and
 * the voices hand them to `createPeriodicWave` / `createBuffer`.
 *
 * The engine table is the single most important thing in the audio layer. A
 * sawtooth puts its strongest spectral line at the fundamental with every
 * harmonic falling off as 1/n; a square has odd harmonics only. Both are
 * mathematically regular, and regularity is exactly what a piston engine lacks.
 * A real four-cylinder fires twice per crank revolution, so its loudest
 * component sits at the *second* order, not the first — and the four-stroke
 * cycle spans two revolutions, which puts real energy at half-orders that no
 * analytic waveform produces at all. Those two facts are most of the difference
 * between "engine" and "synthesiser", and a periodic wave can state them
 * directly.
 */

/**
 * At idle (820rpm) the cycle frequency is 6.8Hz, so partial 384 lands at 2.6kHz
 * — enough top end for idle to have texture. At the redline most of these are
 * above Nyquist and the browser's per-octave band-limited tables simply drop
 * them, so the count costs nothing at runtime.
 */
export const ENGINE_PARTIALS = 384;

/**
 * Harmonic amplitudes for a four-stroke engine, indexed by partial `k` where the
 * oscillator's fundamental is the full four-stroke cycle (rpm/120). Engine order
 * is therefore `k/2`, which makes the three families fall out of the index:
 *
 *   k % cylinders === 0   the firing order and its harmonics — the note itself
 *   k odd                 half-orders — cycle-to-cycle variation, the lumpiness
 *   k even, non-firing    whole engine orders — crank boom
 *
 * The exponential tilt is the source spectrum's own rolloff. Without it the top
 * two hundred partials read as hiss and the expressive lowpass spends its whole
 * range fighting them instead of shaping the note.
 */
export function buildEngineHarmonics(
  partials = ENGINE_PARTIALS,
  cylinders = 4,
): Float32Array {
  const amplitudes = new Float32Array(partials + 1);
  for (let k = 1; k <= partials; k += 1) {
    const base =
      k % cylinders === 0
        ? 1 / Math.pow(k / cylinders, 0.75)
        : k % 2 === 1
          ? 0.3 / Math.pow(k, 1.15)
          : 0.62 / Math.pow(k, 0.8);
    amplitudes[k] = base * Math.exp(-k / 140);
  }
  return amplitudes;
}

/**
 * A brighter, saw-like table for the intake-howl layer, which runs at the firing
 * frequency rather than the cycle frequency and only opens up under load.
 */
export function buildEngineTopHarmonics(partials = 48): Float32Array {
  const amplitudes = new Float32Array(partials + 1);
  for (let k = 1; k <= partials; k += 1) {
    amplitudes[k] = 1 / Math.pow(k, 1.05);
  }
  return amplitudes;
}

/**
 * A horn diaphragm driving a flared throat. Even *and* odd harmonics with a slow
 * rolloff — a square wave's odd-only spectrum is the hollow, clarinet-like
 * quality that makes a synthesised horn read as a game beep — plus a deliberate
 * bump around the fourth to sixth partials for the flare's formant.
 */
export function buildHornHarmonics(): Float32Array {
  return Float32Array.from([
    0, 1, 0.78, 0.62, 0.72, 0.66, 0.55, 0.42, 0.35, 0.22, 0.19, 0.15, 0.13, 0.11,
    0.095, 0.082, 0.07, 0.06, 0.052, 0.045, 0.038, 0.032, 0.027, 0.023, 0.019,
  ]);
}

/** Fills `out` with white noise in [-1, 1]. */
export function fillWhiteNoise(out: Float32Array, random: () => number): void {
  for (let i = 0; i < out.length; i += 1) out[i] = random() * 2 - 1;
}

const normalise = (out: Float32Array): void => {
  let peak = 0;
  for (let i = 0; i < out.length; i += 1) peak = Math.max(peak, Math.abs(out[i]));
  if (peak <= 0) return;
  const scale = 1 / peak;
  for (let i = 0; i < out.length; i += 1) out[i] *= scale;
};

/**
 * Pink noise — energy falling at 3dB per octave, via Paul Kellet's filter bank.
 *
 * This matters more than it sounds. White noise carries equal energy per hertz,
 * but hearing is roughly logarithmic, so half of a white signal's power sits in
 * its top octave and it reads as bright electronic hiss. Pink spreads energy
 * evenly per octave, which is what wind, rain and surf actually do — and it is
 * the difference between "air rushing past the car" and "untuned television".
 */
export function fillPinkNoise(out: Float32Array, random: () => number): void {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < out.length; i += 1) {
    const white = random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
  }
  normalise(out);
}

const addValueNoiseOctave = (
  out: Float32Array,
  sampleRate: number,
  hz: number,
  amplitude: number,
  random: () => number,
): void => {
  const period = Math.max(2, Math.round(sampleRate / hz));
  const points = Math.max(2, Math.ceil(out.length / period));
  const control = new Float32Array(points);
  for (let i = 0; i < points; i += 1) control[i] = random() * 2 - 1;
  for (let i = 0; i < out.length; i += 1) {
    const position = i / period;
    const index = Math.floor(position) % points;
    const next = (index + 1) % points;
    const fraction = position - Math.floor(position);
    // Smoothstep rather than linear: no corner at each control point, which
    // would otherwise be audible as a faint tick when this modulates pitch.
    const blend = fraction * fraction * (3 - 2 * fraction);
    out[i] += (control[index] + (control[next] - control[index]) * blend) * amplitude;
  }
};

/**
 * Two octaves of interpolated random control points, normalised to [-1, 1].
 *
 * This is the idle wobble and the tyre warble. An LFO would be cheaper but it is
 * periodic, and you hear the loop within seconds; fractal value noise wanders.
 * Because it is a plain buffer it can be connected straight to an AudioParam —
 * AudioParams sum their connected inputs with their intrinsic value — so the
 * modulation runs entirely on the audio thread with no per-frame JavaScript.
 */
export function fillValueNoise(
  out: Float32Array,
  sampleRate: number,
  hz: number,
  random: () => number,
): void {
  out.fill(0);
  addValueNoiseOctave(out, sampleRate, hz, 1, random);
  addValueNoiseOctave(out, sampleRate, hz * 3.2, 0.35, random);
  normalise(out);
}
