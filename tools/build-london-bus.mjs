/**
 * Builds `public/models/vehicles/london-double-decker.glb` from the purchased
 * "Low Poly London Bus" OBJ by LinderMedia (Envato / 3DOcean, product 1381797).
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * The bus is a *purchased* asset. Its Envato licence lets us use it in the game
 * (the end product) but forbids redistributing the raw model — so the `.glb` is
 * gitignored and never committed to this public repo. Anyone cloning the repo
 * without the asset gets the game's procedural double-decker fallback instead.
 *
 * If you own the asset, drop its OBJ somewhere and run:
 *   node tools/build-london-bus.mjs <path-to/LowPoly-LondonBus_OBJ.obj>
 *
 * WHAT IT DOES
 * ------------
 * obj2gltf/FBX2glTF are unreliable here (obj2gltf breaks on Node 26; FBX2glTF is
 * an unsigned x86 binary), so this is a tiny dependency-free OBJ->glb converter.
 * It also remaps the model's arbitrary 3ds-Max "wire" colours to sensible part
 * colours and gives the materials semantic names (`body`, `lights`, `mirror`,
 * `trim`, `wheel`) so `VEHICLE_MODEL_REGISTRY` can recolour `body` per vehicle.
 * The OBJ ships no vertex normals, so faces get flat (faceted) normals — the
 * correct low-poly look.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const objPath = process.argv[2];
if (!objPath) {
  console.error("usage: node tools/build-london-bus.mjs <path-to/LowPoly-LondonBus_OBJ.obj>");
  process.exit(1);
}
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = path.join(repoRoot, "public/models/vehicles/london-double-decker.glb");

// Semantic name + baseColour for each of the OBJ's 5 "wire_*" materials.
const MATS = {
  wire_135006006: { name: "body", color: [0.698, 0.086, 0.145] }, // London red (recoloured per-vehicle at runtime)
  wire_087225087: { name: "lights", color: [0.95, 0.78, 0.42] },  // head + tail lamps (shared) -> warm amber
  wire_108008136: { name: "mirror", color: [0.06, 0.06, 0.07] },  // wing mirrors -> near-black
  wire_135110008: { name: "trim", color: [0.12, 0.12, 0.13] },    // grille / front trim -> dark
  wire_113135006: { name: "wheel", color: [0.09, 0.09, 0.1] },    // tyres -> dark
};

const objText = fs.readFileSync(objPath, "utf8");
const dir = objPath.replace(/[^/]+$/, "");
const mtlColors = {};
const mtlRef = objText.match(/^mtllib\s+(.+)$/m);
if (mtlRef) {
  const mtl = fs.readFileSync(dir + mtlRef[1].trim(), "utf8");
  let cur = null;
  for (const line of mtl.split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] === "newmtl") { cur = t[1]; mtlColors[cur] = [0.8, 0.8, 0.8]; }
    else if (t[0] === "Kd" && cur) mtlColors[cur] = [+t[1], +t[2], +t[3]];
  }
}

const positions = [], normals = [];
const groups = new Map();
let curMat = "default", vnCount = 0;
const idxOf = (s, len) => { const i = parseInt(s, 10); return i < 0 ? len + i : i - 1; };
for (const line of objText.split(/\r?\n/)) {
  const t = line.trim().split(/\s+/);
  if (t[0] === "v") positions.push([+t[1], +t[2], +t[3]]);
  else if (t[0] === "vn") { normals.push([+t[1], +t[2], +t[3]]); vnCount++; }
  else if (t[0] === "usemtl") curMat = t[1] ?? "default";
  else if (t[0] === "f") {
    const vs = t.slice(1).map((tok) => { const p = tok.split("/"); return [idxOf(p[0], positions.length), p[2] ? idxOf(p[2], normals.length) : -1]; });
    if (!groups.has(curMat)) groups.set(curMat, []);
    const tris = groups.get(curMat);
    for (let i = 1; i < vs.length - 1; i++) tris.push([vs[0], vs[i], vs[i + 1]]);
  }
}

const chunks = []; let byteLength = 0;
const push = (buf) => { const off = byteLength; chunks.push(buf); byteLength += buf.length; return off; };
const accessors = [], bufferViews = [], materials = [], primitives = [];
const matIndex = new Map();
const getMat = (name) => {
  if (matIndex.has(name)) return matIndex.get(name);
  const m = MATS[name];
  const c = m?.color ?? mtlColors[name] ?? [0.8, 0.8, 0.8];
  const idx = materials.length;
  materials.push({ name: m?.name ?? name, doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [c[0], c[1], c[2], 1], metallicFactor: 0, roughnessFactor: 0.85 } });
  matIndex.set(name, idx);
  return idx;
};

for (const [matName, tris] of groups) {
  if (!tris.length) continue;
  const pos = [], nor = [], ind = [];
  if (vnCount > 0) {
    const vmap = new Map();
    for (const tri of tris) for (const [vi, ni] of tri) {
      let vIndex = vmap.get(vi + "/" + ni);
      if (vIndex === undefined) {
        vIndex = pos.length / 3;
        const p = positions[vi]; pos.push(p[0], p[1], p[2]);
        const n = ni >= 0 && normals[ni] ? normals[ni] : [0, 1, 0]; nor.push(n[0], n[1], n[2]);
        vmap.set(vi + "/" + ni, vIndex);
      }
      ind.push(vIndex);
    }
  } else {
    for (const tri of tris) {
      const [a, b, c] = tri.map(([v]) => positions[v]);
      const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], w = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
      let fn = [u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0]];
      const L = Math.hypot(...fn) || 1; fn = fn.map((x) => x / L);
      for (const [vi] of tri) { const p = positions[vi]; ind.push(pos.length / 3); pos.push(p[0], p[1], p[2]); nor.push(fn[0], fn[1], fn[2]); }
    }
  }
  const posBuf = Buffer.from(new Float32Array(pos).buffer);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i+k]); max[k] = Math.max(max[k], pos[i+k]); }
  const pOff = push(posBuf);
  bufferViews.push({ buffer: 0, byteOffset: pOff, byteLength: posBuf.length, target: 34962 });
  const pAcc = accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: pos.length / 3, type: "VEC3", min, max }) - 1;
  const norBuf = Buffer.from(new Float32Array(nor).buffer);
  const nOff = push(norBuf);
  bufferViews.push({ buffer: 0, byteOffset: nOff, byteLength: norBuf.length, target: 34962 });
  const nAcc = accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: nor.length / 3, type: "VEC3" }) - 1;
  const indBuf = Buffer.from(new Uint32Array(ind).buffer);
  const iOff = push(indBuf);
  bufferViews.push({ buffer: 0, byteOffset: iOff, byteLength: indBuf.length, target: 34963 });
  const iAcc = accessors.push({ bufferView: bufferViews.length - 1, componentType: 5125, count: ind.length, type: "SCALAR" }) - 1;
  primitives.push({ attributes: { POSITION: pAcc, NORMAL: nAcc }, indices: iAcc, material: getMat(matName) });
}

let bin = Buffer.concat(chunks);
if (bin.length % 4) bin = Buffer.concat([bin, Buffer.alloc(4 - (bin.length % 4))]);
const gltf = { asset: { version: "2.0", generator: "sideswap-obj2glb" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: "LondonBus" }], meshes: [{ primitives }], materials, accessors, bufferViews, buffers: [{ byteLength: bin.length }] };
let json = Buffer.from(JSON.stringify(gltf), "utf8");
if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(outPath, Buffer.concat([h, jh, json, bh, bin]));
console.log(`wrote ${path.relative(repoRoot, outPath)} — ${materials.map((m) => m.name).join(", ")} (${(bin.length / 1024) | 0} KB)`);
