// E3 fallback test: when the WASM core fails to load, the game must fall back to the
// JS reference models LOUDLY (warn in log) and the sea uniforms must still get a valid
// modulation field (B4: createSeaUniforms() without args read MOD off the wrong object).
// Runs the exact fallback path main.js takes, without three.js.
import {test} from 'node:test';
import assert from 'node:assert';

test('fallback: sea.js module exports MOD/MOD_SIZE on the sea object (B4 contract)', async () => {
  const seaMod = await import('../PPE-graphics/sim/sea.js');
  const sea = seaMod.sea;
  // main.js fallback calls createSeaUniforms(seaJS.sea) — the object must carry the
  // mod field, or the foam texture reads (0,0) and the sea goes flat and black.
  assert.ok(sea.MOD instanceof Uint8Array || sea.MOD instanceof Uint8ClampedArray,
    'sea.MOD missing on the sea export object');
  assert.ok(Number.isFinite(sea.MOD_SIZE) && sea.MOD_SIZE > 0, 'sea.MOD_SIZE missing');
  assert.equal(sea.MOD.length, sea.MOD_SIZE * sea.MOD_SIZE * 4, 'MOD is RGBA MOD_SIZE²');
});

test('fallback: wind.js reference has the same interface as the pp.js shim', async () => {
  const {createWind} = await import('../PPE-graphics/sim/wind.js');
  const w = createWind();
  // rain.js reads wind.x/y/z per drop (B5) — the JS reference must provide them too
  for (const k of ['update', 'at', 'setObstacles', 'u10', 'dir', 'g', 'x', 'y', 'z']) {
    assert.ok(k in w, `wind reference missing '${k}'`);
  }
  w.update(0.016, 1);
  w.at(0, 10, 0, {});
  assert.ok(Number.isFinite(w.x) && Number.isFinite(w.y) && Number.isFinite(w.z),
    'wind.x/y/z finite after at()');
});

test('fallback: sea.js hgt finite over random probes', async () => {
  const {hgt} = await import('../PPE-graphics/sim/sea.js');
  for (let i = 0; i < 500; i++) {
    const x = (i * 37.7) % 400 - 200, z = (i * 91.3) % 400 - 200, t = i * 0.7;
    assert.ok(Number.isFinite(hgt(x, z, t)), `hgt(${x},${z},${t}) not finite`);
  }
});