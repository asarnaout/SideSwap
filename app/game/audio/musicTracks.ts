/**
 * The soundtrack, and which city each piece belongs to.
 *
 * The tracks were written per-destination, so a drive through South Kensington
 * gets the South Kensington music rather than something about Tokyo. Milton
 * Keynes has no piece of its own and draws from the whole set instead — better
 * than silence, and nothing in the writing ties the others so tightly to their
 * city that they jar somewhere else.
 *
 * Pure: no DOM, no audio element, so the selection logic is unit-testable.
 */
import type { DestinationId } from "../types";

export interface MusicTrack {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  /** Null when the piece is not tied to a particular city. */
  readonly destinationId: DestinationId | null;
}

const BASE = "/audio/music";

export const MUSIC_TRACKS: readonly MusicTrack[] = [
  { id: "nyc-upper-west-glide", title: "Upper West Glide", url: `${BASE}/nyc-upper-west-glide.mp3`, destinationId: "us-nyc" },
  { id: "nyc-west-end-glide", title: "West End Glide", url: `${BASE}/nyc-west-end-glide.mp3`, destinationId: "us-nyc" },
  { id: "london-exhibition-road-glide-1", title: "Exhibition Road Glide", url: `${BASE}/london-exhibition-road-glide-1.mp3`, destinationId: "uk-london" },
  { id: "london-exhibition-road-glide-2", title: "Exhibition Road Glide (II)", url: `${BASE}/london-exhibition-road-glide-2.mp3`, destinationId: "uk-london" },
  { id: "calais-coast-run-1", title: "Calais Coast Run", url: `${BASE}/calais-coast-run-1.mp3`, destinationId: "fr-calais" },
  { id: "calais-coast-run-2", title: "Calais Coast Run (II)", url: `${BASE}/calais-coast-run-2.mp3`, destinationId: "fr-calais" },
  { id: "tokyo-setagaya-glide", title: "Setagaya Glide", url: `${BASE}/tokyo-setagaya-glide.mp3`, destinationId: "jp-tokyo" },
  { id: "tokyo-setagaya-morning", title: "Setagaya Morning", url: `${BASE}/tokyo-setagaya-morning.mp3`, destinationId: "jp-tokyo" },
];

/**
 * The pool a given city draws from: its own pieces, or everything when it has
 * none of its own.
 */
export function tracksForDestination(destinationId: DestinationId): readonly MusicTrack[] {
  const owned = MUSIC_TRACKS.filter((track) => track.destinationId === destinationId);
  return owned.length > 0 ? owned : MUSIC_TRACKS;
}

/**
 * A shuffled bag, so every track in the pool plays before any of them repeats —
 * markedly better than independent random draws over a long free-roam session,
 * which cluster.
 *
 * `avoidFirst` guards the seam between bags: without it the last track of one
 * bag can be the first of the next, which is the one repeat a listener notices.
 */
export function shuffleTrackBag(
  pool: readonly MusicTrack[],
  avoidFirst: string | null,
  random: () => number,
): MusicTrack[] {
  const bag = [...pool];
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  if (avoidFirst !== null && bag.length > 1 && bag[0].id === avoidFirst) {
    [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
  }
  return bag;
}
