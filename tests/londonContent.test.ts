import { describe, expect, it } from "vitest";
import {
  LONDON_CONTENT_REVIEWED_ON,
  LONDON_FREE_DRIVE,
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
    const roadSurfaces = new Map(
      LONDON_MAP_PACK.geometry.roadSurfaces.map((surface) => [surface.id, surface]),
    );
    const references = new Set(
      LONDON_RULE_REFERENCES.map((reference) => reference.id),
    );

    for (const lane of graph.lanes) {
      expect(lane.trafficSide, lane.id).toBe("left");
      expect(roadSurfaces.get(lane.roadId)?.laneIds).toContain(lane.id);
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
      expect(control.installations.length, control.id).toBeGreaterThan(0);
      for (const controlApproach of control.approaches) {
        expect(lanes.has(controlApproach.stopLine.laneId)).toBe(true);
      }
    }

    for (const checkpoint of graph.checkpoints) {
      expect(
        lanes.has(checkpoint.anchor.laneId),
        `${checkpoint.id} → ${checkpoint.anchor.laneId}`,
      ).toBe(true);
    }

    for (const spawn of graph.spawnPoints) {
      if (spawn.kind === "player" || spawn.kind === "vehicle") {
        expect(lanes.has(spawn.anchor.laneId), `${spawn.id} → ${spawn.anchor.laneId}`).toBe(
          true,
        );
      } else if ("pose" in spawn && spawn.laneId) {
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

  it("uses the requested safe London start anchors", () => {
    const quietStart = LONDON_MAP_PACK.laneGraph.spawnPoints.find(
      (spawn) => spawn.id === "london-player",
    );
    const queenGateStart = LONDON_MAP_PACK.laneGraph.spawnPoints.find(
      (spawn) => spawn.id === "london-player-queen-gate",
    );
    expect(quietStart?.kind).toBe("player");
    expect(queenGateStart?.kind).toBe("player");
    if (quietStart?.kind === "player") {
      expect(quietStart.anchor).toEqual({
        laneId: "london-local-west",
        distanceAlongM: 22,
      });
    }
    if (queenGateStart?.kind === "player") {
      expect(queenGateStart.anchor).toEqual({
        laneId: "london-queen-gate-north-1",
        distanceAlongM: 13.27,
      });
    }
  });

  it("orders the Cromwell box decision before the signal approach", () => {
    const checkpoints = new Map(
      LONDON_MAP_PACK.laneGraph.checkpoints.map((checkpoint) => [
        checkpoint.id,
        checkpoint,
      ]),
    );
    expect(checkpoints.get("london-box-junction")?.anchor).toEqual({
      laneId: "london-cromwell-east-1",
      distanceAlongM: 125,
    });
    expect(checkpoints.get("london-cromwell-signal")?.anchor).toEqual({
      laneId: "london-cromwell-east-1",
      distanceAlongM: 136,
    });
  });

  it("assesses the Exhibition Road approach to the Thurloe crossing", () => {
    const crosswalk = LONDON_MAP_PACK.laneGraph.controls.find(
      (control) => control.id === "london-crosswalk-thurloe",
    );
    expect(crosswalk?.laneIds).toContain("london-exhibition-shared-2");
    expect(
      crosswalk?.approaches.find(
        (item) => item.id === "london-exhibition-crosswalk-approach",
      )?.stopLine,
    ).toEqual({
      laneId: "london-exhibition-shared-2",
      distanceAlongM: 50,
    });
  });
});
