/**
 * The ambient crowd's body: every walker the simulation drives is drawn as a
 * thin instance of one of the shared character models, with the walk cycle
 * baked into a Vertex Animation Texture so animation runs entirely on the
 * GPU. Three skinned clones (one per model) carry the whole crowd — versus
 * the clone-per-pedestrian pipeline this replaces, which spent five meshes
 * and five materials on every single walker.
 *
 * The stock VertexAnimationBaker can't sample glTF clips (it drives
 * scene.beginAnimation on the skeleton, but glTF animation groups target
 * linked TransformNodes), so the bake below steps the Walk group frame by
 * frame through skeleton.prepare() instead. All per-frame arithmetic lives in
 * crowdRenderMath, which pins the matrix conventions under unit test.
 */
import {
  BakedVertexAnimationManager,
  Color3,
  type Material,
  Matrix,
  type Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  ToHalfFloat,
  TransformNode,
  VertexAnimationBaker,
} from "@babylonjs/core";
import { CHARACTER_MODELS } from "./characterMeshes";
import type { CrowdWalker } from "./crowdWalkers";
import {
  composeYawTranslation16,
  conjugatePose,
  partitionWalkersByVariant,
  rebaseVatOffset,
} from "./crowdRenderMath";
import { instantiateModel, isModelReady } from "./modelLibrary";
import { blobShadowMaterial, readAlbedo } from "./vehicleMeshes";

/** Foot level of the old clone pedestrians, kept so nothing sinks or floats. */
const WALKER_Y = 0.08;
/** Above the sidewalk strip (0.045) and the junction fill (0.0716). */
const SHADOW_Y = 0.1;
/** The Walk clip's natural ground speed at speedRatio 1 (see GameCanvas's
 * clone pipeline, which uses the same divisor to cut foot-sliding). */
const WALK_CLIP_NATURAL_MPS = 1.4;
/** glTF clips are keyed on a 60-frames-per-second timeline. */
const CLIP_FPS = 60;
const PAUSED_CADENCE = 0.25;

interface CrowdModelBundle {
  readonly root: TransformNode;
  readonly parts: Mesh[];
  readonly ownedMaterials: StandardMaterial[];
  readonly manager: BakedVertexAnimationManager;
  readonly frames: number;
  readonly w0: Float32Array;
  readonly w0Inverse: Float32Array;
  /** Walker indices this model draws; fixed for the renderer's life. */
  readonly indices: readonly number[];
  readonly matrixData: Float32Array;
  readonly vatData: Float32Array;
  vatDirty: boolean;
}

export interface CrowdTint {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export class CrowdRenderer {
  private readonly scene: Scene;
  private bundles: CrowdModelBundle[] = [];
  private shadow: Mesh | null = null;
  private shadowData: Float32Array | null = null;
  private built = false;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /** Total thin instances drawn (0 until built). */
  get instanceCount(): number {
    return this.bundles.reduce((total, bundle) => total + bundle.indices.length, 0);
  }

  /** Meshes carrying the whole crowd (character parts + the shadow quad). */
  get meshCount(): number {
    return this.bundles.reduce((total, bundle) => total + bundle.parts.length, 0) +
      (this.shadow ? 1 : 0);
  }

  get modelCounts(): number[] {
    return this.bundles.map((bundle) => bundle.indices.length);
  }

  get vatTime(): number {
    return this.bundles[0]?.manager.time ?? 0;
  }

  /**
   * Bakes each character model's Walk clip and stands up the thin-instanced
   * meshes. Returns false — leaving the scene untouched — when any model or
   * its bake is unusable; the game then simply has no ambient crowd, which
   * beats a crowd of frozen mannequins.
   */
  build(walkers: readonly CrowdWalker[], tints: readonly CrowdTint[]): boolean {
    if (this.built || !walkers.length) return false;
    const partition = partitionWalkersByVariant(
      walkers.map((walker) => walker.variant),
      CHARACTER_MODELS.length,
    );
    const bundles: CrowdModelBundle[] = [];
    for (const [modelIndex, indices] of partition.entries()) {
      if (!indices.length) continue;
      const bundle = this.buildModel(modelIndex, indices, walkers, tints);
      if (!bundle) {
        for (const built of bundles) this.disposeBundle(built);
        return false;
      }
      bundles.push(bundle);
    }
    if (!bundles.length) return false;
    this.bundles = bundles;

    const shadow = MeshBuilder.CreateGround(
      "crowd-shadow",
      { width: 0.62, height: 0.5 },
      this.scene,
    );
    shadow.material = blobShadowMaterial(this.scene);
    shadow.isPickable = false;
    shadow.alwaysSelectAsActiveMesh = true;
    shadow.doNotSyncBoundingInfo = true;
    shadow.receiveShadows = false;
    this.shadowData = new Float32Array(walkers.length * 16);
    shadow.thinInstanceSetBuffer("matrix", this.shadowData, 16, false);
    this.shadow = shadow;
    this.built = true;
    this.writeFrame(walkers);
    return true;
  }

  private buildModel(
    modelIndex: number,
    indices: readonly number[],
    walkers: readonly CrowdWalker[],
    tints: readonly CrowdTint[],
  ): CrowdModelBundle | null {
    const config = CHARACTER_MODELS[modelIndex % CHARACTER_MODELS.length];
    if (!isModelReady(this.scene, config.url)) return null;
    const entries = instantiateModel(this.scene, config.url);
    const modelRoot = entries?.rootNodes[0] as TransformNode | undefined;
    if (!entries || !modelRoot) return null;
    const cleanup = () => {
      for (const group of entries.animationGroups) group.dispose();
      modelRoot.dispose(false, false);
    };
    const skeleton = entries.skeletons[0];
    const walkPattern = new RegExp(config.walkClip, "i");
    const walk = entries.animationGroups.find((group) => walkPattern.test(group.name));
    const parts = modelRoot
      .getChildMeshes(false)
      .filter((mesh): mesh is Mesh => !!mesh.skeleton);
    if (!skeleton || !walk || !parts.length) {
      cleanup();
      return null;
    }

    const root = new TransformNode(`crowd-model-${modelIndex}`, this.scene);
    root.rotation.y = config.yawOffset;
    modelRoot.parent = root;
    modelRoot.scaling.setAll(config.scale);

    // Bake: step the glTF Walk group frame by frame; skeleton.prepare(true)
    // copies each frame's linked-node TRS into the bones.
    const frames = Math.max(2, Math.floor(walk.to - walk.from) + 1);
    walk.start(true, 1, walk.from, walk.to, false);
    walk.pause();
    const stride = skeleton.getTransformMatrices(parts[0]).length;
    const data = new Float32Array(stride * frames);
    for (let frame = 0; frame < frames; frame += 1) {
      walk.goToFrame(walk.from + frame);
      skeleton.prepare(true);
      data.set(skeleton.getTransformMatrices(parts[0]), frame * stride);
    }
    for (const group of entries.animationGroups) group.dispose();
    // A silent bake failure yields identical frames; refuse to ship a crowd
    // of gliding mannequins.
    let variance = 0;
    const middle = Math.floor(frames / 2) * stride;
    for (let index = 0; index < stride; index += 1) {
      variance = Math.max(variance, Math.abs(data[index] - data[middle + index]));
    }
    if (variance < 1e-4) {
      console.warn(`[crowd] VAT bake produced no motion for ${config.url}`);
      modelRoot.dispose(false, false);
      root.dispose(false, false);
      return null;
    }

    const baker = new VertexAnimationBaker(this.scene, skeleton);
    const texture = this.scene.getEngine().getCaps().textureFloat
      ? baker.textureFromBakedVertexData(data)
      : baker.textureFromBakedVertexData(
          Uint16Array.from({ length: data.length }, (_, index) => ToHalfFloat(data[index])),
        );
    const manager = new BakedVertexAnimationManager(this.scene);
    manager.texture = texture;
    manager.setAnimationParameters(0, frames - 1, 0, CLIP_FPS);

    // Shared materials: clothing goes white and takes the per-instance tint
    // (thin-instance "color" multiplies diffuse); skin/hair/eyes keep their
    // albedo. This is the recolour-per-pedestrian scheme without the
    // material-per-pedestrian cost.
    const clothingNames = new Set(config.clothingMaterialNames);
    const converted = new Map<Material, StandardMaterial>();
    const ownedMaterials: StandardMaterial[] = [];
    const clothingParts = new Set<Mesh>();
    for (const part of parts) {
      const source = part.material;
      if (source) {
        const isClothing = clothingNames.has(source.name);
        let standard = converted.get(source);
        if (!standard) {
          standard = new StandardMaterial(
            `crowd-${modelIndex}-${source.name}`,
            this.scene,
          );
          standard.diffuseColor = isClothing ? Color3.White() : readAlbedo(source).clone();
          standard.specularColor = new Color3(0.05, 0.05, 0.05);
          standard.specularPower = 32;
          converted.set(source, standard);
          ownedMaterials.push(standard);
        }
        part.material = standard;
        if (isClothing) clothingParts.add(part);
      }
      part.bakedVertexAnimationManager = manager;
      part.isPickable = false;
      part.alwaysSelectAsActiveMesh = true;
      part.doNotSyncBoundingInfo = true;
      part.receiveShadows = false;
    }

    // The conjugation in crowdRenderMath assumes every part shares one world
    // matrix (they are primitives of a single skinned mesh). Verify rather
    // than assume: a model breaking that ships no crowd, not a scrambled one.
    root.computeWorldMatrix(true);
    for (const part of parts) part.computeWorldMatrix(true);
    const w0Matrix = parts[0].getWorldMatrix();
    for (const part of parts.slice(1)) {
      const m = part.getWorldMatrix().m;
      for (let index = 0; index < 16; index += 1) {
        if (Math.abs(m[index] - w0Matrix.m[index]) > 1e-4) {
          console.warn(`[crowd] part transforms diverge in ${config.url}`);
          manager.dispose(true);
          for (const material of ownedMaterials) material.dispose(true, false);
          modelRoot.dispose(false, false);
          root.dispose(false, false);
          return null;
        }
      }
    }
    for (const part of parts) part.freezeWorldMatrix();
    const w0 = Float32Array.from(w0Matrix.m);
    const w0Inverse = Float32Array.from(Matrix.Invert(w0Matrix).m);

    const count = indices.length;
    const matrixData = new Float32Array(count * 16);
    const vatData = new Float32Array(count * 4);
    const tintData = new Float32Array(count * 4);
    for (const [slot, walkerIndex] of indices.entries()) {
      vatData[slot * 4] = 0;
      vatData[slot * 4 + 1] = frames - 1;
      // Spread start phases so the crowd never marches in step.
      vatData[slot * 4 + 2] = (walkerIndex * 7.31) % frames;
      vatData[slot * 4 + 3] = 0;
      const tint = tints[walkers[walkerIndex].tintIndex % tints.length];
      tintData[slot * 4] = tint.r;
      tintData[slot * 4 + 1] = tint.g;
      tintData[slot * 4 + 2] = tint.b;
      tintData[slot * 4 + 3] = 1;
    }
    for (const part of parts) {
      part.thinInstanceSetBuffer("matrix", matrixData, 16, false);
      part.thinInstanceSetBuffer(
        "bakedVertexAnimationSettingsInstanced",
        vatData,
        4,
        false,
      );
      if (clothingParts.has(part)) {
        part.thinInstanceSetBuffer("color", tintData, 4, false);
      }
    }

    return {
      root,
      parts,
      ownedMaterials,
      manager,
      frames,
      w0,
      w0Inverse,
      indices,
      matrixData,
      vatData,
      vatDirty: true,
    };
  }

  /** Advances every model's walk-cycle clock; freeze by not calling it. */
  advanceTime(seconds: number): void {
    for (const bundle of this.bundles) bundle.manager.time += seconds;
  }

  /** Pushes the walkers' poses (and any cadence changes) to the GPU. */
  writeFrame(walkers: readonly CrowdWalker[]): void {
    if (!this.built) return;
    for (const bundle of this.bundles) {
      for (const [slot, walkerIndex] of bundle.indices.entries()) {
        const walker = walkers[walkerIndex];
        conjugatePose(
          bundle.matrixData,
          slot,
          bundle.w0,
          bundle.w0Inverse,
          walker.x,
          WALKER_Y,
          walker.z,
          walker.headingRad,
        );
        const cadence =
          CLIP_FPS * clamp(walker.speedMps / WALK_CLIP_NATURAL_MPS, 0.5, 1.6);
        const fps = walker.state === "pause" ? cadence * PAUSED_CADENCE : cadence;
        const fpsIndex = slot * 4 + 3;
        if (Math.abs(bundle.vatData[fpsIndex] - fps) > 1e-3) {
          // Re-anchor the phase so the visible frame never snaps when a
          // walker pauses, resumes, or is recycled at a new pace.
          bundle.vatData[slot * 4 + 2] = rebaseVatOffset(
            bundle.manager.time,
            bundle.vatData[fpsIndex],
            fps,
            bundle.vatData[slot * 4 + 2],
            bundle.frames,
          );
          bundle.vatData[fpsIndex] = fps;
          bundle.vatDirty = true;
        }
      }
      for (const part of bundle.parts) {
        part.thinInstanceBufferUpdated("matrix");
        if (bundle.vatDirty) {
          part.thinInstanceBufferUpdated("bakedVertexAnimationSettingsInstanced");
        }
      }
      bundle.vatDirty = false;
    }
    if (this.shadow && this.shadowData) {
      for (const [index, walker] of walkers.entries()) {
        composeYawTranslation16(
          this.shadowData,
          index * 16,
          walker.x,
          SHADOW_Y,
          walker.z,
          walker.headingRad,
        );
      }
      this.shadow.thinInstanceBufferUpdated("matrix");
    }
  }

  private disposeBundle(bundle: CrowdModelBundle): void {
    bundle.manager.dispose(true);
    for (const material of bundle.ownedMaterials) material.dispose(true, false);
    bundle.root.dispose(false, false);
  }

  dispose(): void {
    for (const bundle of this.bundles) this.disposeBundle(bundle);
    this.bundles = [];
    this.shadow?.dispose(false, false);
    this.shadow = null;
    this.shadowData = null;
    this.built = false;
  }
}
