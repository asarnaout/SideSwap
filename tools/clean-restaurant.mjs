/**
 * Removes the baked cursive "Diner" script from
 * `public/models/props/restaurant.glb`.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * The CC-BY "Diner" model (Poly by Google, via Poly Pizza) letters its roof
 * sign board with an extruded cursive "Diner" script. The glTF import's
 * handedness reflection renders that lettering back-to-front, so in game the
 * board reads as mirrored gibberish (#125). The glyphs are raised ~0.6 native
 * units proud of the board face, so they cannot be papered over at runtime —
 * any covering plane either floats visibly in front of the board or has the
 * letter tips poking through it. Instead we remove the script geometry here,
 * leaving the model's own white board (with its red frame and centre fin)
 * clean, and the game letters each venue's real name onto that board at
 * runtime (see `signBoard` in `PROP_MODEL_REGISTRY`). CC-BY permits
 * modification with attribution (see CREDITS.md).
 *
 * WHAT IT REMOVES
 * ---------------
 * The model is two meshes (Box001 base slab + Box002 everything-else), with
 * Box002 split into one primitive per material. The script lives in the dark
 * red trim primitive (material `02___Default`) alongside the roof stripes and
 * sign fin. A triangle is dropped when all three of its vertices fall inside
 * GLYPH_BOX — the script's bounding box (x 16.2..73.7, y 65.4..88.7,
 * z -1.1..0.7 native) plus margin. Nothing else reaches into that box: the
 * board's own faces span the full board width, the fin sits at x -4.5..-2.3,
 * and the trim stripes stay below y 60. Only the primitive's index buffer is
 * rewritten (appended to the BIN chunk); vertices are left orphaned in place,
 * exactly like the gas-station cleaner.
 *
 * REPRODUCE
 * ---------
 *   node tools/clean-restaurant.mjs public/models/props/restaurant.glb        # apply
 *   node tools/clean-restaurant.mjs public/models/props/restaurant.glb --dry  # preview
 * Run on the raw Poly Pizza download (see git history). Idempotent: on an
 * already-cleaned file there is nothing left inside GLYPH_BOX to remove.
 */
import fs from "node:fs";

const path = process.argv[2] ?? "public/models/props/restaurant.glb";
const dry = process.argv.includes("--dry");

const TARGET_NODE = "Box002";
const TARGET_MATERIAL = "02___Default";
/** Native-unit AABB fully containing the script glyph solids (with margin). */
const GLYPH_BOX = {
  min: [15.5, 64.5, -1.6],
  max: [74.5, 89.5, 1.2],
};

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
// The box below is authored in the node's own (= glb root) frame; a transform
// on the node would silently shift it off the glyphs.
if (node.matrix || node.translation || node.rotation || node.scale) {
  throw new Error(`${TARGET_NODE} unexpectedly carries a transform`);
}
const mesh = json.meshes[node.mesh];
const prims = mesh.primitives.filter(
  (pr) => json.materials[pr.material]?.name === TARGET_MATERIAL,
);
if (prims.length !== 1) {
  throw new Error(`expected 1 ${TARGET_MATERIAL} primitive, found ${prims.length}`);
}
const prim = prims[0];

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

const positions = readAccessor(prim.attributes.POSITION);
const indices = readAccessor(prim.indices);
const inBox = (p) =>
  p[0] >= GLYPH_BOX.min[0] && p[0] <= GLYPH_BOX.max[0] &&
  p[1] >= GLYPH_BOX.min[1] && p[1] <= GLYPH_BOX.max[1] &&
  p[2] >= GLYPH_BOX.min[2] && p[2] <= GLYPH_BOX.max[2];

const kept = [];
let removed = 0;
for (let t = 0; t < indices.length; t += 3) {
  const tri = [indices[t], indices[t + 1], indices[t + 2]];
  if (tri.every((i) => inBox(positions[i]))) removed++;
  else kept.push(...tri);
}

console.log(
  `${TARGET_MATERIAL}: ${indices.length / 3} tris, ${removed} inside the script box, ${kept.length / 3} kept`,
);
if (removed === 0) {
  console.log("nothing to remove — already clean");
  process.exit(0);
}
if (dry) process.exit(0);

// Append the filtered index list as a fresh bufferView + accessor; the old one
// (and the glyph vertices) stay behind as unreferenced bytes, which glTF allows.
const useU32 = positions.length > 0xffff;
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
console.log(`removed ${removed} script tris; wrote ${out.length} bytes to ${path}`);
