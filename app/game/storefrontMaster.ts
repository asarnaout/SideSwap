/**
 * Assembles a re-branded storefront master from the shop glb's instantiated
 * clones (see storefronts.ts for why). Kept out of GameCanvas so the merge
 * recipe stays one testable source of truth — tests drive it under NullEngine
 * exactly like buildingWinding.test.ts drives the plain merge.
 */
import {
  Color3,
  Material,
  Mesh,
  MeshBuilder,
  MultiMaterial,
  Scene,
  Vector3,
  VertexBuffer,
} from "@babylonjs/core";
import {
  orientMergedFacesOutward,
  recentreMergedMasterXZ,
} from "./buildingWinding";
import {
  extractStorefrontSignRects,
  type StorefrontSignRect,
  type StorefrontVariant,
} from "./storefronts";

/** Material names inside nyc-shop-corner.glb: the baked "PIZZA" letter
 * geometry and the awning band each own a whole primitive. */
const LETTERING_MATERIAL = "white";
const AWNING_MATERIAL = "red";

/** How far a sign plane sits proud of the fascia — the same order as the
 * letter relief it replaces (~9 cm at street scale), clear of z-fighting. */
const SIGN_PROUD = 0.012;

function buildSignPlane(
  scene: Scene,
  rect: StorefrontSignRect,
  variant: StorefrontVariant,
  signMaterial: Material,
  sideOrientation: number,
): Mesh {
  const width = (rect.alongMax - rect.alongMin) * 1.12;
  const height = (rect.yMax - rect.yMin) * 1.3;
  const alongMid = (rect.alongMin + rect.alongMax) / 2;
  const yMid = (rect.yMin + rect.yMax) / 2;
  const proud = rect.plane + rect.outward * SIGN_PROUD;
  const plane = MeshBuilder.CreatePlane(
    `storefront-sign-${variant.id}-${rect.axis}`,
    { width, height },
    scene,
  );
  // Babylon planes face -z natively; yaw the textured front outward. The
  // mirrored back face is buried against the opaque fascia.
  if (rect.axis === "x") {
    plane.position.set(proud, yMid, alongMid);
    plane.rotation.y = rect.outward === 1 ? -Math.PI / 2 : Math.PI / 2;
  } else {
    plane.position.set(alongMid, yMid, proud);
    plane.rotation.y = rect.outward === 1 ? Math.PI : 0;
  }
  // MergeMeshes returns null (silently — no variants, baked pizza everywhere)
  // when side orientations differ, and glTF-loaded meshes carry a different
  // one than a fresh plane. Matching it is load-bearing.
  plane.sideOrientation = sideOrientation;
  plane.material = signMaterial;
  plane.computeWorldMatrix(true);
  return plane;
}

/**
 * Builds one variant master from the glb child clones: drops the baked
 * lettering mesh, mounts a fascia sign plane per street face, merges into a
 * single MultiMaterial mesh (like getBuildingMaster), fixes winding, and swaps
 * the awning submaterial for a per-variant tinted clone. Returns null when the
 * asset no longer matches expectations (no lettering mesh, slab split fails,
 * merge refuses) — callers fall back to the unmodified model.
 *
 * Shared container materials are never mutated (clones share them with the
 * venue pizzeria's instances). On success the input meshes are consumed by the
 * merge; on failure only the planes this created are disposed and the caller
 * still owns the input meshes.
 */
export function assembleStorefrontVariantMaster(
  scene: Scene,
  meshes: Mesh[],
  variant: StorefrontVariant,
  signMaterial: Material,
  options?: { readonly nightGlow?: boolean },
): Mesh | null {
  const lettering = meshes.find((m) => m.material?.name === LETTERING_MATERIAL);
  if (!lettering) return null;
  const rest = meshes.filter((m) => m !== lettering);
  if (!rest.length) return null;

  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const mesh of meshes) {
    for (const corner of mesh.getBoundingInfo().boundingBox.vectorsWorld) {
      min.minimizeInPlace(corner);
      max.maximizeInPlace(corner);
    }
  }

  const local = lettering.getVerticesData(VertexBuffer.PositionKind);
  if (!local) return null;
  const world = lettering.getWorldMatrix();
  const positions: number[] = [];
  for (let i = 0; i + 2 < local.length; i += 3) {
    const p = Vector3.TransformCoordinates(
      new Vector3(local[i], local[i + 1], local[i + 2]),
      world,
    );
    positions.push(p.x, p.y, p.z);
  }
  const rects = extractStorefrontSignRects(positions, {
    x: (min.x + max.x) / 2,
    z: (min.z + max.z) / 2,
  });
  if (!rects) return null;

  lettering.dispose();
  const planes = rects.map((rect) =>
    buildSignPlane(scene, rect, variant, signMaterial, rest[0].sideOrientation),
  );
  const master = Mesh.MergeMeshes(
    [...rest, ...planes],
    true,
    true,
    undefined,
    false,
    true,
  );
  if (!master) {
    for (const plane of planes) plane.dispose();
    return null;
  }
  orientMergedFacesOutward(master);
  // Placement slots assume the body is centred on the pivot (#143); signs and
  // awning are merged in by now, so the whole storefront shifts as one.
  recentreMergedMasterXZ(master);

  if (variant.awningColor && master.material instanceof MultiMaterial) {
    // The merge orders submaterials by material uniqueId, not input order —
    // the awning slot must be found by name.
    const slot = master.material.subMaterials.findIndex(
      (m) => m?.name === AWNING_MATERIAL,
    );
    const awning = slot >= 0 ? master.material.subMaterials[slot] : null;
    const tinted = awning?.clone(`nyc-shop-awning-${variant.id}`) ?? null;
    if (tinted) {
      const { r, g, b } = variant.awningColor;
      const colour = new Color3(r, g, b);
      const m = tinted as unknown as {
        albedoColor?: Color3;
        diffuseColor?: Color3;
        emissiveColor?: Color3;
      };
      if (m.albedoColor) m.albedoColor = colour;
      if (m.diffuseColor) m.diffuseColor = colour;
      // The shared awning material was already glow-zeroed by the night pass
      // before masters build; give the clone a faint self-light of its own
      // tint so it doesn't read black under the night sky.
      if (options?.nightGlow) m.emissiveColor = colour.scale(0.22);
      master.material.subMaterials[slot] = tinted;
    }
  }
  return master;
}
