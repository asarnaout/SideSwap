import { describe, expect, it } from "vitest";
import {
  CAREER_VEHICLES,
  careerFare,
  PLATFORM_FEE_BY_COUNTRY,
  vehicleRent,
  createCareerSlice,
} from "../app/game/career";
import {
  DESTINATION_PROFILES,
  GIG_FARE_BY_COUNTRY,
  PASSENGER_FARE_BY_COUNTRY,
  getCountryProfile,
  getFreeDrive,
  getMapPack,
} from "../app/game/content";
import { MIN_GIG_DISTANCE_M, selectGigPools } from "../app/game/gigs";
import type { GigKind, GigVenuePosition } from "../app/game/gigs";
import { resolveSimulationLaneAnchor } from "../app/game/simulationAdapter";
import { streetAddressesForMap } from "../app/game/streetAddresses";
import type { MapId } from "../app/game/types";

// Mirrors SideSwapApp's pool resolution so the tripwire prices the same gigs
// the game actually offers.
function poolsFor(mapId: MapId): {
  venues: GigVenuePosition[];
  addresses: GigVenuePosition[];
} {
  const map = getMapPack(mapId);
  const venues = (map.geometry.gigVenues ?? []).flatMap((venue) => {
    const pose = resolveSimulationLaneAnchor(map.laneGraph.lanes, venue.anchor);
    return pose
      ? [{ id: venue.id, name: venue.name, kind: venue.kind, x: pose.x, z: pose.z }]
      : [];
  });
  const addresses = streetAddressesForMap(map).map((address) => ({
    id: address.id,
    name: address.name,
    kind: address.kind,
    x: address.x,
    z: address.z,
  }));
  return { venues, addresses };
}

function medianNet(
  mapId: MapId,
  countryId: (typeof DESTINATION_PROFILES)[number]["countryId"],
  kind: GigKind,
  vehicle: (typeof CAREER_VEHICLES)[number],
): number | null {
  const { venues, addresses } = poolsFor(mapId);
  const { pickups, dropoffs } = selectGigPools(venues, addresses, kind);
  const fare =
    kind === "passenger"
      ? PASSENGER_FARE_BY_COUNTRY[countryId]
      : GIG_FARE_BY_COUNTRY[countryId];
  const nets: number[] = [];
  for (const pickup of pickups) {
    for (const dropoff of dropoffs) {
      if (dropoff.id === pickup.id) continue;
      const distance = Math.hypot(dropoff.x - pickup.x, dropoff.z - pickup.z);
      if (distance < MIN_GIG_DISTANCE_M) continue;
      const reward = Math.round(fare.base + fare.ratePerM * distance);
      nets.push(careerFare(reward, kind, vehicle).net);
    }
  }
  if (!nets.length) return null;
  nets.sort((left, right) => left - right);
  return nets[Math.floor(nets.length / 2)];
}

// The tripwire: every tier must be beatable at a modest pace in every city.
// If a future fare/rent/fee edit makes a vehicle need more than ~4 median
// gigs just to break even, the mode has silently become unwinnable there and
// this fails loudly instead.
describe("career balance tripwire", () => {
  it("keeps rent + platform fee under four median gig nets for every vehicle and city", () => {
    for (const destination of DESTINATION_PROFILES) {
      const country = getCountryProfile(destination.countryId);
      const mapId = getFreeDrive(destination.freeDriveId).mapId;
      const slice = createCareerSlice({
        countryId: country.id,
        destinationId: destination.id,
        careerSeed: 1,
      });
      for (const vehicle of CAREER_VEHICLES) {
        const bestMedian = Math.max(
          ...vehicle.allowedGigKinds.map(
            (kind) => medianNet(mapId, country.id, kind, vehicle) ?? 0,
          ),
        );
        expect(
          bestMedian,
          `${destination.id} offers no priceable gigs for ${vehicle.id}`,
        ).toBeGreaterThan(0);
        const dailyFloor =
          vehicleRent(vehicle, slice) + PLATFORM_FEE_BY_COUNTRY[country.id];
        expect(
          dailyFloor,
          `${vehicle.id} in ${destination.id}: floor ${dailyFloor} vs median net ${bestMedian}`,
        ).toBeLessThan(bestMedian * 4);
      }
    }
  });
});
