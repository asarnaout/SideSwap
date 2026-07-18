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
} from "@babylonjs/core";
import { instantiateModel, isModelReady } from "./modelLibrary";
import {
  blobShadowMaterial,
  readAlbedo,
  readAlbedoTexture,
} from "./vehicleMeshes";

export interface CharacterVisual {
  readonly root: TransformNode;
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

/** CC0 Quaternius "Animated Men" — one shared HumanArmature rig, flat baseColor
 * materials (easy recolour), each with a Man_Walk clip. */
export const CHARACTER_MODELS: readonly CharacterModelConfig[] = [
  { url: `${C}/person-a.glb`, clothingMaterialNames: ["Shirt", "Pants"], scale: 0.374, yawOffset: 0, walkClip: "Walk" },
  { url: `${C}/person-b.glb`, clothingMaterialNames: ["Shirt", "Shirt2", "Pants"], scale: 0.374, yawOffset: 0, walkClip: "Walk" },
  { url: `${C}/person-c.glb`, clothingMaterialNames: ["Shirt", "Pants", "Details"], scale: 0.374, yawOffset: 0, walkClip: "Walk" },
];

/** CC-BY "Poly by Google" bicycle (credited in CREDITS.md); authored huge. */
const BICYCLE_MODEL = { url: `${C}/bicycle.glb`, scale: 0.005, yawOffset: 0 } as const;

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
  return {
    root,
    dispose() {
      if (disposed) return;
      disposed = true;
      walk?.dispose();
      root.dispose(false, false);
      for (const material of owned) material.dispose(true, false);
    },
  };
}

/**
 * A cyclist: the bicycle prop with a rider seated on it. The rider plays the
 * Sitting clip (no dedicated cycling clip ships CC0), so the pose is an
 * approximation — recognisably a person on a bike, a big step up from the
 * box+cylinder cyclist. Seat height/lean are tunable constants.
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

  bikeRoot.parent = root;
  bikeRoot.scaling.setAll(BICYCLE_MODEL.scale);
  bikeRoot.rotation.y = BICYCLE_MODEL.yawOffset;
  const bikeMaterials = convertMaterials(scene, `${name}-bike`, bikeRoot, new Set(), clothing);

  riderRoot.parent = root;
  riderRoot.scaling.setAll(riderConfig.scale);
  riderRoot.rotation.y = riderConfig.yawOffset;
  riderRoot.position.y = 0.92; // seat height (tunable)
  const riderMaterials = convertMaterials(
    scene,
    `${name}-rider`,
    riderRoot,
    new Set(riderConfig.clothingMaterialNames),
    clothing,
  );
  const sit = playClip(riderInstance.animationGroups, "Sitting", 1);

  addContactShadow(scene, name, root, 0.7, 1.7);

  let disposed = false;
  return {
    root,
    dispose() {
      if (disposed) return;
      disposed = true;
      sit?.dispose();
      root.dispose(false, false);
      for (const material of [...bikeMaterials, ...riderMaterials]) {
        material.dispose(true, false);
      }
    },
  };
}
