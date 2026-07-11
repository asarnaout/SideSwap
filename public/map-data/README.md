# SideSwap frozen map data

The JSON files in this directory are generated from OpenStreetMap data and are
made available under the Open Database License (ODbL) 1.0. Each file embeds its
bounding box, freeze timestamp, source checksum, importer version, and the
required attribution link.

Regenerate the extracts with `node scripts/fetch-osm.mjs`. The importer prefers
OpenStreetMap's official small-bounding-box map API and falls back to separate
Overpass requests for roads and buildings. Pass `--force` to refresh every pack
or `--verify` to check IDs, bounding boxes, provenance fields, and geometry
checksums without making a network request.

These extracts supply geographic context only; SideSwap's directed lane graph,
lesson routes, and educational traffic rules are reviewed and authored
separately from official jurisdiction sources. A map pack is not a traffic-law
source.

Frozen extracts:

- `nyc-upper-west` — Upper West Side, New York City
- `uk-london-south-kensington` — South Kensington Museum Quarter, London
- `uk-milton-keynes` — South Grafton and Oldbrook, Milton Keynes
- `fr-calais-coquelles` — Calais and Coquelles terminal approach
- `jp-setagaya` — Yamashita to Miyanosaka, Setagaya
