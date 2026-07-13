import { describe, expect, it } from "vitest";
import { MAP_PACKS } from "../app/game/content";
import {
  authoredSignalAspectAt,
  authoredSignalOffsetSeconds,
} from "../app/game/trafficSignals";

const aspectAt = (
  style: "nyc_signal" | "uk_signal",
  controlId: string,
  phaseGroup: string,
  phaseGroups: readonly string[],
  unshiftedSeconds: number,
) =>
  authoredSignalAspectAt({
    elapsedSeconds: unshiftedSeconds - authoredSignalOffsetSeconds(controlId),
    controlId,
    phaseGroup,
    phaseGroups,
    style,
  });

function distanceToSegment(
  point: { x: number; z: number },
  start: { x: number; z: number },
  end: { x: number; z: number },
): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 0.0001) return Math.hypot(point.x - start.x, point.z - start.z);
  const amount = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared,
    ),
  );
  return Math.hypot(
    point.x - (start.x + dx * amount),
    point.z - (start.z + dz * amount),
  );
}

function laneHeadingAt(
  lane: { readonly centerline: readonly { x: number; z: number }[] },
  distanceAlongM: number,
): number {
  let remaining = Math.max(0, distanceAlongM);
  for (let index = 0; index < lane.centerline.length - 1; index += 1) {
    const start = lane.centerline[index];
    const end = lane.centerline[index + 1];
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    if (remaining <= length || index === lane.centerline.length - 2) {
      return (Math.atan2(end.x - start.x, end.z - start.z) * 180) / Math.PI;
    }
    remaining -= length;
  }
  return 0;
}

function angularDifferenceDegrees(left: number, right: number): number {
  const wrapped = ((left - right + 540) % 360) - 180;
  return Math.abs(wrapped);
}

describe("authored traffic-signal phases", () => {
  it("keeps antagonistic NYC approaches from showing green together", () => {
    const groups = ["east-west", "north-south"];
    expect(aspectAt("nyc_signal", "nyc-test", groups[0], groups, 0.1)).toBe("green");
    expect(aspectAt("nyc_signal", "nyc-test", groups[1], groups, 0.1)).toBe("red");
    expect(aspectAt("nyc_signal", "nyc-test", groups[0], groups, 7.1)).toBe("amber");
    expect(aspectAt("nyc_signal", "nyc-test", groups[0], groups, 9.1)).toBe("all_red");
    expect(aspectAt("nyc_signal", "nyc-test", groups[0], groups, 10.1)).toBe("red");
    expect(aspectAt("nyc_signal", "nyc-test", groups[1], groups, 10.1)).toBe("green");

    for (let seconds = 0; seconds < 20; seconds += 0.1) {
      const aspects = groups.map((group) =>
        aspectAt("nyc_signal", "nyc-test", group, groups, seconds),
      );
      expect(aspects.filter((aspect) => aspect === "green")).toHaveLength(
        aspects.includes("green") ? 1 : 0,
      );
    }
  });

  it("uses UK red-amber, green, amber and all-red clearance", () => {
    const groups = ["queen-gate", "cromwell"];
    expect(aspectAt("uk_signal", "uk-test", groups[0], groups, 0.1)).toBe("red_amber");
    expect(aspectAt("uk_signal", "uk-test", groups[1], groups, 0.1)).toBe("red");
    expect(aspectAt("uk_signal", "uk-test", groups[0], groups, 1.6)).toBe("green");
    expect(aspectAt("uk_signal", "uk-test", groups[0], groups, 8.6)).toBe("amber");
    expect(aspectAt("uk_signal", "uk-test", groups[0], groups, 11.6)).toBe("all_red");
    expect(aspectAt("uk_signal", "uk-test", groups[1], groups, 12.6)).toBe("red_amber");
  });
});

describe("authored traffic-signal installations", () => {
  it("maps every NYC and London signal head to one compatible approach phase", () => {
    const maps = MAP_PACKS.filter((map) =>
      ["nyc-upper-west-side", "london-south-kensington"].includes(map.id),
    );
    for (const map of maps) {
      for (const control of map.laneGraph.controls.filter(
        (candidate) => candidate.type === "signal",
      )) {
        const approaches = new Map(control.approaches.map((approach) => [approach.id, approach]));
        for (const signalHead of control.installations.filter(
          (candidate) =>
            candidate.style === "nyc_signal" || candidate.style === "uk_signal",
        )) {
          expect(signalHead.approachIds?.length, `${control.id}/${signalHead.id}`).toBeGreaterThan(0);
          const mappedGroups = new Set(
            (signalHead.approachIds ?? []).map((approachId) => {
              const mapped = approaches.get(approachId);
              expect(mapped, `${signalHead.id} → ${approachId}`).toBeDefined();
              const lane = map.laneGraph.lanes.find(
                (candidate) => candidate.id === mapped!.stopLine.laneId,
              );
              expect(lane, `${approachId} lane`).toBeDefined();
              expect(
                angularDifferenceDegrees(
                  signalHead.headingDeg,
                  laneHeadingAt(lane!, mapped!.stopLine.distanceAlongM),
                ),
                `${signalHead.id} faces ${approachId}`,
              ).toBeLessThan(20);
              return mapped!.phaseGroup;
            }),
          );
          expect([...mappedGroups], `${signalHead.id} phase mapping`).toHaveLength(1);
        }
      }
    }
  });

  it("keeps every NYC and London signal-pole base outside driveable lanes", () => {
    const maps = MAP_PACKS.filter((map) =>
      ["nyc-upper-west-side", "london-south-kensington"].includes(map.id),
    );
    for (const map of maps) {
      for (const control of map.laneGraph.controls.filter(
        (candidate) => candidate.type === "signal",
      )) {
        for (const signalHead of control.installations.filter(
          (candidate) =>
            candidate.style === "nyc_signal" || candidate.style === "uk_signal",
        )) {
          for (const lane of map.laneGraph.lanes) {
            let nearest = Number.POSITIVE_INFINITY;
            for (let index = 0; index < lane.centerline.length - 1; index += 1) {
              nearest = Math.min(
                nearest,
                distanceToSegment(
                  signalHead.position,
                  lane.centerline[index],
                  lane.centerline[index + 1],
                ),
              );
            }
            expect(
              nearest,
              `${map.id}/${signalHead.id} overlaps ${lane.id}`,
            ).toBeGreaterThan((lane.widthM ?? 3.2) / 2 + 0.2);
          }
        }
      }
    }
  });

  it("groups opposing London axes correctly", () => {
    const london = MAP_PACKS.find((map) => map.id === "london-south-kensington")!;
    const queenGate = london.laneGraph.controls.find(
      (control) => control.id === "london-signal-queen-gate-cromwell",
    )!;
    const groups = Object.fromEntries(
      queenGate.approaches.map((approach) => [approach.id, approach.phaseGroup]),
    );
    expect(groups["london-queen-gate-north-approach"]).toBe(
      groups["london-queen-gate-south-approach"],
    );
    expect(groups["london-cromwell-west-approach"]).not.toBe(
      groups["london-queen-gate-north-approach"],
    );
  });
});
