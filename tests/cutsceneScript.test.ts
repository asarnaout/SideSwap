import { describe, expect, it } from "vitest";
import {
  BIKE_CUTSCENE_BODY,
  buildBikeErrandScript,
  buildRoadsideRefuelScript,
  cutsceneBodyProfile,
  DEFAULT_CUTSCENE_BODY,
  MAX_LEG_SECONDS,
  PUMP_BASE_SECONDS,
  PUMP_EXTRA_SECONDS,
  STORE_DWELL_SECONDS,
  buildBoardScript,
  buildErrandScript,
  buildExitScript,
  buildRefuelScript,
  driverDoorPoint,
  pathLength,
  rearKerbDoorPoint,
  routeAroundCar,
  scriptFocusPoint,
  scriptSeconds,
  type CutsceneBodyProfile,
  type CutsceneCarPose,
  type CutsceneStep,
} from "../app/game/cutsceneScript";
import type { WorldPoint } from "../app/game/types";

const CAR_POSES: readonly CutsceneCarPose[] = [
  { x: 0, z: 0, heading: 0 },
  { x: 40, z: -12, heading: Math.PI / 2 },
  { x: -7, z: 88, heading: -2.3 },
  { x: 3, z: 3, heading: Math.PI },
];

/** Independent world→car-local transform (mirrors the sim conventions). */
function local(car: CutsceneCarPose, point: WorldPoint) {
  const dx = point.x - car.x;
  const dz = point.z - car.z;
  const sin = Math.sin(car.heading);
  const cos = Math.cos(car.heading);
  return { long: dx * sin + dz * cos, lat: dx * cos - dz * sin };
}

/** Every point 5 cm apart along every walk/run leg of a script. */
function* walkSamples(script: readonly CutsceneStep[]): Generator<WorldPoint> {
  for (const step of script) {
    if (step.action !== "walk" && step.action !== "run") continue;
    const path = step.path ?? [];
    for (let index = 1; index < path.length; index += 1) {
      const a = path[index - 1];
      const b = path[index];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const count = Math.max(1, Math.ceil(length / 0.05));
      for (let sample = 0; sample <= count; sample += 1) {
        const t = sample / count;
        yield { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      }
    }
  }
}

function expectClearOfCarBody(
  car: CutsceneCarPose,
  script: readonly CutsceneStep[],
) {
  for (const sample of walkSamples(script)) {
    const p = local(car, sample);
    const insideBody = Math.abs(p.long) < 2.35 && Math.abs(p.lat) < 1.0;
    expect(
      insideBody,
      `sample (${sample.x.toFixed(2)}, ${sample.z.toFixed(2)}) crosses the car body`,
    ).toBe(false);
  }
}

describe("routeAroundCar", () => {
  it("goes straight when the line already clears the car", () => {
    const car: CutsceneCarPose = { x: 0, z: 0, heading: 0 };
    const path = routeAroundCar(car, { x: 2, z: 1 }, { x: 4, z: -2 });
    expect(path).toHaveLength(2);
  });

  it("skirts the bumpers when crossing flanks, on every heading", () => {
    for (const car of CAR_POSES) {
      const sin = Math.sin(car.heading);
      const cos = Math.cos(car.heading);
      // Driver-right normal is (cos h, -sin h): points 2 m off each flank.
      const left = { x: car.x - 2 * cos, z: car.z + 2 * sin };
      const right = { x: car.x + 2 * cos, z: car.z - 2 * sin };
      const path = routeAroundCar(car, left, right);
      expect(path.length).toBeGreaterThan(2);
      expectClearOfCarBody(car, [
        { action: "walk", path, seconds: 1 },
      ]);
    }
  });
});

describe("buildRefuelScript", () => {
  it("walks to the pump, fills for 3-5 s, and never crosses the car", () => {
    for (const car of CAR_POSES) {
      for (const steeringSide of ["left", "right"] as const) {
        const pump = { x: car.x + 6, z: car.z + 5 };
        const script = buildRefuelScript(car, steeringSide, pump, 0.7);
        expectClearOfCarBody(car, script);
        // The fill step happens within nozzle reach of the pump.
        const fillIndex = script.findIndex((step) => step.fuelWindow);
        expect(fillIndex).toBeGreaterThan(0);
        const walkOut = script[fillIndex - 1];
        const stand = walkOut.path?.[walkOut.path.length - 1];
        expect(stand).toBeDefined();
        expect(Math.hypot(stand!.x - pump.x, stand!.z - pump.z)).toBeLessThan(
          1.6,
        );
        // Fill duration scales with the missing fuel inside the 3-5 s brief.
        expect(script[fillIndex].seconds).toBeCloseTo(
          PUMP_BASE_SECONDS + PUMP_EXTRA_SECONDS * 0.7,
          5,
        );
        // Starts at the driver's door, ends getting back in with the dip.
        expect(script[0].action).toBe("show");
        expect(script[0].path?.[0]).toEqual(driverDoorPoint(car, steeringSide));
        expect(script[script.length - 1]).toMatchObject({
          action: "hide",
          carDip: true,
        });
      }
    }
  });

  it("clamps the fill window to the 3-5 s brief at the extremes", () => {
    const car = CAR_POSES[0];
    const pump = { x: 5, z: 5 };
    const empty = buildRefuelScript(car, "left", pump, 1);
    const topUp = buildRefuelScript(car, "left", pump, 0.02);
    const over = buildRefuelScript(car, "left", pump, 3.5);
    const fill = (script: CutsceneStep[]) =>
      script.find((step) => step.fuelWindow)!.seconds;
    expect(fill(empty)).toBe(PUMP_BASE_SECONDS + PUMP_EXTRA_SECONDS);
    expect(fill(topUp)).toBeGreaterThanOrEqual(PUMP_BASE_SECONDS);
    expect(fill(over)).toBe(PUMP_BASE_SECONDS + PUMP_EXTRA_SECONDS);
  });
});

describe("buildBoardScript", () => {
  it("walks the rider to the rear kerb-side door in all four conventions", () => {
    for (const car of CAR_POSES) {
      for (const trafficSide of ["left", "right"] as const) {
        const kerbSign = trafficSide === "right" ? 1 : -1;
        const sin = Math.sin(car.heading);
        const cos = Math.cos(car.heading);
        const riderSpot = {
          x: car.x + kerbSign * 5 * cos + 2 * sin,
          z: car.z - kerbSign * 5 * sin + 2 * cos,
        };
        const script = buildBoardScript(car, trafficSide, riderSpot);
        expectClearOfCarBody(car, script);
        const approach = script[0];
        expect(approach.action).toBe("walk");
        const doorPoint = approach.path?.[approach.path.length - 1];
        expect(doorPoint).toEqual(rearKerbDoorPoint(car, trafficSide));
        // The rear door is behind the axle midpoint and on the kerb side.
        const p = local(car, doorPoint!);
        expect(p.long).toBeLessThan(0);
        expect(Math.sign(p.lat)).toBe(kerbSign);
        expect(script[script.length - 1]).toMatchObject({
          action: "hide",
          carDip: true,
        });
      }
    }
  });
});

describe("buildExitScript", () => {
  it("steps out the rear kerb-side door and dips the car", () => {
    const car = CAR_POSES[1];
    const script = buildExitScript(car, "right");
    expect(script[0]).toMatchObject({ action: "show", carDip: true });
    expect(script[0].path?.[0]).toEqual(rearKerbDoorPoint(car, "right"));
    expect(script[script.length - 1]).toMatchObject({ action: "hide" });
  });

  // The regression guard for the "walks away, then comes back" bug: the walk-off
  // is car-relative, so for any park (any heading) it heads straight off the
  // kerb side and never routes back across the body toward a fixed venue point.
  it("walks off the kerb side clear of the car, for every pose and side", () => {
    for (const car of CAR_POSES) {
      for (const trafficSide of ["left", "right"] as const) {
        const script = buildExitScript(car, trafficSide);
        expectClearOfCarBody(car, script);
        const walk = script[1];
        const end = local(car, walk.path![walk.path!.length - 1]);
        const kerbSign = trafficSide === "right" ? 1 : -1;
        expect(Math.sign(end.lat)).toBe(kerbSign);
        expect(Math.abs(end.lat)).toBeGreaterThan(4);
      }
    }
  });
});

describe("buildErrandScript", () => {
  it("jogs out, dwells inside, jogs back and gets in - clear of the car", () => {
    for (const car of CAR_POSES) {
      const buildingDoor = { x: car.x - 9, z: car.z + 14 };
      const script = buildErrandScript(car, "left", buildingDoor);
      expectClearOfCarBody(car, script);
      expect(script.map((step) => step.action)).toEqual([
        "show",
        "run",
        "hide",
        "show",
        "run",
        "hide",
      ]);
      expect(script[2].seconds).toBe(STORE_DWELL_SECONDS);
      expect(script[3].path?.[0]).toEqual(buildingDoor);
      expect(script[script.length - 1]).toMatchObject({
        action: "hide",
        carDip: true,
      });
    }
  });

  it("hurries far doors instead of overrunning the leg cap", () => {
    const car = CAR_POSES[0];
    const script = buildErrandScript(car, "right", { x: 38, z: 24 });
    for (const step of script) {
      if (step.action === "run") {
        expect(step.seconds).toBeLessThanOrEqual(MAX_LEG_SECONDS + 1e-9);
        expect(pathLength(step.path!)).toBeGreaterThan(30);
      }
    }
  });
});

describe("script metadata", () => {
  it("is deterministic: identical inputs build identical scripts", () => {
    const car = CAR_POSES[2];
    const a = buildRefuelScript(car, "right", { x: 4, z: 90 }, 0.4);
    const b = buildRefuelScript(car, "right", { x: 4, z: 90 }, 0.4);
    expect(a).toEqual(b);
  });

  it("sums durations and finds the farthest focus point", () => {
    const car = CAR_POSES[0];
    const buildingDoor = { x: 15, z: 10 };
    const script = buildErrandScript(car, "left", buildingDoor);
    expect(scriptSeconds(script)).toBeGreaterThan(STORE_DWELL_SECONDS + 2);
    expect(scriptFocusPoint(car, script)).toEqual(buildingDoor);
  });
});

describe("CutsceneBodyProfile", () => {
  const VAN = cutsceneBodyProfile(5.18, 2.02);

  /** Profile-aware clear-of-body check (margins mirror expectClearOfCarBody). */
  function expectClearOfBody(
    car: CutsceneCarPose,
    script: readonly CutsceneStep[],
    body: CutsceneBodyProfile,
  ) {
    for (const step of script) {
      if (step.action !== "walk" && step.action !== "run") continue;
      const path = step.path ?? [];
      for (let index = 1; index < path.length; index += 1) {
        const a = path[index - 1];
        const b = path[index];
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        const count = Math.max(1, Math.ceil(length / 0.05));
        for (let sample = 0; sample <= count; sample += 1) {
          const t = sample / count;
          const p = local(car, {
            x: a.x + (b.x - a.x) * t,
            z: a.z + (b.z - a.z) * t,
          });
          const insideBody =
            Math.abs(p.long) < body.bodyHalfLongM - 0.1 &&
            Math.abs(p.lat) < body.bodyHalfLatM - 0.1;
          expect(
            insideBody,
            `sample crosses the ${body.bodyHalfLongM.toFixed(2)}-half-long body`,
          ).toBe(false);
        }
      }
    }
  }

  it("reproduces the long-standing default envelope exactly for the flagship", () => {
    expect(cutsceneBodyProfile(4.55, 1.9)).toEqual(DEFAULT_CUTSCENE_BODY);
  });

  it("keeps every builder byte-identical when the default profile is passed explicitly", () => {
    for (const car of CAR_POSES) {
      const pump = { x: car.x + 6, z: car.z + 5 };
      const door = { x: car.x - 8, z: car.z + 3 };
      expect(buildRefuelScript(car, "left", pump, 0.5)).toEqual(
        buildRefuelScript(car, "left", pump, 0.5, DEFAULT_CUTSCENE_BODY),
      );
      expect(buildErrandScript(car, "right", door)).toEqual(
        buildErrandScript(
          car,
          "right",
          door,
          undefined,
          DEFAULT_CUTSCENE_BODY,
        ),
      );
      expect(buildExitScript(car, "left")).toEqual(
        buildExitScript(car, "left", DEFAULT_CUTSCENE_BODY),
      );
      expect(buildBoardScript(car, "right", door)).toEqual(
        buildBoardScript(car, "right", door, DEFAULT_CUTSCENE_BODY),
      );
    }
  });

  it("scales the envelope up for the van: longer body, wider doors", () => {
    expect(VAN.bodyHalfLongM).toBeGreaterThan(
      DEFAULT_CUTSCENE_BODY.bodyHalfLongM,
    );
    expect(VAN.doorLateralM).toBeGreaterThan(DEFAULT_CUTSCENE_BODY.doorLateralM);
    // Doors always sit outside their own body's flank.
    expect(VAN.doorLateralM).toBeGreaterThan(VAN.bodyHalfLatM);
  });

  it("walks clear of the van's real bumpers on every heading and both sides", () => {
    for (const car of CAR_POSES) {
      for (const steeringSide of ["left", "right"] as const) {
        const sin = Math.sin(car.heading);
        const cos = Math.cos(car.heading);
        // A venue door 6 m off the flank OPPOSITE the driver's door forces an
        // around-the-body route for at least one steering side.
        const lat = steeringSide === "left" ? 6 : -6;
        const target = { x: car.x + lat * cos, z: car.z - lat * sin };
        const errand = buildErrandScript(
          car,
          steeringSide,
          target,
          undefined,
          VAN,
        );
        expectClearOfBody(car, errand, VAN);
        const refuel = buildRefuelScript(car, steeringSide, target, 0.6, VAN);
        expectClearOfBody(car, refuel, VAN);
      }
    }
  });
});

describe("buildBikeErrandScript", () => {
  it("dismounts beside the bike with no door sounds and no suspension dip", () => {
    for (const bike of CAR_POSES) {
      const door = { x: bike.x + 7, z: bike.z - 4 };
      const script = buildBikeErrandScript(bike, door);
      // A bicycle has neither doors nor suspension: nothing in the scene may
      // play a door/pump cue or dip the "car".
      for (const step of script) {
        expect(step.sound, step.action).toBeUndefined();
        expect(step.carDip ?? false).toBe(false);
      }
      // Appears at the mount point just off the bike's flank...
      const mount = script[0].path?.[0];
      expect(script[0].action).toBe("show");
      const mountLocal = local(bike, mount!);
      expect(Math.abs(mountLocal.lat)).toBeCloseTo(
        BIKE_CUTSCENE_BODY.doorLateralM,
        5,
      );
      // ...reaches the venue door, and ends hidden (remounting).
      const runOut = script[1];
      expect(runOut.action).toBe("run");
      expect(runOut.path?.[runOut.path.length - 1]).toEqual(door);
      expect(script[script.length - 1].action).toBe("hide");
      // The walk legs clear the bike's own tiny footprint.
      for (const step of script) {
        if (step.action !== "walk" && step.action !== "run") continue;
        for (let index = 1; index < (step.path ?? []).length; index += 1) {
          const a = step.path![index - 1];
          const b = step.path![index];
          const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
          for (let sample = 0; sample <= count; sample += 1) {
            const t = sample / count;
            const p = local(bike, {
              x: a.x + (b.x - a.x) * t,
              z: a.z + (b.z - a.z) * t,
            });
            const inside =
              Math.abs(p.long) < BIKE_CUTSCENE_BODY.bodyHalfLongM - 0.05 &&
              Math.abs(p.lat) < BIKE_CUTSCENE_BODY.bodyHalfLatM - 0.05;
            expect(inside, "sample crosses the bike frame").toBe(false);
          }
        }
      }
    }
  });
});

describe("buildRoadsideRefuelScript", () => {
  it("fills at the driver-side rear filler without crossing the body, both sides", () => {
    for (const car of CAR_POSES) {
      for (const steeringSide of ["left", "right"] as const) {
        const script = buildRoadsideRefuelScript(car, steeringSide);
        expectClearOfCarBody(car, script);
        // Exactly one fill window, book-ended by the pump foley.
        const fills = script.filter((step) => step.fuelWindow);
        expect(fills).toHaveLength(1);
        expect(script.some((step) => step.sound === "pump_start")).toBe(true);
        expect(script.some((step) => step.sound === "pump_stop")).toBe(true);
        // Steps out the driver door, ends back inside with the dip.
        expect(script[0].path?.[0]).toEqual(driverDoorPoint(car, steeringSide));
        expect(script[script.length - 1]).toMatchObject({
          action: "hide",
          carDip: true,
        });
        // The filler stand point sits on the driver's own side, clear of the
        // flank — the walk never needs to cross the body.
        const walkOut = script[1];
        const filler = walkOut.path?.[walkOut.path.length - 1];
        const fillerLocal = local(car, filler!);
        const driverSign = steeringSide === "left" ? -1 : 1;
        expect(Math.sign(fillerLocal.lat)).toBe(driverSign);
        expect(Math.abs(fillerLocal.lat)).toBeGreaterThan(1.1);
      }
    }
  });
});
