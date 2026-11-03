// L3.5 — full human model test THROUGH THE REAL WRAPPER (flight/human-phys.js).
// The physics is JS-side (same pattern as the drone); this drives createHumanPhys()
// with the WASM sea proxy — the exact stack main.js uses. Run: node test/human-model.mjs
import fs from 'node:fs';

let pass = 0, fail = 0;
const ok = (c, name) => { if (c) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.error(`FAIL  ${name}`); } };

globalThis.fetch = async () => ({ arrayBuffer: async () => fs.readFileSync(new URL('../PPE-graphics/sim/pocket_physics.wasm', import.meta.url)) });
const M = await import('../PPE-graphics/sim/pp.js');
await M.initPP();
const PP = M.PP;
const { createHumanPhys } = await import('../PPE-graphics/flight/human-phys.js');

// city exactly as main.js builds it
const city = { bl: [] }; for (let i = 0; i < 95; i++) city.bl.push({ x: (i * 137) % 800 - 400, z: (i * 91) % 800 - 400, hw: 12 + i % 9, hd: 10 + i % 7, top: 40 + (i * 29) % 100 });
M.createWind().setObstacles(city.bl);
const groundY = (x, z) => { let g = -Infinity; for (const b of city.bl) if (Math.abs(x - b.x) < b.hw && Math.abs(z - b.z) < b.hd && g < b.top) g = b.top; return g; };
const H = createHumanPhys({ city, sea: M.sea, hgt: (x, z, t) => PP.hgt(x, z, t) });
const roof = city.bl.reduce((a, b) => b.top > a.top ? b : a);
const IN = { fwd: 0, side: 0, run: false, jump: false, crouch: false };

// A. spawn mirrors into the state immediately
H.spawn(roof.x, roof.top, roof.z, 0);
ok(Math.abs(H.pos.x - roof.x) < 1e-4 && Math.abs(H.pos.y - roof.top) < 1e-4,
  `spawn visible through the wrapper at once (pos=${H.pos.x.toFixed(1)},${H.pos.y.toFixed(1)})`);

// B. walk on a dry roof: 1.6 m/s, stays Ground
let fell = false;
for (let i = 0; i < 300; i++) { IN.fwd = 1; IN.run = false; H.step(0.016, i * 0.016, IN); if (H.pos.y < roof.top - 1) { fell = true; break; } }
const sp = Math.hypot(H.vel.x, H.vel.z);
ok(!fell && Math.abs(sp - 1.6) < 0.1, `roof walk: speed ${sp.toFixed(2)} ~ 1.6 m/s, stays on the roof`);
ok(H.state === 0, `state = ground while walking (got ${H.state})`);

// C. fall into open water -> Swim, head above the surface every frame
let dropX = 0, dropZ = 0;
outer: for (let x = -300; x <= 300; x += 50) for (let z = -300; z <= 300; z += 50) {
  if (groundY(x, z) === -Infinity) { dropX = x; dropZ = z; break outer; }
}
H.spawn(dropX, 30, dropZ, 0);
let enteredSwim = -1, headBad = 0;
for (let i = 0; i < 400; i++) {
  IN.fwd = 0; H.step(0.016, i * 0.016, IN);
  if (H.state === 2 && enteredSwim < 0) enteredSwim = i;
  if (H.pos.y + H.eyeH < PP.hgt(H.pos.x, H.pos.z, i * 0.016) - 1e-4) headBad++;
}
ok(enteredSwim > 0, `falling off lands in Swim at ${(enteredSwim * 0.016).toFixed(1)}s`);
ok(headBad === 0, `head never under the surface while falling+swimming (${headBad} bad frames)`);

// D. calm swim: the stroke works (moves roughly at swim speed)
H.spawn(200, -5, 200, 0);
const x0 = H.pos.x;
for (let i = 0; i < 600; i++) { IN.fwd = 1; H.step(0.016, i * 0.016, IN); }
const calmNet = Math.abs(H.pos.x - x0);
ok(calmNet > 4 && calmNet < 25, `calm swim 10s: net ${calmNet.toFixed(1)} m (stroke 0.9 m/s works, sea does not kidnap)`);

// E. storm: the sea carries the body, tilt and wave_hit react
for (let i = 0; i < 900; i++) PP.step(1.0, i); // spin the sea up
H.spawn(0, -5, 0, Math.PI); // stroke INTO the waves
let maxTilt = 0, maxV = 0;
for (let i = 0; i < 1250; i++) {
  IN.fwd = 1; H.step(0.016, i * 0.016, IN);
  maxTilt = Math.max(maxTilt, H.tilt);
  maxV = Math.max(maxV, Math.hypot(H.vel.x, H.vel.z));
  if (H.pos.y + H.eyeH < PP.hgt(H.pos.x, H.pos.z, i * 0.016) - 1e-4) headBad++;
}
ok(maxTilt > 0.02, `waves tilt the body in the water (${(maxTilt * 57.3).toFixed(1)} deg max)`);
ok(maxV > 0.3, `storm water motion reaches the swimmer (${maxV.toFixed(1)} m/s peak)`);
ok(headBad === 0, `head above water through calm AND storm (${headBad} violations total)`);

// F. jump on a roof: ~1.1 m apex
H.spawn(roof.x, roof.top, roof.z, 0);
IN.fwd = 0; IN.jump = true; H.step(0.016, 0, IN); IN.jump = false;
let apex = H.pos.y;
for (let i = 1; i < 100; i++) { H.step(0.016, i * 0.016, IN); apex = Math.max(apex, H.pos.y); }
ok(Math.abs(apex - roof.top - 1.1) < 0.2, `jump apex +${(apex - roof.top).toFixed(2)} m (~1.1)`);

// G. crouch toggle: eye height 1.0
H.crouch = true; H.step(0.016, 2, IN);
ok(Math.abs(H.eyeH - 1.0) < 1e-3, `crouch: eye height ${H.eyeH.toFixed(2)} (1.0)`);

console.log(`\nL3.5 human model (JS wrapper): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
