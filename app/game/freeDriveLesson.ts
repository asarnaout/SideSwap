import type { GameCanvasLesson } from "./GameCanvas";
import type { FreeDriveDefinition, TrafficSide } from "./types";

/**
 * The single runtime scenario contract for an open-world drive. SideSwapApp and
 * every simulation-facing test previously hand-rolled this literal; any field
 * added to GameCanvasLesson had five copies to chase. The authored spawn drops
 * the car in a legal lane on the city map, with no route guidance, ordered
 * checkpoints or forced finish.
 */
export function buildFreeDriveLesson(
  freeDrive: FreeDriveDefinition,
  trafficSide: TrafficSide,
): GameCanvasLesson {
  return {
    id: freeDrive.id,
    title: freeDrive.title,
    kind: "free_drive",
    trafficSide,
    startSpawnId: freeDrive.startSpawnId,
    route: [],
    objectives: [
      {
        id: `${freeDrive.id}-explore`,
        label: "Explore the city",
      },
    ],
    trafficSeed: freeDrive.trafficSeed,
    trafficDensity: "moderate",
    vulnerableRoadUsers: { pedestrians: 8, cyclists: 4 },
    checkpoints: [],
    coachPrompts: [],
    assessedRules: [],
    scenarioClock: freeDrive.scenarioClock,
  };
}

/**
 * A career day is the same open-world scenario with a per-day identity and a
 * per-day traffic seed: the id carries the day so the React remount key (and
 * the session-rebuild dep on lesson.id) rolls the world over between days,
 * and the seed comes from careerDayTrafficSeed so a retried day replays
 * identically.
 */
export function buildCareerDayLesson(
  freeDrive: FreeDriveDefinition,
  trafficSide: TrafficSide,
  day: number,
  trafficSeed: number,
): GameCanvasLesson {
  const base = buildFreeDriveLesson(freeDrive, trafficSide);
  const id = `career-${freeDrive.id}-d${day}`;
  return {
    ...base,
    id,
    trafficSeed,
    objectives: [{ id: `${id}-earn`, label: "Serve gigs before the day ends" }],
  };
}
