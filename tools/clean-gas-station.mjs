/**
 * Trims the bundled clutter from `public/models/props/gas-station.glb`.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * The CC-BY "Gas Station" model (Alex Safayan, via Poly Pizza) ships as a
 * complete diorama: as well as the canopy + pumps + store it bundles parked
 * cars/trucks, trees, bushes, flowers, wood crates, a power box and filler
 * buildings. Those props clash with the game's Quaternius vehicles + procedural
 * greenery, so we strip them and keep only the station structure. CC-BY permits
 * modification with attribution (see CREDITS.md).
 *
 * WHAT IT DOES
 * ------------
 * Dependency-free glb surgery: clears the `mesh` on every node whose name starts
 * with a clutter prefix (the model tags extras with `z*`, `MY_CAR*`, `Tree*`,
 * `Leaves*`), then re-serialises the container (JSON chunk rewritten, BIN kept).
 * The orphaned geometry stays in the buffer (unreferenced ⇒ never rendered), so
 * the file size is roughly unchanged; only the scene graph shrinks.
 *
 * REPRODUCE
 * ---------
 * The committed glb is already trimmed. To redo it from scratch, restore the
 * original from git history (the raw Poly Pizza download first landed in the
 * "Environment models" commit) or re-download it, then:
 *   node tools/clean-gas-station.mjs public/models/props/gas-station.glb
 * Running it again on an already-trimmed file is a no-op (0 meshes cleared).
 */
import fs from "node:fs";

const path = process.argv[2] ?? "public/models/props/gas-station.glb";
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

const clutter =
  /^(MY_CAR|zTruck|Tree|Leaves|zBush|zFlowerRed|zWoodBox|zPowerMed|zBuilding|zzzz)/i;
let removed = 0;
for (const node of json.nodes ?? []) {
  if (node.name && clutter.test(node.name) && node.mesh != null) {
    delete node.mesh;
    removed++;
  }
}

const jsonBytes = Buffer.from(new TextEncoder().encode(JSON.stringify(json)));
const jsonPadded = Buffer.concat([
  jsonBytes,
  Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20),
]);
let bin = binChunk ? Buffer.from(binChunk.data) : Buffer.alloc(0);
if (binChunk) bin = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4, 0)]);

const total = 12 + 8 + jsonPadded.length + (binChunk ? 8 + bin.length : 0);
const out = Buffer.alloc(total);
out.writeUInt32LE(0x46546c67, 0);
out.writeUInt32LE(2, 4);
out.writeUInt32LE(total, 8);
let p = 12;
out.writeUInt32LE(jsonPadded.length, p);
out.writeUInt32LE(JSON_T, p + 4);
jsonPadded.copy(out, p + 8);
p += 8 + jsonPadded.length;
if (binChunk) {
  out.writeUInt32LE(bin.length, p);
  out.writeUInt32LE(BIN_T, p + 4);
  bin.copy(out, p + 8);
}
fs.writeFileSync(path, out);
console.log(`cleared ${removed} clutter meshes; wrote ${out.length} bytes to ${path}`);
