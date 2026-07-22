/**
 * Imported low-poly people & cyclists (Phase 3 of the visual glow-up), built
 * from the same preloaded-glb pipeline as the vehicles. Pedestrians are rigged
 * Quaternius characters playing their Walk clip; cyclists are a rider posed on a
 * bicycle. Returns null when the models are not loaded so the caller can fall
 * back to the procedural cylinder people.
 */
import {
  AnimationGroup,
  Axis,
  Color3,
  type Material,
  MeshBuilder,
  Quaternion,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { instantiateModel, isModelReady } from "./modelLibrary";
import {
  blobShadowMaterial,
  readAlbedo,
  readAlbedoTexture,
} from "./vehicleMeshes";

export interface CharacterVisual {
  readonly root: TransformNode;
  /** Advances the cyclist's pedal cycle by a ground distance (cyclists only). */
  advancePedals?(distanceMeters: number): void;
  /** Pauses/resumes the walk clip so a stopped pedestrian stands still. */
  setMoving?(moving: boolean): void;
  dispose(): void;
}

interface CharacterModelConfig {
  readonly url: string;
  /** Material names recoloured to the crowd's clothing colour for variety. */
  readonly clothingMaterialNames: readonly string[];
  /** Uniform scale to a ~1.8 m person (the rigs are authored ~4.8 u tall). */
  readonly scale: number;
  readonly yawOffset: number;
  /** Substring identifying the looping locomotion clip. */
  readonly walkClip: string;
}

const C = "/models/characters";

/** CC0 Quaternius "Animated Men" + "Animated Women" — the same 31-joint
 * HumanArmature rig family, flat baseColor materials (easy recolour), each
 * with a Man_/Female_Walk clip the `/Walk/i` matcher finds. (The repo also
 * ships person-punk.glb, deliberately unused: it is a different 62-joint
 * armature split across four skins, which the crowd renderer's shared-
 * skeleton bake cannot carry.) */
export const CHARACTER_MODELS: readonly CharacterModelConfig[] = [
  { url: `${C}/person-a.glb`, clothingMaterialNames: ["Shirt", "Pants"], scale: 0.374, yawOffset: Math.PI, walkClip: "Walk" },
  { url: `${C}/person-b.glb`, clothingMaterialNames: ["Shirt", "Shirt2", "Pants"], scale: 0.374, yawOffset: Math.PI, walkClip: "Walk" },
  { url: `${C}/person-c.glb`, clothingMaterialNames: ["Shirt", "Pants", "Details"], scale: 0.374, yawOffset: Math.PI, walkClip: "Walk" },
  { url: `${C}/person-woman-a.glb`, clothingMaterialNames: ["Shirt", "Pants"], scale: 0.374, yawOffset: Math.PI, walkClip: "Walk" },
  { url: `${C}/person-woman-b.glb`, clothingMaterialNames: ["Dress"], scale: 0.374, yawOffset: Math.PI, walkClip: "Walk" },
];

/** CC-BY "Poly by Google" bicycle (credited in CREDITS.md); authored huge and
 * facing +X (tires along X), so it yaws +90° to put its front (handlebars) on
 * +Z, aligned with the rider (verified against a side-on render). */
const BICYCLE_MODEL = { url: `${C}/bicycle.glb`, scale: 0.005, yawOffset: Math.PI / 2 } as const;

export function characterModelUrls(): string[] {
  return [...CHARACTER_MODELS.map((config) => config.url), BICYCLE_MODEL.url];
}

/**
 * Converts a glb subtree's PBR materials to scene-consistent StandardMaterials,
 * recolouring any material in `clothingNames` to `clothing` (crowd variety) and
 * keeping the rest (skin, hair, bike paint). Returns the created materials so
 * the caller can dispose them without touching shared container materials.
 */
function convertMaterials(
  scene: Scene,
  name: string,
  subtree: TransformNode,
  clothingNames: Set<string>,
  clothing: Color3,
): StandardMaterial[] {
  const converted = new Map<Material, StandardMaterial>();
  const owned: StandardMaterial[] = [];
  for (const mesh of subtree.getChildMeshes(false)) {
    const source = mesh.material;
    if (!source) continue;
    let standard = converted.get(source);
    if (!standard) {
      standard = new StandardMaterial(`${name}-${source.name}`, scene);
      const texture = readAlbedoTexture(source);
      if (texture) standard.diffuseTexture = texture;
      standard.diffuseColor = clothingNames.has(source.name)
        ? clothing
        : texture
          ? Color3.White()
          : readAlbedo(source).clone();
      standard.specularColor = new Color3(0.05, 0.05, 0.05);
      standard.specularPower = 32;
      converted.set(source, standard);
      owned.push(standard);
    }
    mesh.material = standard;
  }
  return owned;
}

/** Small oval contact shadow under a character/cyclist, at foot level. */
function addContactShadow(
  scene: Scene,
  name: string,
  root: TransformNode,
  width: number,
  depth: number,
): void {
  const blob = MeshBuilder.CreateGround(
    `${name}-shadow`,
    { width, height: depth },
    scene,
  );
  blob.material = blobShadowMaterial(scene);
  blob.position.y = 0.02;
  blob.parent = root;
  blob.isPickable = false;
  blob.receiveShadows = false;
}

/** Plays the first animation group whose name matches `clip`, looping; disposes
 * the rest (each instance clones all 11 clips, so drop the unused ones). */
function playClip(
  groups: readonly AnimationGroup[],
  clip: string,
  speedRatio: number,
): AnimationGroup | undefined {
  const pattern = new RegExp(clip, "i");
  let chosen: AnimationGroup | undefined;
  for (const group of groups) {
    if (!chosen && pattern.test(group.name)) chosen = group;
    else group.dispose();
  }
  if (chosen) {
    chosen.speedRatio = speedRatio;
    chosen.play(true);
  }
  return chosen;
}

/**
 * A walking pedestrian. `walkSpeedRatio` slows the ~1 s walk cycle toward the
 * character's slow ground speed to cut foot-sliding.
 */
export function buildPedestrianVisual(
  scene: Scene,
  parent: TransformNode,
  name: string,
  variant: number,
  clothing: Color3,
  walkSpeedRatio: number,
): CharacterVisual | null {
  const config = CHARACTER_MODELS[Math.abs(variant) % CHARACTER_MODELS.length];
  if (!isModelReady(scene, config.url)) return null;
  const instance = instantiateModel(scene, config.url);
  const modelRoot = instance?.rootNodes[0] as TransformNode | undefined;
  if (!instance || !modelRoot) return null;

  const root = new TransformNode(`${name}-pedestrian`, scene);
  root.parent = parent;
  root.rotation.y = config.yawOffset;
  modelRoot.parent = root;
  modelRoot.scaling.setAll(config.scale);

  const owned = convertMaterials(
    scene,
    name,
    root,
    new Set(config.clothingMaterialNames),
    clothing,
  );
  addContactShadow(scene, name, root, 0.62, 0.5);
  const walk = playClip(instance.animationGroups, config.walkClip, walkSpeedRatio);

  let disposed = false;
  let moving = true;
  return {
    root,
    setMoving(next) {
      if (disposed || !walk || next === moving) return;
      moving = next;
      if (next) walk.play(true);
      else walk.pause();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      walk?.dispose();
      root.dispose(false, false);
      for (const material of owned) material.dispose(true, false);
    },
  };
}

/** Pedal radians advanced per metre the cyclist travels. */
const PEDAL_RATE = 2.2;

/**
 * Poses a rider's HumanArmature skeleton into a cycling posture (seated, hands
 * forward on the bars, torso leaned) and returns `update(phase)` to pedal the
 * legs. The bone rotations were dialled in against real renders of this rig; the
 * legs oscillate on their local X axis, arms swing forward on Z. Bones are named
 * "Clone of <bone>" after instantiation.
 */
function setupCyclistPose(riderRoot: TransformNode): (phase: number) => void {
  const bones: Record<string, TransformNode> = {};
  for (const node of riderRoot.getChildTransformNodes(false)) {
    bones[node.name.replace(/^Clone of /, "")] = node;
  }
  const restQ: Record<string, Quaternion> = {};
  for (const name of [
    "UpperLeg.L", "UpperLeg.R", "LowerLeg.L", "LowerLeg.R",
    "UpperArm.L", "UpperArm.R", "LowerArm.L", "LowerArm.R", "Abdomen",
  ]) {
    const node = bones[name];
    if (!node) continue;
    if (!node.rotationQuaternion) {
      node.rotationQuaternion = Quaternion.FromEulerVector(node.rotation);
    }
    restQ[name] = node.rotationQuaternion.clone();
  }
  const set = (name: string, axis: Vector3, angle: number): void => {
    const node = bones[name];
    const rest = restQ[name];
    if (!node || !rest) return;
    node.rotationQuaternion = rest.multiply(Quaternion.RotationAxis(axis, angle));
  };
  // Upright cruiser posture: torso near-vertical, arms out to the high swept-back
  // handlebars (tuned against side-on renders so the hands reach the grips).
  const applyStatic = (): void => {
    set("UpperArm.L", Axis.Z, -0.82);
    set("UpperArm.R", Axis.Z, 0.82);
    set("LowerArm.L", Axis.X, -0.35);
    set("LowerArm.R", Axis.X, -0.35);
    set("Abdomen", Axis.X, 0.15);
  };
  const leg = (side: "L" | "R", phase: number): void => {
    const p = -phase; // reverse so the pedals turn forward, not backward
    set(`UpperLeg.${side}`, Axis.X, 1.0 + 0.32 * Math.sin(p));
    set(`LowerLeg.${side}`, Axis.X, -1.4 + 0.5 * Math.sin(p - 0.7));
  };
  const update = (phase: number): void => {
    applyStatic();
    leg("L", phase);
    leg("R", phase + Math.PI);
  };
  update(0);
  return update;
}

/**
 * A cyclist: the bicycle prop with a rider posed correctly on it — seated, hands
 * on the bars, feet on the pedals, legs pedalling as it moves. The rider is one
 * of the pedestrian character models, skeleton-posed into a riding posture (no
 * cycling clip ships CC0), with clothing recoloured for crowd variety.
 */
export function buildCyclistVisual(
  scene: Scene,
  parent: TransformNode,
  name: string,
  variant: number,
  clothing: Color3,
): CharacterVisual | null {
  const riderConfig = CHARACTER_MODELS[Math.abs(variant) % CHARACTER_MODELS.length];
  if (!isModelReady(scene, BICYCLE_MODEL.url) || !isModelReady(scene, riderConfig.url)) {
    return null;
  }
  const bikeInstance = instantiateModel(scene, BICYCLE_MODEL.url);
  const riderInstance = instantiateModel(scene, riderConfig.url);
  const bikeRoot = bikeInstance?.rootNodes[0] as TransformNode | undefined;
  const riderRoot = riderInstance?.rootNodes[0] as TransformNode | undefined;
  if (!bikeInstance || !riderInstance || !bikeRoot || !riderRoot) {
    bikeInstance?.rootNodes[0]?.dispose();
    riderInstance?.rootNodes[0]?.dispose();
    return null;
  }

  const root = new TransformNode(`${name}-cyclist`, scene);
  root.parent = parent;

  // Bike faces +X (tires along X); wrap + yaw so it points +Z. (Rotating the glb
  // __root__ directly is ignored — it carries a rotationQuaternion.)
  const bikeWrap = new TransformNode(`${name}-bikewrap`, scene);
  bikeWrap.parent = root;
  bikeWrap.rotation.y = BICYCLE_MODEL.yawOffset;
  bikeRoot.parent = bikeWrap;
  bikeRoot.scaling.setAll(BICYCLE_MODEL.scale);
  const bikeMaterials = convertMaterials(scene, `${name}-bike`, bikeWrap, new Set(), clothing);

  // Rider faces +Z (rig faces -Z), lifted onto the saddle and skeleton-posed.
  const riderWrap = new TransformNode(`${name}-riderwrap`, scene);
  riderWrap.parent = root;
  riderWrap.rotation.y = riderConfig.yawOffset;
  riderWrap.position.set(0, 0.32, -0.1);
  riderRoot.parent = riderWrap;
  riderRoot.scaling.setAll(riderConfig.scale);
  const riderMaterials = convertMaterials(
    scene,
    `${name}-rider`,
    riderRoot,
    new Set(riderConfig.clothingMaterialNames),
    clothing,
  );
  // We pose the skeleton manually, so drop the rider's imported walk/idle clips.
  for (const group of riderInstance.animationGroups) group.dispose();
  const updatePose = setupCyclistPose(riderRoot);
  let phase = 0;

  addContactShadow(scene, name, root, 0.7, 1.7);

  let disposed = false;
  return {
    root,
    advancePedals(distanceMeters) {
      if (disposed) return;
      phase += distanceMeters * PEDAL_RATE;
      updatePose(phase);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.dispose(false, false);
      for (const material of [...bikeMaterials, ...riderMaterials]) {
        material.dispose(true, false);
      }
    },
  };
}
