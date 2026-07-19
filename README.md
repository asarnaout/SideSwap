# Side Gig Simulator

Side Gig Simulator is a low-poly, single-player 3D open-world driving game where you run deliveries and passenger fares across five world cities — each with its own currency, streets, and side of the road.

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

Side Gig Simulator is a game for entertainment, not legal advice or driver-licensing instruction. The in-game Sources view links to the dated official material behind each country's road rules.

## Map attribution

Map geography is derived from © OpenStreetMap contributors and distributed under the ODbL. See the in-game Credits view and [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright).
