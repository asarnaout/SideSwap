import { describe, expect, it } from "vitest";
import { MAP_PACKS, getCountryProfile } from "../app/game/content";
import type { LaneSegment, MapPack, RoadSurface } from "../app/game/types";

/**
 * Invariants for "would a real driver read this road the way we mean it?".
 *
 * These are content rules, not rendering rules — they hold on the authored
 * data, so they catch a mis-painted street the moment it lands rather than
 * three months later in a screenshot. Issue #5 was exactly that: West 72nd,
 * 79th and 86th are two-way, but a white centre line means "same direction"
 * in the US, so all three read as one-way avenues — indistinguishable from
 * Amsterdam and Columbus, which genuinely are one-way.
 */

const CENTRE_STYLES = new Set(["centre_solid", "centre_dashed"]);
/** Divider and edge paint is white in every country we ship. */
const WHITE_STYLES = new Set(["lane_solid", "lane_dashed", "edge_solid"]);

const directionsOf = (lanes: readonly LaneSegment[]): Set<string> => {
  const directions = new Set<string>();
  for (const lane of lanes) {
    const from = lane.centerline[0];
    const to = lane.centerline[lane.centerline.length - 1];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    directions.add(
      Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? "E" : "W") : dz >= 0 ? "N" : "S",
    );
  }
  return directions;
};

const surfacesOf = (
  pack: MapPack,
): { surface: RoadSurface; lanes: LaneSegment[]; twoWay: boolean }[] => {
  const byId = new Map(pack.laneGraph.lanes.map((lane) => [lane.id, lane]));
  return (pack.geometry.roadSurfaces ?? []).map((surface) => {
    const lanes = surface.laneIds.flatMap((id) => {
      const lane = byId.get(id);
      return lane ? [lane] : [];
    });
    return { surface, lanes, twoWay: directionsOf(lanes).size > 1 };
  });
};

describe("road markings read the way a local driver expects", () => {
  it("paints every centre line in the host country's colour", () => {
    // The one that matters: North America reserves white for lanes running the
    // same way, so a white centre line there says "one-way street".
    for (const pack of MAP_PACKS) {
      const country = getCountryProfile(pack.countryIds[0]);
      for (const { surface } of surfacesOf(pack)) {
        for (const marking of surface.markings) {
          if (!CENTRE_STYLES.has(marking.style)) continue;
          expect(
            marking.color ?? "white",
            `${pack.id}/${surface.id}/${marking.id} separates opposing traffic in ${country.countryName}`,
          ).toBe(country.centreLineColor);
        }
      }
    }
  });

  it("keeps lane dividers and edge lines white everywhere", () => {
    for (const pack of MAP_PACKS) {
      for (const { surface } of surfacesOf(pack)) {
        for (const marking of surface.markings) {
          if (!WHITE_STYLES.has(marking.style)) continue;
          expect(
            marking.color ?? "white",
            `${pack.id}/${surface.id}/${marking.id}`,
          ).toBe("white");
        }
      }
    }
  });

  it("never paints a centre line down a one-way road", () => {
    // A centre line promises oncoming traffic. On a one-way street it would
    // have the driver hugging one half of a carriageway that is all theirs.
    for (const pack of MAP_PACKS) {
      for (const { surface, lanes, twoWay } of surfacesOf(pack)) {
        if (twoWay || !lanes.length) continue;
        const centre = surface.markings.filter((m) => CENTRE_STYLES.has(m.style));
        expect(
          centre.map((m) => m.id),
          `${pack.id}/${surface.id} is one-way`,
        ).toEqual([]);
      }
    }
  });

  it("gives every marked two-way road a centre line", () => {
    // An unmarked lane is fine — plenty of real streets have no paint at all.
    // What is not fine is a two-way road marked *only* with lane dividers:
    // that is the paint scheme of a one-way multi-lane road.
    for (const pack of MAP_PACKS) {
      for (const { surface, twoWay } of surfacesOf(pack)) {
        if (!twoWay || !surface.markings.length) continue;
        const hasCentre = surface.markings.some((m) => CENTRE_STYLES.has(m.style));
        expect(hasCentre, `${pack.id}/${surface.id} is two-way but has no centre line`).toBe(
          true,
        );
      }
    }
  });

  it("gives NYC a paint scheme that tells its one-ways from its two-ways", () => {
    // The regression guard for issue #5, spelled out on the map that had it.
    const nyc = MAP_PACKS.find((pack) => pack.id === "nyc-upper-west-side")!;
    const byRoad = new Map(
      surfacesOf(nyc).map((entry) => [entry.surface.id, entry]),
    );
    for (const roadId of [
      "nyc-west-72",
      "nyc-west-79",
      "nyc-west-86",
      "nyc-west-end",
      "nyc-broadway",
      "nyc-central-park-west",
    ]) {
      const entry = byRoad.get(roadId)!;
      expect(entry.twoWay, roadId).toBe(true);
      expect(
        entry.surface.markings.map((m) => `${m.style}/${m.color}`),
        roadId,
      ).toEqual(["centre_solid/yellow"]);
    }
    for (const roadId of ["nyc-amsterdam", "nyc-columbus"]) {
      const entry = byRoad.get(roadId)!;
      expect(entry.twoWay, roadId).toBe(false);
      expect(
        entry.surface.markings.map((m) => `${m.style}/${m.color}`),
        roadId,
      ).toEqual(["lane_dashed/white"]);
    }
  });
});
