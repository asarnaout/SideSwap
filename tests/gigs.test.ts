import { describe, expect, it } from "vitest";
import {
  advanceGig,
  generateGig,
  generateGigFromPools,
  MAX_SAME_KIND_STREAK,
  MIN_GIG_DISTANCE_M,
  gigTarget,
  pickGigKind,
  pickGigKindAvoidingStreak,
  selectGigPools,
} from "../app/game/gigs";
import type { GigKind } from "../app/game/gigs";

const venues = [
  { id: "a", name: "Alpha", kind: "shop", x: 0, z: 0 },
  { id: "b", name: "Beta", kind: "restaurant", x: 300, z: 0 },
  { id: "c", name: "Gamma", kind: "residence", x: 0, z: 400 },
];
const fare = { base: 4, ratePerM: 0.01 };

describe("gig generation + state machine", () => {
  it("needs at least two venues", () => {
    expect(generateGig([venues[0]], fare, "GBP", 1)).toBeNull();
  });

  it("picks two distinct venues and rewards by distance", () => {
    const gig = generateGig(venues, fare, "GBP", 7);
    expect(gig).not.toBeNull();
    expect(gig!.pickup.id).not.toBe(gig!.dropoff.id);
    expect(gig!.currencyCode).toBe("GBP");
    expect(gig!.state).toBe("enroute_pickup");
    const expected = Math.round(
      fare.base +
        fare.ratePerM *
          Math.hypot(
            gig!.pickup.x - gig!.dropoff.x,
            gig!.pickup.z - gig!.dropoff.z,
          ),
    );
    expect(gig!.reward).toBe(expected);
  });

  it("is deterministic for the same seed", () => {
    expect(generateGig(venues, fare, "GBP", 42)).toEqual(
      generateGig(venues, fare, "GBP", 42),
    );
  });

  it("advances pickup -> carrying -> delivered on proximity", () => {
    const gig = generateGig(venues, fare, "GBP", 3)!;
    expect(gigTarget(gig)).toEqual(gig.pickup);
    // Far from everything: no change.
    expect(advanceGig(gig, { x: 9999, z: 9999 }).state).toBe("enroute_pickup");
    // Near the pickup → carrying, now targeting the drop-off.
    const carrying = advanceGig(gig, { x: gig.pickup.x, z: gig.pickup.z });
    expect(carrying.state).toBe("carrying");
    expect(gigTarget(carrying)).toEqual(gig.dropoff);
    // Near the drop-off → delivered, no further target.
    const delivered = advanceGig(carrying, {
      x: gig.dropoff.x,
      z: gig.dropoff.z,
    });
    expect(delivered.state).toBe("delivered");
    expect(gigTarget(delivered)).toBeNull();
  });

  it("labels the gig kind, defaulting to delivery", () => {
    expect(generateGig(venues, fare, "GBP", 5)!.kind).toBe("delivery");
    expect(generateGig(venues, fare, "GBP", 5, "passenger")!.kind).toBe(
      "passenger",
    );
  });

  it("runs a passenger fare through the same pickup -> drop-off machine", () => {
    const gig = generateGig(venues, fare, "GBP", 8, "passenger")!;
    expect(gig.kind).toBe("passenger");
    const carrying = advanceGig(gig, { x: gig.pickup.x, z: gig.pickup.z });
    expect(carrying.state).toBe("carrying");
    const delivered = advanceGig(carrying, {
      x: gig.dropoff.x,
      z: gig.dropoff.z,
    });
    expect(delivered.state).toBe("delivered");
  });

  it("pickGigKind is deterministic and produces both kinds across seeds", () => {
    expect(pickGigKind(7)).toBe(pickGigKind(7));
    const kinds = new Set(
      Array.from({ length: 40 }, (_, index) => pickGigKind(index + 1)),
    );
    expect(kinds.has("delivery")).toBe(true);
    expect(kinds.has("passenger")).toBe(true);
  });
});

/**
 * The two ends of a gig are not interchangeable. Before pools existed, a
 * delivery could just as easily start at somebody's flat and finish at a
 * restaurant, which reads backwards. These pin the direction down.
 */
describe("gig pickup / drop-off pools", () => {
  const addresses = [
    { id: "addr-1", name: "1 High St", kind: "residence", x: 10, z: 10 },
    { id: "addr-2", name: "3 High St", kind: "office", x: 90, z: 90 },
  ];

  it("loads deliveries at a business and unloads them at an address", () => {
    const { pickups, dropoffs } = selectGigPools(venues, addresses, "delivery");
    expect(pickups.map((p) => p.kind).sort()).toEqual(["restaurant", "shop"]);
    expect(dropoffs).toEqual(addresses);
  });

  it("lets a fare start and finish anywhere", () => {
    const { pickups, dropoffs } = selectGigPools(venues, addresses, "passenger");
    expect(pickups).toHaveLength(venues.length + addresses.length);
    expect(dropoffs).toEqual(pickups);
  });

  it("falls back to the authored venues on maps with no addresses", () => {
    const { pickups, dropoffs } = selectGigPools(venues, [], "delivery");
    expect(dropoffs).toEqual(venues);
    expect(pickups.length).toBeGreaterThan(0);
  });

  it("draws each end from its own pool", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const { pickups, dropoffs } = selectGigPools(venues, addresses, "delivery");
      const gig = generateGigFromPools(pickups, dropoffs, fare, "GBP", seed)!;
      expect(gig.pickup.kind, `seed ${seed}`).not.toBe("residence");
      expect(dropoffs.map((d) => d.id), `seed ${seed}`).toContain(gig.dropoff.id);
    }
  });

  it("skips drop-offs too close to the pickup to be worth driving to", () => {
    // Dozens of street addresses means some land metres from a pickup, and the
    // arrival radius is 14 m — such a gig would complete almost the instant it
    // was offered, for a near-base payout.
    const nextDoor = { id: "addr-0", name: "2 High St", kind: "residence", x: 4, z: 4 };
    const pools = [nextDoor, ...addresses];
    for (let seed = 1; seed <= 40; seed += 1) {
      const gig = generateGigFromPools([venues[0]], pools, fare, "GBP", seed)!;
      expect(gig, `seed ${seed}`).not.toBeNull();
      expect(
        Math.hypot(gig.pickup.x - gig.dropoff.x, gig.pickup.z - gig.dropoff.z),
        `seed ${seed}`,
      ).toBeGreaterThanOrEqual(MIN_GIG_DISTANCE_M);
    }
  });

  it("returns null rather than a gig that starts where it ends", () => {
    const only = [venues[0]];
    expect(generateGigFromPools(only, only, fare, "GBP", 1)).toBeNull();
    expect(generateGigFromPools([], addresses, fare, "GBP", 1)).toBeNull();
    expect(generateGigFromPools(venues, [], fare, "GBP", 1)).toBeNull();
  });
});

/**
 * The gig kind is a pure hash of the seed, and a drive draws consecutive seeds,
 * so where a city's trafficSeed lands decides its opening run: NYC's first eight
 * seeds all hash to deliveries, hiding the rideshare mechanic for the first
 * handful of gigs. These pin down the streak cap that fixes that.
 */
describe("gig kind anti-streak", () => {
  // Replays a drive's kind sequence the way the app does: consecutive seeds
  // from a base, each kind chosen against the tail of kinds already served.
  const serveKinds = (baseSeed: number, count: number): GigKind[] => {
    const served: GigKind[] = [];
    for (let index = 0; index < count; index += 1) {
      served.push(
        pickGigKindAvoidingStreak(
          baseSeed + index,
          served.slice(-MAX_SAME_KIND_STREAK),
        ),
      );
    }
    return served;
  };

  const longestRun = (kinds: readonly GigKind[]): number => {
    let longest = 0;
    let run = 0;
    let previous: GigKind | null = null;
    for (const kind of kinds) {
      run = kind === previous ? run + 1 : 1;
      previous = kind;
      if (run > longest) longest = run;
    }
    return longest;
  };

  const firstSeedWith = (kind: GigKind): number => {
    for (let seed = 1; seed <= 500; seed += 1) {
      if (pickGigKind(seed) === kind) return seed;
    }
    throw new Error(`no seed produced ${kind}`);
  };

  it("defers to the raw hash until the streak cap is reached", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      expect(pickGigKindAvoidingStreak(seed, [])).toBe(pickGigKind(seed));
      expect(
        pickGigKindAvoidingStreak(
          seed,
          Array<GigKind>(MAX_SAME_KIND_STREAK - 1).fill("delivery"),
        ),
        `seed ${seed}`,
      ).toBe(pickGigKind(seed));
    }
  });

  it("forces the opposite kind after a full streak of that kind", () => {
    const deliverySeed = firstSeedWith("delivery");
    const passengerSeed = firstSeedWith("passenger");
    expect(
      pickGigKindAvoidingStreak(
        deliverySeed,
        Array<GigKind>(MAX_SAME_KIND_STREAK).fill("delivery"),
      ),
    ).toBe("passenger");
    expect(
      pickGigKindAvoidingStreak(
        passengerSeed,
        Array<GigKind>(MAX_SAME_KIND_STREAK).fill("passenger"),
      ),
    ).toBe("delivery");
    // A streak of the *other* kind is no reason to flip.
    expect(
      pickGigKindAvoidingStreak(
        deliverySeed,
        Array<GigKind>(MAX_SAME_KIND_STREAK).fill("passenger"),
      ),
    ).toBe("delivery");
  });

  it("never serves a run longer than the cap", () => {
    for (const base of [1, 500, 2101, 2201, 2301, 2401, 9999]) {
      expect(
        longestRun(serveKinds(base, 4000)),
        `base ${base}`,
      ).toBeLessThanOrEqual(MAX_SAME_KIND_STREAK);
    }
  });

  it("offers a passenger fare within the opening few gigs from any seed", () => {
    // NYC (trafficSeed 2101) used to serve eight deliveries before the first
    // fare; every base now yields a ride by gig #(MAX_SAME_KIND_STREAK + 1).
    expect(serveKinds(2101, MAX_SAME_KIND_STREAK + 1)).toContain("passenger");
    for (const cityBase of [2101, 2201, 2301, 2401]) {
      const firstRide = serveKinds(
        cityBase,
        MAX_SAME_KIND_STREAK + 1,
      ).indexOf("passenger");
      expect(firstRide, `city seed ${cityBase}`).toBeGreaterThanOrEqual(0);
      expect(firstRide, `city seed ${cityBase}`).toBeLessThanOrEqual(
        MAX_SAME_KIND_STREAK,
      );
    }
    for (let base = 1; base <= 500; base += 1) {
      expect(
        serveKinds(base, MAX_SAME_KIND_STREAK + 1),
        `base ${base}`,
      ).toContain("passenger");
    }
  });

  it("is deterministic — a drive replays identically from its seed", () => {
    expect(serveKinds(2101, 60)).toEqual(serveKinds(2101, 60));
  });

  it("keeps both kinds well represented over a long drive", () => {
    const served = serveKinds(2101, 20000);
    const passengerShare =
      served.filter((kind) => kind === "passenger").length / served.length;
    // The raw hash is ~40% passenger; capping the majority (delivery) streaks
    // pulls it up toward — but not to — an even split (~47%).
    expect(passengerShare).toBeGreaterThan(0.42);
    expect(passengerShare).toBeLessThan(0.52);
  });
});
