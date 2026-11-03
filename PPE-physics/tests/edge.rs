//! L1 edge-case tests: the simulation must survive hostile inputs without
//! NaN, panic, or invariant violation. These run against the same modules the
//! WASM build uses — if these pass, the core cannot be crashed by the game.

use pocket_physics::sea::{Sea, TH0, U_REF};
use pocket_physics::wind::Wind;
use pocket_physics::MAX_OBST;

fn ok_sea() -> Sea {
    let mut s = Sea::new();
    s.update(0.0, U_REF, TH0);
    s
}

#[test]
fn max_obstacles_boundary() {
    // MAX_OBST buildings exactly, and one over — the wind model must take the
    // first MAX_OBST and ignore the rest without panic.
    let mut w = Wind::new();
    let mut flat = vec![[0.0f32; 5]; MAX_OBST + 1];
    for (i, o) in flat.iter_mut().enumerate() {
        *o = [i as f32, 0.0, 10.0, 10.0, 50.0];
    }
    w.set_obstacles_flat(&flat, MAX_OBST + 1);
    assert_eq!(w.obst.len(), MAX_OBST, "obstacle count clamped to MAX_OBST");
    // wind still answers
    w.update(0.016, 1.0);
    let v = w.at(0.0, 40.0, 0.0);
    assert!(v.x.is_finite() && v.z.is_finite());
}

#[test]
fn sea_update_with_zero_wind_is_stable() {
    let mut sea = Sea::new();
    for i in 0..3600 {
        sea.update(0.016, 0.0, 0.0);
        assert!(
            sea.us.is_finite() && sea.th.is_finite(),
            "sea diverged at frame {i}"
        );
        assert!(sea.us >= 0.0, "wind speed went negative: {}", sea.us);
    }
}

#[test]
fn hgt_is_finite_everywhere_sampled() {
    let sea = ok_sea();
    let mut r = pocket_physics::rng::Rng::new(42);
    for _ in 0..5000 {
        let x = (r.next() - 0.5) * 4000.0;
        let z = (r.next() - 0.5) * 4000.0;
        let t = r.next() * 3600.0;
        let h = sea.hgt(x, z, t);
        assert!(h.is_finite(), "hgt({x},{z},{t}) = {h}");
        assert!(
            h.abs() < 30.0,
            "hgt({x},{z},{t}) = {h} — wave amplitude exploded"
        );
    }
}
