// JS bridge for the blob core (PPE-physics/src/blob). ABI v1.
// Same contract as pp.js: views are built once from linear memory, then only read.
// Out block (N_MAX = 8192): pos 0, col 4*MAX, aux 8*MAX, st2 12*MAX, meta 16*MAX.
// In block (544): wind 0, water 4, body0 8, body1 16, obstacles 24+8*o (o<64), count 536.
import { PP } from './pp.js';

export const BLOB = { ready: false, N: 0, MAX: 8192 };
export const BLOB_ABI = 1;

export function initBlob(seed = 12345, n = 2000) {
  const ex = PP.ex;
  if (!ex || !ex.pp_blob_init) return null;
  if (ex.pp_blob_abi_version() !== BLOB_ABI) {
    throw new Error(`blob ABI mismatch: core ${ex.pp_blob_abi_version()} != bridge ${BLOB_ABI}`);
  }
  ex.pp_blob_init(seed, n);
  const mem = ex.memory;
  const out = new Float32Array(mem.buffer, ex.pp_blob_out_ptr(), 16 * BLOB.MAX + 16);
  const inp = new Float32Array(mem.buffer, ex.pp_blob_in_ptr(), 544);
  BLOB.ex = ex;
  BLOB.mem = mem;
  BLOB.out = out;
  BLOB.inp = inp;
  BLOB.N = n;
  BLOB.pos = out.subarray(0, 4 * BLOB.MAX);
  BLOB.col = out.subarray(4 * BLOB.MAX, 8 * BLOB.MAX);
  BLOB.aux = out.subarray(8 * BLOB.MAX, 12 * BLOB.MAX);
  BLOB.st2 = out.subarray(12 * BLOB.MAX, 16 * BLOB.MAX);
  BLOB.meta = out.subarray(16 * BLOB.MAX, 16 * BLOB.MAX + 16);
  BLOB.step = (dt, t) => ex.pp_blob_step(dt, t);
  BLOB.setForm = (f, b) => ex.pp_blob_set_form(f, b);
  BLOB.impulse = (x, y, z, r, s) => ex.pp_blob_impulse(x, y, z, r, s);
  BLOB.ready = true;
  return BLOB;
}

// Input block, written by the caller once per frame (world space, metres).
// [0..4) wind xyz + gust | [4..8) water level | [8..16) body0 | [16..24) body1
export function blobInput(wind, waterY, b0, b1) {
  const i = BLOB.inp;
  if (!i) return;
  i[0] = wind.x; i[1] = wind.y; i[2] = wind.z; i[3] = wind.g || 0;
  i[4] = waterY;
  const put = (o, b) => {
    if (!b) { i[o + 7] = 0; return; }
    i[o] = b.x; i[o + 1] = b.y; i[o + 2] = b.z; i[o + 3] = b.r;
    i[o + 4] = b.vx || 0; i[o + 5] = b.vy || 0; i[o + 6] = b.vz || 0;
    i[o + 7] = 1;
  };
  put(8, b0);
  put(16, b1);
}

// The drone collides with the colony's cells as with a wall: push out along the
// normal, reflect with restitution 0.25 — the same rule city.collide uses.
// Cells are spheres of radius r*1.1 (the visual grain extent), so neighbours
// overlap and the surface is continuous, not a sieve.
export function blobCollide(pos, vel, radius, origin, scale) {
  const P = BLOB.pos;
  if (!P) return 0;
  const k = 1 / scale;
  let lx = (pos.x - origin.x) * k, ly = (pos.y - origin.y) * k, lz = (pos.z - origin.z) * k;
  const lr = radius * k;
  let s = 0;
  for (let i = 0, n = BLOB.N; i < n; i++) {
    const j = i * 4;
    const dx = lx - P[j], dy = ly - P[j + 1], dz = lz - P[j + 2];
    const rr = P[j + 3] + lr;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= rr * rr) continue;
    if (d2 < 1e-12) { ly += rr; continue; } // dead centre: no normal, eject upward
    const d = Math.sqrt(d2);
    const nx = dx / d, ny = dy / d, nz = dz / d;
    // soft push-out: a hard one stops the drone at the outer shell and it never
    // gets inside. Half the penetration per frame lets it sink in while the
    // viscosity of the medium does the slowing.
    const pen = (rr - d) * 0.5;
    lx += nx * pen; ly += ny * pen; lz += nz * pen;
    const vn = vel.x * nx + vel.y * ny + vel.z * nz;
    if (vn < 0) {
      vel.x -= 1.10 * vn * nx;
      vel.y -= 1.10 * vn * ny;
      vel.z -= 1.10 * vn * nz;
      s += Math.min(1, Math.abs(vn) * 0.03);
    }
  }
  pos.x = origin.x + lx * scale;
  pos.y = origin.y + ly * scale;
  pos.z = origin.z + lz * scale;
  return s;
}

// Viscosity of the medium: the drone inside the colony is slowed by the number of
// cells it is in contact with. This is what stops it from flying straight out.
// damp < 1 is the softlock escape: after 6 s of contact the drag fades out.
export function blobDrag(pos, vel, radius, origin, scale, dt, damp = 1) {
  const P = BLOB.pos;
  if (!P) return 0;
  const k = 1 / scale;
  const lx = (pos.x - origin.x) * k, ly = (pos.y - origin.y) * k, lz = (pos.z - origin.z) * k;
  const lr = radius * k;
  let n = 0;
  for (let i = 0, N = BLOB.N; i < N; i++) {
    const j = i * 4;
    const dx = lx - P[j], dy = ly - P[j + 1], dz = lz - P[j + 2];
    const rr = P[j + 3] + lr;
    if (dx * dx + dy * dy + dz * dz < rr * rr) n++;
  }
  if (n === 0) return 0;
  const f = Math.exp(-Math.min(8, 1.5 * n) * damp * dt);
  vel.x *= f; vel.y *= f; vel.z *= f;
  return n;
}

// Obstacles: up to 64 AABBs in local units. inp[24+8*o] = x,z,hw,hd,top,0,0,0; inp[536] = count.
export function blobObstacles(boxes, origin, scale) {
  const i = BLOB.inp;
  if (!i) return;
  const n = Math.min(boxes.length, 64);
  for (let o = 0; o < n; o++) {
    const b = boxes[o], k = 24 + 8 * o;
    i[k] = (b.x - origin.x) / scale;
    i[k + 1] = (b.z - origin.z) / scale;
    i[k + 2] = b.hw / scale;
    i[k + 3] = b.hd / scale;
    i[k + 4] = (b.top - origin.y) / scale;
    i[k + 5] = 0; i[k + 6] = 0; i[k + 7] = 0;
  }
  i[536] = n;
}
