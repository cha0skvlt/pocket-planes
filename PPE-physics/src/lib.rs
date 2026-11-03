//! WASM/JS API boundary: Rust steps the physics, JS reads ready-made buffers from linear memory.
//!
//! ## Contract
//!
//! One static `PP_STATE` at the start of linear memory, layout is `#[repr(C)]`, all offsets
//! fixed. JS creates `Float32Array` views **once** at init and afterwards only reads:
//! zero copies per frame, zero `JsValue` traffic in the hot loop.
//!
//! | offset | block | contents |
//! |---|---|---|
//! | `0x000` | `w1` `[f32; 28]` | shader uniform array (N=7 waves × 4) |
//! | `0x070` | `w2` `[f32; 28]` | |
//! | `0x0E0` | `w3` `[f32; 28]` | |
//! | `0x150` | `ratio` `[f32; 7]` | |
//! | `0x16C` | `sea_misc` `[f32; 4]` | drift.x, drift.z, th, Us |
//! | `0x17C` | `wind` `[f32; 4]` | u10, dir, t, g |
//! | `0x18C` | `wind_adv` `[f32; 2]` | adv.x, adv.z |
//! | `0x194` | `at_out` `[f32; 4]` | wind vector of the last `at()` + g |
//! | `0x1A4` | `obst_count` `u32` | |
//! | `0x1AC` | `obst` `[f32; 5] × 4096` | buildings `{x, z, hw, hd, top}` (input from JS) |
//!
//! `Sea`/`Wind` live on the Rust heap (Box in a static), their state is mirrored into
//! `PP_STATE` once per step. The modulation field (256×256 RGBA) is served via `pp_mod_ptr()` —
//! JS wraps it in a `THREE.DataTexture` without a copy.
//!
//! Bodies (drone, human) do NOT live here: they are JS-side (flight/drone.js,
//! flight/human-phys.js) and read the environment through this boundary — wind via
//! `pp_at`, water via `pp_hgt`. Only the environment simulation is Rust.
//!
//! Access to `static mut` goes through raw pointers (`addr_of_mut!`) — the 2024 edition
//! forbids `&mut STATIC` directly; raw pointers keep the same semantics without the lint noise.

use crate::sea::Sea;
use crate::wind::Wind;

pub mod rng;
pub mod sea;
pub mod wind;

/// Everything JS reads per frame. `#[repr(C)]` — offsets are fixed, change only with a bump.
#[repr(C)]
pub struct PPState {
    pub w1: [f32; 28],
    pub w2: [f32; 28],
    pub w3: [f32; 28],
    pub ratio: [f32; 7],
    pub sea_misc: [f32; 4], // drift.x, drift.z, th, Us
    pub wind: [f32; 4],     // u10, dir, t, g
    pub wind_adv: [f32; 2], // adv.x, adv.z
    pub at_out: [f32; 4],   // x, y, z, g of the last at()
    pub obst_count: u32,
    pub _pad: u32,
    pub obst: [[f32; 5]; MAX_OBST],
}

pub const MAX_OBST: usize = 4096;

/// Offset past the obstacle block (bytes from PPState start) — end of the JS-facing state.
/// obst starts at 0x1AC, 4096×20 bytes = 0x8000, so the state block ends at 0x81AC.
pub const OBST_END: usize = 0x1AC + MAX_OBST * 20;

/// Pointer to PPState in linear memory (permanent, lives as long as the module).
#[no_mangle]
pub static mut PP_STATE: PPState = PPState {
    w1: [0.0; 28],
    w2: [0.0; 28],
    w3: [0.0; 28],
    ratio: [1.0; 7],
    sea_misc: [0.0; 4],
    wind: [12.0, 0.0, 0.0, 0.0],
    wind_adv: [0.0; 2],
    at_out: [0.0; 4],
    obst_count: 0,
    _pad: 0,
    obst: [[0.0; 5]; MAX_OBST],
};

static mut SEA: Option<Box<Sea>> = None;
static mut WIND: Option<Box<Wind>> = None;

// Raw-pointer accessors: the 2024 edition forbids `&mut STATIC` directly.
#[inline(always)]
fn sea_mut() -> &'static mut Sea {
    unsafe { (*core::ptr::addr_of_mut!(SEA)).as_mut().unwrap() }
}
#[inline(always)]
fn sea_ref() -> &'static Sea {
    unsafe { (*core::ptr::addr_of!(SEA)).as_ref().unwrap() }
}
#[inline(always)]
fn wind_mut() -> &'static mut Wind {
    unsafe { (*core::ptr::addr_of_mut!(WIND)).as_mut().unwrap() }
}
#[inline(always)]
fn state() -> &'static mut PPState {
    unsafe { &mut *core::ptr::addr_of_mut!(PP_STATE) }
}

/// Init: construct Sea and Wind, write the initial state into PP_STATE.
/// Returns the PPState pointer — JS builds its views from it.
#[no_mangle]
pub extern "C" fn pp_init() -> *mut PPState {
    unsafe {
        let mut sea = Box::new(Sea::new());
        let mut wind = Box::new(Wind::new());
        wind.update(0.0, 0.0);
        sea.update(0.0, sea::U_REF, sea::TH0);
        (*core::ptr::addr_of_mut!(SEA)) = Some(sea);
        (*core::ptr::addr_of_mut!(WIND)) = Some(wind);
        sync();
        core::ptr::addr_of_mut!(PP_STATE)
    }
}

/// Main step: wind → sea → sync into PP_STATE. JS calls it once per frame.
#[no_mangle]
pub extern "C" fn pp_step(dt: f32, t: f32) {
    let wind = wind_mut();
    let sea = sea_mut();
    wind.update(dt as f64, t as f64);
    sea.update(dt as f64, wind.u10, wind.dir);
    unsafe { sync() };
}

/// Water height. Mirror of the GLSL H(); used by the drone, container and camera bob.
#[no_mangle]
pub extern "C" fn pp_hgt(x: f32, z: f32, t: f32) -> f32 {
    sea_ref().hgt(x as f64, z as f64, t as f64) as f32
}

/// Wind vector at a point; writes into at_out (JS reads the same memory).
#[no_mangle]
pub extern "C" fn pp_at(x: f32, y: f32, z: f32) -> *const f32 {
    let v = wind_mut().at(x as f64, y as f64, z as f64);
    let st = state();
    st.at_out = [v.x as f32, v.y as f32, v.z as f32, v.g as f32];
    st.wind[3] = v.g as f32;
    st.at_out.as_ptr()
}

/// Obstacles: JS writes `[f32; 5]×count` straight into PP_STATE.obst (same memory) and calls this.
/// ⚠ No allocations after pp_init: any allocation can grow the WASM linear memory
/// and detach the JS Float32Array views (TypeError: firstElem.toArray). Only clear+push
/// into the buffer reserved in Wind::new().
#[no_mangle]
pub extern "C" fn pp_set_obstacles(count: u32) {
    let count = (count as usize).min(MAX_OBST);
    let flat_ptr = unsafe { core::ptr::addr_of!((*core::ptr::addr_of_mut!(PP_STATE)).obst) };
    let flat = unsafe { &*flat_ptr };
    wind_mut().set_obstacles_flat(flat, count);
    state().obst_count = count as u32;
}

/// Pointer to the RGBA modulation field (256×256×4), for `THREE.DataTexture`.
#[no_mangle]
pub extern "C" fn pp_mod_ptr() -> *const u8 {
    sea_ref().mod_field.as_ptr()
}

/// Copy the Sea/Wind state into PPState (one sync per step, not per read).
unsafe fn sync() {
    let sea = sea_ref();
    let wind = (*core::ptr::addr_of!(WIND)).as_ref().unwrap();
    let st = state();
    st.w1 = sea.w1;
    st.w2 = sea.w2;
    st.w3 = sea.w3;
    st.ratio = sea.ratio;
    st.sea_misc = [
        sea.drift.0 as f32,
        sea.drift.1 as f32,
        sea.th as f32,
        sea.us as f32,
    ];
    st.wind = [
        wind.u10 as f32,
        wind.dir as f32,
        wind.t as f32,
        wind.g as f32,
    ];
    st.wind_adv = [wind.adv.0 as f32, wind.adv.1 as f32];
}
