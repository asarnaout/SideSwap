import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const extracts = [
  "nyc-upper-west",
  "uk-milton-keynes",
  "fr-calais-coquelles",
  "jp-setagaya",
] as const;

describe("frozen OpenStreetMap extracts", () => {
  for (const id of extracts) {
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
      expect(data.source.bbox).toHaveLength(4);
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
