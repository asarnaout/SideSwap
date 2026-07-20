# Third-party asset credits

Curbside Rush's imported 3D vehicle, character and building models are low-poly
glTF (`.glb`) assets, all free for commercial use. Vehicles + people live under
`public/models/{vehicles,characters}/`; environment buildings (gig venues + gas
stations) live under `public/models/props/`.

## CC0 — public domain (no attribution required)

- **sedan.glb, sports.glb, suv.glb** — Quaternius (<https://quaternius.com>),
  released CC0. Recolourable solid-material low-poly cars.
- **person-a.glb, person-b.glb, person-c.glb** (rigged, animated pedestrians) —
  Quaternius, "Animated Men Pack" (<https://quaternius.com>), released CC0.
- **props/residence.glb** ("House") and **props/office.glb** ("Big Building") —
  Quaternius via Poly Pizza (<https://poly.pizza/m/HeHDd2rTpX>,
  <https://poly.pizza/m/AVCS8jUd2l>), released **CC0 1.0**. Low-poly detached
  house + civic block, used for residence / office gig venues.
- **props/shop.glb** ("Building") — by **Kay Lousberg** via Poly Pizza
  (<https://poly.pizza/m/EL3ePInr1N>), released **CC0 1.0**. Low-poly corner
  shop, used for shop gig venues.

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
- **props/gas-station.glb** ("Gas Station") — by **Alex Safayan** via Poly Pizza
  (<https://poly.pizza/m/7rUkCX-AIR2>), licensed **CC-BY 3.0**
  (<https://creativecommons.org/licenses/by/3.0/>). Credit: "Gas Station by Alex
  Safayan". Fuel station used for the refuel service points. **Modified:** the
  model's bundled clutter (parked cars/trucks, trees, bushes, flowers, crates,
  power box, filler buildings), its mirrored "QUICK STOP" lettering, and a
  freestanding sign/pylon were all trimmed to match the game's art style, keeping
  just the canopy + pumps + store — see `tools/clean-gas-station.mjs`. The model
  keeps its own baked forecourt slab, which the maps park flush against the
  road shoulder (see `tests/gasStationLots.test.ts`).
- **props/restaurant.glb** ("Diner") — by **"Poly by Google"** via Poly Pizza
  (<https://poly.pizza/m/4Xlqz9IfdrV>), licensed **CC-BY 3.0**
  (<https://creativecommons.org/licenses/by/3.0/>). Credit: "Poly by Google".
  Diner used for restaurant gig venues.

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

## First-party — created for Curbside Rush (no third-party rights)

- **favicon.svg** — original Curbside Rush mark.
- **og.png** and **`public/landing/*.webp`** (per-city preview illustrations) —
  generated with OpenAI (ChatGPT) by the project owner, who owns the output
  under OpenAI's Terms of Use. Stylised generic city scenes; no third-party
  assets, logos, or branding.
- **All sound effects** — engine, wind and road noise, tyre and brake squeal,
  horn, and collision impacts are **synthesised at runtime in Web Audio**
  (`app/game/audio/`). No sample, recording, or third-party audio asset is used
  or shipped, so there is nothing here to license.
- **`public/audio/music/*.mp3`** (8 background tracks) — generated with
  [Suno](https://suno.com) on 2026-07-19 by the project owner while subscribed
  to a paid (Pro/Premier) plan. Suno assigns the subscriber all of its right,
  title and interest in output generated during the subscription term, including
  commercial use, and that grant survives the subscription ending. See Suno's
  [Terms of Service](https://suno.com/terms-of-service) and
  [rights FAQ](https://help.suno.com/en/articles/9601665). Note that rights are
  **not** granted retroactively for anything made on the free tier, which is why
  the generation date is recorded here.

  Tracks are matched to the city they were written for; Milton Keynes has no
  piece of its own and draws from the full set. Original download names are kept
  here so the files can be traced back to the Suno account:

  | File | Title | City | Source |
  |---|---|---|---|
  | `nyc-upper-west-glide.mp3` | Upper West Glide | NYC | track1 |
  | `nyc-midnight-manhattan.mp3` | Midnight Manhattan | NYC | track7 |
  | `london-exhibition-road-glide-1.mp3` | Exhibition Road Glide | London | track2 |
  | `london-exhibition-road-glide-2.mp3` | Exhibition Road Glide | London | track3 |
  | `calais-coast-run-1.mp3` | Calais Coast Run | Calais | track4 |
  | `calais-coast-run-2.mp3` | Calais Coast Run | Calais | track5 |
  | `tokyo-setagaya-glide.mp3` | Setagaya Glide | Tokyo | track6 |
  | `tokyo-setagaya-morning.mp3` | Setagaya Morning | Tokyo | track8 |
