import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MUSIC_TRACKS,
  shuffleTrackBag,
  tracksForDestination,
} from "../app/game/audio/musicTracks";
import type { DestinationId } from "../app/game/types";

const DESTINATIONS: DestinationId[] = [
  "us-nyc",
  "uk-london",
  "uk-milton-keynes",
  "fr-calais",
  "jp-tokyo",
];

/** Deterministic source so shuffle assertions do not flake. */
const seeded = (seed: number) => {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return value / 0x1_0000_0000;
  };
};

describe("music catalogue", () => {
  it("ships every track it lists", () => {
    // A typo in a URL is silent at runtime: the element just never plays.
    for (const track of MUSIC_TRACKS) {
      expect(existsSync(`public${track.url}`), track.url).toBe(true);
    }
  });

  it("has unique ids and urls", () => {
    expect(new Set(MUSIC_TRACKS.map((track) => track.id)).size).toBe(MUSIC_TRACKS.length);
    expect(new Set(MUSIC_TRACKS.map((track) => track.url)).size).toBe(MUSIC_TRACKS.length);
  });
});

describe("city matching", () => {
  it("plays a city its own music where it has some", () => {
    for (const destinationId of DESTINATIONS) {
      const pool = tracksForDestination(destinationId);
      expect(pool.length, destinationId).toBeGreaterThan(0);
      const owned = MUSIC_TRACKS.filter((track) => track.destinationId === destinationId);
      if (owned.length > 0) {
        expect(pool.map((track) => track.id).sort()).toEqual(owned.map((track) => track.id).sort());
      }
    }
  });

  it("falls back to the whole catalogue for Milton Keynes", () => {
    // The only city without a piece written for it — silence would be worse.
    expect(MUSIC_TRACKS.some((track) => track.destinationId === "uk-milton-keynes")).toBe(false);
    expect(tracksForDestination("uk-milton-keynes")).toHaveLength(MUSIC_TRACKS.length);
  });
});

describe("shuffle bag", () => {
  it("plays everything in the pool before repeating any of it", () => {
    for (const destinationId of DESTINATIONS) {
      const pool = tracksForDestination(destinationId);
      const bag = shuffleTrackBag(pool, null, seeded(11));
      expect(bag).toHaveLength(pool.length);
      expect(new Set(bag.map((track) => track.id)).size).toBe(pool.length);
    }
  });

  it("never starts a bag with the track that just finished", () => {
    // The seam is the one repeat a listener actually notices.
    const pool = tracksForDestination("us-nyc");
    for (let seed = 1; seed <= 400; seed += 1) {
      for (const previous of pool) {
        const bag = shuffleTrackBag(pool, previous.id, seeded(seed));
        expect(bag[0].id, `seed ${seed} after ${previous.id}`).not.toBe(previous.id);
      }
    }
  });

  it("still reaches every track from a two-track pool", () => {
    // With only two pieces the seam guard forces strict alternation; make sure
    // that does not pin one of them permanently out of reach.
    const pool = tracksForDestination("uk-london");
    expect(pool).toHaveLength(2);
    const seen = new Set<string>();
    let previous: string | null = null;
    const random = seeded(5);
    for (let i = 0; i < 20; i += 1) {
      const bag = shuffleTrackBag(pool, previous, random);
      for (const track of bag) {
        seen.add(track.id);
        previous = track.id;
      }
    }
    expect(seen.size).toBe(2);
  });

  it("does not favour any track over many draws", () => {
    const pool = tracksForDestination("uk-milton-keynes");
    const counts = new Map<string, number>();
    const random = seeded(99);
    const rounds = 4000;
    for (let i = 0; i < rounds; i += 1) {
      const first = shuffleTrackBag(pool, null, random)[0];
      counts.set(first.id, (counts.get(first.id) ?? 0) + 1);
    }
    const expected = rounds / pool.length;
    for (const track of pool) {
      const seen = counts.get(track.id) ?? 0;
      expect(Math.abs(seen - expected) / expected, track.id).toBeLessThan(0.2);
    }
  });
});
