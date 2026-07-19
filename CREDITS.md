# Third-party asset credits

SideSwap's imported 3D vehicle models are low-poly glTF (`.glb`) assets, all
free for commercial use. Files live under `public/models/`.

## CC0 — public domain (no attribution required)

- **sedan.glb, sports.glb, suv.glb** — Quaternius (<https://quaternius.com>),
  released CC0. Recolourable solid-material low-poly cars.
- **person-a.glb, person-b.glb, person-c.glb** (rigged, animated pedestrians) —
  Quaternius, "Animated Men Pack" (<https://quaternius.com>), released CC0.

## CC-BY — attribution required

- **bus.glb** (single-deck city bus) — by **"jeremy"** via Poly Pizza
  (<https://poly.pizza/m/bsvS0E1eo4R>), licensed **CC-BY 3.0**
  (<https://creativecommons.org/licenses/by/3.0/>). Credit: "jeremy" (Poly Pizza).
- **van.glb** (recolourable panel van) — "Generic Van" by **PuKkBuMXDD** via
  Poly Pizza (<https://poly.pizza/m/BbRojf2v3H>), licensed **CC-BY 3.0**
  (<https://creativecommons.org/licenses/by/3.0/>). Credit: "Generic Van by
  PuKkBuMXDD". Solid `bodywork` material, recoloured per vehicle.
- **bicycle.glb** — by **"Poly by Google"** via Poly Pizza
  (<https://poly.pizza/m/eRg_VrQlvXY>), licensed **CC-BY 3.0**
  (<https://creativecommons.org/licenses/by/3.0/>). Credit: "Poly by Google".

## Purchased — used under licence, NOT redistributed in this repo

- **london-double-decker.glb** — "Low Poly London Bus" by **LinderMedia**
  (Envato / 3DOcean, TurboSquid product 1381797,
  <https://3docean.net/item/low-poly-london-bus/23371870>), used under a
  purchased Envato Market licence. That licence permits use of the model in the
  game but **not** redistribution of the raw asset, so this `.glb` is
  **gitignored** and never committed to this public repo. If you own the asset,
  regenerate it from your purchased OBJ with
  `node tools/build-london-bus.mjs <path-to/LowPoly-LondonBus_OBJ.obj>`. When the
  file is absent, the game falls back to its procedural double-decker
  automatically. Recoloured to plain London red with no operator/TfL branding.

## Fonts — SIL Open Font License 1.1

Self-hosted under `public/fonts/`. The OFL permits bundling/redistribution
provided its licence text travels with the fonts (included alongside them):

- **Figtree** (`figtree.woff2`) — Erik Kennedy, © 2022 The Figtree Project
  Authors. Licence: `public/fonts/Figtree-OFL.txt`.
- **Playfair Display** (`playfair-display.woff2`, `playfair-display-italic.woff2`)
  — Claus Eggers Sørensen, © 2017 The Playfair Display Project Authors, Reserved
  Font Name "Playfair Display". Licence: `public/fonts/PlayfairDisplay-OFL.txt`.

## First-party — created for SideSwap (no third-party rights)

- **favicon.svg** — original SideSwap mark.
- **og.png** and **`public/landing/*.webp`** (per-city preview illustrations) —
  generated with OpenAI (ChatGPT) by the project owner, who owns the output
  under OpenAI's Terms of Use. Stylised generic city scenes; no third-party
  assets, logos, or branding.
