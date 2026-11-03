// L4 — smoke test: a full game session emulated in Node, no browser.
// Boots the WASM core exactly like main.js, then drives the JS human body
// (flight/human-phys.js — same pattern as the drone) with realistic input
// scripts (walk, jump, fall into water, swim, storm) and asserts the
// invariants a player would feel. Run: node test/smoke.mjs (or: make smoke)
import fs from 'node:fs';

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`FAIL  ${name}`); }
}

const bytes = fs.readFileSync(new URL('../PPE-graphics/sim/pocket_physics.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(bytes, {});
const ex = instance.exports;
const ptr = ex.pp_init();
const v = (o, l) => new Float32Array(ex.memory.buffer, ptr + o, l);
const DT = 0.016;

// city-like obstacles (95 buildings, same layout as city.js)
const obst = v(0x1AC, 4096 * 5);
for (let i = 0; i < 95; i++) {
  const o = i * 5;
  obst[o] = (i * 137) % 800 - 400; obst[o + 1] = (i * 91) % 800 - 400;
  obst[o + 2] = 12 + i % 9; obst[o + 3] = 10 + i % 7; obst[o + 4] = 40 + (i * 29) % 100;
}
ex.pp_set_obstacles(95);

// JS human physics on the WASM sea
const PPsea = {
  get w1() { return v(0x000, 28); }, get w2() { return v(0x070, 28); }, get w3() { return v(0x0E0, 28); },
  get drift() { return { x: v(0x16C, 4)[0], z: v(0x16C, 4)[1] }; }, get Us() { return v(0x16C, 4)[3]; },
};
const { createHumanPhys } = await import('../PPE-graphics/flight/human-phys.js');
// human-phys imports sampleMod from sim/sea.js directly — its MOD field is identical (seed 777)
const hgt = (x, z, t) => ex.pp_hgt(x, z, t);
const city = { bl: [] };
for (let i = 0; i < 95; i++) city.bl.push({ x: obst[i * 5], z: obst[i * 5 + 1], hw: obst[i * 5 + 2], hd: obst[i * 5 + 3], top: obst[i * 5 + 4] });
const H = createHumanPhys({ city, sea: PPsea, hgt });

function frame(i, inp) {
  const t = i * DT;
  ex.pp_step(DT, t);
  ex.pp_at(0, 40, 0);
  H.step(DT, t, { fwd: inp?.fwd ?? 0, side: inp?.side ?? 0, run: !!inp?.run, jump: !!inp?.jump });
  return t;
}
const state = () => H.state;
const pos = () => [H.pos.x, H.pos.y, H.pos.z];
const vel = () => [H.vel.x, H.vel.y, H.vel.z];

// find a rooftop to spawn on (highest building)
let roof = { top: 0, x: 0, z: 0 };
for (let i = 0; i < 95; i++) {
  const o = i * 5;
  if (obst[o + 4] > roof.top) roof = { top: obst[o + 4], x: obst[o], z: obst[o + 1] };
}
console.log(`smoke: tallest roof at (${roof.x.toFixed(0)},${roof.z.toFixed(0)}) h=${roof.top.toFixed(0)} m`);

// ---- scene 1: spawn on a roof, stand still ----
H.spawn(roof.x, roof.top, roof.z, 0);
frame(0, { fwd: 0 });
ok(Math.abs(pos()[1] - roof.top) < 0.1, `spawn on roof: y=${pos()[1].toFixed(1)} ~ ${roof.top.toFixed(1)}`);
ok(state() === 0, `state = ground on the roof (got ${state()})`);

// ---- scene 2: walk for 5 s, stay on the roof (no walking off) ----
let fell = false;
for (let i = 1; i <= 312; i++) {
  frame(i, { fwd: 1 });
  if (pos()[1] < roof.top - 1) { fell = true; break; }
}
ok(!fell, `walking on the roof: did not fall through (y=${pos()[1].toFixed(1)})`);
ok(Math.hypot(vel()[0], vel()[2]) > 1.0, `walking speed ${Math.hypot(vel()[0], vel()[2]).toFixed(2)} m/s > 1`);

// ---- scene 3: spawn high over open water, fall in, survive ----
H.spawn(0, 30, 0, 0);
let hitWater = -1, underwater = 0;
for (let i = 0; i < 1200; i++) {
  const t = frame(i, { fwd: 0 });
  const p = pos();
  const h = ex.pp_hgt(p[0], p[2], t);
  const camY = p[1] + H.eyeH;
  if (camY < h - 1e-4) underwater++;
  if (hitWater < 0 && state() === 2) hitWater = i;
  if (i > 600) break;
}
ok(hitWater > 0, `fell from 30 m and entered swim state at frame ${hitWater}`);
ok(underwater === 0, `camera never under water during the fall+swim (${underwater} bad frames)`);

// ---- scene 4: swim 20 s in a storm, head above water, carried by the sea ----
// spin the sea up to a storm first
for (let i = 0; i < 900; i++) ex.pp_step(1.0, i);
H.spawn(0, -5, 0, 0);
let maxCarry = 0, badFrames = 0;
const x0 = pos()[0];
for (let i = 0; i < 1250; i++) {
  const t = frame(i, { fwd: 1 }); // stroke forward
  const p = pos();
  const h = ex.pp_hgt(p[0], p[2], t);
  if (p[1] + H.eyeH < h - 1e-4) badFrames++;
  maxCarry = Math.max(maxCarry, Math.hypot(vel()[0], vel()[2]));
}
ok(badFrames === 0, `storm swim: camera above water all ${1250} frames`);
ok(maxCarry > 0.3, `storm water motion reaches the swimmer: max speed ${maxCarry.toFixed(1)} m/s`);
ok(Number.isFinite(pos()[0] - x0), `storm swim stayed numerically clean (dx=${(pos()[0] - x0).toFixed(1)} m)`);

// ---- scene 5: long session stability (5 minutes of mixed input) ----
H.spawn(0, 0.5, 0, 0);
let nonFinite = 0, headBad = 0;
for (let i = 0; i < 18750; i++) {
  const phase = (i / 600) | 0;
  const inp = [
    { fwd: 1 }, { fwd: 1, run: true }, { fwd: 0 }, { fwd: -1 }, { fwd: 1, jump: true },
  ][phase % 5];
  const t = frame(i, inp);
  const p = pos();
  if (![...p, ...vel(), H.tilt, H.tiltDir, H.eyeH].every(Number.isFinite)) nonFinite++;
  const h = ex.pp_hgt(p[0], p[2], t);
  if (p[1] + H.eyeH < h - 1e-4) headBad++;
}
ok(nonFinite === 0, `5-min session: no NaN (${nonFinite})`);
ok(headBad === 0, `5-min session: head floor held (${headBad} violations)`);

console.log(`\nL4 smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
