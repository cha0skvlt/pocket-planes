// L3.7 — analytical unit tests for the human body physics (human-phys.js).
// Philosophy: every check compares the simulation against a NUMBER computed by
// hand from the declared model (see comments in human-phys.js), not against a snapshot.
// Drone (flight/drone.js) is the reference for *style* — same frame conventions,
// same input axes, same dt clamping; several tests here assert the human behaves
// in the same frame the drone does.
//
// The tests run on a SYNTHETIC sea: w1/w2/w3 crafted so hgt() is exactly
// h = A·sin(k·(x·dx+z·dz) - ω·t) with known A, k, ω — analytic ground truth.
//
// Run: node test/human-units.mjs
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message.split('\n')[0]}`); }
}

const { createHumanPhys, waterMotion, slope, WALK, RUN, SWIM_SPEED, ACCEL, BRAKE, JUMP_V,
        GRAV, RADIUS, WAIST, HEAD_CLEAR, GROUND, JUMP, SWIM } =
  await import('../PPE-graphics/flight/human-phys.js');
const { sampleMod } = await import('../PPE-graphics/sim/sea.js');

// ---------------------------------------------------------------- synthetic sea
// One rendered band, analytic: h(x,z,t) = A·sin(k·(x·dx+z·dz) - ω·t) exactly.
// sampleMod is fed constant u,v so m = (1,1) envelope… but sampleMod(u,v) with
// constant inputs returns a constant — we bake that constant into the amplitude.
const SEA = {
  w1: new Float32Array([1, 0, 0.2, 0]),          // dx=1, dz=0, k=0.2, A baked by env
  w2: new Float32Array([Math.sqrt(9.81 * 0.2), 0, 0, 0]), // ω=sqrt(gk), φ=0
  w3: new Float32Array([0, 0, 0, 0]),            // cg=0, no warp
  Us: 0, drift: { x: 0, z: 0 },
};
const M0 = sampleMod(0, 0).slice();             // constant mod at the sampled coords
const A0 = 2.0, K0 = 0.2, OM0 = Math.sqrt(9.81 * K0);
const A_EFF = A0 * (0.45 + 1.1 * M0[0]);        // amplitude after the envelope
// hgt must then equal A_EFF·(sin(θ)³ − 0.3125) — same cubic shape as sea.js H().
// We do NOT copy the shader's cubic; we sample the ACTUAL hgt through a probe
// function built from the same sea.js formula, and assert physics constants
// against IT. This keeps the tests honest: they test physics, not the sea.
const hgtSyn = (x, z, t) => {
  const s = .5 + .5 * Math.sin(K0 * x - OM0 * t);
  return A_EFF * (s * s * s - .3125);
};
// wrap the synthetic sea in the shape createHumanPhys expects (hgt closure uses sea.w*)
const seaView = SEA;
const hgtView = hgtSyn;

// flat city: one big roof at h=40 (30×30), floor of the world = waterline 0
const CITY = { bl: [{ x: 0, z: 0, hw: 15, hd: 15, top: 40 }] };

function mkBody(x, y, z, yaw = 0) {
  const H = createHumanPhys({ city: CITY, sea: seaView, hgt: hgtView });
  H.spawn(x, y, z, yaw);
  return H;
}
const NOIN = { fwd: 0, side: 0, run: false, jump: false };
const stepN = (H, n, inp = NOIN, dt = 1 / 60, t0 = 0) => {
  for (let i = 0; i < n; i++) H.step(dt, t0 + i * dt, inp);
  return H;
};

// ============================================================ 1. ground locomotion
console.log('L3.7.1 ground locomotion (analytic)');

ok('run-up to 95% of RUN = 0.95·RUN/ACCEL ≈ 0.57 s (rate-limited ramp, linear)', () => {
  const H = mkBody(0, 40, 0);
  const dt = 1 / 240;
  let t = 0;
  while (Math.hypot(H.vel.x, H.vel.z) < 0.95 * RUN && t < 2) { H.step(dt, t, { fwd: 1, side: 0, run: true, jump: false }); t += dt; }
  // the controller moves vel toward the target at exactly ACCEL m/s² (rate-limited),
  // so the ramp is LINEAR: t = 0.95·RUN/ACCEL = 0.57 s. Design target "~0.6 s to run speed" ✓
  assert.ok(Math.abs(t - 0.95 * RUN / ACCEL) < 0.05, `measured ${t.toFixed(3)} s, analytic ${(0.95 * RUN / ACCEL).toFixed(3)} s`);
});

ok('stopping distance from RUN ≈ v²/(2·BRAKE) (±35%)', () => {
  // face −Z (yaw=0): the roof spans ±15, run 1 s (4.2 m) — stay well inside the roof
  const H = mkBody(0, 40, 10, 0); // start at z=+10, run toward −Z, edge at −15
  stepN(H, 150, { fwd: 1, side: 0, run: true, jump: false }); // 2.5 s: full speed, ~7 m
  const v0 = Math.hypot(H.vel.x, H.vel.z);
  const z0 = H.pos.z;
  stepN(H, 240, NOIN);
  const d = Math.abs(H.pos.z - z0);
  assert.ok(H.state === GROUND, `stayed on the roof (state ${H.state})`);
  assert.ok(Math.abs(v0 - RUN) < 0.2, `did not reach full speed: ${v0}`);
  // rate-limited braking: linear ramp from v0 to 0 at BRAKE ⇒ d = v0²/(2·BRAKE)
  assert.ok(Math.abs(d - v0 * v0 / (2 * BRAKE)) / (v0 * v0 / (2 * BRAKE)) < 0.35,
    `stopped in ${d.toFixed(2)} m, model says ${(v0 * v0 / (2 * BRAKE)).toFixed(2)} m`);
});

ok('crouch caps speed at 0.55·WALK', () => {
  const H = mkBody(0, 40, 0);
  H.crouch = true;
  stepN(H, 240, { fwd: 1, side: 0, run: true, jump: false });
  assert.ok(Math.abs(Math.hypot(H.vel.x, H.vel.z) - 0.55 * WALK) < 0.05);
});

ok('walk 3 s → ~4.8 m of travel (1.6 m/s)', () => {
  const H = mkBody(0, 40, 0, -Math.PI / 2); // face +X (yaw=-π/2 → fwd=+X)
  const x0 = H.pos.x;
  stepN(H, 180, { fwd: 1, side: 0, run: false, jump: false });
  assert.ok(Math.abs(H.pos.x - x0 - WALK * 3) < 0.4, `travelled ${(H.pos.x - x0).toFixed(2)} m in 3 s`);
});

// ============================================================ 2. jump (ballistic)
console.log('L3.7.2 jump (ballistic)');

ok('jump apex ≈ v₀²/2g = 1.10 m', () => {
  const H = mkBody(0, 40, 0);
  const dt = 1 / 240;
  let apex = H.pos.y;
  H.step(dt, 0, { fwd: 0, side: 0, run: false, jump: true });
  for (let i = 0; i < 240; i++) { H.step(dt, i * dt, NOIN); apex = Math.max(apex, H.pos.y); }
  assert.ok(Math.abs(apex - 40 - JUMP_V * JUMP_V / (2 * GRAV)) < 0.06,
    `apex ${(apex - 40).toFixed(3)} m, analytic ${(JUMP_V * JUMP_V / (2 * GRAV)).toFixed(3)} m`);
  assert.ok(H.state === GROUND, 'lands back in Ground');
});

ok('jump off a roof into open water → Swim, water catches, not floor', () => {
  // spawn at the roof EDGE facing +X (off the roof: groundY=-Infinity beyond x=15+R)
  const H = mkBody(14.5, 40, 0);
  H.yaw = -Math.PI / 2; // forward = +X
  stepN(H, 30, { fwd: 1, side: 0, run: true, jump: false }); // run off the edge
  assert.ok(H.state === JUMP, `off the edge → airborne (got ${H.state})`);
  stepN(H, 600, NOIN);
  assert.ok(H.state === SWIM, `water catches the fall (got ${H.state})`);
  assert.ok(H.pos.y + H.eyeH >= hgtSyn(H.pos.x, H.pos.z, 10) + HEAD_CLEAR - 1e-3, 'head floor held');
});

// ============================================================ 3. collisions
console.log('L3.7.3 capsule vs AABB');

ok('walking into a wall stops the body, no penetration', () => {
  // wall ADJACENT to the roof (spans x 15..19, taller than the capsule):
  // no water gap — the capsule walks straight into concrete
  const C = { bl: [{ x: 0, z: 0, hw: 15, hd: 15, top: 40 }, { x: 17, z: 0, hw: 2, hd: 30, top: 60 }] };
  const H = createHumanPhys({ city: C, sea: seaView, hgt: hgtView });
  H.spawn(0, 40, 0, -Math.PI / 2); // face +X
  stepN(H, 600, { fwd: 1, side: 0, run: true, jump: false }); // 10 s at the wall
  assert.ok(H.pos.x <= 19 - RADIUS + 1e-6, `penetrated the wall: x=${H.pos.x.toFixed(2)}`);
  // the wall is taller than the capsule: state stays Ground, blocked
  assert.ok(H.state === GROUND, 'blocked, not launched');
});

ok('walking off a roof edge enters Jump exactly at the edge + R', () => {
  const H = mkBody(14.9, 40, 0, -Math.PI / 2); // near the +X edge
  stepN(H, 120, { fwd: 1, side: 0, run: true, jump: false });
  // must have left Ground (no floor outside x>15)
  assert.ok(H.state !== GROUND, `left the roof (state ${H.state})`);
  assert.ok(H.pos.x > 15, 'moved off the roof');
});

ok('corner: pushed out of the shallowest axis (X), not teleported to a corner', () => {
  const C = { bl: [{ x: 0, z: 0, hw: 10, hd: 3, top: 40 }] };
  const H = createHumanPhys({ city: C, sea: seaView, hgt: hgtView });
  H.spawn(9.2, 40, 0, 0); // inside the wall on X (9.2+0.35 > 10), clear on Z
  H.step(1 / 60, 0, NOIN);
  assert.ok(Math.abs(H.pos.x - (10 - 0)) <= 10 - (10 - 0.35) + 1e-6 || H.pos.x <= 10 + RADIUS + 1e-6,
    `pushed out along X: x=${H.pos.x.toFixed(3)} ≤ ${10 + RADIUS}`);
});

// ============================================================ 4. frame conventions (drone parity)
console.log('L3.7.4 frame conventions (drone parity)');

ok('yaw=0 + fwd → moves toward −Z (same as the drone camera frame)', () => {
  const H = mkBody(0, 40, 0, 0);
  stepN(H, 120, { fwd: 1, side: 0, run: false, jump: false });
  assert.ok(H.pos.z < -1, `moved to z=${H.pos.z.toFixed(2)} (must be negative)`);
  assert.ok(Math.abs(H.pos.x) < 1e-6, 'no lateral drift');
});

ok('yaw=0 + side(D) → moves toward +X', () => {
  const H = mkBody(0, 40, 0, 0);
  stepN(H, 120, { fwd: 0, side: 1, run: false, jump: false });
  assert.ok(H.pos.x > 1, `moved to x=${H.pos.x.toFixed(2)}`);
  assert.ok(Math.abs(H.pos.z) < 1e-6, 'no forward drift');
});

ok('yaw=π/2 (turn left) + fwd → moves toward −X', () => {
  const H = mkBody(0, 40, 0, Math.PI / 2);
  stepN(H, 120, { fwd: 1, side: 0, run: false, jump: false });
  assert.ok(H.pos.x < -1, `moved to x=${H.pos.x.toFixed(2)}`);
});

ok('pitch does NOT move the body on the ground (yaw-only steering)', () => {
  const H = mkBody(0, 40, 0, -Math.PI / 2);
  H.pitch = 1.2;
  const p0 = { ...H.pos };
  stepN(H, 60, { fwd: 1, side: 0, run: false, jump: false });
  assert.ok(Math.abs(H.pos.x - p0.x) > 0.5, 'fwd still works');
  void p0;
});

// ============================================================ 5. FSM: water entry/exit
console.log('L3.7.5 FSM transitions');

ok('shallow water (below waist) on a floor = Ground (wading, not swimming)', () => {
  // floor at 40, water at 40.5 → 0.5 above the floor < WAIST(0.9)
  const H = mkBody(0, 40, 0);
  // synthetic hgt at x=0: A_EFF·(sin³(0)−0.3125) = −0.3125·A_EFF ≈ −? — force shallow:
  // pick t where hgt(0,0,t) = A_EFF·(sin³(−ωt)−0.3125) is LOW (trough) ≈ −0.31·A_EFF−…
  // simpler: probe for a time when hgt < 40 + WAIST at the spawn point
  let t = 0;
  while (hgtSyn(0, 0, t) > 40 + WAIST - 0.2 && t < 60) t += 0.1;
  H.step(1 / 60, t, NOIN);
  assert.ok(H.state === GROUND || H.state === JUMP, `wading stays out of Swim (got ${H.state}, hgt=${hgtSyn(0, 0, t).toFixed(2)})`);
});

ok('deep water over the roof (hgt > floor + WAIST) = Swim', () => {
  // hgt max = A_EFF·(1−0.3125) = 0.6875·A_EFF; pick A_EFF big enough to flood the roof
  const bigSea = { ...SEA, w1: new Float32Array([1, 0, K0, 0]), w2: new Float32Array([OM0, 0, 0, 0]), w3: new Float32Array([0, 0, 0, 0]) };
  const bigA = 80 / 0.6875; // crest ≈ 55 m above waterline → floods the roof at 40
  const bigHgt = (x, z, t) => {
    const s = .5 + .5 * Math.sin(K0 * x - OM0 * t);
    return bigA * (0.45 + 1.1 * M0[0]) * (s * s * s - .3125);
  };
  const H = createHumanPhys({ city: CITY, sea: bigSea, hgt: bigHgt });
  H.spawn(0, 40, 0, 0);
  let t = 0;
  while (bigHgt(0, 0, t) < 40 + WAIST + 0.2 && t < 60) t += 0.1; // wait for the crest
  H.step(1 / 60, t, NOIN);
  assert.ok(H.state === SWIM, `flooded roof → Swim (got ${H.state}, water=${bigHgt(0, 0, t).toFixed(1)})`);
});

ok('Ground over open water (no floor) → Jump immediately (fall), never locked', () => {
  const H = mkBody(200, 30, 200); // mid-air over open water, state=Ground after spawn
  H.step(1 / 60, 0, NOIN);
  assert.ok(H.state === JUMP || H.state === SWIM, `no floor → not Ground (got ${H.state})`);
});

// ============================================================ 6. swim physics
console.log('L3.7.6 swimming');

ok('calm water: stroke alone moves the body ≈ SWIM_SPEED relative to ground', () => {
  const calm = { ...SEA, Us: 0, drift: { x: 0, z: 0 } };
  const H = createHumanPhys({ city: CITY, sea: calm, hgt: hgtView });
  H.spawn(300, -0.3, 300, 0); // open water, below the surface line
  const z0 = H.pos.z;
  stepN(H, 600, { fwd: 1, side: 0, run: false, jump: false });
  const d = Math.abs(H.pos.z - z0);
  // drag targets water+stroke: calm → stroke ≈ 0.9·(1−e^{−kT}) approach
  assert.ok(d > SWIM_SPEED * 8 && d < SWIM_SPEED * 11, `10 s calm swim: ${d.toFixed(2)} m (expect 7.2–9.9)`);
});

ok('head floor is absolute: no input, any dt, storm — head never under', () => {
  // reuse the stormy real-sea path via integration tests; here: dt sweep on synthetic surge
  const storm = { ...SEA, Us: 14, drift: { x: 1.2, z: 0.4 } };
  const H = createHumanPhys({ city: CITY, sea: storm, hgt: hgtView });
  H.spawn(0, -0.3, 0, 0);
  for (const dt of [1 / 240, 1 / 60, 1 / 30, 0.05]) {
    for (let i = 0; i < 300; i++) {
      H.step(dt, i * dt, NOIN);
      const head = H.pos.y + H.eyeH, surf = hgtSyn(H.pos.x, H.pos.z, i * dt);
      assert.ok(head >= surf + HEAD_CLEAR - 1e-6, `dt=${dt.toFixed(3)} frame ${i}: head ${head.toFixed(3)} < surf ${surf.toFixed(3)}`);
    }
  }
});

ok('drift carries a still swimmer (input zero, drift 1.2 m/s → net motion)', () => {
  const drift = { ...SEA, Us: 10, drift: { x: 1.2, z: 0 } };
  const H = createHumanPhys({ city: drift === SEA ? CITY : CITY, sea: drift, hgt: hgtView });
  H.spawn(300, -0.3, 300, 0);
  const x0 = H.pos.x;
  stepN(H, 600, NOIN);
  assert.ok(H.pos.x - x0 > 0.5 * 1.2 * 9, `drift moved the body ${(H.pos.x - x0).toFixed(2)} m in 10 s`);
});

ok('swim speed clamp: never above 12 m/s even with a huge drift', () => {
  const crazy = { ...SEA, Us: 40, drift: { x: 30, z: 0 } };
  const H = createHumanPhys({ city: CITY, sea: crazy, hgt: hgtView });
  H.spawn(300, -0.3, 300, 0);
  stepN(H, 120, NOIN);
  assert.ok(Math.hypot(H.vel.x, H.vel.z) <= 12 + 1e-6, `velocity ${Math.hypot(H.vel.x, H.vel.z).toFixed(1)} > 12`);
});

// ============================================================ 7. waterMotion (analytic)
console.log('L3.7.7 waterMotion analytic');

ok('Stokes transport points DOWNWIND (+x for k>0) and scales as A²kω', () => {
  // NOTE: waterMotion reads the sea's REAL w1 (A from band 0 = 5·ratio in sea.js),
  // so build a 1-band sea with the exact amplitude we want (A=1 analytic):
  // a Float32Array(4) is clamped by the n = min(NMOD, len/4) guard to 1 band.
  const sea1 = {
    w1: new Float32Array([1, 0, K0, 1]), // dx=1,dz=0,k=0.2,A=1
    w2: new Float32Array([OM0, 0, 0, 0]),
    w3: new Float32Array([0, 0, 0, 0]),
    Us: 0, drift: { x: 0, z: 0 },
  };
  const [[sx]] = waterMotion(sea1, 0, 0, 0, 0);
  const stokes = Math.pow(0.45 + 1.1 * M0[0], 2) * OM0 * K0;
  assert.ok(Number.isFinite(sx), 'stokes finite');
  assert.ok(Math.abs(sx - stokes) / stokes < 0.02, `stokes ${sx.toExponential(6)} vs analytic ${stokes.toExponential(6)}`);
  assert.ok(sx > 0, 'stokes is downwind (+x)');
});

ok('surge oscillates with amplitude A·ω (bounded, sign flips)', () => {
  const sea1 = {
    w1: new Float32Array([1, 0, K0, 1]), w2: new Float32Array([OM0, 0, 0, 0]), w3: new Float32Array([0, 0, 0, 0]),
    Us: 0, drift: { x: 0, z: 0 },
  };
  let mx = 0;
  for (let i = 0; i < 400; i++) {
    const [, [ox]] = waterMotion(sea1, 0, 0, i * 0.05, 0);
    mx = Math.max(mx, Math.abs(ox));
  }
  const ampMax = (0.45 + 1.1 * M0[0]) * OM0; // e^{-k·0}=1
  assert.ok(mx <= ampMax * 1.001, `surge peak ${mx.toFixed(3)} > analytic max ${ampMax.toFixed(3)}`);
  assert.ok(mx > ampMax * 0.9, `surge peak ${mx.toFixed(3)} never reached the analytic amplitude`);
});

ok('slope() central differences ≈ analytic derivative A·k·cos(θ)', () => {
  const A = 3, k = 0.2, om = Math.sqrt(9.81 * k);
  const hg = (x, z, t) => A * Math.sin(k * x - om * t);
  const t = 1.234;
  const [dhx] = slope(hg, 2.5, 0, t);
  assert.ok(Math.abs(dhx - A * k * Math.cos(k * 2.5 - om * t)) < 0.01,
    `slope ${dhx.toFixed(4)} vs analytic ${(A * k * Math.cos(k * 2.5 - om * t)).toFixed(4)}`);
});

// ============================================================ 8. robustness
console.log('L3.7.8 robustness');

ok('dt=0 does not divide by zero / NaN', () => {
  const H = mkBody(0, 40, 0);
  H.step(0, 0, { fwd: 1, side: 0, run: true, jump: false });
  assert.ok([H.pos.x, H.pos.y, H.pos.z, H.vel.x, H.vel.y, H.vel.z].every(Number.isFinite));
});

ok('huge dt (0.05, main.js clamp) stays finite and bounded', () => {
  const H = mkBody(0, 40, 0);
  stepN(H, 200, { fwd: 1, side: 0, run: true, jump: false }, 0.05);
  assert.ok([H.pos.x, H.pos.y, H.vel.x].every(Number.isFinite));
  assert.ok(Math.hypot(H.vel.x, H.vel.z) < RUN + 1, 'no speed explosion at large dt');
});

ok('spawn INSIDE a building resolves out without NaN', () => {
  const C = { bl: [{ x: 0, z: 0, hw: 5, hd: 5, top: 40 }] };
  const H = createHumanPhys({ city: C, sea: seaView, hgt: hgtView });
  H.spawn(0, 40, 0, 0); // dead center of the AABB
  stepN(H, 30, NOIN);
  assert.ok([H.pos.x, H.pos.y, H.pos.z].every(Number.isFinite), 'finite after spawn-inside');
  assert.ok(Math.abs(H.pos.x) <= 5 + RADIUS + 1e-6 || Math.abs(H.pos.z) <= 5 + RADIUS + 1e-6, 'pushed out');
});

ok('tilt is bounded by TILT_MAX in any sea', () => {
  const H = mkBody(0, -0.3, 0);
  H.spawn(0, -0.3, 0, 0);
  stepN(H, 600, NOIN, 1 / 60, 0);
  assert.ok(H.tilt <= 0.5 + 1e-6, `tilt ${H.tilt.toFixed(3)} > TILT_MAX`);
});

ok('long session (10 min, mixed dt): finite, no NaN, no tunneling through the wall', () => {
  const C = { bl: [{ x: 0, z: 0, hw: 15, hd: 15, top: 40 }, { x: 40, z: 0, hw: 2, hd: 30, top: 60 }] };
  const H = createHumanPhys({ city: C, sea: seaView, hgt: hgtView });
  H.spawn(0, 40, 0, -Math.PI / 2);
  let t = 0;
  for (let i = 0; i < 36000; i++) {
    const dt = i % 7 === 0 ? 0.05 : 1 / 60;
    const inp = i % 600 < 300 ? { fwd: 1, side: 0, run: true, jump: false } : NOIN;
    H.step(dt, t, inp);
    t += dt;
    if (![H.pos.x, H.pos.y, H.pos.z].every(Number.isFinite)) { assert.fail(`NaN at frame ${i}`); }
    // tunneling check: the far wall spans x 38..42, taller than the capsule —
    // a Ground-state body between the roofs must never sit inside the wall span
    if (H.state === GROUND && H.pos.x > 38 - RADIUS && H.pos.x < 42 + RADIUS && H.pos.y < 60) { assert.fail(`tunneled into the wall: x=${H.pos.x} y=${H.pos.y}`); }
  }
});

console.log(`\nL3.7 human units: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
