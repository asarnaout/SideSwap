import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const extracts = {
  "nyc-upper-west": [40.7758, -73.9848, 40.7818, -73.978],
  "uk-london-south-kensington": [51.4938, -0.1818, 51.5006, -0.1698],
  "uk-milton-keynes": [52.0268, -0.773, 52.034, -0.761],
  "fr-calais-coquelles": [50.929, 1.795, 50.938, 1.811],
  "jp-setagaya": [35.644, 139.64, 35.652, 139.653],
} as const;

describe("frozen OpenStreetMap extracts", () => {
  for (const [id, bbox] of Object.entries(extracts)) {
    it(`validates ${id} provenance and geometry checksum`, async () => {
      const raw = await readFile(
        resolve(process.cwd(), "public", "map-data", `${id}.json`),
        "utf8",
      );
      const data = JSON.parse(raw) as {
        schemaVersion: number;
        id: string;
        source: {
          provider: string;
          license: string;
          attributionUrl: string;
          sourceUrl: string;
          sourceSha256: string;
          contentSha256: string;
          importerVersion: string;
          bbox: number[];
          frozenAt: string;
        };
        roads: unknown[];
        buildings: unknown[];
      };

      expect(data.schemaVersion).toBe(1);
      expect(data.id).toBe(id);
      expect(data.source.provider).toBe("OpenStreetMap contributors");
      expect(data.source.license).toBe("ODbL-1.0");
      expect(data.source.attributionUrl).toBe(
        "https://www.openstreetmap.org/copyright",
      );
      expect(data.source.sourceUrl).toMatch(/^https:\/\/api\.openstreetmap\.org\//);
      expect(data.source.importerVersion).toBe("sideswap-osm-compact@2");
      expect(data.source.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(data.source.bbox).toEqual(bbox);
      expect(Number.isFinite(Date.parse(data.source.frozenAt))).toBe(true);
      expect(data.roads.length).toBeGreaterThan(0);
      expect(Array.isArray(data.buildings)).toBe(true);

      const digest = createHash("sha256")
        .update(
          JSON.stringify({ roads: data.roads, buildings: data.buildings }),
        )
        .digest("hex");
      expect(digest).toBe(data.source.contentSha256);
    });
  }
});
