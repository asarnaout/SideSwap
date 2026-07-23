/**
 * Procedural curbside street addresses — the places gigs actually get delivered
 * to.
 *
 * A map authors only a handful of named gig venues (NYC has four across 0.82
 * km²), which meant every delivery and every fare shuttled between the same few
 * points. Real residents live in the hundreds of buildings the street-wall
 * system already renders, so rather than hand-author more venues this module
 * derives drop-off points from the lane graph itself: walk each street, take the
 * kerb on the driver's right, and keep the spots that genuinely front a
 * building.
 *
 * Renderer-agnostic (no Babylon imports) and pure/deterministic in `mapId`, so
 * the same map always yields the same addresses and the whole thing is
 * unit-testable — same contract as {@link ./buildingSets}.
 *
 * The load-bearing rule is the **frontage probe**: a candidate is kept only if a
 * point a little further past the kerb lands inside a `ProceduralBlock`. That
 * single test does most of the work — it rejects inner lanes (whose "kerb" is
 * really the next carriageway over), it rejects the Central Park side of Central
 * Park West, and it hands back the block's `buildingSet` so the address can
 * describe itself as a residence, an office or a shop.
 */
import { resolveSimulationLaneAnchor } from "./simulationAdapter";
import type { GigVenueKind, WorldPoint } from "./types";
import { distanceToPolylineM, hashStringToSeed, seededUnit } from "./visuals";

/**
 * The only lane fields address generation needs. Both the authored
 * `LaneSegment` and the renderer's lighter `GameCanvasLane` satisfy it — hence
 * the optional fields, which the renderer's type leaves off. A lane missing
 * either simply gets no addresses.
 */
export interface AddressLane {
  readonly id: string;
  /** Groups lanes into a street; drives the address's street name. */
  readonly roadId?: string;
  readonly centerline: readonly WorldPoint[];
  readonly role?: string;
}

/** A zoned city block. `ProceduralBlock` satisfies it. */
export interface AddressBlock {
  readonly center: WorldPoint;
  readonly size: WorldPoint;
  readonly buildingSet?: string;
}

/** A park/museum/station footprint that must never host an address. */
export interface AddressLandmark {
  readonly kind: string;
  readonly center: WorldPoint;
  readonly size: WorldPoint;
}

/** A painted carriageway, which a kerb spot has to stay off. */
export interface AddressRoadSurface {
  readonly centerline: readonly WorldPoint[];
  readonly widthM: number;
}

export interface StreetAddressInput {
  /** Seeds the RNG, so a map's addresses are stable across runs. */
  readonly mapId: string;
  readonly lanes: readonly AddressLane[];
  readonly blocks: readonly AddressBlock[];
  readonly landmarks: readonly AddressLandmark[];
  readonly roadSurfaces: readonly AddressRoadSurface[];
  /** Authored venue + service-point anchors to keep clear of. */
  readonly occupiedPoints?: readonly WorldPoint[];
  /** Mean distance between addresses along one kerb. Defaults to 150 m. */
  readonly spacingM?: number;
}

/** One generated drop-off point, shaped to slot straight into a gig. */
export interface StreetAddress {
  readonly id: string;
  /** Display name, e.g. "214 Amsterdam Ave". */
  readonly name: string;
  readonly kind: GigVenueKind;
  /** The street this address is on (`LaneSegment.roadId`). */
  readonly roadId: string;
  /** Which kerb of that street: the two sides are -1 and +1. */
  readonly side: -1 | 1;
  readonly laneId: string;
  readonly distanceAlongM: number;
  /** Lane-centreline point — the gig arrival target, matching authored venues. */
  readonly x: number;
  readonly z: number;
  /** Kerb point, where a rider waits and the drop-off marker stands. */
  readonly kerbX: number;
  readonly kerbZ: number;
  /** Kerb facing, looking back across the carriageway. */
  readonly facing: number;
}

/** Enough of a map pack to derive its addresses. Both the authored `MapPack`
 * and the renderer's `GameCanvasMapPack` satisfy this. */
export interface AddressMapPack {
  readonly id: string;
  readonly geometry: {
    readonly blocks?: readonly AddressBlock[];
    readonly landmarks?: readonly AddressLandmark[];
    readonly roadSurfaces?: readonly AddressRoadSurface[];
    readonly gigVenues?: readonly {
      readonly anchor: { readonly laneId: string; readonly distanceAlongM: number };
    }[];
    readonly servicePoints?: readonly {
      readonly anchor: { readonly laneId: string; readonly distanceAlongM: number };
    }[];
  };
  readonly laneGraph: { readonly lanes: readonly AddressLane[] };
}

const ADDRESSES_BY_MAP = new Map<string, readonly StreetAddress[]>();

/**
 * A map's addresses, derived once and cached.
 *
 * Three callers need the identical list — gig selection, the renderer (which
 * stands riders and the drop-off marker on their kerbs) and the tests — and
 * they must agree exactly, since a gig refers to a stop by id. Deriving it
 * here rather than at each call site is what guarantees that, and saves walking
 * the whole lane graph on every payout.
 */
export function streetAddressesForMap(
  pack: AddressMapPack,
): readonly StreetAddress[] {
  const cached = ADDRESSES_BY_MAP.get(pack.id);
  if (cached) return cached;
  const lanes = pack.laneGraph.lanes;
  const addresses = generateStreetAddresses({
    mapId: pack.id,
    lanes,
    blocks: pack.geometry.blocks ?? [],
    landmarks: pack.geometry.landmarks ?? [],
    roadSurfaces: pack.geometry.roadSurfaces ?? [],
    occupiedPoints: [
      ...(pack.geometry.gigVenues ?? []),
      ...(pack.geometry.servicePoints ?? []),
    ].flatMap((poi) => {
      const pose = resolveSimulationLaneAnchor(lanes, poi.anchor);
      return pose ? [{ x: pose.x, z: pose.z }] : [];
    }),
  });
  ADDRESSES_BY_MAP.set(pack.id, addresses);
  return addresses;
}

/** Lanes carrying real traffic. Connectors and roundabout arms get no addresses. */
const ADDRESSABLE_ROLES = new Set(["travel", "one_way"]);

/**
 * How far past the lane the rider stands. Matches the 4.5 m the renderer already
 * uses for a waiting passenger at a venue, nudged out to clear a paved sidewalk.
 */
const KERB_OFFSET_M = 5;

/**
 * Distances past the lane probed for building frontage. Blocks are inset from
 * the carriageway by roughly a road half-width plus a sidewalk, and that inset
 * varies per street, so probe a span rather than a single distance and take the
 * first block that answers.
 */
const FRONTAGE_PROBE_M = [12, 15, 18, 22] as const;

/**
 * Clearance from each end of a lane. Lanes meet at intersections, and a drop-off
 * in the middle of a junction is both unreachable and unreadable. Deliberately
 * far larger than the authored `connectorRanges`, which are only ~2 m node
 * spans and would let an address sit right on the crossing.
 */
export const JUNCTION_CLEARANCE_M = 32;

/**
 * Minimum gap between two addresses **on the same kerb** — roughly a couple of
 * brownstone frontages, so a street reads as a street rather than a row of
 * pins.
 */
export const MIN_SEPARATION_M = 40;

/**
 * Minimum gap between any two addresses regardless of side.
 *
 * This is deliberately much smaller than {@link MIN_SEPARATION_M}, because
 * separation is measured at the *lane* point and the two carriageways of a
 * two-way street are only ~3.4 m apart. Judging both kerbs by the same 40 m
 * rule meant whichever lane the walk reached first claimed the whole street and
 * the opposite kerb was left nearly empty. Two addresses facing each other
 * across a road is exactly what real streets look like, and it is harmless
 * here: only one address is ever the live gig target, so they cannot compete
 * over the arrival radius.
 */
export const MIN_OPPOSITE_KERB_M = 12;

/** How far an address must stay from an authored venue or a gas station. */
const POI_CLEARANCE_M = 30;

/**
 * Margin the kerb spot keeps beyond a carriageway edge. This is what stops an
 * *inner* lane from generating: its right-hand "kerb" is really the next lane
 * over, and while such a spot can still find building frontage further out, a
 * rider standing there would be stood in live traffic.
 */
const CARRIAGEWAY_CLEARANCE_M = 0.5;

/** Street names and house numbering, keyed by `LaneSegment.roadId`. */
interface StreetProfile {
  readonly name: string;
  /** Which world axis the street runs along; numbering counts along it. */
  readonly axis: "x" | "z";
  /** House number at `axis = 0`. */
  readonly baseNumber: number;
  /** -1 when numbers count down as the axis rises (Manhattan's cross streets
   * number up as they run *west*, away from Central Park). */
  readonly axisSign?: -1 | 1;
  /** House numbers per metre. Cross streets number far faster than avenues:
   * a cross street covers one short block per number run, an avenue covers
   * fourteen. */
  readonly numbersPerM: number;
}

/**
 * Upper West Side streets. Numbers are in the right range for the real
 * neighbourhood — Broadway is in the 2100s up here, the avenues a little below
 * it, and the cross streets start from the park and count west.
 */
const STREET_PROFILES: Record<string, StreetProfile> = {
  "nyc-west-end": { name: "West End Ave", axis: "z", baseNumber: 500, numbersPerM: 0.3 },
  "nyc-broadway": { name: "Broadway", axis: "z", baseNumber: 2150, numbersPerM: 0.3 },
  "nyc-amsterdam": { name: "Amsterdam Ave", axis: "z", baseNumber: 2050, numbersPerM: 0.3 },
  "nyc-columbus": { name: "Columbus Ave", axis: "z", baseNumber: 1950, numbersPerM: 0.3 },
  "nyc-central-park-west": { name: "Central Park West", axis: "z", baseNumber: 300, numbersPerM: 0.3 },
  "nyc-west-72": { name: "W 72nd St", axis: "x", baseNumber: 200, axisSign: -1, numbersPerM: 0.55 },
  "nyc-west-79": { name: "W 79th St", axis: "x", baseNumber: 200, axisSign: -1, numbersPerM: 0.55 },
  "nyc-west-86": { name: "W 86th St", axis: "x", baseNumber: 200, axisSign: -1, numbersPerM: 0.55 },
};

/** What a block's zoning makes the people living on its frontage. */
const KINDS_BY_BUILDING_SET: Record<string, readonly GigVenueKind[]> = {
  "nyc-brownstone": ["residence"],
  "nyc-house": ["residence"],
  // Mid-rise is genuinely mixed-use: apartments over ground-floor offices.
  "nyc-midrise": ["residence", "residence", "office"],
  "nyc-downtown": ["office", "office", "residence"],
  "nyc-shop": ["shop", "residence"],
};

const polylineLength = (points: readonly WorldPoint[]): number =>
  points.slice(1).reduce(
    (total, point, index) =>
      total + Math.hypot(point.x - points[index].x, point.z - points[index].z),
    0,
  );

const isInsideRect = (
  point: WorldPoint,
  rect: { readonly center: WorldPoint; readonly size: WorldPoint },
): boolean =>
  Math.abs(point.x - rect.center.x) <= rect.size.x / 2 &&
  Math.abs(point.z - rect.center.z) <= rect.size.z / 2;

/**
 * A house number for a kerb point. Derived from the world position rather than
 * `distanceAlongM`, because opposing lanes on the same street measure distance
 * from opposite ends — numbering off the lane would run the two sides of a
 * street in opposite directions. Parity marks the side, the way real streets do.
 */
function houseNumber(
  profile: StreetProfile,
  point: WorldPoint,
  kerb: WorldPoint,
): number {
  const along = (profile.axis === "z" ? point.z : point.x) * (profile.axisSign ?? 1);
  const across = profile.axis === "z" ? kerb.x - point.x : kerb.z - point.z;
  const raw = profile.baseNumber + Math.round(along * profile.numbersPerM);
  const number = Math.max(2, raw);
  // Manhattan's convention: even numbers run down the west side of an avenue
  // and the south side of a cross street — the negative side on both axes.
  const wantEven = across < 0;
  return number % 2 === (wantEven ? 0 : 1) ? number : number + 1;
}

/**
 * Curbside drop-off points across a map's streets.
 *
 * Walks every addressable lane by arclength, takes the kerb on the lane's
 * right-hand side (the same normal the renderer sets venues back along, so an
 * address lands on the side of the road you'd actually pull over on), and keeps
 * the candidates that front a real block, clear of junctions, parks, authored
 * venues and each other.
 */
export function generateStreetAddresses(
  input: StreetAddressInput,
): StreetAddress[] {
  const spacing = input.spacingM ?? 150;
  const rng = seededUnit(hashStringToSeed(input.mapId));
  const accepted: StreetAddress[] = [];
  const usedNames = new Set<string>();

  // Sorted for a stable walk order regardless of how the map authored its lanes.
  const lanes = [...input.lanes]
    .filter((lane) => ADDRESSABLE_ROLES.has(lane.role ?? ""))
    .filter((lane) => STREET_PROFILES[lane.roadId ?? ""])
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const lane of lanes) {
    const profile = STREET_PROFILES[lane.roadId ?? ""];
    const length = polylineLength(lane.centerline);
    const usable = length - JUNCTION_CLEARANCE_M * 2;
    if (usable <= 0) continue;

    // Spread the block's addresses evenly across its usable run and centre them
    // in their own share of it, rather than starting at the junction clearance
    // and striding off. Striding put every short lane's single address at
    // exactly JUNCTION_CLEARANCE_M — a rigid ring of drop-offs on the corners,
    // since NYC's cross-street lanes are shorter than one stride.
    const count = Math.max(1, Math.round(usable / spacing));
    const step = usable / count;
    for (let index = 0; index < count; index += 1) {
      const distance =
        JUNCTION_CLEARANCE_M +
        step * (index + 0.5) +
        (rng() - 0.5) * step * 0.5;
      const pose = resolveSimulationLaneAnchor([lane], {
        laneId: lane.id,
        distanceAlongM: distance,
      });
      if (!pose) continue;

      // The kerb is the lane's right-hand normal, matching venue set-back.
      const normalX = Math.cos(pose.heading);
      const normalZ = -Math.sin(pose.heading);
      const kerb = {
        x: pose.x + normalX * KERB_OFFSET_M,
        z: pose.z + normalZ * KERB_OFFSET_M,
      };

      // A rider has to be able to stand here.
      if (
        input.roadSurfaces.some(
          (surface) =>
            distanceToPolylineM(kerb, surface.centerline) <=
            surface.widthM / 2 + CARRIAGEWAY_CLEARANCE_M,
        )
      ) {
        continue;
      }

      // Frontage probe: does anything actually face this kerb?
      const block = FRONTAGE_PROBE_M.map((reach) => ({
        x: pose.x + normalX * reach,
        z: pose.z + normalZ * reach,
      })).reduce<AddressBlock | null>(
        (found, probe) =>
          found ?? input.blocks.find((candidate) => isInsideRect(probe, candidate)) ?? null,
        null,
      );
      if (!block) continue;

      // Parks and museum grounds have frontage but nobody lives there.
      if (input.landmarks.some((landmark) => isInsideRect(kerb, landmark))) continue;

      // Which kerb of the street this is: -1 and +1 are the two sides.
      const side =
        profile.axis === "z"
          ? Math.sign(kerb.x - pose.x)
          : Math.sign(kerb.z - pose.z);
      const crowded = accepted.some((existing) => {
        const gap = Math.hypot(existing.x - pose.x, existing.z - pose.z);
        if (gap < MIN_OPPOSITE_KERB_M) return true;
        return (
          existing.roadId === lane.roadId &&
          existing.side === side &&
          gap < MIN_SEPARATION_M
        );
      });
      if (crowded) continue;
      if (
        (input.occupiedPoints ?? []).some(
          (occupied) => Math.hypot(occupied.x - pose.x, occupied.z - pose.z) < POI_CLEARANCE_M,
        )
      ) {
        continue;
      }

      const kinds = KINDS_BY_BUILDING_SET[block.buildingSet ?? ""] ?? ["residence"];
      // Two kerbs a block apart can round to the same number. Step along the
      // street's own parity until one is free rather than dropping the address,
      // so every name the HUD prints identifies exactly one place.
      let number = houseNumber(profile, pose, kerb);
      while (usedNames.has(`${number} ${profile.name}`)) number += 2;
      const name = `${number} ${profile.name}`;
      usedNames.add(name);

      accepted.push({
        id: `addr-${lane.roadId}-${number}`,
        name,
        kind: kinds[Math.floor(rng() * kinds.length)] ?? "residence",
        roadId: lane.roadId ?? "",
        side: side === 0 ? 1 : side < 0 ? -1 : 1,
        laneId: lane.id,
        distanceAlongM: distance,
        x: pose.x,
        z: pose.z,
        kerbX: kerb.x,
        kerbZ: kerb.z,
        // Look back across the carriageway, matching the renderer's rider spot.
        facing: Math.atan2(-normalX, -normalZ),
      });
    }
  }

  return accepted;
}
