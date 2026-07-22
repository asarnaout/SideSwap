/**
 * Imported low-poly people & cyclists (Phase 3 of the visual glow-up), built
 * from the same preloaded-glb pipeline as the vehicles. Pedestrians are rigged
 * Quaternius characters playing their Walk clip; cyclists are a rider posed on a
 * bicycle. Returns null when the models are not loaded so the caller can fall
 * back to the procedural cylinder people.
 */
import {
  AnimationGroup,
  Color3,
  type Material,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import {
  BIKE_SCALE,
  PEDAL_CRANK_RATE,
  WHEEL_ROLL_RATE,
  poseCyclist,
  setupCyclistPose,
} from "./cyclistPose";
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
  /** Material names taking the per-person complexion instead of the rig's
   * single baked one (see characterPalettes.ts). */
  readonly complexionMaterialNames: readonly string[];
  /** Same for hair. Some rigs split it in two (a base plus a top layer); both
   * take the one colour, so the two-tone shading the rig authored is lost. */
  readonly hairMaterialNames: readonly string[];
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
  { url: `${C}/person-a.glb`, clothingMaterialNames: ["Shirt", "Pants"], complexionMaterialNames: ["Skin"], hairMaterialNames: ["Hair"], scale: 0.374, yawOffset: Math.PI, walkClip: "Walk" },
  { url: `${C}/person-b.glb`, clothingMaterialNames: ["Shirt", "Shirt2", "Pants"], complexionMaterialNames: ["Skin"], hairMaterialNames: ["Hair", "Hair2"], scale: 0.374, yawOffset: Math.PI, walkClip: "Walk" },
  { url: `${C}/person-c.glb`, clothingMaterialNames: ["Shirt", "Pants", "Details"], complexionMaterialNames: ["Skin"], hairMaterialNames: ["Hair"], scale: 0.374, yawOffset: Math.PI, walkClip: "Walk" },
  { url: `${C}/person-woman-a.glb`, clothingMaterialNames: ["Shirt", "Pants"], complexionMaterialNames: ["Skin"], hairMaterialNames: ["Hair", "HairBase"], scale: 0.374, yawOffset: Math.PI, walkClip: "Walk" },
  { url: `${C}/person-woman-b.glb`, clothingMaterialNames: ["Dress"], complexionMaterialNames: ["Skin"], hairMaterialNames: ["Hair"], scale: 0.374, yawOffset: Math.PI, walkClip: "Walk" },
];

/** CC-BY "Poly by Google" bicycle (credited in CREDITS.md; pedals/tires split
 * into animatable nodes by tools/split-bicycle-pedals.mjs); authored huge and
 * facing +X (tires along X), so it yaws +90° to put its front (handlebars) on
 * +Z, aligned with the rider (verified against a side-on render). */
const BICYCLE_MODEL = { url: `${C}/bicycle.glb`, scale: BIKE_SCALE, yawOffset: Math.PI / 2 } as const;

export function characterModelUrls(): string[] {
  return [...CHARACTER_MODELS.map((config) => config.url), BICYCLE_MODEL.url];
}

/** The three colours that make one person distinct from the next; everything
 * else (eyes, shoes, bike paint) keeps the colour its rig authored. */
export interface CharacterColors {
  readonly clothing: Color3;
  readonly complexion: Color3;
  readonly hair: Color3;
}

/** Which of a model's materials this person overrides, and with what. */
function materialOverrides(
  config: CharacterModelConfig,
  colors: CharacterColors,
): Map<string, Color3> {
  const overrides = new Map<string, Color3>();
  for (const material of config.clothingMaterialNames) {
    overrides.set(material, colors.clothing);
  }
  for (const material of config.complexionMaterialNames) {
    overrides.set(material, colors.complexion);
  }
  for (const material of config.hairMaterialNames) {
    overrides.set(material, colors.hair);
  }
  return overrides;
}

/**
 * Converts a glb subtree's PBR materials to scene-consistent StandardMaterials,
 * applying any per-material colour `overrides` and keeping the rest as authored.
 * Returns the created materials so the caller can dispose them without touching
 * shared container materials.
 */
function convertMaterials(
  scene: Scene,
  name: string,
  subtree: TransformNode,
  overrides: ReadonlyMap<string, Color3>,
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
      const override = overrides.get(source.name);
      standard.diffuseColor = override
        ? override.clone()
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
  colors: CharacterColors,
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
    materialOverrides(config, colors),
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

/** Rigs a cyclist may ride: every model but the dress one — a knee-length
 * skirt skinned to two counter-phased pedalling legs shears unavoidably. */
const CYCLIST_RIDER_MODELS: readonly CharacterModelConfig[] = CHARACTER_MODELS.filter(
  (config) => !config.url.includes("person-woman-b"),
);

/**
 * A cyclist: the bicycle prop with a rider seated on it — hips on the saddle,
 * hands on the grips, feet riding the split pedal nodes, legs pedalling and
 * wheels rolling with ground distance. The rider is one of the pedestrian
 * character models; the posture and pedal cycle are solved from measured
 * geometry in cyclistPose.ts (no cycling clip ships CC0), with clothing and
 * complexion recoloured for crowd variety.
 */
export function buildCyclistVisual(
  scene: Scene,
  parent: TransformNode,
  name: string,
  variant: number,
  colors: CharacterColors,
): CharacterVisual | null {
  const riderConfig =
    CYCLIST_RIDER_MODELS[Math.abs(variant) % CYCLIST_RIDER_MODELS.length];
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
  const bikeMaterials = convertMaterials(scene, `${name}-bike`, bikeWrap, new Map());

  // Centre the bike on the cyclist's pivot: the glb's wheelbase midpoint and
  // frame plane are offset from its origin, which used to park the whole bike
  // ~0.10 m to one side of the rail point (and of the rider).
  {
    const tires = bikeRoot
      .getChildTransformNodes(false)
      .filter((node) => /Tire/.test(node.name));
    if (tires.length === 2) {
      const mid = new Vector3();
      for (const tire of tires) {
        tire.computeWorldMatrix(true);
        mid.addInPlace(tire.getAbsolutePosition());
      }
      mid.scaleInPlace(0.5);
      root.computeWorldMatrix(true);
      const rootInv = root.getWorldMatrix().clone().invert();
      Vector3.TransformCoordinatesToRef(mid, rootInv, mid);
      bikeWrap.position.x -= mid.x;
      bikeWrap.position.z -= mid.z;
      bikeWrap.computeWorldMatrix(true);
    }
  }

  // Rider faces +Z (rig faces -Z); cyclistPose seats it onto the saddle.
  const riderWrap = new TransformNode(`${name}-riderwrap`, scene);
  riderWrap.parent = root;
  riderWrap.rotation.y = riderConfig.yawOffset;
  riderRoot.parent = riderWrap;
  riderRoot.scaling.setAll(riderConfig.scale);
  const riderMaterials = convertMaterials(
    scene,
    `${name}-rider`,
    riderRoot,
    materialOverrides(riderConfig, colors),
  );
  // The skeleton is posed from measured geometry; the imported walk/idle clips
  // would fight it, so drop them before solving.
  for (const group of riderInstance.animationGroups) group.dispose();
  const rig = setupCyclistPose(root, bikeRoot, riderWrap, riderRoot);
  let phase = 0;
  let wheelAngle = 0;

  addContactShadow(scene, name, root, 0.7, 1.7);

  let disposed = false;
  return {
    root,
    advancePedals(distanceMeters) {
      if (disposed || !rig) return;
      phase += distanceMeters * PEDAL_CRANK_RATE;
      wheelAngle += distanceMeters * WHEEL_ROLL_RATE;
      poseCyclist(rig, phase, wheelAngle);
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
