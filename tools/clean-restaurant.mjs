/**
 * Removes the baked cursive "Diner" script and the sign-board fin from
 * `public/models/props/restaurant.glb`.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * The CC-BY "Diner" model (Poly by Google, via Poly Pizza) letters its roof
 * sign board with an extruded cursive "Diner" script, composed around a
 * decorative fin that spears through the board (~1.2 m proud of its face).
 * The glTF import's handedness reflection renders the lettering back-to-front,
 * so in game the board read as mirrored gibberish (#125). The glyphs are
 * raised ~0.6 native units proud of the board face, so they cannot be papered
 * over at runtime — any covering plane either floats visibly in front of the
 * board or has the letter tips poking through it. And once the script is gone,
 * the fin stops reading as a sign assembly and starts reading as a glitch — a
 * blank slab stabbed through a blank board — while also forcing any runtime
 * lettering off-centre to dodge it. So both go: this leaves the model's white
 * board (with its red frame) clean, and the game centres each venue's real
 * name onto it at runtime (see `signBoard` in `PROP_MODEL_REGISTRY`). CC-BY
 * permits modification with attribution (see CREDITS.md).
 *
 * WHAT IT REMOVES
 * ---------------
 * The model is two meshes (Box001 base slab + Box002 everything-else), with
 * Box002 split into one primitive per material. Each CUT below drops every
 * triangle of one material's primitive whose three vertices all fall inside
 * an axis-aligned box (native units, with margin):
 *   - the script glyphs (x 16.2..73.7, y 65.4..88.7, z -1.1..0.7) in the dark
 *     red trim primitive;
 *   - the fin's red slab (x -4.5..-2.3, y 54.5..104.4, z -14.5..14), same
 *     primitive;
 *   - the fin's white inset panels (same x, y 54.5..97.5, z -9.8..4.1) in the
 *     white trim primitive;
 *   - the fin's grey core and stepped crown (same x, y 54.5..102.8,
 *     z -12.2..11.9) in the grey primitive — the fin is a three-material
 *     sandwich, and the grey layer renders near-white, so missing it leaves a
 *     ghost column spearing the board.
 * Nothing else reaches into those boxes: the board's own faces and the eave
 * stripes span far beyond them, and the chimney sits at x -61.5..-49.4. Only
 * primitive index buffers are rewritten (appended to the BIN chunk); vertices
 * are left orphaned in place, exactly like the gas-station cleaner.
 *
 * REPRODUCE
 * ---------
 *   node tools/clean-restaurant.mjs public/models/props/restaurant.glb        # apply
 *   node tools/clean-restaurant.mjs public/models/props/restaurant.glb --dry  # preview
 * Run on the raw Poly Pizza download (see git history). Idempotent: on an
 * already-cleaned file there is nothing left inside the cut boxes to remove.
 */
import fs from "node:fs";

const path = process.argv[2] ?? "public/models/props/restaurant.glb";
const dry = process.argv.includes("--dry");

const TARGET_NODE = "Box002";
/** Per-material cut boxes (native units, AABB fully containing the target). */
const CUTS = [
  {
    label: "cursive script",
    material: "02___Default",
    box: { min: [15.5, 64.5, -1.6], max: [74.5, 89.5, 1.2] },
  },
  {
    label: "fin (red slab)",
    material: "02___Default",
    box: { min: [-5.0, 54.0, -15.0], max: [-1.8, 105.0, 14.5] },
  },
  {
    label: "fin (white insets)",
    material: "01___Default",
    box: { min: [-5.0, 54.0, -15.0], max: [-1.8, 105.0, 14.5] },
  },
  {
    label: "fin (grey core + crown)",
    material: "07___Default",
    box: { min: [-5.0, 54.0, -15.0], max: [-1.8, 105.0, 14.5] },
  },
];

const buf = fs.readFileSync(path);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`not a glb: ${path}`);

let off = 12;
const chunks = [];
while (off < buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  chunks.push({ type, data: buf.subarray(off + 8, off + 8 + len) });
  off += 8 + len;
}
const JSON_T = 0x4e4f534a;
const BIN_T = 0x004e4942;
const json = JSON.parse(chunks.find((c) => c.type === JSON_T).data.toString("utf8"));
const binChunk = chunks.find((c) => c.type === BIN_T);
let bin = Buffer.from(binChunk.data);

const node = json.nodes.find((n) => n.name === TARGET_NODE);
if (!node || node.mesh == null) throw new Error(`node ${TARGET_NODE} not found`);
// The cut boxes are authored in the node's own (= glb root) frame; a transform
// on the node would silently shift them off their targets.
if (node.matrix || node.translation || node.rotation || node.scale) {
  throw new Error(`${TARGET_NODE} unexpectedly carries a transform`);
}
const mesh = json.meshes[node.mesh];

function primForMaterial(name) {
  const prims = mesh.primitives.filter(
    (pr) => json.materials[pr.material]?.name === name,
  );
  if (prims.length !== 1) {
    throw new Error(`expected 1 ${name} primitive, found ${prims.length}`);
  }
  return prims[0];
}

function readAccessor(idx) {
  const acc = json.accessors[idx];
  const bv = json.bufferViews[acc.bufferView];
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const comps = { SCALAR: 1, VEC3: 3 }[acc.type];
  const out = [];
  if (acc.componentType === 5126) {
    const stride = bv.byteStride ?? comps * 4;
    for (let i = 0; i < acc.count; i++) {
      const v = [];
      for (let c = 0; c < comps; c++) v.push(bin.readFloatLE(base + i * stride + c * 4));
      out.push(v);
    }
  } else if (acc.componentType === 5125) {
    for (let i = 0; i < acc.count; i++) out.push(bin.readUInt32LE(base + i * 4));
  } else if (acc.componentType === 5123) {
    for (let i = 0; i < acc.count; i++) out.push(bin.readUInt16LE(base + i * 2));
  } else throw new Error(`unsupported componentType ${acc.componentType}`);
  return out;
}

// Append `kept` as a fresh bufferView + accessor and point the primitive at
// it; the old index data (and the cut vertices) stay behind as unreferenced
// bytes, which glTF allows.
function rewriteIndices(prim, kept, vertexCount) {
  const useU32 = vertexCount > 0xffff;
  const idxBytes = Buffer.alloc(kept.length * (useU32 ? 4 : 2));
  kept.forEach((v, i) =>
    useU32 ? idxBytes.writeUInt32LE(v, i * 4) : idxBytes.writeUInt16LE(v, i * 2),
  );
  if (bin.length % 4 !== 0) bin = Buffer.concat([bin, Buffer.alloc(4 - (bin.length % 4), 0)]);
  json.bufferViews.push({
    buffer: 0,
    byteOffset: bin.length,
    byteLength: idxBytes.length,
    target: 34963, // ELEMENT_ARRAY_BUFFER
  });
  bin = Buffer.concat([bin, idxBytes]);
  json.accessors.push({
    bufferView: json.bufferViews.length - 1,
    componentType: useU32 ? 5125 : 5123,
    count: kept.length,
    type: "SCALAR",
  });
  prim.indices = json.accessors.length - 1;
}

const inBox = (p, box) =>
  p[0] >= box.min[0] && p[0] <= box.max[0] &&
  p[1] >= box.min[1] && p[1] <= box.max[1] &&
  p[2] >= box.min[2] && p[2] <= box.max[2];

let totalRemoved = 0;
const materials = [...new Set(CUTS.map((cut) => cut.material))];
for (const material of materials) {
  const cuts = CUTS.filter((cut) => cut.material === material);
  const prim = primForMaterial(material);
  const positions = readAccessor(prim.attributes.POSITION);
  const indices = readAccessor(prim.indices);
  const kept = [];
  const removedPerCut = new Map(cuts.map((cut) => [cut.label, 0]));
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t], indices[t + 1], indices[t + 2]];
    const hit = cuts.find((cut) =>
      tri.every((i) => inBox(positions[i], cut.box)),
    );
    if (hit) removedPerCut.set(hit.label, removedPerCut.get(hit.label) + 1);
    else kept.push(...tri);
  }
  const removed = indices.length / 3 - kept.length / 3;
  for (const [label, count] of removedPerCut) {
    console.log(`${material}: ${label} — ${count} tris`);
  }
  console.log(`${material}: ${indices.length / 3} tris, ${removed} removed, ${kept.length / 3} kept`);
  if (removed > 0 && !dry) rewriteIndices(prim, kept, positions.length);
  totalRemoved += removed;
}

if (totalRemoved === 0) {
  console.log("nothing to remove — already clean");
  process.exit(0);
}
if (dry) process.exit(0);

json.buffers[0].byteLength = bin.length;
const jsonBytes = Buffer.from(new TextEncoder().encode(JSON.stringify(json)));
const jsonPadded = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);
if (bin.length % 4 !== 0) bin = Buffer.concat([bin, Buffer.alloc(4 - (bin.length % 4), 0)]);
const total = 12 + 8 + jsonPadded.length + 8 + bin.length;
const out = Buffer.alloc(total);
out.writeUInt32LE(0x46546c67, 0);
out.writeUInt32LE(2, 4);
out.writeUInt32LE(total, 8);
let p = 12;
out.writeUInt32LE(jsonPadded.length, p);
out.writeUInt32LE(JSON_T, p + 4);
jsonPadded.copy(out, p + 8);
p += 8 + jsonPadded.length;
out.writeUInt32LE(bin.length, p);
out.writeUInt32LE(BIN_T, p + 4);
bin.copy(out, p + 8);
fs.writeFileSync(path, out);
console.log(`removed ${totalRemoved} tris total; wrote ${out.length} bytes to ${path}`);
