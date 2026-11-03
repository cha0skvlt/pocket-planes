# Architecture

**Pocket Planes Expedition (PPE) v0.5 — Tech Demo.** Live acceptance passed 2026-11-03:
full boot with the WASM core, both bodies, sea/wind/rain/audio verified in the browser.

Pocket Planes Expedition (PPE) is a browser game: three.js r128 renders, a Rust/WASM core
simulates, and the two talk through a fixed shared-memory block. This document is the complete
architectural map: every module, every cross-module contract, every invariant. An AI agent or
external auditor should be able to reason about the codebase from this file alone; open the code
only to check a specific formula.

Repository layout (each top-level directory is a component, not a build artifact):

```
/                     README.md, CONCEPT.md (game design), ARCHITECTURE.md (this file),
                      Makefile (orchestration), index.html (vite entry),
                      package.json / package-lock.json (npm root — must stay here)
PPE-physics/          Rust/WASM simulation core: src/, tests/, scripts/build.sh, Cargo.*
PPE-graphics/         Browser frontend: rendering, input, bodies, audio, sim bridge (src/ of the game)
PPE-server/           Server/tooling side: vite.config.js (dev server, plugins, build outDir), dist/
test/                 All JS tests (golden, integration, human-model, smoke, wasm debug page, golden.json)
old/                  Archived/duplicate material. Not part of the build. Gitignored.
```

`index.html`, `package.json`, `package-lock.json` must stay in the root: vite resolves its entry
and `root` there, npm resolves the workspace there. Vite must be invoked with
`--config PPE-server/vite.config.js` (the npm scripts do this); the build `outDir` is
`PPE-server/dist`.

---

## 1. The big picture

```
┌──────────────────────────────── browser ─────────────────────────────┐
│                                                                       │
│  ┌──────────────── Rust / WASM (pocket_physics.wasm) ──────────────┐  │
│  │  sea.rs (sea)   wind.rs (weather)   rng.rs                      │  │
│  │  dispersion     gusts advected      JS-identical                │  │
│  │  P–M spectrum   log profile         logical shifts              │  │
│  │  group mod      building wake       hash                        │  │
│  │        └──────────── pp_step(dt, t) ────┐                         │  │
│  │                                         ▼                         │  │
│  │  PP_STATE — #[repr(C)] block at a fixed address in linear memory│  │
│  └────────────────────────────┬────────────────────────────────────┘  │
│                               │ same memory, zero copies              │
│  ┌────────────────────────────▼────────────────────────────────────┐  │
│  │  JS views (Float32Array, created once in initPP)                │  │
│  │  w1/w2/w3 → shader uniforms    at_out → drone/human/rain/audio  │  │
│  │  MOD tile → THREE.DataTexture (pp_mod_ptr)                      │  │
│  └────────────────────────────┬────────────────────────────────────┘  │
│                               │                                       │
│  main.js frame loop:          ▼                                       │
│  wind.update → updateSea → human.step (JS) → drone.step (JS)         │
│  → camera (Tab arc) → rain → audio → atmo → city → render            │
│                                                                       │
│  three.js r128: stage, sky, ocean, city, rain, lights, drone skin    │
└───────────────────────────────────────────────────────────────────────┘
```

Rendering never computes physics. The simulation never touches three.js objects.
The only thing they share is WASM linear memory.

**Bodies live in JS.** Only the environment simulation is Rust: sea + wind. The drone
(`flight/drone.js`) and the human (`flight/human-phys.js`) are JS modules in the same pattern:
self-contained physics that reads the environment through one interface (`wind.at`, `hgt`,
`sea.w1/w2/w3/Us/drift`) — from the WASM proxy when it is up, from the JS reference otherwise.
Bodies do not appear in PPState at all.

### Layering rule

`PPE-graphics/sim/*` is the **bridge layer** — the only JS that knows about the WASM ABI.
Everything above it (`world/`, `flight/`, `audio/`, `main.js`) consumes one of two identical
interfaces: the WASM-backed one or the JS reference one. Nothing above the bridge may import
`WebAssembly` or read raw PPState offsets (the diagnostics block in `main.js` is the sole,
temporary exception).

---

## 2. The WASM boundary

### 2.1 PPState layout

One `#[repr(C)]` static (`PPE-physics/src/lib.rs`) lives at a fixed address returned by
`pp_init()`. Offsets are mirrored in `PPE-graphics/sim/pp.js` (`PP_OFF`). **Both sides must
change together**, and `BUILD_TAG` in `pp.js` must be bumped on every core change (cache
busting for the raw `.wasm` URL).

| offset | field | contents |
|---|---|---|
| `0x000` | `w1 [f32; 28]` | shader uniform: per wave `(dx, dz, k, A)` × 7 |
| `0x070` | `w2 [f32; 28]` | per wave `(ω, φ, sAlong, sAcross)` × 7 |
| `0x0E0` | `w3 [f32; 28]` | per wave `(cg, offU, offV, warp)` × 7 |
| `0x150` | `ratio [f32; 7]` | wind response per wave band |
| `0x16C` | `sea_misc [f32; 4]` | `drift.x, drift.z, th, Us` |
| `0x17C` | `wind [f32; 4]` | `u10, dir, t, g` (g = gustiness 0–1) |
| `0x18C` | `wind_adv [f32; 2]` | gust advection origin `adv.x, adv.z` |
| `0x194` | `at_out [f32; 4]` | last `pp_at()` result: `x, y, z, g` |
| `0x1A4` | `obst_count u32` (+ `u32` pad) | number of buildings |
| `0x1AC` | `obst [f32; 5] × 4096` | buildings `{x, z, hw, hd, top}` — JS writes, Rust reads |

The state block ends at `0x1AC + 4096 × 20 = 0x81AC` (`OBST_END` in `lib.rs`). There is no
body data in PPState — the drone and the human are JS-side.

The 256×256 RGBA modulation tile is separate: `pp_mod_ptr()` returns its address and JS wraps
it in a `THREE.DataTexture` without copying.

### 2.2 Exports

Plain `#[no_mangle] extern "C"` functions — no wasm-bindgen, no generated glue:

| export | purpose |
|---|---|
| `pp_init() -> ptr` | construct `Sea`/`Wind`, sync state, return the PPState pointer. Idempotent: a second call returns the same pointer (a re-init would detach the JS views) |
| `pp_abi_version() -> u32` | ABI handshake: `pp.js` compares against its `EXPECTED_ABI` after init and fails loudly on mismatch |
| `pp_step(dt, t)` | one weather+sea tick: wind → sea → sync into PPState. **Second argument is sim time**, not wind speed |
| `pp_hgt(x, z, t) -> f32` | water height at a point (mirror of the GLSL `H()`) |
| `pp_at(x, y, z) -> ptr` | wind vector at a point, written to `at_out` |
| `pp_set_obstacles(count)` | read `count` buildings from `PP_STATE.obst` into the wind model |
| `pp_mod_ptr() -> ptr` | address of the RGBA modulation tile |

### 2.3 The JS bridge (`PPE-graphics/sim/pp.js`)

Fetches the wasm (`BUILD_TAG` query for cache busting), instantiates it, calls `pp_init`, checks
`pp_abi_version()` against `EXPECTED_ABI` (loud failure on a stale core), builds
typed-array views **once** (`PP.w1..w3`, `PP.wind`, `PP.obst`), exposes `PP.live()`
(view-liveness check: `w1.buffer === memory.buffer`), and
exposes legacy-compatible shims so callers never rewrite:

- `sea` / `updateSea(dt, wind)` / `hgt(x,z,t)` — same shape as `sim/sea.js`;
- `createWind()` — same interface as `sim/wind.js` (`update`, `at`, `setObstacles`, `u10`, `dir`, `g`, `U0`).

`main.js` boots with `initPP()`; on failure it falls back to the JS reference models
(`sim/sea.js`, `sim/wind.js`) — the same formulas in f64, the golden source for tests.
The fallback contract: `sea` export carries `MOD`/`MOD_SIZE` (foam texture), `createWind()`
exposes `x/y/z` (last `at()` result, read by rain). Guarded by `test/fallback.test.mjs`.

The vite build ships the wasm: `pp-wasm-ship` plugin copies `pocket_physics.wasm` into
`dist/PPE-graphics/sim/` on `closeBundle` (pp.js fetches it by a raw URL, invisible to
Vite's import pipeline).

---

## 3. Per-frame data flow (`PPE-graphics/main.js`)

```
frame(dt):                       // dt clamped to 50 ms; one tick per frame, no accumulator
  sdt = run ? dt : dt*0.2        // paused world still breathes at 20% speed
  t += sdt; tw = t % 3600        // uniform time wraps at 1 h so ω·t never loses f32 precision
  wind.update(sdt, tw)           // mean wind breathes; gust field advects itself
  updateSea(sdt, wind)           // pp_step(sdt, tw): sea chases wind (τ≈150 s), ratio bands update
  uDrift += drift*sdt            // drift is a VELOCITY: integrate into the shader offset
  clouds drift by wind.dir       // fogU.uCloud
  if running:
    human: step(dt, tw, input)   // JS physics (human-phys.js): FSM, swim, groundY, capsule collide
    drone: step(dt, tw)          // wind.at(pos), thrust/inertia, AABB collide, camera roll/FOV/shake
    camera: follows the active body; Tab switch flies an arc (smoothstep, +6 m apex)
    audio.update / rain.update   // audio gets altitude ABOVE the water; rain gets wind.x/y/z + wind.g
  else: drone.idle(); camera lifted 0.6 m off the hull
  atmo.update(tw); T.value = tw; city.update(tw, sdt)
  renderer.render(scene, camera)
```

Both bodies always step while running; input is routed to the active one only. Body switching
(`Tab`) swaps `body` between `'drone'` and `'human'` and animates the camera; the idle body keeps
simulating.

### Ownership rules across the boundary

- **JS owns**: obstacle list (writes into `PP_STATE.obst`), both bodies — drone physics
  (`flight/drone.js`) and human physics (`flight/human-phys.js`: capsule FSM Ground/Jump/Swim,
  swim carry from the sea model, capsule-vs-AABB collision, ground height from city AABBs).
- **Rust owns**: the environment only — wave arrays and the wind field.

### Mouse deltas vs absolute course

`input.look.yaw/pitch` are deltas; each body (drone and human alike) accumulates its own
absolute yaw/pitch. Never overwrite one with the other.

---

## 4. Module map — PPE-graphics

| path | lines | role | talks to |
|---|---|---|---|
| `main.js` | 156 | boot order, frame loop, body switching | everything below |
| `core/stage.js` | 16 | WebGLRenderer, Scene, camera (92° FOV, YXZ), moon dir `rift`, shared uniforms `fogU` (`t, fogC, rift, vis, flash, uCloud`), full dispose | main |
| `core/geometry.js` | 2 | `slim()` — strip unused attributes for shader meshes | ocean, sky |
| `core/log.js` | 46 | ring buffer (200) + console + `window.__ppLog`; POSTs to `/__log` every 2 s so agents can `curl` the browser log | vite logEndpoint |
| `shaders/ocean.js` | 22 | GLSL: `H(p,t)` — 5 modulated Gerstner-ish bands, foam, moon trail. Formula-twin of `sea.rs`/`sea.js` | waves |
| `shaders/sky.js` | 38 | GLSL: gradient-noise clouds, moon, halo, lightning flash uniform | sky mesh |
| `world/waves.js` | 14 | uniform bridge: `uW1/uW2/uW3` arrays + `uMod` DataTexture from PPState; `hgt` exported (WASM or JS fallback) | sim/pp |
| `world/ocean.js` | 8 | 1000×1000 plane, 400×400 segs (2.5 m), re-centers on the active body in 5 m snaps (multiple of the 2.5 m vertex step — the grid phase never jumps) | stage, shaders |
| `world/sky.js` | 8 | sky dome mesh | stage, shaders |
| `world/lights.js` | 6 | hemisphere + directional (moon); intensity driven by `vis` in atmosphere | stage, atmosphere |
| `world/textures.js` | 22 | procedural facade + foam canvas textures | city |
| `world/city.js` | 54 | seeded layout (seed 7, mulberry-ish RNG), 3 hero buildings + ~92 blocks, merged static geometry, foam planes, beacons; exports `bl` (AABB list) and `collide()` (drone-shaped) | textures, waves |
| `world/rain.js` | 30 | 3200 line segments, dynamic buffer, advected by the wind field | sim |
| `world/atmosphere.js` | 15 | moon arc, cloud cover `vis`, lightning (`CFG.lightning`, `L` toggles, off by default) | lights, fogU |
| `audio/audio.js` | 27 | fully synthesized WebAudio: wind noise filtered by state, rumble, splash. No samples | main |
| `flight/input.js` | 20 | keyboard state map, pointer-lock mouse deltas (`look.yaw/pitch` are **deltas**) | main |
| `flight/drone.js` | 162 | drone physics + camera + the 3D skin (orange FPV quad): thrust/inertia, AABB collide, roll from yaw rate, FOV breathing, shake; `setActive` toggles skin visibility | input, city, sim |
| `flight/human.js` | ~215 | operator body **rendering**: suited-body rig (torso/pack/helmet/visor/limbs), drives the step of `human-phys.js`, applies wave ragdoll (tilt + limb sway), drives the camera | human-phys, city |
| `flight/human-phys.js` | 260 | operator body **physics, pure JS** (same pattern as the drone): capsule FSM Ground/Jump/Swim, walk/run/jump/crouch, swim = water carry + own stroke (Stokes transport × CARRY_GAIN × sea-state gate + drift, surf push from crest slope, head-floor buoyancy), groundY from city AABBs, capsule collision. Constants: WALK 1.6, RUN 4.2, SWIM_SPEED 0.9, JUMP_V 4.65, CARRY_GAIN 0.45, SURF_PUSH 1.4, WATER_DRAG 1.6 | sim/sea (sampleMod), city, hgt |
| `ui/overlay.js` | 9 | start/pause overlay, pointer lock, `?autostart` query param | main |
| `sim/pp.js` | ~110 | **the bridge**: wasm load, PPState views, shims (`sea`, `updateSea`, `hgt`, `createWind`), `BUILD_TAG` | WASM |
| `sim/sea.js` | 65 | JS reference sea (f64): dispersion, P–M spectrum, τ-chase, drift, mod field (seed 777), `hgt`. The `sea` export carries `MOD`/`MOD_SIZE` (fallback foam-texture contract) | shaders (must match) |
| `sim/wind.js` | 42 | JS reference wind: breathing mean, log profile, advected gust noise, building wake, `x/y/z` = last `at()` result (rain contract) | sim/pp (interface twin) |
| `style.css` | — | overlay, vignette, grain | — |

Boot order in `main.js`: `initPP` → stage → `PP.scene/camera` registered → sky/ocean/lights →
textures/city → rain → atmosphere → audio → `wind.setObstacles(city.bl)` → input → drone →
human (spawned on the **tallest roof** — open water at spawn flips the FSM into Swim and the
keyboard feels dead) → overlay → frame loop. HMR: `import.meta.hot.dispose` aborts the
`AbortController` (all listeners take `{signal}`), disposes textures/uniforms/audio/stage.

Known wart: `flight/drone.js` is the live module; a stale `PPE-graphics/drone.js` (no importers)
was moved to `old/` during restructuring.

---

## 5. Module map — PPE-physics (Rust)

| path | lines | role |
|---|---|---|
| `src/lib.rs` | ~160 | ABI: `PPState` layout (§2.1), all exports, `sync()` (state → block once per step). `static mut` access via `addr_of_mut!` (2024 edition) |
| `src/sea.rs` | 226 | sea model, f64 inside: 7 bands `K=[0.045…2.3]`, `NMOD=5` rendered bands, P–M ratios (long 0.45–2.2, short 0.6–1.5), τ≈150 s amplitude / 70 s direction chase, drift ≈ 3% of wind, 256×256 mod field (R envelope, G phase, seed 777), `hgt()`, `slope()`, `water_motion()` (Stokes net transport + oscillatory surge) |
| `src/wind.rs` | 177 | weather: `u10` breathes (410 s, 97 s periods, ±22%/10%), dir wanders (530 s, 151 s), log profile `z0=0.02`, two-octave value-noise gusts advected by the wind itself, 4 building effects (wake deficit, stagnation+upwash front, corner speed-up, roof-height fade), `at()` returns `{x,y,z,g}` |
| `src/rng.rs` | 52 | JS-compatible RNG and hash. **Logical shifts only** (`>>>` semantics on `u32`) |

There is no `human.rs` — the human body is JS-side (`flight/human-phys.js`), like the drone.
The archived Rust version lives in `old/human-rs-archived.rs` for reference.

Build: `make wasm` → `PPE-physics/scripts/build.sh` drives `rustc` directly to
`wasm32-unknown-unknown` (`--edition 2021`; Homebrew cargo may not see rustup std;
`RUST_TC=<toolchain>` overrides) → output to `PPE-graphics/sim/pocket_physics.wasm`
(~118 KB). Dev-server no-cache middleware keeps stale cores out of the browser; the
`pp-wasm-ship` vite plugin copies it into `dist/` on build.

---

## 6. The sea model (shared truth)

`sea.rs` is a line-by-line port of `sim/sea.js`, and both mirror the GLSL in
`shaders/ocean.js`:

- dispersion `ω² = g·k` over 7 wave bands `K = [0.045 … 2.3]`;
- Pierson–Moskowitz spectrum: long bands grow with wind (`ratio` clamped 0.45–2.2),
  short bands saturate (0.6–1.5);
- the sea chases the wind slowly: amplitude τ ≈ 150 s, direction τ ≈ 70 s;
- drift current ≈ 3% of wind speed (velocity, not accumulated);
- group modulation and crest bending come from a tiled 256×256 RGBA noise field
  (R = envelope, G = phase shift), generated from seed 777, sampled bilinearly in both
  the shader and `hgt()`.

`hgt(x, z, t)` in Rust and `H()` in GLSL must stay formula-identical: buoyancy, camera bob
and the visible surface all come from it. `waterMotion()` (JS, in `human-phys.js`, over the
same `w1/w2/w3`) powers the swimmer carry: Stokes net transport × `CARRY_GAIN` × sea-state gate
+ wind drift; the oscillatory surge feeds shake/tilt, not position.

## 7. The wind model

One field for drone, rain, clouds, sea and audio:

- mean `u10` breathes on long periods (410 s, 97 s); direction wanders (530 s, 151 s);
- logarithmic profile `u(y) ∝ ln(y/z0)`, `z0 = 0.02`;
- gusts are two-octave value noise **advected by the wind itself** (`adv` origin), so gusts
  travel with the weather rather than flickering in place;
- buildings produce four effects: wake deficit behind, stagnation + upwash in front,
  side acceleration around corners, wake fades above roof height;
- `g` (gustiness 0–1) is stored back into `PP_STATE.wind[3]` and `at_out[3]` so drone, rain and
  audio read the same value the last `at()` computed.

Obstacles come from `city.bl` (AABB list): JS writes `{x, z, hw, hd, top}` per building into
`PP_STATE.obst` and calls `pp_set_obstacles(count)` (clamped to `MAX_OBST = 4096`).

---

## 8. Invariants (break these and the game dies)

1. **No allocations after `pp_init`.** Growing linear memory detaches every JS view —
   `Float32Array` reads return `undefined`, three.js `flatten()` throws
   `firstElem.toArray is not a function`. The obstacle buffer is preallocated to `MAX_OBST`
   in `Wind::new()` and filled with `clear()+push`, never `collect()`.
2. **No double unwrapping.** `updateSeaPP(dt, wind)` reads `wind.t` itself and calls
   `pp_step(dt, t)` — the second argument is **sim time**, never wind speed. Passing
   pre-unwrapped numbers sends `undefined` into an f32 param → `NaN` → the whole
   `w1` uniform becomes NaN. Guarded by the Rust golden wind-clock test.
3. **Logical shifts in the RNG port.** JS `>>>` is unsigned; Rust `>>` on `i32` is arithmetic.
   `rng.rs` does shift math on `u32`. Get this wrong and the sea silently runs on a different
   seed — waves still render, they just don't match the reference.
4. **f64 inside, f32 at the border.** Rust computes in f64 like JS numbers; only the PPState
   arrays are f32, matching the `Float32Array` views. Golden tests allow ~1e-7 there.
5. **three.js stays at 0.128.0.** Lighting and shaders are tuned to its color space; physical
   light units changed in r155.
6. **Offsets change together.** Any `PPState` field change ⇒ `lib.rs`, `pp.js` (`PP_OFF`),
   and `BUILD_TAG` bump in the same commit.
7. **Mouse deltas ≠ absolute course.** `input.look.yaw/pitch` are deltas; each body (drone
   and human alike) accumulates its own absolute yaw/pitch. Never overwrite one with the other.

## 9. Testing strategy

Layered, all runnable without a browser except the last:

| layer | command | what it proves |
|---|---|---|
| L1 golden | `npm test` (`test/sim.test.mjs`) | 14 checks on the JS reference model: waves run downwind, rms height in range, modulation tiles seamlessly, sea responds to wind, wind profile grows with height, wake/stagnation/speed-up around buildings, noise statistics |
| L1 golden (Rust) | `cd PPE-physics && cargo test` (`tests/sim.rs`) | the same checks ported, **plus** `golden_state_matches_js_dump`: `w1/w2/w3/ratio` and 20 `hgt()` probes bit-for-bit against `tests/golden.json`, **plus** `golden_wind_clock_matches_js_dump`: the wind clock over 600 s of variable-dt steps matches the JS dump (ABI guard for `pp_step(dt, t)`) |
| L1.5 edge | `cargo test` (`tests/edge.rs`) | `MAX_OBST` boundary, zero-wind sea stability, `hgt` finite over 5000 random probes |
| L2 integration | `node test/integration.mjs` | the WASM contract itself: layout offsets, view liveness, the no-alloc invariant, full per-frame call sequence |
| L2.5 fallback | `node --test test/fallback.test.mjs` | the JS-fallback contract: `sea.MOD`/`MOD_SIZE` on the sea object (foam texture), `wind.x/y/z` on the reference wind (rain), `hgt` finite |
| L3.5 wrapper | `node test/human-model.mjs` | the human model through the **real `createHumanPhys()`** on the WASM sea: spawn, roof walk, fall→Swim, calm/storm swim, head floor, jump apex, crouch |
| L4 smoke | `node test/smoke.mjs` | a full game session emulated in Node: spawn on roof, walk/run, jump, fall into water, swim, storm, 5-minute stability — with realistic input scripts |
| manual | `node` + browser at `test/pp-test.html` | boots the core, prints live `w1/w2/w3`, obstacle flow, 5000-step timing |

`test/golden.json` and `PPE-physics/tests/golden.json` are identical copies; regenerate with
`node test/dump_golden.mjs > PPE-physics/tests/golden.json`.

**Change a formula ⇒ change it in `sea.rs`/`wind.rs`, `sim/sea.js`/`sim/wind.js` and the GLSL in
`shaders/ocean.js` at the same time, then re-dump `golden.json`.**

## 10. Rendering notes

- Static city geometry is merged into few draws (`mergeBufferGeometries`); animated things
  (ocean, rain, sky) stay separate meshes.
- Shader meshes strip unused attributes via `slim()`.
- The ocean mesh re-centers on the active body in 4 m steps; the wave field is evaluated in
  world space, so the snap is invisible.
- All audio is synthesized (WebAudio): wind noise filtered by state, low rumble, splash
  transients. No sample files.
- Target: 60 fps on a laptop. Rain and waves are the first candidates for simplification.
- The ocean/sky meshes follow the **active** body (drone or human), not always the drone.

## 11. Diagnostics & observability

- `core/log.js`: ring buffer mirrored to `window.__ppLog` and POSTed to the dev server every
  2 s (and immediately on error). `curl http://localhost:5173/__log` reads the browser log
  without opening the page. Levels: `debug < info < warn < error`.
- `vite` plugin `pp-log-endpoint` (`PPE-server/vite.config.js`): `POST /__log` appends,
  `GET /__log` returns everything (ring of 2000 lines).
- `vite` plugin `pp-wasm-no-cache`: `Cache-Control: no-store` on the `.wasm` URL.
- `test/pp-test.html`: manual page printing live PPState values after boot.

## 12. Where the project is going

**Current release: v0.5 Tech Demo** (2026-11-03). Live acceptance passed: WASM core boots,
both bodies playable, sea/wind/rain/audio verified in the browser. The P0/P1 audit fixes
(ABI clock, crouch crash, wasm shipping, fallback contracts) are in and guarded by tests.

The design targets (operator body, drone claw, floating container, two-body switching, shadow
entities, the leviathan) live in the git history and the audit notes. The Rust core
covers the environment (sea + wind); bodies are JS and read it through one interface. New
body-physics systems (claw, container physics, interiors) go into JS following the
human-phys/drone pattern; only if a body simulation becomes compute-heavy does it migrate to
Rust — behind the same read-only-buffer contract, never through PPState body fields.
