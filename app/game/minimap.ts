// Pure top-down projection for the corner minimap. World coordinates are centred
// on the origin and span the map's worldSize; these helpers fit that box into a
// square canvas so the driving view can rasterise the road network once and then
// overlay the live player pose + pins each frame. No rendering here — just maths,
// so it is trivially unit-testable.

export interface MinimapPoint {
  readonly x: number;
  readonly y: number;
}

export interface MinimapWorldSize {
  readonly x: number;
  readonly z: number;
}

export interface MinimapProjector {
  readonly size: number;
  /** Maps a centred world position (metres) to minimap pixel coordinates. */
  project(worldX: number, worldZ: number): MinimapPoint;
}

/**
 * Builds a square projector that fits the map's worldSize inside a `size`×`size`
 * canvas (minus `padding` on each edge), preserving aspect and flipping +z
 * (north) to screen-up.
 */
export function createMinimapProjector(
  worldSize: MinimapWorldSize,
  size: number,
  padding = 6,
): MinimapProjector {
  const usable = Math.max(1, size - padding * 2);
  const scale = Math.min(
    usable / Math.max(1, worldSize.x),
    usable / Math.max(1, worldSize.z),
  );
  const center = size / 2;
  return {
    size,
    project(worldX, worldZ) {
      return { x: center + worldX * scale, y: center - worldZ * scale };
    },
  };
}

/** Projects road-surface centrelines into minimap polylines for drawing. */
export function projectRoadNetwork(
  roadSurfaces: readonly {
    readonly centerline: readonly { readonly x: number; readonly z: number }[];
  }[],
  projector: MinimapProjector,
): MinimapPoint[][] {
  return roadSurfaces.map((surface) =>
    surface.centerline.map((point) => projector.project(point.x, point.z)),
  );
}
