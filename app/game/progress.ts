import {
  FREE_DRIVES,
  LESSONS,
  SCORING_CONFIG,
  getCountryIdForScenario,
  getCountryProfile,
  getLessonsForCountry,
  getLesson,
  getOrientationForTrafficSide,
  isLessonId,
} from "./content";
import type {
  AccessibilityPreferences,
  BadgeId,
  CameraMode,
  CountryId,
  FreeDriveId,
  InputFamily,
  LessonId,
  LessonProgressUpdate,
  LessonScore,
  PlayerProgressV1,
  RecommendedDrive,
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
]);

const COUNTRY_IDS = new Set<CountryId>(["us", "uk", "fr", "jp"]);

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

const parseCamera = (value: unknown): CameraMode => {
  if (value === "first_person" || value === "first" || value === "cockpit") {
    return "first_person";
  }
  return "third_person";
};

const parseInput = (value: unknown): InputFamily => {
  if (value === "gamepad" || value === "controller") {
    return "gamepad";
  }
  if (value === "touch" || value === "mobile") {
    return "touch";
  }
  return "keyboard";
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
      (value.preferredInput === "keyboard" ||
        value.preferredInput === "gamepad" ||
        value.preferredInput === "touch") &&
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
  const input =
    value.preferredInput ?? settings.input ?? preferences.input ?? preferences.preferredInput;

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
    camera === "third" ||
    input === "keyboard" ||
    input === "gamepad" ||
    input === "touch"
  );
};

const inferLastCountryId = (
  scores: Readonly<Partial<Record<LessonId, LessonScore>>>,
  familiarTrafficSide: TrafficSide,
): CountryId => {
  let latestCountry: CountryId | undefined;
  let latestCompletedAt = Number.NEGATIVE_INFINITY;

  for (const score of Object.values(scores)) {
    if (!score) continue;
    const countryId = getLesson(score.lessonId).countryId;
    if (!countryId) continue;
    const completedAt = Date.parse(score.completedAt);
    if (Number.isFinite(completedAt) && completedAt >= latestCompletedAt) {
      latestCountry = countryId;
      latestCompletedAt = completedAt;
    }
  }

  return latestCountry ?? oppositeSideStarterCountry(familiarTrafficSide);
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
    preferredCamera: "third_person",
    preferredInput: "keyboard",
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
  const inputCandidate =
    value.preferredInput ?? settings.input ?? preferences.input ?? preferences.preferredInput;
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
    inferLastCountryId(scores, familiarTrafficSide);

  return {
    version: 1,
    completedLessonIds: unique([
      ...parseLessonIds(completedCandidate),
      ...completedFromScores,
    ]),
    lessonScores: scores,
    badges: parseBadges(value.badges),
    passportStamps: parseStamps(value.passportStamps ?? value.stamps),
    familiarTrafficSide,
    familiarSideConfirmed,
    lastCountryId,
    preferredCamera: parseCamera(cameraCandidate),
    preferredInput: parseInput(inputCandidate),
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
  if (value.preferredCamera !== "first_person" && value.preferredCamera !== "third_person") {
    return false;
  }
  if (
    value.preferredInput !== "keyboard" &&
    value.preferredInput !== "gamepad" &&
    value.preferredInput !== "touch"
  ) {
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
    if (sourceKey !== PROGRESS_STORAGE_KEY) {
      try {
        storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
        storage.removeItem?.(sourceKey);
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

const badgesForCompletion = (
  lessonId: LessonId,
  score: LessonScore,
  cameraUsed: CameraMode,
): BadgeId[] => {
  const badges: BadgeId[] = [];

  if (lessonId === "orientation-right") badges.push("right_side_ready");
  if (lessonId === "orientation-left") badges.push("left_side_ready");
  if (lessonId === "us-signals-crosswalks") badges.push("signal_scholar");
  if (lessonId === "uk-roundabouts" || lessonId === "fr-priority-roundabouts") {
    badges.push("roundabout_ready");
  }
  if (
    lessonId === "us-lane-choice" ||
    lessonId === "uk-dual-carriageway" ||
    lessonId === "fr-speed-merging"
  ) {
    badges.push("lane_courtesy");
  }
  if (lessonId === "jp-vulnerable-road-users") {
    badges.push("vulnerable_road_guardian");
  }
  if (lessonId === "jp-railway-crossings") badges.push("rail_crossing_ready");
  if (lessonId === "uk-fr-side-swap") badges.push("side_swap_traveler");
  if (score.mastered && cameraUsed === "first_person") {
    badges.push("first_person_mastery");
  }

  return badges;
};

const stampsForCompletion = (lessonId: LessonId): CountryId[] => {
  const lesson = getLesson(lessonId);
  if (lesson.countryId) {
    return [lesson.countryId];
  }
  if (lessonId === "uk-fr-side-swap") {
    return ["uk", "fr"];
  }
  return [];
};

export function updateLessonProgress(
  progress: PlayerProgressV1,
  update: LessonProgressUpdate,
  now: string = nowIso(),
): PlayerProgressV1 {
  const current = migrateProgress(progress, now);
  const score = normalizeScore(update.score.lessonId, update.score, now);
  if (!score) {
    return current;
  }

  const previousScore = current.lessonScores[score.lessonId];
  const bestScore = !previousScore || score.total >= previousScore.total ? score : previousScore;
  const lessonScores: Partial<Record<LessonId, LessonScore>> = {
    ...current.lessonScores,
    [score.lessonId]: bestScore,
  };

  return {
    ...current,
    completedLessonIds: unique([...current.completedLessonIds, score.lessonId]),
    lessonScores,
    badges: unique([
      ...current.badges,
      ...badgesForCompletion(score.lessonId, score, update.cameraUsed),
    ]),
    passportStamps: unique([
      ...current.passportStamps,
      ...stampsForCompletion(score.lessonId),
    ]),
    updatedAt: asIsoDate(now, nowIso()),
  };
}

export function isLessonUnlocked(progress: PlayerProgressV1, lessonId: LessonId): boolean {
  const lesson = getLesson(lessonId);
  return lesson.prerequisites.every((id) => progress.completedLessonIds.includes(id));
}

export function getUnlockedLessonIds(progress: PlayerProgressV1): readonly LessonId[] {
  return LESSONS.filter((lesson) => isLessonUnlocked(progress, lesson.id)).map(
    (lesson) => lesson.id,
  );
}

export function isFreeDriveUnlocked(
  progress: PlayerProgressV1,
  freeDriveId: FreeDriveId,
): boolean {
  const freeDrive = FREE_DRIVES.find((item) => item.id === freeDriveId);
  return Boolean(freeDrive && progress.completedLessonIds.includes(freeDrive.unlockAfter));
}

export function getUnlockedFreeDriveIds(
  progress: PlayerProgressV1,
): readonly FreeDriveId[] {
  return FREE_DRIVES.filter((freeDrive) =>
    progress.completedLessonIds.includes(freeDrive.unlockAfter),
  ).map((freeDrive) => freeDrive.id);
}

export function getRecommendedDrive(
  progress: PlayerProgressV1,
  countryId: CountryId,
): RecommendedDrive {
  const profile = getCountryProfile(countryId);
  const orientation = getOrientationForTrafficSide(profile.trafficSide);

  if (!progress.completedLessonIds.includes(orientation.id)) {
    return {
      countryId,
      scenarioId: orientation.id,
      kind: "orientation",
      ctaLabel: `Start ${profile.destinationName} orientation`,
    };
  }

  const nextLesson = getLessonsForCountry(countryId).find(
    (lesson) =>
      !progress.completedLessonIds.includes(lesson.id) &&
      isLessonUnlocked(progress, lesson.id),
  );
  if (nextLesson) {
    return {
      countryId,
      scenarioId: nextLesson.id,
      kind: "lesson",
      ctaLabel: `Continue — ${nextLesson.title}`,
    };
  }

  const allCountryPathsComplete = LESSONS.filter((lesson) => lesson.countryId).every(
    (lesson) => progress.completedLessonIds.includes(lesson.id),
  );
  const capstone = getLesson("uk-fr-side-swap");
  if (
    allCountryPathsComplete &&
    !progress.completedLessonIds.includes(capstone.id)
  ) {
    return {
      countryId: getCountryIdForScenario(capstone.id),
      scenarioId: capstone.id,
      kind: "capstone",
      ctaLabel: `Continue — ${capstone.title}`,
    };
  }

  const freeDrive = FREE_DRIVES.find((scenario) => scenario.countryId === countryId);
  if (!freeDrive) {
    throw new Error(`Missing SideSwap free-drive scenario for country ${countryId}`);
  }
  return {
    countryId,
    scenarioId: freeDrive.id,
    kind: "free_drive",
    ctaLabel: `Continue — ${freeDrive.title}`,
  };
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
