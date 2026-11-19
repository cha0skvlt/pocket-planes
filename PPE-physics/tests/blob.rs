//! Blob core tests: determinism, hostile inputs, invariants, contract.
//! The core keeps its state in a static, so every test takes LOCK and uses a
//! unique n to force a re-init.

use pocket_physics::blob::*;
use std::sync::Mutex;

static LOCK: Mutex<()> = Mutex::new(());
fn lock() -> std::sync::MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}
const MAX: usize = 8192;
const OUT_LEN: usize = 16 * MAX + 16;

fn out() -> &'static [f32] {
    unsafe { std::slice::from_raw_parts(pp_blob_out_ptr(), OUT_LEN) }
}
fn inp() -> &'static mut [f32] {
    unsafe { std::slice::from_raw_parts_mut(pp_blob_in_ptr(), 544) }
}

fn clear_input() {
    let i = inp();
    for v in i.iter_mut() { *v = 0.0; }
    i[4] = -100.0; // water far below
}

fn run(seed: u32, n: u32, steps: usize, drone: Option<[f32; 4]>) -> Vec<f32> {
    // pp_blob_init is idempotent for the same n: force a real reset first
    pp_blob_init(seed, n + 1);
    pp_blob_init(seed, n);
    clear_input();
    if let Some(d) = drone {
        let i = inp();
        i[8] = d[0]; i[9] = d[1]; i[10] = d[2]; i[11] = d[3]; i[15] = 1.0;
    }
    for s in 0..steps { pp_blob_step(1.0 / 60.0, s as f32 / 60.0); }
    let o = out();
    o[0..4 * n as usize].to_vec()
}

#[test]
fn deterministic_same_seed() {
    let _g = lock();
    let a = run(12345, 512, 300, None);
    let b = run(12345, 512, 300, None);
    let same = a.iter().zip(b.iter()).all(|(x, y)| x == y);
    assert!(same, "same seed must give bit-identical positions");
}

#[test]
fn different_seed_differs() {
    let _g = lock();
    let a = run(12345, 520, 120, None);
    let b = run(999, 520, 120, None);
    let same = a.iter().zip(b.iter()).all(|(x, y)| x == y);
    assert!(!same, "different seeds must diverge");
}

#[test]
fn hostile_inputs_stay_finite() {
    let _g = lock();
    pp_blob_init(7, 528);
    clear_input();
    let i = inp();
    i[0] = 1.0e6; i[1] = -1.0e6; i[2] = 1.0e6; i[3] = 1.0e6; i[4] = 1.0e6;
    i[8] = 0.0; i[9] = 0.0; i[10] = 0.0; i[11] = 1.0e3; i[15] = 1.0;
    i[16] = 0.0; i[17] = 0.0; i[18] = 0.0; i[19] = 1.0e3; i[23] = 1.0;
    i[536] = 0.0;
    for s in 0..600 { pp_blob_step(1.0 / 60.0, s as f32 / 60.0); }
    let o = out();
    for k in 0..528 * 4 {
        assert!(o[k].is_finite(), "position[{k}] not finite");
    }
    for k in 0..528 {
        let r = o[4 * k + 3];
        assert!(r.is_finite() && r > 0.0 && r < 1.0, "radius[{k}] = {r}");
    }
}

#[test]
fn zero_dt_does_not_poison() {
    let _g = lock();
    pp_blob_init(11, 536);
    clear_input();
    for _ in 0..10 { pp_blob_step(0.0, 0.0); }
    for s in 0..60 { pp_blob_step(1.0 / 60.0, s as f32 / 60.0); }
    let o = out();
    for k in 0..536 * 4 { assert!(o[k].is_finite(), "zero dt poisoned position[{k}]"); }
}

#[test]
fn idle_body_stays_bounded() {
    let _g = lock();
    pp_blob_init(12345, 544);
    clear_input();
    for s in 0..900 { pp_blob_step(1.0 / 60.0, s as f32 / 60.0); }
    let o = out();
    let m = 16 * MAX;
    for k in 0..3 {
        let ext = o[m + 7 + k];
        assert!(ext.is_finite() && ext < 12.0, "bbox axis {k} = {ext} — body exploded");
    }
    assert!(o[m] as usize == 544, "meta count {} != n", o[m]);
}

#[test]
fn pursuit_closes_distance() {
    let _g = lock();
    pp_blob_init(12345, 552);
    clear_input();
    let i = inp();
    i[8] = 3.57; i[9] = 0.0; i[10] = 0.0; i[11] = 0.05; i[15] = 1.0;
    let mut d0 = 0.0;
    for s in 0..900 {
        pp_blob_step(1.0 / 60.0, s as f32 / 60.0);
        if s == 60 { d0 = out()[16 * MAX + 15]; }
    }
    let d1 = out()[16 * MAX + 15];
    assert!(d0 > 1.0, "starts far: {d0}");
    assert!(d1 < d0 * 0.6, "closes: {d0} -> {d1}");
}

#[test]
fn aggro_does_not_flicker_between_radii() {
    let _g = lock();
    pp_blob_init(12345, 560);
    clear_input();
    let i = inp();
    // enter the aggro zone
    i[8] = 4.0; i[9] = 0.0; i[10] = 0.0; i[11] = 0.05; i[15] = 1.0;
    for s in 0..240 { pp_blob_step(1.0 / 60.0, s as f32 / 60.0); }
    // move to the band between R_aggro (5.0) and R_release (7.86)
    i[8] = 6.0;
    let mut flips = 0;
    let mut prev = out()[16 * MAX + 14];
    for s in 0..120 {
        pp_blob_step(1.0 / 60.0, 4.0 + s as f32 / 60.0);
        let st = out()[16 * MAX + 14];
        if st != prev { flips += 1; prev = st; }
    }
    assert!(flips <= 1, "state flickered {flips} times in the hysteresis band");
}

#[test]
fn palette_is_exactly_four_levels() {
    let _g = lock();
    pp_blob_init(12345, 568);
    clear_input();
    let i = inp();
    i[8] = 2.0; i[9] = 0.0; i[10] = 0.0; i[11] = 0.05; i[15] = 1.0;
    for s in 0..600 { pp_blob_step(1.0 / 60.0, s as f32 / 60.0); }
    let o = out();
    let canon = [
        [0.006f32, 0.004, 0.004],
        [0.100, 0.004, 0.004],
        [0.350, 0.008, 0.008],
        [0.750, 0.012, 0.012],
    ];
    for k in 0..568 {
        let c = [o[4 * MAX + 4 * k], o[4 * MAX + 4 * k + 1], o[4 * MAX + 4 * k + 2]];
        let ok = canon.iter().any(|p| (p[0] - c[0]).abs() < 1e-6 && (p[1] - c[1]).abs() < 1e-6 && (p[2] - c[2]).abs() < 1e-6);
        assert!(ok, "cell {k} colour {c:?} is not one of the four canonical levels");
    }
}

#[test]
fn contract_offsets_and_meta() {
    let _g = lock();
    pp_blob_init(12345, 576);
    clear_input();
    for s in 0..120 { pp_blob_step(1.0 / 60.0, s as f32 / 60.0); }
    let o = out();
    let m = 16 * MAX;
    assert_eq!(o[m] as usize, 576, "meta[0] must be the cell count");
    assert!(o[m + 1] >= 0.0 && o[m + 1] <= 5.0, "meta[1] form out of range");
    assert!(o[m + 3] >= 0.0 && o[m + 3] <= 1.0, "meta[3] wildness out of range");
    assert!(o[m + 14] >= 0.0 && o[m + 14] <= 3.0, "meta[14] state out of range");
    // st2 block: strain 0..1, health 0..1, clump id 0..1
    for k in 0..576 {
        let st = o[12 * MAX + 4 * k];
        let hm = o[12 * MAX + 4 * k + 1];
        let cid = o[12 * MAX + 4 * k + 2];
        assert!((0.0..=1.0).contains(&st), "strain[{k}] = {st}");
        assert!((0.0..=1.0).contains(&hm), "health[{k}] = {hm}");
        assert!((0.0..=1.0).contains(&cid), "clump id[{k}] = {cid}");
    }
}

#[test]
fn drone_inside_produces_reaction() {
    let _g = lock();
    pp_blob_init(12345, 584);
    clear_input();
    let i = inp();
    i[8] = 0.0; i[9] = 0.0; i[10] = 0.0; i[11] = 0.05; i[15] = 1.0;
    let mut peak = 0.0f32;
    for s in 0..600 {
        pp_blob_step(1.0 / 60.0, s as f32 / 60.0);
        let o = out();
        let m = 16 * MAX;
        let f = (o[m + 11] * o[m + 11] + o[m + 12] * o[m + 12] + o[m + 13] * o[m + 13]).sqrt();
        if f > peak { peak = f; }
    }
    assert!(peak > 0.0, "the drone inside the body must feel a reaction");
    assert!(peak.is_finite(), "reaction is not finite");
}

#[test]
fn faster_is_brighter() {
    let _g = lock();
    pp_blob_init(12345, 600);
    clear_input();
    let i = inp();
    i[8] = 3.57; i[9] = 0.0; i[10] = 0.0; i[11] = 0.05; i[15] = 1.0;
    for s in 0..600 { pp_blob_step(1.0 / 60.0, s as f32 / 60.0); }
    let o = out();
    let p0: Vec<[f32; 3]> = (0..600).map(|k| [o[4 * k], o[4 * k + 1], o[4 * k + 2]]).collect();
    pp_blob_step(1.0 / 60.0, 10.0);
    let o = out();
    let mut cnt = [0u32; 5];
    let mut lvl = [0u32; 5];
    for k in 0..600 {
        let dx = o[4 * k] - p0[k][0];
        let dy = o[4 * k + 1] - p0[k][1];
        let dz = o[4 * k + 2] - p0[k][2];
        let sp = (dx * dx + dy * dy + dz * dz).sqrt() * 60.0;
        let r = o[4 * MAX + 4 * k];
        let l = if r < 0.1 { 0 } else if r < 0.2 { 1 } else if r < 0.5 { 2 } else { 3 };
        let b = if sp < 0.3 { 0 } else if sp < 0.6 { 1 } else if sp < 1.0 { 2 } else if sp < 1.5 { 3 } else { 4 };
        cnt[b] += 1;
        lvl[b] += l;
    }
    let mut prev = -1.0f32;
    for b in 0..5 {
        if cnt[b] < 10 { continue; }
        let m = lvl[b] as f32 / cnt[b] as f32;
        assert!(m >= prev - 0.05, "brightness not monotonic at speed bin {b}: {m} < {prev}");
        prev = m;
    }
    // and the slowest bin must be coal
    let slow = lvl[0] as f32 / cnt[0].max(1) as f32;
    assert!(slow < 0.5, "slow cells must be coal, got {slow}");
}

#[test]
fn set_target_switches_slot() {
    let _g = lock();
    pp_blob_init(12345, 592);
    clear_input();
    let i = inp();
    // only the operator is active, far away; the drone is inactive
    i[16] = 3.0; i[17] = 0.0; i[18] = 0.0; i[19] = 0.05; i[23] = 1.0;
    pp_blob_set_target(1);
    for s in 0..300 { pp_blob_step(1.0 / 60.0, s as f32 / 60.0); }
    let d = out()[16 * MAX + 15];
    assert!(d < 3.0, "with slot 1 the body must chase the operator, d = {d}");
    pp_blob_set_target(0);
}
