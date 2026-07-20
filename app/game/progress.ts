import {
  STARTING_WALLET_BY_COUNTRY,
  TANK_CAPACITY_L,
  getDestinationProfile,
} from "./content";
import type {
  AccessibilityPreferences,
  CameraMode,
  CountryId,
  DestinationId,
  PlayerProgressV2,
} from "./types";

export const PROGRESS_STORAGE_KEY = "sideswap:v2";

// Older keys are migrated forward and then removed. "sideswap:v1" held the
// (now-retired) lesson progress; its preference fields are preserved, its lesson
// data discarded, and a fresh per-country wallet + full fuel tank are seeded.
const LEGACY_STORAGE_KEYS = ["sideswap:v1", "sideswap:progress", "sideswap:v0"] as const;

const WALLET_MAX = Number.MAX_SAFE_INTEGER;

export interface ProgressStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

const COUNTRY_IDS = new Set<CountryId>(["us", "uk", "fr", "jp"]);
const DESTINATION_IDS = new Set<DestinationId>([
  "us-nyc",
  "uk-london",
  "uk-milton-keynes",
  "fr-calais",
  "jp-tokyo",
]);

const DEFAULT_ACCESSIBILITY: AccessibilityPreferences = {
  subtitles: true,
  visualHonkIndicator: true,
  reducedMotion: false,
  cameraShake: false,
  headBob: false,
  steeringSensitivity: 1,
  fieldOfView: 72,
  masterVolume: 0.8,
  effectsVolume: 0.8,
  // Under the effects bus by default: music is a bed, not the main event.
  musicVolume: 0.55,
};

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const clamp = (value: unknown, minimum: number, maximum: number, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, value));
};

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const asIsoDate = (value: unknown, fallback: string): string => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    return fallback;
  }
  return new Date(value).toISOString();
};

const nowIso = (): string => new Date().toISOString();

const getDefaultStorage = (): ProgressStorage | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

const readNestedRecord = (record: UnknownRecord, key: string): UnknownRecord =>
  isRecord(record[key]) ? record[key] : {};

const parseCountryId = (value: unknown): CountryId | undefined =>
  typeof value === "string" && COUNTRY_IDS.has(value as CountryId)
    ? (value as CountryId)
    : undefined;

const parseDestinationId = (value: unknown): DestinationId | undefined =>
  typeof value === "string" && DESTINATION_IDS.has(value as DestinationId)
    ? (value as DestinationId)
    : undefined;

const parseCamera = (value: unknown): CameraMode => {
  if (value === "first_person" || value === "first" || value === "cockpit") {
    return "first_person";
  }
  return "third_person";
};

const parseAccessibility = (value: unknown): AccessibilityPreferences => {
  const record = isRecord(value) ? value : {};
  return {
    subtitles: asBoolean(record.subtitles, DEFAULT_ACCESSIBILITY.subtitles),
    visualHonkIndicator: asBoolean(
      record.visualHonkIndicator,
      DEFAULT_ACCESSIBILITY.visualHonkIndicator,
    ),
    reducedMotion: asBoolean(record.reducedMotion, DEFAULT_ACCESSIBILITY.reducedMotion),
    cameraShake: asBoolean(record.cameraShake, DEFAULT_ACCESSIBILITY.cameraShake),
    headBob: asBoolean(record.headBob, DEFAULT_ACCESSIBILITY.headBob),
    steeringSensitivity: clamp(
      record.steeringSensitivity,
      0.5,
      2,
      DEFAULT_ACCESSIBILITY.steeringSensitivity,
    ),
    fieldOfView: clamp(record.fieldOfView, 55, 100, DEFAULT_ACCESSIBILITY.fieldOfView),
    masterVolume: clamp(record.masterVolume, 0, 1, DEFAULT_ACCESSIBILITY.masterVolume),
    effectsVolume: clamp(record.effectsVolume, 0, 1, DEFAULT_ACCESSIBILITY.effectsVolume),
    // Saved blobs from before the coach was removed carry a `coachVolume` that
    // simply falls away here — this builds a fresh object from known keys, so no
    // progress-version bump is needed to retire it.
    musicVolume: clamp(record.musicVolume, 0, 1, DEFAULT_ACCESSIBILITY.musicVolume),
  };
};

const eachCountry = (value: number): Record<CountryId, number> => ({
  us: value,
  uk: value,
  fr: value,
  jp: value,
});

// Reads a persisted per-country number map, clamping each entry to [0, max] and
// falling back to `defaults` for any missing or invalid country.
const parseCountryNumberMap = (
  value: unknown,
  defaults: Readonly<Record<CountryId, number>>,
  max: number,
): Record<CountryId, number> => {
  const record = isRecord(value) ? value : {};
  const result = {} as Record<CountryId, number>;
  for (const id of COUNTRY_IDS) {
    result[id] = clamp(record[id], 0, max, defaults[id]);
  }
  return result;
};

const isCountryNumberMap = (value: unknown): boolean => {
  if (!isRecord(value)) {
    return false;
  }
  for (const id of COUNTRY_IDS) {
    if (typeof value[id] !== "number" || !Number.isFinite(value[id] as number)) {
      return false;
    }
  }
  return true;
};

const defaultDestinationForCountry = (countryId: CountryId): DestinationId => {
  switch (countryId) {
    case "us":
      return "us-nyc";
    case "uk":
      return "uk-london";
    case "fr":
      return "fr-calais";
    case "jp":
      return "jp-tokyo";
  }
};

const inferLastDestinationId = (
  explicitDestinationId: unknown,
  lastCountryId: CountryId,
): DestinationId => {
  const parsedDestinationId = parseDestinationId(explicitDestinationId);
  if (
    parsedDestinationId &&
    getDestinationProfile(parsedDestinationId).countryId === lastCountryId
  ) {
    return parsedDestinationId;
  }
  return defaultDestinationForCountry(lastCountryId);
};

export function createDefaultProgress(now: string = nowIso()): PlayerProgressV2 {
  const updatedAt = asIsoDate(now, nowIso());
  return {
    version: 2,
    walletByCountry: { ...STARTING_WALLET_BY_COUNTRY },
    fuelByCountry: eachCountry(TANK_CAPACITY_L),
    lifetimeEarnings: eachCountry(0),
    completedGigCount: 0,
    lastCountryId: "uk",
    lastDestinationId: "uk-london",
    preferredCamera: "third_person",
    accessibility: { ...DEFAULT_ACCESSIBILITY },
    updatedAt,
  };
}

/**
 * Normalizes any prior progress blob (v2, the lesson-era v1, or older) into the
 * current V2 shape. Preferences (last city, camera, accessibility) are carried
 * across; wallet/fuel/earnings are preserved when present and otherwise seeded
 * to the starting balance + a full tank. Unknown fields are discarded.
 */
export function migrateProgress(value: unknown, now: string = nowIso()): PlayerProgressV2 {
  const fallback = createDefaultProgress(now);
  if (!isRecord(value)) {
    return fallback;
  }

  const settings = readNestedRecord(value, "settings");
  const preferences = readNestedRecord(value, "preferences");
  const updatedAt = asIsoDate(value.updatedAt, fallback.updatedAt);
  const lastCountryId = parseCountryId(value.lastCountryId) ?? fallback.lastCountryId;
  const lastDestinationId = inferLastDestinationId(value.lastDestinationId, lastCountryId);
  const cameraCandidate =
    value.preferredCamera ?? settings.camera ?? preferences.camera ?? preferences.preferredCamera;
  const accessibilityCandidate =
    value.accessibility ?? settings.accessibility ?? preferences.accessibility;

  return {
    version: 2,
    walletByCountry: parseCountryNumberMap(
      value.walletByCountry,
      STARTING_WALLET_BY_COUNTRY,
      WALLET_MAX,
    ),
    fuelByCountry: parseCountryNumberMap(
      value.fuelByCountry,
      eachCountry(TANK_CAPACITY_L),
      TANK_CAPACITY_L,
    ),
    lifetimeEarnings: parseCountryNumberMap(
      value.lifetimeEarnings,
      eachCountry(0),
      WALLET_MAX,
    ),
    completedGigCount: Math.round(clamp(value.completedGigCount, 0, WALLET_MAX, 0)),
    lastCountryId,
    lastDestinationId,
    preferredCamera: parseCamera(cameraCandidate),
    accessibility: parseAccessibility(accessibilityCandidate),
    updatedAt,
  };
}

export function isPlayerProgressV2(value: unknown): value is PlayerProgressV2 {
  if (!isRecord(value) || value.version !== 2) {
    return false;
  }
  if (
    !isCountryNumberMap(value.walletByCountry) ||
    !isCountryNumberMap(value.fuelByCountry) ||
    !isCountryNumberMap(value.lifetimeEarnings)
  ) {
    return false;
  }
  if (typeof value.completedGigCount !== "number") {
    return false;
  }
  if (typeof value.lastCountryId !== "string" || !COUNTRY_IDS.has(value.lastCountryId as CountryId)) {
    return false;
  }
  if (
    typeof value.lastDestinationId !== "string" ||
    !DESTINATION_IDS.has(value.lastDestinationId as DestinationId) ||
    getDestinationProfile(value.lastDestinationId as DestinationId).countryId !==
      value.lastCountryId
  ) {
    return false;
  }
  if (value.preferredCamera !== "first_person" && value.preferredCamera !== "third_person") {
    return false;
  }
  return isRecord(value.accessibility) && typeof value.updatedAt === "string";
}

export function loadProgress(
  storage: ProgressStorage | undefined = getDefaultStorage(),
): PlayerProgressV2 {
  const fallback = createDefaultProgress();
  if (!storage) {
    return fallback;
  }

  let raw: string | null = null;
  let sourceKey: string = PROGRESS_STORAGE_KEY;

  try {
    raw = storage.getItem(PROGRESS_STORAGE_KEY);
    if (raw === null) {
      for (const legacyKey of LEGACY_STORAGE_KEYS) {
        const legacyRaw = storage.getItem(legacyKey);
        if (legacyRaw !== null) {
          raw = legacyRaw;
          sourceKey = legacyKey;
          break;
        }
      }
    }
  } catch {
    return fallback;
  }

  if (raw === null) {
    return fallback;
  }

  try {
    const progress = migrateProgress(JSON.parse(raw), fallback.updatedAt);
    const serializedProgress = JSON.stringify(progress);
    if (sourceKey !== PROGRESS_STORAGE_KEY || raw !== serializedProgress) {
      try {
        storage.setItem(PROGRESS_STORAGE_KEY, serializedProgress);
        if (sourceKey !== PROGRESS_STORAGE_KEY) {
          storage.removeItem?.(sourceKey);
        }
      } catch {
        // Reading remains useful when storage is full or write access is denied.
      }
    }
    return progress;
  } catch {
    try {
      storage.removeItem?.(sourceKey);
    } catch {
      // A broken storage implementation should never prevent the game from loading.
    }
    return fallback;
  }
}

export function saveProgress(
  progress: PlayerProgressV2,
  storage: ProgressStorage | undefined = getDefaultStorage(),
): boolean {
  if (!storage) {
    return false;
  }
  try {
    const normalized = migrateProgress(progress, progress.updatedAt);
    storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

export function resetProgress(
  storage: ProgressStorage | undefined = getDefaultStorage(),
): PlayerProgressV2 {
  const progress = createDefaultProgress();
  if (storage) {
    try {
      storage.removeItem?.(PROGRESS_STORAGE_KEY);
      for (const legacyKey of LEGACY_STORAGE_KEYS) {
        storage.removeItem?.(legacyKey);
      }
    } catch {
      // Reset still succeeds in memory when browser storage is unavailable.
    }
  }
  return progress;
}

const withCountryValue = (
  map: Readonly<Record<CountryId, number>>,
  countryId: CountryId,
  next: number,
): Record<CountryId, number> => ({ ...map, [countryId]: next });

/** Adds gig income to a country's wallet (and lifetime earnings). Immutable. */
export function credit(
  progress: PlayerProgressV2,
  countryId: CountryId,
  amount: number,
): PlayerProgressV2 {
  const gain = Math.max(0, amount);
  return {
    ...progress,
    walletByCountry: withCountryValue(
      progress.walletByCountry,
      countryId,
      progress.walletByCountry[countryId] + gain,
    ),
    lifetimeEarnings: withCountryValue(
      progress.lifetimeEarnings,
      countryId,
      progress.lifetimeEarnings[countryId] + gain,
    ),
    updatedAt: nowIso(),
  };
}

/** Spends from a country's wallet, clamped at zero. Immutable. */
export function debit(
  progress: PlayerProgressV2,
  countryId: CountryId,
  amount: number,
): PlayerProgressV2 {
  const spend = Math.max(0, amount);
  return {
    ...progress,
    walletByCountry: withCountryValue(
      progress.walletByCountry,
      countryId,
      Math.max(0, progress.walletByCountry[countryId] - spend),
    ),
    updatedAt: nowIso(),
  };
}

/** Burns fuel in a country's tank, clamped at zero. Immutable. */
export function consumeFuel(
  progress: PlayerProgressV2,
  countryId: CountryId,
  litres: number,
): PlayerProgressV2 {
  const used = Math.max(0, litres);
  return {
    ...progress,
    fuelByCountry: withCountryValue(
      progress.fuelByCountry,
      countryId,
      Math.max(0, progress.fuelByCountry[countryId] - used),
    ),
    updatedAt: nowIso(),
  };
}

/** Sets a country's fuel level, clamped to [0, tank capacity]. Immutable. */
export function setFuel(
  progress: PlayerProgressV2,
  countryId: CountryId,
  litres: number,
): PlayerProgressV2 {
  return {
    ...progress,
    fuelByCountry: withCountryValue(
      progress.fuelByCountry,
      countryId,
      Math.min(TANK_CAPACITY_L, Math.max(0, litres)),
    ),
    updatedAt: nowIso(),
  };
}
