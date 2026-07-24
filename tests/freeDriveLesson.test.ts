import { describe, expect, it } from "vitest";
import { careerDayTrafficSeed } from "../app/game/career";
import { FREE_DRIVES, getCountryProfile } from "../app/game/content";
import {
  buildCareerDayLesson,
  buildFreeDriveLesson,
} from "../app/game/freeDriveLesson";
import type { GameCanvasLesson } from "../app/game/GameCanvas";

// The factory replaced five hand-rolled copies of this literal (SideSwapApp +
// four simulation-facing tests). This pin is the contract: any field change to
// the free-drive scenario shape must be a deliberate edit here, not drift.
describe("buildFreeDriveLesson", () => {
  it("produces the exact self-contained free-drive contract for every city", () => {
    expect(FREE_DRIVES.length).toBeGreaterThan(0);
    for (const freeDrive of FREE_DRIVES) {
      const country = getCountryProfile(freeDrive.countryId);
      const lesson = buildFreeDriveLesson(freeDrive, country.trafficSide);
      const expected: GameCanvasLesson = {
        id: freeDrive.id,
        title: freeDrive.title,
        kind: "free_drive",
        trafficSide: country.trafficSide,
        startSpawnId: freeDrive.startSpawnId,
        route: [],
        objectives: [
          { id: `${freeDrive.id}-explore`, label: "Explore the city" },
        ],
        trafficSeed: freeDrive.trafficSeed,
        trafficDensity: "moderate",
        vulnerableRoadUsers: { pedestrians: 8, cyclists: 4 },
        checkpoints: [],
        coachPrompts: [],
        assessedRules: [],
        scenarioClock: freeDrive.scenarioClock,
      };
      expect(lesson, freeDrive.id).toEqual(expected);
    }
  });

  it("honours the caller's traffic side rather than deriving its own", () => {
    const drive = FREE_DRIVES[0];
    expect(buildFreeDriveLesson(drive, "left").trafficSide).toBe("left");
    expect(buildFreeDriveLesson(drive, "right").trafficSide).toBe("right");
  });
});

describe("buildCareerDayLesson", () => {
  it("gives each day its own scenario identity and seed, deterministically", () => {
    const drive = FREE_DRIVES[0];
    const side = getCountryProfile(drive.countryId).trafficSide;
    const seedDay3 = careerDayTrafficSeed(424242, 3);
    const day3 = buildCareerDayLesson(drive, side, 3, seedDay3);
    expect(day3.id).toBe(`career-${drive.id}-d3`);
    expect(day3.trafficSeed).toBe(seedDay3);
    expect(day3.kind).toBe("free_drive");
    // Identical inputs replay identically (the mid-day-quit contract)...
    expect(buildCareerDayLesson(drive, side, 3, seedDay3)).toEqual(day3);
    // ...and another day is a different world.
    const day4 = buildCareerDayLesson(
      drive,
      side,
      4,
      careerDayTrafficSeed(424242, 4),
    );
    expect(day4.id).not.toBe(day3.id);
    expect(day4.trafficSeed).not.toBe(day3.trafficSeed);
    // Everything not day-specific matches the free-drive contract.
    const base = buildFreeDriveLesson(drive, side);
    expect(day3.startSpawnId).toBe(base.startSpawnId);
    expect(day3.trafficDensity).toBe(base.trafficDensity);
    expect(day3.vulnerableRoadUsers).toEqual(base.vulnerableRoadUsers);
    expect(day3.route).toEqual([]);
    expect(day3.checkpoints).toEqual([]);
  });
});
