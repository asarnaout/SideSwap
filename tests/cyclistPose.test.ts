import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  LoadAssetContainerAsync,
  Matrix,
  NullEngine,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import {
  BIKE_GLB_ANCHORS,
  BIKE_SCALE,
  PHASE_SAMPLES,
  WHEEL_ROLL_RATE,
  poseCyclist,
  setupCyclistPose,
  type CyclistPoseRig,
} from "../app/game/cyclistPose";
import { CHARACTER_MODELS } from "../app/game/characterMeshes";

/**
 * Numeric contract for issue #121 ("cyclists are uncanny"): the rider must be
 * measurably ON the bike — feet socketed to the pedal spindles through the
 * whole crank revolution, hands on the grips, hips on the saddle, knees
 * pedalling forward in their sagittal planes — for every rider rig, at every
 * crank phase, and regardless of where the walker sim has moved the cyclist.
 * These assertions run the real setup/solve against the real glb assets.
 */

const CHAR_DIR = path.join(process.cwd(), "public/models/characters");
const RIDER_FILES = ["person-a.glb", "person-b.glb", "person-c.glb", "person-woman-a.glb"];

/** 12 evenly spaced crank phases; PHASE_SAMPLES is a multiple, so these hit
 * pre-solved samples exactly (no interpolation slack in the core asserts). */
const PHASES = Array.from({ length: 12 }, (_, k) => (k / 12) * Math.PI * 2);

registerBuiltInLoaders();

async function loadContainer(scene: Scene, file: string) {
  const buf = fs.readFileSync(path.join(CHAR_DIR, file));
  return LoadAssetContainerAsync(
    "data:model/gltf-binary;base64," + buf.toString("base64"),
    scene,
    { pluginExtension: ".glb" },
  );
}

interface TestCyclist {
  scene: Scene;
  engine: NullEngine;
  parent: TransformNode;
  bikeRoot: TransformNode;
  rig: CyclistPoseRig;
  joints: Map<string, TransformNode>;
}

/** Mirrors buildCyclistVisual's hierarchy (wrap yaws/scales + bike centring)
 * without the modelLibrary preload plumbing, which needs a browser fetch. */
async function buildCyclist(riderFile: string): Promise<TestCyclist> {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const bikeContainer = await loadContainer(scene, "bicycle.glb");
  const riderContainer = await loadContainer(scene, riderFile);
  const bike = bikeContainer.instantiateModelsToScene(undefined, false, {
    doNotInstantiate: true,
  });
  const rider = riderContainer.instantiateModelsToScene(undefined, false, {
    doNotInstantiate: true,
  });
  const bikeRoot = bike.rootNodes[0] as TransformNode;
  const riderRoot = rider.rootNodes[0] as TransformNode;
  const config = CHARACTER_MODELS.find((c) => c.url.endsWith(riderFile))!;

  const parent = new TransformNode("road-user", scene);
  parent.position.set(3.2, 0, -7.5);
  parent.rotation.y = 0.6;
  const root = new TransformNode("cyclist", scene);
  root.parent = parent;
  const bikeWrap = new TransformNode("bikewrap", scene);
  bikeWrap.parent = root;
  bikeWrap.rotation.y = Math.PI / 2;
  bikeRoot.parent = bikeWrap;
  bikeRoot.scaling.setAll(BIKE_SCALE);
  {
    const tires = bikeRoot.getChildTransformNodes(false).filter((n) => /Tire/.test(n.name));
    const mid = new Vector3();
    for (const tire of tires) {
      tire.computeWorldMatrix(true);
      mid.addInPlace(tire.getAbsolutePosition());
    }
    mid.scaleInPlace(0.5);
    root.computeWorldMatrix(true);
    Vector3.TransformCoordinatesToRef(mid, root.getWorldMatrix().clone().invert(), mid);
    bikeWrap.position.x -= mid.x;
    bikeWrap.position.z -= mid.z;
  }
  const riderWrap = new TransformNode("riderwrap", scene);
  riderWrap.parent = root;
  riderWrap.rotation.y = config.yawOffset;
  riderRoot.parent = riderWrap;
  riderRoot.scaling.setAll(config.scale);
  for (const group of rider.animationGroups) group.dispose();

  const rig = setupCyclistPose(root, bikeRoot, riderWrap, riderRoot);
  expect(rig, `${riderFile}: setupCyclistPose returned null`).not.toBeNull();

  const joints = new Map<string, TransformNode>();
  for (const node of riderRoot.getChildTransformNodes(false)) {
    joints.set(node.name.replace(/^Clone of /, ""), node);
  }
  return { scene, engine, parent, bikeRoot, rig: rig!, joints };
}

/** Live world-space bike frame: anchors and axes through the current node
 * transforms, so assertions stay valid after the cyclist moves. */
function bikeFrame(bikeRoot: TransformNode) {
  const world = bikeRoot.computeWorldMatrix(true);
  const rot = new Matrix();
  world.getRotationMatrixToRef(rot);
  const axis = (x: number, y: number, z: number) =>
    Vector3.TransformNormal(new Vector3(x, y, z), rot).normalize();
  return {
    anchor: (a: { x: number; y: number; z: number }) =>
      Vector3.TransformCoordinates(new Vector3(a.x, a.y, a.z), world),
    forward: axis(1, 0, 0),
    up: axis(0, 1, 0),
    lateral: axis(0, 0, 1),
  };
}

const abs = (node: TransformNode) => {
  node.computeWorldMatrix(true);
  return node.getAbsolutePosition().clone();
};

/** Distance between two points in the plane perpendicular to `up`. */
function horizontalDistance(a: Vector3, b: Vector3, up: Vector3): number {
  const d = a.subtract(b);
  d.subtractInPlace(up.scale(Vector3.Dot(d, up)));
  return d.length();
}

function interiorAngle(at: Vector3, a: Vector3, b: Vector3): number {
  const u = a.subtract(at).normalize();
  const v = b.subtract(at).normalize();
  return Math.acos(Math.min(1, Math.max(-1, Vector3.Dot(u, v))));
}

function checkContactInvariants(c: TestCyclist, label: string) {
  const pedalNodes = c.rig.pedals.map((p) => p.node);
  const kneeAngles: number[][] = [[], []];
  for (const phase of PHASES) {
    poseCyclist(c.rig, phase, 0);
    const frame = bikeFrame(c.bikeRoot);
    const tag = `${label} phase ${(phase / Math.PI).toFixed(2)}π`;

    // Feet socketed on the pedals: horizontally on the spindle, a constant
    // small hover above it, and one foot per pedal.
    const pedalPos = pedalNodes.map((n) => abs(n));
    const owners: number[] = [];
    for (const side of [0, 1] as const) {
      const foot = abs(c.rig.footNodes[side]);
      const dists = pedalPos.map((p) => horizontalDistance(foot, p, frame.up));
      const owner = dists[0] < dists[1] ? 0 : 1;
      owners.push(owner);
      expect(dists[owner], `${tag}: foot ${side} off its pedal spindle`).toBeLessThan(0.015);
      const hover = Vector3.Dot(foot.subtract(pedalPos[owner]), frame.up);
      expect(hover, `${tag}: foot ${side} hover`).toBeGreaterThan(0.015);
      expect(hover, `${tag}: foot ${side} hover`).toBeLessThan(0.11);

      // Chain continuity: the ankle (end of the shin) coincides with the free
      // foot bone — the regression that caused the original planted-feet bug.
      const ankle = abs(c.joints.get(`LowerLeg.${side === 0 ? "L" : "R"}_end`)!);
      expect(
        Vector3.Distance(ankle, foot),
        `${tag}: shin end detached from foot ${side}`,
      ).toBeLessThan(0.012);
    }
    expect(owners[0], `${tag}: both feet on one pedal`).not.toBe(owners[1]);

    // Hands on the grips (each wrist near a grip, one per side).
    const grips = [
      frame.anchor(BIKE_GLB_ANCHORS.gripZPlus),
      frame.anchor(BIKE_GLB_ANCHORS.gripZMinus),
    ];
    const wristOwners: number[] = [];
    for (const side of ["L", "R"] as const) {
      const wrist = abs(c.joints.get(`Palm.${side}`)!);
      const dists = grips.map((g) => Vector3.Distance(wrist, g));
      const owner = dists[0] < dists[1] ? 0 : 1;
      wristOwners.push(owner);
      expect(dists[owner], `${tag}: ${side} hand off the grip`).toBeLessThan(0.03);
    }
    expect(wristOwners[0], `${tag}: both hands on one grip`).not.toBe(wristOwners[1]);

    // Seated: hip pivots stay over the saddle sit point.
    const saddle = frame.anchor(BIKE_GLB_ANCHORS.saddleSit);
    const midHip = abs(c.joints.get("UpperLeg.L")!)
      .add(abs(c.joints.get("UpperLeg.R")!))
      .scale(0.5);
    expect(
      Vector3.Distance(midHip, saddle),
      `${tag}: rider not seated on the saddle`,
    ).toBeLessThan(0.09);

    // Riding posture: shoulders forward of the hips (leaned toward the bars),
    // head held up (skull axis nowhere near horizontal).
    const midShoulder = abs(c.joints.get("Shoulder.L")!)
      .add(abs(c.joints.get("Shoulder.R")!))
      .scale(0.5);
    const leanForward = Vector3.Dot(midShoulder.subtract(midHip), frame.forward);
    expect(leanForward, `${tag}: torso not leaned toward the bars`).toBeGreaterThan(0.1);
    expect(leanForward, `${tag}: torso folded flat`).toBeLessThan(0.5);
    const head = abs(c.joints.get("Head")!);
    const headEnd = abs(c.joints.get("Head_end")!);
    const skull = headEnd.subtract(head).normalize();
    expect(
      Vector3.Dot(skull, frame.up),
      `${tag}: head drooped toward the wheel`,
    ).toBeGreaterThan(Math.cos((55 * Math.PI) / 180));

    // Knees: bend within human range, track their sagittal planes (no bowing),
    // and point forward, not backward.
    for (const [i, side] of (["L", "R"] as const).entries()) {
      const hip = abs(c.joints.get(`UpperLeg.${side}`)!);
      const knee = abs(c.joints.get(`LowerLeg.${side}`)!);
      const ankle = abs(c.joints.get(`LowerLeg.${side}_end`)!);
      const angle = interiorAngle(knee, hip, ankle);
      kneeAngles[i].push(angle);
      expect(angle, `${tag}: ${side} knee hyper/over-bent`).toBeGreaterThan(
        (60 * Math.PI) / 180,
      );
      expect(angle, `${tag}: ${side} knee locked past straight`).toBeLessThanOrEqual(
        (178.5 * Math.PI) / 180,
      );
      const lateralDrift = Math.abs(
        Vector3.Dot(knee.subtract(hip), frame.lateral),
      );
      expect(lateralDrift, `${tag}: ${side} knee bowing sideways`).toBeLessThan(0.06);
      const kneeForward = Vector3.Dot(
        knee.subtract(hip.add(ankle).scale(0.5)),
        frame.forward,
      );
      expect(kneeForward, `${tag}: ${side} knee folding backwards`).toBeGreaterThan(-0.01);
    }
  }

  // The legs genuinely pedal: each knee sweeps a meaningful range over the
  // revolution, and the two legs stay in opposite phase.
  for (const angles of kneeAngles) {
    const sweep = Math.max(...angles) - Math.min(...angles);
    expect(sweep, `${label}: knee barely moves — not pedalling`).toBeGreaterThan(
      (20 * Math.PI) / 180,
    );
  }
  const l = kneeAngles[0];
  const r = kneeAngles[1];
  const half = PHASES.length / 2;
  for (let k = 0; k < half; k++) {
    expect(
      Math.abs(l[k] - r[(k + half) % PHASES.length]),
      `${label}: legs not in opposite phase`,
    ).toBeLessThan((6 * Math.PI) / 180);
  }
}

describe("cyclist pose contact contract", () => {
  for (const riderFile of RIDER_FILES) {
    describe(riderFile, () => {
      let c: TestCyclist;
      beforeAll(async () => {
        c = await buildCyclist(riderFile);
      });

      it("keeps feet, hands and seat in contact through the crank revolution", () => {
        checkContactInvariants(c, riderFile);
      });

      it("still holds after the walker sim moves and turns the cyclist", () => {
        c.parent.position.set(-41.7, 0, 12.3);
        c.parent.rotation.y = 2.4;
        checkContactInvariants(c, `${riderFile} (moved)`);
      });

      it("pedals forward: the top-of-stroke foot travels the way the bike does", () => {
        // Find each foot's highest phase, then check its direction of travel.
        const frame = bikeFrame(c.bikeRoot);
        for (const side of [0, 1] as const) {
          let bestPhase = 0;
          let bestHeight = -Infinity;
          for (const phase of PHASES) {
            poseCyclist(c.rig, phase, 0);
            const h = Vector3.Dot(abs(c.rig.footNodes[side]), frame.up);
            if (h > bestHeight) {
              bestHeight = h;
              bestPhase = phase;
            }
          }
          const delta = 0.15;
          poseCyclist(c.rig, bestPhase - delta, 0);
          const before = abs(c.rig.footNodes[side]);
          poseCyclist(c.rig, bestPhase + delta, 0);
          const after = abs(c.rig.footNodes[side]);
          expect(
            Vector3.Dot(after.subtract(before), frame.forward),
            `foot ${side} pedals backwards at the top of the stroke`,
          ).toBeGreaterThan(0);
        }
      });

      it("rolls the wheels against the ground, not with it", () => {
        // A rim marker at the bottom of the wheel must move backwards relative
        // to the hub while the bike moves forwards (rolling contact).
        const frame = bikeFrame(c.bikeRoot);
        const wheel = c.rig.wheels[0];
        const marker = new TransformNode("marker", c.scene);
        marker.parent = wheel;
        marker.position.set(0, -BIKE_GLB_ANCHORS.wheelRadius, 0);
        poseCyclist(c.rig, 0, 0);
        const before = abs(marker);
        const forwardTravel = 0.05; // metres
        poseCyclist(c.rig, 0, forwardTravel * WHEEL_ROLL_RATE);
        const after = abs(marker);
        expect(
          Vector3.Dot(after.subtract(before), frame.forward),
          "wheel spins the wrong way for the direction of travel",
        ).toBeLessThan(0);
        marker.dispose();
      });

      it("interpolates cleanly between pre-solved samples", () => {
        // Mid-sample phases (the worst case for the slerp) keep the feet
        // socketed within a slightly looser tolerance.
        const step = (Math.PI * 2) / PHASE_SAMPLES;
        for (const phase of [0.5 * step, 7.5 * step, 30.5 * step]) {
          poseCyclist(c.rig, phase, 0);
          const frame = bikeFrame(c.bikeRoot);
          for (const side of [0, 1] as const) {
            const foot = abs(c.rig.footNodes[side]);
            const nearest = Math.min(
              ...c.rig.pedals.map((p) => horizontalDistance(foot, abs(p.node), frame.up)),
            );
            expect(nearest, `mid-sample foot ${side} drift`).toBeLessThan(0.02);
          }
        }
      });
    });
  }

  it("bicycle.glb carries the split, re-pivoted animation nodes", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const container = await loadContainer(scene, "bicycle.glb");
    const byName = new Map(container.transformNodes.concat(container.meshes as never).map(
      (n: TransformNode) => [n.name, n],
    ));
    const pedalL = byName.get("PedalL")!;
    const pedalR = byName.get("PedalR")!;
    expect(pedalL).toBeDefined();
    expect(pedalR).toBeDefined();
    const bb = BIKE_GLB_ANCHORS.bottomBracket;
    for (const pedal of [pedalL, pedalR]) {
      const r = Math.hypot(pedal.position.x - bb.x, pedal.position.y - bb.y);
      expect(Math.abs(r - 28.2), `${pedal.name} off the crank circle`).toBeLessThan(1.5);
    }
    // Spindles baked 180° apart.
    const angle = (n: TransformNode) => Math.atan2(n.position.y - bb.y, n.position.x - bb.x);
    let spread = Math.abs(angle(pedalL) - angle(pedalR));
    spread = Math.min(spread, Math.PI * 2 - spread);
    expect(Math.abs(spread - Math.PI)).toBeLessThan(0.05);
    // Tires re-pivoted about their hubs (geometry centred on the node origin).
    for (const name of ["Tire", "Tire_1"]) {
      const tire = byName.get(name)!;
      expect(tire).toBeDefined();
      expect(Math.abs(tire.position.y - 66.32)).toBeLessThan(0.1);
    }
    scene.dispose();
    engine.dispose();
  });
});
