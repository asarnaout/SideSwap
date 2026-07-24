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
