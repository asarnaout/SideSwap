import { describe, expect, it } from "vitest";
import {
  isPatrolVehicle,
  plateNumberForVehicle,
  policeBeaconLamps,
  policeLiveryForMap,
  resolvePlayerVehicleAppearance,
  resolveTrafficVehicleAppearance,
  type PassengerVehicleStyle,
  type TrafficVehicleAppearanceInput,
  type VehicleAppearance,
} from "../app/game/vehicleVisuals";

const HEX_COLOR = /^#[\da-f]{6}$/i;
const PASSENGER_STYLES = new Set<PassengerVehicleStyle>([
  "electric-fastback",
  "compact-hatch",
  "sport-sedan",
  "urban-crossover",
  "sport-wagon",
]);

function passengerInput(index: number, trafficSeed = 42): TrafficVehicleAppearanceInput {
  return {
    vehicleId: `npc-${index}`,
    trafficSeed,
    variant: "car",
    mapId: "nyc-upper-west-side",
  };
}

describe("deterministic vehicle appearances", () => {
  it("returns the same appearance without depending on resolution order", () => {
    const inputs = Array.from({ length: 12 }, (_, index) => passengerInput(index + 1, 734));
    const forward = new Map(
      inputs.map((input) => [input.vehicleId, resolveTrafficVehicleAppearance(input)]),
    );
    const reverse = new Map(
      [...inputs]
        .reverse()
        .map((input) => [input.vehicleId, resolveTrafficVehicleAppearance(input)]),
    );

    for (const input of inputs) {
      expect(resolveTrafficVehicleAppearance(input)).toEqual(forward.get(input.vehicleId));
      expect(reverse.get(input.vehicleId)).toEqual(forward.get(input.vehicleId));
    }
  });

  it("uses the traffic seed as part of appearance identity", () => {
    const firstSeed = Array.from({ length: 10 }, (_, index) =>
      resolveTrafficVehicleAppearance(passengerInput(index + 1, 10)),
    );
    const secondSeed = Array.from({ length: 10 }, (_, index) =>
      resolveTrafficVehicleAppearance(passengerInput(index + 1, 11)),
    );

    expect(secondSeed).not.toEqual(firstSeed);
  });
});

describe("modern fleet variety", () => {
  const fleet = Array.from({ length: 30 }, (_, index) =>
    resolveTrafficVehicleAppearance(passengerInput(index + 1)),
  );

  const civilians = fleet.filter((appearance) => appearance.role === "car");

  it("uses every passenger silhouette across a normal busy fleet", () => {
    const models = new Set(civilians.map((appearance) => appearance.model));
    expect(models).toEqual(PASSENGER_STYLES);
  });

  it("uses at least six tasteful body colors instead of cloning every car", () => {
    expect(
      new Set(civilians.map((appearance) => appearance.paintHex)).size,
    ).toBeGreaterThanOrEqual(6);
  });

  it("gives the player a fixed electric flagship distinct from NPC identity", () => {
    expect(resolvePlayerVehicleAppearance("london-south-kensington")).toMatchObject({
      model: "electric-fastback",
      role: "player",
      paintHex: "#1b4f8f",
    });
    expect(resolvePlayerVehicleAppearance("london-south-kensington")).toEqual(
      resolvePlayerVehicleAppearance("london-south-kensington"),
    );
  });

  it("puts the player in a career vehicle via the override, defaults untouched", () => {
    const base = resolvePlayerVehicleAppearance("london-south-kensington");
    // Absent / null / model-less overrides are byte-identical to no override.
    expect(resolvePlayerVehicleAppearance("london-south-kensington", null)).toEqual(base);
    expect(
      resolvePlayerVehicleAppearance("london-south-kensington", { model: null }),
    ).toEqual(base);
    const van = resolvePlayerVehicleAppearance("london-south-kensington", {
      model: "delivery-van",
    });
    expect(van.model).toBe("delivery-van");
    expect(van.role).toBe("player");
    expect(van.dimensions.length).toBeGreaterThan(base.dimensions.length);
    // Plates still follow the map, whatever the model.
    expect(van.plateRegion).toBe("uk");
    const painted = resolvePlayerVehicleAppearance("nyc-upper-west-side", {
      model: "sport-sedan",
      paintHex: "#aa1111",
    });
    expect(painted.paintHex).toBe("#aa1111");
    expect(painted.plateRegion).toBe("us");
  });

  it("wears the plates of whichever country's map is loaded", () => {
    expect(resolvePlayerVehicleAppearance("london-south-kensington").plateRegion).toBe("uk");
    expect(resolvePlayerVehicleAppearance("milton-keynes-oldbrook").plateRegion).toBe("uk");
    expect(resolvePlayerVehicleAppearance("nyc-upper-west-side").plateRegion).toBe("us");
    expect(resolvePlayerVehicleAppearance("calais-coquelles").plateRegion).toBe("fr");
    expect(resolvePlayerVehicleAppearance("tokyo-setagaya").plateRegion).toBe("jp");
    // Traffic inherits the same regional plate as the map it drives on.
    expect(
      resolveTrafficVehicleAppearance({
        vehicleId: "cab",
        trafficSeed: 3,
        variant: "taxi",
        mapId: "nyc-upper-west-side",
      }).plateRegion,
    ).toBe("us");
  });

  it("gives each vehicle its own registration, in the region's format", () => {
    // Deterministic per identity, but varied across vehicles.
    expect(plateNumberForVehicle("uk", "seed|car-1")).toBe(
      plateNumberForVehicle("uk", "seed|car-1"),
    );
    const ukPlates = new Set(
      Array.from({ length: 20 }, (_, i) => plateNumberForVehicle("uk", `seed|car-${i}`)),
    );
    expect(ukPlates.size).toBeGreaterThan(15); // overwhelmingly distinct

    expect(plateNumberForVehicle("uk", "a")).toMatch(/^[A-Z]{2}\d{2} [A-Z]{3}$/);
    expect(plateNumberForVehicle("us", "a")).toMatch(/^[A-Z]{3} \d{4}$/);
    expect(plateNumberForVehicle("fr", "a")).toMatch(/^[A-Z]{2}-\d{3}-[A-Z]{2}$/);
    expect(plateNumberForVehicle("jp", "a")).toMatch(/^\S \d{2}-\d{2}$/u);

    // Two NPCs on the same map get different plates.
    const npc = (id: string) =>
      resolveTrafficVehicleAppearance({
        vehicleId: id,
        trafficSeed: 7,
        variant: "car",
        mapId: "london-south-kensington",
      }).plateNumber;
    expect(npc("npc-1")).not.toBe(npc("npc-2"));
  });
});

describe("semantic and regional vehicle roles", () => {
  const resolve = (
    variant: TrafficVehicleAppearanceInput["variant"],
    mapId: string,
    vehicleId = `test-${variant}`,
  ) => resolveTrafficVehicleAppearance({ vehicleId, trafficSeed: 91, variant, mapId });

  it("keeps London's bus and taxi visually recognizable", () => {
    expect(resolve("bus", "london-south-kensington", "london-red-bus")).toMatchObject({
      model: "london-double-decker",
      role: "bus",
      paintHex: "#b21625",
    });
    expect(resolve("taxi", "london-south-kensington", "london-black-cab")).toMatchObject({
      model: "electric-taxi",
      role: "taxi",
      paintHex: "#20262d",
    });
  });

  it("uses a modern yellow taxi in New York", () => {
    expect(resolve("taxi", "nyc-upper-west-side", "nyc-cab-4")).toMatchObject({
      model: "electric-taxi",
      role: "taxi",
      paintHex: "#f2bb24",
    });
  });

  it("uses dedicated silhouettes for vans and non-London buses", () => {
    expect(resolve("van", "calais-coquelles")).toMatchObject({
      model: "delivery-van",
      role: "van",
    });
    expect(resolve("bus", "tokyo-setagaya")).toMatchObject({
      model: "city-bus",
      role: "bus",
    });
  });
});

describe("vehicle appearance data integrity", () => {
  const appearances: readonly VehicleAppearance[] = [
    resolvePlayerVehicleAppearance("nyc-upper-west-side"),
    ...Array.from({ length: 30 }, (_, index) =>
      resolveTrafficVehicleAppearance(passengerInput(index + 1)),
    ),
    resolveTrafficVehicleAppearance({
      vehicleId: "london-black-cab",
      trafficSeed: 10,
      variant: "taxi",
      mapId: "london-south-kensington",
    }),
    resolveTrafficVehicleAppearance({
      vehicleId: "delivery-1",
      trafficSeed: 10,
      variant: "van",
      mapId: "calais-coquelles",
    }),
    resolveTrafficVehicleAppearance({
      vehicleId: "bus-1",
      trafficSeed: 10,
      variant: "bus",
      mapId: "tokyo-setagaya",
    }),
    resolveTrafficVehicleAppearance({
      vehicleId: "london-red-bus",
      trafficSeed: 10,
      variant: "bus",
      mapId: "london-south-kensington",
    }),
  ];

  it("emits valid six-digit colors for every role", () => {
    for (const appearance of appearances) {
      expect(appearance.paintHex).toMatch(HEX_COLOR);
      expect(appearance.accentHex).toMatch(HEX_COLOR);
      expect(appearance.accentHex).not.toBe(appearance.paintHex);
    }
  });

  it("keeps every dimension finite, positive and internally plausible", () => {
    for (const appearance of appearances) {
      const dimensions = appearance.dimensions;
      for (const value of Object.values(dimensions)) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(dimensions.length).toBeGreaterThan(0);
      expect(dimensions.width).toBeGreaterThan(0);
      expect(dimensions.height).toBeGreaterThan(0);
      expect(dimensions.rideHeight).toBeGreaterThan(0);
      expect(dimensions.wheelDiameter).toBeGreaterThan(dimensions.rideHeight);
      expect(dimensions.wheelDiameter).toBeLessThan(dimensions.height);
      expect(dimensions.wheelbase).toBeGreaterThan(dimensions.wheelDiameter * 2);
      expect(dimensions.wheelbase).toBeLessThan(dimensions.length);
      expect(dimensions.cabinFrontZ).toBeGreaterThan(dimensions.cabinRearZ);
      expect(Math.abs(dimensions.cabinFrontZ)).toBeLessThan(dimensions.length / 2);
      expect(Math.abs(dimensions.cabinRearZ)).toBeLessThan(dimensions.length / 2);
    }
  });

  it("keeps passenger vehicles within believable current-production proportions", () => {
    for (const appearance of appearances.filter((candidate) =>
      PASSENGER_STYLES.has(candidate.model as PassengerVehicleStyle),
    )) {
      expect(appearance.dimensions.length).toBeGreaterThanOrEqual(3.8);
      expect(appearance.dimensions.length).toBeLessThanOrEqual(4.55);
      expect(appearance.dimensions.width).toBeGreaterThanOrEqual(1.75);
      expect(appearance.dimensions.width).toBeLessThanOrEqual(1.94);
      expect(appearance.dimensions.height).toBeGreaterThanOrEqual(1.35);
      expect(appearance.dimensions.height).toBeLessThanOrEqual(1.72);
      expect(appearance.dimensions.wheelDiameter).toBeGreaterThanOrEqual(0.64);
      expect(appearance.dimensions.wheelDiameter).toBeLessThanOrEqual(0.78);
    }
  });
});

// --- Patrol cars ------------------------------------------------------------
//
// Issue #124: patrol cars drew a random passenger paint, so two cop cars on the
// same street were different colours and no city's fleet looked like its real
// one. A force's fleet is uniform by definition, so the livery is a property of
// the map's country, not of the individual car.
describe("patrol car liveries", () => {
  const CITIES = [
    "nyc-upper-west-side",
    "london-south-kensington",
    "milton-keynes-oldbrook",
    "calais-coquelles",
    "tokyo-setagaya",
  ] as const;

  const patrolsOn = (mapId: string, trafficSeed = 512) =>
    Array.from({ length: 60 }, (_, index) =>
      resolveTrafficVehicleAppearance({
        vehicleId: `npc-${index + 1}`,
        trafficSeed,
        variant: "car",
        mapId,
      }),
    ).filter((appearance) => appearance.role === "police");

  it("gives every patrol in a city one identical, shared scheme", () => {
    for (const mapId of CITIES) {
      const patrols = patrolsOn(mapId);
      expect(patrols.length, `no patrols on ${mapId}`).toBeGreaterThan(3);
      const [first] = patrols;
      for (const patrol of patrols) {
        expect(patrol.model).toBe(first.model);
        expect(patrol.paintHex).toBe(first.paintHex);
        expect(patrol.accentHex).toBe(first.accentHex);
        expect(patrol.livery).toEqual(first.livery);
      }
      // ...but each still carries its own registration.
      expect(new Set(patrols.map((p) => p.plateNumber)).size).toBeGreaterThan(1);
    }
  });

  it("wears each country's real scheme, and differs between countries", () => {
    const livery = (mapId: string) => patrolsOn(mapId)[0].livery!;

    // NYPD: white RMP with a navy belt stripe.
    expect(livery("nyc-upper-west-side")).toMatchObject({
      style: "stripe",
      lettering: "NYPD",
      bodyHex: "#eef1f4",
      markingHex: "#123c78",
    });
    // UK forces: white under blue-and-yellow Battenburg.
    expect(livery("london-south-kensington")).toMatchObject({
      style: "battenburg",
      lettering: "POLICE",
      markingHex: "#0b4ea2",
      secondaryHex: "#f5d417",
    });
    // Police nationale: white with a blue belt band.
    expect(livery("calais-coquelles")).toMatchObject({
      style: "stripe",
      markingHex: "#1b3f92",
    });
    // Japanese patrol cars are the white-over-black 白黒 scheme.
    expect(livery("tokyo-setagaya")).toMatchObject({
      style: "half-black",
      bodyHex: "#eceff1",
      markingHex: "#14181c",
    });

    // Two UK cities share one national scheme; the four countries do not.
    expect(livery("milton-keynes-oldbrook")).toEqual(
      livery("london-south-kensington"),
    );
    expect(new Set(CITIES.map((city) => policeLiveryForMap(city).force)).size).toBe(4);
  });

  it("keeps patrols a minority of traffic, and only ever cars", () => {
    for (const mapId of CITIES) {
      const cars = Array.from({ length: 200 }, (_, index) => ({
        vehicleId: `npc-${index + 1}`,
        trafficSeed: 512,
        variant: "car" as const,
        mapId,
      }));
      const share = cars.filter(isPatrolVehicle).length / cars.length;
      expect(share).toBeGreaterThan(0.1);
      expect(share).toBeLessThan(0.32);

      // A bus, van or taxi is never a patrol, whatever its id hashes to.
      for (const variant of ["bus", "van", "taxi"] as const) {
        for (let index = 0; index < 40; index += 1) {
          const input = { vehicleId: `npc-${index}`, trafficSeed: 512, variant, mapId };
          expect(isPatrolVehicle(input)).toBe(false);
          expect(resolveTrafficVehicleAppearance(input).livery).toBeNull();
        }
      }
    }
  });

  it("leaves civilians and the player unmarked", () => {
    expect(resolvePlayerVehicleAppearance("nyc-upper-west-side").livery).toBeNull();
    const civilians = Array.from({ length: 60 }, (_, index) =>
      resolveTrafficVehicleAppearance(passengerInput(index + 1)),
    ).filter((appearance) => appearance.role === "car");
    expect(civilians.length).toBeGreaterThan(20);
    for (const civilian of civilians) expect(civilian.livery).toBeNull();
  });

  it("keeps a patrol a patrol, so a light bar never lands on a bus", () => {
    // Patrol status is derived from the vehicle's own identity, not its render
    // slot: resolving the same id twice must always agree.
    for (const mapId of CITIES) {
      for (let index = 1; index <= 40; index += 1) {
        const input = { vehicleId: `npc-${index}`, trafficSeed: 9, variant: "car" as const, mapId };
        expect(isPatrolVehicle(input)).toBe(isPatrolVehicle(input));
        expect(resolveTrafficVehicleAppearance(input)).toEqual(
          resolveTrafficVehicleAppearance(input),
        );
      }
    }
  });
});

// The old bar was two permanently-lit boxes. Real emergency lights strobe in
// quick double blips and alternate sides.
describe("policeBeaconLamps", () => {
  // Exactly one full cycle, so each side's duty is counted once.
  const samples = Array.from({ length: 440 }, (_, index) =>
    policeBeaconLamps((index / 440) * 1.1),
  );

  it("blips each side twice per cycle, alternating, mostly dark", () => {
    const redOn = samples.filter((lamp) => lamp.red > 0).length / samples.length;
    const blueOn = samples.filter((lamp) => lamp.blue > 0).length / samples.length;
    expect(redOn).toBeGreaterThan(0.05);
    expect(redOn).toBeLessThan(0.25);
    expect(blueOn).toBeCloseTo(redOn, 1);
    // Never both at once — that would read as a steady purple glow.
    expect(samples.some((lamp) => lamp.red > 0 && lamp.blue > 0)).toBe(false);

    // Two separate flashes per side per cycle (count rising edges).
    const edges = (pick: (lamp: { red: number; blue: number }) => number) =>
      samples.filter(
        (lamp, index) => pick(lamp) > 0 && (index === 0 || pick(samples[index - 1]) === 0),
      ).length;
    expect(edges((lamp) => lamp.red)).toBe(2);
    expect(edges((lamp) => lamp.blue)).toBe(2);
  });

  it("repeats every cycle and stays defined for any elapsed time", () => {
    for (const seconds of [0, 0.31, 0.77, 4.2, 913.6]) {
      expect(policeBeaconLamps(seconds)).toEqual(policeBeaconLamps(seconds + 1.1 * 7));
      const lamp = policeBeaconLamps(seconds);
      expect(lamp.red === 0 || lamp.red === 1).toBe(true);
      expect(lamp.blue === 0 || lamp.blue === 1).toBe(true);
    }
  });
});
