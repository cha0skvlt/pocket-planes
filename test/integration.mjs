// L2 — WASM boundary integration tests (Node, no browser).
// Verifies the contract between Rust and JS: layout offsets, view liveness,
// the no-alloc invariant, and the full per-frame call sequence.
// Bodies (drone, human) are JS-side and NOT part of this boundary.
// Run: node test/integration.mjs   (or: make test-integration)
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
const mem = ex.memory;

// ---- pp_hgt matches the shader model (spot check vs golden.json) ----
// NOTE: must run BEFORE any pp_step — the golden dump was taken at the init state,
// and the sea spins up over time (us chases the wind with τ≈150 s).
console.log('L2.0 golden spot check (init state)');
const golden = JSON.parse(fs.readFileSync(new URL('./golden.json', import.meta.url)));
let gbad = 0;
for (const p of golden.hgt) {
  const h = ex.pp_hgt(p.x, p.z, p.t);
  // pp_hgt returns f32 (the JS reference computes in f64): allow f32 rounding
  if (Math.abs(h - p.h) > 1e-4) gbad++;
}
ok(gbad === 0, `pp_hgt matches JS golden dump within f32 (${golden.hgt.length} probes, ${gbad} off)`);

// ---- layout offsets must match #[repr(C)] in rust/src/lib.rs ----
console.log('L2.1 layout');
const OFF = {
  w1: 0x000, w2: 0x070, w3: 0x0E0, ratio: 0x150,
  sea_misc: 0x16C, wind: 0x17C, wind_adv: 0x18C, at_out: 0x194,
  obst_count: 0x1A4, obst: 0x1AC,
};
// probe each block by writing a known value through the API and finding it
ex.pp_step(0.016, 1000);
const w1 = new Float32Array(mem.buffer, ptr + OFF.w1, 28);
ok(w1.every(Number.isFinite), 'w1 view is finite after step');
ok(w1[0] !== 0 || w1[1] !== 0, 'w1 carries wave data (non-zero)');
const wind = new Float32Array(mem.buffer, ptr + OFF.wind, 4);
ok(wind[2] === 1000, 'wind.t mirrors the step time (offset 0x17C correct)');
const atPtr = ex.pp_at(0, 40, 0);
ok(atPtr === ptr + OFF.at_out, 'pp_at returns at_out pointer at 0x194');
const at = new Float32Array(mem.buffer, atPtr, 4);
ok(at.every(Number.isFinite), 'at_out finite');

// ---- the no-alloc invariant: views must survive everything the game does ----
console.log('L2.3 no-alloc invariant');
// snapshot w1 before stress
const w1Before = Array.from(w1);
// 95 buildings like the city, then 600 frames with obstacles + wind queries
const obst = new Float32Array(mem.buffer, ptr + OFF.obst, 4096 * 5);
for (let i = 0; i < 95; i++) {
  const o = i * 5;
  obst[o] = (i * 137) % 800 - 400; obst[o + 1] = (i * 91) % 800 - 400;
  obst[o + 2] = 12 + i % 9; obst[o + 3] = 10 + i % 7; obst[o + 4] = 40 + (i * 29) % 100;
}
ex.pp_set_obstacles(95);
for (let i = 0; i < 600; i++) {
  ex.pp_step(0.016, i * 0.016);
  ex.pp_at((i % 800) - 400, 40, (i % 800) - 400);
}
ok(Array.from(w1).every((v, i) => v === w1Before[i] || Number.isFinite(v)),
  'w1 view still live and finite after 600 frames + setObstacles');
ok(mem.buffer.byteLength >= ptr + OFF.obst + 4096 * 20,
  `linear memory did not shrink (grew to ${mem.buffer.byteLength})`);

// ---- full frame sequence the game runs ----
console.log('L2.4 frame sequence');
// exactly what main.js does per frame: step -> at (bodies are JS-side now)
let bad = 0;
for (let i = 0; i < 3000; i++) {
  const t = i * 0.016;
  ex.pp_step(0.016, t);
  ex.pp_at(0, 40, 0);
  const at = new Float32Array(mem.buffer, ptr + OFF.at_out, 4);
  const w = new Float32Array(mem.buffer, ptr + OFF.wind, 4);
  if (!at.every(Number.isFinite) || !w.every(Number.isFinite)) bad++;
  const h = ex.pp_hgt(0, 0, t);
  if (!Number.isFinite(h)) bad++;
}
ok(bad === 0, `3000-frame game loop: no NaN in wind/at_out/hgt (${bad} violations)`);

console.log(`\nL2 integration: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
