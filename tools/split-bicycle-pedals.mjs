#!/usr/bin/env node
/**
 * Split the baked pedal platforms of public/models/characters/bicycle.glb into
 * their own nodes, and re-pivot the tire nodes, so the runtime can animate them
 * (issue #121 — cyclists pedalling with feet on real, moving pedals).
 *
 * The source asset ("Poly by Google", CC-BY 3.0 — modification permitted and
 * credited in CREDITS.md) bakes the two pedal platforms into the frame mesh's
 * "Mat-2" primitive and authors both tire meshes with origin-offset geometry,
 * which makes all of them impossible to rotate in place. This tool:
 *
 *  - extracts the two pedal platforms (isolated vertex clusters, measured
 *    boxes below) out of the Mat-2 primitive into new meshes under new nodes
 *    `PedalL` (bike-local +Z side) / `PedalR` (−Z side), with vertices rebased
 *    about each platform's centroid and the node translation set to it — the
 *    centroid sits on the crank circle, so orbiting the node position around
 *    the bottom bracket is the whole pedal animation;
 *  - rebases each Tire mesh about its wheel centre and bakes that centre into
 *    the node translation, so `rotation.z` spins the wheel in place;
 *  - rebuilds the binary chunk (one bufferView per accessor, 4-byte aligned)
 *    and revalidates its own output.
 *
 * Idempotent: a glb that already has a PedalL node is left untouched.
 * Run: node tools/split-bicycle-pedals.mjs [--dry]
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const GLB_PATH = path.join(
  process.cwd(),
  "public/models/characters/bicycle.glb",
);
const DRY = process.argv.includes("--dry");

// Measured pedal-platform bounding boxes (bike glb units), with margin. These
// are the two isolated clusters of the Mat-2 primitive at crank radius ~28.2
// about the bottom bracket (8.3, 50.65); the other Mat-2 clusters (saddle,
// grips) are >50 units away, so a box test is unambiguous.
const PEDAL_BOXES = [
  { name: "PedalL", min: [-17, 66, 31], max: [-5, 77, 55] }, // +Z side
  { name: "PedalR", min: [22, 24, -12.5], max: [33, 35.5, 11] }, // −Z side
];
// The clusters measure exactly these vertex counts today; if the asset ever
// drifts, fail loudly rather than split garbage.
const EXPECTED_PEDAL_VERTS = [89, 88];

// ---------------------------------------------------------------------------
// glb parse / emit
// ---------------------------------------------------------------------------

function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a glb");
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const binHeader = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binHeader);
  const bin = buf.subarray(binHeader + 8, binHeader + 8 + binLen);
  return { json, bin };
}

function emitGlb(json, bin) {
  let jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  if (jsonPad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const paddedBin = binPad ? Buffer.concat([bin, Buffer.alloc(binPad)]) : bin;
  const total = 12 + 8 + jsonBuf.length + 8 + paddedBin.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonBuf.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16); // 'JSON'
  jsonBuf.copy(out, 20);
  let o = 20 + jsonBuf.length;
  out.writeUInt32LE(paddedBin.length, o);
  out.writeUInt32LE(0x004e4942, o + 4); // 'BIN'
  paddedBin.copy(out, o + 8);
  return out;
}

const COMP_SIZE = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
const NUM_COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(json, bin, idx) {
  const acc = json.accessors[idx];
  const bv = json.bufferViews[acc.bufferView];
  const compSize = COMP_SIZE[acc.componentType];
  const numComp = NUM_COMP[acc.type];
  const stride = bv.byteStride ?? compSize * numComp;
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = new Array(acc.count);
  for (let i = 0; i < acc.count; i++) {
    const off = base + i * stride;
    const el = new Array(numComp);
    for (let c = 0; c < numComp; c++) {
      const o = off + c * compSize;
      el[c] =
        acc.componentType === 5126
          ? bin.readFloatLE(o)
          : compSize === 2
            ? bin.readUInt16LE(o)
            : compSize === 4
              ? bin.readUInt32LE(o)
              : bin.readUInt8(o);
    }
    out[i] = numComp === 1 ? el[0] : el;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Transformations
// ---------------------------------------------------------------------------

const buf = readFileSync(GLB_PATH);
const { json, bin } = parseGlb(buf);

if (json.nodes.some((n) => n.name === "PedalL")) {
  console.log("bicycle.glb already has split pedals — nothing to do.");
  process.exit(0);
}

// Decode every accessor up front; the whole BIN is rebuilt from these.
const data = json.accessors.map((_, i) => readAccessor(json, bin, i));

const nodeByName = new Map(json.nodes.map((n, i) => [n.name, i]));
const meshFrame = json.meshes.findIndex(
  (m) => m.name === "Subdivision_Surface.2-Mesh",
);
if (meshFrame < 0) throw new Error("frame mesh not found");
const framePrim = json.meshes[meshFrame].primitives.find(
  (p) => json.materials[p.material]?.name === "Mat-2",
);
if (!framePrim) throw new Error("Mat-2 primitive not found");

// --- 1. Extract the pedal platforms out of the Mat-2 primitive -------------
const positions = data[framePrim.attributes.POSITION];
const indices = data[framePrim.indices];
const inBox = (p, box) =>
  p[0] >= box.min[0] && p[0] <= box.max[0] &&
  p[1] >= box.min[1] && p[1] <= box.max[1] &&
  p[2] >= box.min[2] && p[2] <= box.max[2];

const pedals = PEDAL_BOXES.map((box) => ({ box, tris: [], verts: new Map() }));
const keptTris = [];
for (let t = 0; t < indices.length; t += 3) {
  const tri = [indices[t], indices[t + 1], indices[t + 2]];
  const owner = pedals.find((p) => tri.every((v) => inBox(positions[v], p.box)));
  if (owner) owner.tris.push(tri);
  else keptTris.push(tri);
}

const pedalMeshes = pedals.map(({ box, tris }, pi) => {
  // Compact the platform's vertices and rebase about their centroid — which by
  // construction sits at the platform's crank-circle spindle point.
  const remap = new Map();
  const verts = [];
  for (const tri of tris) {
    for (const v of tri) {
      if (!remap.has(v)) {
        remap.set(v, verts.length);
        verts.push(positions[v]);
      }
    }
  }
  if (verts.length !== EXPECTED_PEDAL_VERTS[pi]) {
    throw new Error(
      `${box.name}: expected ${EXPECTED_PEDAL_VERTS[pi]} verts, got ${verts.length} — asset drifted, refusing to split`,
    );
  }
  const centroid = [0, 1, 2].map(
    (a) => verts.reduce((s, p) => s + p[a], 0) / verts.length,
  );
  return {
    name: box.name,
    translation: centroid,
    positions: verts.map((p) => [0, 1, 2].map((a) => p[a] - centroid[a])),
    indices: tris.flat().map((v) => remap.get(v)),
  };
});

// Compact the frame primitive's remaining vertices too.
{
  const remap = new Map();
  const verts = [];
  for (const tri of keptTris) {
    for (const v of tri) {
      if (!remap.has(v)) {
        remap.set(v, verts.length);
        verts.push(positions[v]);
      }
    }
  }
  data[framePrim.attributes.POSITION] = verts;
  data[framePrim.indices] = keptTris.flat().map((v) => remap.get(v));
}

// --- 2. Re-pivot the tires about their wheel centres -----------------------
for (const tireName of ["Tire", "Tire_1"]) {
  const nodeIdx = nodeByName.get(tireName);
  if (nodeIdx === undefined) throw new Error(`${tireName} node not found`);
  const node = json.nodes[nodeIdx];
  const posAcc = json.meshes[node.mesh].primitives[0].attributes.POSITION;
  const pts = data[posAcc];
  const centre = [0, 1, 2].map(
    (a) => (Math.min(...pts.map((p) => p[a])) + Math.max(...pts.map((p) => p[a]))) / 2,
  );
  data[posAcc] = pts.map((p) => [0, 1, 2].map((a) => p[a] - centre[a]));
  node.translation = centre;
}

// --- 3. Register the new pedal meshes/nodes/accessors ----------------------
for (const pedal of pedalMeshes) {
  const posAcc = json.accessors.length;
  json.accessors.push({
    // bufferView assigned during re-emit
    componentType: 5126,
    count: pedal.positions.length,
    type: "VEC3",
  });
  data.push(pedal.positions);
  const idxAcc = json.accessors.length;
  json.accessors.push({
    componentType: 5123,
    count: pedal.indices.length,
    type: "SCALAR",
  });
  data.push(pedal.indices);
  const meshIdx = json.meshes.length;
  json.meshes.push({
    name: `${pedal.name}-Mesh`,
    primitives: [
      {
        attributes: { POSITION: posAcc },
        indices: idxAcc,
        material: framePrim.material,
        mode: 4,
      },
    ],
  });
  const nodeIdx = json.nodes.length;
  json.nodes.push({ name: pedal.name, translation: pedal.translation, mesh: meshIdx });
  json.scenes[json.scene ?? 0].nodes.push(nodeIdx);
}
json.accessors[framePrim.attributes.POSITION].count =
  data[framePrim.attributes.POSITION].length;
json.accessors[framePrim.indices].count = data[framePrim.indices].length;

// --- 4. Rebuild the binary: one bufferView per accessor, 4-byte aligned ----
const chunks = [];
let offset = 0;
json.bufferViews = [];
json.accessors.forEach((acc, i) => {
  const values = data[i];
  const numComp = NUM_COMP[acc.type];
  const compSize = COMP_SIZE[acc.componentType];
  const bytes = Buffer.alloc(values.length * numComp * compSize);
  let o = 0;
  for (const el of values) {
    for (let c = 0; c < numComp; c++) {
      const v = numComp === 1 ? el : el[c];
      if (acc.componentType === 5126) bytes.writeFloatLE(v, o);
      else if (compSize === 2) bytes.writeUInt16LE(v, o);
      else if (compSize === 4) bytes.writeUInt32LE(v, o);
      else bytes.writeUInt8(v, o);
      o += compSize;
    }
  }
  const isIndex = acc.type === "SCALAR";
  json.bufferViews.push({
    buffer: 0,
    byteOffset: offset,
    byteLength: bytes.length,
    target: isIndex ? 34963 : 34962,
  });
  acc.bufferView = i;
  delete acc.byteOffset;
  if (acc.type === "VEC3") {
    acc.min = [0, 1, 2].map((a) => Math.min(...values.map((p) => p[a])));
    acc.max = [0, 1, 2].map((a) => Math.max(...values.map((p) => p[a])));
  }
  chunks.push(bytes);
  const pad = (4 - (bytes.length % 4)) % 4;
  if (pad) chunks.push(Buffer.alloc(pad));
  offset += bytes.length + pad;
});
const newBin = Buffer.concat(chunks);
json.buffers = [{ byteLength: newBin.length }];

// --- 5. Validate our own output before writing -----------------------------
const rebuilt = parseGlb(emitGlb(json, newBin));
{
  const BB = { x: 8.3, y: 50.65 };
  const totalTris =
    rebuilt.json.meshes.reduce(
      (s, m) =>
        s +
        m.primitives.reduce(
          (t, p) => t + rebuilt.json.accessors[p.indices].count / 3,
          0,
        ),
      0,
    );
  if (totalTris !== 21318 / 3 + 2592 / 3 + 2592 / 3 + 2154 / 3 + 3654 / 3) {
    throw new Error(`triangle count changed: ${totalTris}`);
  }
  for (const name of ["PedalL", "PedalR"]) {
    const node = rebuilt.json.nodes.find((n) => n.name === name);
    const r = Math.hypot(node.translation[0] - BB.x, node.translation[1] - BB.y);
    if (Math.abs(r - 28.2) > 1.5) {
      throw new Error(`${name} spindle off the crank circle: r=${r.toFixed(2)}`);
    }
  }
  for (const tireName of ["Tire", "Tire_1"]) {
    const node = rebuilt.json.nodes.find((n) => n.name === tireName);
    const acc =
      rebuilt.json.accessors[
        rebuilt.json.meshes[node.mesh].primitives[0].attributes.POSITION
      ];
    for (const a of [0, 1, 2]) {
      if (Math.abs(acc.min[a] + acc.max[a]) > 0.01) {
        throw new Error(`${tireName} not centred on axis ${a}`);
      }
    }
  }
}

for (const pedal of pedalMeshes) {
  const t = pedal.translation.map((v) => v.toFixed(2)).join(", ");
  console.log(
    `${pedal.name}: ${pedal.positions.length} verts, ${pedal.indices.length / 3} tris, spindle (${t})`,
  );
}
console.log(
  `frame Mat-2 primitive: ${data[framePrim.attributes.POSITION].length} verts kept`,
);
if (DRY) {
  console.log("[dry] validated; not writing");
} else {
  writeFileSync(GLB_PATH, emitGlb(json, newBin));
  console.log(`wrote ${GLB_PATH}`);
}
