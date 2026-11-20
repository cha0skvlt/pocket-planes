import * as THREE from 'three';
import { WARM } from '../sim/key.js';

const W0 = 1.2, H0 = 1.6, SQ = 6, OPEN_T = 1.2, TRIGGER = 3.0, DEPTH = 1.5, FADE_T = 1.5;
const smooth = x => x * x * (3 - 2 * x);

/** One warm window on the building nearest to the origin. It is the only warm light in a cold
 *  world. Placement is derived from the city, no new seed: the same city always gives the same door. */
export function createPortal({ S, city }) {
  let b = null, bd = Infinity;
  for (const c of city.bl) { const d = c.x * c.x + c.z * c.z; if (c.top > 8 && d < bd) { bd = d; b = c; } }
  if (!b) return null;
  // The face looking at the origin: the dominant axis of (origin - centre).
  const ax = Math.abs(b.x) > Math.abs(b.z);
  const sgn = ax ? -Math.sign(b.x || 1) : -Math.sign(b.z || 1);
  const n = ax ? [sgn, 0, 0] : [0, 0, sgn], u = ax ? [0, 0, 1] : [1, 0, 0];
  const cy = 0.6 * b.top, OFF = 0.05;
  const cx = ax ? b.x + sgn * (b.hw + OFF) : b.x, cz = ax ? b.z : b.z + sgn * (b.hd + OFF);
  const center = new THREE.Vector3(cx, cy, cz);

  const mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: WARM, emissiveIntensity: 2.4, fog: false });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  // second quad: an additive halo so the dot reads across the city; it grows with the window
  const haloMat = new THREE.MeshBasicMaterial({ color: WARM, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), haloMat);
  const rotY = ax ? sgn * Math.PI / 2 : (sgn > 0 ? 0 : Math.PI);
  for (const m of [glass, halo]) { m.position.copy(center); m.rotation.y = rotY; S.add(m); }
  halo.position.x += n[0] * 0.02; halo.position.z += n[2] * 0.02;
  glass.scale.set(W0, H0, 1); halo.scale.set(W0 * 2.2, H0 * 2.2, 1);
  const light = new THREE.PointLight(WARM, 1.2, 18);
  light.position.set(cx + n[0], cy, cz + n[2]); S.add(light);

  let open = false, p = 0, won = false, fade = 0, veil = null;
  const ev = { opened: false, won: false };

  function showWin() {
    veil = document.createElement('div');
    veil.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:none;background:#fff3de;opacity:0;display:flex;align-items:center;justify-content:center;font:700 clamp(28px,6vw,72px)/1 ui-monospace,Menlo,monospace;letter-spacing:.2em;color:#3a2412';
    veil.textContent = 'YOU ARE OUT';
    document.body.appendChild(veil);
  }

  /** ctx: {tip, keyGrabbed, carried, hx, hy, hz} (hx..hz = operator capsule centre). Returns shared flags. */
  function update(dt, ctx) {
    ev.opened = false; ev.won = false;
    if (!open && ctx.keyGrabbed && center.distanceTo(ctx.tip) < TRIGGER) { open = true; ev.opened = true; }
    if (open && p < 1) {
      p = Math.min(1, p + dt / OPEN_T); const s = smooth(p);
      glass.scale.set(W0 + (SQ - W0) * s, H0 + (SQ - H0) * s, 1);
      halo.scale.set((W0 + (SQ - W0) * s) * 2.2, (H0 + (SQ - H0) * s) * 2.2, 1);
      mat.emissiveIntensity = 2.4 + 0.8 * s; light.distance = 18 + 22 * s;
    }
    if (open && !won && ctx.carried) {
      // capsule centre against the square, in the plane of the facade (+-3 across/up) and +-1.5 in depth
      const dx = ctx.hx - cx, dz = ctx.hz - cz;
      const across = ax ? dz : dx, depth = ax ? dx : dz;
      if (Math.abs(across) < SQ / 2 && Math.abs(ctx.hy - cy) < SQ / 2 && Math.abs(depth) < DEPTH) { won = true; ev.won = true; showWin(); }
    }
    if (won && veil) { fade = Math.min(1, fade + dt / FADE_T); veil.style.opacity = String(fade); }
    return ev;
  }

  return {
    update, center, get open() { return open; }, get won() { return won; },
    dispose() { S.remove(glass); S.remove(halo); S.remove(light); glass.geometry.dispose(); halo.geometry.dispose(); mat.dispose(); haloMat.dispose(); if (veil) veil.remove(); },
  };
}
