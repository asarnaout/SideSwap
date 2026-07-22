export type AuthoredSignalStyle = "nyc_signal" | "uk_signal";

export type AuthoredSignalAspect =
  | "green"
  | "amber"
  | "all_red"
  | "red"
  | "red_amber";

export interface AuthoredSignalTimingInput {
  readonly elapsedSeconds: number;
  readonly controlId: string;
  readonly phaseGroup: string;
  readonly phaseGroups: readonly string[];
  readonly style: AuthoredSignalStyle;
}

const NYC_GREEN_SECONDS = 7;
const NYC_AMBER_SECONDS = 2;
const NYC_ALL_RED_SECONDS = 1;

const UK_RED_AMBER_SECONDS = 1.5;
const UK_GREEN_SECONDS = 7;
const UK_AMBER_SECONDS = 3;
const UK_ALL_RED_SECONDS = 1;

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function uniquePhaseGroups(groups: readonly string[]): string[] {
  return [...new Set(groups.filter(Boolean))];
}

/**
 * Gives separate junctions a deterministic offset without coupling their
 * phases to render order or random state.
 */
export function authoredSignalOffsetSeconds(controlId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < controlId.length; index += 1) {
    hash ^= controlId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 7;
}

/**
 * Resolves one signal head's aspect. Each control advances one phase group at
 * a time, so conflicting approaches can never display green together. A
 * single authored group still receives a realistic red interval by reserving
 * an unassigned opposing slot.
 */
export function authoredSignalAspectAt({
  elapsedSeconds,
  controlId,
  phaseGroup,
  phaseGroups,
  style,
}: AuthoredSignalTimingInput): AuthoredSignalAspect {
  const groups = uniquePhaseGroups(phaseGroups);
  const groupIndex = groups.indexOf(phaseGroup);
  if (groupIndex < 0) return "red";

  const isUk = style === "uk_signal";
  const redAmberSeconds = isUk ? UK_RED_AMBER_SECONDS : 0;
  const greenSeconds = isUk ? UK_GREEN_SECONDS : NYC_GREEN_SECONDS;
  const amberSeconds = isUk ? UK_AMBER_SECONDS : NYC_AMBER_SECONDS;
  const allRedSeconds = isUk ? UK_ALL_RED_SECONDS : NYC_ALL_RED_SECONDS;
  const slotSeconds = redAmberSeconds + greenSeconds + amberSeconds + allRedSeconds;
  const slotCount = Math.max(2, groups.length);
  const cycleSeconds = slotSeconds * slotCount;
  const cyclePosition = positiveModulo(
    elapsedSeconds + authoredSignalOffsetSeconds(controlId),
    cycleSeconds,
  );
  const activeSlot = Math.floor(cyclePosition / slotSeconds);
  const slotPosition = cyclePosition - activeSlot * slotSeconds;

  const clearanceStartsAt = redAmberSeconds + greenSeconds + amberSeconds;
  if (slotPosition >= clearanceStartsAt) return "all_red";
  if (activeSlot !== groupIndex) return "red";

  if (slotPosition < redAmberSeconds) return "red_amber";
  if (slotPosition < redAmberSeconds + greenSeconds) return "green";
  return "amber";
}
