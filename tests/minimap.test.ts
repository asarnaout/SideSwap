import { describe, expect, it } from "vitest";
import {
  createMinimapProjector,
  projectRoadNetwork,
} from "../app/game/minimap";

describe("minimap projection", () => {
  it("maps the world origin to the canvas centre", () => {
    const projector = createMinimapProjector({ x: 640, z: 960 }, 150);
    expect(projector.project(0, 0)).toEqual({ x: 75, y: 75 });
  });

  it("fits the map inside the padded canvas and flips north to up", () => {
    const size = 150;
    const padding = 6;
    const projector = createMinimapProjector({ x: 640, z: 960 }, size, padding);
    // The larger dimension (z = 960) drives the scale; its extremes land on the
    // padded top and bottom edges, north (+z) at the top.
    expect(projector.project(0, 480).y).toBeCloseTo(padding, 5);
    expect(projector.project(0, -480).y).toBeCloseTo(size - padding, 5);
    // +x sits right of centre.
    expect(projector.project(320, 0).x).toBeGreaterThan(75);
    // Every corner stays inside the canvas.
    for (const [x, z] of [
      [320, 480],
      [-320, -480],
      [320, -480],
      [-320, 480],
    ] as const) {
      const point = projector.project(x, z);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(size);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(size);
    }
  });

  it("projects road centrelines to polylines", () => {
    const projector = createMinimapProjector({ x: 100, z: 100 }, 100, 0);
    const lines = projectRoadNetwork(
      [{ centerline: [{ x: -50, z: 0 }, { x: 50, z: 0 }] }],
      projector,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual([
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ]);
  });
});
