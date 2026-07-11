import { describe, expect, it } from "vitest";
import {
  LONDON_CONTENT_REVIEWED_ON,
  LONDON_FREE_DRIVE,
  LONDON_LESSONS,
  LONDON_MAP_PACK,
  LONDON_RULE_REFERENCES,
  LONDON_SCENARIO_CLOCK,
} from "../app/game/londonContent";

const officialHosts = new Set([
  "www.gov.uk",
  "www.rbkc.gov.uk",
  "tfl.gov.uk",
  "foi.tfl.gov.uk",
]);

describe("London flagship content", () => {
  it("uses reviewed official sources for rules and OSM only for geography", () => {
    expect(LONDON_CONTENT_REVIEWED_ON).toBe("2026-07-11");
    expect(LONDON_RULE_REFERENCES).toHaveLength(6);

    for (const reference of LONDON_RULE_REFERENCES) {
      expect(reference.reviewedOn).toBe(LONDON_CONTENT_REVIEWED_ON);
      expect(officialHosts.has(new URL(reference.url).hostname)).toBe(true);
    }

    expect(new URL(LONDON_MAP_PACK.source.sourceUrl).hostname).toBe(
      "api.openstreetmap.org",
    );
    expect(LONDON_MAP_PACK.source.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(LONDON_MAP_PACK.source.boundingBox).toEqual({
      south: 51.4938,
      west: -0.1818,
      north: 51.5006,
      east: -0.1698,
    });
  });

  it("keeps every lane, control, restriction and checkpoint reference valid", () => {
    const graph = LONDON_MAP_PACK.laneGraph;
    const lanes = new Map(graph.lanes.map((lane) => [lane.id, lane]));
    const conflicts = new Set(graph.conflictZones.map((zone) => zone.id));
    const references = new Set(
      LONDON_RULE_REFERENCES.map((reference) => reference.id),
    );

    for (const lane of graph.lanes) {
      expect(lane.trafficSide, lane.id).toBe("left");
      for (const successorId of lane.successors) {
        const successor = lanes.get(successorId);
        expect(successor, `${lane.id} → ${successorId}`).toBeDefined();
        const end = lane.centerline.at(-1)!;
        const start = successor!.centerline[0];
        expect(
          Math.hypot(end.x - start.x, end.z - start.z),
          `${lane.id} ⇥ ${successorId}`,
        ).toBeLessThan(0.01);
      }
      for (const adjacentId of lane.adjacentLaneIds ?? []) {
        expect(lanes.has(adjacentId), `${lane.id} ↔ ${adjacentId}`).toBe(true);
      }
    }

    for (const control of graph.controls) {
      for (const laneId of control.laneIds) {
        expect(lanes.has(laneId), `${control.id} → ${laneId}`).toBe(true);
      }
      for (const conflictId of control.conflictZoneIds ?? []) {
        expect(conflicts.has(conflictId), `${control.id} → ${conflictId}`).toBe(
          true,
        );
      }
    }

    for (const checkpoint of graph.checkpoints) {
      expect(
        lanes.has(checkpoint.laneId),
        `${checkpoint.id} → ${checkpoint.laneId}`,
      ).toBe(true);
    }

    for (const spawn of graph.spawnPoints) {
      if (spawn.laneId) {
        expect(lanes.has(spawn.laneId), `${spawn.id} → ${spawn.laneId}`).toBe(
          true,
        );
      }
    }

    for (const restriction of graph.restrictions ?? []) {
      expect(lanes.has(restriction.laneId)).toBe(true);
      expect(references.has(restriction.sourceReferenceId)).toBe(true);
    }
  });

  it("keeps all three lesson routes connected to valid checkpoints and sources", () => {
    const lanes = new Map(
      LONDON_MAP_PACK.laneGraph.lanes.map((lane) => [lane.id, lane]),
    );
    const checkpoints = new Set(
      LONDON_MAP_PACK.laneGraph.checkpoints.map((checkpoint) => checkpoint.id),
    );
    const references = new Set(
      LONDON_RULE_REFERENCES.map((reference) => reference.id),
    );

    expect(LONDON_LESSONS.map((lesson) => lesson.id)).toEqual([
      "uk-london-left-side-basics",
      "uk-london-museum-traffic",
      "uk-london-exhibition-road",
    ]);

    for (const lesson of LONDON_LESSONS) {
      expect(lesson.destinationId).toBe("uk-london");
      expect(lesson.countryId).toBe("uk");
      expect(lesson.mapId).toBe(LONDON_MAP_PACK.id);
      expect(lesson.scenarioClock).toEqual(LONDON_SCENARIO_CLOCK);

      for (let index = 0; index < lesson.route.length; index += 1) {
        const lane = lanes.get(lesson.route[index]);
        expect(lane, `${lesson.id} → ${lesson.route[index]}`).toBeDefined();
        const successorId = lesson.route[index + 1];
        if (successorId) {
          expect(lane!.successors, `${lesson.id}: ${lane!.id}`).toContain(
            successorId,
          );
        }
      }

      for (const checkpointId of lesson.checkpoints) {
        expect(checkpoints.has(checkpointId), `${lesson.id} → ${checkpointId}`).toBe(
          true,
        );
      }
      for (const sourceId of lesson.sourceReferenceIds) {
        expect(references.has(sourceId), `${lesson.id} → ${sourceId}`).toBe(
          true,
        );
      }
    }
  });

  it("runs at a fixed active Tuesday morning restriction window", () => {
    expect(LONDON_SCENARIO_CLOCK).toEqual({
      weekday: "tue",
      minutesAfterMidnight: 510,
      label: "Tuesday · 08:30",
    });

    const restriction = LONDON_MAP_PACK.laneGraph.restrictions?.[0];
    expect(restriction).toBeDefined();
    const activeWindow = restriction!.activeWindows.find(
      (window) =>
        window.weekdays.includes(LONDON_SCENARIO_CLOCK.weekday) &&
        LONDON_SCENARIO_CLOCK.minutesAfterMidnight >= window.startMinutes &&
        LONDON_SCENARIO_CLOCK.minutesAfterMidnight < window.endMinutes,
    );
    expect(activeWindow).toBeDefined();
  });

  it("unlocks London free drive after the first lesson", () => {
    expect(LONDON_LESSONS[0].unlocks.freeDriveIds).toContain("free-uk-london");
    expect(LONDON_FREE_DRIVE).toMatchObject({
      id: "free-uk-london",
      countryId: "uk",
      destinationId: "uk-london",
      mapId: "london-south-kensington",
      unlockAfter: "uk-london-left-side-basics",
      scenarioClock: LONDON_SCENARIO_CLOCK,
    });
  });
});
