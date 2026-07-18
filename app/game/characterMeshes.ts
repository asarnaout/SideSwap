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
  modelHierarchyBounds,
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
  { url: `${C}/person-a.glb`, clothingMaterialNames: ["Shirt", "Pants"], scale: 0.374, yawOffset: Math.PI, walkClip: "Walk" },
  { url: `${C}/person-b.glb`, clothingMaterialNames: ["Shirt", "Shirt2", "Pants"], scale: 0.374, yawOffset: Math.PI, walkClip: "Walk" },
  { url: `${C}/person-c.glb`, clothingMaterialNames: ["Shirt", "Pants", "Details"], scale: 0.374, yawOffset: Math.PI, walkClip: "Walk" },
];

/** CC-BY "Carl out for a cruise" self-contained cyclist (rider + bike posed
 * correctly — hands on bars, feet on pedals), by Matt Connors; credited in
 * CREDITS.md. Authored near real-world scale. */
const CYCLIST_MODEL = { url: `${C}/cyclist.glb`, scale: 1.15, yawOffset: 0 } as const;

export function characterModelUrls(): string[] {
  return [...CHARACTER_MODELS.map((config) => config.url), CYCLIST_MODEL.url];
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
 * A cyclist built from the self-contained, correctly-posed "Carl" model (rider +
 * bike together — hands on the bars, feet on the pedals, leaning forward). Static
 * (no pedalling clip). Returns null when the model has not loaded.
 */
export function buildCyclistVisual(
  scene: Scene,
  parent: TransformNode,
  name: string,
  variant: number,
  clothing: Color3,
): CharacterVisual | null {
  void variant; // one shared cyclist model; no per-instance variety yet
  if (!isModelReady(scene, CYCLIST_MODEL.url)) return null;
  const instance = instantiateModel(scene, CYCLIST_MODEL.url);
  const modelRoot = instance?.rootNodes[0] as TransformNode | undefined;
  if (!instance || !modelRoot) return null;

  const root = new TransformNode(`${name}-cyclist`, scene);
  root.rotation.y = CYCLIST_MODEL.yawOffset;
  modelRoot.parent = root;
  modelRoot.scaling.setAll(CYCLIST_MODEL.scale);
  const owned = convertMaterials(scene, name, root, new Set(), clothing);

  // Ground the wheels to the road, then park the blob shadow under them.
  root.computeWorldMatrix(true);
  const bounds = modelHierarchyBounds(root);
  root.position.y = -bounds.min.y;
  root.parent = parent;
  const blob = MeshBuilder.CreateGround(
    `${name}-shadow`,
    { width: 0.8, height: 1.7 },
    scene,
  );
  blob.material = blobShadowMaterial(scene);
  blob.parent = root;
  blob.position.y = bounds.min.y + 0.01;
  blob.isPickable = false;
  blob.receiveShadows = false;

  let disposed = false;
  return {
    root,
    dispose() {
      if (disposed) return;
      disposed = true;
      root.dispose(false, false);
      for (const material of owned) material.dispose(true, false);
    },
  };
}
