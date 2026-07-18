/**
 * Renderer-independent vehicle appearance selection.
 *
 * Vehicle styling must not consume the simulation's seeded random stream: a
 * cosmetic change should never move traffic, alter its speed, or change a
 * replay. Every choice below is therefore derived independently from a stable
 * string key containing the traffic seed and simulation vehicle id.
 */

export type PassengerVehicleStyle =
  | "electric-fastback"
  | "compact-hatch"
  | "sport-sedan"
  | "urban-crossover"
  | "sport-wagon";

export type VehicleModel =
  | PassengerVehicleStyle
  | "electric-taxi"
  | "delivery-van"
  | "city-bus"
  | "london-double-decker";

export type TrafficVehicleVariant = "car" | "taxi" | "bus" | "van";
export type VehicleAppearanceRole = TrafficVehicleVariant | "player";

export interface VehicleDimensions {
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly rideHeight: number;
  readonly wheelbase: number;
  readonly wheelDiameter: number;
  /** Z is positive toward the front of a SideSwap vehicle. */
  readonly cabinFrontZ: number;
  readonly cabinRearZ: number;
}

export interface VehicleAppearance {
  readonly model: VehicleModel;
  readonly role: VehicleAppearanceRole;
  readonly paintHex: string;
  readonly accentHex: string;
  readonly dimensions: VehicleDimensions;
}

export interface TrafficVehicleAppearanceInput {
  readonly vehicleId: string;
  readonly trafficSeed: number;
  readonly variant: TrafficVehicleVariant;
  readonly mapId: string;
}

const PASSENGER_STYLES: readonly PassengerVehicleStyle[] = [
  "electric-fastback",
  "compact-hatch",
  "sport-sedan",
  "urban-crossover",
  "sport-wagon",
];

/** Contemporary factory paint colors with enough contrast against the road. */
const PASSENGER_PAINTS = [
  "#f1f3f4", // pearl white
  "#171c22", // obsidian
  "#59616a", // graphite
  "#aeb7bf", // liquid silver
  "#183f6d", // midnight blue
  "#286b98", // arctic blue
  "#17676b", // deep teal
  "#8e2638", // garnet
  "#315b4a", // forest green
  "#826044", // satin bronze
] as const;

const PASSENGER_ACCENTS = [
  "#10161c",
  "#cbd2d7",
  "#26323b",
  "#eef2f4",
  "#0c2238",
  "#c2d8e3",
  "#0c3033",
  "#d4b7bb",
  "#152d24",
  "#d0bdab",
] as const;

const VEHICLE_DIMENSIONS: Readonly<Record<VehicleModel, VehicleDimensions>> = {
  "electric-fastback": {
    length: 4.55,
    width: 1.9,
    height: 1.44,
    rideHeight: 0.18,
    wheelbase: 2.88,
    wheelDiameter: 0.72,
    cabinFrontZ: 0.82,
    cabinRearZ: -1.08,
  },
  "compact-hatch": {
    length: 4.02,
    width: 1.77,
    height: 1.48,
    rideHeight: 0.2,
    wheelbase: 2.61,
    wheelDiameter: 0.66,
    cabinFrontZ: 0.68,
    cabinRearZ: -1.12,
  },
  "sport-sedan": {
    length: 4.52,
    width: 1.87,
    height: 1.4,
    rideHeight: 0.17,
    wheelbase: 2.82,
    wheelDiameter: 0.7,
    cabinFrontZ: 0.72,
    cabinRearZ: -0.96,
  },
  "urban-crossover": {
    length: 4.34,
    width: 1.89,
    height: 1.68,
    rideHeight: 0.29,
    wheelbase: 2.7,
    wheelDiameter: 0.75,
    cabinFrontZ: 0.76,
    cabinRearZ: -1.12,
  },
  "sport-wagon": {
    length: 4.48,
    width: 1.86,
    height: 1.49,
    rideHeight: 0.21,
    wheelbase: 2.78,
    wheelDiameter: 0.7,
    cabinFrontZ: 0.74,
    cabinRearZ: -1.3,
  },
  "electric-taxi": {
    length: 4.62,
    width: 1.9,
    height: 1.62,
    rideHeight: 0.23,
    wheelbase: 2.9,
    wheelDiameter: 0.72,
    cabinFrontZ: 0.78,
    cabinRearZ: -1.34,
  },
  "delivery-van": {
    length: 5.18,
    width: 2.02,
    height: 2.18,
    rideHeight: 0.3,
    wheelbase: 3.24,
    wheelDiameter: 0.74,
    cabinFrontZ: 1.82,
    cabinRearZ: 0.36,
  },
  "city-bus": {
    // Compressed to SideSwap's authored traffic footprint so buses stay
    // visually clear of queued cars while preserving a recognisable profile.
    length: 5.7,
    width: 2.25,
    height: 2.65,
    rideHeight: 0.38,
    wheelbase: 3.45,
    wheelDiameter: 0.88,
    cabinFrontZ: 2.47,
    cabinRearZ: -2.33,
  },
  "london-double-decker": {
    length: 5.85,
    width: 2.3,
    height: 3.25,
    rideHeight: 0.41,
    wheelbase: 3.5,
    wheelDiameter: 0.92,
    cabinFrontZ: 2.54,
    cabinRearZ: -2.4,
  },
};

const PLAYER_APPEARANCE: VehicleAppearance = {
  model: "electric-fastback",
  role: "player",
  // Premium royal-blue flagship — retires the old radioactive cyan.
  paintHex: "#1b4f8f",
  accentHex: "#0d2436",
  dimensions: VEHICLE_DIMENSIONS["electric-fastback"],
};

/** Stable 32-bit FNV-1a hash; deliberately local to keep this module pure. */
function hashAppearanceKey(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function selectFromKey<T>(values: readonly T[], key: string): T {
  return values[hashAppearanceKey(key) % values.length];
}

function normalizedSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) : 0;
}

function passengerAppearance(
  input: TrafficVehicleAppearanceInput,
): VehicleAppearance {
  const identity = `${normalizedSeed(input.trafficSeed)}|${input.vehicleId}`;
  const model = selectFromKey(PASSENGER_STYLES, `${identity}|model`);
  const paintHex = selectFromKey(PASSENGER_PAINTS, `${identity}|paint`);
  const accentHex = selectFromKey(PASSENGER_ACCENTS, `${identity}|accent`);
  return {
    model,
    role: "car",
    paintHex,
    accentHex,
    dimensions: VEHICLE_DIMENSIONS[model],
  };
}

function isLondonVehicle(input: TrafficVehicleAppearanceInput): boolean {
  const region = `${input.mapId}|${input.vehicleId}`.toLowerCase();
  return region.includes("london");
}

function isNewYorkVehicle(input: TrafficVehicleAppearanceInput): boolean {
  const region = `${input.mapId}|${input.vehicleId}`.toLowerCase();
  return region.includes("nyc") || region.includes("new-york");
}

/**
 * Resolves an NPC's visual identity without touching any shared random state.
 * Selection is stable even when vehicles are resolved lazily or in a different
 * order after traffic recycling.
 */
export function resolveTrafficVehicleAppearance(
  input: TrafficVehicleAppearanceInput,
): VehicleAppearance {
  if (input.variant === "car") return passengerAppearance(input);

  if (input.variant === "taxi") {
    const london = isLondonVehicle(input);
    const newYork = isNewYorkVehicle(input);
    return {
      model: "electric-taxi",
      role: "taxi",
      paintHex: london ? "#10151a" : newYork ? "#f2bb24" : "#e9edef",
      accentHex: london ? "#aeb8bf" : newYork ? "#202830" : "#276b78",
      dimensions: VEHICLE_DIMENSIONS["electric-taxi"],
    };
  }

  if (input.variant === "van") {
    const key = `${normalizedSeed(input.trafficSeed)}|${input.vehicleId}|van`;
    return {
      model: "delivery-van",
      role: "van",
      paintHex: selectFromKey(["#edf0f1", "#cdd5d9", "#315d73"], key),
      accentHex: "#16242b",
      dimensions: VEHICLE_DIMENSIONS["delivery-van"],
    };
  }

  const london = isLondonVehicle(input);
  return {
    model: london ? "london-double-decker" : "city-bus",
    role: "bus",
    paintHex: london ? "#b21625" : "#e8edef",
    accentHex: london
      ? "#f0c8cb"
      : isNewYorkVehicle(input)
        ? "#2c6198"
        : "#287284",
    dimensions: london
      ? VEHICLE_DIMENSIONS["london-double-decker"]
      : VEHICLE_DIMENSIONS["city-bus"],
  };
}

/** The player's recognizable, fixed modern flagship silhouette. */
export function resolvePlayerVehicleAppearance(): VehicleAppearance {
  return PLAYER_APPEARANCE;
}
