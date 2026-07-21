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

### NYC Nightfall environment kit (CC0)

Added to dress the NYC map with dense, clustered buildings + street life. Every
per-model Poly Pizza source URL is recorded in `app/game/buildingCatalog.ts`
(the catalogue is the single source of truth for these assets).

- **props/nyc-tower-a.glb, nyc-tower-b.glb, nyc-tower-c.glb, nyc-midrise-a.glb,
  nyc-midrise-b.glb, nyc-midrise-low.glb** — low-poly skyscrapers + mid-rise
  buildings by **Kenney** (<https://kenney.nl>) via Poly Pizza, released
  **CC0 1.0**. Downtown-tower cluster and mid-rise fill.
- **props/nyc-brownstone-a.glb, nyc-brownstone-b.glb, nyc-brownstone-c.glb,
  nyc-brownstone-d.glb** — low-poly rowhouses by **Kay Lousberg** via Poly Pizza,
  released **CC0 1.0**. The Upper West Side brownstone belt (same author as
  `shop.glb`, so the style matches).
- **props/vendor-stand.glb** ("Market Stand"), **props/vendor-cart.glb** ("Cart"),
  **props/market-stalls.glb** ("Market Stalls Compact") — by **Quaternius**
  (<https://quaternius.com>) via Poly Pizza, released **CC0 1.0**. Street vendors.
- **characters/person-woman-a.glb** ("Woman Casual"), **person-woman-b.glb**
  ("Woman in Dress"), **person-punk.glb** ("Punk") — rigged pedestrians by
  **Quaternius** via Poly Pizza, released **CC0 1.0**. Sidewalk-crowd variety
  alongside the existing person-a/b/c.

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

### NYC Nightfall environment kit (CC-BY 3.0)

A few NYC-character pieces added alongside the CC0 kit above. All are **CC-BY 3.0**
(<https://creativecommons.org/licenses/by/3.0/>); per-model Poly Pizza source URLs
are in `app/game/buildingCatalog.ts`, and each model's required credit also travels
in that catalogue's `attribution` field.

- **props/nyc-tower-artdeco.glb** ("Skyscraper") — **Poly by Google**. Credit:
  "Skyscraper by Poly by Google". Art-deco setback tower.
- **props/nyc-tower-spire.glb** ("Skyscraper") — **Jarlan Perez**. Credit:
  "Skyscraper by Jarlan Perez". Spired skyline landmark.
- **props/nyc-tenement.glb** ("Apartment building") — **Poly by Google**. Credit:
  "Apartment building by Poly by Google". Fire-escape tenement.
- **props/nyc-house-a.glb** ("House") — **Poly by Google**. Credit: "House by Poly
  by Google". Detached house for the residential pocket.
- **props/nyc-house-b.glb** ("Farm house") — **Poly by Google**. Credit: "Farm
  house by Poly by Google". Detached house for the residential pocket.
- **props/nyc-shop-corner.glb** ("Pizza Corner") — **J-Toastie**. Credit: "Pizza
  Corner by J-Toastie". Corner bodega / ground-floor retail.
- **props/vendor-food.glb** ("Street Vendor Cart") — **Alan Zimmerman**. Credit:
  "Street Vendor Cart by Alan Zimmerman". Street vendor.

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
  [Suno](https://suno.com) on 2026-07-19 and 2026-07-21 by the project owner while subscribed
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
  | `nyc-west-end-glide.mp3` | West End Glide | NYC | West End Glide |
  | `london-exhibition-road-glide-1.mp3` | Exhibition Road Glide | London | track2 |
  | `london-exhibition-road-glide-2.mp3` | Exhibition Road Glide | London | track3 |
  | `calais-coast-run-1.mp3` | Calais Coast Run | Calais | track4 |
  | `calais-coast-run-2.mp3` | Calais Coast Run | Calais | track5 |
  | `tokyo-setagaya-glide.mp3` | Setagaya Glide | Tokyo | track6 |
  | `tokyo-setagaya-morning.mp3` | Setagaya Morning | Tokyo | track8 |
