import { describe, expect, it } from "vitest";
import { MAP_PACKS } from "../app/game/content";
import {
  generateGigFromPools,
  pickGigKind,
  selectGigPools,
} from "../app/game/gigs";
import { resolveSimulationLaneAnchor } from "../app/game/simulationAdapter";
import {
  JUNCTION_CLEARANCE_M,
  MIN_SEPARATION_M,
  generateStreetAddresses,
  type StreetAddress,
  type StreetAddressInput,
} from "../app/game/streetAddresses";
import type { MapPack, WorldPoint } from "../app/game/types";

/**
 * Street addresses are the drop-off points gigs actually use, and nothing about
 * them is hand-authored — they are derived from the lane graph. That makes them
 * exactly the kind of thing that can silently rot: a block resized in content.ts
 * or a lane re-anchored could put a delivery in the middle of a junction, in
 * Central Park, or on the wrong side of the road, and no other test would
 * notice. The invariants below pin down "a drop-off is somewhere you could
 * genuinely pull over and hand a bag to someone".
 */

const nyc = MAP_PACKS.find((pack) => pack.id === "nyc-upper-west-side")!;

const inputFor = (pack: MapPack): StreetAddressInput => ({
  mapId: pack.id,
  lanes: pack.laneGraph.lanes,
  blocks: pack.geometry.blocks,
  landmarks: pack.geometry.landmarks,
  roadSurfaces: pack.geometry.roadSurfaces,
  occupiedPoints: [
    ...(pack.geometry.gigVenues ?? []),
    ...(pack.geometry.servicePoints ?? []),
  ].flatMap((poi) => {
    const pose = resolveSimulationLaneAnchor(pack.laneGraph.lanes, poi.anchor);
    return pose ? [{ x: pose.x, z: pose.z }] : [];
  }),
});

const nycAddresses = generateStreetAddresses(inputFor(nyc));

const distance = (a: WorldPoint, b: WorldPoint): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

const laneLength = (points: readonly WorldPoint[]): number =>
  points
    .slice(1)
    .reduce((total, p, i) => total + distance(p, points[i]), 0);

const kerbOf = (address: StreetAddress): WorldPoint => ({
  x: address.kerbX,
  z: address.kerbZ,
});

describe("procedural street addresses", () => {
  it("covers every NYC street with a workable number of drop-offs", () => {
    // Four authored venues was the whole problem. Anything in this band spreads
    // gigs across the grid; far more would just be noise on the minimap.
    expect(nycAddresses.length).toBeGreaterThanOrEqual(30);
    expect(nycAddresses.length).toBeLessThanOrEqual(120);

    const streets = new Set(
      nycAddresses.map((address) => address.name.replace(/^\d+\s/, "")),
    );
    expect(streets).toEqual(
      new Set([
        "West End Ave",
        "Broadway",
        "Amsterdam Ave",
        "Columbus Ave",
        "Central Park West",
        "W 72nd St",
        "W 79th St",
        "W 86th St",
      ]),
    );
  });

  it("is deterministic, so a street keeps its addresses between runs", () => {
    expect(generateStreetAddresses(inputFor(nyc))).toEqual(nycAddresses);
  });

  it("gives every address a unique id and a unique display name", () => {
    expect(new Set(nycAddresses.map((a) => a.id)).size).toBe(nycAddresses.length);
    expect(new Set(nycAddresses.map((a) => a.name)).size).toBe(nycAddresses.length);
    for (const address of nycAddresses) {
      expect(address.name, address.id).toMatch(/^\d+ \S/);
    }
  });

  it("keeps drop-offs out of junctions", () => {
    for (const address of nycAddresses) {
      const lane = nyc.laneGraph.lanes.find((l) => l.id === address.laneId)!;
      const length = laneLength(lane.centerline);
      expect(address.distanceAlongM, address.name).toBeGreaterThanOrEqual(
        JUNCTION_CLEARANCE_M,
      );
      expect(length - address.distanceAlongM, address.name).toBeGreaterThanOrEqual(
        JUNCTION_CLEARANCE_M,
      );
    }
  });

  it("spaces drop-offs beyond the gig arrival radius", () => {
    // advanceGig() completes within 14 m, so two stops closer than that would
    // both be "the one you're at". This also settles the opposite-kerb case.
    for (let i = 0; i < nycAddresses.length; i += 1) {
      for (let j = i + 1; j < nycAddresses.length; j += 1) {
        expect(
          distance(nycAddresses[i], nycAddresses[j]),
          `${nycAddresses[i].name} vs ${nycAddresses[j].name}`,
        ).toBeGreaterThanOrEqual(MIN_SEPARATION_M);
      }
    }
  });

  it("stands every kerb spot on a sidewalk, never on the carriageway", () => {
    for (const address of nycAddresses) {
      const kerb = kerbOf(address);
      for (const surface of nyc.geometry.roadSurfaces) {
        const clearance = distanceToPolyline(kerb, surface.centerline);
        expect(clearance, `${address.name} on ${surface.id}`).toBeGreaterThan(
          surface.widthM / 2,
        );
      }
    }
  });

  it("only puts addresses where a building actually fronts the street", () => {
    for (const address of nycAddresses) {
      const kerb = kerbOf(address);
      const fronts = nyc.geometry.blocks.some((block) =>
        // The kerb sits on the sidewalk just shy of the block, so allow the
        // frontage probe's reach rather than requiring a strict containment.
        Math.abs(kerb.x - block.center.x) <= block.size.x / 2 + 18 &&
        Math.abs(kerb.z - block.center.z) <= block.size.z / 2 + 18,
      );
      expect(fronts, `${address.name} fronts no block`).toBe(true);
    }
  });

  it("never drops a fare inside a park or the museum grounds", () => {
    for (const address of nycAddresses) {
      for (const landmark of nyc.geometry.landmarks) {
        const inside =
          Math.abs(address.kerbX - landmark.center.x) <= landmark.size.x / 2 &&
          Math.abs(address.kerbZ - landmark.center.z) <= landmark.size.z / 2;
        expect(inside, `${address.name} inside ${landmark.id}`).toBe(false);
      }
    }
  });

  it("leaves the Central Park side of Central Park West empty", () => {
    // CPW's northbound kerb faces east into the park. Nothing should front it.
    const park = nyc.geometry.landmarks.find((l) => l.id === "nyc-central-park")!;
    const parkWestEdge = park.center.x - park.size.x / 2;
    for (const address of nycAddresses) {
      expect(address.kerbX, address.name).toBeLessThan(parkWestEdge);
    }
  });

  it("keeps clear of the authored venues and the gas station", () => {
    const pois = inputFor(nyc).occupiedPoints ?? [];
    expect(pois.length).toBe(5); // four gig venues + one gas station
    for (const address of nycAddresses) {
      for (const poi of pois) {
        expect(distance(address, poi), address.name).toBeGreaterThan(20);
      }
    }
  });

  it("zones addresses from the block they face", () => {
    const kinds = new Set(nycAddresses.map((a) => a.kind));
    // The brownstone/house belts must yield homes and the Broadway/Amsterdam
    // core must yield workplaces, else "deliver to an office at 2am" reads odd.
    expect(kinds).toContain("residence");
    expect(kinds).toContain("office");
    const residences = nycAddresses.filter((a) => a.kind === "residence");
    expect(residences.length).toBeGreaterThan(nycAddresses.length / 3);
  });

  it("generates nothing for maps that have not opted in", () => {
    for (const pack of MAP_PACKS.filter((p) => p.id !== nyc.id)) {
      expect(generateStreetAddresses(inputFor(pack)), pack.id).toEqual([]);
    }
  });

  /**
   * The point of all this. Four venues gave twelve possible ordered pairs on
   * the whole map, so every run felt like the same two errands. This is the
   * assertion that would fail if addresses ever stopped reaching the gig pool.
   */
  it("spreads real gigs across the map instead of the same few points", () => {
    const venues = (nyc.geometry.gigVenues ?? []).flatMap((venue) => {
      const pose = resolveSimulationLaneAnchor(nyc.laneGraph.lanes, venue.anchor);
      return pose
        ? [{ id: venue.id, name: venue.name, kind: venue.kind, x: pose.x, z: pose.z }]
        : [];
    });
    const addresses = nycAddresses.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      x: a.x,
      z: a.z,
    }));

    const dropoffs = new Set<string>();
    const pickups = new Set<string>();
    for (let seed = 1; seed <= 400; seed += 1) {
      const kind = pickGigKind(seed);
      const pools = selectGigPools(venues, addresses, kind);
      const gig = generateGigFromPools(
        pools.pickups,
        pools.dropoffs,
        { base: 4, ratePerM: 0.012 },
        "USD",
        seed,
        kind,
      );
      if (!gig) continue;
      dropoffs.add(gig.dropoff.id);
      pickups.add(gig.pickup.id);
      // A delivery must never start at somebody's flat.
      if (kind === "delivery") {
        expect(["restaurant", "shop", "depot"], `seed ${seed}`).toContain(
          gig.pickup.kind,
        );
      }
    }
    expect(dropoffs.size).toBeGreaterThan(30);
    expect(pickups.size).toBeGreaterThan(10);
  });
});

function distanceToPolyline(
  point: WorldPoint,
  polyline: readonly WorldPoint[],
): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const start = polyline[index];
    const end = polyline[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const amount =
      lengthSquared < 1e-9
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point.x - start.x) * dx + (point.z - start.z) * dz) /
                lengthSquared,
            ),
          );
    best = Math.min(
      best,
      Math.hypot(point.x - (start.x + dx * amount), point.z - (start.z + dz * amount)),
    );
  }
  return best;
}
