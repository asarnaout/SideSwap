/**
 * The shared AudioContext.
 *
 * This is module-level rather than owned by the Babylon session on purpose.
 * GameCanvas remounts mid-session whenever the destination or steering side
 * changes, and a per-session context would be constructed and closed on each of
 * those — a click every time, and eventually fatal, since browsers cap how many
 * contexts a page may create. One context, suspended between drives, avoids
 * both and lets the drive-start click prime playback before the canvas mounts.
 */

type AudioContextConstructor = new () => AudioContext;

let shared: AudioContext | null = null;
let unlockInstalled = false;
let unavailable = false;

const resolveConstructor = (): AudioContextConstructor | null => {
  if (typeof window === "undefined") return null;
  const legacy = window as unknown as { webkitAudioContext?: AudioContextConstructor };
  return window.AudioContext ?? legacy.webkitAudioContext ?? null;
};

/**
 * Belt and braces: if the context is still suspended — the gesture was consumed
 * elsewhere, or `resume()` was rejected — the next real input unlocks it. Bound
 * in the capture phase so nothing can stop propagation before it runs, and it
 * removes itself as soon as the context is running.
 */
function installUnlockFallback(context: AudioContext): void {
  if (unlockInstalled || typeof window === "undefined") return;
  unlockInstalled = true;
  const events = ["pointerdown", "keydown", "touchend"] as const;
  const unlock = () => {
    if (context.state === "suspended") void context.resume();
    if (context.state !== "suspended") {
      for (const type of events) window.removeEventListener(type, unlock, true);
    }
  };
  for (const type of events) window.addEventListener(type, unlock, true);
}

/**
 * Creates (once) and resumes the shared context, returning null when Web Audio
 * is unavailable so callers can carry on silently.
 *
 * Must be called synchronously inside a user-gesture handler: Safari only
 * honours a resume that happens in the same task as the gesture that triggered
 * it, so deferring this into an effect leaves the context suspended.
 */
export function primeAudioContext(): AudioContext | null {
  if (unavailable) return null;
  try {
    if (!shared) {
      const Ctor = resolveConstructor();
      if (!Ctor) {
        unavailable = true;
        return null;
      }
      shared = new Ctor();
    }
    if (shared.state === "suspended") void shared.resume();
    installUnlockFallback(shared);
    return shared;
  } catch {
    // Audio stays a progressive enhancement: the game is fully playable silent.
    unavailable = true;
    return null;
  }
}

/** The context if one already exists. Does not create or resume. */
export function peekAudioContext(): AudioContext | null {
  return shared;
}

/**
 * Parks the context between drives. Deliberately not `close()` — a closed
 * context can never be reopened, and the player will start another drive.
 */
export function suspendAudioContext(): void {
  if (shared && shared.state === "running") void shared.suspend();
}
