import { describe, expect, it } from "vitest";
import {
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

  it("uses every passenger silhouette across a normal busy fleet", () => {
    const models = new Set(fleet.map((appearance) => appearance.model));
    expect(models).toEqual(PASSENGER_STYLES);
  });

  it("uses at least six tasteful body colors instead of cloning every car", () => {
    expect(new Set(fleet.map((appearance) => appearance.paintHex)).size).toBeGreaterThanOrEqual(6);
  });

  it("gives the player a fixed electric flagship distinct from NPC identity", () => {
    expect(resolvePlayerVehicleAppearance()).toMatchObject({
      model: "electric-fastback",
      role: "player",
      paintHex: "#1b4f8f",
    });
    expect(resolvePlayerVehicleAppearance()).toEqual(resolvePlayerVehicleAppearance());
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
      paintHex: "#10151a",
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
    resolvePlayerVehicleAppearance(),
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
