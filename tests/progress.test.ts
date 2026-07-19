import { describe, expect, it } from "vitest";
import {
  createDefaultProgress,
  isPlayerProgressV1,
  loadProgress,
  migrateProgress,
  saveProgress,
} from "../app/game/progress";
import type { PlayerProgressV1 } from "../app/game/types";
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

// Lessons were removed in the gig overhaul; progress now persists only the
// player's preferences (last city/camera/accessibility). These tests pin the
// tolerant migration + save/load path that survives.
describe("local progress", () => {
  const scoreFor = (lessonId: string, total = 65) => ({
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

  it("uses the opposite-side starter when a legacy save has no explicit country", () => {
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

  it("defaults UK saves to the featured London destination", () => {
    const current = createDefaultProgress("2026-07-10T12:00:00.000Z");
    const legacy = withoutLauncherMetadata(current);
    const restored = migrateProgress({
      ...legacy,
      lastCountryId: "uk",
    });
    expect(restored.lastCountryId).toBe("uk");
    expect(restored.lastDestinationId).toBe("uk-london");
  });

  it("preserves legacy lesson scores and recomputes their mastery", () => {
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
    // Mastery is recomputed from the validated fields, not trusted from the save.
    expect(restored.lessonScores["orientation-right"]?.mastered).toBe(false);
  });

  it("round-trips a saved progress record", () => {
    const storage = memoryStorage();
    const progress = {
      ...createDefaultProgress("2026-07-10T12:00:00.000Z"),
      lastCountryId: "jp" as const,
      lastDestinationId: "jp-tokyo" as const,
      preferredCamera: "first_person" as const,
    };
    expect(saveProgress(progress, storage)).toBe(true);
    const restored = loadProgress(storage);
    expect(restored.lastCountryId).toBe("jp");
    expect(restored.lastDestinationId).toBe("jp-tokyo");
    expect(restored.preferredCamera).toBe("first_person");
  });
});
