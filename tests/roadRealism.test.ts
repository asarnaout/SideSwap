import { describe, expect, it } from "vitest";
import { MAP_PACKS, getCountryProfile } from "../app/game/content";
import {
  NPC_PATH_MAX_HOPS,
  buildConnectedNpcPath,
} from "../app/game/npcPaths";
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

const nyc = MAP_PACKS.find((pack) => pack.id === "nyc-upper-west-side")!;

/** heading 0 = +z, increasing clockwise, so a positive delta is a right turn. */
const headingOf = (from: { x: number; z: number }, to: { x: number; z: number }) =>
  Math.atan2(to.x - from.x, to.z - from.z);
const signedTurn = (before: number, after: number): number => {
  let delta = after - before;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
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

describe("NYC junctions connect the way the asphalt suggests", () => {
  const lanes = nyc.laneGraph.lanes;
  const byId = new Map(lanes.map((lane) => [lane.id, lane]));
  const predecessors = new Map<string, string[]>();
  for (const lane of lanes) {
    for (const successor of lane.successors) {
      predecessors.set(successor, [
        ...(predecessors.get(successor) ?? []),
        lane.id,
      ]);
    }
  }

  it("never leaves a driver at a junction with nowhere legal to go", () => {
    // Thirteen of forty-four lanes used to end here — the whole east side of
    // 72nd and 86th, both ends of Central Park West, and the outer lanes of
    // Amsterdam and Columbus.
    const stranded = lanes.filter((lane) => lane.successors.length === 0);
    expect(stranded.map((lane) => lane.id)).toEqual([]);
  });

  it("leaves no lane that no route can enter", () => {
    const orphans = lanes.filter((lane) => !predecessors.has(lane.id));
    expect(orphans.map((lane) => lane.id)).toEqual([]);
  });

  it("lets a driver get from any lane to any other", () => {
    // Strong connectivity is what a grid promises. It is also what the gig
    // pool assumes now that drop-offs are scattered over every street.
    const reach = (from: string, edges: Map<string, string[]>): Set<string> => {
      const seen = new Set([from]);
      const queue = [from];
      while (queue.length) {
        for (const next of edges.get(queue.shift()!) ?? []) {
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      return seen;
    };
    const forward = new Map(lanes.map((lane) => [lane.id, [...lane.successors]]));
    const backward = new Map(
      lanes.map((lane) => [lane.id, predecessors.get(lane.id) ?? []]),
    );
    const root = lanes[0].id;
    expect(reach(root, forward).size, `reachable from ${root}`).toBe(lanes.length);
    expect(reach(root, backward).size, `can reach ${root}`).toBe(lanes.length);
  });

  it("turns out of a one-way avenue from the lane you would really use", () => {
    // Two lanes running the same way is only realistic if the kerbside one
    // takes the right turns and the one against the centreline takes the
    // lefts. It is also what feeds traffic into both of them.
    for (const roadId of ["nyc-amsterdam", "nyc-columbus"]) {
      const surface = nyc.geometry.roadSurfaces.find((s) => s.id === roadId)!;
      const roadLanes = surface.laneIds.map((id) => byId.get(id)!);
      const groups = new Map<string, LaneSegment[]>();
      for (const lane of roadLanes) {
        const key = `${lane.from}->${lane.to}`;
        groups.set(key, [...(groups.get(key) ?? []), lane]);
      }
      for (const [key, pair] of groups) {
        expect(pair.length, `${roadId} ${key}`).toBe(2);
        const heading = headingOf(pair[0].centerline[0], pair[0].centerline.at(-1)!);
        // The kerb is off the right-hand normal (cos h, -sin h), so of the two
        // the lane further along it is the outside one. Measured at the second
        // point, which is where each lane has settled onto its own offset.
        const offset = (lane: LaneSegment) =>
          lane.centerline[1].x * Math.cos(heading) -
          lane.centerline[1].z * Math.sin(heading);
        const [inner, kerbside] = [...pair].sort((a, b) => offset(a) - offset(b));
        for (const [lane, expected] of [
          [inner, "left"],
          [kerbside, "right"],
        ] as const) {
          const leaving = lane.successors
            .map((id) => byId.get(id)!)
            .filter((next) => next.roadId !== lane.roadId);
          expect(leaving.length, `${lane.id} turns off ${roadId}`).toBeGreaterThan(0);
          // End to end, not segment to segment: a lane's last half-metre is the
          // taper into the junction node and points nothing like the road does.
          const turn = signedTurn(
            headingOf(lane.centerline[0], lane.centerline.at(-1)!),
            headingOf(leaving[0].centerline[0], leaving[0].centerline.at(-1)!),
          );
          expect(
            turn > 0 ? "right" : "left",
            `${lane.id} → ${leaving[0].id} should be its ${expected} turn`,
          ).toBe(expected);
        }
      }
    }
  });
});

describe("ambient traffic circulates instead of blinking out", () => {
  // A car whose route ends is deactivated and respawned at its spawn point
  // 2.5 s later (GameCanvas `updateNpcVehicles`). Before the junctions were
  // wired up, every NYC route ended, so all the traffic did this. Cars start
  // on an authored spawn lane or, past the fifth, on an arbitrary lane — and
  // the branch offset is the car's index — so the property has to hold for
  // every lane and every offset, not just the spawn points.
  const EXPECTED_STUBS: Record<string, string[]> = {
    // A bus lane joined by changing lanes, not by turning into it.
    "london-south-kensington": ["london-cromwell-east-bus"],
  };

  for (const pack of MAP_PACKS) {
    it(`keeps every route in ${pack.id} on a circuit`, () => {
      const stranded = new Set<string>();
      for (const lane of pack.laneGraph.lanes) {
        for (let offset = 0; offset < NPC_PATH_MAX_HOPS; offset += 1) {
          const path = buildConnectedNpcPath(
            pack.laneGraph.lanes,
            lane.id,
            offset,
          );
          expect(path.segments.length, `${lane.id} @${offset}`).toBeGreaterThan(0);
          expect(
            path.loopStartSegment,
            `${lane.id} @${offset} wraps inside its route`,
          ).toBeLessThan(path.segments.length);
          if (!path.loop) stranded.add(lane.id);
        }
      }
      expect([...stranded].sort()).toEqual(EXPECTED_STUBS[pack.id] ?? []);
    });
  }
});

describe("NYC controls the junctions a driver expects to be controlled", () => {
  it("puts a signal on every crossing that has traffic on both phases", () => {
    // Manhattan signalises its avenue crossings. The two exempt nodes are the
    // tail ends of the one-way avenues: nothing arrives from the avenue there,
    // so a second phase would just hold the cross street at red for no one.
    const ONE_WAY_TAILS = new Set(["nyc-amst-72", "nyc-col-86"]);
    const inbound = new Map<string, LaneSegment[]>();
    for (const lane of nyc.laneGraph.lanes) {
      inbound.set(lane.to, [...(inbound.get(lane.to) ?? []), lane]);
    }
    const signalled = new Set(
      nyc.laneGraph.controls
        .filter((control) => control.type === "signal")
        .flatMap((control) => control.laneIds),
    );
    for (const node of nyc.laneGraph.nodes) {
      const arrivals = inbound.get(node.id) ?? [];
      const roads = new Set(arrivals.map((lane) => lane.roadId));
      if (roads.size < 2 || ONE_WAY_TAILS.has(node.id)) continue;
      for (const lane of arrivals) {
        expect(
          signalled.has(lane.id),
          `${lane.id} arrives at ${node.id} unsignalled`,
        ).toBe(true);
      }
    }
  });
});
