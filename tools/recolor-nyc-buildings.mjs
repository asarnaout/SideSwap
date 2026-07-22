/**
 * Recolours the NYC building glbs to a realistic New York facade palette.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * The CC0 kits we dress NYC with are authored as bright, playful toy colours:
 * KayKit's "citybits" rowhouses sample a palette atlas of saturated primaries
 * (fire-engine red, pumpkin orange, teal, cobalt), and the tenement's brick is
 * a candy pink. In game that reads as a toy blockset, not a city (issue #120).
 * Real NYC masonry is a narrow band of earth tones — brownstone brown, muted
 * terracotta brick, buff, limestone, slate — with the *trim* (cornices, window
 * surrounds, sills) staying pale. So we do not flatten everything to grey; we
 * pull the saturated hues into that band and leave the neutrals alone.
 *
 * WHY BAKE IT INTO THE ASSET INSTEAD OF TINTING AT RUNTIME
 * -------------------------------------------------------
 * Multiplying a material's albedo by a brown at runtime (the usual recolour
 * trick, see the note in CREDITS.md) also drags the white trim to brown, which
 * is exactly the detail that makes a rowhouse read as a rowhouse. These models
 * bake body *and* trim into one texture, so the only way to move the body
 * without the trim is per-colour, which means touching the pixels. Doing it
 * once here also keeps it off the critical path at load.
 *
 * WHAT IT DOES
 * ------------
 * For every model listed in TARGETS:
 *   1. Each embedded texture is decoded, and every pixel above SAT_FLOOR is
 *      mapped by hue into one of five NYC facade bands (see BANDS) with its
 *      saturation capped and its lightness preserved, so facade shading and
 *      baked ambient occlusion survive. Pixels below SAT_FLOOR — white trim,
 *      grey concrete, black ironwork, glass — are passed through untouched.
 *   2. Solid `baseColorFactor` materials get the same mapping. Those are
 *      linear-space, so they are converted to sRGB and back around the
 *      transform; texels are already sRGB and are mapped directly.
 *      Materials named window/glass/trim are skipped — the renderer classifies
 *      those the same way and overrides them in applyBuildingNightGlow.
 *   3. The BIN chunk is rebuilt from scratch (re-encoding a PNG changes its
 *      length, which shifts every later bufferView), keeping 4-byte alignment.
 *
 * The mapping targets absolute hues/saturations rather than scaling the
 * existing ones, and each band's target hue lies inside that band, so the
 * script is idempotent — re-running it is a no-op.
 *
 * REPRODUCE
 *   node tools/recolor-nyc-buildings.mjs          # apply, in place
 *   node tools/recolor-nyc-buildings.mjs --dry    # report only, write nothing
 * Run against the raw Poly Pizza / KayKit downloads to regenerate. CC0 permits
 * modification; the recolour is noted in CREDITS.md.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const PROPS = "public/models/props";
const dry = process.argv.includes("--dry");

/** Models dressed into NYC blocks. Textured ones carry the atlas. */
const TARGETS = [
  "nyc-brownstone-a", "nyc-brownstone-b", "nyc-brownstone-c", "nyc-brownstone-d",
  "nyc-tenement", "nyc-house-a", "nyc-house-b", "nyc-midrise-a", "nyc-midrise-b",
  "nyc-midrise-low", "nyc-shop-corner", "nyc-tower-a", "nyc-tower-b",
  "nyc-tower-c", "nyc-tower-artdeco", "nyc-tower-spire",
];

/** Left alone: the renderer treats these as glass and relights them at night. */
const SKIP_MATERIAL = /window|glass|trim/i;

/**
 * Below this saturation a pixel is masonry-neutral already — trim, concrete,
 * ironwork, glazing — and must not move, or the facade loses its detailing.
 */
const SAT_FLOOR = 0.12;

/**
 * Hue bands -> NYC facade tones. `to` is the target hue and `cap` the maximum
 * saturation. Each `to` lies inside its own [lo, hi) so the map is a fixed
 * point. Ordered; first match wins. 330..360 wraps onto the brick band.
 */
const BANDS = [
  { lo: 0, hi: 28, to: 14, cap: 0.30 },    // reds      -> brownstone / brick
  { lo: 28, hi: 75, to: 34, cap: 0.24 },   // orange/yellow -> buff, tan brick
  { lo: 75, hi: 190, to: 95, cap: 0.07 },  // greens    -> weathered stone
  { lo: 190, hi: 265, to: 212, cap: 0.09 },// cyan/blue -> slate, grey granite
  { lo: 265, hi: 330, to: 14, cap: 0.22 }, // purples   -> muted brick
  { lo: 330, hi: 360, to: 14, cap: 0.30 }, // magenta   -> brick
];

const rgbToHsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return [h, s, l];
};

const hslToRgb = (h, s, l) => {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = (t + 360) % 360;
    if (t < 60) return p + (q - p) * t / 60;
    if (t < 180) return q;
    if (t < 240) return p + (q - p) * (240 - t) / 60;
    return p;
  };
  return [f(h + 120), f(h), f(h - 120)].map((v) => Math.round(v * 255));
};

/** Pulls one sRGB colour into the NYC band its hue falls in. */
function earthTone(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b);
  if (s < SAT_FLOOR) return [r, g, b];
  const band = BANDS.find((x) => h >= x.lo && h < x.hi) ?? BANDS[0];
  return hslToRgb(band.to, Math.min(s, band.cap), l);
}

const linearToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a glb");
  let off = 12, json = null, bin = Buffer.alloc(0);
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8"));
    if (type === 0x004e4942) bin = Buffer.from(chunk);
    off += 8 + len;
  }
  return { json, bin };
}

function serializeGlb(json, bin) {
  const pad = (b, to, fill) => {
    const rem = b.length % to;
    return rem === 0 ? b : Buffer.concat([b, Buffer.alloc(to - rem, fill)]);
  };
  const jsonChunk = pad(Buffer.from(JSON.stringify(json), "utf8"), 4, 0x20);
  const binChunk = pad(bin, 4, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + (binChunk.length ? 8 + binChunk.length : 0), 8);
  const parts = [header];
  const head = (len, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(len, 0); h.writeUInt32LE(type, 4); return h; };
  parts.push(head(jsonChunk.length, 0x4e4f534a), jsonChunk);
  if (binChunk.length) parts.push(head(binChunk.length, 0x004e4942), binChunk);
  return Buffer.concat(parts);
}

/** Remaps every saturated texel; returns null when nothing moved. */
async function recolorTexture(png) {
  const img = sharp(png);
  const { width, height } = await img.metadata();
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  let moved = 0;
  const cache = new Map();
  for (let i = 0; i < data.length; i += ch) {
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    let out = cache.get(key);
    if (out === undefined) {
      out = earthTone(data[i], data[i + 1], data[i + 2]);
      cache.set(key, out);
    }
    // The HSL round-trip rounds, so an already-mapped texel can come back ±1.
    // Leaving those alone is what makes a second run a true no-op.
    const drift = Math.max(
      Math.abs(out[0] - data[i]),
      Math.abs(out[1] - data[i + 1]),
      Math.abs(out[2] - data[i + 2]),
    );
    if (drift <= 1) continue;
    moved += 1;
    data[i] = out[0]; data[i + 1] = out[1]; data[i + 2] = out[2];
  }
  if (!moved) return null;
  const buf = await sharp(data, { raw: { width, height, channels: ch } }).png({ compressionLevel: 9 }).toBuffer();
  return { buf, moved, total: (width * height) };
}

let changedFiles = 0;
for (const id of TARGETS) {
  const file = path.join(PROPS, `${id}.glb`);
  if (!fs.existsSync(file)) { console.log(`${id.padEnd(20)} (missing, skipped)`); continue; }
  const { json, bin } = parseGlb(fs.readFileSync(file));
  const notes = [];

  // 1. Solid materials.
  for (const mat of json.materials ?? []) {
    const c = mat.pbrMetallicRoughness?.baseColorFactor;
    if (!c || SKIP_MATERIAL.test(mat.name ?? "")) continue;
    const srgb = c.slice(0, 3).map((v) => Math.round(linearToSrgb(v) * 255));
    const next = earthTone(...srgb);
    if (next.every((v, i) => v === srgb[i])) continue;
    for (let i = 0; i < 3; i += 1) c[i] = srgbToLinear(next[i] / 255);
    const hex = (a) => "#" + a.map((v) => v.toString(16).padStart(2, "0")).join("");
    notes.push(`${mat.name}: ${hex(srgb)} -> ${hex(next)}`);
  }

  // 2. Textures, then rebuild BIN so shifted lengths stay consistent.
  const replaced = new Map();
  for (const [idx, img] of (json.images ?? []).entries()) {
    if (img.bufferView === undefined) continue;
    const bv = json.bufferViews[img.bufferView];
    const src = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
    const out = await recolorTexture(src);
    if (!out) continue;
    replaced.set(img.bufferView, out.buf);
    notes.push(`image ${idx}: ${(out.moved / out.total * 100).toFixed(1)}% of texels recoloured`);
  }

  if (!notes.length) { console.log(`${id.padEnd(20)} already realistic, unchanged`); continue; }

  if (replaced.size) {
    const chunks = [];
    let cursor = 0;
    for (const [i, bv] of json.bufferViews.entries()) {
      const src = replaced.get(i) ??
        bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
      chunks.push(src);
      bv.byteOffset = cursor;
      bv.byteLength = src.length;
      cursor += src.length;
      const padding = (4 - (cursor % 4)) % 4;
      if (padding) { chunks.push(Buffer.alloc(padding)); cursor += padding; }
    }
    const rebuilt = Buffer.concat(chunks);
    json.buffers[0].byteLength = rebuilt.length;
    if (!dry) fs.writeFileSync(file, serializeGlb(json, rebuilt));
  } else if (!dry) {
    fs.writeFileSync(file, serializeGlb(json, bin));
  }

  changedFiles += 1;
  console.log(`${id.padEnd(20)} ${dry ? "would change" : "recoloured"}`);
  for (const n of notes) console.log(`    ${n}`);
}

console.log(`\n${dry ? "Would update" : "Updated"} ${changedFiles} model(s).`);
