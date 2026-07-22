# Curbside Rush

Curbside Rush is a low-poly, single-player 3D open-world driving game where you run deliveries and passenger fares across five city maps in four countries — each country with its own currency, road rules, and side of the road.

The maps are New York City (Upper West Side), London (South Kensington), Milton Keynes (Oldbrook), Calais/Coquelles, and Tokyo (Setagaya). Pick a city and drive: deliveries load at a business and drop off across town, passenger fares carry a rider to their destination, earnings and fuel are tracked per country, you refuel at gas stations, and driving badly in front of a patrol car costs you a fine. Also included are first- and third-person cameras with a rear-view mirror, keyboard/gamepad/touch controls, ambient traffic and pedestrian crowds, local progress, accessibility settings, and official road-rule references.

## Local development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` takes about two minutes, almost all of it in the traffic-safety acceptance test (every start position across five cities, 51 seeds, 60 seconds of simulation each). While iterating, skip it:

```bash
npx vitest run --exclude "tests/trafficSafetyAcceptance.test.ts" --exclude "**/node_modules/**"
```

One vehicle model, `public/models/vehicles/london-double-decker.glb`, is a purchased asset whose licence forbids redistribution, so it is not in the repo. In a clone without it, London's buses stand in with the committed single-deck city bus recoloured to the same red. To build the real one from your own purchased OBJ, run `node tools/build-london-bus.mjs <path-to.obj>`.

`CLAUDE.md` documents the architecture in depth — the layering rules, the geometry conventions, and the invariants that are easy to break silently.

## Architecture

- `app/game/simulation.ts` is the deterministic fixed-step simulation: vehicle physics, traffic, road-rule enforcement and scoring. It imports nothing but its own types — no React, no Babylon, no clock, no unseeded randomness — so a drive replays bit-exactly from a seed.
- `app/game/simulationAdapter.ts` translates an authored map pack into the simulation's configuration once, before the drive starts.
- `app/game/GameCanvas.tsx` owns the client-only Babylon.js scene, cameras, input, audio and strict cleanup.
- `app/game/content.ts` and `londonContent.ts` define country profiles, official references, and the map packs. A map pack pairs a directed lane graph (the legal truth the simulation drives on) with road-surface centrelines (the visual truth); road meshes, junctions, kerbs, pavements, markings, addresses and pedestrian routes are all derived from those two at load time.
- `app/game/gigs.ts` is the delivery/fare state machine, and `app/game/progress.ts` validates and migrates the versioned `sideswap:v2` local save.
- `public/map-data/` contains frozen, checksummed OpenStreetMap extracts kept for provenance and attribution. Nothing reads them at runtime; the drivable geography is authored separately.

Curbside Rush is a game for entertainment, not legal advice or driver-licensing instruction. The in-game Sources & credits view links to the dated official material behind each country's road rules.

## Map attribution

Map geography is derived from © OpenStreetMap contributors and distributed under the ODbL. See the in-game Credits view and [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright).
