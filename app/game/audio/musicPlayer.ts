/**
 * Background music playback.
 *
 * Two decisions here are load-bearing and easy to get wrong:
 *
 * It streams through a plain `HTMLAudioElement` rather than a decoded Web Audio
 * buffer. A four-minute mp3 through `decodeAudioData` expands to roughly 60MB of
 * float PCM behind a blocking decode — and that decode would land exactly while
 * the Babylon scene, the model preload and the shadow generator are all starting
 * up. It is also deliberately *not* routed through the effects bus:
 * `createMediaElementSource` captures an element permanently and irreversibly,
 * so if the AudioContext ever failed the music would go silent with no way back.
 * Audio is a progressive enhancement everywhere else in this codebase; music
 * dying because the engine sound died would be a regression.
 *
 * And one element is reused across tracks. The `ended` handoff has no user
 * gesture behind it, but an element that has already played from a gesture keeps
 * its activation — a fresh element per track loses that, and every change after
 * the first is rejected by autoplay policy.
 */
import { useCallback, useEffect, useRef } from "react";
import type { DestinationId } from "../types";
import {
  MUSIC_TRACKS,
  shuffleTrackBag,
  tracksForDestination,
  type MusicTrack,
} from "./musicTracks";

const FADE_IN_MS = 1500;
const FADE_OUT_MS = 600;
const FADE_TICK_MS = 40;

const clamp01 = (value: number) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

export function useDriveMusic(volume: number) {
  const elementRef = useRef<HTMLAudioElement | null>(null);
  const bagRef = useRef<MusicTrack[]>([]);
  const poolRef = useRef<readonly MusicTrack[]>(MUSIC_TRACKS);
  const currentRef = useRef<string | null>(null);
  const volumeRef = useRef(volume);
  const fadeRef = useRef<number | null>(null);

  const clearFade = useCallback(() => {
    if (fadeRef.current !== null) {
      window.clearInterval(fadeRef.current);
      fadeRef.current = null;
    }
  }, []);

  const fadeTo = useCallback(
    (target: number, durationMs: number, done?: () => void) => {
      const element = elementRef.current;
      if (!element) return;
      clearFade();
      const from = element.volume;
      const steps = Math.max(1, Math.round(durationMs / FADE_TICK_MS));
      let step = 0;
      fadeRef.current = window.setInterval(() => {
        step += 1;
        const progress = Math.min(1, step / steps);
        element.volume = clamp01(from + (target - from) * progress);
        if (progress >= 1) {
          clearFade();
          done?.();
        }
      }, FADE_TICK_MS);
    },
    [clearFade],
  );

  const playNext = useCallback(() => {
    const element = elementRef.current;
    if (!element) return;
    if (bagRef.current.length === 0) {
      bagRef.current = shuffleTrackBag(poolRef.current, currentRef.current, Math.random);
    }
    const next = bagRef.current.shift();
    if (!next) return;
    currentRef.current = next.id;
    element.src = next.url;
    element.volume = 0;
    // `play()` only became promise-returning in a later revision of the media
    // spec, and still returns undefined in some environments, so the result
    // cannot be assumed thenable.
    const played = element.play() as Promise<void> | undefined;
    if (played && typeof played.then === "function") {
      void played.then(() => fadeTo(volumeRef.current, FADE_IN_MS)).catch(() => {
        // Autoplay refused, or the drive ended before the track loaded.
      });
    } else {
      fadeTo(volumeRef.current, FADE_IN_MS);
    }
  }, [fadeTo]);

  /**
   * Must be called synchronously from the click that starts the drive — Safari
   * only accepts a `play()` that happens in the same task as the gesture, so
   * this cannot be deferred into an effect.
   */
  const start = useCallback(
    (destinationId: DestinationId) => {
      if (typeof window === "undefined") return;
      if (!elementRef.current) {
        const element = new Audio();
        element.preload = "none";
        element.addEventListener("ended", () => playNext());
        elementRef.current = element;
      }
      poolRef.current = tracksForDestination(destinationId);
      bagRef.current = [];
      currentRef.current = null;
      playNext();
    },
    [playNext],
  );

  const stop = useCallback(() => {
    const element = elementRef.current;
    if (!element || element.paused) return;
    fadeTo(0, FADE_OUT_MS, () => {
      element.pause();
    });
  }, [fadeTo]);

  useEffect(() => {
    volumeRef.current = volume;
    const element = elementRef.current;
    // Leave an in-flight fade alone; it reads the ref when it lands.
    if (element && fadeRef.current === null && !element.paused) {
      element.volume = clamp01(volume);
    }
  }, [volume]);

  useEffect(
    () => () => {
      clearFade();
      elementRef.current?.pause();
      elementRef.current = null;
    },
    [clearFade],
  );

  return { start, stop };
}
