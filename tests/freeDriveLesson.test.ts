import { describe, expect, it } from "vitest";
import { FREE_DRIVES, getCountryProfile } from "../app/game/content";
import { buildFreeDriveLesson } from "../app/game/freeDriveLesson";
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
