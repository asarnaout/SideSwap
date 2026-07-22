# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Vite dev server + Miniflare worker on :3000 (NOT `next dev`)
npm run build        # -> dist/client + dist/server (Cloudflare Worker + assets)
npm run typecheck    # tsc --noEmit, ~1.6s
npm run lint         # eslint, ~3s
npm test             # vitest run: 37 files, 404 tests, ~138s
```

Node >= 22.13 (repo currently runs v26).

### Testing

`npm test` takes ~138s and **97% of that is one file** — `tests/trafficSafetyAcceptance.test.ts` (134s: 5 cities x every start/checkpoint x 51 seeds x 60s of sim). Use the fast loop while iterating, full suite before committing:

```bash
# everything except the acceptance test -> 36 files / 402 tests in ~6s
npx vitest run --exclude "tests/trafficSafetyAcceptance.test.ts" --exclude "**/node_modules/**"

npx vitest run tests/simulation.test.ts                     # one file
npx vitest run tests/simulation.test.ts -t "reverses off"   # one test (substring)
npm test -- tests/minimap.test.ts -t "flips north"          # note the `--`
npx vitest tests/gigs.test.ts                               # watch
```

The `--exclude "**/node_modules/**"` is required because passing `--exclude` overrides vitest's defaults. The acceptance test's `2_700_000`ms timeout is a label only — the body is synchronous, so it can never truncate coverage.

**There is no CI.** No `.github/`. Nothing runs test/lint/typecheck unless you do.

Lint exits 0 with ~11 outstanding `no-unused-vars` **warnings** — "lint passes" is not "lint clean". `build/` is a *source* directory but is in ESLint's ignore list (inherited from the Next preset, where `build/` means output), so `build/sites-vite-plugin.ts` is never linted.

## The README is stale

It describes "15 guided lessons" and the `sideswap:v1` save. Both are gone. The game pivoted to an open-world gig driver; the curriculum was deleted and the save key is `sideswap:v2` (`app/game/progress.ts:14`).

**`lesson` survives as internal vocabulary and does not mean a lesson.** `GameCanvasLesson` (`GameCanvas.tsx:864`) is the *runtime scenario contract*, and the only scenario type left is free drive. `SideSwapApp` synthesizes one on every render (`SideSwapApp.tsx:421-441`) with `kind: "free_drive"`, empty `route`/`checkpoints`/`coachPrompts`. Vestigial dead branches remain for retired content: `roadIdForLane` still maps `yard-*`/`xf-*` ids, `RoadSurfaceType` still has `"orientation"`, `GameCanvas` defaults `mapId` to `"orientation-yard"`. No such map exists.

## Architecture

Four rings; dependency arrows only point inward.

```
SideSwapApp.tsx     views, economy, gigs, fuel, music, localStorage
   | props                    ^ GameHudSnapshot (10 Hz) + GameRuntimeEvent
GameCanvas.tsx      Babylon scene, input, cameras, audio, own fixed-step pump
   | SimulationInput          ^ SimulationSnapshot (plain data)
simulation.ts       SimulationCore — physics, traffic, rules, scoring
   ^ SimulationCoreConfig
simulationAdapter   authored MapPack + lesson -> core config (build-time only)
```

`simulation.ts` imports **only** `./types` — no React, DOM, Babylon, `Math.random`, or `Date.now`. That purity is the load-bearing property of the design and is guarded by tests.

**The core knows nothing about gigs, money, or fuel.** Gigs are a pure proximity state machine (`gigs.ts`, no imports at all) advanced from the React HUD callback at ~10 Hz. Fuel is enforced at the input boundary by zeroing throttle before it reaches the core. The police-fine loop lives in `GameCanvas` + `SideSwapApp`. The economy is strictly an outer ring, and **no score, event history or infraction is ever persisted** — the wallet debit is the only durable consequence.

`simulationAdapter.ts` runs **once**, in the `GameCanvas` constructor — never in the frame loop. It translates lanes, infers single-lane adjacency, synthesizes signal phases and supplemental oncoming traffic gates, and **throws** on invalid authored data (missing lane, illegal successor transition, out-of-range anchor). A bad map pack crashes the drive rather than degrading.

### Content: two parallel truths

There is **no procedural city generator and no runtime map import**. A map pack is a hand-authored TypeScript literal in `content.ts` / `londonContent.ts`, and it carries two structures that must be kept in sync:

- **`laneGraph.lanes`** — directed legal truth. What the simulation, guidance, NPCs and scoring use.
- **`geometry.roadSurfaces`** — visual truth. Centrelines + markings.

Linked only by `LaneSegment.roadId <-> RoadSurface.id`/`laneIds`. Two-way streets are two lanes mirrored ±1.7m off the surface centreline. **Everything else in the world is derived at load time** from those two:

| Derived | From | Where |
|---|---|---|
| asphalt strips, kerb/junction fills | `roadSurfaces` | `GameCanvas.tsx:373`, `:641` |
| paint broken at junctions | `roadSurfaces` | `roadMarkings.ts:92` |
| walkable pavement rails | `roadSurfaces` | `pavementPaths.ts:447` |
| ambient traffic routes | `lanes.successors` | `npcPaths.ts:47` |
| gig drop-off addresses | `lanes` + `blocks` | `streetAddresses.ts:293` |
| instanced building street wall | `blocks.buildingSet` | `buildingSets.ts:194` |
| signal phase clock | `controls.phaseGroup` | `trafficSignals.ts:54` |

`getMapPack(id)` (`content.ts:2056`) is a pure frozen lookup that throws on unknown ids.

The JSON in `public/map-data/` is **provenance only** — nothing reads it at runtime. `scripts/fetch-osm.mjs` is a manually-run, one-off freezer, not part of any build. `tests/map-data.test.ts` recomputes a sha256 over `JSON.stringify({roads, buildings})`, so reformatting or reordering keys breaks the checksum even when geometry is identical. Regenerate; never hand-edit.

### Determinism contract

60 Hz fixed step (`FIXED_STEP_SECONDS`), traffic *decisions* at 10 Hz. `step()` clamps delta to 0.25s and drops the excess — under stall the sim runs slow rather than exploding. `step(0, action)` is the sanctioned way to inject a one-shot edge-triggered input.

One xorshift32 PRNG seeded from `lesson.trafficSeed`, consumed in exactly two places (initial NPC spawn, the 10 Hz decision pass). **Everything else is deterministically tie-broken, not randomized** — gates sort by `localeCompare`, crossing priority and successor-lane choice parse digits out of the NPC id string. So **NPC ids are load-bearing data**: renaming the `npc-${n}` scheme changes traffic behaviour.

There is no float discipline — plain doubles. Determinism holds only because the same operations happen in the same order. `tests/trafficSafetyAcceptance.test.ts` replays 8 minutes twice and compares a trace hash; anything that perturbs NPC iteration order, id naming, or lane ordering fails it. Note that geometry edits which *look* purely visual can move the hash, because supplemental oncoming gates are derived from road-surface lane membership.

### Conventions that bite

**Three angle conventions coexist.**

| Thing | Convention |
|---|---|
| World | `x` east, `z` north, `y` up, metres, origin = map centre |
| Lane/pose heading | `atan2(dx, dz)` — **0 = +z (north)**, +pi/2 = +x |
| `arcPoints` angles | **0 = +x (east)**, 90 = +z — standard math, *not* the heading convention |
| Right-hand normal | `(cos h, -sin h)` — the **driver's right** |

**The setback normal is always the driver's right regardless of traffic side.** On left-hand-traffic maps that lands on the far side of the road — which is why MK/London gas stations are anchored on far-side lanes and Tokyo's needs `setbackM: 17.3`.

**The glTF loader bakes a 180° Y flip**, so model fronts are on local −Z. This propagates into four separate offset conventions: props `yawOffset = pi/2`, characters `pi`, buildings per-model `frontOffset`, vehicles per-model (the van's `-pi/2` is what plate placement derives its axes from). A Babylon box's +Z face also renders textures 180°-rotated, so both plates present their −Z face.

**The y-layer stack is a hard global ordering**, every value a bare constant tuned to kill z-fighting:

```
0.0435 shoulder junction fill  <  0.045 shoulder/sidewalk  <  0.07 road surface
<  0.0716 asphalt junction fill  <  0.08 walkers  <  0.1 crowd shadows
<  0.12 markings & vehicle nodes  <  0.144-0.147 chevrons/stop lines
```

Vehicle ground contact is a two-value handshake: nodes at `y = 0.12` and `LOCAL_GROUND_Y = -0.05` put tyres at exactly `0.07`. Change either alone and the whole fleet floats or sinks.

### Rendering layer

`GameCanvas.tsx` is 10k lines but only two live objects: the React component (~660 lines at the end) and `class BabylonGameSession` (~6.5k lines). **React owns the canvas element, the props, and one 10 Hz HUD snapshot; the session owns everything else.** No React state is driven at frame rate. The session is rebuilt only on `[trafficSide, steeringSide, lesson?.id, mapPack?.id, sessionActivation]`; every other prop flows through `session.updateOptions(...)`.

Lines 146-1527 are an **exported pure geometry layer** (road strips, junction fills, chevron placement) — exported specifically so tests can import them from the 10k-line file without instantiating Babylon.

Models are a two-phase construction: everything starts as an empty placeholder, then an async preload upgrades vehicles/characters/props, builds instanced buildings and the VAT crowd, and only then calls `markReady()` — which is what lifts the React loading gate. There is no procedural vehicle/character fallback any more, so **anything that lifts `markReady` early ships invisible cars and people**.

The ambient crowd is the whole city's pedestrians rendered as **3-5 meshes total**: a hand-baked vertex animation texture (the stock Babylon baker doesn't work on glTF animation groups) plus thin instances, with per-person colour as thin-instance colour channels. The thin matrix must be the conjugate `W0 · Pose · W0⁻¹` (`crowdRenderMath.ts:12`) — that's what keeps walkers in world space and winding correct despite the loader's handedness mirror.

`resolveMapVisualKey(mapId)` (`visuals.ts:143`) is **substring matching with an `nyc` default** — a typo'd or new map id silently gets NYC's night+paved palette, which changes lighting, fog, ground texture, sidewalk width *and* the crowd's rail geometry.

### Audio

`audioMath.ts` (471 lines) has zero Web Audio imports — it is the entire car model (invented 5-speed gearbox, rpm curves, wind/road/squeal) and mutates caller-owned objects, allocating nothing. Voices only schedule those numbers. `DriveAudio.create()` returns `null` when Web Audio is unavailable, hence `this.audio?.…` everywhere.

The AudioContext is a **module-level singleton**, deliberately not per-session, because `GameCanvas` remounts on destination/steering change. `primeAudioContext()` + `music.start()` must run **synchronously inside the click handler** (`SideSwapApp.tsx:489-493`) — Safari only honours resume/play in the same task as the gesture. Moving either into an effect silently kills sound.

`tests/driveAudioScheduling.test.ts` injects a fake context whose `FakeParam` records a failure on any direct `.value` write after setup. The discipline it enforces — always schedule, never assign — is the difference between clean audio and clicks.

## Sharp edges

- **~600 lines inside `BabylonGameSession` are unreachable.** `evaluateLesson` (`:3999`) has zero call sites, stranding its whole subtree (`evaluateAuthoredLesson`, `evaluateAuthoredRuleZones`, `authoredSignalAspect`, `assessAuthoredRule`, …), plus `computeNpcRenderSnapshots`/`applyNpcRenderSnapshots`. All superseded by `SimulationCore`. `tsconfig` has no `noUnusedLocals`, so nothing warns — **fixing a bug in any of these changes nothing at runtime.**
- **Inline `penalty:` numbers at `emitEvent` call sites are dead** when the rule is in `SCORING_CONFIG`. Edit `content.ts:2008+`, not the call site.
- **`snapshot.recentEvents` is always empty in production** — `GameCanvas` calls `drainEvents()` every fixed update. Use `drainEvents()` or `latestEvent`.
- **`"coach"` enforcement does not cover collisions.** Collisions call `triggerCritical` directly, bypassing the softening — so in the open world a collision still teleports the player back to spawn. Only `wrong_way`/`out_of_bounds`/`red_light` are actually softened.
- **The free-drive `GameCanvasLesson` contract is duplicated in three places** with no shared factory: `SideSwapApp.tsx:421-441`, `trafficSafetyAcceptance.test.ts:76-101`, `simulationAdapter.test.ts:19-35`.
- **Any new mutable field on `SimulationCore` must be reset in `reset()`**, and usually in `restoreCheckpointPose()` too. `reset()` is called from the constructor, so fields it touches must be initialized before that line.
- **`migrateProgress` runs on save as well as load** and rebuilds from known keys only — a new field on `PlayerProgressV2` is silently stripped on the next write unless added there too.
- **`content.ts` and `londonContent.ts` each carry private copies** of `point`, `node`, `laneTrue`, `arcPoints`, `turningLoop`, `connectorConflictZones`. Fixing one does not fix the other.
- **`0.08m` is the definition of "shared node"** for both junction fills and pavement rails. Authoring a shared endpoint 0.1m apart yields no junction fill (grass through the crossing) and no pavement trim (walkers on the asphalt), silently.
- **Successors must be geometrically continuous** — tests require 0.01m; `buildConnectedNpcPath` requires 2.5m. Break it and traffic despawns rather than errors.
- **`streetAddressesForMap` caches by `pack.id`** in a module-level Map; gig selection, the renderer and tests must all agree, so mutating a pack after first call has no effect. Street addresses only exist for the ~8 NYC roads in `STREET_PROFILES` — other maps fall back to authored venues.
- **`window.__sideswap*` debug hooks are rebuilt every frame and never deleted**, so after unmount they retain the disposed session and its whole scene graph.
- **`window.localStorage` does not exist in this project's jsdom.** A new `.tsx` test needs the polyfill from `launcher.test.tsx:55-77` (or inject `ProgressStorage` like `progress.test.ts` does), plus a **synchronous `requestAnimationFrame` stub** — otherwise `SideSwapApp`'s `hydrated` guard never lifts and every test sees only the loading screen. Tests default to `environment: "node"`; DOM needs `// @vitest-environment jsdom` on line 1 and a local `@testing-library/jest-dom/vitest` import (there is no setup file).
- **Four test files import `GameCanvas.tsx` for real in node.** Adding a top-level side effect touching `window`/`document`/WebGL breaks tests unrelated to rendering.
- **`public/models/vehicles/london-double-decker.glb` is gitignored** (purchased asset, licence forbids redistribution). Its test is `skipIf`-guarded, so a fresh clone silently skips it. Rebuild with `node tools/build-london-bus.mjs <path-to.obj>`.
- **The app shell is nearly untested.** `launcher.test.tsx` has 6 tests and covers none of the driving HUD — fuel drain, refuel pricing, the 8s fine debounce, the gig double-credit guard, minimap pins, music mute. Changing any of that is invisible to `npm test`.
- **`app/globals.css` is ~1912 lines and substantially dead** (removed lesson hub, passport, results views). The driving HUD is inline styles in `SideSwapApp.tsx`, not CSS.
- **No `wrangler.toml`.** Worker config is inline in `vite.config.ts:12-35` at dev time and generated into `dist/server/wrangler.json` at build. The `@cloudflare/vite-plugin` import is deliberately dynamic — Wrangler snapshots its log path on import. The image-optimization branch in `worker/index.ts` and the D1/drizzle packaging in `build/sites-vite-plugin.ts` are inherited template code with no live consumer.
- The `@/*` tsconfig path alias exists and is **used zero times**. Every import is relative; follow that.
