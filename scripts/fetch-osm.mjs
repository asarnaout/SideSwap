import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(root, "public", "map-data");
const importerVersion = "sideswap-osm-compact@2";
const force = process.argv.includes("--force");
const verifyOnly = process.argv.includes("--verify");

const areas = [
  {
    id: "nyc-upper-west",
    name: "Upper West Side — Broadway & West 72nd Street",
    bbox: [40.7758, -73.9848, 40.7818, -73.978],
  },
  {
    id: "uk-milton-keynes",
    name: "Milton Keynes — South Grafton & Oldbrook",
    bbox: [52.0268, -0.773, 52.034, -0.761],
  },
  {
    id: "fr-calais-coquelles",
    name: "Calais / Coquelles — terminal approach",
    bbox: [50.929, 1.795, 50.938, 1.811],
  },
  {
    id: "jp-setagaya",
    name: "Setagaya — Yamashita to Miyanosaka",
    bbox: [35.644, 139.64, 35.652, 139.653],
  },
];

const overpassEndpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function geometryHash(geometry) {
  return sha256(JSON.stringify(geometry));
}

function decodeXml(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function parseAttributes(fragment) {
  const attributes = {};
  for (const match of fragment.matchAll(/([:\w-]+)="([^"]*)"/g)) {
    attributes[match[1]] = decodeXml(match[2]);
  }
  return attributes;
}

function parseOsmXml(raw) {
  const nodes = new Map();
  for (const match of raw.matchAll(/<node\b([^>]*)\/?\s*>/g)) {
    const attributes = parseAttributes(match[1]);
    if (attributes.id && attributes.lat && attributes.lon) {
      nodes.set(Number(attributes.id), [Number(attributes.lat), Number(attributes.lon)]);
    }
  }

  const ways = [];
  for (const match of raw.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
    const attributes = parseAttributes(match[1]);
    const body = match[2];
    const tags = {};
    for (const tagMatch of body.matchAll(/<tag\b([^>]*)\/?\s*>/g)) {
      const tag = parseAttributes(tagMatch[1]);
      if (tag.k && tag.v !== undefined) tags[tag.k] = tag.v;
    }
    if (!tags.highway && !tags.building) continue;

    const points = [];
    for (const nodeMatch of body.matchAll(/<nd\b([^>]*)\/?\s*>/g)) {
      const reference = Number(parseAttributes(nodeMatch[1]).ref);
      const point = nodes.get(reference);
      if (point) points.push(point);
    }
    if (points.length > 1) {
      ways.push({ id: Number(attributes.id), points, tags });
    }
  }

  return {
    roads: ways.filter((way) => way.tags.highway),
    buildings: ways.filter((way) => way.tags.building),
  };
}

function compactOverpass(elements) {
  const nodes = new Map(
    elements
      .filter((element) => element.type === "node")
      .map((node) => [node.id, [node.lat, node.lon]]),
  );

  const projectWay = (way) => ({
    id: way.id,
    points: Array.isArray(way.geometry)
      ? way.geometry.map((point) => [point.lat, point.lon])
      : (way.nodes ?? []).map((nodeId) => nodes.get(nodeId)).filter(Boolean),
    tags: way.tags ?? {},
  });
  const ways = elements
    .filter((element) => element.type === "way")
    .map(projectWay)
    .filter((way) => way.points.length > 1);

  return {
    roads: ways.filter((way) => way.tags.highway),
    buildings: ways.filter((way) => way.tags.building),
  };
}

async function fetchText(url, init, label, attempts = 2) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          accept: init?.headers?.accept ?? "*/*",
          "user-agent": "SideSwap/1.0 educational game map freezer (offline build)",
          ...init?.headers,
        },
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      console.warn(`${label}: attempt ${attempt}/${attempts} failed (${error.cause?.code ?? error.message})`);
    }
  }
  throw lastError;
}

async function fetchFromOfficialApi(area) {
  const [south, west, north, east] = area.bbox;
  const sourceUrl = `https://api.openstreetmap.org/api/0.6/map?bbox=${west},${south},${east},${north}`;
  const raw = await fetchText(
    sourceUrl,
    { headers: { accept: "application/xml" } },
    `${area.id}: OSM API`,
  );
  const geometry = parseOsmXml(raw);
  if (geometry.roads.length === 0) throw new Error(`${area.id}: OSM API returned no roads`);
  return {
    geometry,
    raw,
    retrieval: "osm-api-map",
    sourceUrl,
    sourceUrls: [sourceUrl],
  };
}

async function fetchOverpassLayer(area, tag) {
  const bbox = area.bbox.join(",");
  const query = `[out:json][timeout:30];way["${tag}"](${bbox});out tags geom;`;
  let lastError;

  for (const endpoint of overpassEndpoints) {
    try {
      const raw = await fetchText(
        endpoint,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body: `data=${encodeURIComponent(query)}`,
        },
        `${area.id}: ${tag} via ${endpoint}`,
        1,
      );
      const payload = JSON.parse(raw);
      return { endpoint, raw, elements: payload.elements ?? [] };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`${area.id}: all Overpass endpoints failed for ${tag}`);
}

async function fetchFromOverpass(area) {
  const roads = await fetchOverpassLayer(area, "highway");
  const buildings = await fetchOverpassLayer(area, "building");
  const geometry = compactOverpass([...roads.elements, ...buildings.elements]);
  if (geometry.roads.length === 0) throw new Error(`${area.id}: Overpass returned no roads`);
  const sourceUrls = [...new Set([roads.endpoint, buildings.endpoint])];
  return {
    geometry,
    raw: `${roads.raw}\n--SIDESWAP-LAYER-BOUNDARY--\n${buildings.raw}`,
    retrieval: "overpass-separated",
    sourceUrl: sourceUrls[0],
    sourceUrls,
  };
}

async function fetchArea(area) {
  let result;
  try {
    result = await fetchFromOfficialApi(area);
  } catch (error) {
    console.warn(`${area.id}: official OSM API unavailable (${error.message}); trying split Overpass queries`);
    result = await fetchFromOverpass(area);
  }

  return {
    schemaVersion: 1,
    id: area.id,
    name: area.name,
    source: {
      provider: "OpenStreetMap contributors",
      license: "ODbL-1.0",
      attributionUrl: "https://www.openstreetmap.org/copyright",
      sourceUrl: result.sourceUrl,
      sourceUrls: result.sourceUrls,
      retrieval: result.retrieval,
      bbox: area.bbox,
      frozenAt: new Date().toISOString(),
      sourceSha256: sha256(result.raw),
      contentSha256: geometryHash(result.geometry),
      importerVersion,
    },
    ...result.geometry,
  };
}

function validateExtract(data, area, requireCurrentImporter = true) {
  const problems = [];
  if (data.schemaVersion !== 1) problems.push("schemaVersion must be 1");
  if (data.id !== area.id) problems.push(`id must be ${area.id}`);
  if (JSON.stringify(data.source?.bbox) !== JSON.stringify(area.bbox)) problems.push("bbox mismatch");
  if (data.source?.provider !== "OpenStreetMap contributors") problems.push("provider missing");
  if (data.source?.license !== "ODbL-1.0") problems.push("license missing");
  if (!data.source?.attributionUrl || !data.source?.sourceUrl) problems.push("source URLs missing");
  if (!/^[a-f0-9]{64}$/.test(data.source?.sourceSha256 ?? "")) problems.push("source checksum missing");
  if (!Array.isArray(data.roads) || data.roads.length === 0) problems.push("roads missing");
  if (!Array.isArray(data.buildings)) problems.push("buildings missing");
  if (requireCurrentImporter && data.source?.importerVersion !== importerVersion) problems.push("stale importer");

  if (data.source?.contentSha256) {
    const actualHash = geometryHash({ roads: data.roads, buildings: data.buildings });
    if (actualHash !== data.source.contentSha256) problems.push("content checksum mismatch");
  } else if (requireCurrentImporter) {
    problems.push("content checksum missing");
  }
  return problems;
}

await mkdir(outputDirectory, { recursive: true });
for (const area of areas) {
  const target = resolve(outputDirectory, `${area.id}.json`);
  let existing;
  try {
    await access(target);
    existing = JSON.parse(await readFile(target, "utf8"));
  } catch {
    // Missing or invalid JSON will be regenerated unless this is verify-only mode.
  }

  if (verifyOnly) {
    if (!existing) throw new Error(`${area.id}: extract is missing or invalid`);
    const problems = validateExtract(existing, area);
    if (problems.length) throw new Error(`${area.id}: ${problems.join(", ")}`);
    console.log(`${area.id}: verified ${existing.roads.length} roads, ${existing.buildings.length} buildings`);
    continue;
  }

  if (existing && !force) {
    const problems = validateExtract(existing, area);
    if (problems.length === 0) {
      console.log(`${area.id}: using verified frozen extract`);
      continue;
    }
    console.log(`${area.id}: refreshing (${problems.join(", ")})`);
  }

  const data = await fetchArea(area);
  const problems = validateExtract(data, area);
  if (problems.length) throw new Error(`${area.id}: generated invalid extract: ${problems.join(", ")}`);
  await writeFile(target, `${JSON.stringify(data)}\n`, "utf8");
  console.log(`${area.id}: ${data.roads.length} roads, ${data.buildings.length} buildings via ${data.source.retrieval}`);
}
