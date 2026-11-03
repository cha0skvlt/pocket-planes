// Human body physics — pure JS, no three, no WASM. Same pattern as the drone:
// the body lives in JS and reads the environment (sea) from the active model
// (WASM PPState proxy or the JS reference in sim/sea.js) — one interface.
//
// Design laws (game design, see git history):
// - Wind does NOT push the body horizontally (too heavy) — it only leans the torso.
// - The head can never go under the surface: buoyancy always wins (y_head >= h + 0.15).
// - Swimming is slow (0.9 m/s) and RELATIVE TO THE WATER. The water itself moves with
//   the wave orbital velocity, so a strong wave rolls the swimmer back along its own
//   trajectory no matter how hard he strokes. Loss of control is arithmetic, not a script.
// - The body rides the surface: vertical follows hgt, tilt follows the wave slope.

// capsule: feet at pos.y, head at pos.y + 1.7 (standing) / +1.0 (crouched)
export const STAND_H = 1.7, CROUCH_H = 1.0, RADIUS = 0.35;
// locomotion constants (game design)
export const WALK = 1.6, RUN = 4.2, SWIM_SPEED = 0.9;
export const ACCEL = 7.0;      // ground accel, m/s^2 (~0.6 s to run speed)
export const BRAKE = 3.5;      // ground decel, m/s^2 (~1.2 m stopping from run)
export const JUMP_V = 4.65;    // ~1.1 m apex
export const GRAV = 9.81;
// water interaction
export const HEAD_CLEAR = 0.15; // head floor above the surface
export const DRAFT = 0.55;      // how deep the buoyant suit sits (chest line)
export const WAIST = 0.9;       // water above this line (above ground) = swim, not walk
export const WATER_DRAG = 1.6;  // 1/s, exponential drag on swim velocity
// how much of the Stokes net transport the body inherits. The horror dial:
// in a calm the stroke wins (carry < SWIM), in a storm the sea decides.
export const CARRY_GAIN = 0.45;
export const SURF_PUSH = 1.4;   // extra push from breaking crests
export const TILT_MAX = 0.5;    // rad, body tilt from wave slope

export const GROUND = 0, JUMP = 1, SWIM = 2;

import { sampleMod, NMOD } from '../sim/sea.js';

/** Water motion felt by a floating body at depth `depth` below the surface,
 *  computed from the ACTIVE sea state (w1/w2/w3 — WASM or JS, same formulas).
 *  - Stokes drift (first pair): the NET forward transport, u_S = A²·ω·k·e^{-2k·depth}.
 *    Oscillations cancel for a heavy body; the net transport does not.
 *  - Oscillatory surge (second pair): A·ω·e^{-k·depth} — the local to-and-fro.
 *    The body feels it as shake/tilt, not as steady carry.
 *  Returns [[stokesX, stokesZ], [surgeX, surgeZ]]. */
export function waterMotion(sea, x, z, t, depth) {
  let sx = 0, sz = 0, ox = 0, oz = 0;
  const w1 = sea.w1, w2 = sea.w2, w3 = sea.w3;
  // NMOD bands (the rendered set), clamped to what the sea object actually carries
  const n = Math.min(NMOD, Math.floor(w1.length / 4));
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const dx = w1[o], dz = w1[o + 1], k = w1[o + 2], a = w1[o + 3];
    const om = w2[o], cg = w3[o];
    const kd = x * dx + z * dz;
    const m = sampleMod((kd - cg * t) * w2[o + 2] + w3[o + 1], (z * dx - x * dz) * w2[o + 3] + w3[o + 2]);
    const ph = k * kd + w2[o + 1] + (m[1] - 0.5) * 2 * w3[o + 3] - om * t;
    const amp = a * (0.45 + 1.1 * m[0]);
    const stokes = amp * amp * om * k * Math.exp(-2 * k * depth);
    sx += stokes * dx; sz += stokes * dz;
    const surge = amp * om * Math.cos(ph) * Math.exp(-k * depth);
    ox += surge * dx; oz += surge * dz;
  }
  return [[sx, sz], [ox, oz]];
}

/** Surface slope (dh/dx, dh/dz) via central differences of hgt. */
export function slope(hgt, x, z, t) {
  const e = 0.5;
  return [(hgt(x + e, z, t) - hgt(x - e, z, t)) / (2 * e),
          (hgt(x, z + e, t) - hgt(x, z - e, t)) / (2 * e)];
}

/** The human body: capsule FSM (Ground / Jump / Swim).
 *  sea: object with w1/w2/w3/Us/drift (the active model); hgt(x,z,t) — water height
 *  (WASM or JS); city: {bl} AABB list for ground height and capsule collision. */
export function createHumanPhys({ city, sea, hgt }) {
  const pos = { x: 0, y: 0, z: 0 }, vel = { x: 0, y: 0, z: 0 };
  let yaw = 0, pitch = 0;
  let state = GROUND, crouch = false;
  let waveHit = 0, tilt = 0, tiltDir = 0;

  // height of the solid floor under the body (city AABB top), -Infinity over open water.
  // The FSM needs the FLOOR, not the water: in deep water you always swim, on a roof you walk.
  function groundY(x, z) {
    let g = -Infinity;
    for (const b of city.bl) {
      if (Math.abs(x - b.x) < b.hw && Math.abs(z - b.z) < b.hd && g < b.top) g = b.top;
    }
    return g;
  }

  // Capsule (R=0.35, HEAD=1.7) vs building AABBs: push OUT on the shallowest axis,
  // no teleports. Roof landing (smallest axis = Y) sets feet to roof top without popping.
  function collide() {
    const R = RADIUS, HEAD = STAND_H;
    for (const b of city.bl) {
      const dx = pos.x - b.x, dz = pos.z - b.z;
      const insideX = Math.abs(dx) < b.hw + R, insideZ = Math.abs(dz) < b.hd + R;
      const overlapsY = pos.y < b.top && pos.y + HEAD > 0; // building sits on the waterline
      if (!(insideX && insideZ && overlapsY)) continue;
      const px = b.hw + R - Math.abs(dx), pz = b.hd + R - Math.abs(dz), py = b.top - pos.y;
      if (py < px && py < pz && py < HEAD) { // standing on the roof: land on top
        pos.y = b.top; if (vel.y < 0) vel.y = 0;
      } else if (px < pz) {
        pos.x = b.x + Math.sign(dx || 1) * (b.hw + R); if (vel.x * Math.sign(dx) < 0) vel.x = 0;
      } else {
        pos.z = b.z + Math.sign(dz || 1) * (b.hd + R); if (vel.z * Math.sign(dz) < 0) vel.z = 0;
      }
    }
  }

  const eye = () => crouch ? CROUCH_H : STAND_H;

  // ------------------------------------------------------------- ground
  function stepGround(dt, t, inp) {
    // No floor under the feet (open water / off a roof edge): the body cannot stand.
    // Either it is already in the water (swim) or it is airborne (fall). NEVER stay
    // Ground here — that is the Ground<->Jump flap that locks the body at the waterline.
    const floor0 = inp.groundY;
    if (floor0 === -Infinity) { state = JUMP; return; }
    const floor = Math.max(floor0, pos.y - 0.05); // never below current feet
    if (hgt(pos.x, pos.z, t) > floor + WAIST) { state = SWIM; vel.y = 0; return; }
    const speed = inp.crouch ? WALK * 0.55 : inp.run ? RUN : WALK;
    // desired horizontal velocity from input, in the SAME frame as the drone:
    // camera looks down -Z, so forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const dx = inp.fwd * -sy + inp.side * cy;
    const dz = inp.fwd * -cy + inp.side * -sy;
    const len = Math.hypot(dx, dz);
    let tx = 0, tz = 0;
    if (len > 1e-6) { const s = speed / len; tx = dx * s; tz = dz * s; }
    // accelerate toward the target (ground friction is strong)
    const a = len > 1e-6 ? ACCEL : BRAKE;
    vel.x += Math.max(-a * dt, Math.min(a * dt, tx - vel.x));
    vel.z += Math.max(-a * dt, Math.min(a * dt, tz - vel.z));
    // jump
    if (inp.jump) { vel.y = JUMP_V; pos.y += vel.y * dt; state = JUMP; return; }
    pos.x += vel.x * dt; pos.z += vel.z * dt;
    vel.y -= GRAV * dt; pos.y += vel.y * dt;
    if (pos.y < floor) { pos.y = floor; vel.y = 0; }
  }

  // ------------------------------------------------------------- air
  function stepAir(dt, t, inp) {
    // air control is weak: keep momentum, small steering (same frame as the drone)
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const dx = inp.fwd * -sy + inp.side * cy;
    const dz = inp.fwd * -cy + inp.side * -sy;
    vel.x += dx * ACCEL * 0.15 * dt; vel.z += dz * ACCEL * 0.15 * dt;
    vel.y -= GRAV * dt;
    pos.x += vel.x * dt; pos.y += vel.y * dt; pos.z += vel.z * dt;
    if (vel.y < 0) {
      // falling: the WATER catches first — feet at the surface = swim.
      // This is how a fall off a roof ends: not Ground, but Swim.
      if (pos.y <= hgt(pos.x, pos.z, t)) { state = SWIM; vel.y *= 0.3; return; }
      const floor = inp.groundY;
      if (floor !== -Infinity && pos.y <= floor) { pos.y = floor; vel.y = 0; state = GROUND; }
    }
  }

  // ------------------------------------------------------------- swim
  // The heart of it: you stroke against the WATER, and the water is busy
  // running its own wave trajectory. v_body = v_water + v_stroke.
  function stepSwim(dt, t, inp) {
    // stand up only when there is a floor and the water is below the waist above it.
    // In open water (no floor) you swim, period.
    const floor = inp.groundY;
    if (floor > pos.y - 1.0 && hgt(pos.x, pos.z, t) < floor + WAIST - 0.15) { state = GROUND; return; }
    // 1. water motion at the body. The heavy suit cancels the oscillatory surge
    //    (it becomes tilt/shake); what drags the body is the Stokes net transport
    //    + wind drift. The carry is gated by the sea state: in a calm the stroke
    //    wins, in a storm the sea decides.
    const [[stx, stz], [ogx, ogz]] = waterMotion(sea, pos.x, pos.z, t, DRAFT);
    // gate: the sea only drags the body when it is actually rough.
    // Us below ~9 m/s = swell you can fight.
    const gate = Math.max(0, Math.min(1, (sea.Us - 9.0) / 4.0));
    const waterX = stx * CARRY_GAIN * gate + sea.drift.x;
    const waterZ = stz * CARRY_GAIN * gate + sea.drift.z;
    // the oscillatory part feeds the shake channel (audio/view), not position
    const surgeMag = Math.hypot(ogx, ogz);
    waveHit = Math.min(1, waveHit + Math.max(0, surgeMag - 2.0) * dt * 0.5);
    // 2. stroke: slow, relative to the water (same frame as the drone)
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const dx = inp.fwd * -sy + inp.side * cy;
    const dz = inp.fwd * -cy + inp.side * -sy;
    const len = Math.hypot(dx, dz);
    let sx = 0, sz = 0;
    if (len > 1e-6) { const s = SWIM_SPEED / len; sx = dx * s; sz = dz * s; }
    // 3. total velocity = water carries the body + own stroke, with drag pulling
    //    toward the water velocity (you cannot hold still)
    const k = Math.min(1, WATER_DRAG * dt);
    vel.x += ((waterX + sx) - vel.x) * k;
    vel.z += ((waterZ + sz) - vel.z) * k;
    vel.y *= Math.max(0, 1 - 2 * dt);
    pos.x += vel.x * dt; pos.z += vel.z * dt;
    // 4. breaking crest push: when the local slope is steep, the crest throws the
    //    body down its face. A bias on the drag target, NOT raw acceleration
    //    (that would accumulate without bound).
    const [hx, hz] = slope(hgt, pos.x, pos.z, t);
    const steep = Math.hypot(hx, hz);
    if (steep > 0.35) {
      const push = Math.min(1, steep - 0.35) * SURF_PUSH;
      const inv = 1 / Math.max(1e-6, steep);
      vel.x += hx * inv * push * WATER_DRAG * dt;
      vel.z += hz * inv * push * WATER_DRAG * dt;
      waveHit = Math.min(1, waveHit + push * dt * 2);
    }
    // hard clamp: the body is a floating object, not a projectile
    const v2 = vel.x * vel.x + vel.z * vel.z, vmax = 12;
    if (v2 > vmax * vmax) { const s = vmax / Math.sqrt(v2); vel.x *= s; vel.z *= s; }
  }

  // the sea plays with the body, in every state
  function wavePlay(dt, t) {
    const h = hgt(pos.x, pos.z, t);
    // HEAD FLOOR first, unconditionally: eye height above the surface. In Ground/Jump
    // the body stands on the floor; if the water rises above the eyes, the body is
    // LIFTED by buoyancy (the suit floats) — the state machine catches up next frame,
    // but the camera never dips under.
    const eh = eye(), floor = h + HEAD_CLEAR;
    if (pos.y + eh < floor) { pos.y = floor - eh; vel.y = Math.max(0, vel.y); }
    const [hx, hz] = slope(hgt, pos.x, pos.z, t);
    const s = Math.min(1, Math.hypot(hx, hz));
    if (state === SWIM) {
      // ride the surface: chest line sits DRAFT under the crest line
      const targetY = h - DRAFT, k = Math.min(1, 10 * dt);
      pos.y += (targetY - pos.y) * k;
      // re-apply the head floor after the spring (the spring may pull down)
      if (pos.y + eh < floor) { pos.y = floor - eh; vel.y = Math.max(0, vel.y); }
      tilt = Math.min(TILT_MAX, s * TILT_MAX);
      tiltDir = Math.atan2(hz, hx);
      waveHit = Math.max(0, waveHit - dt * 0.8);
    } else {
      // on ground/air: only the tilt hint from nearby water remains
      tilt = s * TILT_MAX * 0.3;
      tiltDir = Math.atan2(hz, hx);
      waveHit = Math.max(0, waveHit - dt * 0.8);
    }
  }

  /** One physics step. dt is clamped by the caller (main.js clamps to 50 ms).
   *  inp: {fwd, side, run, jump} — crouch is a property of the body (set crouch).
   *  groundY is computed here from the city AABBs — no caller plumbing. */
  function step(dt, t, inp) {
    const i2 = { ...inp, crouch, groundY: groundY(pos.x, pos.z) };
    if (state === SWIM) stepSwim(dt, t, i2);
    else if (state === JUMP) stepAir(dt, t, i2);
    else stepGround(dt, t, i2);
    wavePlay(dt, t);
    collide();
  }

  return {
    step,
    spawn(x, y, z, y0) {
      pos.x = x; pos.y = y; pos.z = z; yaw = y0; pitch = 0;
      vel.x = vel.y = vel.z = 0; state = GROUND; crouch = false; waveHit = 0; tilt = 0; tiltDir = 0;
    },
    get pos() { return pos; }, get vel() { return vel; },
    get yaw() { return yaw; }, set yaw(v) { yaw = v; },
    get pitch() { return pitch; }, set pitch(v) { pitch = v; },
    get state() { return state; }, get crouch() { return crouch; },
    set crouch(v) { crouch = v; },
    get waveHit() { return waveHit; }, get tilt() { return tilt; }, get tiltDir() { return tiltDir; },
    get eyeH() { return eye(); },
  };
}
