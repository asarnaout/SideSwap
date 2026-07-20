/**
 * Trims `public/models/props/gas-station.glb` down to just the station.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * The CC-BY "Gas Station" model (Alex Safayan, via Poly Pizza) ships as a full
 * diorama: canopy + pumps + store, but also parked cars/trucks, trees, bushes,
 * flowers, crates, a power box, filler buildings, a mirrored "QUICK STOP" roof
 * sign, and a freestanding pylon/arrow off to one side. All of that clashes with
 * the game (Quaternius vehicles, procedural greenery) or is plain broken (the
 * reversed text, the floating arrow), so we strip it to the station itself.
 * CC-BY permits modification with attribution (see CREDITS.md).
 *
 * WHAT IT REMOVES
 * ---------------
 * A node's `mesh` is cleared (⇒ never rendered) when it is:
 *   1. named with a clutter prefix (z*, MY_CAR*, Tree*, Leaves*), or
 *   2. text (Text* — the mirrored "QUICK STOP" lettering), or
 *   3. freestanding signage: its geometry sits far (>4.5m) from the model's
 *      footprint centroid AND elevated (>1m) — i.e. the roof sign + the pylon.
 *   4. named explicitly in STRAY_NODES (below).
 * The BIN chunk is kept as-is (orphaned geometry is just unreferenced).
 *
 * REPRODUCE
 * ---------
 *   node tools/clean-gas-station.mjs public/models/props/gas-station.glb        # apply
 *   node tools/clean-gas-station.mjs public/models/props/gas-station.glb --dry  # preview
 * Run on the raw Poly Pizza download (see git history) — it is not idempotent on
 * an already-trimmed file only in that there is then nothing left to remove.
 */
import fs from "node:fs";

const path = process.argv[2] ?? "public/models/props/gas-station.glb";
const dry = process.argv.includes("--dry");
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

// --- world transform composition, to locate each mesh's geometry in the model
const idm = () => [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const mul = (a,b)=>{const r=new Array(16).fill(0);for(let c=0;c<4;c++)for(let rw=0;rw<4;rw++)for(let k=0;k<4;k++)r[c*4+rw]+=a[k*4+rw]*b[c*4+k];return r;};
const fromTRS=(t=[0,0,0],q=[0,0,0,1],s=[1,1,1])=>{const[x,y,z,w]=q,x2=x+x,y2=y+y,z2=z+z,xx=x*x2,xy=x*y2,xz=x*z2,yy=y*y2,yz=y*z2,zz=z*z2,wx=w*x2,wy=w*y2,wz=w*z2;return[(1-(yy+zz))*s[0],(xy+wz)*s[0],(xz-wy)*s[0],0,(xy-wz)*s[1],(1-(xx+zz))*s[1],(yz+wx)*s[1],0,(xz+wy)*s[2],(yz-wx)*s[2],(1-(xx+yy))*s[2],0,t[0],t[1],t[2],1];};
const nmx=(n)=>n.matrix?n.matrix:fromTRS(n.translation,n.rotation,n.scale);
const apply=(m,p)=>[m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];
const centers = new Map(); // nodeIndex -> {x,y,z}
const walk=(ni,par)=>{const n=json.nodes[ni];const w=mul(par,nmx(n));if(n.mesh!=null){const mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9];for(const pr of json.meshes[n.mesh].primitives??[]){const a=json.accessors[pr.attributes?.POSITION];if(!a?.min)continue;for(let i=0;i<8;i++){const cr=[i&1?a.max[0]:a.min[0],i&2?a.max[1]:a.min[1],i&4?a.max[2]:a.min[2]];const p=apply(w,cr);for(let d=0;d<3;d++){if(p[d]<mn[d])mn[d]=p[d];if(p[d]>mx[d])mx[d]=p[d];}}}if(mn[0]<1e9)centers.set(ni,{x:(mn[0]+mx[0])/2,y:(mn[1]+mx[1])/2,z:(mn[2]+mx[2])/2});}for(const c of n.children??[])walk(c,w);};
for (const r of json.scenes?.[json.scene ?? 0]?.nodes ?? []) walk(r, idm());

const clutter = /^(MY_CAR|zTruck|Tree|Leaves|zBush|zFlowerRed|zWoodBox|zPowerMed|zBuilding|zzzz)/i;
const textish = /^Text/i;
/**
 * The pylon's two arrow flashes. Rule 3 removed the pylon's mast and panel but
 * not these: they sit 3.58m and 4.32m from the centroid, just inside the 4.5m
 * cut-off, so they were left hovering ~2.6m and ~3.4m above the forecourt with
 * nothing under them. In game they read as a small white arrow floating over
 * the grass beside the station. Loosening rule 3 to catch them would also take
 * the roof billboard (3.15m, elevated), which the game letters with each
 * station's name — so name them instead.
 */
const STRAY_NODES = new Set([
  "Cylinder.068_Cylinder.126",
  "Cylinder.069_Cylinder.127",
]);
// Footprint centroid from the meshes that are NOT clutter/text (the station).
const structural = [...centers.entries()].filter(([i]) => {
  const nm = json.nodes[i].name ?? "";
  return !clutter.test(nm) && !textish.test(nm);
});
const cx = structural.reduce((s, [, c]) => s + c.x, 0) / structural.length;
const cz = structural.reduce((s, [, c]) => s + c.z, 0) / structural.length;

const removed = [];
for (const node of json.nodes ?? []) {
  if (node.mesh == null) continue;
  const nm = node.name ?? "";
  const idx = json.nodes.indexOf(node);
  const c = centers.get(idx);
  const far = c && Math.hypot(c.x - cx, c.z - cz) > 4.5 && c.y > 1.0;
  const stray = STRAY_NODES.has(nm);
  if (clutter.test(nm) || textish.test(nm) || far || stray) {
    removed.push(
      `${nm}${stray ? " (stray pylon flash)" : far && !clutter.test(nm) && !textish.test(nm) ? " (far/elevated)" : ""}`,
    );
    if (!dry) delete node.mesh;
  }
}

if (dry) {
  console.log(`[dry] would remove ${removed.length} meshes:`);
  for (const r of removed) console.log("  " + r);
  process.exit(0);
}

const jsonBytes = Buffer.from(new TextEncoder().encode(JSON.stringify(json)));
const jsonPadded = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);
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
console.log(`cleared ${removed.length} clutter/sign/text meshes; wrote ${out.length} bytes to ${path}`);
