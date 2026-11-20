import * as THREE from 'three';
import { waterMotion } from '../flight/human-phys.js';

// One shared constant for the key and the portal window: the player reads the key as a
// splinter of the portal, so the two must never drift apart.
export const WARM = 0xffb066;
export const KEY_HELD = 0, KEY_GRABBED = 1, KEY_LOOSE = 2, KEY_CONSUMED = 3;

const SIZE = 0.35, FLOAT_H = 0.06, K_SPRING = 40, C_SPRING = 2 * Math.sqrt(K_SPRING);
const DRAG = 1.6; // == WATER_DRAG of the operator: the same sea, the same rule
const PROBE = 0.4, ROCK_RATE = 6, WORLD = 2000;

/** The key: a cube of warm light. NOT part of the colony. While `held` it has no physics at all —
 *  it is parented to the centroid the core already publishes in meta[4..7] (meta[0] is the cell
 *  count; the centroid sits right after count/form/blend/wild). The colony never knows it exists;
 *  that is the whole cheat. Once stolen it can never return to `held`. */
export function createKey({ S, BLOB, origin, scale, sea, wind, hgt }) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(SIZE, SIZE, SIZE),
    new THREE.MeshBasicMaterial({ color: WARM, fog: false }));
  S.add(mesh);
  const pos = mesh.position, vel = { x: 0, y: 0, z: 0 };
  let state = KEY_HELD, rx = 0, rz = 0;

  /** Held: ride the centroid. Grabbed: ride the claw tip. Loose: a small float on the sea. */
  function step(dt, t, tip) {
    if (state === KEY_CONSUMED) return;
    if (state === KEY_HELD) {
      const m = BLOB.meta;
      pos.set(origin.x + m[4] * scale, origin.y + m[5] * scale, origin.z + m[6] * scale);
      return;
    }
    if (state === KEY_GRABBED) {
      pos.set(tip.x, tip.y, tip.z);
      vel.x = vel.y = vel.z = 0;
      rx += (0 - rx) * (1 - Math.exp(-ROCK_RATE * dt)); rz += (0 - rz) * (1 - Math.exp(-ROCK_RATE * dt));
      mesh.rotation.set(rx, mesh.rotation.y, rz);
      return;
    }
    // loose. Vertical: critically damped spring to the wave height + float offset. The spring
    // damps the velocity RELATIVE to the water's own rise/fall: a plain spring lags a moving
    // surface by 2/omega*v and the cube floats a metre above the swell.
    const h = hgt(pos.x, pos.z, t);
    const tv = (hgt(pos.x, pos.z, t + 0.05) - h) / 0.05;
    vel.y += (-K_SPRING * (pos.y - (h + FLOAT_H)) - C_SPRING * (vel.y - tv)) * dt;
    // Horizontal: the sea's own drift current plus the Stokes net transport the operator feels
    // (same waterMotion, depth 0: a floating cube sits on the surface). sea.drift is already a
    // VELOCITY at ~3% of the wind — multiplying it by 0.03 again would freeze the key in place.
    const [[sx, sz]] = waterMotion(sea, pos.x, pos.z, t, 0);
    const tx = sea.drift.x + sx, tz = sea.drift.z + sz;
    const k = Math.min(1, DRAG * dt);
    vel.x += (tx - vel.x) * k; vel.z += (tz - vel.z) * k;
    pos.x = Math.max(-WORLD, Math.min(WORLD, pos.x + vel.x * dt));
    pos.y += vel.y * dt;
    pos.z = Math.max(-WORLD, Math.min(WORLD, pos.z + vel.z * dt));
    // Rocking: tilt follows the local wave slope; the gradient from +-PROBE samples.
    const dx = (hgt(pos.x + PROBE, pos.z, t) - hgt(pos.x - PROBE, pos.z, t)) / (2 * PROBE);
    const dz = (hgt(pos.x, pos.z + PROBE, t) - hgt(pos.x, pos.z - PROBE, t)) / (2 * PROBE);
    const a = 1 - Math.exp(-ROCK_RATE * dt);
    rx += (Math.atan(dz) - rx) * a; rz += (-Math.atan(dx) - rz) * a;
    mesh.rotation.set(rx, mesh.rotation.y + 0.15 * dt, rz);
  }

  return {
    mesh, step,
    get state() { return state; },
    get pos() { return pos; },
    /** The claw closed on it. The first grab from `held` tells the core the key is gone. */
    grab() {
      if (state === KEY_CONSUMED) return false;
      if (state === KEY_HELD && BLOB.ready) BLOB.ex.pp_blob_key_stolen();
      state = KEY_GRABBED; return true;
    },
    /** The claw let go: the key keeps the drone's velocity for a moment, the drag takes it from there. */
    release(v) {
      if (state !== KEY_GRABBED) return;
      state = KEY_LOOSE; vel.x = v ? v.x : 0; vel.y = v ? v.y * 0.5 : 0; vel.z = v ? v.z : 0;
    },
    consume() { state = KEY_CONSUMED; mesh.visible = false; },
    dispose() { S.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); },
  };
}
