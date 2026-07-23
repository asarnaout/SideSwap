// Pure, seeded gig (delivery job) generation + a proximity-driven state machine.
// Kept free of map/adapter dependencies: callers resolve venue lane-anchors to
// world positions and pass those in, so this is trivially unit-testable.

export type GigKind = "delivery" | "passenger";
export type GigState = "enroute_pickup" | "carrying" | "delivered";

export interface GigVenuePosition {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly x: number;
  readonly z: number;
}

export interface GigFare {
  readonly base: number;
  readonly ratePerM: number;
}

export interface Gig {
  readonly id: string;
  readonly kind: GigKind;
  readonly pickup: GigVenuePosition;
  readonly dropoff: GigVenuePosition;
  readonly reward: number;
  readonly currencyCode: string;
  readonly state: GigState;
}

const distance = (
  a: { readonly x: number; readonly z: number },
  b: { readonly x: number; readonly z: number },
): number => Math.hypot(a.x - b.x, a.z - b.z);

// Small deterministic hash → [0, 1) so a given seed reproduces the same offer.
const hashToUnit = (seed: number): number => {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  return (h >>> 0) / 0x100000000;
};

/**
 * Deterministically decides whether `seed` yields a passenger fare or a parcel
 * delivery. Passengers come up ~40% of the time; the seed is salted so this draw
 * is independent of the venue-selection draw, keeping the mix from correlating
 * with which venues get picked.
 */
export function pickGigKind(seed: number): GigKind {
  return hashToUnit(seed * 2 + 0x1f) < 0.4 ? "passenger" : "delivery";
}

/**
 * The longest run of one kind a drive will serve before the next gig is forced
 * to the other kind.
 *
 * `pickGigKind` is a pure hash of the seed, and a drive draws consecutive seeds
 * (`trafficSeed`, `+1`, `+2`, …), so where a city's `trafficSeed` happens to
 * land decides its opening run. New York's first eight seeds all hash to
 * deliveries, so a player could finish half a dozen gigs without ever being
 * offered a fare — the rideshare mechanic looks absent when it is only buried.
 * Capping the streak guarantees variety, and a passenger fare within the first
 * `MAX_SAME_KIND_STREAK + 1` gigs, in every city.
 */
export const MAX_SAME_KIND_STREAK = 2;

/**
 * Like `pickGigKind`, but forces the opposite kind once the last
 * `MAX_SAME_KIND_STREAK` *served* gigs were all the kind this seed would
 * naturally produce.
 *
 * `recentKinds` is the tail of kinds already offered this drive, newest last;
 * only the final `MAX_SAME_KIND_STREAK` matter. Pass the kinds this function
 * returned (not the raw `pickGigKind` draws) so a forced flip counts toward the
 * next streak — that is what bounds every served run to `MAX_SAME_KIND_STREAK`.
 * Pure and deterministic: the same `(seed, recentKinds)` always yields the same
 * kind, so a drive replays identically from its `trafficSeed`.
 */
export function pickGigKindAvoidingStreak(
  seed: number,
  recentKinds: readonly GigKind[],
): GigKind {
  const natural = pickGigKind(seed);
  const streak = recentKinds.slice(-MAX_SAME_KIND_STREAK);
  if (
    streak.length === MAX_SAME_KIND_STREAK &&
    streak.every((kind) => kind === natural)
  ) {
    return natural === "passenger" ? "delivery" : "passenger";
  }
  return natural;
}

/** Venue kinds a meal or a parcel can actually originate from. */
const PICKUP_SOURCE_KINDS = new Set(["restaurant", "shop", "depot"]);

/** Shortest gig worth offering, pickup to drop-off. */
export const MIN_GIG_DISTANCE_M = 120;

/**
 * Which places each end of a gig may use.
 *
 * A parcel or a meal comes from a business and goes to somebody's door, so
 * deliveries load at a restaurant or shop and unload at a street address. A
 * fare is symmetric — people hail rides from their homes and offices as
 * readily as from a restaurant — so passengers may start and end anywhere.
 *
 * Both ends fall back to the authored venues whenever the preferred pool is
 * empty, which is what keeps the four compact city maps (no generated
 * addresses, and only one venue of each kind) working exactly as before.
 */
export function selectGigPools(
  venues: readonly GigVenuePosition[],
  addresses: readonly GigVenuePosition[],
  kind: GigKind,
): {
  readonly pickups: readonly GigVenuePosition[];
  readonly dropoffs: readonly GigVenuePosition[];
} {
  if (kind === "passenger") {
    const everywhere = [...venues, ...addresses];
    return { pickups: everywhere, dropoffs: everywhere };
  }
  const sources = venues.filter((venue) => PICKUP_SOURCE_KINDS.has(venue.kind));
  return {
    pickups: sources.length ? sources : venues,
    dropoffs: addresses.length ? addresses : venues,
  };
}

/**
 * Generates one gig from separate pickup and drop-off pools.
 *
 * The two ends of a gig are not interchangeable: a curry comes from a kitchen,
 * not from someone's front door, while the door is exactly where it is going.
 * Callers therefore hand in the places each end may legally use, and this only
 * decides which ones the seed lands on. Returns null when either pool is empty
 * or the two would have to be the same place.
 */
export function generateGigFromPools(
  pickups: readonly GigVenuePosition[],
  dropoffs: readonly GigVenuePosition[],
  fare: GigFare,
  currencyCode: string,
  seed: number,
  kind: GigKind = "delivery",
): Gig | null {
  if (!pickups.length || !dropoffs.length) return null;
  const pickupIndex = Math.floor(hashToUnit(seed) * pickups.length) % pickups.length;
  const pickup = pickups[pickupIndex];
  // Walk the drop-off forward past anything too close to be worth driving to.
  // With dozens of street addresses in the pool, some land a few metres from
  // the pickup, and the arrival radius is 14 m — such a gig would complete
  // almost the instant it was offered, for a near-base payout.
  let dropoffIndex =
    Math.floor(hashToUnit(seed + 1) * dropoffs.length) % dropoffs.length;
  for (let attempt = 0; attempt < dropoffs.length; attempt += 1) {
    const candidate = dropoffs[dropoffIndex];
    if (candidate.id !== pickup.id && distance(pickup, candidate) >= MIN_GIG_DISTANCE_M) {
      break;
    }
    dropoffIndex = (dropoffIndex + 1) % dropoffs.length;
  }
  const dropoff = dropoffs[dropoffIndex];
  // Every candidate was the pickup itself: the pools share a single entry.
  if (dropoff.id === pickup.id) return null;
  const reward = Math.round(
    fare.base + fare.ratePerM * distance(pickup, dropoff),
  );
  return {
    id: `gig-${seed}`,
    kind,
    pickup,
    dropoff,
    reward,
    currencyCode,
    state: "enroute_pickup",
  };
}

/**
 * Generates one gig (a parcel delivery or a passenger fare) from a single pool
 * of venues (≥2 required), where either end may use any of them. Pickup and
 * drop-off are two distinct venues chosen deterministically from `seed`; the
 * reward is the base fare plus a per-metre rate over the Euclidean distance.
 * `kind` only labels the gig — the pickup→drop-off machine is identical for
 * both — so callers pass the matching fare table for that kind.
 */
export function generateGig(
  venues: readonly GigVenuePosition[],
  fare: GigFare,
  currencyCode: string,
  seed: number,
  kind: GigKind = "delivery",
): Gig | null {
  return generateGigFromPools(venues, venues, fare, currencyCode, seed, kind);
}

/**
 * Advances a gig by the player's proximity to its current target:
 * enroute_pickup → carrying near the pickup, carrying → delivered near the
 * drop-off. Returns the same gig when nothing changes.
 */
export function advanceGig(
  gig: Gig,
  player: { readonly x: number; readonly z: number },
  radiusM = 14,
): Gig {
  if (
    gig.state === "enroute_pickup" &&
    distance(player, gig.pickup) <= radiusM
  ) {
    return { ...gig, state: "carrying" };
  }
  if (gig.state === "carrying" && distance(player, gig.dropoff) <= radiusM) {
    return { ...gig, state: "delivered" };
  }
  return gig;
}

/** The venue the player should currently head to, or null once delivered. */
export function gigTarget(gig: Gig): GigVenuePosition | null {
  if (gig.state === "enroute_pickup") return gig.pickup;
  if (gig.state === "carrying") return gig.dropoff;
  return null;
}
