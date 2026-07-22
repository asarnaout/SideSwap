import { describe, expect, it } from "vitest";
import {
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
  it("steps out kerb-side, dips the car, and walks to the kerb spot", () => {
    const car = CAR_POSES[1];
    const kerbSpot = { x: car.x + 1, z: car.z - 6 };
    const script = buildExitScript(car, "right", kerbSpot);
    expect(script[0]).toMatchObject({ action: "show", carDip: true });
    expect(script[0].path?.[0]).toEqual(rearKerbDoorPoint(car, "right"));
    const walk = script[1];
    expect(walk.path?.[walk.path!.length - 1]).toEqual(kerbSpot);
    expectClearOfCarBody(car, script);
  });

  it("wanders a few metres kerbward when the stop has no kerb spot", () => {
    for (const trafficSide of ["left", "right"] as const) {
      const car = CAR_POSES[0];
      const script = buildExitScript(car, trafficSide, null);
      const walk = script[1];
      const end = local(car, walk.path![walk.path!.length - 1]);
      const kerbSign = trafficSide === "right" ? 1 : -1;
      expect(Math.sign(end.lat)).toBe(kerbSign);
      expect(Math.abs(end.lat)).toBeGreaterThan(4);
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
