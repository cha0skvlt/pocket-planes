// JS wrapper for the WASM core. Boundary contract from rust/src/lib.rs:
// JS creates the PPState views once at init, then only pp_step + reads of ready buffers.
// Build: rust/scripts/build.sh. No wasm-bindgen — plain extern "C" + WebAssembly.Memory.
//
// ## PPState offsets (match #[repr(C)] in rust/src/lib.rs, bump together)
//  w1: 0x000 (28) — shader uniform array (dx,dz,k,A)×7
//  w2: 0x070 (28) — (ω,φ,sAlong,sAcross)×7
//  w3: 0x0E0 (28) — (cg,offU,offV,warp)×7
//  ratio: 0x150 (7)
//  sea_misc: 0x16C (4) — drift.x, drift.z, th, Us
//  wind: 0x17C (4) — u10, dir, t, g
//  wind_adv: 0x18C (2)
//  at_out: 0x194 (4) — x, y, z, g of the last at()
//  obst_count: 0x1A4 (u32)
//  obst: 0x1AC (4096×5) — buildings {x, z, hw, hd, top}

export const PP = { ready: false };

export const PP_OFF = {
  w1: 0x000, w2: 0x070, w3: 0x0E0, ratio: 0x150,
  sea_misc: 0x16C, wind: 0x17C, wind_adv: 0x18C, at_out: 0x194,
  obst_count: 0x1A4, obst: 0x1AC,
};
export const MAX_OBST = 4096;

// cache-busting for the wasm: the browser may serve a stale pocket_physics.wasm
// (physically identical file on disk, stale bytes in cache). Hard-reload once
// (Cmd+Shift+R) if the human controls misbehave after a core change.
export const BUILD_TAG = '2025-11-02.3'; // bump on every core change — cache-busting for the wasm

export async function initPP() {
  // Hard no-cache: dev server sends Cache-Control: no-store for the wasm,
  // and the URL carries a build tag — a stale cached core is impossible.
  const res = await fetch(new URL('./pocket_physics.wasm?v=' + BUILD_TAG, import.meta.url), { cache: 'no-store' });
  const bytes = await res.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, { env: {} });
  const ex = instance.exports;
  const statePtr = ex.pp_init();
  const mem = ex.memory;
  const f32 = (o, l) => new Float32Array(mem.buffer, statePtr + o, l);
  PP.statePtr = statePtr;
  PP.memory = mem;
  PP.w1 = f32(PP_OFF.w1, 28);
  PP.w2 = f32(PP_OFF.w2, 28);
  PP.w3 = f32(PP_OFF.w3, 28);
  PP.ratio = f32(PP_OFF.ratio, 7);
  PP.seaMisc = f32(PP_OFF.sea_misc, 4);
  PP.wind = f32(PP_OFF.wind, 4);
  PP.windAdv = f32(PP_OFF.wind_adv, 2);
  PP.atOut = f32(PP_OFF.at_out, 4);
  PP.obstCount = new Uint32Array(mem.buffer, statePtr + PP_OFF.obst_count, 1);
  PP.obst = new Float32Array(mem.buffer, statePtr + PP_OFF.obst, MAX_OBST * 5);
  PP.step = ex.pp_step;
  PP.hgt = (x, z, t) => ex.pp_hgt(x, z, t);
  PP.at = ex.pp_at;
  PP.setObstacles = ex.pp_set_obstacles;
  PP.modPtr = ex.pp_mod_ptr;
  // MOD tile: bytes straight from WASM memory (same seed 777, same layout).
  const modPtr = ex.pp_mod_ptr();
  PP.MOD = new Uint8Array(mem.buffer, modPtr, 256 * 256 * 4);
  PP.MOD_SIZE = 256;
  PP.ready = true;
  return PP;
}

// Compatibility with the old sea.js/wind.js API so main.js/drone.js stay untouched:
// sea.w1 → PP.w1, hgt() → PP.hgt(), createWind() → wrapper around PP.at().
export const sea = {
  get w1() { return PP.w1 }, get w2() { return PP.w2 }, get w3() { return PP.w3 },
  get ratio() { return PP.ratio },
  get MOD() { return PP.MOD }, get MOD_SIZE() { return PP.MOD_SIZE },
  get drift() { return { x: PP.seaMisc[0], z: PP.seaMisc[1] } },
  get th() { return PP.seaMisc[2] }, get Us() { return PP.seaMisc[3] },
};
export function updateSea(dt, wind) { PP.step(dt, wind.u10, wind.dir); }
export function hgt(x, z, t) { return PP.hgt(x, z, t); }
export function createWind() {
  return {
    get u10() { return PP.wind[0] }, get dir() { return PP.wind[1] }, get U0() { return 12 },
    get g() { return PP.wind[3] }, get adv() { return { x: PP.windAdv[0], z: PP.windAdv[1] } },
    setObstacles(list) {
      const n = Math.min(list.length, MAX_OBST);
      for (let i = 0; i < n; i++) {
        const b = list[i], o = i * 5;
        PP.obst[o] = b.x; PP.obst[o + 1] = b.z; PP.obst[o + 2] = b.hw; PP.obst[o + 3] = b.hd; PP.obst[o + 4] = b.top;
      }
      PP.setObstacles(n);
    },
    update(_dt, _t) { /* the wind steps inside pp_step together with the sea */ },
    at(x, y, z, o) {
      PP.at(x, y, z); // writes into at_out
      const v = PP.atOut;
      o.x = v[0]; o.y = v[1]; o.z = v[2];
    },
  };
}
