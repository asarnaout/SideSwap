import { Matrix, Quaternion, Vector3 } from "@babylonjs/core";
import { describe, expect, it } from "vitest";
import {
  alignedVatOffset,
  composeYawTranslation16,
  conjugatePose,
  mulMatrix16,
  partitionWalkersByVariant,
  rebaseVatOffset,
  vatFrame,
  vatFrameWindowed,
} from "../app/game/crowdRenderMath";

const closeTo = (actual: ArrayLike<number>, expected: ArrayLike<number>, tolerance = 1e-5) => {
  for (let index = 0; index < 16; index += 1) {
    expect(actual[index], `element ${index}`).toBeCloseTo(expected[index], tolerance > 1e-5 ? 3 : 5);
  }
};

function randomAffine(seed: number): Matrix {
  // A representative host-mesh world matrix: non-uniform-ish scale, a mirror
  // (the glTF handedness flip), rotation and translation.
  const rotation = Quaternion.FromEulerAngles(seed * 0.7, seed * 1.3, seed * 0.2);
  const matrix = Matrix.Compose(
    new Vector3(0.374 * (seed % 2 === 0 ? -1 : 1), 0.374, 0.374),
    rotation,
    new Vector3(seed, seed * 2, -seed),
  );
  return matrix;
}

describe("mulMatrix16", () => {
  it("matches Babylon's Matrix.multiply exactly", () => {
    const a = randomAffine(3);
    const b = randomAffine(5);
    const out = new Float32Array(16);
    mulMatrix16(out, 0, a.m, b.m);
    const babylon = a.multiply(b);
    closeTo(out, babylon.m);
  });
});

describe("composeYawTranslation16", () => {
  it("matches RotationY then Translation, and faces the heading convention", () => {
    const out = new Float32Array(16);
    composeYawTranslation16(out, 0, 4, 0.08, -7, 0.83);
    const babylon = Matrix.RotationY(0.83).multiply(Matrix.Translation(4, 0.08, -7));
    closeTo(out, babylon.m);
    // heading = atan2(dx, dz): a model facing +Z rotated by yaw must face
    // (sin yaw, 0, cos yaw).
    const forward = Vector3.TransformNormal(new Vector3(0, 0, 1), Matrix.FromArray([...out]));
    expect(forward.x).toBeCloseTo(Math.sin(0.83), 5);
    expect(forward.z).toBeCloseTo(Math.cos(0.83), 5);
  });
});

describe("conjugatePose", () => {
  it("makes thin · W0 equal W0 · pose, including for a mirroring W0", () => {
    for (const seed of [1, 2, 3, 4]) {
      const w0 = randomAffine(seed);
      const w0Inverse = w0.clone().invert();
      const out = new Float32Array(32);
      conjugatePose(out, 1, w0.m, w0Inverse.m, 3, 0.08, -2, 1.2);
      const thin = Matrix.FromArray([...out.slice(16, 32)]);
      const pose = Matrix.RotationY(1.2).multiply(Matrix.Translation(3, 0.08, -2));
      // The shader applies thin then W0; the walker wants W0 then pose.
      closeTo(thin.multiply(w0).m, w0.multiply(pose).m, 1e-3);
      // Winding never flips: the conjugate keeps a positive determinant.
      expect(thin.determinant()).toBeGreaterThan(0);
    }
  });
});

describe("rebaseVatOffset", () => {
  it("keeps the displayed frame continuous across a cadence change", () => {
    const totalFrames = 60;
    for (const [time, oldFps, newFps, oldOffset] of [
      [12.34, 60, 15, 7],
      [3.21, 45, 90, 31.5],
      [123.456, 66, 33, 0],
      [0.5, 30, 96, 59],
    ] as const) {
      const before = vatFrame(time, oldFps, oldOffset, totalFrames);
      const rebased = rebaseVatOffset(time, oldFps, newFps, oldOffset, totalFrames);
      const after = vatFrame(time, newFps, rebased, totalFrames);
      expect(rebased).toBeGreaterThanOrEqual(0);
      expect(rebased).toBeLessThan(totalFrames);
      // Allow the shader's floor to land one frame off either side.
      const distance = Math.min(
        Math.abs(after - before),
        totalFrames - Math.abs(after - before),
      );
      expect(distance, `time ${time}`).toBeLessThanOrEqual(1);
    }
  });
});

describe("partitionWalkersByVariant", () => {
  it("covers every walker exactly once with stable per-model lists", () => {
    const variants = [0, 1, 2, 0, 1, 2, 0, 4, 5];
    const partition = partitionWalkersByVariant(variants, 3);
    expect(partition).toHaveLength(3);
    const seen = partition.flat().sort((a, b) => a - b);
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(partition[0]).toEqual([0, 3, 6]);
    expect(partition[1]).toEqual([1, 4, 7]);
    expect(partition[2]).toEqual([2, 5, 8]);
  });
});

describe("vatFrameWindowed / alignedVatOffset", () => {
  it("mirrors the shader's windowed frame formula, correction included", () => {
    // Early in the clock (under one cycle) there is no frame correction…
    expect(vatFrameWindowed(0, 30, 0, 40, 79)).toBe(40);
    // …after a full cycle the modulus drops to len-1 and frames start at +1.
    const late = vatFrameWindowed(100, 30, 0, 40, 79);
    expect(late).toBeGreaterThanOrEqual(41);
    expect(late).toBeLessThanOrEqual(79);
  });

  it("aligns any window to its first frame at any clock time", () => {
    for (const time of [0.4, 7.13, 63.7, 512.9]) {
      for (const [fps, start, end] of [
        [48, 0, 35],
        [50 / 0.96, 36, 85],
        [61.2, 86, 135],
      ] as const) {
        const offset = alignedVatOffset(time, fps, start, end);
        const frame = vatFrameWindowed(time, fps, offset, start, end);
        // First frame, allowing the shader's +1 start-up correction.
        expect(frame).toBeGreaterThanOrEqual(start);
        expect(frame).toBeLessThanOrEqual(start + 1);
      }
    }
  });

  it("plays a one-shot window through in order after alignment", () => {
    const fps = 50;
    const start = 40;
    const end = 89;
    const t0 = 33.33;
    const offset = alignedVatOffset(t0, fps, start, end);
    let previous = -1;
    // One window pass lasts len/fps = 1s; sample the first 0.95s.
    for (let step = 0; step <= 57; step += 1) {
      const frame = vatFrameWindowed(t0 + step / 60, fps, offset, start, end);
      expect(frame).toBeGreaterThanOrEqual(previous);
      previous = frame;
    }
    expect(previous).toBeGreaterThan(start + 40);
  });

  it("holds a single-frame window regardless of time", () => {
    for (const time of [0, 12.7, 400.01]) {
      expect(vatFrameWindowed(time, 0, 0, 85, 85)).toBe(85);
    }
  });
});
