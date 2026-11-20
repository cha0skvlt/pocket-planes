// L3.8 — headless suite for the claw grab mechanism (flight/claw.js).
// No renderer, no DOM, no audio: S = null, city = null. Targets are mocks with the contract
// from the task (key {state,pos,grab,release,consume}, human {pos(FEET),eyeH,carried,attach,detach}).
// Geometry reference: drone at (0,10,0), level -> mount (0,9.8,0), tip (0,9.19,0), claw axis x=z=0.
// Range = capsule(claw, GRAB_R=0.5) + target radius: operator 0.85, key 0.675.
// Run: node test/claw-grab.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message.split('\n')[0]}`); }
}
const { createClaw } = await import('../PPE-graphics/flight/claw.js');

const DT = 1 / 60, POS = new THREE.Vector3(0, 10, 0);
const mkKey = (x, y, z) => ({ state: 2, pos: { x, y, z }, grab() { this.state = 1; return true; }, release() { this.state = 2; }, consume() { this.state = 3; } });
const mkHuman = (x, y, z) => ({ pos: { x, y, z }, eyeH: 1.7, carried: false, attach() { this.carried = true; }, detach() { this.carried = false; } });
function rig({ key = null, human = null } = {}) {
  const c = createClaw({ S: null, city: null });
  c.targets.key = key; c.targets.human = human; c.targets.vel = { x: 0, y: 0, z: 0 }; c.targets.t = 0;
  const vel = { x: 0, y: 0, z: 0 };
  c.step = ctrl => c.update(DT, POS, vel, 0, 0, 0, ctrl);
  c.step(null); // solve the tip once
  return c;
}
const TOGGLE = { toggle: true };

console.log('range: capsule of the whole claw + the target radius');
for (const [d, expectOp, expectKey] of [[0.4, true, true], [0.6, true, true], [0.9, false, false]]) {
  ok(`operator at ${d} m`, () => { const h = mkHuman(d, 9.0, 0), c = rig({ human: h }); c.step(TOGGLE); assert.equal(c.holding === 'op', expectOp); });
  ok(`key at ${d} m`, () => { const k = mkKey(d, 9.5, 0), c = rig({ key: k }); c.step(TOGGLE); assert.equal(c.holding === 'key', expectKey); });
}
ok('range is measured along the whole claw, not at the tip (key beside the mount)', () => {
  const k = mkKey(0.5, 9.75, 0), c = rig({ key: k }); c.step(TOGGLE); assert.equal(c.holding, 'key');
});
ok('range does not depend on the drone pitch', () => {
  // pitched 90 deg the claw points along -Z/+Z; the key put under the NEW tip direction is still in range
  const k = mkKey(0, 10, -0.5), c = createClaw({ S: null, city: null }), v = { x: 0, y: 0, z: 0 };
  c.targets.key = k; c.targets.vel = v;
  c.update(DT, POS, v, 0, Math.PI / 2, 0, null); c.update(DT, POS, v, 0, Math.PI / 2, 0, TOGGLE);
  assert.equal(c.holding, 'key');
});

console.log('nearest wins');
ok('operator closer than the key -> operator', () => {
  const c = rig({ key: mkKey(0.5, 9.5, 0), human: mkHuman(-0.2, 9.0, 0) }); c.step(TOGGLE); assert.equal(c.holding, 'op');
});
ok('key closer than the operator -> key', () => {
  const c = rig({ key: mkKey(0.05, 9.5, 0), human: mkHuman(-0.7, 9.0, 0) }); c.step(TOGGLE); assert.equal(c.holding, 'key');
});
ok('a loose key near the operator no longer steals the grab', () => {
  const c = rig({ key: mkKey(0.6, 9.5, 0), human: mkHuman(0, 9.0, 0) }); c.step(TOGGLE); assert.equal(c.holding, 'op');
});

console.log('latch, retry, hysteresis');
ok('latch across 60 frames, target drifting away', () => {
  const h = mkHuman(0.3, 9.0, 0), c = rig({ human: h }); c.step(TOGGLE); assert.equal(c.holding, 'op');
  for (let i = 0; i < 60; i++) { h.pos.x += 0.05; c.step(null); assert.equal(c.holding, 'op'); }
});
ok('retry: closed on air, target arrives later, a null ctrl (other body active) still grabs', () => {
  const h = mkHuman(3, 9.0, 0), c = rig({ human: h });
  c.step(TOGGLE); assert.equal(c.closed, true); assert.equal(c.holding, null);
  for (let i = 0; i < 30; i++) c.step(null);
  assert.equal(c.holding, null);
  h.pos.x = 0.3; c.step(null); assert.equal(c.holding, 'op');
});
ok('second RMB opens the claw that closed on air (and only then)', () => {
  const c = rig({ human: mkHuman(3, 9, 0) }); c.step(TOGGLE); assert.equal(c.closed, true); c.step(TOGGLE); assert.equal(c.closed, false);
});
ok('hysteresis: in range at 0.80 m, still in range at 0.90 m, out at 1.0 m (operator, GRAB_R*1.15)', () => {
  const h = mkHuman(0.80, 9.0, 0), c = rig({ human: h }); c.step(null);
  assert.equal(c.inRange, true);
  h.pos.x = 0.90; c.step(null); assert.equal(c.inRange, true);
  h.pos.x = 1.0; c.step(null); assert.equal(c.inRange, false);
  h.pos.x = 0.90; c.step(null); assert.equal(c.inRange, false); // re-entry needs the INNER radius again
  h.pos.x = 0.80; c.step(null); assert.equal(c.inRange, true);
});
ok('consumed key is dropped from the claw without a release call', () => {
  const k = mkKey(0, 9.5, 0), c = rig({ key: k }); c.step(TOGGLE); k.consume(); c.step(null); assert.equal(c.holding, null);
});

console.log('release rules');
ok('release on overload (80 m/s^2)', () => { const c = rig({ human: mkHuman(0, 9, 0) }); c.step(TOGGLE); c.check(80, 0); assert.equal(c.holding, null); assert.equal(c.closed, false); });
ok('no release on a normal climb (6.5 m/s^2) or full thrust (40)', () => { const c = rig({ human: mkHuman(0, 9, 0) }); c.step(TOGGLE); c.check(6.5, 0); c.check(40, 0); assert.equal(c.holding, 'op'); });
ok('release on a hard hit (operator, after the grab grace)', () => { const h = mkHuman(0, 9, 0), c = rig({ human: h }); c.step(TOGGLE); for (let i = 0; i < 30; i++) c.step(null); c.check(6, 20); assert.equal(c.holding, null); assert.equal(h.carried, false); });
ok('no release on a 5 m/s graze (operator)', () => { const c = rig({ human: mkHuman(0, 9, 0) }); c.step(TOGGLE); c.check(6, 5); assert.equal(c.holding, 'op'); });
ok('a hard hit does not drop the KEY, overload does', () => {
  const k = mkKey(0, 9.5, 0), c = rig({ key: k }); c.step(TOGGLE); c.check(6, 12); assert.equal(c.holding, 'key'); c.check(80, 0); assert.equal(k.state, 2);
});
ok('a carried operator trailing the tip on his lag is NOT dropped by distance', () => {
  const h = mkHuman(0, 9, 0), c = rig({ human: h }); c.step(TOGGLE);
  h.pos.y = 4; for (let i = 0; i < 120; i++) c.step(null); // 5 m behind
  assert.equal(c.holding, 'op');
});

console.log(`\nL3.8 claw grab: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
