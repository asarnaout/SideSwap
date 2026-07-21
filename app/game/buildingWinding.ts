/**
 * Fixes "hollow" merged buildings.
 *
 * The renderer bakes each environment building into a single mesh with
 * `Mesh.MergeMeshes`, which folds every source mesh's world matrix into its
 * vertices. The glTF loader maps right-handed glTF into Babylon's left-handed
 * space with a reflection, and once that reflection is baked flat the triangle
 * winding can end up reversed relative to the model's own normals. When it does,
 * back-face culling drops the street-facing walls and keeps the far interior
 * ones, so the building renders inside-out — you see through the near wall into a
 * hollow shell. (Babylon auto-corrects a *live* reflected matrix at draw time,
 * but not one baked into vertices, and the instances the buildings are drawn as
 * carry a plain positive-determinant transform.)
 *
 * Whether a given model comes out hollow is per-asset — it depends on how that
 * model's winding was authored relative to its normals — so it can't be decided
 * from the transform alone (some reflected models are already correct). Decide it
 * geometrically instead: compare each triangle's winding-derived normal against
 * its shading normal. If they disagree for most triangles the outward faces are
 * being culled, so reverse the winding. Normals are left untouched (they bake
 * correctly), so lighting is unchanged.
 */
import { Mesh, VertexBuffer } from "@babylonjs/core";

/** Triangle counts whose winding agrees / disagrees with the shading normals. */
export function windingAgreement(mesh: Mesh): { agree: number; disagree: number } {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
  const indices = mesh.getIndices();
  let agree = 0;
  let disagree = 0;
  if (!positions || !normals || !indices) return { agree, disagree };
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    // Geometric normal from the winding: (p1 - p0) x (p2 - p0).
    const e1x = positions[b] - positions[a];
    const e1y = positions[b + 1] - positions[a + 1];
    const e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a];
    const e2y = positions[c + 1] - positions[a + 1];
    const e2z = positions[c + 2] - positions[a + 2];
    const gx = e1y * e2z - e1z * e2y;
    const gy = e1z * e2x - e1x * e2z;
    const gz = e1x * e2y - e1y * e2x;
    // Averaged shading normal for the triangle's three vertices.
    const nx = normals[a] + normals[b] + normals[c];
    const ny = normals[a + 1] + normals[b + 1] + normals[c + 1];
    const nz = normals[a + 2] + normals[b + 2] + normals[c + 2];
    const dot = gx * nx + gy * ny + gz * nz;
    if (dot > 1e-9) agree += 1;
    else if (dot < -1e-9) disagree += 1;
  }
  return { agree, disagree };
}

/**
 * Reverses the winding of a merged building mesh when its outward faces would be
 * back-face culled (see file docs). Returns true if it flipped. Cheap: one pass
 * over the merged mesh, done once per unique model at load.
 */
export function orientMergedFacesOutward(mesh: Mesh): boolean {
  const { agree, disagree } = windingAgreement(mesh);
  if (disagree > agree) {
    mesh.flipFaces(false);
    return true;
  }
  return false;
}
