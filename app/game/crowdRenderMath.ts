// The per-frame arithmetic behind the thin-instanced crowd, kept pure so the
// matrix conventions — the one part of GPU crowd rendering that fails
// silently, as a crowd of inside-out or moonwalking pedestrians — are pinned
// by unit tests against Babylon's own Matrix class rather than eyeballed.
//
// Convention: 16-element row-major arrays composing left-to-right for row
// vectors (v' = v·M, translation in elements 12–14), exactly Babylon's
// storage. The VAT shader applies, in order: baked bone pose, then the
// per-instance thin matrix, then the host mesh's world matrix W0 (which
// carries the glTF handedness flip, the yaw correction and the model scale).
// To make a walker pose apply in *world* space the thin matrix must be the
// conjugate W0 · Pose · W0⁻¹, so the net chain collapses to W0 · Pose.

/** out[outOffset..+16] = a · b (row-vector composition: apply a, then b). */
export function mulMatrix16(
  out: Float32Array,
  outOffset: number,
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): void {
  for (let row = 0; row < 4; row += 1) {
    const a0 = a[row * 4];
    const a1 = a[row * 4 + 1];
    const a2 = a[row * 4 + 2];
    const a3 = a[row * 4 + 3];
    out[outOffset + row * 4] = a0 * b[0] + a1 * b[4] + a2 * b[8] + a3 * b[12];
    out[outOffset + row * 4 + 1] = a0 * b[1] + a1 * b[5] + a2 * b[9] + a3 * b[13];
    out[outOffset + row * 4 + 2] = a0 * b[2] + a1 * b[6] + a2 * b[10] + a3 * b[14];
    out[outOffset + row * 4 + 3] = a0 * b[3] + a1 * b[7] + a2 * b[11] + a3 * b[15];
  }
}

/** Writes yaw-then-translate into out: the pose of a walker standing at
 * (x, y, z) facing `yawRad` in the project's atan2(dx, dz) convention. */
export function composeYawTranslation16(
  out: Float32Array,
  outOffset: number,
  x: number,
  y: number,
  z: number,
  yawRad: number,
): void {
  const c = Math.cos(yawRad);
  const s = Math.sin(yawRad);
  out[outOffset] = c;
  out[outOffset + 1] = 0;
  out[outOffset + 2] = -s;
  out[outOffset + 3] = 0;
  out[outOffset + 4] = 0;
  out[outOffset + 5] = 1;
  out[outOffset + 6] = 0;
  out[outOffset + 7] = 0;
  out[outOffset + 8] = s;
  out[outOffset + 9] = 0;
  out[outOffset + 10] = c;
  out[outOffset + 11] = 0;
  out[outOffset + 12] = x;
  out[outOffset + 13] = y;
  out[outOffset + 14] = z;
  out[outOffset + 15] = 1;
}

const SCRATCH_POSE = new Float32Array(16);
const SCRATCH_PRODUCT = new Float32Array(16);

/**
 * Writes the conjugated thin-instance matrix W0 · Pose · W0⁻¹ for a walker at
 * (x, y, z) facing yawRad, into `out` at instance slot `instanceIndex`. The
 * conjugate's determinant is positive even when W0 mirrors (the glTF flip),
 * so per-instance winding never flips relative to the host mesh.
 */
export function conjugatePose(
  out: Float32Array,
  instanceIndex: number,
  w0: ArrayLike<number>,
  w0Inverse: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  yawRad: number,
): void {
  composeYawTranslation16(SCRATCH_POSE, 0, x, y, z, yawRad);
  mulMatrix16(SCRATCH_PRODUCT, 0, w0, SCRATCH_POSE);
  mulMatrix16(out, instanceIndex * 16, SCRATCH_PRODUCT, w0Inverse);
}

/**
 * A new VAT offset that keeps the visible animation frame continuous when an
 * instance's frame rate changes mid-loop (a walker pausing, resuming, or being
 * recycled to a new cadence). Mirrors the shader's frame formula
 * `frame = mod(fract(time·fps/totalFrames)·frames + offset, frames)`; the
 * shader's one-frame start-up correction is ignored, so continuity is within
 * a single frame — invisible at a 60-frame walk cycle with no interpolation.
 */
export function rebaseVatOffset(
  time: number,
  oldFps: number,
  newFps: number,
  oldOffset: number,
  totalFrames: number,
): number {
  const fract = (value: number) => value - Math.floor(value);
  const shift =
    (fract((time * oldFps) / totalFrames) - fract((time * newFps) / totalFrames)) *
    totalFrames;
  const offset = (oldOffset + shift) % totalFrames;
  return offset < 0 ? offset + totalFrames : offset;
}

/** The frame the shader will display — used by tests to pin continuity. */
export function vatFrame(
  time: number,
  fps: number,
  offset: number,
  totalFrames: number,
): number {
  const fract = (value: number) => value - Math.floor(value);
  const raw = fract((time * fps) / totalFrames) * totalFrames + offset;
  return Math.floor(raw % totalFrames);
}

/** Stable per-model index lists; variants never change, so this is computed
 * once and the per-model thin-instance buffers keep a constant size. */
export function partitionWalkersByVariant(
  variants: readonly number[],
  modelCount: number,
): number[][] {
  const partition: number[][] = Array.from({ length: Math.max(1, modelCount) }, () => []);
  for (const [index, variant] of variants.entries()) {
    partition[Math.abs(variant) % partition.length].push(index);
  }
  return partition;
}
