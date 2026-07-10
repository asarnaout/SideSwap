# SideSwap

SideSwap is a low-poly, single-player 3D web driving trainer for rehearsing the road habits that change when a traveler switches between left-side and right-side traffic.

The current curriculum contains 15 guided lessons across orientation yards, New York City, Milton Keynes, Calais/Coquelles, Tokyo Setagaya, and a simplified UK-to-France shuttle transition. It also includes free-drive routes, first- and third-person cameras, keyboard/gamepad/touch controls, local progress, coaching, scoring, a driving passport, accessibility settings, and official rule references.

## Local development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

## Architecture

- `app/game/simulation.ts` contains the deterministic fixed-step TypeScript simulation and scoring model.
- `app/game/GameCanvas.tsx` owns the client-only Babylon.js scene, cameras, input, HUD, audio cues, and strict cleanup.
- `app/game/content.ts` defines country profiles, lessons, map packs, official references, and unlocks.
- `app/game/progress.ts` validates and migrates the versioned `sideswap:v1` local save.
- `public/map-data/` contains frozen, compact OpenStreetMap extracts used as offline geography references. No map data is requested at runtime.

SideSwap is educational familiarization, not legal advice or driver-licensing instruction. Rules can change; the in-game Sources view links to the dated official material used for each lesson.

## Map attribution

Map geography is derived from © OpenStreetMap contributors and distributed under the ODbL. See the in-game Credits view and [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright).
