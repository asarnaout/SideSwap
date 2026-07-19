import {
  SCORING_CONFIG,
  getDestinationProfile,
  isLessonId,
} from "./content";
import type {
  AccessibilityPreferences,
  BadgeId,
  CameraMode,
  CountryId,
  DestinationId,
  LessonId,
  LessonScore,
  PlayerProgressV1,
  TrafficSide,
} from "./types";

export const PROGRESS_STORAGE_KEY = "sideswap:v1";

const LEGACY_STORAGE_KEYS = ["sideswap:progress", "sideswap:v0"] as const;

export interface ProgressStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

const BADGE_IDS = new Set<BadgeId>([
  "right_side_ready",
  "left_side_ready",
  "signal_scholar",
  "roundabout_ready",
  "lane_courtesy",
  "vulnerable_road_guardian",
  "rail_crossing_ready",
  "side_swap_traveler",
  "first_person_mastery",
  "london_city_ready",
]);

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
  coachVolume: 0.9,
};

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

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

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

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

const parseTrafficSide = (value: unknown): TrafficSide =>
  value === "left" ? "left" : "right";

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
    coachVolume: clamp(record.coachVolume, 0, 1, DEFAULT_ACCESSIBILITY.coachVolume),
  };
};

const parseLessonIds = (value: unknown): LessonId[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return unique(
    value.filter((item): item is LessonId => typeof item === "string" && isLessonId(item)),
  );
};

const parseBadges = (value: unknown): BadgeId[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return unique(
    value.filter(
      (item): item is BadgeId => typeof item === "string" && BADGE_IDS.has(item as BadgeId),
    ),
  );
};

const parseStamps = (value: unknown): CountryId[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return unique(
    value.filter(
      (item): item is CountryId =>
        typeof item === "string" && COUNTRY_IDS.has(item as CountryId),
    ),
  );
};

const normalizeScore = (
  lessonId: LessonId,
  value: unknown,
  fallbackDate: string,
): LessonScore | undefined => {
  if (typeof value === "number") {
    const total = clamp(value, 0, 100, 0);
    return {
      lessonId,
      total,
      safety: total,
      ruleUse: total,
      vehicleControl: total,
      criticalErrors: 0,
      mastered: total >= SCORING_CONFIG.masteryThreshold,
      completedAt: fallbackDate,
      durationMs: 0,
    };
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const safety = clamp(value.safety, 0, 100, 100);
  const ruleUse = clamp(value.ruleUse, 0, 100, 100);
  const vehicleControl = clamp(value.vehicleControl, 0, 100, 100);
  const weightedTotal =
    safety * SCORING_CONFIG.weights.safety +
    ruleUse * SCORING_CONFIG.weights.ruleUse +
    vehicleControl * SCORING_CONFIG.weights.vehicleControl;
  const total = clamp(value.total, 0, 100, Math.round(weightedTotal));
  const criticalErrors = Math.round(clamp(value.criticalErrors, 0, 999, 0));

  return {
    lessonId,
    total,
    safety,
    ruleUse,
    vehicleControl,
    criticalErrors,
    mastered:
      total >= SCORING_CONFIG.masteryThreshold &&
      (SCORING_CONFIG.masteryAllowsCriticalErrors || criticalErrors === 0),
    completedAt: asIsoDate(value.completedAt, fallbackDate),
    durationMs: Math.round(clamp(value.durationMs, 0, 24 * 60 * 60 * 1000, 0)),
  };
};

const parseLessonScores = (
  value: unknown,
  fallbackDate: string,
): Partial<Record<LessonId, LessonScore>> => {
  if (!isRecord(value)) {
    return {};
  }

  const scores: Partial<Record<LessonId, LessonScore>> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!isLessonId(key)) {
      continue;
    }
    const score = normalizeScore(key, candidate, fallbackDate);
    if (score) {
      scores[key] = score;
    }
  }
  return scores;
};

const oppositeSideStarterCountry = (familiarTrafficSide: TrafficSide): CountryId =>
  familiarTrafficSide === "right" ? "uk" : "us";

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

const hasLegacyProgressShape = (value: UnknownRecord): boolean => {
  if (value.version === 1) {
    return (
      Array.isArray(value.completedLessonIds) &&
      isRecord(value.lessonScores) &&
      Array.isArray(value.badges) &&
      Array.isArray(value.passportStamps) &&
      (value.familiarTrafficSide === "left" || value.familiarTrafficSide === "right") &&
      (value.preferredCamera === "first_person" ||
        value.preferredCamera === "third_person") &&
      isRecord(value.accessibility) &&
      typeof value.updatedAt === "string"
    );
  }

  if (value.version !== undefined && value.version !== 0) {
    return false;
  }

  const settings = readNestedRecord(value, "settings");
  const preferences = readNestedRecord(value, "preferences");
  const familiarSide =
    value.familiarTrafficSide ?? settings.familiarTrafficSide ?? preferences.familiarTrafficSide;
  const camera =
    value.preferredCamera ?? settings.camera ?? preferences.camera ?? preferences.preferredCamera;

  return (
    Array.isArray(value.completedLessonIds) ||
    Array.isArray(value.completedLessons) ||
    isRecord(value.lessonScores) ||
    isRecord(value.scores) ||
    familiarSide === "left" ||
    familiarSide === "right" ||
    camera === "first_person" ||
    camera === "third_person" ||
    camera === "first" ||
    camera === "third"
  );
};

const inferLastCountryId = (familiarTrafficSide: TrafficSide): CountryId =>
  oppositeSideStarterCountry(familiarTrafficSide);

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

export function createDefaultProgress(now: string = nowIso()): PlayerProgressV1 {
  const updatedAt = asIsoDate(now, nowIso());
  return {
    version: 1,
    completedLessonIds: [],
    lessonScores: {},
    badges: [],
    passportStamps: [],
    familiarTrafficSide: "right",
    familiarSideConfirmed: false,
    lastCountryId: "uk",
    lastDestinationId: "uk-london",
    preferredCamera: "third_person",
    accessibility: { ...DEFAULT_ACCESSIBILITY },
    updatedAt,
  };
}

/**
 * Normalizes v1, pre-versioned, and lightweight v0 progress shapes. Unknown,
 * malformed, and future fields are discarded rather than trusted.
 */
export function migrateProgress(value: unknown, now: string = nowIso()): PlayerProgressV1 {
  const fallback = createDefaultProgress(now);
  if (!isRecord(value)) {
    return fallback;
  }

  const settings = readNestedRecord(value, "settings");
  const preferences = readNestedRecord(value, "preferences");
  const updatedAt = asIsoDate(value.updatedAt, fallback.updatedAt);

  const completedCandidate = hasOwn(value, "completedLessonIds")
    ? value.completedLessonIds
    : value.completedLessons;
  const scoresCandidate = hasOwn(value, "lessonScores") ? value.lessonScores : value.scores;
  const familiarCandidate =
    value.familiarTrafficSide ?? settings.familiarTrafficSide ?? preferences.familiarTrafficSide;
  const cameraCandidate =
    value.preferredCamera ?? settings.camera ?? preferences.camera ?? preferences.preferredCamera;
  const accessibilityCandidate =
    value.accessibility ?? settings.accessibility ?? preferences.accessibility;

  const scores = parseLessonScores(scoresCandidate, updatedAt);
  const completedFromScores = Object.keys(scores).filter(isLessonId);
  const familiarTrafficSide = parseTrafficSide(familiarCandidate);
  const recognizedProgress = hasLegacyProgressShape(value);
  const familiarSideConfirmed = recognizedProgress
    ? asBoolean(value.familiarSideConfirmed, true)
    : false;
  const lastCountryId =
    (recognizedProgress ? parseCountryId(value.lastCountryId) : undefined) ??
    inferLastCountryId(familiarTrafficSide);
  const lastDestinationId = inferLastDestinationId(
    recognizedProgress ? value.lastDestinationId : undefined,
    lastCountryId,
  );
  const completedLessonIds = unique([
    ...parseLessonIds(completedCandidate),
    ...completedFromScores,
  ]);
  const badges = parseBadges(value.badges).filter(
    (badge) =>
      badge !== "london_city_ready" ||
      completedLessonIds.includes("uk-london-exhibition-road"),
  );

  return {
    version: 1,
    completedLessonIds,
    lessonScores: scores,
    badges,
    passportStamps: parseStamps(value.passportStamps ?? value.stamps),
    familiarTrafficSide,
    familiarSideConfirmed,
    lastCountryId,
    lastDestinationId,
    preferredCamera: parseCamera(cameraCandidate),
    accessibility: parseAccessibility(accessibilityCandidate),
    updatedAt,
  };
}

export function isPlayerProgressV1(value: unknown): value is PlayerProgressV1 {
  if (!isRecord(value) || value.version !== 1) {
    return false;
  }
  if (!Array.isArray(value.completedLessonIds) || !isRecord(value.lessonScores)) {
    return false;
  }
  if (!Array.isArray(value.badges) || !Array.isArray(value.passportStamps)) {
    return false;
  }
  if (value.familiarTrafficSide !== "left" && value.familiarTrafficSide !== "right") {
    return false;
  }
  if (typeof value.familiarSideConfirmed !== "boolean") {
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
): PlayerProgressV1 {
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
  progress: PlayerProgressV1,
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
): PlayerProgressV1 {
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
