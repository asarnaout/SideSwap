/**
 * Cyclist posing (issue #121): seats a rigged rider on the bicycle with exact,
 * measured contact — hips on the saddle, hands on the grips, feet riding the
 * actual pedal nodes — replacing the old hand-tuned bone angles that left the
 * feet planted at ground height (the rigs are IK-control rigs: `Foot.L/R` are
 * free joints parented to the armature root, so leg rotations alone stretch
 * the shins while the feet stay put).
 *
 * How it stays correct instead of "dialled in":
 *  - Bike anchors (bottom bracket, saddle, grips) are measured glb-unit
 *    constants transformed through the *live* bike node's world matrix, so no
 *    hand-derived axis convention can drift out of sync with the loader.
 *  - `tools/split-bicycle-pedals.mjs` bakes the pedal platforms into separate
 *    `PedalL`/`PedalR` nodes whose translations sit on the crank circle; the
 *    runtime orbits those node positions and aims the rider's feet at the
 *    same transformed points, so feet and pedals cannot desync.
 *  - Limb bones aim their local +Y at their child joint, so two-bone IK is
 *    solved analytically (law of cosines) and applied as *delta rotations
 *    from the captured rest pose*. The glTF loader's root carries a mirror
 *    (scaling (1,1,-1) plus a π yaw), which makes prescribed absolute world
 *    orientations unrepresentable as node-local TRS; rest-relative deltas
 *    compose through the mirrored chain correctly.
 *  - The whole pose is a pure function of crank phase, so it is solved ONCE at
 *    build time across `PHASE_SAMPLES` sampled phases (while the hierarchy is
 *    conveniently static) and captured as per-joint *local* TRS. Local TRS is
 *    invariant to wherever the walker sim later moves/turns the cyclist, so
 *    the per-frame work is a handful of slerps — no IK, no world-space reads,
 *    and no way for the moving frame to skew the solve.
 *
 * The numeric contact contract is enforced by tests/cyclistPose.test.ts.
 */
import { Matrix, Quaternion, TransformNode, Vector3 } from "@babylonjs/core";

/** bicycle.glb is authored huge; this scale puts it at real-world size
 * (wheelbase 1.11 m, wheel Ø 0.66 m, saddle 0.92 m — a city cruiser). */
export const BIKE_SCALE = 0.005;

/** Measured bicycle.glb anchors, in glb-local units (+X toward the front
 * wheel, +Y up, frame plane at z ≈ 20). Dissected for issue #121; the pedal
 * spindles are read from the split PedalL/PedalR nodes at runtime instead. */
export const BIKE_GLB_ANCHORS = {
  /** Crank axle — midpoint of the two baked pedal spindles, on the frame plane. */
  bottomBracket: { x: 8.3, y: 50.65, z: 20.04 },
  /** Sit point, forward of the saddle-top centroid (top face y≈184, span
   * x −75..−27): perched toward the nose, which real riders do and which the
   * stylised rig needs — its legs are short for this frame size. */
  saddleSit: { x: -44, y: 183, z: 20.04 },
  /** Handlebar grip centroids (z is ± about the frame plane). */
  gripZPlus: { x: 94.5, y: 197.6, z: 67.9 },
  gripZMinus: { x: 95.4, y: 197.9, z: -26.6 },
  /** Tire ring radius (both wheels); rolling radius in metres is ×BIKE_SCALE. */
  wheelRadius: 66.32,
} as const;

/** Crank radians advanced per metre travelled — ≈78 rpm at the rail sim's
 * 3.2–4.2 m/s cycling speeds, a realistic relaxed cadence. */
export const PEDAL_CRANK_RATE = 2.2;

/** Wheel roll radians per metre (1 / rolling radius in metres). */
export const WHEEL_ROLL_RATE = 1 / (BIKE_GLB_ANCHORS.wheelRadius * BIKE_SCALE);

/** Sign mapping forward travel to crank-angle advance in bike glb XY terms.
 * Locked by the stroke-direction test: the top-of-stroke foot must move the
 * way the bike travels, never backwards. */
export const PEDAL_DIRECTION = -1;

/** Sign of wheel spin (about the tire node's local Z axle) per forward metre.
 * Locked by the rolling-contact test: the rim's ground-contact point must
 * move against the direction of travel (rolling, not sliding). */
export const WHEEL_SPIN_SIGN = -1;

/** Number of crank phases pre-solved at build time. At 60 fps and cycling
 * speed the crank turns ~7.5°/frame, matching the sample spacing, so slerped
 * frames are as accurate as exact ones would be. */
export const PHASE_SAMPLES = 48;

/** How the rider carries themself. Pitches are radians about the bike's
 * lateral axis, applied as world-frame deltas from each joint's rest pose
 * (positive = fold forward into the riding lean). The *contact* invariants
 * hold for any values here; these set the look. */
export const CYCLIST_POSTURE = {
  /** Pelvis rocks forward a touch on the saddle. */
  hips: 0.14,
  /** Lower and upper spine curve into the ~42° riding lean — enough that the
   * grips sit inside both arms' reach with a relaxed elbow bend. */
  abdomen: 0.5,
  torso: 0.8,
  /** Neck and head ease back toward vertical (these are absolute world deltas,
   * not additions to the torso lean) so the rider watches the road ahead —
   * bigger negative values here point the chin at the sky. */
  neck: -0.12,
  head: 0.04,
  /** Hip pivots sit this far above the saddle sit point. Kept small — the
   * rig's legs are short for the frame, so the rider sits planted, not perched
   * high (which is also what stopped the legs reaching the bottom pedal). */
  hipAboveSaddleM: 0.015,
  /** Wrist joints hover this far above the grip centres (mitt thickness). */
  palmAboveGripM: 0.015,
  /** Pedal-platform top sits this far above the spindle point (glb ≈ 5u,
   * rounded — the sole sinks in slightly). */
  pedalTopM: 0.02,
  /** Extra ankle lift blended in toward the bottom of the stroke: the rider
   * plantar-flexes (toe-down, ball of the foot on the pedal), raising the
   * ankle — how real riders close the last bit of reach at full extension.
   * The foot bone pitches to match so the toe stays on the platform. */
  bottomStrokeLiftM: 0.05,
  /** Lateral body sway per crank revolution (radians) — the weight shift of
   * an easy cadence. */
  bodyRoll: 0.03,
} as const;

interface TwoBoneChain {
  readonly upper: TransformNode;
  readonly lower: TransformNode;
  readonly upperRestRot: Matrix;
  readonly lowerRestRot: Matrix;
  /** Rest world aim directions (unit, joint → child joint). */
  readonly upperRestAim: Vector3;
  readonly lowerRestAim: Vector3;
  readonly upperLen: number;
  readonly lowerLen: number;
  /** Bend-side direction (world at build): the mid joint folds toward this. */
  readonly pole: Vector3;
}

/** One pre-solved crank phase: local rotations for every posed joint plus
 * local positions for the two free foot bones. */
interface PoseSample {
  readonly rotations: Quaternion[];
  readonly footPositions: Vector3[];
}

export interface CyclistPoseRig {
  /** Joints written per frame, in the order their sample rotations are stored. */
  readonly posedJoints: readonly TransformNode[];
  readonly footNodes: readonly TransformNode[];
  readonly samples: readonly PoseSample[];
  /** Pedal nodes with their baked orbit data (animated in glb units). */
  readonly pedals: ReadonlyArray<{
    node: TransformNode;
    restAngle: number;
    radius: number;
    lateralZ: number;
  }>;
  readonly wheels: readonly TransformNode[];
}

// --- module scratch (per-frame path allocates nothing) ---------------------
const AXIS_Z = new Vector3(0, 0, 1);
const tmpV = [0, 1, 2, 3, 4, 5, 6, 7].map(() => new Vector3());
const tmpQ = [0, 1, 2].map(() => new Quaternion());
const tmpM = [0, 1, 2, 3].map(() => new Matrix());

/** Strips Babylon's instantiation prefix so nodes resolve by glTF name. */
function bakedName(node: TransformNode): string {
  return node.name.replace(/^Clone of /, "");
}

function collectByName(root: TransformNode): Map<string, TransformNode> {
  const map = new Map<string, TransformNode>();
  for (const node of root.getChildTransformNodes(false)) {
    map.set(bakedName(node), node);
  }
  return map;
}

/** Rotation part of a node's freshly-computed world matrix. */
function worldRotation(node: TransformNode, out: Matrix): Matrix {
  node.computeWorldMatrix(true).getRotationMatrixToRef(out);
  return out;
}

/** World-space unit direction from `node` toward `child`. */
function boneAim(node: TransformNode, child: TransformNode, out: Vector3): Vector3 {
  node.computeWorldMatrix(true);
  child.computeWorldMatrix(true);
  out.copyFrom(child.getAbsolutePosition()).subtractInPlace(node.getAbsolutePosition());
  return out.normalize();
}

/**
 * Applies a world-frame delta rotation on top of a joint's captured rest
 * orientation (desiredWorld = restWorldRot · delta) and converts it to node-
 * local against the parent's *current* world rotation. Because both rest and
 * parent matrices carry the loader's mirror, the local result is a proper
 * rotation and the node's own TRS stays representable.
 */
function applyWorldDelta(node: TransformNode, restRot: Matrix, delta: Quaternion): void {
  Matrix.FromQuaternionToRef(delta, tmpM[0]);
  restRot.multiplyToRef(tmpM[0], tmpM[1]); // rest orientation, then world delta
  const parent = node.parent as TransformNode | null;
  if (parent) {
    parent.computeWorldMatrix(true).getRotationMatrixToRef(tmpM[2]);
    tmpM[2].invertToRef(tmpM[3]);
  } else {
    Matrix.IdentityToRef(tmpM[3]);
  }
  tmpM[1].multiplyToRef(tmpM[3], tmpM[2]); // local = desiredWorld · parentWorld⁻¹
  if (!node.rotationQuaternion) node.rotationQuaternion = new Quaternion();
  Quaternion.FromRotationMatrixToRef(tmpM[2], node.rotationQuaternion);
}

/**
 * Analytic two-bone IK in world space (build-time only): aims `upper` so the
 * mid joint lands on the law-of-cosines fold toward `target`, then aims
 * `lower` straight at it. The fold stays on the `pole` side of the joint-to-
 * target line; unreachable targets get a straight (never hyperextended) limb.
 */
function solveTwoBone(chain: TwoBoneChain, target: Vector3): void {
  chain.upper.computeWorldMatrix(true);
  const a = chain.upper.getAbsolutePosition();
  const toTarget = tmpV[0].copyFrom(target).subtractInPlace(a);
  const dist = Math.max(toTarget.length(), 1e-4);
  const d = Math.min(dist, (chain.upperLen + chain.lowerLen) * 0.999);
  toTarget.normalize();

  const bendNormal = tmpV[1];
  Vector3.CrossToRef(toTarget, chain.pole, bendNormal);
  if (bendNormal.lengthSquared() < 1e-8) bendNormal.set(1, 0, 0);
  bendNormal.normalize();

  const cosRoot =
    (chain.upperLen * chain.upperLen + d * d - chain.lowerLen * chain.lowerLen) /
    (2 * chain.upperLen * d);
  const rootAngle = Math.acos(Math.min(1, Math.max(-1, cosRoot)));

  // Fold the upper bone off the target line, toward the pole side. The
  // rotation sense of RotationAxis vs Cross is chirality-dependent, so try
  // one sense and flip if the mid joint landed on the wrong side.
  const upperAim = tmpV[2];
  for (const sense of [rootAngle, -rootAngle]) {
    Quaternion.RotationAxisToRef(bendNormal, sense, tmpQ[0]);
    upperAim.copyFrom(toTarget).rotateByQuaternionToRef(tmpQ[0], upperAim);
    const midSide = tmpV[3]
      .copyFrom(upperAim)
      .scaleInPlace(chain.upperLen)
      .subtractInPlace(tmpV[4].copyFrom(toTarget).scaleInPlace(chain.upperLen * cosRoot));
    if (Vector3.Dot(midSide, chain.pole) >= 0) break;
  }

  Quaternion.FromUnitVectorsToRef(chain.upperRestAim, upperAim, tmpQ[1]);
  applyWorldDelta(chain.upper, chain.upperRestRot, tmpQ[1]);

  chain.lower.computeWorldMatrix(true);
  const mid = chain.lower.getAbsolutePosition();
  const lowerAim = tmpV[3].copyFrom(target).subtractInPlace(mid);
  if (lowerAim.lengthSquared() < 1e-8) lowerAim.copyFrom(toTarget);
  lowerAim.normalize();
  Quaternion.FromUnitVectorsToRef(chain.lowerRestAim, lowerAim, tmpQ[1]);
  applyWorldDelta(chain.lower, chain.lowerRestRot, tmpQ[1]);
}

function buildChain(
  joints: Map<string, TransformNode>,
  upperName: string,
  lowerName: string,
  endName: string,
  pole: Vector3,
): TwoBoneChain | null {
  const upper = joints.get(upperName);
  const lower = joints.get(lowerName);
  const end = joints.get(endName);
  if (!upper || !lower || !end) return null;
  upper.computeWorldMatrix(true);
  lower.computeWorldMatrix(true);
  end.computeWorldMatrix(true);
  const upperLen = Vector3.Distance(upper.getAbsolutePosition(), lower.getAbsolutePosition());
  const lowerLen = Vector3.Distance(lower.getAbsolutePosition(), end.getAbsolutePosition());
  if (upperLen < 1e-4 || lowerLen < 1e-4) return null;
  return {
    upper,
    lower,
    upperRestRot: worldRotation(upper, new Matrix()).clone(),
    lowerRestRot: worldRotation(lower, new Matrix()).clone(),
    upperRestAim: boneAim(upper, lower, new Vector3()).clone(),
    lowerRestAim: boneAim(lower, end, new Vector3()).clone(),
    upperLen,
    lowerLen,
    pole,
  };
}

/**
 * Measures the instantiated bike + rider, seats the rider (hip pivots above
 * the saddle sit point), pre-solves the pedalling pose at PHASE_SAMPLES crank
 * phases, and leaves the rig parked at phase 0. Returns null — with a console
 * warning, leaving the rider visible but unposed — if either model is missing
 * an expected node, rather than crashing the drive.
 *
 * Must be called while `cyclistRoot`'s ancestors are stationary (i.e. at
 * build), because the solve reads world matrices; the captured samples are
 * node-local and therefore valid wherever the walker sim later moves the
 * cyclist.
 */
export function setupCyclistPose(
  cyclistRoot: TransformNode,
  bikeRoot: TransformNode,
  riderWrap: TransformNode,
  riderRoot: TransformNode,
): CyclistPoseRig | null {
  const joints = collectByName(riderRoot);
  const required = [
    "Body", "Hips", "Abdomen", "Torso", "Neck", "Head",
    "UpperLeg.L", "LowerLeg.L", "LowerLeg.L_end", "Foot.L", "Foot.L_end",
    "UpperLeg.R", "LowerLeg.R", "LowerLeg.R_end", "Foot.R", "Foot.R_end",
    "UpperArm.L", "LowerArm.L", "Palm.L", "MiddleHand.L",
    "UpperArm.R", "LowerArm.R", "Palm.R", "MiddleHand.R",
  ];
  for (const name of required) {
    if (!joints.get(name)) {
      console.warn(`[cyclist] rider rig is missing "${name}"; leaving the rider unposed`);
      return null;
    }
  }
  const bikeNodes = collectByName(bikeRoot);
  const pedalNodes = [bikeNodes.get("PedalL"), bikeNodes.get("PedalR")];
  const wheels = [bikeNodes.get("Tire"), bikeNodes.get("Tire_1")];
  if (pedalNodes.some((n) => !n) || wheels.some((n) => !n)) {
    console.warn(
      "[cyclist] bicycle.glb lacks the split pedal/tire nodes; run tools/split-bicycle-pedals.mjs",
    );
    return null;
  }

  // --- bike anchors, transformed through the live node graph ---------------
  const bikeWorld = bikeRoot.computeWorldMatrix(true).clone();
  const toAnchor = (a: { x: number; y: number; z: number }): Vector3 => {
    const out = new Vector3(a.x, a.y, a.z);
    Vector3.TransformCoordinatesToRef(out, bikeWorld, out);
    return out;
  };
  const bb = toAnchor(BIKE_GLB_ANCHORS.bottomBracket);
  const saddle = toAnchor(BIKE_GLB_ANCHORS.saddleSit);
  const grips = [toAnchor(BIKE_GLB_ANCHORS.gripZPlus), toAnchor(BIKE_GLB_ANCHORS.gripZMinus)];
  // World-space bike axes at build (unit).
  const bikeRotOnly = tmpM[0];
  bikeWorld.getRotationMatrixToRef(bikeRotOnly);
  const forward = Vector3.TransformNormal(new Vector3(1, 0, 0), bikeRotOnly).normalize();
  const up = Vector3.TransformNormal(new Vector3(0, 1, 0), bikeRotOnly).normalize();
  const lateral = Vector3.TransformNormal(AXIS_Z, bikeRotOnly).normalize();

  // --- seat the rider: hip pivots above the saddle sit point ---------------
  const hipL = joints.get("UpperLeg.L")!;
  const hipR = joints.get("UpperLeg.R")!;
  hipL.computeWorldMatrix(true);
  hipR.computeWorldMatrix(true);
  const midHip = tmpV[0]
    .copyFrom(hipL.getAbsolutePosition())
    .addInPlace(hipR.getAbsolutePosition())
    .scaleInPlace(0.5);
  const hipTarget = tmpV[1]
    .copyFrom(saddle)
    .addInPlace(tmpV[2].copyFrom(up).scaleInPlace(CYCLIST_POSTURE.hipAboveSaddleM));
  // Move the wrap by the world-space correction expressed in its parent frame
  // (the parent is the cyclist root; at build both share the same rotation).
  const correction = hipTarget.subtractInPlace(midHip);
  cyclistRoot.computeWorldMatrix(true).getRotationMatrixToRef(tmpM[1]);
  tmpM[1].invertToRef(tmpM[2]);
  Vector3.TransformNormalToRef(correction, tmpM[2], correction);
  riderWrap.position.addInPlace(correction);
  riderWrap.computeWorldMatrix(true);

  // --- pedals: orbit data in their own parent (glb-unit) space -------------
  const pedals = (pedalNodes as TransformNode[]).map((node) => ({
    node,
    restAngle: Math.atan2(
      node.position.y - BIKE_GLB_ANCHORS.bottomBracket.y,
      node.position.x - BIKE_GLB_ANCHORS.bottomBracket.x,
    ),
    radius: Math.hypot(
      node.position.x - BIKE_GLB_ANCHORS.bottomBracket.x,
      node.position.y - BIKE_GLB_ANCHORS.bottomBracket.y,
    ),
    lateralZ: node.position.z,
  }));

  // --- limb chains ----------------------------------------------------------
  const sideOf = (node: TransformNode): number => {
    node.computeWorldMatrix(true);
    tmpV[3].copyFrom(node.getAbsolutePosition()).subtractInPlace(bb);
    return Vector3.Dot(tmpV[3], lateral) >= 0 ? 1 : -1;
  };
  const legs: TwoBoneChain[] = [];
  const arms: TwoBoneChain[] = [];
  const footNodes: TransformNode[] = [];
  const footData: Array<{
    restRot: Matrix;
    ankleHeightM: number;
    footLenM: number;
    pedal: (typeof pedals)[number];
    gripTarget: Vector3;
  }> = [];
  for (const side of ["L", "R"] as const) {
    const foot = joints.get(`Foot.${side}`)!;
    const palm = joints.get(`Palm.${side}`)!;
    const frameSide = sideOf(foot);
    // Knees track close to the frame (a slight outward cant only) — a bigger
    // lateral bias reads as bow-legged riding; capped by the sagittal-plane
    // invariant in tests/cyclistPose.test.ts.
    const legPole = new Vector3()
      .copyFrom(forward)
      .addInPlace(tmpV[3].copyFrom(lateral).scaleInPlace(0.1 * frameSide))
      .normalize();
    const armPole = new Vector3()
      .copyFrom(up)
      .scaleInPlace(-1)
      .addInPlace(tmpV[3].copyFrom(lateral).scaleInPlace(0.55 * frameSide))
      .addInPlace(tmpV[4].copyFrom(forward).scaleInPlace(0.18))
      .normalize();
    const leg = buildChain(joints, `UpperLeg.${side}`, `LowerLeg.${side}`, `LowerLeg.${side}_end`, legPole);
    const arm = buildChain(joints, `UpperArm.${side}`, `LowerArm.${side}`, `Palm.${side}`, armPole);
    if (!leg || !arm) {
      console.warn(`[cyclist] degenerate ${side} limb chain; leaving the rider unposed`);
      return null;
    }
    legs.push(leg);
    arms.push(arm);
    footNodes.push(foot);
    // Ankle height above the sole: the rig stands with soles on the wrap's
    // ground plane at rest, so the foot joint's height above it is the offset.
    foot.computeWorldMatrix(true);
    tmpV[3].copyFrom(foot.getAbsolutePosition()).subtractInPlace(riderWrap.getAbsolutePosition());
    const ankleHeightM = Math.max(0.01, Vector3.Dot(tmpV[3], up));
    const footEnd = joints.get(`Foot.${side}_end`)!;
    footEnd.computeWorldMatrix(true);
    const footLenM = Math.max(
      0.04,
      Vector3.Distance(foot.getAbsolutePosition(), footEnd.getAbsolutePosition()),
    );
    const pedal = pedals.find(
      (p) => Math.sign(p.lateralZ - BIKE_GLB_ANCHORS.bottomBracket.z) === frameSide,
    );
    const grip = grips.find(
      (g) => (Vector3.Dot(tmpV[4].copyFrom(g).subtractInPlace(bb), lateral) >= 0 ? 1 : -1) ===
        sideOf(palm),
    );
    if (!pedal || !grip) {
      console.warn(`[cyclist] could not pair the ${side} limbs with bike anchors`);
      return null;
    }
    footData.push({
      restRot: worldRotation(foot, new Matrix()).clone(),
      ankleHeightM,
      footLenM,
      pedal,
      gripTarget: new Vector3()
        .copyFrom(grip)
        .addInPlace(tmpV[5].copyFrom(up).scaleInPlace(CYCLIST_POSTURE.palmAboveGripM)),
    });
  }

  const spine = (
    [
      ["Hips", CYCLIST_POSTURE.hips],
      ["Abdomen", CYCLIST_POSTURE.abdomen],
      ["Torso", CYCLIST_POSTURE.torso],
      ["Neck", CYCLIST_POSTURE.neck],
      ["Head", CYCLIST_POSTURE.head],
    ] as const
  ).map(([name, pitch]) => {
    const node = joints.get(name)!;
    return { node, restRot: worldRotation(node, new Matrix()).clone(), pitch };
  });
  const body = joints.get("Body")!;
  const bodyRestRot = worldRotation(body, new Matrix()).clone();

  // Feet are included: their rotations sample like every other joint; their
  // positions (free bones) are sampled separately via footPositions.
  const posedJoints: TransformNode[] = [
    body,
    ...spine.map((j) => j.node),
    ...legs.flatMap((c) => [c.upper, c.lower]),
    ...arms.flatMap((c) => [c.upper, c.lower]),
    ...footNodes,
  ];

  // --- pre-solve every sampled crank phase ---------------------------------
  const pedalWorld = (pedal: (typeof pedals)[number], phase: number, out: Vector3): Vector3 => {
    const angle = pedal.restAngle + phase;
    out.set(
      BIKE_GLB_ANCHORS.bottomBracket.x + pedal.radius * Math.cos(angle),
      BIKE_GLB_ANCHORS.bottomBracket.y + pedal.radius * Math.sin(angle),
      pedal.lateralZ,
    );
    Vector3.TransformCoordinatesToRef(out, bikeWorld, out);
    return out;
  };

  const samples: PoseSample[] = [];
  for (let k = 0; k < PHASE_SAMPLES; k++) {
    const phase = (k / PHASE_SAMPLES) * Math.PI * 2;

    // Torso: cadence sway on the common spine root, staged lean up the spine,
    // head counter-pitch back up (negative pitches in CYCLIST_POSTURE). The
    // lean sign is locked by the "torso leaned toward the bars" invariant.
    Quaternion.RotationAxisToRef(forward, CYCLIST_POSTURE.bodyRoll * Math.sin(phase), tmpQ[2]);
    applyWorldDelta(body, bodyRestRot, tmpQ[2]);
    for (const joint of spine) {
      Quaternion.RotationAxisToRef(lateral, -joint.pitch, tmpQ[0]);
      tmpQ[2].multiplyToRef(tmpQ[0], tmpQ[1]);
      applyWorldDelta(joint.node, joint.restRot, tmpQ[1]);
    }

    // Legs and the free foot bones ride the pedal spindles. Toward the bottom
    // of the stroke the ankle target lifts (plantar flexion — ball of the
    // foot on the pedal) and the foot pitches toe-down to match, which is
    // both how riders actually reach full extension and what lets this rig's
    // short legs span the whole crank circle.
    for (let i = 0; i < legs.length; i++) {
      const data = footData[i];
      const crankAngle = data.pedal.restAngle + phase;
      const bottomness = (1 - Math.sin(crankAngle)) / 2; // 0 at top, 1 at bottom
      const lift = CYCLIST_POSTURE.bottomStrokeLiftM * bottomness;
      const target = pedalWorld(data.pedal, phase, tmpV[6]);
      target.addInPlace(
        tmpV[5]
          .copyFrom(up)
          .scaleInPlace(CYCLIST_POSTURE.pedalTopM + data.ankleHeightM + lift),
      );
      solveTwoBone(legs[i], target);
      const foot = footNodes[i];
      const parent = foot.parent as TransformNode;
      parent.computeWorldMatrix(true).invertToRef(tmpM[3]);
      Vector3.TransformCoordinatesToRef(target, tmpM[3], foot.position);
      const toePitch = Math.asin(Math.min(0.95, lift / data.footLenM));
      Quaternion.RotationAxisToRef(lateral, toePitch, tmpQ[0]);
      applyWorldDelta(foot, data.restRot, tmpQ[0]);
    }

    // Arms hold the grips (constant targets; solved per phase anyway so the
    // shoulders' sway keeps the hands planted).
    for (let i = 0; i < arms.length; i++) {
      solveTwoBone(arms[i], footData[i].gripTarget);
    }

    samples.push({
      rotations: posedJoints.map((j) => j.rotationQuaternion!.clone()),
      footPositions: footNodes.map((f) => f.position.clone()),
    });
  }

  const rig: CyclistPoseRig = { posedJoints, footNodes, samples, pedals, wheels: wheels as TransformNode[] };
  poseCyclist(rig, 0, 0);
  return rig;
}

/**
 * Applies the pose for a crank phase (radians, advanced by ground distance ×
 * PEDAL_CRANK_RATE) and wheel roll angle (distance × WHEEL_ROLL_RATE): orbits
 * the pedal nodes, spins the tires, and slerps the rider between the two
 * nearest pre-solved samples. Allocation-free; safe to call every frame.
 */
export function poseCyclist(rig: CyclistPoseRig, crankPhase: number, wheelAngle: number): void {
  const directed = PEDAL_DIRECTION * crankPhase;

  const bbGlb = BIKE_GLB_ANCHORS.bottomBracket;
  for (const pedal of rig.pedals) {
    const angle = pedal.restAngle + directed;
    pedal.node.position.set(
      bbGlb.x + pedal.radius * Math.cos(angle),
      bbGlb.y + pedal.radius * Math.sin(angle),
      pedal.lateralZ,
    );
  }
  for (const wheel of rig.wheels) {
    if (!wheel.rotationQuaternion) wheel.rotationQuaternion = new Quaternion();
    Quaternion.RotationAxisToRef(AXIS_Z, WHEEL_SPIN_SIGN * wheelAngle, wheel.rotationQuaternion);
  }

  const tau = Math.PI * 2;
  const normalized = ((directed % tau) + tau) % tau;
  const slot = (normalized / tau) * PHASE_SAMPLES;
  const k0 = Math.floor(slot) % PHASE_SAMPLES;
  const k1 = (k0 + 1) % PHASE_SAMPLES;
  const t = slot - Math.floor(slot);
  const s0 = rig.samples[k0];
  const s1 = rig.samples[k1];
  for (let i = 0; i < rig.posedJoints.length; i++) {
    const joint = rig.posedJoints[i];
    if (!joint.rotationQuaternion) joint.rotationQuaternion = new Quaternion();
    Quaternion.SlerpToRef(s0.rotations[i], s1.rotations[i], t, joint.rotationQuaternion);
  }
  for (let i = 0; i < rig.footNodes.length; i++) {
    Vector3.LerpToRef(s0.footPositions[i], s1.footPositions[i], t, rig.footNodes[i].position);
  }
}
