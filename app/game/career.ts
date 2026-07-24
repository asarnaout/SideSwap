// Pure Career Mode economy core: the vehicle catalog, the end-of-day
// settlement (loans, final notice, bankruptcy), fare/tip/par maths, per-day
// seed derivation and the persisted-slice codec. Kept free of app, renderer
// and simulation dependencies (type-only imports), in the style of gigs.ts:
// the app supplies numbers in, gets decisions out, and every rule here is
// unit-testable without a browser.
//
// Money is integer-only in the career country's own currency (JPY has no minor
// units, and integer ledgers avoid float drift across hundreds of days).

import type { GigKind } from "./gigs";
import type { CountryId, DestinationId } from "./types";
import type { VehicleModel } from "./vehicleVisuals";

// ---------------------------------------------------------------------------
// Tunables. Balance rationale lives beside each table; adjust here, not at
// call sites.
// ---------------------------------------------------------------------------

/** Real-time length of one career day, driven by the sim clock (pauses pause it). */
export const DAY_LENGTH_MS = 360_000;

/** The platform's cut of every gross fare. Tips are commission-free. */
export const COMMISSION_RATE = 0.25;

/** On-time delivery bonus, as a fraction of the gross fare. */
export const TIP_RATE = 0.3;

/** Fee folded into a loan at origination (and into each consolidation). */
export const LOAN_ORIGINATION_RATE = 0.15;

/** Settlements a loan spans; installments are ceil(principal / days left). */
export const LOAN_TERM_DAYS = 3;

/** Buying out a rental costs this many days of its rent. */
export const BUYOUT_RENT_MULTIPLIER = 15;

/** Roadside rescue refills the whole tank at this premium over pump price. */
export const ROADSIDE_PRICE_FACTOR = 1.5;

/**
 * Par-time model for the carrying leg: effective city pace of the reference
 * hatchback, a slack factor covering road-vs-straight-line detour plus
 * forgiveness, and a floor so short hops are never impossible.
 */
export const PAR_BASE_SPEED_MPS = 8;
export const PAR_SLACK = 1.9;
export const PAR_MIN_MS = 45_000;

/** Seed cash: about one hatchback rent plus change — day 1 is a bike day. */
export const CAREER_STARTING_CASH_BY_COUNTRY: Readonly<Record<CountryId, number>> = {
  us: 20,
  uk: 20,
  fr: 25,
  jp: 3000,
};

/** Flat daily platform subscription, so even a bike day has a floor to beat. */
export const PLATFORM_FEE_BY_COUNTRY: Readonly<Record<CountryId, number>> = {
  us: 3,
  uk: 3,
  fr: 4,
  jp: 300,
};

/** Flat call-out charge on top of the premium fuel when rescued roadside. */
export const ROADSIDE_CALLOUT_FEE_BY_COUNTRY: Readonly<Record<CountryId, number>> = {
  us: 10,
  uk: 10,
  fr: 12,
  jp: 1000,
};

// ---------------------------------------------------------------------------
// Vehicle catalog
// ---------------------------------------------------------------------------

export type CareerVehicleId =
  | "bicycle"
  | "motorbike"
  | "compact-hatch"
  | "delivery-van"
  | "sport-sedan";

/**
 * Mirrors the optional player-physics fields on SimulationCoreConfig. The
 * compact hatch must stay exactly equal to the simulation's defaults — it is
 * the reference vehicle, and equality is what keeps the deterministic
 * acceptance replay untouched by career work.
 */
export interface CareerVehiclePhysics {
  readonly maxForwardSpeedMps: number;
  readonly maxReverseSpeedMps: number;
  readonly forwardAccelMps2: number;
  readonly reverseAccelMps2: number;
  readonly brakeBaseMps2: number;
  readonly brakeStrengthMps2: number;
  readonly dragBaseMps2: number;
  readonly dragPerMps: number;
  readonly steerBaseRate: number;
  readonly steerAuthorityRate: number;
  readonly steerAuthoritySpeedMps: number;
  readonly instabilityLateralMps2: number;
  readonly playerRadiusM: number;
  readonly playerCapsuleHalfLengthM: number;
  readonly playerCapsuleRadiusM: number;
}

export interface CareerVehicleSpec {
  readonly id: CareerVehicleId;
  readonly name: string;
  /** Registry key for the rendered mesh; null for the composed bicycle rig. */
  readonly model: VehicleModel | null;
  readonly visualKind: "car" | "bicycle" | "motorbike";
  /** Owned outright (the starter bicycle): always available, never rented. */
  readonly owned: boolean;
  readonly rentByCountry: Readonly<Record<CountryId, number>>;
  readonly buyoutEligible: boolean;
  /** Litres; 0 means the vehicle has no fuel system at all. */
  readonly tankL: number;
  readonly fuelLPerM: number;
  /** Multiplier on the country pump price (premium fuel for premium metal). */
  readonly fuelPriceFactor: number;
  /** Gig kinds this vehicle may be OFFERED — filtering happens at generation. */
  readonly allowedGigKinds: readonly GigKind[];
  readonly fareFactors: Readonly<{ delivery: number; passenger: number }>;
  /** Par-time divisor: faster vehicles get tighter tip windows. */
  readonly paceFactor: number;
  readonly physics: CareerVehiclePhysics;
}

/** The simulation's current player-physics literals, verbatim. */
const HATCH_PHYSICS: CareerVehiclePhysics = {
  maxForwardSpeedMps: 22,
  maxReverseSpeedMps: 7,
  forwardAccelMps2: 5.6,
  reverseAccelMps2: 4.1,
  brakeBaseMps2: 3,
  brakeStrengthMps2: 8.5,
  dragBaseMps2: 0.25,
  dragPerMps: 0.035,
  steerBaseRate: 0.32,
  steerAuthorityRate: 0.95,
  steerAuthoritySpeedMps: 5.5,
  instabilityLateralMps2: 11,
  playerRadiusM: 1.05,
  playerCapsuleHalfLengthM: 1.15,
  playerCapsuleRadiusM: 1.0,
};

/**
 * Rent ascending = risk ascending: pricier vehicles must out-earn their rent,
 * so the garage choice is the difficulty select. Balance intent: each vehicle
 * breaks even at ~2 completed gigs/day and profits at 3+; the sports car only
 * pays off on 4+ on-time passenger fares.
 */
export const CAREER_VEHICLES: readonly CareerVehicleSpec[] = [
  {
    id: "bicycle",
    name: "Your bicycle",
    model: null,
    visualKind: "bicycle",
    owned: true,
    rentByCountry: { us: 0, uk: 0, fr: 0, jp: 0 },
    buyoutEligible: false,
    tankL: 0,
    fuelLPerM: 0,
    fuelPriceFactor: 0,
    allowedGigKinds: ["delivery"],
    fareFactors: { delivery: 1, passenger: 1 },
    paceFactor: 0.45,
    physics: {
      maxForwardSpeedMps: 7.5,
      maxReverseSpeedMps: 2,
      forwardAccelMps2: 2.8,
      reverseAccelMps2: 1.2,
      brakeBaseMps2: 2.5,
      brakeStrengthMps2: 5,
      dragBaseMps2: 0.35,
      dragPerMps: 0.06,
      steerBaseRate: 0.6,
      steerAuthorityRate: 0.7,
      steerAuthoritySpeedMps: 3,
      instabilityLateralMps2: 5.5,
      playerRadiusM: 0.6,
      playerCapsuleHalfLengthM: 0.9,
      playerCapsuleRadiusM: 0.55,
    },
  },
  {
    id: "motorbike",
    name: "Motorbike",
    model: null,
    visualKind: "motorbike",
    owned: false,
    rentByCountry: { us: 8, uk: 8, fr: 10, jp: 800 },
    buyoutEligible: true,
    tankL: 12,
    fuelLPerM: 0.0009,
    fuelPriceFactor: 1,
    allowedGigKinds: ["delivery"],
    fareFactors: { delivery: 1.1, passenger: 1 },
    paceFactor: 1.15,
    physics: {
      maxForwardSpeedMps: 24,
      maxReverseSpeedMps: 3,
      forwardAccelMps2: 6.8,
      reverseAccelMps2: 2.5,
      brakeBaseMps2: 3.2,
      brakeStrengthMps2: 9,
      dragBaseMps2: 0.28,
      dragPerMps: 0.03,
      steerBaseRate: 0.5,
      steerAuthorityRate: 1,
      steerAuthoritySpeedMps: 4.5,
      instabilityLateralMps2: 9,
      playerRadiusM: 0.62,
      playerCapsuleHalfLengthM: 0.95,
      playerCapsuleRadiusM: 0.55,
    },
  },
  {
    id: "compact-hatch",
    name: "Compact hatchback",
    model: "compact-hatch",
    visualKind: "car",
    owned: false,
    rentByCountry: { us: 12, uk: 12, fr: 15, jp: 1200 },
    buyoutEligible: true,
    tankL: 40,
    fuelLPerM: 0.002,
    fuelPriceFactor: 1,
    allowedGigKinds: ["delivery", "passenger"],
    fareFactors: { delivery: 1, passenger: 1 },
    paceFactor: 1,
    physics: HATCH_PHYSICS,
  },
  {
    id: "delivery-van",
    name: "Delivery van",
    model: "delivery-van",
    visualKind: "car",
    owned: false,
    rentByCountry: { us: 20, uk: 20, fr: 25, jp: 2000 },
    buyoutEligible: true,
    tankL: 70,
    fuelLPerM: 0.0032,
    fuelPriceFactor: 1,
    allowedGigKinds: ["delivery"],
    fareFactors: { delivery: 1.5, passenger: 1 },
    paceFactor: 0.92,
    physics: {
      maxForwardSpeedMps: 19,
      maxReverseSpeedMps: 6,
      forwardAccelMps2: 4.6,
      reverseAccelMps2: 3.4,
      brakeBaseMps2: 3,
      brakeStrengthMps2: 7,
      dragBaseMps2: 0.3,
      dragPerMps: 0.045,
      steerBaseRate: 0.28,
      steerAuthorityRate: 0.8,
      steerAuthoritySpeedMps: 6,
      instabilityLateralMps2: 8.5,
      playerRadiusM: 1.15,
      playerCapsuleHalfLengthM: 1.45,
      playerCapsuleRadiusM: 1.05,
    },
  },
  {
    id: "sport-sedan",
    name: "Sports car",
    model: "sport-sedan",
    visualKind: "car",
    owned: false,
    rentByCountry: { us: 32, uk: 32, fr: 40, jp: 3200 },
    buyoutEligible: true,
    tankL: 45,
    fuelLPerM: 0.0035,
    fuelPriceFactor: 1.4,
    allowedGigKinds: ["delivery", "passenger"],
    fareFactors: { delivery: 1, passenger: 1.6 },
    paceFactor: 1.25,
    physics: {
      maxForwardSpeedMps: 27,
      maxReverseSpeedMps: 8,
      forwardAccelMps2: 7.4,
      reverseAccelMps2: 5,
      brakeBaseMps2: 3.5,
      brakeStrengthMps2: 10,
      dragBaseMps2: 0.22,
      dragPerMps: 0.03,
      steerBaseRate: 0.36,
      steerAuthorityRate: 1.1,
      steerAuthoritySpeedMps: 5,
      instabilityLateralMps2: 14,
      playerRadiusM: 1.02,
      playerCapsuleHalfLengthM: 1.12,
      playerCapsuleRadiusM: 0.98,
    },
  },
];

export function getCareerVehicle(id: CareerVehicleId): CareerVehicleSpec {
  const spec = CAREER_VEHICLES.find((vehicle) => vehicle.id === id);
  if (!spec) {
    throw new Error(`Unknown career vehicle: ${id}`);
  }
  return spec;
}

// ---------------------------------------------------------------------------
// Career slice (the persisted state) and its codec
// ---------------------------------------------------------------------------

export type BankruptcyRule = "strict" | "grace";

export interface CareerLoan {
  readonly principalRemaining: number;
  readonly daysRemaining: number;
}

export interface CareerStats {
  readonly daysCompleted: number;
  readonly grossEarned: number;
  readonly tipsEarned: number;
  readonly finesPaid: number;
  readonly gigsCompleted: number;
  readonly gigsOnTime: number;
  readonly loansTaken: number;
  readonly largestDebt: number;
}

export interface CareerSliceV1 {
  /** "won" is sticky: the victory happened, endless play continues. */
  readonly state: "active" | "won" | "over";
  readonly countryId: CountryId;
  readonly destinationId: DestinationId;
  /** Fixed at creation; every per-day seed derives from it. */
  readonly careerSeed: number;
  /** 1-based: the next day to play. */
  readonly day: number;
  /**
   * Integer cash at the last boundary. Non-negative while playable (settlement
   * converts shortfalls to loans); may be negative only in the "over" state,
   * preserved for the career-over display.
   */
  readonly cash: number;
  readonly loan: CareerLoan | null;
  /** One strike left: set by re-borrowing while indebted (grace rule). */
  readonly finalNotice: boolean;
  readonly ownedVehicleId: CareerVehicleId | null;
  readonly victoryDay: number | null;
  /** Frozen per career so mid-run rule changes can't strand a save. */
  readonly rule: BankruptcyRule;
  readonly stats: CareerStats;
  /** Storage integrity stamp — see stampCareerChecksum. */
  readonly checksum: string;
}

/**
 * A structurally-broken or checksum-mismatched slice is itself persisted
 * state: migrate-on-save would otherwise quietly rebuild a tampered career
 * before the UI ever got to offer the reset.
 */
export interface CareerCorrupt {
  readonly state: "corrupt";
}

export type CareerPersisted = CareerSliceV1 | CareerCorrupt | null;

const COUNTRY_IDS: readonly CountryId[] = ["us", "uk", "fr", "jp"];

// Mirrors the id set progress.ts hardcodes; content.test.ts pins the real list
// at five, so drift here fails loudly rather than silently.
const DESTINATION_IDS: readonly DestinationId[] = [
  "us-nyc",
  "uk-london",
  "uk-milton-keynes",
  "fr-calais",
  "jp-tokyo",
];

const VEHICLE_IDS: readonly CareerVehicleId[] = CAREER_VEHICLES.map(
  (vehicle) => vehicle.id,
);

/**
 * Deterrence, not security: the salt ships in the bundle and anyone who reads
 * it can forge a save. It exists to stop casual localStorage edits only.
 */
const CAREER_CHECKSUM_SALT = "curbside-career-v1/0x5eedc0de";

/**
 * JSON with recursively sorted object keys, so the checksum is independent of
 * property insertion order across serialize/parse round-trips.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const body = keys
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${body.join(",")}}`;
}

const fnv1aHex = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

export function computeCareerChecksum(
  slice: Omit<CareerSliceV1, "checksum">,
): string {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(slice)) {
    if (key !== "checksum") rest[key] = value;
  }
  return fnv1aHex(CAREER_CHECKSUM_SALT + stableStringify(rest));
}

export function stampCareerChecksum(
  slice: Omit<CareerSliceV1, "checksum">,
): CareerSliceV1 {
  return { ...(slice as CareerSliceV1), checksum: computeCareerChecksum(slice) };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

const isLoan = (value: unknown): value is CareerLoan =>
  isRecord(value) &&
  isInteger(value.principalRemaining) &&
  (value.principalRemaining as number) > 0 &&
  isInteger(value.daysRemaining) &&
  (value.daysRemaining as number) >= 1;

const isStats = (value: unknown): value is CareerStats => {
  if (!isRecord(value)) return false;
  const fields = [
    "daysCompleted",
    "grossEarned",
    "tipsEarned",
    "finesPaid",
    "gigsCompleted",
    "gigsOnTime",
    "loansTaken",
    "largestDebt",
  ];
  return fields.every((field) => isInteger(value[field]) && (value[field] as number) >= 0);
};

/**
 * Decodes a persisted career value. Returns null when absent, the verified
 * slice when sound, and the corrupt marker when the structure or checksum is
 * wrong. NEVER clamps — progress.ts's country-map parser is deliberately not
 * reused here, because an "over" career may legitimately carry negative cash.
 *
 * Invariant this relies on: the app only ever replaces the career field
 * through writeCareer/clearCareer (which stamp), so a slice passing through
 * migrate-on-save always re-verifies byte-identically.
 */
export function parseCareerSlice(value: unknown): CareerPersisted {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isRecord(value)) {
    return { state: "corrupt" };
  }
  if (value.state === "corrupt") {
    return { state: "corrupt" };
  }
  if (
    (value.state !== "active" && value.state !== "won" && value.state !== "over") ||
    !COUNTRY_IDS.includes(value.countryId as CountryId) ||
    !DESTINATION_IDS.includes(value.destinationId as DestinationId) ||
    !(value.destinationId as string).startsWith(`${value.countryId as string}-`) ||
    !isInteger(value.careerSeed) ||
    !isInteger(value.day) ||
    (value.day as number) < 1 ||
    !isInteger(value.cash) ||
    (value.loan !== null && !isLoan(value.loan)) ||
    typeof value.finalNotice !== "boolean" ||
    (value.ownedVehicleId !== null &&
      !VEHICLE_IDS.includes(value.ownedVehicleId as CareerVehicleId)) ||
    (value.victoryDay !== null && !isInteger(value.victoryDay)) ||
    (value.rule !== "strict" && value.rule !== "grace") ||
    !isStats(value.stats) ||
    typeof value.checksum !== "string"
  ) {
    return { state: "corrupt" };
  }
  const slice = value as unknown as CareerSliceV1;
  if (computeCareerChecksum(slice) !== slice.checksum) {
    return { state: "corrupt" };
  }
  return slice;
}

export function createCareerSlice(input: {
  readonly countryId: CountryId;
  readonly destinationId: DestinationId;
  readonly careerSeed: number;
  readonly rule?: BankruptcyRule;
}): CareerSliceV1 {
  return stampCareerChecksum({
    state: "active",
    countryId: input.countryId,
    destinationId: input.destinationId,
    careerSeed: input.careerSeed >>> 0,
    day: 1,
    cash: CAREER_STARTING_CASH_BY_COUNTRY[input.countryId],
    loan: null,
    finalNotice: false,
    ownedVehicleId: null,
    victoryDay: null,
    rule: input.rule ?? "grace",
    stats: {
      daysCompleted: 0,
      grossEarned: 0,
      tipsEarned: 0,
      finesPaid: 0,
      gigsCompleted: 0,
      gigsOnTime: 0,
      loansTaken: 0,
      largestDebt: 0,
    },
  });
}

// ---------------------------------------------------------------------------
// Per-day seeds
// ---------------------------------------------------------------------------

const avalanche = (value: number): number => {
  let hash = value >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
};

/**
 * Deterministic per-day traffic seed. Forced into nonzero 31-bit range because
 * the simulation's xorshift32 stream would stick at a zero seed. Same career
 * seed + day always replays identically — that is what makes a mid-day quit
 * "redo the day", not "reroll the day".
 */
export function careerDayTrafficSeed(careerSeed: number, day: number): number {
  const mixed =
    avalanche((careerSeed >>> 0) ^ Math.imul(day, 0x9e3779b1)) & 0x7fffffff;
  return mixed === 0 ? 1 : mixed;
}

/** Base for the day's gig draws; gig i uses base + i, as free drive does. */
export function careerGigSeedBase(careerSeed: number, day: number): number {
  const mixed =
    avalanche((careerSeed >>> 0) ^ 0x5eed_ca7 ^ Math.imul(day, 0x27d4eb2f)) &
    0x7fffffff;
  return mixed === 0 ? 1 : mixed;
}

// ---------------------------------------------------------------------------
// Fares, tips, par times, rent
// ---------------------------------------------------------------------------

export function careerFare(
  baseReward: number,
  kind: GigKind,
  vehicle: CareerVehicleSpec,
): { readonly gross: number; readonly net: number } {
  const factor =
    kind === "delivery" ? vehicle.fareFactors.delivery : vehicle.fareFactors.passenger;
  const gross = Math.round(baseReward * factor);
  const net = Math.round(gross * (1 - COMMISSION_RATE));
  return { gross, net };
}

export function careerTip(gross: number, onTime: boolean): number {
  return onTime ? Math.round(gross * TIP_RATE) : 0;
}

/**
 * Tip window for the carrying leg only (pickup-scene done → delivered), so it
 * is a pure function of the gig and replays identically on a retried day.
 */
export function gigParMs(pickupToDropoffM: number, paceFactor: number): number {
  const seconds = (pickupToDropoffM / (PAR_BASE_SPEED_MPS * paceFactor)) * PAR_SLACK;
  return Math.max(PAR_MIN_MS, Math.round(seconds * 1000));
}

/** Owned vehicles (the bicycle, or a bought-out rental) cost nothing to take out. */
export function vehicleRent(
  vehicle: CareerVehicleSpec,
  slice: CareerSliceV1,
): number {
  if (vehicle.owned || slice.ownedVehicleId === vehicle.id) {
    return 0;
  }
  return vehicle.rentByCountry[slice.countryId];
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

/** Accumulated live during a day: display + stats rollup, no arithmetic re-applied. */
export interface DayLedgerInput {
  readonly grossFares: number;
  readonly netFares: number;
  readonly tips: number;
  readonly finesTotal: number;
  readonly repairsTotal: number;
  readonly fuelSpendTotal: number;
  readonly rentPaid: number;
  readonly gigsCompleted: number;
  readonly gigsOnTime: number;
}

export function emptyDayLog(): DayLedgerInput {
  return {
    grossFares: 0,
    netFares: 0,
    tips: 0,
    finesTotal: 0,
    repairsTotal: 0,
    fuelSpendTotal: 0,
    rentPaid: 0,
    gigsCompleted: 0,
    gigsOnTime: 0,
  };
}

export type LedgerLineKind =
  | "earnings"
  | "commission_info"
  | "tips"
  | "fines"
  | "repairs"
  | "fuel"
  | "rent_info"
  | "platform_fee"
  | "loan_installment"
  | "loan_cleared"
  | "shortfall"
  | "loan_origination"
  | "final_notice"
  | "bankruptcy"
  | "closing_balance";

export interface LedgerLine {
  readonly kind: LedgerLineKind;
  readonly amount: number;
}

export type SettlementOutcome =
  | "solvent"
  | "borrowed"
  | "final_notice"
  | "game_over";

export interface SettlementResult {
  readonly cash: number;
  readonly loan: CareerLoan | null;
  readonly finalNotice: boolean;
  readonly outcome: SettlementOutcome;
  readonly lines: readonly LedgerLine[];
}

export function nextInstallment(loan: CareerLoan): number {
  const days = Math.max(1, loan.daysRemaining);
  return Math.min(Math.ceil(loan.principalRemaining / days), loan.principalRemaining);
}

/**
 * The end-of-day reckoning, in this exact order:
 *
 *   1. informational recap (earnings landed in cash live during the day)
 *   2. platform fee
 *   3. loan installment — ceil(principal / days remaining) closes the loan
 *      exactly at term and self-corrects after a consolidation
 *   4. shortfall → loan conversion, gated by the bankruptcy rule
 *   5. a fully clean settlement (cash ≥ 0, no loan) clears the final notice
 *
 * Under "grace", re-borrowing while indebted consolidates (principal folded,
 * term reset) and raises the final notice; failing again while the notice
 * stands — even if the old loan was cleared this very settlement — is the end.
 */
export function settleDay(input: {
  readonly cash: number;
  readonly ledger: DayLedgerInput;
  readonly loan: CareerLoan | null;
  readonly finalNotice: boolean;
  readonly platformFee: number;
  readonly rule: BankruptcyRule;
}): SettlementResult {
  const lines: LedgerLine[] = [];
  const { ledger } = input;

  lines.push({ kind: "earnings", amount: ledger.grossFares });
  const commission = ledger.grossFares - ledger.netFares;
  if (commission > 0) lines.push({ kind: "commission_info", amount: -commission });
  if (ledger.tips > 0) lines.push({ kind: "tips", amount: ledger.tips });
  if (ledger.finesTotal > 0) lines.push({ kind: "fines", amount: -ledger.finesTotal });
  if (ledger.repairsTotal > 0) {
    lines.push({ kind: "repairs", amount: -ledger.repairsTotal });
  }
  if (ledger.fuelSpendTotal > 0) {
    lines.push({ kind: "fuel", amount: -ledger.fuelSpendTotal });
  }
  if (ledger.rentPaid > 0) lines.push({ kind: "rent_info", amount: -ledger.rentPaid });

  let cash = input.cash - input.platformFee;
  lines.push({ kind: "platform_fee", amount: -input.platformFee });

  let loan = input.loan;
  if (loan) {
    const installment = nextInstallment(loan);
    cash -= installment;
    lines.push({ kind: "loan_installment", amount: -installment });
    const principal = loan.principalRemaining - installment;
    if (principal > 0) {
      loan = { principalRemaining: principal, daysRemaining: loan.daysRemaining - 1 };
    } else {
      loan = null;
      lines.push({ kind: "loan_cleared", amount: 0 });
    }
  }

  let finalNotice = input.finalNotice;
  let outcome: SettlementOutcome = "solvent";

  if (cash < 0) {
    const shortfall = -cash;
    lines.push({ kind: "shortfall", amount: -shortfall });
    const newDebt = Math.ceil(shortfall * (1 + LOAN_ORIGINATION_RATE));
    const indebted = loan !== null;

    if (input.rule === "grace" && input.finalNotice) {
      // The notice stands until a fully clean settlement; clearing the old
      // loan in step 3 does not buy a fresh strike.
      lines.push({ kind: "bankruptcy", amount: cash });
      return { cash, loan, finalNotice, outcome: "game_over", lines };
    }
    if (input.rule === "strict" && indebted) {
      lines.push({ kind: "bankruptcy", amount: cash });
      return { cash, loan, finalNotice, outcome: "game_over", lines };
    }

    if (indebted) {
      // grace: consolidate into one loan on a fresh term, and raise the notice.
      loan = {
        principalRemaining: (loan as CareerLoan).principalRemaining + newDebt,
        daysRemaining: LOAN_TERM_DAYS,
      };
      finalNotice = true;
      outcome = "final_notice";
      lines.push({ kind: "loan_origination", amount: newDebt });
      lines.push({ kind: "final_notice", amount: 0 });
    } else {
      loan = { principalRemaining: newDebt, daysRemaining: LOAN_TERM_DAYS };
      outcome = "borrowed";
      lines.push({ kind: "loan_origination", amount: newDebt });
    }
    cash = 0;
  } else if (loan === null) {
    finalNotice = false;
  }

  lines.push({ kind: "closing_balance", amount: cash });
  return { cash, loan, finalNotice, outcome, lines };
}

/**
 * Folds a finished day into the slice: day counter, cash/loan/notice from the
 * settlement, stats rollup, and the terminal state on bankruptcy. Returns a
 * freshly stamped slice ready to persist.
 */
export function applySettlement(
  slice: CareerSliceV1,
  ledger: DayLedgerInput,
  settlement: SettlementResult,
): CareerSliceV1 {
  const borrowed =
    settlement.outcome === "borrowed" || settlement.outcome === "final_notice";
  const stats: CareerStats = {
    daysCompleted: slice.stats.daysCompleted + 1,
    grossEarned: slice.stats.grossEarned + ledger.grossFares,
    tipsEarned: slice.stats.tipsEarned + ledger.tips,
    finesPaid: slice.stats.finesPaid + ledger.finesTotal,
    gigsCompleted: slice.stats.gigsCompleted + ledger.gigsCompleted,
    gigsOnTime: slice.stats.gigsOnTime + ledger.gigsOnTime,
    loansTaken: slice.stats.loansTaken + (borrowed ? 1 : 0),
    largestDebt: Math.max(
      slice.stats.largestDebt,
      settlement.loan?.principalRemaining ?? 0,
    ),
  };
  return stampCareerChecksum({
    ...slice,
    day: slice.day + 1,
    cash: settlement.cash,
    loan: settlement.loan,
    finalNotice: settlement.finalNotice,
    state: settlement.outcome === "game_over" ? "over" : slice.state,
    stats,
  });
}

// ---------------------------------------------------------------------------
// Buyout (the win condition)
// ---------------------------------------------------------------------------

export function buyoutPrice(
  vehicle: CareerVehicleSpec,
  countryId: CountryId,
): number {
  return vehicle.rentByCountry[countryId] * BUYOUT_RENT_MULTIPLIER;
}

/**
 * One buyout per career: debt-free, playable, eligible vehicle, cash covers
 * the price, and nothing owned yet. Buying is the victory.
 */
export function canBuyout(
  slice: CareerSliceV1,
  vehicle: CareerVehicleSpec,
): boolean {
  return (
    slice.state !== "over" &&
    vehicle.buyoutEligible &&
    slice.loan === null &&
    !slice.finalNotice &&
    slice.ownedVehicleId === null &&
    slice.cash >= buyoutPrice(vehicle, slice.countryId)
  );
}

export function applyBuyout(
  slice: CareerSliceV1,
  vehicle: CareerVehicleSpec,
): CareerSliceV1 {
  if (!canBuyout(slice, vehicle)) {
    throw new Error(`Buyout not available for ${vehicle.id}`);
  }
  return stampCareerChecksum({
    ...slice,
    cash: slice.cash - buyoutPrice(vehicle, slice.countryId),
    ownedVehicleId: vehicle.id,
    state: "won",
    victoryDay: slice.victoryDay ?? slice.day,
  });
}
