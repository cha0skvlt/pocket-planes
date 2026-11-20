import * as THREE from 'three';

// Manipulator under the drone belly: a short industrial wrist with two crab jaws. It has no
// aiming of its own — the drone's position and attitude ARE the aim. It holds one target at a
// time and slips above a load limit.
const MOUNT = { x: 0, y: -0.20, z: 0 };          // drone-local, under the belly, pointing down
const REACH = 0.61;                               // mount -> jaw tip, m
const TIP_R = 0.10;
const GRAB_R = 0.50;                              // one radius for both targets: inside half a metre, the click grabs
const RELEASE_R = GRAB_R * 1.15;                 // hysteresis: once a target is in range it stays in range out to here
const A_MAX = 75;                                 // claw slips above this load, m/s^2
const HIT_MAX = 15;                                // the operator is dropped by a harder hit, m/s of lost velocity
const OPEN = 0.45;                                // jaw opening angle, rad

// Same bathyscaphe palette as the drone skin: orange shell, dark soviet plastic.
const SUIT = 0xc45a1e, SUIT_DARK = 0x8f3d12, BLACK = 0x141414;

const box = (w, h, d, m, x, y, z, rz = 0) => {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z); o.rotation.z = rz; return o;
};
const cyl = (r1, r2, h, m, x, y, z, rx = 0) => {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, 10), m);
  o.position.set(x, y, z); o.rotation.x = rx; return o;
};

/** The claw model: a crab pincer. Every part is there for a reason the eye can follow:
 *  flange + bolts (bolted to the belly), ribbed servo housing (where the motion comes from),
 *  cable and hydraulic rod (things that move or feed it), a hinge block with a pin through each
 *  pivot, and two jaws built as propodus -> knuckle -> dactyl -> black tip, tapering like a crab
 *  claw so the silhouette reads from the side, from below and from behind.
 *
 *  Jaw geometry is solved, not eyeballed: pivots sit at x = +-0.055, y = -0.30. The chain
 *  125 + 120 + 75 mm with bends 0.18 and 0.30 rad ends exactly on the centre line, 0.61 m under
 *  the mount (REACH), so the tips touch when shut and the grab radii stay valid. Width stays
 *  under 0.17 m shut; opening swings the tips out, which is the point. */
function buildClaw() {
  const mat = {
    suit: new THREE.MeshStandardMaterial({ color: SUIT, roughness: 0.5, metalness: 0.15 }),
    dark: new THREE.MeshStandardMaterial({ color: SUIT_DARK, roughness: 0.55, metalness: 0.1 }),
    black: new THREE.MeshStandardMaterial({ color: BLACK, roughness: 0.85, metalness: 0.1 }),
  };
  const g = new THREE.Group();
  const jaws = [];
  const Z = Math.PI / 2; // cylinders default to the Y axis; hinge pins and knuckles must lie along Z

  // flange + four bolts: the part that is screwed to the airframe
  g.add(cyl(0.085, 0.085, 0.04, mat.black, 0, -0.02, 0));
  for (let i = 0; i < 4; i++) {
    const a = i * Z + Math.PI / 4;
    g.add(cyl(0.011, 0.011, 0.014, mat.dark, Math.cos(a) * 0.065, -0.045, Math.sin(a) * 0.065));
  }
  // servo housing, tapering toward the wrist, with two cooling ribs so it reads as a motor
  g.add(cyl(0.07, 0.06, 0.16, mat.suit, 0, -0.12, 0));
  g.add(cyl(0.076, 0.076, 0.012, mat.dark, 0, -0.08, 0));
  g.add(cyl(0.072, 0.072, 0.012, mat.dark, 0, -0.14, 0));
  // cable down the back and a hydraulic rod on the front: the claw is fed and driven
  g.add(cyl(0.007, 0.007, 0.13, mat.black, 0.035, -0.115, -0.066));
  g.add(cyl(0.007, 0.007, 0.05, mat.black, 0.035, -0.205, -0.045));
  g.add(cyl(0.017, 0.017, 0.075, mat.dark, -0.04, -0.12, 0.066));
  g.add(cyl(0.009, 0.009, 0.075, mat.black, -0.04, -0.185, 0.066));
  // hinge block and palm: the jaws pivot between them. Kept narrow — a wide slab under the
  // belly reads as a box bolted to the airframe, not as a tool.
  g.add(box(0.14, 0.07, 0.10, mat.black, 0, -0.225, 0));
  g.add(box(0.13, 0.045, 0.11, mat.suit, 0, -0.2825, 0));
  // a pin through each pivot, longer than the palm so its ends show from front and back
  for (const s of [-1, 1]) g.add(cyl(0.02, 0.02, 0.15, mat.dark, s * 0.055, -0.30, 0, Z));

  const L1 = 0.125, L2 = 0.12, L3 = 0.075, A1 = 0.18, A2 = 0.30;
  for (const s of [-1, 1]) {
    const j = new THREE.Group();
    j.position.set(s * 0.055, -0.30, 0);
    j.userData.s = s;
    // propodus: the thick base of the claw
    j.add(box(0.065, L1, 0.10, mat.suit, 0, -L1 / 2, 0));
    // outside rib and actuator ear: they swing with the jaw, so the motion is legible
    j.add(box(0.012, 0.07, 0.075, mat.dark, s * 0.0385, -0.07, 0));
    j.add(box(0.03, 0.045, 0.06, mat.dark, s * 0.04, 0.012, 0));
    // knuckle: round, black, wider than the jaw so the joint shows
    j.add(cyl(0.03, 0.03, 0.115, mat.black, 0, -L1, 0, Z));
    // dactyl, bent inward by A1, with teeth on the inner face
    const d = new THREE.Group();
    d.position.set(0, -L1, 0); d.rotation.z = -s * A1;
    d.add(box(0.048, L2, 0.085, mat.suit, 0, -L2 / 2, 0));
    d.add(box(0.014, 0.03, 0.07, mat.black, -s * 0.03, -0.04, 0));
    d.add(box(0.014, 0.03, 0.07, mat.black, -s * 0.03, -0.09, 0));
    // tip, bent a further A2 inward, black so the meeting point is visible
    const t = new THREE.Group();
    t.position.set(0, -L2, 0); t.rotation.z = -s * A2;
    t.add(box(0.036, L3, 0.055, mat.black, 0, -L3 / 2, 0));
    d.add(t);
    j.add(d);
    jaws.push(j); g.add(j);
  }
  return { group: g, jaws, mat };
}

// ---------------------------------------------------------------------------------------------
// Geometry of the grab. Everything below is allocation-free: scalars in, scalar out.
// ---------------------------------------------------------------------------------------------
const OP_R = 0.35, KEY_R = 0.175;                 // the target's own half-width: range is measured to the BODY, not to its spine
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Squared distance between segments P1Q1 and P2Q2 (Ericson, Real-Time Collision Detection 5.1.9).
 *  The claw is a capsule, the operator is a capsule, the key is a degenerate segment: one routine
 *  covers all three, and the answer does not depend on the frame rate or on how the drone is
 *  pitched — it is the swept volume, not four samples of it. */
function segSegD2(p1x, p1y, p1z, q1x, q1y, q1z, p2x, p2y, p2z, q2x, q2y, q2z) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z;
  const d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0, t = 0;
  if (a > 1e-9) {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-9) s = clamp01(-c / a);
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
      s = den > 1e-9 ? clamp01((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); }
      else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  } else if (e > 1e-9) t = clamp01(f / e);
  const cx = p1x + d1x * s - (p2x + d2x * t), cy = p1y + d1y * s - (p2y + d2y * t), cz = p1z + d1z * s - (p2z + d2z * t);
  return cx * cx + cy * cy + cz * cz;
}

// ---------------------------------------------------------------------------------------------
// Feedback: a HUD line and two kinds of click. Both are created lazily and only where a browser
// exists, so the headless suites and the no-WebGL fallback never touch them.
// ---------------------------------------------------------------------------------------------
function createHud() {
  if (typeof document === 'undefined' || !document.body) return null;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:20;pointer-events:none;'
    + 'font:600 13px/1 ui-monospace,Menlo,monospace;letter-spacing:.18em;color:#ffb066;text-shadow:0 0 6px #000;'
    + 'padding:6px 12px;background:rgba(10,8,6,.45);border-radius:2px;transition:color .15s,background .15s';
  document.body.appendChild(el);
  return el;
}

function createSfx() {
  let ac = null;
  const ctx = () => {
    if (ac) return ac;
    const C = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!C) return null;
    try { ac = new C(); } catch (e) { ac = null; }
    return ac;
  };
  /** One enveloped tone. Events only (a click, a slip): never in the per-frame path. */
  function tone(f0, f1, dur, vol, type) {
    const a = ctx(); if (!a) return;
    if (a.state === 'suspended') a.resume();
    const o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  return {
    grip() { tone(1500, 700, 0.045, 0.16, 'square'); },       // metal on metal: it took something
    air() { tone(320, 200, 0.09, 0.12, 'triangle'); },        // dull: it closed on nothing
    open() { tone(500, 800, 0.04, 0.06, 'triangle'); },
    slip() { tone(420, 90, 0.35, 0.2, 'sawtooth'); },         // falling pitch: you lost it
    close() { if (ac) ac.close(); },
  };
}

export function createClaw({ S, city }) {
  let closed = false, holding = null, jaw = OPEN;
  let inRange = false;               // a valid target is inside the (hysteretic) grab volume
  let tint = 0, slipT = 0, graceT = 0, hudText = "", hudSlip = false;
  const tip = new THREE.Vector3(), mount = new THREE.Vector3(), dir = new THREE.Vector3();
  const eul = new THREE.Euler(0, 0, 0, 'YXZ');
  const targets = { key: null, human: null };

  const model = buildClaw();
  const group = model.group, jaws = model.jaws, mat = model.mat;
  group.scale.setScalar(0.5); // half size on the airframe; the grab volume stays as tuned

  // The jaws get their own materials: the range cue warms THEM, not the housing, so the player
  // reads "these are the fingers that will take it".
  const jawMat = new Map();
  for (const j of jaws) j.traverse(o => {
    if (!o.isMesh) return;
    if (!jawMat.has(o.material)) jawMat.set(o.material, o.material.clone());
    o.material = jawMat.get(o.material);
  });
  if (S) S.add(group);
  const hud = createHud(), sfx = createSfx();

  function paintHud() {
    if (!hud) return;
    const near = !holding && pickGap < 6 ? ' ' + pickGap.toFixed(1) + 'm' : '';
    const txt = slipT > 0 ? 'CLAW: SLIPPED' : holding === 'key' ? 'CLAW: KEY' : holding === 'op' ? 'CLAW: OPERATOR' : 'CLAW: \u2014' + near;
    if (txt !== hudText) { hudText = txt; hud.textContent = txt; }
    if ((slipT > 0) !== hudSlip) {
      hudSlip = slipT > 0;
      hud.style.color = hudSlip ? '#ff3a24' : '#ffb066';
      hud.style.background = hudSlip ? 'rgba(90,10,4,.7)' : 'rgba(10,8,6,.45)';
    }
  }

  /** World tip and mount from the drone attitude. The claw is rigid: it points down in drone space. */
  function solve(pos, yaw, pitch, roll) {
    eul.set(pitch, yaw, roll, 'YXZ');
    dir.set(0, -1, 0).applyEuler(eul);
    mount.set(MOUNT.x, MOUNT.y, MOUNT.z).applyEuler(eul).add(pos);
    tip.copy(mount).addScaledVector(dir, REACH);
  }

  // Opening the jaws is unconditional: a claw that closed on air must still open. Only the
  // target release depends on holding something.
  function release(why) {
    const wasClosed = closed;
    closed = false;
    if (!holding) { if (wasClosed && why === 'toggle') sfx.open(); return; }
    const h = holding; holding = null;
    if (h === 'key' && targets.key && targets.key.state === 1) targets.key.release(targets.vel);
    if (h === 'op' && targets.human) targets.human.detach(targets.t);
    if (why === 'slip') { slipT = 0.9; sfx.slip(); } else if (why === 'toggle') sfx.open();
  }

  // Gap (distance to the target's body, negative = overlapping the claw) of the best candidate
  // inside `rad`, or -1/none. NEAREST VALID TARGET WINS: both candidates are measured, the smaller
  // gap takes the grab. The old key-first priority let a loose key floating beside the operator
  // steal the click.
  let pickGap = 0;
  function pick(rad) {
    let who = 0, best = Infinity;
    const k = targets.key;
    if (k && (k.state === 0 || k.state === 2)) {
      const d = Math.sqrt(segSegD2(mount.x, mount.y, mount.z, tip.x, tip.y, tip.z, k.pos.x, k.pos.y, k.pos.z, k.pos.x, k.pos.y, k.pos.z)) - KEY_R;
      if (d < best) { best = d; who = d < rad ? 1 : 0; }
    }
    const h = targets.human;
    if (h && !h.carried) {
      const p = h.pos;
      const d = Math.sqrt(segSegD2(mount.x, mount.y, mount.z, tip.x, tip.y, tip.z, p.x, p.y, p.z, p.x, p.y + h.eyeH, p.z)) - OP_R;
      if (d < best) { best = d; who = d < rad ? 2 : 0; }
    }
    pickGap = best; // the raw gap to the nearest target, in or out of range: the HUD shows it
    return who;
  }

  /** Close the jaws on the nearest valid target. Returns true if one was taken. */
  function tryGrab() {
    const h = targets.human;
    // desync guard: carried by nobody is a stuck operator, hand him back to his own physics
    if (h && h.carried && holding !== 'op') h.detach(targets.t);
    const who = pick(inRange ? RELEASE_R : GRAB_R);
    if (who === 1) { if (targets.key.grab()) { holding = 'key'; return true; } }
    else if (who === 2) { h.attach(); holding = 'op'; graceT = 0.35; return true; }
    return false;
  }

  function close() {
    closed = true;
    if (tryGrab()) sfx.grip(); else sfx.air();
  }

  /** ctrl is null while the drone is not the active body (hover, no input). */
  function update(dt, pos, vel, yaw, pitch, roll, ctrl) {
    // solve FIRST: the toggle, the range and the snag all read the tip, and a stale tip is a missed grab
    solve(pos, yaw, pitch, roll);
    // desync guard the other way: the claw holds a body that thinks it is free
    if (holding === 'op' && targets.human && !targets.human.carried) targets.human.attach();
    // a key that was consumed (portal) or taken from outside is no longer ours
    if (holding === 'key' && (!targets.key || targets.key.state !== 1)) holding = null;
    if (ctrl && ctrl.toggle) {
      if (closed) release('toggle'); else close();
      // one line per click: the only way to see what the browser actually did
      console.log('[claw] toggle closed=' + closed + ' holding=' + holding + ' gap=' + (pickGap === Infinity ? 'inf' : pickGap.toFixed(2)) + ' tip=' + tip.x.toFixed(1) + ',' + tip.y.toFixed(1) + ',' + tip.z.toFixed(1));
    }
    else if (closed && !holding) {
      // Retry for as long as the jaws are shut and empty, WHICHEVER body is active: a click made a
      // moment before a Tab, or a moment before the target drifts in, still lands.
      if (tryGrab()) sfx.grip();
    }
    // range cue: hysteretic, so the tint does not flicker at the boundary
    inRange = !holding && pick(inRange ? RELEASE_R : GRAB_R) !== 0;
    const warm = !closed && !holding && inRange ? 1 : 0;
    tint += (warm - tint) * (1 - Math.exp(-14 * dt));
    for (const m of jawMat.values()) m.emissive.setRGB(1.0 * tint * 0.55, 0.42 * tint * 0.55, 0.12 * tint * 0.55);
    if (slipT > 0) slipT = Math.max(0, slipT - dt);
    if (graceT > 0) graceT = Math.max(0, graceT - dt);
    paintHud();
    if (ctrl && city) {
      // snag: the claw is a body. Lateral response along the contact normal, BOUNDED — it sets an
      // outward speed, it never adds one, or a few frames against a wall become a catapult.
      // A drone hovering over a roof is not snagging: the claw rests on the roof, it does not
      // bounce off it. Without this the drone is shoved away from anyone standing on a roof.
      for (const b of city.bl) {
        if (pos.y > b.top) continue;
        if (Math.abs(pos.x - b.x) < b.hw && Math.abs(pos.z - b.z) < b.hd) continue; // over the roof, not against a wall
        const dx = tip.x - b.x, dz = tip.z - b.z;
        const px = b.hw + TIP_R - Math.abs(dx), pz = b.hd + TIP_R - Math.abs(dz), py = b.top + TIP_R - tip.y;
        if (px <= 0 || pz <= 0 || py <= 0) continue;
        const m = Math.min(1.5, Math.min(px, pz) * 20);
        if (px < pz) { const s = Math.sign(dx || 1); if (vel.x * s < m) vel.x = s * m; }
        else { const s = Math.sign(dz || 1); if (vel.z * s < m) vel.z = s * m; }
      }
    }
    const open = closed ? 0 : OPEN;
    jaw += (open - jaw) * (1 - Math.exp(-12 * dt));
    group.position.copy(mount);
    group.quaternion.setFromEuler(eul);
    for (const j of jaws) j.rotation.z = j.userData.s * jaw;
  }

  return {
    update, tip, group, targets,
    /** Load check, once per frame, after every velocity change the game applies to the drone.
     *  A held target is let go by overload, or (the operator only) by a hard hit. Never by
     *  distance: a carried body trails the tip on its lag, and dropping him for that would drop
     *  him exactly when the drone flies fast. */
    check(aLoad, hitA) {
      if (!holding) return;
      if (aLoad > A_MAX) { release('slip'); return; }
      // the impact of the arrival is not a drop: half a second of grace after the grab
      if (holding === 'op' && graceT <= 0 && hitA > HIT_MAX) release('slip');
    },
    release, get holding() { return holding; }, get closed() { return closed; },
    get inRange() { return inRange; },
    dispose() {
      if (S) S.remove(group);
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      Object.values(mat).forEach(m => m.dispose());
      for (const m of jawMat.values()) m.dispose();
      if (hud) hud.remove();
      sfx.close();
    },
  };
}
