import { describe, expect, it } from "vitest";
import {
  ALL_BUILDING_SET_IDS,
  buildingSetModelIds,
  buildingSetUrls,
  isBuildingSetId,
  missingBuildingConfigs,
  slotBlockBuildings,
} from "../app/game/buildingSets";
import { NYC_ENV_MODELS } from "../app/game/buildingCatalog";

const CATALOG_IDS = new Set(NYC_ENV_MODELS.map((m) => m.id));

describe("building sets", () => {
  it("references only catalogue models that also have a placement config", () => {
    // A set model missing a url or scale/groundY would be silently dropped.
    expect(missingBuildingConfigs()).toEqual([]);
    for (const setId of ALL_BUILDING_SET_IDS) {
      for (const id of buildingSetModelIds(setId)) {
        expect(CATALOG_IDS.has(id), `${setId} → ${id}`).toBe(true);
      }
    }
  });

  it("resolves every set to real committed prop urls", () => {
    for (const setId of ALL_BUILDING_SET_IDS) {
      const urls = buildingSetUrls([setId]);
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) expect(url).toMatch(/^\/models\/props\/.+\.glb$/);
    }
    expect(isBuildingSetId("nyc-downtown")).toBe(true);
    expect(isBuildingSetId("not-a-set")).toBe(false);
  });

  it("lays a street wall inside the block bounds, facing outward, deterministically", () => {
    const center = { x: 100, z: -50 };
    const size = { x: 120, z: 200 };
    for (const setId of ALL_BUILDING_SET_IDS) {
      const a = slotBlockBuildings(center, size, setId, 12345);
      const b = slotBlockBuildings(center, size, setId, 12345);
      expect(a).toEqual(b); // deterministic in the seed
      expect(a.length).toBeGreaterThan(0);
      for (const p of a) {
        // within the block footprint (buildings inset from the perimeter)
        expect(Math.abs(p.x - center.x)).toBeLessThanOrEqual(size.x / 2 + 0.5);
        expect(Math.abs(p.z - center.z)).toBeLessThanOrEqual(size.z / 2 + 0.5);
        expect(Number.isFinite(p.yaw)).toBe(true);
        expect(p.scale).toBeGreaterThan(0);
        expect(p.url).toMatch(/\.glb$/);
      }
    }
    // A different seed yields a different arrangement.
    const seedA = slotBlockBuildings(center, size, "nyc-brownstone", 1);
    const seedB = slotBlockBuildings(center, size, "nyc-brownstone", 2);
    expect(seedA).not.toEqual(seedB);
  });

  it("thins the wall deterministically for weak devices (keepFraction)", () => {
    const center = { x: 0, z: 0 };
    const size = { x: 200, z: 200 };
    const full = slotBlockBuildings(center, size, "nyc-midrise", 7, 1);
    const half = slotBlockBuildings(center, size, "nyc-midrise", 7, 0.5);
    const halfAgain = slotBlockBuildings(center, size, "nyc-midrise", 7, 0.5);
    expect(half).toEqual(halfAgain); // deterministic
    expect(half.length).toBeLessThan(full.length);
    expect(half.length).toBeGreaterThan(full.length * 0.3);
    // survivors keep their full-wall positions (cursor advances regardless)
    const fullKeys = new Set(full.map((p) => `${p.x},${p.z}`));
    for (const p of half) expect(fullKeys.has(`${p.x},${p.z}`)).toBe(true);
  });
});
