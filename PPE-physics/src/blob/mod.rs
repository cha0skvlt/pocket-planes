mod sim;
mod state;
mod util;
use state::*;

#[no_mangle]
pub extern "C" fn pp_blob_init(seed: u32, n: u32) -> *mut B {
    if st().inited != 0 && st().n == (n as usize).clamp(64, NM) { return st() as *mut B; }
    init(seed, n) as *mut B
}
#[no_mangle]
pub extern "C" fn pp_blob_step(dt: f32, t: f32) { sim::step(st(), dt, t); }
#[no_mangle]
pub extern "C" fn pp_blob_out_ptr() -> *const f32 { st().out.as_ptr() }
#[no_mangle]
pub extern "C" fn pp_blob_in_ptr() -> *mut f32 { st().inp.as_mut_ptr() }
#[no_mangle]
pub extern "C" fn pp_blob_set_form(form: u32, blend: f32) { sim::set_form(st(), form, blend); }
#[no_mangle]
pub extern "C" fn pp_blob_impulse(x: f32, y: f32, z: f32, r: f32, s: f32) {
    let b = st();
    for i in 0..b.n {
        let d = [b.p[i][0]-x, b.p[i][1]-y, b.p[i][2]-z];
        let l = util::len(d);
        if l < r {
            let nn = util::norm(d); let f = s * (1.0 - l / r);
            for k in 0..3 { b.v[i][k] += nn[k] * f; }
        }
    }
}
#[no_mangle]
pub extern "C" fn pp_blob_abi_version() -> u32 { 1 }
