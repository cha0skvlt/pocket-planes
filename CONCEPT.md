# POCKET PLANES EXPEDITION (PPE) — Concept

Working title: **Pocket Planes Expedition (PPE)**. Build codename: `flooded-city-vite`.

**Project intent: hard immersive survival in another dimension.** The ocean is merciless and
follows only its own physics — no player-favoring bias, ever. The game is built for the long
run: this document is the seed of real game-loop mechanics that the project will grow into.

This document records the design intent, entities, physics and controls. The technical frame
already exists — Vite + three.js r128, a Rust/WASM core, layered tests. Everything below is a
layer on top of it, not a rewrite.

**The Rust course.** The target frame is simulation in Rust/WASM: the environment (sea + wind)
already lives in Rust and hands clean data to the renderer (wave arrays, wind field) through a
zero-copy shared memory block. Rendering stays on three.js — it is written and works. Bodies
(drone, operator) are JS modules reading the environment through one interface; they migrate to
Rust only if they become compute-heavy. The GLSL shader receives the same wave constants as the
physics core — physics and render stay in sync.

---

## 1. Fantasy

The player — an operator in a clumsy orange rescue suit — and their drone companion end up in a
**pocket dimension**: a scrap of a world flooded by the ocean. The city stands chest-deep in
water, under an eternal night with a moon and lightning. The world is closed: the horizon wraps
around, beyond the border the same city stands, only farther and quieter.

This is not a shooter and not a race. This is **exploration through the body**: you constantly
feel that your body is heavy and wet, and the drone's body is light and fragile. The same task
is solved by two different bodies, and switching between them is the main verb of the game.

The core loop: **find → reach → carry → open**. The drone sees what a person cannot squeeze
into. The operator retrieves what the drone cannot lift. The container is the one object both
can handle — and the only way to move anything anywhere.

**The main enemy is the weather.** Not a monster, not a trap: wind and waves. A storm surge
carries objects — and the operator — out of the city into the open ocean. The ocean is
**infinite and merciless**: it follows only its own physics — wind, current, waves — with zero
player-favoring bias. An item is not simply "lost" — it has sailed off who-knows-where into
the anomalous ocean of the pocket dimension. By some miracle — moving both drone and operator
without ever breaking the link — you can find it again. But that is a genuine miracle; the
game mechanics do not help you. The player is permanently balancing between controlling
objects that drift and sail away without their direct participation. Every item left
unattended is already leaving. That slow, indifferent loss — watching the container become a
dot between the waves — is the horror of this game. Hard immersive survival in another
dimension.

**The drone is flown through a neural link.** That is why body switching is a jump — a cut,
not a flight of consciousness: the link simply moves the operator's presence into the other
body. The link range is **large — roughly twice the size of the whole city** — so a panicking
player can fly the drone into the open ocean hunting for a drifting operator. But when the
link is severed by distance, it is severed for good: the drone is **lost forever**, and the
player remains only the operator. At that moment a message slides in at the bottom of the
screen, in the game's style, white text, as if from the operator himself:

> Connection to drone lost... Looks like this is the end.

**Navigation does not work.** Maps, compass and GPS are dead in a pocket dimension. The only
way to orient between the operator and the drone is **physical search through switching**:
fly up, look around, remember a landmark, switch, walk there, lose the landmark, switch back.
The two bodies are each other's only map.

---

## 2. Genre and tone

**A walker with a commute.** Not action, not a puzzle — a game about the route. About walking
the same path again and again because there is no other, and gradually noticing that the path
has changed. The core is exploring a complex parallel space looking for a way out of the
location.

**Liminal quiet.** Empty corridors that should have been full. Light that burns for no reason.
Steps heard with a delay. Nothing attacks — the world is simply built wrong, and you feel it in
your body before you understand it. The unease is not a monster; it is that you don't remember
how you got here and aren't sure you left.

---

## 3. Entities

### 3.1 Drone

An orange FPV quadcopter, modern, with a gimbal. Already implemented: inertia, wind gusts,
roll from yaw rate, camera shake from impacts, FOV breathing with speed. Flies over the water,
collides with building AABBs.

**To be added:**

**Manipulator claw.** Underslung, two degrees of freedom plus a grab.
- LMB held — the claw follows the mouse: horizontal mouse motion yaws the wrist, vertical
  motion pitches it. Limits ±60° on both axes, slew rate limited (the claw has mass, it does
  not teleport).
- RMB click — close / open. The grab is binary but with force: a light object holds, a heavy
  one slips at overload.
- The claw cannot extend past reach (0.9 m) — hard stop.
- The claw is a physical body: it bumps walls, can snag rebar and pull the drone.

**Landing.** The drone lands if it touched a flat surface belly-first with vertical speed below
a threshold. A hard touch — bounce and prop damage (thrust loss). On a landed drone the claw
works at full reach, but the drone does not fly. Takeoff — thrust up.

**Cargo carry.** A container attached to the claw changes the flight: cargo mass cuts max
thrust, roll is limited, wind pushes harder. A heavy container over open water is a route
planning problem, not a reflex test.

**Anchoring.** `C` — the drone grips the surface it stands on: stops reacting to wind and
gusts, does not drift. Toggle: press once — anchored, press again — free. An anchored drone
works the claw at full reach and can pull cargo, but does not fly. The answer to wind is not to
fight it with thrust but to grow into the concrete.

**Damage.** Hitting concrete at speed, a lightning strike in the open, submersion (water above
the props) — thrust loss, flickering, emergency landing. The drone does not "die"; it breaks
and recovers at the nearest rest point.

**Damage and hitboxes.** Both bodies have a health bar and a hitbox. Hitting a wall hurts both:
the drone is fragile (a hard impact breaks props, a few hits ground it), the operator is beefier
but waves can smash them against a wall in a few hits. Storm surf is the deadliest thing in the
game: it does not kill directly — it throws the body, and the wall or the open ocean finishes
the job. Floating objects need dedicated push physics: waves must carry them away **fast** —
watching your container sail off beyond reach is the threat and the horror at once.

**Drone energy.** The drone flies indefinitely, but carries a cargo-energy bar: it drains while
lifting cargo and regenerates on its own when empty. Carrying the **operator costs twice** the
energy of carrying the container. The balance target: the drone can lift the operator onto low
and mid-rise buildings, but never onto the tallest ones — the last floors of the skyline are
reachable only on foot, through the rain and the wind.

### 3.2 Operator

A human in a rescue-diver suit. Orange shell, black visor. Physics is not flight but a
**heavy walk**: mass, acceleration and braking inertia, steps that slip on wet metal.

**Movement:**
- Walk 1.6 m/s, run on Shift 4.2 m/s with ~0.6 s ramp and ~1.2 m braking distance.
- Jump on Space: 1.1 m apex, landing with a camera dip and a dull thud.
- The suit is clumsy: narrow passages, ladders and hatches are obstacles, not decoration.

**Visor:**
- **Open** — normal vision: full color, sharp, everything audible. Breathing is fine while the
  head is above water.
- **Closed** — helmet effect: narrowed periphery, warm tint, breathing in the ears, muffled
  outside sound, condensation on the glass under load.
- **Fell into water with the visor open** — water got inside. 2.5 seconds to close the visor
  or get out. Too late — drowning. Drowning is not instant: cough and panic in the sound first,
  then darkening, then respawn at the last dry point.

**Swimming.** The suit is puffy and unsinkable: with the visor closed the operator **floats** —
head above the surface, arm strokes, slow 0.9 m/s motion. Diving is impossible; you can only
submerge to the chest. This is fundamental: water is not death, water is a medium where you are
helpless and slow. Death is water **inside** the suit.

**Crouch.** `C` — crouch / stand, toggled. In crouch the center of mass is lower, the camera
drops, steps are shorter and quieter. Main point: **in crouch you don't fall off a roof edge**
— at the edge the body stops; you can lean over and look down, you cannot slip off. Stand up —
the protection is gone, and wind and wet concrete may kill you again.

**Hands.** Strictly one item in hand at a time. Take, carry, lift overhead, throw. The throw is
heavy and short — the suit does not allow a wind-up. A thrown or dropped item floats and sails
away like any other object — the water does not care what it carries.

### 3.3 Container

Rectangular, sealed, orange marking. **Floats on the water** — positive buoyancy, rocks on the
waves, drifts with wind and current. Can be pushed while swimming.

- **The container is the inventory.** All items and tools live inside it and are taken strictly
  one at a time into the hands. No backpack, no pockets: what is not in the container is not
  yours anymore.
- Carried by the operator in hand or by the drone on the claw.
- Lifted, placed, thrown. A fall from height — a hollow boom, contents rattling.
- An empty container is lighter and holds the claw better; a full one is heavier and slips.
- The container is the one object that passes through all three carriers: the drone carries
  it, the operator carries it, the water carries it. It is the gameplay link — and the single
  point of failure: lose the container, lose everything.

### 3.4 Raft

A later addition: an **inflatable raft with a paddle** — the operator's floating base.
- Carries the container and the operator across open water.
- **Grapple anchor**: hooks onto a building's wall (like a grapple hook) so the raft does not
  drift away while the operator is inside a building or underwater.
- Unanchored, it behaves like everything else: the wind takes it, and with it the inventory
  and the way home.

---

## 4. Interaction matrix

| | Drone | Operator | Container |
|---|---|---|---|
| **Drone** | — | ferry ride, scouting from above, cargo drop | claw grab, carry, land on the lid |
| **Operator** | receive cargo, send to scout | — | take in hand, carry, throw, push afloat |
| **Container** | cargo, weighs the flight down | 1–2 item inventory | floats, drifts, rocks |

The key rule: **no body can do everything**. The drone does not open heavy hatches, the
operator does not fit into ventilation, the container does not fly by itself.

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
| F | land / take off |
| C | anchor to the surface (on / off) |
| Esc | pause |

### Operator
| Input | Action |
|---|---|
| W A S D | walk |
| Shift | run |
| Space | jump |
| Q / E | lean left / right |
| LMB | take / throw |
| RMB | open container |
| C | crouch / stand (on / off) |
| V | visor: open / close |
| Esc | pause |

### Body switching
`Tab` — switch between drone and operator. The switch is not instant: the camera flies an arc,
the sound changes, the drone body stays where it was and hovers/lands by its own rules. An
unattended operator stands and breathes.

---

## 6. World

A flooded city in a pocket dimension. Already there: ~95 buildings from a deterministic seed,
merged geometry, procedural facades, beacons, an ocean on 7 wave bands with one model for
physics and render, a night sky with fbm clouds, moon, lightning, rain on 3200 lines,
synthesized sound with not a single sample.

**To be added:**
- **Pocketness** — the horizon wraps around; beyond the border the same city. Borders are not
  walls but fog and water.
- **The exit** — not a door at the end of the map but a condition: gather what is needed, get
  to the right point, be there at the right moment. Until then the city holds.

## 7. Dynamic weather

Weather is a system, not a backdrop — and the main antagonist (see §1). Planned progression:

- **Dynamic weather cycles** — the storm breathes, builds and recedes on its own schedule;
  wind, waves, rain and cloud cover move together.
- **Catastrophic surge** — the storm escalates to tsunami scale: the ocean rises and floods the
  world up to the roofs of the tallest buildings. The city map changes under the player: routes
  drown, new ones open at roof level.
- **Snow** — a cold front turns the rain into snow; the world whitens, sound deadens.
- **Near-zero visibility** — the moon hidden behind clouds and weather; fog so thick that
  landmarks disappear and the two-body navigation (§1) becomes the only way to move.
- **Anomalous phenomena** — rare events outside the normal weather cycle. To be designed.

The weather system must be controllable (a `PPControl`-style block of regulators: storm master,
wind, waves, foam, rain, visibility) so these states can be scripted, driven by a director AI,
or left to chance.

---

## 8. Technical notes

- Frame: Vite + three.js r128, pinned on purpose — shaders and lighting are written for its
  color space. Do not upgrade without a reason.
- **Rust/WASM core (current):** the environment — sea + wind — is Rust compiled to WASM,
  exposed through a `#[repr(C)]` state block; JS builds typed-array views once and only reads
  them per frame. Bodies and collisions are JS. Order of migration if needed: bodies → city
  colliders, behind the same read-only-buffer contract.
- Waves: one model in Rust, JS reference and GLSL — the source of truth for physics and render.
  Container buoyancy and camera bob on water are computed from the same model.
- Collisions: building AABBs exist. The operator has a capsule collider; the drone needs a
  sphere with the claw as a separate body.
- Physics: own integrator, no external engine. Mass, drag, buoyancy — numbers, not scripts.
- States: a finite automaton per body — `ground / jump / swim` for the operator,
  `fly / hover / land / carry / damaged` for the drone.
- Sound: keep synthesizing. The suit is a filter: a closed visor muffles the outside world and
  adds breathing.
- Performance: 60 fps on a laptop. Rain and waves are the first candidates for simplification.

---

## 9. Stages

1. **Operator body** — capsule, walk, run, jump, crouch, swim, visor, drowning. ✅ shipped in v0.5
2. **Claw** — manipulator, grab, reach, drone landing. — not implemented
3. **Container** — buoyancy, carry, inventory (one item at a time), throw. — not implemented
4. **Link** — body switching, cargo handoff, shared tasks. ✅ switching shipped in v0.5
5. **Floating physics** — items and container drift with wind and waves, push physics, loss
   into the open ocean. — not implemented
6. **Hitboxes and damage** — health bars for both bodies, wall impacts, surf damage. — not implemented
7. **Drone energy** — cargo-energy bar, operator carry ×2 cost, roof-height balance. — not implemented
8. **Raft** — inflatable raft, paddle, grapple anchor. — not implemented
9. **Dynamic weather** — cycles, catastrophic surge to roof level, snow, near-zero visibility,
   anomalies. — not implemented
10. **Polish** — sound, HUD, pause, respawn, performance. — partial

---

## 10. Open questions

- Drowning: respawn at the last dry point, or lose the cargo and return to the container?
- Drone: self-repairs, or requires the operator to reach it?
- Pocketness: does the city repeat literally, or change from run to run?
- What exactly counts as the exit from a location, and how many pocket layers must be crossed?
- Lost in the infinite ocean: **the ocean is merciless and follows only its own physics. No
  player-favoring bias, ever.** Drift is honest simulation — wind, current, waves. Hard
  immersive survival in another dimension.
- Surge flooding: the water both rises and recedes — dynamic storms and flooding. Cost is not
  a concern; the engine will handle it.
- Drone energy: does carrying the operator drain the bar continuously (hover-taxi) or per
  distance covered?