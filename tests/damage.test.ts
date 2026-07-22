import { describe, expect, it } from "vitest";
import {
  FULL_CONDITION_PCT,
  SMOKE_HEAVY_CONDITION_PCT,
  SMOKE_LIGHT_CONDITION_PCT,
  damageForCollision,
} from "../app/game/damage";
import { FINE_BY_COUNTRY, REPAIR_FEE_BY_COUNTRY } from "../app/game/content";

describe("damageForCollision", () => {
  it("charges pedestrians and cyclists a small flat rate — the citation is the cost", () => {
    expect(
      damageForCollision({ roadUserType: "pedestrian", impactSpeedMps: 14 }),
    ).toBe(6);
    expect(
      damageForCollision({ roadUserType: "cyclist", impactSpeedMps: 3 }),
    ).toBe(6);
  });

  it("charges props by heft, not speed", () => {
    expect(
      damageForCollision({ obstacle: "prop", propKind: "hydrant", impactSpeedMps: 20 }),
    ).toBe(2);
    expect(
      damageForCollision({ obstacle: "prop", propKind: "streetlight", impactSpeedMps: 3 }),
    ).toBe(6);
    expect(
      damageForCollision({ obstacle: "prop", propKind: "tree", impactSpeedMps: 9 }),
    ).toBe(6);
  });

  it("scales wall damage with impact speed, with a free low-speed scrape", () => {
    expect(damageForCollision({ obstacle: "building", impactSpeedMps: 2 })).toBe(0);
    const moderate = damageForCollision({ obstacle: "building", impactSpeedMps: 8 });
    const hard = damageForCollision({ obstacle: "building", impactSpeedMps: 15 });
    expect(moderate).toBeGreaterThan(10);
    expect(hard).toBeGreaterThan(moderate);
    expect(hard).toBeLessThanOrEqual(40);
    expect(
      damageForCollision({ obstacle: "worldEdge", impactSpeedMps: 60 }),
    ).toBe(40);
  });

  it("scales vehicle damage with impact speed inside its clamps", () => {
    expect(damageForCollision({ vehicleId: "npc-3", impactSpeedMps: 0 })).toBe(2);
    const crash = damageForCollision({ vehicleId: "npc-3", impactSpeedMps: 12 });
    expect(crash).toBeGreaterThan(30);
    expect(
      damageForCollision({ vehicleId: "npc-3", impactSpeedMps: 100 }),
    ).toBe(45);
  });

  it("ignores evidence it does not recognise", () => {
    expect(damageForCollision({})).toBe(0);
    expect(damageForCollision({ somethingElse: true })).toBe(0);
  });

  it("keeps a full car several honest crashes away from a write-off", () => {
    const headOn = damageForCollision({ obstacle: "building", impactSpeedMps: 12 });
    expect(FULL_CONDITION_PCT / headOn).toBeGreaterThan(2);
    expect(SMOKE_HEAVY_CONDITION_PCT).toBeLessThan(SMOKE_LIGHT_CONDITION_PCT);
  });
});

describe("REPAIR_FEE_BY_COUNTRY", () => {
  it("prices a write-off noticeably above a fine in every country", () => {
    for (const country of ["us", "uk", "fr", "jp"] as const) {
      expect(REPAIR_FEE_BY_COUNTRY[country]).toBeGreaterThanOrEqual(
        FINE_BY_COUNTRY[country] * 2,
      );
      expect(REPAIR_FEE_BY_COUNTRY[country]).toBeLessThanOrEqual(
        FINE_BY_COUNTRY[country] * 5,
      );
    }
  });
});
