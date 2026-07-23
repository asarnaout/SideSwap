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
import type {
  PlateRegion,
  PoliceLivery,
  VehicleAppearance,
} from "./vehicleVisuals";
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
  /**
   * Drives a patrol car's roof light bar; `red`/`blue` are 0..1 lamp brightness
   * (see policeBeaconLamps). A no-op on every vehicle without a light bar.
   */
  setBeacon(red: number, blue: number): void;
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
// Amber turn-indicator lens; emissive so a blink reads against the night palette.
const MODEL_INDICATOR_AMBER = new Color3(1.0, 0.5, 0.05);

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

// --- Turn-signal tail lamps -------------------------------------------------
//
// The imported car bodies carry one shared "TailLights" material across both
// lenses (verified in the glbs), so nothing can brighten a single side. To make
// a turn signal blink one flank again — signals stopped flashing when the
// procedural cars that had real per-side lamps were deleted (issue #31) — a thin
// amber panel is laid over each lens half and setSignal flashes the signalling
// one. The split runs along the axis that becomes world-lateral after the
// model's yawOffset, the same yaw-anticipating trick the plates use.

/** Amber flash panel over one tail-lamp half, in the root's pre-yaw/pre-scale space. */
export interface TailLampPanel {
  readonly position: Vector3;
  /** Box width (x) / height (y) / depth (z). */
  readonly size: Vector3;
  readonly side: "left" | "right";
}

/**
 * Splits a car's measured tail-lamp bounds into a left and a right flash panel.
 * Each covers ~44% of the lamp width (leaving the centre gap dark), the full
 * height, and a little more than the lamp depth so the flash sits proud of the
 * lens. "right" is the driver's right (world +X after the model's yaw), matching
 * the "-X is left, +X is right" signal convention. Exported for unit testing.
 */
export function computeTailLampPanels(
  tailBounds: { min: Vector3; max: Vector3 },
  yawOffset: number,
): readonly TailLampPanel[] {
  const forward = new Vector3(-Math.sin(yawOffset), 0, Math.cos(yawOffset));
  const lateral = new Vector3(Math.cos(yawOffset), 0, Math.sin(yawOffset));
  const size = tailBounds.max.subtract(tailBounds.min);
  const center = tailBounds.min.add(tailBounds.max).scale(0.5);
  const lateralExtent =
    Math.abs(lateral.x) * size.x + Math.abs(lateral.z) * size.z;
  const forwardExtent =
    Math.abs(forward.x) * size.x + Math.abs(forward.z) * size.z;
  // yawOffset is a multiple of 90°, so lateral is exactly ±X or ±Z; size the
  // axis-aligned box per axis rather than rotating it.
  const lateralIsX = Math.abs(lateral.x) >= Math.abs(lateral.z);
  const boxSize = lateralIsX
    ? new Vector3(lateralExtent * 0.44, size.y * 1.05, forwardExtent * 1.3)
    : new Vector3(forwardExtent * 1.3, size.y * 1.05, lateralExtent * 0.44);
  const make = (side: "left" | "right"): TailLampPanel => ({
    position: center.add(
      lateral.scale((lateralExtent / 4) * (side === "right" ? 1 : -1)),
    ),
    size: boxSize,
    side,
  });
  return [make("left"), make("right")];
}

// --- Patrol-car light bar + livery -----------------------------------------
//
// Both are synthesized from the model's own measured geometry, in the same
// pre-yaw/pre-scale space as the plates and contact shadow. The bar used to be
// bolted to the NPC's parent node at a hard-coded Y of 1.5m, which floated it
// 0.19-0.35m above a sedan's roof and sank it 0.10-0.15m into an SUV's (issue
// #117): every model has a different roof height, so the only correct anchor is
// the measured one.

/** Vertical slice, below the highest point, treated as the flat roof panel. */
const ROOF_PAD_BAND_M = 0.05;
/** Fraction of the roof panel's width the bar spans. */
const LIGHT_BAR_WIDTH_FRACTION = 0.84;
const LIGHT_BAR_MAX_DEPTH_M = 0.24;
/** Gap between the bar's rear face and the back of the roof panel. */
const LIGHT_BAR_FRONT_INSET_M = 0.04;
const LIGHT_BAR_BASE_HEIGHT_M = 0.038;
const LIGHT_BAR_LENS_HEIGHT_M = 0.072;

/** The flat top panel of a body, in the model root's local space. */
export interface RoofPad {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Highest point of the model — where a roof-mounted part rests. */
  readonly topY: number;
}

/** Runs `visit` over every vertex of `root`'s meshes, in `root`'s local space. */
function forEachModelVertex(
  root: TransformNode,
  visit: (x: number, y: number, z: number) => void,
  skipWheels = false,
) {
  const point = new Vector3();
  for (const mesh of root.getChildMeshes(false)) {
    if (skipWheels && /wheel/i.test(mesh.name)) continue;
    const positions = mesh.getVerticesData("position");
    if (!positions) continue;
    const matrix = mesh.computeWorldMatrix(true);
    for (let index = 0; index < positions.length; index += 3) {
      point.set(positions[index], positions[index + 1], positions[index + 2]);
      Vector3.TransformCoordinatesToRef(point, matrix, point);
      visit(point.x, point.y, point.z);
    }
  }
}

/**
 * Measures the flat panel at the top of a body: the footprint of every vertex
 * within ROOF_PAD_BAND_M of the model's highest point. That is the surface a
 * light bar actually rests on, and it differs per model both in height and in
 * where it sits along the car (a sedan's roof straddles the centre; an SUV's
 * runs from the middle to the tailgate). Falls back to the whole bounding box
 * if a model somehow has no vertices near its top.
 */
export function measureRoofPad(
  root: TransformNode,
  bounds: { min: Vector3; max: Vector3 },
): RoofPad {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const threshold = bounds.max.y - ROOF_PAD_BAND_M;
  forEachModelVertex(root, (x, y, z) => {
    if (y < threshold) return;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  });
  if (minX > maxX || minZ > maxZ) {
    return {
      minX: bounds.min.x,
      maxX: bounds.max.x,
      minZ: bounds.min.z,
      maxZ: bounds.max.z,
      topY: bounds.max.y,
    };
  }
  return { minX, maxX, minZ, maxZ, topY: bounds.max.y };
}

export interface LightBarPlacement {
  /**
   * Centre of the bar's *base*, in the model root's local space — so
   * `position.y` is exactly the roof height and the bar stacks upward from it.
   */
  readonly position: Vector3;
  readonly rotationY: number;
  /** Across the car. */
  readonly width: number;
  /** Along the car. */
  readonly depth: number;
  readonly height: number;
}

/**
 * Seats a light bar on the front of a measured roof panel. Like the plates, this
 * anticipates the root's later `yawOffset` spin so the bar runs across the car
 * whatever orientation the model imported in. Exported for unit testing.
 */
export function computeLightBarPlacement(
  pad: RoofPad,
  yawOffset: number,
): LightBarPlacement {
  const forward = new Vector3(-Math.sin(yawOffset), 0, Math.cos(yawOffset));
  const lateral = new Vector3(Math.cos(yawOffset), 0, Math.sin(yawOffset));
  const spanX = pad.maxX - pad.minX;
  const spanZ = pad.maxZ - pad.minZ;
  const forwardExtent =
    Math.abs(forward.x) * spanX + Math.abs(forward.z) * spanZ;
  const lateralExtent =
    Math.abs(lateral.x) * spanX + Math.abs(lateral.z) * spanZ;
  const width = lateralExtent * LIGHT_BAR_WIDTH_FRACTION;
  const depth = Math.min(LIGHT_BAR_MAX_DEPTH_M, forwardExtent * 0.4);
  // Sit against the leading edge of the roof panel, just behind the windscreen
  // header, rather than at the panel's centre.
  const offset = Math.max(
    0,
    forwardExtent / 2 - depth / 2 - LIGHT_BAR_FRONT_INSET_M,
  );
  const centerX = (pad.minX + pad.maxX) / 2;
  const centerZ = (pad.minZ + pad.maxZ) / 2;
  return {
    position: new Vector3(
      centerX + forward.x * offset,
      pad.topY,
      centerZ + forward.z * offset,
    ),
    // Cancels the root's yaw so the bar's own +X runs across the car.
    rotationY: -yawOffset,
    width,
    depth,
    height: LIGHT_BAR_BASE_HEIGHT_M + LIGHT_BAR_LENS_HEIGHT_M,
  };
}

/** Belt-band of the body (as fractions of its height) that markings sit in. */
const LIVERY_BAND_LOW = 0.33;
const LIVERY_BAND_HIGH = 0.63;
/** Fraction of the car's length the door panel covers. */
const LIVERY_LENGTH_FRACTION = 0.44;
/** Nudge forward from the centre, so the panel lands on the doors. */
const LIVERY_FORWARD_BIAS = 0.05;
/** Stand-off from the measured door skin, so the decal never sinks into it. */
const LIVERY_PROUD_M = 0.006;

export interface LiveryPanelPlacement {
  readonly position: Vector3;
  readonly rotationY: number;
  /** Along the car. */
  readonly length: number;
  readonly height: number;
}

/**
 * Door-panel decal transforms for both flanks, in the model root's local space.
 *
 * The lateral offset is *measured* from the door skin rather than taken from the
 * bounding box: the box half-width includes the mirrors, so a panel placed on it
 * would hang off the doors in mid-air. Vertices are sampled only inside the belt
 * band and the middle of the wheelbase, which is the flat part of these bodies
 * (measured spread there is under 2cm on every passenger model).
 */
export function computeLiveryPanels(
  root: TransformNode,
  bounds: { min: Vector3; max: Vector3 },
  yawOffset: number,
): { left: LiveryPanelPlacement; right: LiveryPanelPlacement } {
  const forward = new Vector3(-Math.sin(yawOffset), 0, Math.cos(yawOffset));
  const lateral = new Vector3(Math.cos(yawOffset), 0, Math.sin(yawOffset));
  const size = bounds.max.subtract(bounds.min);
  const center = bounds.min.add(bounds.max).scale(0.5);
  const forwardExtent =
    Math.abs(forward.x) * size.x + Math.abs(forward.z) * size.z;
  const lateralExtent =
    Math.abs(lateral.x) * size.x + Math.abs(lateral.z) * size.z;

  const length = forwardExtent * LIVERY_LENGTH_FRACTION;
  const forwardCenter = forwardExtent * LIVERY_FORWARD_BIAS;
  const lowY = bounds.min.y + size.y * LIVERY_BAND_LOW;
  const highY = bounds.min.y + size.y * LIVERY_BAND_HIGH;

  // Measure the door skin across exactly the span the panel will cover.
  let skin = 0;
  forEachModelVertex(
    root,
    (x, y, z) => {
      if (y < lowY || y > highY) return;
      const along = (x - center.x) * forward.x + (z - center.z) * forward.z;
      if (Math.abs(along - forwardCenter) > length / 2) return;
      const across = Math.abs(
        (x - center.x) * lateral.x + (z - center.z) * lateral.z,
      );
      if (across > skin) skin = across;
    },
    true,
  );
  // A model with no vertices in the band still gets a plausible panel.
  if (skin <= 0) skin = (lateralExtent / 2) * 0.93;
  const offset = skin + LIVERY_PROUD_M;

  const make = (side: 1 | -1): LiveryPanelPlacement => ({
    position: new Vector3(
      center.x + forward.x * forwardCenter + lateral.x * offset * side,
      (lowY + highY) / 2,
      center.z + forward.z * forwardCenter + lateral.z * offset * side,
    ),
    // Present the box's -Z face outward on each flank — the face whose default
    // UVs render a DynamicTexture upright (the +Z face comes out rotated 180°,
    // as the plates discovered, which mirrors the lettering *and* flips it).
    // Babylon's left-handed yaw sends local -Z to (-sin θ, 0, -cos θ), so the
    // right flank (+lateral) needs -90° and the left flank +90°.
    rotationY: (side === 1 ? -Math.PI / 2 : Math.PI / 2) - yawOffset,
    length,
    height: size.y * (LIVERY_BAND_HIGH - LIVERY_BAND_LOW),
  });
  return { left: make(-1), right: make(1) };
}

const LIVERY_DECALS_BY_SCENE = new WeakMap<
  Scene,
  Map<string, StandardMaterial>
>();

/**
 * The force's flank markings, drawn once per scene and shared by every patrol
 * car on the map (unlike plates, a fleet's livery is identical by definition).
 * Transparent everywhere the body paint should show through.
 */
function liveryDecalMaterial(
  scene: Scene,
  livery: PoliceLivery,
): StandardMaterial {
  let cache = LIVERY_DECALS_BY_SCENE.get(scene);
  if (!cache) {
    cache = new Map();
    LIVERY_DECALS_BY_SCENE.set(scene, cache);
  }
  const existing = cache.get(livery.force);
  if (existing) return existing;

  const height = 128;
  const width = height * 4;
  const texture = new DynamicTexture(
    `livery-${livery.force}`,
    { width, height },
    scene,
    true,
  );
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  const sans = "Arial, 'Helvetica Neue', sans-serif";
  ctx.clearRect(0, 0, width, height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fitFont = (text: string, maxWidth: number, startPx: number) => {
    let size = startPx;
    ctx.font = `bold ${size}px ${sans}`;
    while (ctx.measureText(text).width > maxWidth && size > 8) {
      size -= 2;
      ctx.font = `bold ${size}px ${sans}`;
    }
  };

  if (livery.style === "battenburg") {
    // Two rows of alternating squares over the lower half, "POLICE" above them.
    const rows = 2;
    const cell = height * 0.28;
    const columns = Math.ceil(width / cell);
    const top = height - rows * cell;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        ctx.fillStyle =
          (row + column) % 2 === 0 ? livery.markingHex : livery.secondaryHex;
        ctx.fillRect(column * cell, top + row * cell, cell, cell);
      }
    }
    ctx.fillStyle = livery.letteringHex;
    fitFont(livery.lettering, width * 0.42, Math.round(height * 0.34));
    ctx.fillText(livery.lettering, width / 2, top * 0.52);
  } else if (livery.style === "half-black") {
    // Japanese 白黒: the body's lower half blacked out, word mark on the white.
    ctx.fillStyle = livery.markingHex;
    ctx.fillRect(0, height * 0.46, width, height * 0.54);
    ctx.fillStyle = livery.letteringHex;
    fitFont(livery.lettering, width * 0.4, Math.round(height * 0.3));
    ctx.fillText(livery.lettering, width / 2, height * 0.72);
  } else {
    // One belt stripe with the force's word mark riding above it.
    ctx.fillStyle = livery.markingHex;
    ctx.fillRect(0, height * 0.62, width, height * 0.24);
    ctx.fillStyle = livery.secondaryHex;
    ctx.fillRect(0, height * 0.86, width, height * 0.07);
    ctx.fillStyle = livery.letteringHex;
    fitFont(livery.lettering, width * 0.46, Math.round(height * 0.42));
    ctx.fillText(livery.lettering, width / 2, height * 0.32);
  }
  texture.update();
  texture.hasAlpha = true;

  const material = new StandardMaterial(`livery-${livery.force}-material`, scene);
  material.diffuseTexture = texture;
  material.useAlphaFromDiffuseTexture = true;
  material.specularColor = new Color3(0.14, 0.14, 0.14);
  material.specularPower = 46;
  // Retroreflective markings stay readable when the car is in shadow, which on
  // the night maps is most of the time.
  material.emissiveTexture = texture;
  material.emissiveColor = new Color3(0.22, 0.22, 0.22);
  cache.set(livery.force, material);
  return material;
}

/**
 * Bolts the patrol light bar onto the roof and the force's markings onto both
 * doors. Returns the per-vehicle lamp handles `setBeacon` drives, plus the
 * materials this vehicle owns and must dispose.
 */
function attachPoliceKit(
  scene: Scene,
  root: TransformNode,
  name: string,
  bounds: { min: Vector3; max: Vector3 },
  yawOffset: number,
  livery: PoliceLivery,
): {
  setBeacon: (red: number, blue: number) => void;
  materials: StandardMaterial[];
} {
  const placement = computeLightBarPlacement(measureRoofPad(root, bounds), yawOffset);
  const bar = new TransformNode(`${name}-light-bar`, scene);
  bar.parent = root;
  bar.position.copyFrom(placement.position);
  bar.rotation.y = placement.rotationY;

  const housing = new StandardMaterial(`${name}-light-bar-housing`, scene);
  housing.diffuseColor = new Color3(0.09, 0.1, 0.12);
  housing.specularColor = new Color3(0.2, 0.2, 0.2);
  const base = MeshBuilder.CreateBox(
    `${name}-light-bar-base`,
    {
      width: placement.width,
      height: LIGHT_BAR_BASE_HEIGHT_M,
      depth: placement.depth,
    },
    scene,
  );
  base.material = housing;
  base.position.y = LIGHT_BAR_BASE_HEIGHT_M / 2;
  base.parent = bar;
  base.isPickable = false;

  // Two lenses meeting at the centre line, with the housing left proud at both
  // ends. The old bar left a 12cm gap between its halves, which is what made it
  // read as two separate floating boxes rather than one light bar.
  const lensWidth = placement.width * 0.47;
  const makeLens = (side: 1 | -1, tint: Color3) => {
    const material = new StandardMaterial(
      `${name}-light-bar-lens-${side > 0 ? "blue" : "red"}`,
      scene,
    );
    material.diffuseColor = tint.scale(0.55);
    material.emissiveColor = tint.scale(0.06);
    material.specularColor = new Color3(0.35, 0.35, 0.35);
    const lens = MeshBuilder.CreateBox(
      `${name}-light-bar-lens-${side > 0 ? "blue" : "red"}`,
      {
        width: lensWidth,
        height: LIGHT_BAR_LENS_HEIGHT_M,
        depth: placement.depth * 0.86,
      },
      scene,
    );
    lens.material = material;
    lens.position.set(
      side * placement.width * 0.235,
      LIGHT_BAR_BASE_HEIGHT_M + LIGHT_BAR_LENS_HEIGHT_M / 2,
      0,
    );
    lens.parent = bar;
    lens.isPickable = false;
    return { material, tint };
  };
  const red = makeLens(-1, new Color3(0.95, 0.08, 0.1));
  const blue = makeLens(1, new Color3(0.12, 0.25, 1));

  const decal = liveryDecalMaterial(scene, livery);
  const panels = computeLiveryPanels(root, bounds, yawOffset);
  const panelThickness = 0.012;
  for (const [side, panel] of Object.entries(panels)) {
    const mesh = MeshBuilder.CreateBox(
      `${name}-livery-${side}`,
      { width: panel.length, height: panel.height, depth: panelThickness },
      scene,
    );
    mesh.material = decal;
    mesh.position.copyFrom(panel.position);
    mesh.rotation.y = panel.rotationY;
    mesh.parent = root;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
  }

  return {
    setBeacon(redLevel, blueLevel) {
      // Lenses are dark glass at rest and blaze when the lamp fires.
      red.material.emissiveColor = red.tint.scale(0.06 + redLevel * 0.94);
      blue.material.emissiveColor = blue.tint.scale(0.06 + blueLevel * 0.94);
    },
    materials: [housing, red.material, blue.material],
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
  const taillightMeshes: Mesh[] = [];
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
    if (
      mesh instanceof Mesh &&
      /taillight|back[_ ]?light|rear[_ ]?light/i.test(source.name)
    ) {
      taillightMeshes.push(mesh);
    }
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

  // Turn signals reuse the tail lamps: the models ship one shared TailLights
  // material spanning both lenses, so a per-side blink needs its own geometry — a
  // thin amber panel laid over each lens half, disabled until setSignal flashes
  // the signalling side (issue #31). Measured from the tail-lamp meshes, in the
  // same pre-yaw/pre-scale space as the plates, so they scale with the car. One
  // shared amber material; a panel appearing IS the lit half.
  const indicatorMaterial = new StandardMaterial(`${name}-signal`, scene);
  indicatorMaterial.diffuseColor = MODEL_INDICATOR_AMBER;
  indicatorMaterial.emissiveColor = MODEL_INDICATOR_AMBER;
  indicatorMaterial.specularColor = Color3.Black();
  ownedMaterials.push(indicatorMaterial);
  const leftIndicators: Mesh[] = [];
  const rightIndicators: Mesh[] = [];
  if (taillightMeshes.length > 0) {
    const tailMin = new Vector3(Infinity, Infinity, Infinity);
    const tailMax = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const mesh of taillightMeshes) {
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      tailMin.minimizeInPlace(box.minimumWorld);
      tailMax.maximizeInPlace(box.maximumWorld);
    }
    for (const panel of computeTailLampPanels(
      { min: tailMin, max: tailMax },
      config.yawOffset,
    )) {
      const lamp = MeshBuilder.CreateBox(
        `${name}-signal-${panel.side}`,
        { width: panel.size.x, height: panel.size.y, depth: panel.size.z },
        scene,
      );
      lamp.material = indicatorMaterial;
      lamp.position.copyFrom(panel.position);
      lamp.parent = root;
      lamp.isPickable = false;
      lamp.receiveShadows = false;
      lamp.setEnabled(false);
      (panel.side === "left" ? leftIndicators : rightIndicators).push(lamp);
    }
  }

  // Patrol kit: roof light bar seated on the measured roof, force markings on
  // the doors. Authored in the same pre-scale space as the plates above.
  const police = appearance.livery
    ? attachPoliceKit(scene, root, name, bounds, config.yawOffset, appearance.livery)
    : null;
  if (police) ownedMaterials.push(...police.materials);

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
    leftIndicators,
    rightIndicators,
    brakeLights: [],
    setSignal(signal, blinkOn) {
      if (disposed) return;
      const leftOn = signal === "left" && blinkOn;
      const rightOn = signal === "right" && blinkOn;
      for (const lamp of leftIndicators) lamp.setEnabled(leftOn);
      for (const lamp of rightIndicators) lamp.setEnabled(rightOn);
    },
    setBraking(active) {
      if (disposed) return;
      // No toggleable brake mesh on the models — brighten their own tail-lamp
      // material instead, which reads as real brake lights.
      for (const material of taillightMaterials) {
        material.emissiveColor = active ? MODEL_BRAKE_GLOW : MODEL_TAIL_GLOW;
      }
    },
    setBeacon(red, blue) {
      if (disposed) return;
      police?.setBeacon(red, blue);
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
    setBeacon() {},
    setDetailVisible() {},
    dispose() {
      if (disposed) return;
      disposed = true;
      root.dispose(false, false);
    },
  };
}
