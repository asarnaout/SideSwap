import { describe, expect, it } from "vitest";
import { getMapPack, MAP_PACKS } from "../app/game/content";
import {
  regulatorySignPlacements,
  regulatorySignYawRad,
  type RegulatorySignPlacement,
} from "../app/game/regulatorySigns";

/**
 * Regulatory signs are derived from the lane graph so signage can never
 * disagree with the wrong-way rules the simulation enforces. These tests pin
 * the full NYC inventory (the map's one-way roads are Amsterdam, northbound
 * at x=40, and Columbus, southbound at x=180) and the facing contract: DO NOT
 * ENTER / WRONG WAY message faces point along legal flow — at would-be
 * wrong-way drivers — so legal traffic only ever sees their gray backs.
 */

const nycPlacements = (): readonly RegulatorySignPlacement[] => {
  const pack = getMapPack("nyc-upper-west-side");
  return regulatorySignPlacements({
    lanes: pack.laneGraph.lanes,
    roadSurfaces: pack.geometry.roadSurfaces,
    defaultRoadWidthM: pack.geometry.roadWidth,
  });
};

const byKind = (
  placements: readonly RegulatorySignPlacement[],
  kind: RegulatorySignPlacement["kind"],
) => placements.filter((placement) => placement.kind === kind);

const coordinateSet = (placements: readonly RegulatorySignPlacement[]) =>
  new Set(
    placements.map(
      (placement) =>
        `${Math.round(placement.x * 20) / 20},${Math.round(placement.z * 20) / 20}`,
    ),
  );

describe("NYC regulatory sign inventory", () => {
  const placements = nycPlacements();

  it("emits exactly the derived post counts", () => {
    expect(byKind(placements, "one_way")).toHaveLength(8);
    expect(byKind(placements, "do_not_enter")).toHaveLength(8);
    expect(byKind(placements, "wrong_way")).toHaveLength(16);
  });

  it("places ONE WAY posts at all four enterable one-way mouths", () => {
    const posts = coordinateSet(byKind(placements, "one_way"));
    // Amsterdam departs 72nd and 79th northward; Columbus departs 79th and
    // 86th southward. Lateral = 9/2 + 0.9 = 5.4 m off the road centreline.
    for (const expected of [
      "34.6,-470", "45.4,-470",
      "34.6,10", "45.4,10",
      "174.6,-10", "185.4,-10",
      "174.6,470", "185.4,470",
    ]) {
      expect(posts, `one_way post at (${expected})`).toContain(expected);
    }
  });

  it("places DO NOT ENTER pairs at all four forbidden mouths", () => {
    const posts = coordinateSet(byKind(placements, "do_not_enter"));
    for (const expected of [
      "34.6,-10", "45.4,-10",   // Amsterdam south arm at 79th
      "34.6,470", "45.4,470",   // Amsterdam terminus at 86th
      "174.6,10", "185.4,10",   // Columbus north arm at 79th
      "174.6,-470", "185.4,-470", // Columbus terminus at 72nd (issue example)
    ]) {
      expect(posts, `do_not_enter post at (${expected})`).toContain(expected);
    }
  });

  it("repeats WRONG WAY pairs at 35 m and mid-block on every one-way block", () => {
    const posts = coordinateSet(byKind(placements, "wrong_way"));
    for (const expected of [
      "34.6,-35", "45.4,-35", "34.6,-240", "45.4,-240", // Amst 72->79
      "34.6,445", "45.4,445", "34.6,240", "45.4,240",   // Amst 79->86
      "174.6,35", "185.4,35", "174.6,240", "185.4,240", // Col 86->79
      "174.6,-445", "185.4,-445", "174.6,-240", "185.4,-240", // Col 79->72
    ]) {
      expect(posts, `wrong_way post at (${expected})`).toContain(expected);
    }
  });

  it("points every message face along the legal flow", () => {
    for (const placement of placements) {
      const northbound = Math.abs(placement.x - 40) < 7; // Amsterdam corridor
      const expected = northbound ? 0 : Math.PI;
      const difference = Math.abs(
        Math.atan2(
          Math.sin(placement.flowHeadingRad - expected),
          Math.cos(placement.flowHeadingRad - expected),
        ),
      );
      expect(difference, placement.refId).toBeLessThan(1e-6);
    }
  });

  it("keeps every post inside the one-way corridors", () => {
    // Two-way roads (WE/Broadway/CPW, 72nd/79th/86th) must stay unsigned.
    for (const placement of placements) {
      expect(
        Math.abs(placement.x - 40) < 7 || Math.abs(placement.x - 180) < 7,
        `${placement.refId} at x=${placement.x}`,
      ).toBe(true);
    }
  });

  it("faces every DO NOT ENTER at its junction", () => {
    const pack = getMapPack("nyc-upper-west-side");
    const nodeKeys = new Set(
      pack.laneGraph.lanes.flatMap((lane) => [
        `${Math.round(lane.centerline[0].x)},${Math.round(lane.centerline[0].z)}`,
        `${Math.round(lane.centerline[lane.centerline.length - 1].x)},${Math.round(lane.centerline[lane.centerline.length - 1].z)}`,
      ]),
    );
    for (const placement of byKind(placements, "do_not_enter")) {
      // Walking 10 m along the message-face normal from the post's mouth
      // station must land on the junction node the sign guards.
      const nodeX = placement.x + Math.sin(placement.flowHeadingRad) * 10;
      const nodeZ = placement.z + Math.cos(placement.flowHeadingRad) * 10;
      const lateral = Math.abs(nodeX - 40) < 7 ? nodeX - 40 : nodeX - 180;
      expect(
        nodeKeys.has(
          `${Math.round(nodeX - lateral)},${Math.round(nodeZ)}`,
        ),
        `${placement.refId} faces (${nodeX.toFixed(1)},${nodeZ.toFixed(1)})`,
      ).toBe(true);
    }
  });

  it("stands clear of carriageways and signal masts", () => {
    const pack = getMapPack("nyc-upper-west-side");
    const distanceToPolyline = (
      point: { x: number; z: number },
      polyline: readonly { x: number; z: number }[],
    ): number => {
      let best = Number.POSITIVE_INFINITY;
      for (let index = 0; index + 1 < polyline.length; index += 1) {
        const a = polyline[index];
        const b = polyline[index + 1];
        const abx = b.x - a.x;
        const abz = b.z - a.z;
        const lengthSq = abx * abx + abz * abz;
        const t = lengthSq
          ? Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.z - a.z) * abz) / lengthSq))
          : 0;
        best = Math.min(
          best,
          Math.hypot(point.x - (a.x + abx * t), point.z - (a.z + abz * t)),
        );
      }
      return best;
    };
    for (const placement of placements) {
      for (const surface of pack.geometry.roadSurfaces ?? []) {
        expect(
          distanceToPolyline(placement, surface.centerline),
          `${placement.refId} vs ${surface.id}`,
        ).toBeGreaterThanOrEqual(surface.widthM / 2 + 0.5);
      }
      for (const control of pack.laneGraph.controls) {
        for (const installation of control.installations ?? []) {
          expect(
            Math.hypot(
              placement.x - installation.position.x,
              placement.z - installation.position.z,
            ),
            `${placement.refId} vs ${installation.id}`,
          ).toBeGreaterThanOrEqual(2.5);
        }
      }
    }
  });
});

describe("regulatorySignYawRad", () => {
  it("hangs ONE WAY blades perpendicular to the flow", () => {
    expect(regulatorySignYawRad("one_way", 0)).toBeCloseTo(Math.PI / 2, 9);
  });

  it("turns message faces to look against the flow", () => {
    // Message on the -Z face: mesh yaw = flow + pi puts the -Z normal on the
    // flow heading, so the face reads to a viewer looking against it.
    expect(Math.abs(regulatorySignYawRad("do_not_enter", Math.PI))).toBeLessThan(1e-9);
    expect(regulatorySignYawRad("wrong_way", 0)).toBeCloseTo(Math.PI, 9);
  });
});

describe("robustness across map packs", () => {
  it("derives deterministically", () => {
    expect(nycPlacements()).toEqual(nycPlacements());
  });

  it("runs on every pack and keeps clear of roundabouts", () => {
    for (const pack of MAP_PACKS) {
      const placements = regulatorySignPlacements({
        lanes: pack.laneGraph.lanes,
        roadSurfaces: pack.geometry.roadSurfaces,
        defaultRoadWidthM: pack.geometry.roadWidth,
      });
      const ringEndpoints = pack.laneGraph.lanes
        .filter((lane) => lane.role === "roundabout")
        .flatMap((lane) => [
          lane.centerline[0],
          lane.centerline[lane.centerline.length - 1],
        ]);
      for (const placement of placements) {
        for (const endpoint of ringEndpoints) {
          expect(
            Math.hypot(placement.x - endpoint.x, placement.z - endpoint.z),
            `${pack.id}/${placement.refId}`,
          ).toBeGreaterThan(15);
        }
      }
    }
  });
});
