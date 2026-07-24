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
export type VehicleAppearanceRole = TrafficVehicleVariant | "player" | "police";

/** Country whose number-plate design a vehicle wears, derived from the map. */
export type PlateRegion = "uk" | "us" | "fr" | "jp";

/**
 * Maps a map id onto the country whose plates its traffic should wear. Uses the
 * same substring convention as the taxi/bus regional styling below; the UK is
 * the default (covers London, Milton Keynes and the orientation yard).
 */
export function plateRegionForMap(mapId: string): PlateRegion {
  const id = mapId.toLowerCase();
  if (id.includes("nyc") || id.includes("new-york")) return "us";
  if (id.includes("calais")) return "fr";
  if (id.includes("tokyo")) return "jp";
  return "uk";
}

// Plate registration characters. Letters drop I/O/Q (ambiguous with 1/0); the
// kana set is the DVLA-analogue safe subset used on Japanese plates (no お/し/へ/ん).
const PLATE_LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ";
const PLATE_DIGITS = "0123456789";
const PLATE_KANA = "さすせそたちつてとなにぬねのはひふほまみむめもやゆよらりるれろ";

/**
 * A plausible registration for one vehicle, in its country's format, derived
 * deterministically from a stable identity so every car reads differently
 * without ever touching the simulation's seeded random stream (see the module
 * header). Japanese returns only the lower serial line; the area line is fixed.
 */
export function plateNumberForVehicle(region: PlateRegion, identity: string): string {
  const c = (set: string, salt: number) =>
    set[hashAppearanceKey(`${identity}|plate|${salt}`) % set.length];
  const L = PLATE_LETTERS;
  const D = PLATE_DIGITS;
  switch (region) {
    case "us":
      return `${c(L, 0)}${c(L, 1)}${c(L, 2)} ${c(D, 3)}${c(D, 4)}${c(D, 5)}${c(D, 6)}`;
    case "fr":
      return `${c(L, 0)}${c(L, 1)}-${c(D, 2)}${c(D, 3)}${c(D, 4)}-${c(L, 5)}${c(L, 6)}`;
    case "jp":
      return `${c(PLATE_KANA, 0)} ${c(D, 1)}${c(D, 2)}-${c(D, 3)}${c(D, 4)}`;
    case "uk":
    default:
      return `${c(L, 0)}${c(L, 1)}${c(D, 2)}${c(D, 3)} ${c(L, 4)}${c(L, 5)}${c(L, 6)}`;
  }
}

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
  readonly plateRegion: PlateRegion;
  /** This vehicle's own registration string, in its region's format. */
  readonly plateNumber: string;
  /**
   * Set only on patrol cars: the local force's markings, which the renderer
   * turns into flank decals and a roof light bar. `null` on every civilian
   * vehicle, and the single signal that a vehicle is a patrol.
   */
  readonly livery: PoliceLivery | null;
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
  "#2b333c", // obsidian (lifted off near-black so it reads against the road)
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

// --- Patrol cars ------------------------------------------------------------
//
// Every patrol car on a map wears one identical, real-world scheme (issue #124):
// a force's fleet is uniform, so a randomly-coloured "police car" reads as a
// civilian car with a light bar on it. The scheme is chosen by the map's country
// — the same substring convention the plates use — and drives both the body
// paint and the flank markings the renderer draws.

/** How a force's markings are laid out along the flank. */
export type PoliceLiveryStyle =
  /** UK: two rows of alternating blue/yellow squares. */
  | "battenburg"
  /** US/FR: one solid belt stripe carrying the force's word mark. */
  | "stripe"
  /** JP: the lower body blacked out under a white shell. */
  | "half-black";

export interface PoliceLivery {
  /** The force this scheme belongs to; also the decal texture's cache key. */
  readonly force: string;
  readonly style: PoliceLiveryStyle;
  /** Body paint shared by the whole fleet in this country. */
  readonly bodyHex: string;
  /** Primary marking colour (the stripe, or the Battenburg blue). */
  readonly markingHex: string;
  /** Second Battenburg square; ignored by the other styles. */
  readonly secondaryHex: string;
  /** Word mark carried on the doors. */
  readonly lettering: string;
  readonly letteringHex: string;
}

/**
 * Real-world liveries, keyed by the map's country.
 *
 * - us: NYPD RMPs are white with a navy belt stripe and blue "NYPD".
 * - uk: Met/Thames Valley cars are white under blue-and-yellow Battenburg.
 * - fr: Police nationale runs white cars with a blue belt band.
 * - jp: patrol cars ("パトカー") are the white-over-black 白黒 scheme.
 */
const POLICE_LIVERIES: Readonly<Record<PlateRegion, PoliceLivery>> = {
  us: {
    force: "nypd",
    style: "stripe",
    bodyHex: "#eef1f4",
    markingHex: "#123c78",
    secondaryHex: "#0d2b57",
    lettering: "NYPD",
    letteringHex: "#123c78",
  },
  uk: {
    force: "uk-battenburg",
    style: "battenburg",
    bodyHex: "#e9edf0",
    markingHex: "#0b4ea2",
    secondaryHex: "#f5d417",
    lettering: "POLICE",
    letteringHex: "#0b4ea2",
  },
  fr: {
    force: "police-nationale",
    style: "stripe",
    bodyHex: "#f0f2f4",
    markingHex: "#1b3f92",
    secondaryHex: "#c8102e",
    lettering: "POLICE",
    letteringHex: "#1b3f92",
  },
  jp: {
    force: "keishicho",
    style: "half-black",
    bodyHex: "#eceff1",
    markingHex: "#14181c",
    secondaryHex: "#14181c",
    lettering: "POLICE",
    letteringHex: "#eceff1",
  },
};

/** Each force's actual patrol silhouette, so the fleet reads right per country. */
const POLICE_MODELS: Readonly<Record<PlateRegion, VehicleModel>> = {
  us: "urban-crossover", // NYPD RMPs are Explorer-shaped SUVs
  uk: "sport-wagon", // UK response cars are estates and soft-roaders
  fr: "compact-hatch", // Police nationale runs hatchbacks
  jp: "electric-fastback", // patrol sedans
};

/** The livery every patrol car on `mapId` wears. */
export function policeLiveryForMap(mapId: string): PoliceLivery {
  return POLICE_LIVERIES[plateRegionForMap(mapId)];
}

/** One patrol per this many passenger cars, on average. */
const PATROL_IN_EVERY = 5;

/**
 * Whether this vehicle is a patrol car. Derived from the vehicle's own identity
 * rather than its render slot, so a car stays a patrol (or stays civilian) for
 * as long as it exists — the earlier slot-indexed rule left a light bar bolted
 * to a slot that later recycled into a bus.
 */
export function isPatrolVehicle(input: TrafficVehicleAppearanceInput): boolean {
  if (input.variant !== "car") return false;
  const identity = `${normalizedSeed(input.trafficSeed)}|${input.vehicleId}`;
  return hashAppearanceKey(`${identity}|patrol`) % PATROL_IN_EVERY === 0;
}

/** Flash cycle length; both lamps blip twice within it. */
const BEACON_PERIOD_SECONDS = 1.1;
/** Blip windows within the cycle, as [start, end] fractions of the period. */
const BEACON_RED_BLIPS: readonly (readonly [number, number])[] = [
  [0.0, 0.07],
  [0.13, 0.2],
];
const BEACON_BLUE_BLIPS: readonly (readonly [number, number])[] = [
  [0.5, 0.57],
  [0.63, 0.7],
];

function blipOn(
  phase: number,
  windows: readonly (readonly [number, number])[],
): number {
  for (const [start, end] of windows) {
    if (phase >= start && phase < end) return 1;
  }
  return 0;
}

/**
 * Lamp brightness (0 or 1) for each half of a light bar at `seconds` into its
 * flash. A real bar strobes each side in quick double blips and alternates
 * sides — not a steady glow, which is what made the old bar read as two lit
 * boxes rather than emergency lights.
 */
export function policeBeaconLamps(seconds: number): {
  red: number;
  blue: number;
} {
  const cycle = seconds / BEACON_PERIOD_SECONDS;
  const phase = cycle - Math.floor(cycle);
  return {
    red: blipOn(phase, BEACON_RED_BLIPS),
    blue: blipOn(phase, BEACON_BLUE_BLIPS),
  };
}

export const VEHICLE_DIMENSIONS: Readonly<Record<VehicleModel, VehicleDimensions>> = {
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

const PLAYER_APPEARANCE: Omit<VehicleAppearance, "plateRegion" | "plateNumber"> = {
  model: "electric-fastback",
  role: "player",
  // Premium royal-blue flagship — retires the old radioactive cyan.
  paintHex: "#1b4f8f",
  accentHex: "#0d2436",
  dimensions: VEHICLE_DIMENSIONS["electric-fastback"],
  livery: null,
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
  const region = plateRegionForMap(input.mapId);
  return {
    model,
    role: "car",
    paintHex,
    accentHex,
    dimensions: VEHICLE_DIMENSIONS[model],
    plateRegion: region,
    plateNumber: plateNumberForVehicle(region, identity),
    livery: null,
  };
}

function policeAppearance(
  input: TrafficVehicleAppearanceInput,
): VehicleAppearance {
  const region = plateRegionForMap(input.mapId);
  const livery = POLICE_LIVERIES[region];
  const model = POLICE_MODELS[region];
  return {
    model,
    role: "police",
    paintHex: livery.bodyHex,
    accentHex: livery.markingHex,
    dimensions: VEHICLE_DIMENSIONS[model],
    plateRegion: region,
    plateNumber: plateNumberForVehicle(
      region,
      `${normalizedSeed(input.trafficSeed)}|${input.vehicleId}`,
    ),
    livery,
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
  const plateRegion = plateRegionForMap(input.mapId);
  const plateIdentity = `${normalizedSeed(input.trafficSeed)}|${input.vehicleId}`;
  const plateNumber = plateNumberForVehicle(plateRegion, plateIdentity);

  if (input.variant === "car") {
    return isPatrolVehicle(input)
      ? policeAppearance(input)
      : passengerAppearance(input);
  }

  if (input.variant === "taxi") {
    const london = isLondonVehicle(input);
    const newYork = isNewYorkVehicle(input);
    return {
      model: "electric-taxi",
      role: "taxi",
      paintHex: london ? "#20262d" : newYork ? "#f2bb24" : "#e9edef",
      accentHex: london ? "#aeb8bf" : newYork ? "#202830" : "#276b78",
      dimensions: VEHICLE_DIMENSIONS["electric-taxi"],
      plateRegion,
      plateNumber,
      livery: null,
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
      plateRegion,
      plateNumber,
      livery: null,
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
    plateRegion,
    plateNumber,
    livery: null,
  };
}

/** The player's recognizable, fixed modern flagship silhouette. Wears the
 * plates of whichever country's map is loaded. Career Mode passes an override
 * to put the player in a rented model; a null/absent override (free drive and
 * every existing caller) is byte-identical to the pre-override behaviour. */
export function resolvePlayerVehicleAppearance(
  mapId: string,
  override?: {
    readonly model: VehicleModel | null;
    readonly paintHex?: string;
  } | null,
): VehicleAppearance {
  const plateRegion = plateRegionForMap(mapId);
  const base: VehicleAppearance = {
    ...PLAYER_APPEARANCE,
    plateRegion,
    plateNumber: plateNumberForVehicle(plateRegion, "player-flagship"),
  };
  if (!override?.model) {
    return base;
  }
  return {
    ...base,
    model: override.model,
    dimensions: VEHICLE_DIMENSIONS[override.model],
    paintHex: override.paintHex ?? base.paintHex,
  };
}
