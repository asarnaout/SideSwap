import { describe, expect, it } from "vitest";
import {
  createDefaultProgress,
  getRecommendedDrive,
  isCapstoneEligible,
  isFreeDriveUnlocked,
  isLessonUnlocked,
  isPlayerProgressV1,
  loadProgress,
  migrateProgress,
  saveProgress,
  updateLessonProgress,
} from "../app/game/progress";
import type { LessonId, PlayerProgressV1 } from "../app/game/types";
import type { ProgressStorage } from "../app/game/progress";

function memoryStorage(initial?: string): ProgressStorage {
  const values = new Map<string, string>();
  if (initial) values.set("sideswap:v1", initial);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function withoutLauncherMetadata(
  progress: PlayerProgressV1,
): Record<string, unknown> {
  const legacy: Record<string, unknown> = { ...progress };
  delete legacy.familiarSideConfirmed;
  delete legacy.lastCountryId;
  delete legacy.lastDestinationId;
  return legacy;
}

describe("local progress", () => {
  const scoreFor = (
    lessonId: Parameters<typeof updateLessonProgress>[1]["score"]["lessonId"],
    total = 65,
  ) => ({
    lessonId,
    total,
    safety: total,
    ruleUse: total,
    vehicleControl: total,
    criticalErrors: 0,
    mastered: total >= 80,
    completedAt: "2026-07-10T12:05:00.000Z",
    durationMs: 300_000,
  });

  it("recovers safely from a corrupt save", () => {
    const progress = loadProgress(memoryStorage("{bad json"));
    expect(progress.version).toBe(1);
    expect(progress.completedLessonIds).toEqual([]);
    expect(progress.familiarSideConfirmed).toBe(false);
    expect(progress.lastCountryId).toBe("uk");
    expect(progress.lastDestinationId).toBe("uk-london");
  });

  it("keeps fresh or unrecognized progress unconfirmed", () => {
    expect(createDefaultProgress().familiarSideConfirmed).toBe(false);
    expect(migrateProgress({ version: 1, unknown: true }).familiarSideConfirmed).toBe(
      false,
    );
  });

  it("loads legacy input preferences but removes them from the rewritten save", () => {
    const legacySave = {
      ...createDefaultProgress("2026-07-10T12:00:00.000Z"),
      preferredInput: "gamepad",
    };
    const storage = memoryStorage(JSON.stringify(legacySave));

    const restored = loadProgress(storage);
    const rewritten = JSON.parse(storage.getItem("sideswap:v1") ?? "{}") as Record<
      string,
      unknown
    >;

    expect(isPlayerProgressV1(restored)).toBe(true);
    expect(restored).not.toHaveProperty("preferredInput");
    expect(rewritten).not.toHaveProperty("preferredInput");
  });

  it("requires a coherent country and destination in normalized v1 progress", () => {
    const progress = createDefaultProgress();
    expect(isPlayerProgressV1(progress)).toBe(true);
    expect(
      isPlayerProgressV1({
        ...progress,
        lastCountryId: "us",
        lastDestinationId: "uk-london",
      }),
    ).toBe(false);
  });

  it("confirms a valid legacy save and infers its most recently scored country", () => {
    const current = createDefaultProgress("2026-07-10T12:00:00.000Z");
    const legacy = withoutLauncherMetadata(current);
    const restored = loadProgress(
      memoryStorage(
        JSON.stringify({
          ...legacy,
          completedLessonIds: ["us-one-way-grid", "jp-left-side-basics"],
          lessonScores: {
            "us-one-way-grid": {
              ...scoreFor("us-one-way-grid"),
              completedAt: "2026-07-10T12:05:00.000Z",
            },
            "jp-left-side-basics": {
              ...scoreFor("jp-left-side-basics"),
              completedAt: "2026-07-10T12:10:00.000Z",
            },
          },
        }),
      ),
    );

    expect(restored.familiarSideConfirmed).toBe(true);
    expect(restored.lastCountryId).toBe("jp");
    expect(restored.lastDestinationId).toBe("jp-tokyo");
  });

  it("uses the opposite-side starter when a legacy save has no country score", () => {
    const current = createDefaultProgress("2026-07-10T12:00:00.000Z");
    const legacy = withoutLauncherMetadata(current);
    const restored = migrateProgress({
      ...legacy,
      familiarTrafficSide: "left",
    });

    expect(restored.familiarSideConfirmed).toBe(true);
    expect(restored.lastCountryId).toBe("us");
    expect(restored.lastDestinationId).toBe("us-nyc");
  });

  it("restores legacy UK scores to Milton Keynes and otherwise defaults UK to London", () => {
    const current = createDefaultProgress("2026-07-10T12:00:00.000Z");
    const legacy = withoutLauncherMetadata(current);

    const miltonKeynes = migrateProgress({
      ...legacy,
      lastCountryId: "uk",
      completedLessonIds: ["uk-left-side-basics"],
      lessonScores: {
        "uk-left-side-basics": scoreFor("uk-left-side-basics"),
      },
    });
    expect(miltonKeynes.lastDestinationId).toBe("uk-milton-keynes");

    const london = migrateProgress({
      ...legacy,
      lastCountryId: "uk",
      lessonScores: {},
    });
    expect(london.lastDestinationId).toBe("uk-london");
  });

  it("unlocks the first country lesson after orientation", () => {
    const initial = createDefaultProgress("2026-07-10T12:00:00.000Z");
    expect(isLessonUnlocked(initial, "us-one-way-grid")).toBe(false);
    const updated = updateLessonProgress(initial, {
      score: {
        lessonId: "orientation-right",
        total: 92,
        safety: 94,
        ruleUse: 90,
        vehicleControl: 91,
        criticalErrors: 0,
        mastered: true,
        completedAt: "2026-07-10T12:05:00.000Z",
        durationMs: 300_000,
      },
      cameraUsed: "first_person",
    });
    expect(isLessonUnlocked(updated, "us-one-way-grid")).toBe(true);
    expect(updated.badges).toContain("right_side_ready");
    expect(updated.badges).toContain("first_person_mastery");
  });

  it("saves, reloads, and unlocks free drive after lesson one", () => {
    const storage = memoryStorage();
    let progress = createDefaultProgress();
    for (const lessonId of ["orientation-right", "us-one-way-grid"] as const) {
      progress = updateLessonProgress(progress, {
        score: {
          lessonId,
          total: 86,
          safety: 86,
          ruleUse: 86,
          vehicleControl: 86,
          criticalErrors: 0,
          mastered: true,
          completedAt: new Date().toISOString(),
          durationMs: 240_000,
        },
        cameraUsed: "third_person",
      });
    }
    expect(saveProgress(progress, storage)).toBe(true);
    const restored = loadProgress(storage);
    expect(restored.completedLessonIds).toContain("us-one-way-grid");
    expect(isFreeDriveUnlocked(restored, "free-us")).toBe(true);
  });

  it("unlocks each curriculum sequentially without requiring mastery", () => {
    let progress = createDefaultProgress("2026-07-10T12:00:00.000Z");
    const tracks = [
      ["orientation-right", "us-one-way-grid", "us-signals-crosswalks", "us-lane-choice"],
      ["orientation-left", "uk-left-side-basics", "uk-roundabouts", "uk-dual-carriageway"],
      ["orientation-right", "fr-right-side-basics", "fr-priority-roundabouts", "fr-speed-merging"],
      ["orientation-left", "jp-left-side-basics", "jp-vulnerable-road-users", "jp-railway-crossings"],
    ] as const;

    for (const track of tracks) {
      for (let index = 0; index < track.length; index += 1) {
        const lessonId = track[index];
        expect(isLessonUnlocked(progress, lessonId)).toBe(true);
        progress = updateLessonProgress(progress, {
          score: scoreFor(lessonId),
          cameraUsed: "third_person",
        });
        if (index + 1 < track.length) {
          expect(isLessonUnlocked(progress, track[index + 1])).toBe(true);
        }
      }
    }

    expect(progress.lessonScores["us-one-way-grid"]?.mastered).toBe(false);
    expect(isFreeDriveUnlocked(progress, "free-us")).toBe(true);
    expect(isFreeDriveUnlocked(progress, "free-uk")).toBe(true);
    expect(isFreeDriveUnlocked(progress, "free-fr")).toBe(true);
    expect(isFreeDriveUnlocked(progress, "free-jp")).toBe(true);
    expect(isLessonUnlocked(progress, "uk-fr-side-swap")).toBe(true);
  });

  it("recomputes mastery from validated score fields", () => {
    const storage = memoryStorage(
      JSON.stringify({
        ...createDefaultProgress("2026-07-10T12:00:00.000Z"),
        completedLessonIds: ["orientation-right"],
        lessonScores: {
          "orientation-right": {
            ...scoreFor("orientation-right", 95),
            criticalErrors: 1,
            mastered: true,
          },
        },
      }),
    );
    const restored = loadProgress(storage);
    expect(restored.lessonScores["orientation-right"]?.mastered).toBe(false);
  });

  it("recommends orientation, the next lesson, then destination free drive", () => {
    const withCompleted = (ids: readonly LessonId[]): PlayerProgressV1 => ({
      ...createDefaultProgress(),
      completedLessonIds: ids,
    });

    expect(getRecommendedDrive(withCompleted([]), "uk-london")).toMatchObject({
      countryId: "uk",
      destinationId: "uk-london",
      scenarioId: "orientation-left",
      kind: "orientation",
    });
    expect(
      getRecommendedDrive(withCompleted(["orientation-right"]), "us-nyc"),
    ).toMatchObject({
      countryId: "us",
      scenarioId: "us-one-way-grid",
      kind: "lesson",
    });
    expect(
      getRecommendedDrive(
        withCompleted(["orientation-right", "us-one-way-grid"]),
        "us-nyc",
      ),
    ).toMatchObject({
      scenarioId: "us-signals-crosswalks",
      kind: "lesson",
    });
    expect(
      getRecommendedDrive(
        withCompleted([
          "orientation-right",
          "us-one-way-grid",
          "us-signals-crosswalks",
          "us-lane-choice",
        ]),
        "us-nyc",
      ),
    ).toMatchObject({
      countryId: "us",
      destinationId: "us-nyc",
      scenarioId: "free-us",
      kind: "free_drive",
    });
  });

  it("recommends the capstone after US, France, Japan and either UK path", () => {
    const progress: PlayerProgressV1 = {
      ...createDefaultProgress(),
      completedLessonIds: [
        "orientation-left",
        "orientation-right",
        "us-one-way-grid",
        "us-signals-crosswalks",
        "us-lane-choice",
        "uk-left-side-basics",
        "uk-roundabouts",
        "uk-dual-carriageway",
        "fr-right-side-basics",
        "fr-priority-roundabouts",
        "fr-speed-merging",
        "jp-left-side-basics",
        "jp-vulnerable-road-users",
        "jp-railway-crossings",
      ],
    };

    expect(isCapstoneEligible(progress)).toBe(true);
    expect(getRecommendedDrive(progress, "jp-tokyo")).toMatchObject({
      countryId: "uk",
      destinationId: "uk-london",
      scenarioId: "uk-fr-side-swap",
      kind: "capstone",
    });

    expect(
      getRecommendedDrive(
        {
          ...progress,
          completedLessonIds: [
            ...progress.completedLessonIds,
            "uk-fr-side-swap",
          ],
        },
        "jp-tokyo",
      ),
    ).toMatchObject({
      countryId: "jp",
      destinationId: "jp-tokyo",
      scenarioId: "free-jp",
      kind: "free_drive",
    });

    const londonPath = {
      ...progress,
      completedLessonIds: progress.completedLessonIds.filter(
        (id) => id !== "uk-dual-carriageway",
      ).concat("uk-london-exhibition-road"),
    };
    expect(isCapstoneEligible(londonPath)).toBe(true);

    const missingRequiredCountry = {
      ...progress,
      completedLessonIds: progress.completedLessonIds.filter(
        (id) => id !== "jp-railway-crossings",
      ),
    };
    expect(isCapstoneEligible(missingRequiredCountry)).toBe(false);
    expect(
      isLessonUnlocked(
        {
          ...createDefaultProgress(),
          completedLessonIds: ["uk-fr-side-swap"],
        },
        "uk-fr-side-swap",
      ),
    ).toBe(true);
  });
});
