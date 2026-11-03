import * as THREE from 'three';
import { BufferGeometryUtils } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createHumanPhys } from './human-phys.js';
import { PP } from '../sim/pp.js';
import { sea } from '../sim/pp.js';
import { hgt } from '../world/waves.js';

// Bathy-scaphe orange — dark 80s soviet plastic orange, like an iPhone Pro Max deep orange.
// Matte black visor, black joints. Soft, puffy, life-raft suit: it floats by itself.
const SUIT = 0xc45a1e;      // deep bathyscaphe orange
const SUIT_DARK = 0x8f3d12; // shaded orange for depth
const BLACK = 0x141414;     // matte black: visor, joints, accents
const BLACK_SOFT = 0x1e1e1e;

// three r128 has no CapsuleGeometry (added in r131) — build one from cylinder + hemispheres.
function capsule(r, len, capSeg = 6, radial = 12) {
  const parts = [];
  if (len > 0) parts.push(new THREE.CylinderGeometry(r, r, len, radial, 1, true).translate(0, 0, 0));
  const top = new THREE.SphereGeometry(r, radial, capSeg, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, len / 2, 0);
  const bot = new THREE.SphereGeometry(r, radial, capSeg, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(0, -len / 2, 0);
  parts.push(top, bot);
  return BufferGeometryUtils.mergeBufferGeometries(parts);
}

/** The human body: a puffy rescue-diver suit rendered as soft capsules.
 *  Physics lives in JS (flight/human-phys.js) — same pattern as the drone:
 *  it reads the sea (WASM proxy or JS reference) through one interface.
 *  This module renders the body, applies the wave ragdoll (tilt + limb sway
 *  from wave_hit) and drives the camera.
 *  city: {bl} AABB list for ground height and capsule collision. */
export function createHuman(city) {
  const S = PP.scene, cam = PP.camera; // renderer scene/camera, registered by main.js at boot
  // physics from human-phys.js: spawn/step + live state getters
  const phys = createHumanPhys({ city, sea, hgt });

  const mat = {
    suit: new THREE.MeshStandardMaterial({ color: SUIT, roughness: 0.55, metalness: 0.05 }),
    suitDark: new THREE.MeshStandardMaterial({ color: SUIT_DARK, roughness: 0.6, metalness: 0.05 }),
    black: new THREE.MeshStandardMaterial({ color: BLACK, roughness: 0.9, metalness: 0.0 }),
    visor: new THREE.MeshStandardMaterial({ color: BLACK_SOFT, roughness: 0.25, metalness: 0.1 }),
  };

  const root = new THREE.Group();   // world position (feet)
  const body = new THREE.Group();   // tilt/ragdoll applied here
  root.add(body);

  // torso: puffy capsule
  const torso = new THREE.Mesh(capsule(0.34, 0.5, 6, 14), mat.suit);
  torso.position.y = 1.05;
  body.add(torso);
  // belly pad — the suit is duffed, slightly wider at the bottom
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 10), mat.suit);
  belly.scale.set(1, 0.8, 0.9);
  belly.position.y = 0.85;
  body.add(belly);

  // backpack: life-support block, black
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.24), mat.black);
  pack.position.set(0, 1.15, -0.32);
  body.add(pack);

  // helmet: orange sphere + matte black visor
  const helmet = new THREE.Group();
  helmet.position.y = 1.62;
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), mat.suit);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), mat.visor);
  visor.rotation.x = -0.35;
  visor.position.z = 0.06;
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.05, 8, 16), mat.black);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = -0.2;
  helmet.add(shell, visor, collar);
  body.add(helmet);

  // arms: shoulder (black joint) + puffy upper + forearm
  function arm(side) {
    const g = new THREE.Group();
    g.position.set(0.38 * side, 1.32, 0);
    const joint = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), mat.black);
    const upper = new THREE.Mesh(capsule(0.11, 0.3, 5, 10), mat.suit);
    upper.position.y = -0.2;
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), mat.black);
    elbow.position.y = -0.4;
    const fore = new THREE.Mesh(capsule(0.1, 0.26, 5, 10), mat.suit);
    fore.position.y = -0.58;
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), mat.black);
    glove.position.y = -0.76;
    g.add(joint, upper, elbow, fore, glove);
    body.add(g);
    return g;
  }
  const armL = arm(-1), armR = arm(1);

  // legs: hip joint + puffy thigh + knee + boot
  function leg(side) {
    const g = new THREE.Group();
    g.position.set(0.16 * side, 0.72, 0);
    const joint = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), mat.black);
    const thigh = new THREE.Mesh(capsule(0.13, 0.32, 5, 10), mat.suit);
    thigh.position.y = -0.24;
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), mat.black);
    knee.position.y = -0.46;
    const shin = new THREE.Mesh(capsule(0.11, 0.3, 5, 10), mat.suit);
    shin.position.y = -0.66;
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.26), mat.black);
    boot.position.set(0, -0.86, 0.04);
    g.add(joint, thigh, knee, shin, boot);
    body.add(g);
    return g;
  }
  const legL = leg(-1), legR = leg(1);

  S.add(root);

  // ---- ragdoll state (view-side inertia, physics stays in Rust) ----
  const rag = {
    tiltX: 0, tiltZ: 0,        // smoothed body tilt
    sway: 0, swayV: 0,         // limb sway phase
    bob: 0, bobV: 0,           // vertical bob from waves
    walkPhase: 0,              // leg swing while walking
    lastVy: 0,
  };

  let active = false; // is the camera on this body
  // FPV: the human never sees his own suit — hide the body while his camera is
  // active (same rule as the drone skin).
  root.visible = false;

  function step(dt, t, inp) {
    // ONE call: JS physics first (human-phys owns the FSM), then render + camera.
    // inp comes from main.js (input.human()) — the wrapper must forward it,
    // otherwise phys sees undefined and the velocity goes NaN.
    phys.step(dt, t, inp);
    const p = phys.pos, v = phys.vel;
    root.position.set(p.x, p.y, p.z);
    body.rotation.y = phys.yaw;

    const swimming = phys.state === 2;
    const waveHit = phys.waveHit;
    const crouch = phys.crouch;

    // ---- ragdoll: wave tilt with inertia ----
    // tilt comes as (magnitude, azimuth) from the wave slope; convert to body axes
    const tiltMag = phys.tilt, tiltDir = phys.tiltDir;
    // world tilt direction -> body-local (body yaw rotates the frame)
    const rel = tiltDir - phys.yaw;
    const targetX = Math.cos(rel) * tiltMag;  // forward/back lean
    const targetZ = Math.sin(rel) * tiltMag;  // side lean
    // spring-damper feel: the suit is soft, it lags behind the wave
    const lag = 1 - Math.exp(-(swimming ? 4.5 : 8) * dt);
    rag.tiltX += (targetX - rag.tiltX) * lag;
    rag.tiltZ += (targetZ - rag.tiltZ) * lag;
    body.rotation.x = rag.tiltX;
    body.rotation.z = rag.tiltZ;

    // ---- limb sway: waves and walking ----
    if (swimming) {
      // swimming: slow crawl, arms alternate; waves add chaos via waveHit
      rag.sway += dt * (2.2 + waveHit * 4);
      const s = Math.sin(rag.sway), c = Math.cos(rag.sway);
      armL.rotation.x = -1.6 + s * 0.9 + waveHit * Math.sin(t * 7) * 0.4;
      armR.rotation.x = -1.6 - s * 0.9 + waveHit * Math.sin(t * 7 + 2) * 0.4;
      armL.rotation.z = 0.5; armR.rotation.z = -0.5;
      legL.rotation.x = c * 0.35; legR.rotation.x = -c * 0.35;
      // body lies more horizontal in water
      body.rotation.x += 0.9 + Math.sin(t * 1.7) * 0.08;
    } else {
      // walking: legs swing by speed, arms counter-swing
      const sp = Math.hypot(v.x, v.z);
      rag.walkPhase += dt * sp * 3.4;
      const swing = Math.sin(rag.walkPhase) * Math.min(sp / 4.2, 1) * 0.55;
      legL.rotation.x = swing; legR.rotation.x = -swing;
      armL.rotation.x = -swing * 0.7; armR.rotation.x = swing * 0.7;
      armL.rotation.z = 0.12; armR.rotation.z = -0.12;
      // crouch: fold the legs
      if (crouch) {
        legL.rotation.x = legR.rotation.x = 0.9;
        body.position.y = -0.55;
      } else {
        body.position.y = 0;
      }
      // wave shake on deck: small random jolts from wave_hit
      if (waveHit > 0.01) {
        body.rotation.z += Math.sin(t * 13) * waveHit * 0.05;
        body.rotation.x += Math.sin(t * 11 + 1) * waveHit * 0.04;
      }
    }

    // ---- camera ----
    if (active) {
      const eye = phys.eyeH; // stand/crouch
      const bob = swimming
        ? Math.sin(t * 1.9) * 0.06 + waveHit * Math.sin(t * 6) * 0.1
        : Math.abs(Math.sin(rag.walkPhase)) * 0.045 * Math.min(Math.hypot(v.x, v.z) / 1.6, 1);
      cam.position.set(p.x, p.y + eye + bob, p.z);
      cam.rotation.order = 'YXZ';
      cam.rotation.y = phys.yaw;
      cam.rotation.x = phys.pitch;
      // wave roll into the camera — you FEEL the sea leaning you
      cam.rotation.z = rag.tiltZ * 0.6;
    }
  }

  function dispose() {
    S.remove(root);
    root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    Object.values(mat).forEach(m => m.dispose());
  }

  return { root, step, dispose, setActive(v) { active = v; root.visible = !v; }, get active() { return active; },
    // physics passthrough (JS human-phys): spawn, live state
    spawn: (...a) => phys.spawn(...a),
    get pos() { return phys.pos; },
    get vel() { return phys.vel; },
    get yaw() { return phys.yaw; }, set yaw(v) { phys.yaw = v; },
    get pitch() { return phys.pitch; }, set pitch(v) { phys.pitch = v; },
    get tilt() { return phys.tilt; }, get tiltDir() { return phys.tiltDir; },
    get state() { return phys.state; }, get crouch() { return phys.crouch; },
    get waveHit() { return phys.waveHit; }, get eyeH() { return phys.eyeH; },
  };
}
