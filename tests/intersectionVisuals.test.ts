import { describe, expect, it } from "vitest";
import { getMapPack, MAP_PACKS } from "../app/game/content";
import { roadAxisHeadingNear, signalStopBarSegment } from "../app/game/GameCanvas";
import type { LaneSegment, MapPack } from "../app/game/types";

/**
 * Issue #149: at signalised junctions the stop bars rendered slanted — the
 * bar was laid perpendicular to the lane's local centreline heading, which
 * bends through the junction connector blend — and every signal head hung
 * from a mast on the near corner, directly above the waiting car, where the
 * driver cannot see their own light. Bars must sit square to the road, and
 * NYC masts must stand across the junction from the approach they govern.
 */

const wrapRad = (angle: number): number => {
  let wrapped = angle % (Math.PI * 2);
  if (wrapped > Math.PI) wrapped -= Math.PI * 2;
  if (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
};

/** Mirrors the renderer's resolveLaneAnchor arc walk. */
const anchorPose = (
  lane: LaneSegment,
  distanceAlongM: number,
): { x: number; z: number; heading: number } | null => {
  let remaining = Math.max(0, distanceAlongM);
  for (let index = 0; index < lane.centerline.length - 1; index += 1) {
    const start = lane.centerline[index];
    const end = lane.centerline[index + 1];
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    if (length < 0.001) continue;
    if (remaining <= length || index === lane.centerline.length - 2) {
      const amount = Math.min(remaining, length) / length;
      return {
        x: start.x + (end.x - start.x) * amount,
        z: start.z + (end.z - start.z) * amount,
        heading: Math.atan2(end.x - start.x, end.z - start.z),
      };
    }
    remaining -= length;
  }
  return null;
};

const stopBars = (pack: MapPack) => {
  const laneById = new Map(pack.laneGraph.lanes.map((lane) => [lane.id, lane]));
  const bars: {
    controlId: string;
    approachId: string;
    laneId: string;
    start: { x: number; z: number };
    end: { x: number; z: number };
    surface: (typeof pack.geometry.roadSurfaces)[number] | undefined;
    stop: { x: number; z: number; heading: number };
  }[] = [];
  for (const control of pack.laneGraph.controls) {
    for (const approach of control.approaches ?? []) {
      const lane = laneById.get(approach.stopLine.laneId);
      if (!lane) continue;
      const stop = anchorPose(lane, approach.stopLine.distanceAlongM);
      if (!stop) continue;
      const surface = pack.geometry.roadSurfaces?.find((candidate) =>
        candidate.laneIds.includes(lane.id),
      );
      const bar = signalStopBarSegment(stop, lane, surface);
      bars.push({
        controlId: control.id,
        approachId: approach.id,
        laneId: lane.id,
        ...bar,
        surface,
        stop,
      });
    }
  }
  return bars;
};

describe("signal stop bars (#149)", () => {
  it("paints every stop bar square to its road surface", () => {
    let checked = 0;
    for (const pack of MAP_PACKS) {
      for (const bar of stopBars(pack)) {
        if (!bar.surface) continue;
        const axis = roadAxisHeadingNear(bar.surface.centerline, bar.stop);
        if (axis === null) continue;
        const barDirection = Math.atan2(
          bar.end.x - bar.start.x,
          bar.end.z - bar.start.z,
        );
        checked += 1;
        // A bar square to the road is perpendicular to the surface axis.
        expect(
          Math.abs(Math.cos(barDirection - axis)),
          `${pack.id}/${bar.controlId}/${bar.approachId}`,
        ).toBeLessThan(0.02);
      }
    }
    expect(checked, "signal approaches with surfaces").toBeGreaterThan(40);
  });

  it("keeps NYC's grid stop bars exactly axis-aligned", () => {
    // The issue's screenshot: the two Amsterdam approach bars tilted ±7.2deg
    // into a shallow V at the road centre. On an orthogonal grid every bar
    // must run exactly east-west or north-south.
    const pack = getMapPack("nyc-upper-west-side");
    const bars = stopBars(pack);
    expect(bars.length).toBeGreaterThan(30);
    for (const bar of bars) {
      const dx = Math.abs(bar.end.x - bar.start.x);
      const dz = Math.abs(bar.end.z - bar.start.z);
      expect(
        Math.min(dx, dz),
        `${bar.controlId}/${bar.approachId} off-axis drift`,
      ).toBeLessThan(0.005);
    }
  });

  it("merges parallel one-way lanes' bars into one continuous line", () => {
    // Amsterdam & 79th, the junction in the issue screenshot: both northbound
    // lanes' bars must sit on the same east-west line with overlapping spans.
    const pack = getMapPack("nyc-upper-west-side");
    const bars = stopBars(pack).filter((bar) =>
      ["nyc-amst-n-1a", "nyc-amst-n-2a"].includes(bar.laneId),
    );
    expect(bars).toHaveLength(2);
    const zs = bars.flatMap((bar) => [bar.start.z, bar.end.z]);
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(0.005);
    const [left, right] = bars.map((bar) =>
      [bar.start.x, bar.end.x].sort((a, b) => a - b),
    );
    const overlap =
      Math.min(left[1], right[1]) - Math.max(left[0], right[0]);
    expect(overlap, "bars overlap into one line").toBeGreaterThan(0);
  });
});

describe("NYC signal masts (#149)", () => {
  const pack = getMapPack("nyc-upper-west-side");
  const laneById = new Map(pack.laneGraph.lanes.map((lane) => [lane.id, lane]));
  const signals = pack.laneGraph.controls.filter(
    (control) => control.type === "signal",
  );

  it("stands every mast across the junction from its approach", () => {
    expect(signals.length).toBeGreaterThan(10);
    for (const control of signals) {
      const approachById = new Map(
        (control.approaches ?? []).map((approach) => [approach.id, approach]),
      );
      for (const installation of control.installations ?? []) {
        const approachIds = installation.approachIds ?? [];
        expect(approachIds.length, `${installation.id} approaches`).toBeGreaterThan(0);
        for (const approachId of approachIds) {
          const approach = approachById.get(approachId);
          expect(approach, `${installation.id} -> ${approachId}`).toBeDefined();
          const lane = laneById.get(approach!.stopLine.laneId)!;
          const first = lane.centerline[0];
          const last = lane.centerline[lane.centerline.length - 1];
          const length = Math.hypot(last.x - first.x, last.z - first.z);
          const travelX = (last.x - first.x) / length;
          const travelZ = (last.z - first.z) / length;
          const forward =
            (installation.position.x - control.position.x) * travelX +
            (installation.position.z - control.position.z) * travelZ;
          // The pole must stand past the node in the direction of travel —
          // the driver waiting at the stop line looks across the junction at
          // their own light, the way NYC mounts its signals.
          expect(forward, `${installation.id} forward of node`).toBeGreaterThan(4);
        }
      }
      const approachesCovered = (control.installations ?? []).flatMap(
        (installation) => installation.approachIds ?? [],
      );
      expect(new Set(approachesCovered).size, `${control.id} coverage`).toBe(
        (control.approaches ?? []).length,
      );
    }
  });

  it("gives each approach direction exactly one mast, clear of the others", () => {
    for (const control of signals) {
      const installations = control.installations ?? [];
      for (let a = 0; a < installations.length; a += 1) {
        expect(
          Math.abs(installations[a].headingDeg % 90),
          `${installations[a].id} grid heading`,
        ).toBeLessThan(1e-6);
        for (let b = a + 1; b < installations.length; b += 1) {
          const gap = Math.hypot(
            installations[a].position.x - installations[b].position.x,
            installations[a].position.z - installations[b].position.z,
          );
          expect(gap, `${installations[a].id} vs ${installations[b].id}`).toBeGreaterThan(1);
        }
      }
    }
  });
});

describe("roadAxisHeadingNear", () => {
  it("returns the nearest segment's heading", () => {
    const polyline = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
    ];
    expect(roadAxisHeadingNear(polyline, { x: 5, z: 1 })).toBeCloseTo(Math.PI / 2, 6);
    expect(roadAxisHeadingNear(polyline, { x: 11, z: 8 })).toBeCloseTo(0, 6);
    expect(
      Math.abs(wrapRad(roadAxisHeadingNear(polyline, { x: 2, z: -3 })! - Math.PI / 2)),
    ).toBeLessThan(1e-6);
  });

  it("returns null without a usable segment", () => {
    expect(roadAxisHeadingNear([], { x: 0, z: 0 })).toBeNull();
    expect(roadAxisHeadingNear([{ x: 1, z: 1 }], { x: 0, z: 0 })).toBeNull();
    expect(
      roadAxisHeadingNear([{ x: 1, z: 1 }, { x: 1, z: 1 }], { x: 0, z: 0 }),
    ).toBeNull();
  });
});
