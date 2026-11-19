import * as THREE from 'three';
import { BLOB } from '../sim/blob.js';

// Instanced camera-facing impostors. One physics cell renders as K small grains,
// so the entity is huge and made of many small cells, not a handful of bubbles.
// Grains jostle inside the cell from its own strain (SPEC-BLOB-COLONY §8).
// No fog: the scene fog is (0.2,0.22,0.24) grey-blue and at 200 m it turns the
// coal into neutral grey. The anomaly does not obey the atmosphere.
const K = 8;

const VERT = `
attribute vec3 aCenter;
attribute float aRadius;
attribute vec3 aColor;
attribute float aEmit;
varying vec3 vColor;
varying float vEmit;
varying vec2 vUv;
void main(){
  vUv = position.xy;
  vec4 mvPosition = modelViewMatrix * vec4(aCenter, 1.0);
  mvPosition.xy += position.xy * aRadius;
  gl_Position = projectionMatrix * mvPosition;
  vColor = aColor;
  vEmit = aEmit;
}`;

const FRAG = `
varying vec3 vColor;
varying float vEmit;
varying vec2 vUv;
void main(){
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float z = sqrt(max(0.0, 1.0 - r2));
  vec3 n = vec3(vUv, z);
  vec3 L = normalize(vec3(-0.35, 0.75, 0.55));
  float diff = max(dot(n, L), 0.0);
  // no rim, no ambient tint, no fog: the only light is the cell's own colour and its ember.
  vec3 col = vColor * (0.12 + 0.88 * diff)
           + vColor * vEmit * 1.8;
  // normalise instead of clipping: clipping the red channel alone shifts the hue
  // toward orange, which is exactly what must never happen here.
  float m = max(col.r, max(col.g, col.b));
  if (m > 1.0) col /= m;
  gl_FragColor = vec4(col, 1.0);
}`;

const frac = (x) => x - Math.floor(x);

export function createBlob(S, origin, scale = 1) {
  const N = BLOB.N || 2000;
  const M = N * K;
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(2, 2);
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  const aC = new THREE.InstancedBufferAttribute(new Float32Array(M * 3), 3);
  const aR = new THREE.InstancedBufferAttribute(new Float32Array(M), 1);
  const aCol = new THREE.InstancedBufferAttribute(new Float32Array(M * 3), 3);
  const aE = new THREE.InstancedBufferAttribute(new Float32Array(M), 1);
  for (const a of [aC, aR, aCol, aE]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aCenter', aC);
  geo.setAttribute('aRadius', aR);
  geo.setAttribute('aColor', aCol);
  geo.setAttribute('aEmit', aE);
  geo.instanceCount = M;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 8 * scale);

  // Static grain layout inside one cell: Fibonacci sphere at 0.62 of the cell radius.
  const OFF = new Float32Array(K * 3);
  const PH = new Float32Array(K);
  const HG = new Float32Array(K * 3);
  for (let g = 0; g < K; g++) {
    const y = 1 - 2 * (g + 0.5) / K;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const a = g * 2.399963229728653;
    OFF[3 * g] = Math.cos(a) * rr * 0.62;
    OFF[3 * g + 1] = y * 0.62;
    OFF[3 * g + 2] = Math.sin(a) * rr * 0.62;
    PH[g] = g * 1.7;
    HG[3 * g] = frac(Math.sin(g * 12.9898 + 1.0) * 43758.5453);
    HG[3 * g + 1] = frac(Math.sin(g * 78.233 + 2.0) * 43758.5453);
    HG[3 * g + 2] = frac(Math.sin(g * 37.719 + 3.0) * 43758.5453);
  }
  const GRAIN = 0.5; // grain radius = 0.5 * cell radius -> 8 grains fill the cell
  const JOSTLE = 0.35; // A from SPEC-BLOB-COLONY §8
  const OMEGA = 2.4;

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    fog: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.position.copy(origin);
  S.add(mesh);

  const P = BLOB.pos, C = BLOB.col, S2 = BLOB.st2;
  function update(t = 0) {
    if (!BLOB.ready) return;
    const n = BLOB.N;
    const c = aC.array, r = aR.array, cc = aCol.array, e = aE.array;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const px = P[o] * scale, py = P[o + 1] * scale, pz = P[o + 2] * scale;
      const rr = P[o + 3] * scale;
      const cr = C[o], cg = C[o + 1], cb = C[o + 2], ce = C[o + 3];
      // grain jostle: zero at rest, grows with strain, dies with bond health
      const st = S2[o], hm = S2[o + 1], cid = S2[o + 2], ft = S2[o + 3];
      const amp = JOSTLE * st * (0.5 + 0.5 * hm) * (1 + 0.5 * ft);
      const ph = cid * 6.2831853 + t * OMEGA;
      // no emission boost for detached cells: a coal cell with ft>0 was rendering
      // as a dim warm grey, which reads as beige inside the body.
      const em = ce;
      for (let g = 0; g < K; g++) {
        const j = i * K + g;
        const s = 1 + 0.12 * Math.sin(t * 1.7 + PH[g]);
        let jx = 0, jy = 0, jz = 0;
        if (amp > 1e-4) {
          jx = amp * ((HG[3 * g] - 0.5) * 2 + 0.6 * Math.sin(ph + HG[3 * g] * 6.2831853));
          jy = amp * ((HG[3 * g + 1] - 0.5) * 2 + 0.6 * Math.sin(ph + HG[3 * g + 1] * 6.2831853));
          jz = amp * ((HG[3 * g + 2] - 0.5) * 2 + 0.6 * Math.sin(ph + HG[3 * g + 2] * 6.2831853));
          const jl = Math.sqrt(jx * jx + jy * jy + jz * jz);
          if (jl > 0.2) { const k = 0.2 / jl; jx *= k; jy *= k; jz *= k; }
        }
        c[j * 3] = px + (OFF[3 * g] + jx) * rr * s;
        c[j * 3 + 1] = py + (OFF[3 * g + 1] + jy) * rr * s;
        c[j * 3 + 2] = pz + (OFF[3 * g + 2] + jz) * rr * s;
        r[j] = rr * GRAIN;
        cc[j * 3] = cr; cc[j * 3 + 1] = cg; cc[j * 3 + 2] = cb;
        e[j] = em;
      }
    }
    aC.needsUpdate = true; aR.needsUpdate = true;
    aCol.needsUpdate = true; aE.needsUpdate = true;
  }

  function dispose() {
    S.remove(mesh);
    geo.dispose(); mat.dispose(); quad.dispose();
  }

  return { mesh, update, dispose, origin, scale, grains: M };
}
