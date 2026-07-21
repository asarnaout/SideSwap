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

/** The only lane fields address generation needs. `LaneSegment` satisfies it. */
export interface AddressLane {
  readonly id: string;
  /** Groups lanes into a street; drives the address's street name. */
  readonly roadId: string;
  readonly centerline: readonly WorldPoint[];
  readonly role: string;
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
 * far larger than the authored `connectorRanges`, which are only 0.5 m tapers
 * and would let an address sit right on the crossing.
 */
export const JUNCTION_CLEARANCE_M = 32;

/**
 * Minimum gap between two addresses. Comfortably larger than the 14 m gig
 * arrival radius so two stops can never both be "the one you're at" — which
 * also settles the opposite-kerb case, where two addresses facing each other
 * across a street would otherwise sit ~10 m apart.
 */
export const MIN_SEPARATION_M = 40;

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
}

/**
 * Upper West Side streets. Numbers are in the right range for the real
 * neighbourhood — Broadway is in the 2100s up here, the avenues a little below
 * it, and the cross streets start from the park and count west.
 */
const STREET_PROFILES: Record<string, StreetProfile> = {
  "nyc-west-end": { name: "West End Ave", axis: "z", baseNumber: 500 },
  "nyc-broadway": { name: "Broadway", axis: "z", baseNumber: 2150 },
  "nyc-amsterdam": { name: "Amsterdam Ave", axis: "z", baseNumber: 2050 },
  "nyc-columbus": { name: "Columbus Ave", axis: "z", baseNumber: 1950 },
  "nyc-central-park-west": { name: "Central Park West", axis: "z", baseNumber: 300 },
  "nyc-west-72": { name: "W 72nd St", axis: "x", baseNumber: 200, axisSign: -1 },
  "nyc-west-79": { name: "W 79th St", axis: "x", baseNumber: 200, axisSign: -1 },
  "nyc-west-86": { name: "W 86th St", axis: "x", baseNumber: 200, axisSign: -1 },
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
  const raw = profile.baseNumber + Math.round(along / 4);
  const number = Math.max(2, raw);
  // Even on one side of the carriageway, odd on the other.
  const wantEven = across > 0;
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
    .filter((lane) => ADDRESSABLE_ROLES.has(lane.role))
    .filter((lane) => STREET_PROFILES[lane.roadId])
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const lane of lanes) {
    const profile = STREET_PROFILES[lane.roadId];
    const length = polylineLength(lane.centerline);
    if (length <= JUNCTION_CLEARANCE_M * 2) continue;

    for (
      let distance = JUNCTION_CLEARANCE_M;
      distance <= length - JUNCTION_CLEARANCE_M;
      distance += spacing * (0.75 + rng() * 0.5)
    ) {
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

      if (
        accepted.some(
          (existing) => Math.hypot(existing.x - pose.x, existing.z - pose.z) < MIN_SEPARATION_M,
        )
      ) {
        continue;
      }
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
