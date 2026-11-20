# POCKET PLANES EXPEDITION (PPE) — Concept

Working title: **Pocket Planes Expedition (PPE)**. Build codename: `flooded-city-vite`.

**Project intent: hard immersive survival in another dimension.** The ocean is merciless and
follows only its own physics — no player-favoring bias, ever.

This document is the design canon. It records the one gameplay loop the game is built around,
the three presences that share the world, and the technical frame that already exists — Vite +
three.js r128, a Rust/WASM core, layered tests.

**The Rust course.** The target frame is simulation in Rust/WASM: the environment (sea + wind)
and the entity already live in Rust and hand clean data to the renderer through a zero-copy
shared memory block. Rendering stays on three.js. Bodies (drone, operator) are JS modules
reading the environment through one interface; they migrate to Rust only if they become
compute-heavy. The GLSL shader receives the same wave constants as the physics core — physics
and render stay in sync.

---

## 1. Fantasy

The player — an operator in a clumsy orange rescue suit — and their drone companion end up in a
**pocket dimension**: a scrap of a world flooded by the ocean. The city stands chest-deep in
water, under an eternal night with a moon and lightning. The world is closed.

This is not a shooter and not a race. This is **exploration through the body**: you constantly
feel that your body is heavy and wet, and the drone's body is light and fragile. The same task
is solved by two different bodies, and switching between them is the main verb of the game.

**The drone is flown through a neural link.** That is why body switching is a jump — a cut, not
a flight of consciousness: the link simply moves the operator's presence into the other body.

**Navigation does not work.** Maps, compass and GPS are dead in a pocket dimension. The only
way to orient between the operator and the drone is **physical search through switching**: fly
up, look around, remember a landmark, switch, walk there, lose the landmark, switch back. The
two bodies are each other's only map.

---

## 2. The loop

**Find the portal → take the key → activate the portal → drag the operator in.**

1. **Find the portal.** One window in one building in the middle of the city burns with warm
   light — the only warm light in a world of cold moonlight. That window is the portal, and it
   is inactive.
2. **Take the key.** The key is inside the entity. The drone flies in, hooks it with the claw
   and tears it out. From that second the entity is hunting the drone and does not let go.
3. **Activate the portal.** The drone carries the key to the window. The portal opens: it
   expands into a large square filled with warm light.
4. **Drag the operator in.** The drone grabs the operator and hauls them into the portal while
   the entity tries to stop it.

That is the whole game. Nothing else is required.

**The key is the only object that can be lost.** Once the claw has picked it up, a dropped key
does not return to the entity: it falls into the water, floats and rocks on the waves, and
drifts. Picking it up again is a search problem in an ocean that does not care.

---

## 3. Entities

### 3.1 Drone

An orange FPV quadcopter, modern, with a gimbal. Already implemented: inertia, wind gusts,
roll from yaw rate, camera shake from impacts, FOV breathing with speed. Flies over the water,
collides with building AABBs.

**Manipulator claw.** Underslung, two degrees of freedom plus a grab.
- LMB held — the claw follows the mouse: horizontal mouse motion yaws the wrist, vertical
  motion pitches it. Limits ±60° on both axes, slew rate limited (the claw has mass, it does
  not teleport).
- RMB click — close / open. The grab is binary but with force: a light object holds, a heavy
  one slips at overload.
- The claw cannot extend past reach (0.9 m) — hard stop.
- The claw is a physical body: it bumps walls, can snag rebar and pull the drone.

**Carrying the operator.** The claw closes on the operator's suit and the drone lifts them. The
load changes the flight: the operator's mass cuts max thrust, roll is limited, wind pushes
harder. Carrying a person across open water is a route planning problem, not a reflex test.

**Carrying the key.** The key is light and holds well in the claw. It is the one object the
drone must never drop — and the one it will drop when the entity hits it.

### 3.2 Operator

A human in a rescue-diver suit. Orange shell, black visor. Physics is not flight but a
**heavy walk**: mass, acceleration and braking inertia, steps that slip on wet metal.

**Movement (implemented):**
- Walk 1.6 m/s, run on Shift 4.2 m/s with ~0.6 s ramp and ~1.2 m braking distance.
- Jump on Space: 1.1 m apex, landing with a camera dip and a dull thud.
- The suit is clumsy: narrow passages, ladders and hatches are obstacles, not decoration.

**Visor (implemented):**
- **Open** — normal vision: full color, sharp, everything audible. Breathing is fine while the
  head is above water.
- **Closed** — helmet effect: narrowed periphery, warm tint, breathing in the ears, muffled
  outside sound, condensation on the glass under load.
- **Fell into water with the visor open** — water got inside. 2.5 seconds to close the visor
  or get out. Too late — drowning. Drowning is not instant: cough and panic in the sound first,
  then darkening, then respawn at the last dry point.

**Swimming (implemented).** The suit is puffy and unsinkable: with the visor closed the operator
**floats** — head above the surface, arm strokes, slow 0.9 m/s motion. Diving is impossible; you
can only submerge to the chest. Water is not death, water is a medium where you are helpless and
slow. Death is water **inside** the suit.

**Crouch (implemented).** `C` — crouch / stand, toggled. In crouch the center of mass is lower,
the camera drops, steps are shorter and quieter. In crouch you don't fall off a roof edge — at
the edge the body stops; you can lean over and look down, you cannot slip off.

**In the loop.** The operator is the payload. They cannot open the portal, cannot reach the key,
and cannot outrun the entity. Their only way out is the drone.

### 3.3 Entity

A flying colony of cells — the anomaly. Implemented in Rust: 1500 SPH cells with their own
static and their own ABI, a skeleton, tendrils, and a brain with `aggro / encircle / grab /
squeeze` states. It hunts the drone, grabs it, squeezes it.

**Palette.** Four discrete levels, canonical: coal / dark blood / red / ember. Brightness is
driven by real speed — faster is brighter. The palette is fixed; it is not a gradient.

**The key sits in its middle.** The key is not a part of the entity and the entity is not built
around it: the colony simply holds it at its approximate centre, the way a body holds something
swallowed, so that it never falls out. The brain does not know the key exists.

**Aggro.** Once the key is stolen, aggro locks onto the drone and does not fall off. The entity
follows the thief across the city and through the whole run to the portal, and it interferes
with the last step — the drone hauling the operator in.

### 3.4 Key

A cube the colour of the warm light in the portal window. It sits at the entity's centre, held
there by the entity itself.

- Taken only by the drone's claw.
- Once taken, it never returns to the entity.
- Dropped, it falls into the water and **floats and rocks on the waves**, drifting with wind and
  current like anything else in this ocean.
- Held to the portal, it opens it.

### 3.5 Portal

One window in one building in the middle of the city, burning with warm light — the only warm
light in the world. Inactive until the key arrives.

- **Inactive:** a single lit window. A landmark, nothing more.
- **Active:** expands into a large square filled with warm light — the exit.
- The operator must be carried through it by the drone. Walking in is not the loop.

---

## 4. Interaction matrix

| | Drone | Operator | Entity | Key | Portal |
|---|---|---|---|---|---|
| **Drone** | — | grab and carry | hunted by it, grabbed and squeezed | claw grab, carry, can drop | opens it with the key |
| **Operator** | carried | — | cannot fight it | cannot reach it | cannot enter alone |
| **Entity** | hunts the thief | ignores | — | holds it as its center | — |
| **Key** | held in the claw | — | its core | — | activates |

The key rule: **no body can do everything**. The drone cannot walk into the portal, the operator
cannot take the key, and the entity cannot be fought — only outrun.

---

## 5. Controls

### Drone
| Input | Action |
|---|---|
| Mouse | heading and pitch |
| W / S | thrust forward / back |
| A / D | strafe |
| Space / Shift | up / down |
| Arrows, Q / E | yaw |
| LMB (hold) | manipulator follows the mouse |
| RMB (click) | close / open the claw |
| Esc | pause |

### Operator
| Input | Action |
|---|---|
| W A S D | walk |
| Shift | run |
| Space | jump |
| Q / E | lean left / right |
| C | crouch / stand (on / off) |
| V | visor: open / close |
| Esc | pause |

### Body switching
`Tab` — switch between drone and operator. The switch is not instant: the camera flies an arc,
the sound changes, the drone body stays where it was and hovers by its own rules. An unattended
operator stands and breathes.

---

## 6. World (implemented)

A flooded city in a pocket dimension: ~95 buildings from a deterministic seed, merged geometry,
procedural facades, beacons, an ocean on 7 wave bands with one model for physics and render, a
night sky with fbm clouds, moon, lightning, rain on 3200 lines, synthesized sound with not a
single sample.

The ocean is honest: wind, current and waves with zero player-favoring bias. Anything that
floats drifts.

---

## 7. Technical notes

- Frame: Vite + three.js r128, pinned on purpose — shaders and lighting are written for its
  color space. Do not upgrade without a reason.
- **Rust/WASM core (current):** the environment — sea + wind — and the entity are Rust compiled
  to WASM, exposed through a `#[repr(C)]` state block (environment) and a separate static with
  its own ABI (entity). JS builds typed-array views once and only reads them per frame. Bodies
  and collisions are JS.
- Waves: one model in Rust, JS reference and GLSL — the source of truth for physics and render.
  Key buoyancy and camera bob on water are computed from the same model.
- Collisions: building AABBs exist. The operator has a capsule collider; the drone needs a
  sphere with the claw as a separate body.
- Physics: own integrator, no external engine. Mass, drag, buoyancy — numbers, not scripts.
- States: a finite automaton per body — `ground / jump / swim` for the operator,
  `fly / hover / carry / damaged` for the drone.
- Sound: keep synthesizing. The suit is a filter: a closed visor muffles the outside world and
  adds breathing.
- Performance: 60 fps on a laptop. Rain and waves are the first candidates for simplification.

---

## 8. Stages

1. **Operator body** — capsule, walk, run, jump, crouch, swim, visor, drowning. ✅ shipped in v0.5
2. **Entity** — SPH colony, brain, aggro, grab, squeeze, palette. ✅ shipped
3. **Link** — body switching. ✅ shipped in v0.5
4. **Claw** — manipulator, grab, reach, force limit. — not implemented
5. **Key** — the cube as the entity's center, claw pickup, drop, buoyancy and drift on the
   waves, re-pickup. — not implemented
6. **Portal** — the warm window, the inactive state, activation by the key, the expansion into a
   square of warm light. — not implemented
7. **Carry the operator** — claw grab on the suit, load on the flight, hauling into the portal.
   — not implemented
8. **Aggro lock** — the entity follows the thief to the portal and interferes with the last step.
   — partial (aggro exists, the lock on the key does not)
9. **Polish** — sound, HUD, pause, respawn, performance. — partial

---

## 9. Open questions

- Drowning: respawn at the last dry point, or lose the run?
- Drone: self-repairs, or requires the operator to reach it?
- Does the entity keep hunting after the portal opens, or does it break off at the threshold?
- A dropped key drifts: how far is too far before the run is effectively over?
- What happens to the operator if the drone is destroyed mid-haul?
