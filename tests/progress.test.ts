import { describe, expect, it } from "vitest";
import {
  consumeFuel,
  createDefaultProgress,
  credit,
  debit,
  isPlayerProgressV2,
  loadProgress,
  saveProgress,
  setFuel,
} from "../app/game/progress";
import {
  STARTING_WALLET_BY_COUNTRY,
  TANK_CAPACITY_L,
} from "../app/game/content";
import type { PlayerProgressV2 } from "../app/game/types";
import type { ProgressStorage } from "../app/game/progress";

function memoryStorage(seed?: Record<string, string>): ProgressStorage {
  const values = new Map<string, string>(seed ? Object.entries(seed) : []);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const fullTank = {
  us: TANK_CAPACITY_L,
  uk: TANK_CAPACITY_L,
  fr: TANK_CAPACITY_L,
  jp: TANK_CAPACITY_L,
};

// Lessons were removed; progress now holds only the player's preferences plus a
// per-country wallet + fuel economy. These tests pin the V2 shape, the tolerant
// migration (incl. from the lesson-era v1 save), and the immutable reducers.
describe("player progress (V2 economy)", () => {
  it("seeds a fresh player with a per-country wallet and a full tank", () => {
    const progress = createDefaultProgress();
    expect(progress.version).toBe(2);
    expect(progress.walletByCountry).toEqual(STARTING_WALLET_BY_COUNTRY);
    expect(progress.fuelByCountry).toEqual(fullTank);
    expect(progress.lifetimeEarnings).toEqual({ us: 0, uk: 0, fr: 0, jp: 0 });
    expect(progress.completedGigCount).toBe(0);
    expect(progress.lastCountryId).toBe("uk");
    expect(progress.lastDestinationId).toBe("uk-london");
    expect(isPlayerProgressV2(progress)).toBe(true);
  });

  it("recovers from a corrupt save to a seeded default", () => {
    const progress = loadProgress(memoryStorage({ "sideswap:v2": "{bad json" }));
    expect(progress.version).toBe(2);
    expect(progress.walletByCountry).toEqual(STARTING_WALLET_BY_COUNTRY);
  });

  it("migrates a lesson-era v1 save: keeps preferences, drops lessons, seeds economy", () => {
    const v1 = {
      version: 1,
      completedLessonIds: ["orientation-right", "us-one-way-grid"],
      lessonScores: { "us-one-way-grid": { total: 88 } },
      badges: ["signal_scholar"],
      passportStamps: ["us"],
      familiarTrafficSide: "right",
      familiarSideConfirmed: true,
      lastCountryId: "jp",
      lastDestinationId: "jp-tokyo",
      preferredCamera: "first_person",
      accessibility: { reducedMotion: true },
      updatedAt: "2026-07-10T12:00:00.000Z",
    };
    const storage = memoryStorage({ "sideswap:v1": JSON.stringify(v1) });
    const restored = loadProgress(storage);

    // Preferences carried across.
    expect(restored.version).toBe(2);
    expect(restored.lastCountryId).toBe("jp");
    expect(restored.lastDestinationId).toBe("jp-tokyo");
    expect(restored.preferredCamera).toBe("first_person");
    expect(restored.accessibility.reducedMotion).toBe(true);
    // Economy seeded; lesson data gone.
    expect(restored.walletByCountry).toEqual(STARTING_WALLET_BY_COUNTRY);
    expect(restored.fuelByCountry).toEqual(fullTank);
    expect(restored).not.toHaveProperty("completedLessonIds");
    expect(restored).not.toHaveProperty("badges");
    // Rewritten under the v2 key; the v1 key is cleared.
    expect(storage.getItem("sideswap:v1")).toBeNull();
    expect(JSON.parse(storage.getItem("sideswap:v2") ?? "{}").version).toBe(2);
  });

  it("preserves an existing v2 wallet, fuel and earnings on reload", () => {
    const saved: PlayerProgressV2 = {
      ...createDefaultProgress("2026-07-10T12:00:00.000Z"),
      walletByCountry: { us: 100, uk: 55, fr: 12, jp: 5000 },
      fuelByCountry: { us: 10, uk: 20, fr: 30, jp: 40 },
      lifetimeEarnings: { us: 250, uk: 0, fr: 0, jp: 8000 },
      completedGigCount: 7,
    };
    const storage = memoryStorage({ "sideswap:v2": JSON.stringify(saved) });
    const restored = loadProgress(storage);
    expect(restored.walletByCountry).toEqual({ us: 100, uk: 55, fr: 12, jp: 5000 });
    expect(restored.fuelByCountry).toEqual({ us: 10, uk: 20, fr: 30, jp: 40 });
    expect(restored.completedGigCount).toBe(7);
  });

  it("rejects an incoherent country/destination pair", () => {
    const progress = createDefaultProgress();
    expect(isPlayerProgressV2(progress)).toBe(true);
    expect(
      isPlayerProgressV2({
        ...progress,
        lastCountryId: "us",
        lastDestinationId: "uk-london",
      }),
    ).toBe(false);
  });

  it("credits earnings and debits spend, clamping the wallet at zero", () => {
    let progress = createDefaultProgress();
    const start = progress.walletByCountry.uk;
    progress = credit(progress, "uk", 40);
    expect(progress.walletByCountry.uk).toBe(start + 40);
    expect(progress.lifetimeEarnings.uk).toBe(40);
    progress = credit(progress, "uk", -10); // negative income is ignored
    expect(progress.walletByCountry.uk).toBe(start + 40);
    progress = debit(progress, "uk", start + 1000); // never below zero
    expect(progress.walletByCountry.uk).toBe(0);
    // Other countries are untouched.
    expect(progress.walletByCountry.us).toBe(STARTING_WALLET_BY_COUNTRY.us);
  });

  it("consumes and refuels within the tank bounds", () => {
    let progress = createDefaultProgress();
    progress = consumeFuel(progress, "fr", 1000); // clamps at empty
    expect(progress.fuelByCountry.fr).toBe(0);
    progress = setFuel(progress, "fr", 1000); // clamps at full
    expect(progress.fuelByCountry.fr).toBe(TANK_CAPACITY_L);
    progress = setFuel(progress, "fr", -5);
    expect(progress.fuelByCountry.fr).toBe(0);
  });

  it("round-trips a saved progress record", () => {
    const storage = memoryStorage();
    const progress = {
      ...createDefaultProgress("2026-07-10T12:00:00.000Z"),
      completedGigCount: 3,
    };
    expect(saveProgress(progress, storage)).toBe(true);
    const restored = loadProgress(storage);
    expect(restored.completedGigCount).toBe(3);
    expect(restored.walletByCountry).toEqual(STARTING_WALLET_BY_COUNTRY);
  });
});
