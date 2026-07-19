import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { Material } from "@babylonjs/core";
import type { PlateRegion, VehicleAppearance } from "./vehicleVisuals";
import {
  instantiateModel,
  isModelReady,
  VEHICLE_MODEL_REGISTRY,
  type VehicleModelConfig,
} from "./modelLibrary";

/** Signals are expressed in vehicle space: -X is left and +X is right. */
export type VehicleMeshSignal = "left" | "right" | "off";

export interface VehicleMeshVisual {
  readonly root: TransformNode;
  /** Deliberately coarse: decorative meshes do not need a shadow-map pass. */
  readonly shadowCasters: readonly Mesh[];
  readonly leftIndicators: readonly Mesh[];
  readonly rightIndicators: readonly Mesh[];
  readonly brakeLights: readonly Mesh[];
  setSignal(signal: VehicleMeshSignal, blinkOn: boolean): void;
  setBraking(active: boolean): void;
  /** Hides small trim outside useful gameplay range without changing silhouette. */
  setDetailVisible(visible: boolean): void;
  /** Disposes only this visual's nodes and meshes; scene-cached materials survive. */
  dispose(): void;
}

// GameCanvas currently positions a moving vehicle parent at Y=.12 while the
// road top is approximately Y=.07. A local tire bottom of -.05 therefore sits
// on the road without changing any simulation coordinates.
const LOCAL_GROUND_Y = -0.05;

function parseColor(hex: string, fallback: string): Color3 {
  return Color3.FromHexString(/^#[\da-f]{6}$/i.test(hex) ? hex : fallback);
}

// Emissive glow for the small toggleable lamps the imported models lack, plus a
// resting/braking tail tint so brakes actually read on a modelled car.
const MODEL_TAIL_GLOW = new Color3(0.32, 0.03, 0.02);
const MODEL_BRAKE_GLOW = new Color3(0.95, 0.06, 0.03);
const MODEL_HEAD_GLOW = new Color3(0.5, 0.46, 0.3);

export function readAlbedo(material: Material): Color3 {
  if (material instanceof PBRMaterial) return material.albedoColor;
  if (material instanceof StandardMaterial) return material.diffuseColor;
  return Color3.White();
}

export function readAlbedoTexture(material: Material) {
  if (material instanceof PBRMaterial) return material.albedoTexture;
  if (material instanceof StandardMaterial) return material.diffuseTexture;
  return null;
}

/** World-space AABB of every mesh under a node (root is at the origin here, so
 * world extents equal local extents). Avoids relying on a hierarchy-bounds
 * helper that TransformNode may not expose. */
function modelHierarchyBounds(root: TransformNode): {
  min: Vector3;
  max: Vector3;
} {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const mesh of root.getChildMeshes(false)) {
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    min.minimizeInPlace(box.minimumWorld);
    max.maximizeInPlace(box.maximumWorld);
  }
  return { min, max };
}

const BLOB_SHADOW_BY_SCENE = new WeakMap<Scene, StandardMaterial>();

/**
 * Shared soft radial-gradient "blob" shadow material, used to ground vehicles
 * with a contact shadow directly beneath them. The dynamic sun shadow falls
 * offset from the body at a low angle, which reads as "floating" from the
 * top-down chase camera; the blob keeps the car grounded in every view. Cached
 * once per scene (one texture + material shared by the whole fleet).
 */
export function blobShadowMaterial(scene: Scene): StandardMaterial {
  const existing = BLOB_SHADOW_BY_SCENE.get(scene);
  if (existing) return existing;
  const size = 128;
  const texture = new DynamicTexture(
    "contact-shadow-texture",
    size,
    scene,
    false,
  );
  const context = texture.getContext();
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.06,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(0,0,0,0.5)");
  gradient.addColorStop(0.55, "rgba(0,0,0,0.26)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  texture.hasAlpha = true;
  texture.update();
  const material = new StandardMaterial("contact-shadow-material", scene);
  material.diffuseTexture = texture;
  material.useAlphaFromDiffuseTexture = true;
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.emissiveColor = Color3.Black();
  material.disableLighting = true;
  material.backFaceCulling = false;
  BLOB_SHADOW_BY_SCENE.set(scene, material);
  return material;
}

// --- Per-vehicle number plates ---------------------------------------------
//
// The imported models ship without plates, so buildModelVehicle synthesizes
// them. Each vehicle carries its own registration (appearance.plateNumber) in
// its country's design, drawn into a DynamicTexture that the vehicle owns and
// disposes with itself — so no two cars read the same plate, and live plate
// textures stay bounded to the active fleet. Kept bold and simple: a plate is
// only ever a few pixels tall on screen, so colour and layout carry the
// recognition, not fine text.

/** Plate silhouette aspect (width : height). Tuned to sit in the models'
 * moulded plate recess while reading as a plate rather than a sticker. */
const PLATE_ASPECT = 3.6;

/**
 * Creates a fresh plate material + texture for one vehicle. NOT cached across
 * vehicles (every car's number differs); the caller adds it to the instance's
 * owned materials so it disposes with the car.
 */
function createPlateMaterial(
  scene: Scene,
  region: PlateRegion,
  position: "front" | "rear",
  plateNumber: string,
): StandardMaterial {
  const height = 128;
  const width = Math.round(height * PLATE_ASPECT);
  const texture = new DynamicTexture(
    `plate-${region}-${position}`,
    { width, height },
    scene,
    true,
  );
  // The real backing context is a browser CanvasRenderingContext2D (this runs
  // only in-browser, since models never instantiate headlessly); Babylon's
  // narrower ICanvasRenderingContext type omits textAlign/textBaseline.
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  const sans = "Arial, 'Helvetica Neue', sans-serif";

  // Shrink the font until the text fits maxWidth, so no plate string overflows.
  const fitFont = (text: string, maxWidth: number, startPx: number, family: string) => {
    let size = startPx;
    ctx.font = `bold ${size}px ${family}`;
    while (ctx.measureText(text).width > maxWidth && size > 8) {
      size -= 2;
      ctx.font = `bold ${size}px ${family}`;
    }
  };
  const starRing = (cx: number, cy: number, radius: number) => {
    ctx.fillStyle = "#f6cf1c";
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, Math.max(1.6, radius * 0.18), 0, Math.PI * 2);
      ctx.fill();
    }
  };

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (region === "uk") {
    // White front plate, yellow rear plate — the authentic UK pairing.
    ctx.fillStyle = position === "rear" ? "#f4cb17" : "#eceee9";
    ctx.fillRect(0, 0, width, height);
    const band = Math.round(width * 0.13);
    ctx.fillStyle = "#0b3aa8";
    ctx.fillRect(0, 0, band, height);
    starRing(band / 2, height * 0.4, height * 0.14);
    ctx.fillStyle = "#ffffff";
    fitFont("UK", band * 0.82, Math.round(height * 0.2), sans);
    ctx.fillText("UK", band / 2, height * 0.76);
    ctx.fillStyle = "#161616";
    fitFont(plateNumber, width - band - width * 0.08, Math.round(height * 0.52), sans);
    ctx.fillText(plateNumber, band + (width - band) / 2, height * 0.54);
  } else if (region === "us") {
    // New York State: white ground, blue legend, gold accent.
    ctx.fillStyle = "#f5f5f1";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#123a7a";
    fitFont("NEW YORK", width * 0.66, Math.round(height * 0.2), sans);
    ctx.fillText("NEW YORK", width / 2, height * 0.18);
    fitFont(plateNumber, width * 0.86, Math.round(height * 0.46), sans);
    ctx.fillText(plateNumber, width / 2, height * 0.55);
    ctx.fillStyle = "#c1901c";
    fitFont("EMPIRE STATE", width * 0.5, Math.round(height * 0.12), sans);
    ctx.fillText("EMPIRE STATE", width / 2, height * 0.87);
  } else if (region === "fr") {
    // France: white ground, blue EU band left (F), blue département band right.
    ctx.fillStyle = "#f1f1ee";
    ctx.fillRect(0, 0, width, height);
    const band = Math.round(width * 0.1);
    ctx.fillStyle = "#0b3aa8";
    ctx.fillRect(0, 0, band, height);
    ctx.fillRect(width - band, 0, band, height);
    starRing(band / 2, height * 0.33, height * 0.12);
    ctx.fillStyle = "#ffffff";
    fitFont("F", band * 0.72, Math.round(height * 0.2), sans);
    ctx.fillText("F", band / 2, height * 0.74);
    fitFont("62", band * 0.72, Math.round(height * 0.18), sans);
    ctx.fillText("62", width - band / 2, height * 0.3);
    ctx.fillStyle = "#161616";
    fitFont(plateNumber, width - band * 2 - width * 0.08, Math.round(height * 0.46), sans);
    ctx.fillText(plateNumber, width / 2, height * 0.54);
  } else {
    // Japan: white ground, green legend (private car). Area line is fixed for
    // the map; plateNumber is the lower hiragana + serial line.
    const cjk = "'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', sans-serif";
    ctx.fillStyle = "#f4f4ee";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#0b7a3a";
    fitFont("世田谷 300", width * 0.66, Math.round(height * 0.28), cjk);
    ctx.fillText("世田谷 300", width / 2, height * 0.27);
    fitFont(plateNumber, width * 0.78, Math.round(height * 0.42), cjk);
    ctx.fillText(plateNumber, width / 2, height * 0.65);
  }

  const borderColor =
    region === "jp" ? "#0b7a3a" : region === "us" ? "#123a7a" : "#22262c";
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = Math.max(2, height * 0.045);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, width - ctx.lineWidth, height - ctx.lineWidth);

  texture.update();

  const material = new StandardMaterial(`plate-${region}-${position}-material`, scene);
  material.diffuseTexture = texture;
  // A little self-illumination keeps the plate legible when the car's tail is in
  // shadow (real plates are retroreflective), without tripping the bloom.
  material.emissiveTexture = texture;
  material.emissiveColor = new Color3(0.3, 0.3, 0.3);
  material.specularColor = new Color3(0.12, 0.12, 0.12);
  material.specularPower = 48;
  return material;
}

export interface PlatePlacement {
  /** Plate-box centre, in the model root's local (pre-yaw, pre-scale) space. */
  readonly position: Vector3;
  /** Local Y rotation for the plate box (see computePlatePlacements). */
  readonly rotationY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Front and rear number-plate transforms for a model, expressed in its root's
 * local (pre-yaw, pre-scale) space — the space the plate boxes are parented in.
 *
 * The catch is that the root is later spun by the model's `yawOffset`, so the
 * placement has to anticipate it. A front-first model (yawOffset 0) has its
 * front face on +Z and its width on X; the van imports front-along-+X
 * (yawOffset -90°), so its front face is on X and its width on Z. Deriving the
 * forward/lateral axes from `yawOffset` puts each plate on the true front/rear
 * face, centred and correctly sized, whatever the import orientation — without
 * it the van's plates land on the sides at mid-length (issue #55).
 *
 * Both plates then present the box's -Z face outward, because that is the face
 * whose default UVs render the texture upright once the glTF is in the scene
 * (the +Z face comes out rotated 180°). The rear sits at net-zero world yaw; the
 * front is turned a further 180° so its -Z face aims forward too. Exported for
 * unit testing.
 */
export function computePlatePlacements(
  bounds: { min: Vector3; max: Vector3 },
  yawOffset: number,
): { front: PlatePlacement; rear: PlatePlacement } {
  // Local axes that, after the root's yawOffset rotation, point world-forward
  // (+Z) and world-lateral (+X). yawOffset 0 ⇒ +Z / +X; the van's -90° ⇒ +X / -Z.
  const forward = new Vector3(-Math.sin(yawOffset), 0, Math.cos(yawOffset));
  const lateral = new Vector3(Math.cos(yawOffset), 0, Math.sin(yawOffset));
  const size = bounds.max.subtract(bounds.min);
  const center = bounds.min.add(bounds.max).scale(0.5);
  // forward/lateral are axis-aligned (yawOffset is a multiple of 90°), so these
  // dot-products just read off the relevant half-extent / extent of the AABB.
  const halfForward =
    (Math.abs(forward.x) * size.x + Math.abs(forward.z) * size.z) / 2;
  const lateralExtent =
    Math.abs(lateral.x) * size.x + Math.abs(lateral.z) * size.z;
  const width = lateralExtent * 0.28;
  const height = width / PLATE_ASPECT;
  const make = (
    sign: 1 | -1,
    heightFrac: number,
    rotationY: number,
  ): PlatePlacement => ({
    position: new Vector3(
      center.x + forward.x * halfForward * sign,
      bounds.min.y + size.y * heightFrac,
      center.z + forward.z * halfForward * sign,
    ),
    rotationY,
    width,
    height,
  });
  // The front recess sits lower than the rear on these models, so the front
  // plate drops below the rear rather than sharing one height.
  return {
    front: make(1, 0.3, Math.PI - yawOffset),
    rear: make(-1, 0.42, -yawOffset),
  };
}

/**
 * Builds a vehicle from a preloaded glb, honouring the same VehicleMeshVisual
 * contract as the procedural path. Returns null when no model is registered for
 * this appearance or its container has not loaded, so the caller falls back to
 * procedural geometry.
 *
 * Flow: instantiate independent clones -> convert each glTF material to a
 * scene-consistent StandardMaterial (recolouring the body to the paint colour,
 * giving head/tail lamps a gentle glow) -> synthesize the small toggleable
 * indicator + brake lamps the models omit -> normalise scale, facing and ground
 * contact so the model sits like the procedural cars it replaces.
 */
function buildModelVehicle(
  scene: Scene,
  parent: TransformNode,
  name: string,
  appearance: VehicleAppearance,
): VehicleMeshVisual | null {
  const config: VehicleModelConfig | undefined =
    VEHICLE_MODEL_REGISTRY[appearance.model];
  if (!config || !isModelReady(scene, config.url)) return null;
  const instance = instantiateModel(scene, config.url);
  const modelRoot = instance?.rootNodes[0];
  if (!modelRoot) return null;

  const root = new TransformNode(`${name}-model-root`, scene);
  modelRoot.parent = root;

  const paint = parseColor(appearance.paintHex, "#c9ccce");
  const bodyNames = new Set(config.bodyMaterialNames);
  const converted = new Map<Material, StandardMaterial>();
  const ownedMaterials: StandardMaterial[] = [];
  const taillightMaterials: StandardMaterial[] = [];
  const shadowCasters: Mesh[] = [];

  for (const mesh of root.getChildMeshes(false)) {
    if (!/wheel/i.test(mesh.name) && mesh instanceof Mesh) {
      shadowCasters.push(mesh);
    }
    const source = mesh.material;
    if (!source) continue;
    let standard = converted.get(source);
    if (!standard) {
      standard = new StandardMaterial(`${name}-${source.name}`, scene);
      const texture = readAlbedoTexture(source);
      if (texture) standard.diffuseTexture = texture;
      standard.diffuseColor = bodyNames.has(source.name)
        ? paint
        : texture
          ? Color3.White()
          : readAlbedo(source).clone();
      standard.specularColor = new Color3(0.22, 0.22, 0.22);
      standard.specularPower = 44;
      if (/headlight|front[_ ]?light/i.test(source.name)) {
        standard.emissiveColor = MODEL_HEAD_GLOW;
      } else if (/taillight|back[_ ]?light|rear[_ ]?light/i.test(source.name)) {
        standard.emissiveColor = MODEL_TAIL_GLOW;
        taillightMaterials.push(standard);
      }
      converted.set(source, standard);
      ownedMaterials.push(standard);
    }
    mesh.material = standard;
  }

  // Soft blob contact shadow directly under the car so it reads as grounded in
  // the top-down chase view. Anchored in the model's own (pre-scale) space just
  // above its lowest point, so it scales + moves with the car, sits on the road,
  // and disposes with it.
  root.computeWorldMatrix(true);
  const bounds = modelHierarchyBounds(root);
  const contactShadow = MeshBuilder.CreateGround(
    `${name}-contact-shadow`,
    {
      width: (bounds.max.x - bounds.min.x) * 1.18,
      height: (bounds.max.z - bounds.min.z) * 1.12,
    },
    scene,
  );
  contactShadow.material = blobShadowMaterial(scene);
  contactShadow.position.set(
    (bounds.min.x + bounds.max.x) / 2,
    bounds.min.y + 0.01,
    (bounds.min.z + bounds.max.z) / 2,
  );
  contactShadow.parent = root;
  contactShadow.isPickable = false;
  contactShadow.receiveShadows = false;

  // Synthesize the front + rear number plates the imported models omit, each
  // wearing this vehicle's own registration in its country's design. Authored in
  // the model's pre-scale space (like the contact shadow) and sized from its
  // bounds, so the plates land correctly whatever the model's dimensions,
  // config.scale or import orientation (see computePlatePlacements).
  const region = appearance.plateRegion;
  const rearPlateMaterial = createPlateMaterial(scene, region, "rear", appearance.plateNumber);
  // Front and rear differ only for the UK (white front / yellow rear); every
  // other region shares one texture across both plates.
  const frontPlateMaterial =
    region === "uk"
      ? createPlateMaterial(scene, region, "front", appearance.plateNumber)
      : rearPlateMaterial;
  const ownedPlateMaterials =
    frontPlateMaterial === rearPlateMaterial
      ? [rearPlateMaterial]
      : [rearPlateMaterial, frontPlateMaterial];
  const placements = computePlatePlacements(bounds, config.yawOffset);
  const plateThickness = placements.front.width * 0.045;
  const plateMeshes = (
    [
      ["front", placements.front, frontPlateMaterial],
      ["rear", placements.rear, rearPlateMaterial],
    ] as const
  ).map(([label, placement, material]) => {
    const plate = MeshBuilder.CreateBox(
      `${name}-number-plate-${label}`,
      { width: placement.width, height: placement.height, depth: plateThickness },
      scene,
    );
    plate.material = material;
    plate.position.copyFrom(placement.position);
    plate.rotation.y = placement.rotationY;
    plate.parent = root;
    plate.isPickable = false;
    plate.receiveShadows = false;
    return plate;
  });

  // Normalise scale, facing and ground contact (lowest point at LOCAL_GROUND_Y).
  root.scaling.setAll(config.scale);
  root.rotation.y = config.yawOffset;
  root.computeWorldMatrix(true);
  const scaled = modelHierarchyBounds(root);
  root.position.y = LOCAL_GROUND_Y - scaled.min.y;
  root.parent = parent;

  let disposed = false;
  let detailVisible = true;
  return {
    root,
    shadowCasters,
    leftIndicators: [],
    rightIndicators: [],
    brakeLights: [],
    setSignal() {
      // Imported models have no separate indicator geometry, and their single
      // tail-lamp material can't blink one side; the player's signal state is
      // shown in the HUD. (A later pass could add modelled corner blinkers.)
    },
    setBraking(active) {
      if (disposed) return;
      // No toggleable brake mesh on the models — brighten their own tail-lamp
      // material instead, which reads as real brake lights.
      for (const material of taillightMaterials) {
        material.emissiveColor = active ? MODEL_BRAKE_GLOW : MODEL_TAIL_GLOW;
      }
    },
    setDetailVisible(visible) {
      // The synthesized number plates are the model's only removable trim; cull
      // them past the LOD distance, matching the procedural cars.
      if (disposed || detailVisible === visible) return;
      detailVisible = visible;
      for (const plate of plateMeshes) plate.setEnabled(visible);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // Keep the shared source materials/textures (owned by the container);
      // dispose only this instance's geometry and the materials we created.
      root.dispose(false, false);
      for (const material of ownedMaterials) material.dispose(true, false);
      // The plate materials own per-vehicle DynamicTextures, so dispose those
      // textures too (unlike the glTF materials, whose textures are shared).
      for (const material of ownedPlateMaterials) material.dispose(true, true);
    },
  };
}

/**
 * Builds a vehicle visual for `appearance`, always from an imported glb model.
 * Resolution order: the appearance's own model; then, for the London
 * double-decker in a build lacking its (purchased, gitignored) asset, the
 * committed single-deck city bus recoloured to the same London red; then an
 * empty placeholder while models are still preloading. The loading gate keeps
 * that placeholder off-screen, and every vehicle rebuilds once preload settles,
 * so it only exists for that brief window. There is no procedural fallback.
 */
export function createVehicleMesh(
  scene: Scene,
  parent: TransformNode,
  name: string,
  appearance: VehicleAppearance,
): VehicleMeshVisual {
  const modelVisual = buildModelVehicle(scene, parent, name, appearance);
  if (modelVisual) return modelVisual;
  if (appearance.model === "london-double-decker") {
    // No double-decker asset in this build (e.g. a public clone) → stand in with
    // the committed single-deck bus, recoloured to the same London red.
    const busVisual = buildModelVehicle(scene, parent, name, {
      ...appearance,
      model: "city-bus",
    });
    if (busVisual) return busVisual;
  }
  return emptyVehicleVisual(scene, parent, name);
}

/**
 * A no-op visual — an empty root with inert controls — used only while the
 * imported models are still preloading (hidden behind the loading gate) and
 * replaced the instant they finish. The models are the only vehicle art.
 */
function emptyVehicleVisual(
  scene: Scene,
  parent: TransformNode,
  name: string,
): VehicleMeshVisual {
  const root = new TransformNode(`${name}-pending`, scene);
  root.parent = parent;
  let disposed = false;
  return {
    root,
    shadowCasters: [],
    leftIndicators: [],
    rightIndicators: [],
    brakeLights: [],
    setSignal() {},
    setBraking() {},
    setDetailVisible() {},
    dispose() {
      if (disposed) return;
      disposed = true;
      root.dispose(false, false);
    },
  };
}
