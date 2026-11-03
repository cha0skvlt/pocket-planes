//! Golden tests: the same 14 checks as tests/sim.test.mjs (the JS reference).
//! Plus a comparison of the w1/w2/w3 arrays and hgt() against a Node dump (tests/golden.json).
//! Run: cargo test

use pocket_physics::sea::{Sea, TH0};
use pocket_physics::wind::{vn, Wind};

fn cs(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

#[test]
fn t1_waves_run_downwind() {
    // 1. waves run downwind (cross-correlation along the wind)
    let (dx, dz) = (TH0.cos(), TH0.sin());
    let sea = Sea::new();
    let line = |t: f64| {
        (0..400)
            .map(|i| sea.hgt(dx * i as f64 * 2.0, dz * i as f64 * 2.0, t))
            .collect::<Vec<_>>()
    };
    let a = line(10.0);
    let b = line(10.5);
    let (mut best, mut arg) = (-9.0f64, 0);
    for s in -12..=12 {
        let sh: Vec<f64> = (0..400)
            .map(|i| b[(i as i64 + s).clamp(0, 399) as usize])
            .collect();
        let c = cs(&a, &sh);
        if c > best {
            best = c;
            arg = s;
        }
    }
    assert!(arg > 0, "crests shift downwind ({} m per 0.5 s)", arg * 2);
}

#[test]
fn t2_rms_height() {
    // 2. sea statistics (rms over 20000 points)
    let sea = Sea::new();
    let mut s = 0.0;
    let n = 20000;
    // Math.random in JS is a different stream; rms only needs coordinate spread, not exact points.
    let mut r = pocket_physics::rng::Rng::new(12345);
    for _ in 0..n {
        let x = (r.next() - 0.5) * 800.0;
        let z = (r.next() - 0.5) * 800.0;
        let t = r.next() * 100.0;
        let h = sea.hgt(x, z, t);
        s += h * h;
    }
    let rms = (s / n as f64).sqrt();
    assert!(
        rms > 0.9 && rms < 4.5,
        "rms height {rms:.2} m within sane bounds"
    );
}

#[test]
fn t3_mod_field_mean_and_tiling() {
    // 3. modulation field: normalized and tiling
    let sea = Sea::new();
    let mut m = 0.0;
    let len = sea.mod_field.len() / 4;
    for i in 0..len {
        m += sea.mod_field[i * 4] as f64;
    }
    m /= (len as f64) * 255.0;
    assert!((m - 0.5).abs() < 0.03, "group envelope: mean {m:.3} ~ 0.5");
    let a = sea.sample_mod_pub(0.3, 0.7);
    let b = sea.sample_mod_pub(1.3, -0.3);
    assert!(
        (a.0 - b.0).abs() < 1e-9 && (a.1 - b.1).abs() < 1e-9,
        "modulation tiles seamlessly"
    );
}

#[test]
fn t4_sea_response_to_wind() {
    // 4. sea response to wind: long waves grow, swell never vanishes, direction follows
    let mut sea = Sea::new();
    let base = sea.ratio[0] as f64;
    for _ in 0..900 {
        sea.update(1.0, 16.0, TH0 + 0.5);
    }
    assert!(
        sea.ratio[0] as f64 > base * 1.3,
        "at 16 m/s wind the long wave grows (x{:.2})",
        sea.ratio[0]
    );
    assert!(
        (sea.th - (TH0 + 0.5)).abs() < 0.05,
        "sea direction caught up with the wind ({:.2} rad)",
        sea.th - TH0
    );
    for _ in 0..30 {
        sea.update(1.0, 6.0, TH0);
    }
    assert!(
        sea.ratio[0] as f64 >= 0.45,
        "after a sudden calm the swell does not vanish (clamped >= 0.45)"
    );
}

#[test]
fn t5_wind_mean_and_profile() {
    // 5. wind: mean at 10 m, profile, gustiness
    let mut w = Wind::new();
    let mut s = 0.0;
    let mut n = 0;
    let mut t = 0.0;
    while t < 20000.0 {
        w.update(5.0, t);
        s += w.u10;
        n += 1;
        t += 5.0;
    }
    assert!(
        (s / n as f64 - 12.0).abs() < 1.0,
        "mean wind {:.1} m/s",
        s / n as f64
    );
    w.update(0.0, 0.0);
    let mut sp = |y: f64| {
        let v = w.at(300.0, y, 300.0);
        (v.x * v.x + v.z * v.z).sqrt()
    };
    let sp2 = sp(10.0);
    let sp3 = sp(100.0);
    let sp1 = sp(2.0);
    assert!(
        sp1 < sp2 && sp2 < sp3,
        "profile grows with height: {:.1} < {:.1} < {:.1}",
        sp1,
        sp2,
        sp3
    );
}

#[test]
fn t6_wake_stagnation_upwash_speedup() {
    // 6. building: wake behind the tower, stagnation/upwash in front, side flow
    let mut w = Wind::new();
    let mut o = [0.0f64; 4];
    let (cx0, cz0) = (TH0.cos(), TH0.sin());
    let b = pocket_physics::wind::Obstacle {
        x: 0.0,
        z: 0.0,
        hw: 15.0,
        hd: 12.0,
        top: 100.0,
    };
    let wp = b.hw * cz0.abs() + b.hd * cx0.abs();
    let lp = b.hw * cx0.abs() + b.hd * cz0.abs();
    let p = |s: f64, c: f64, y: f64| [s * cx0 - c * cz0, s * cz0 + c * cx0, y];
    let mut avg =
        |pos: [f64; 3], list: &[pocket_physics::wind::Obstacle], f: &dyn Fn(&[f64]) -> f64| {
            w.set_obstacles(list.to_vec());
            let mut a = 0.0f64;
            for t in 0..60 {
                w.update(0.0, t as f64);
                let v = w.at(pos[0], pos[2], pos[1]);
                o[0] = v.x;
                o[1] = v.y;
                o[2] = v.z;
                a += f(&o);
            }
            a / 60.0
        };
    let spd = |o: &[f64]| (o[0] * o[0] + o[2] * o[2]).sqrt();
    let up = |o: &[f64]| o[1];
    let pos = p(lp + 0.5 * wp, 0.0, 40.0);
    let wk = avg(pos, &[b], &spd);
    let fr = avg(pos, &[], &spd);
    assert!(
        wk < fr * 0.6,
        "behind the tower the wind is weaker: {wk:.1} vs {fr:.1} m/s"
    );
    let pos = p(-(lp + 0.3 * wp), 0.0, 40.0);
    let u = avg(pos, &[b], &up);
    assert!(
        u > 2.0,
        "in front of the wall the flow goes up ({u:.1} m/s)"
    );
    let pos = p(0.0, 1.2 * wp, 40.0);
    let fl = avg(pos, &[b], &spd);
    let ff = avg(pos, &[], &spd);
    assert!(
        fl > ff * 1.03,
        "beside the tower the flow speeds up ({fl:.1} vs {ff:.1})"
    );
    let pos = p(lp + 0.5 * wp, 0.0, 160.0);
    let ab = avg(pos, &[b], &spd);
    let af = avg(pos, &[], &spd);
    assert!(ab > af * 0.9, "above the roof the wake disappears");
}

#[test]
fn t7_vn_range() {
    // 7. gust noise: range and mean
    let mut mn = 1.0f64;
    let mut mx = 0.0f64;
    let mut m = 0.0f64;
    for i in 0..5000 {
        let v = vn(i as f64 * 0.37, i as f64 * 0.91);
        m += v;
        mn = if v < mn { v } else { mn };
        mx = if v > mx { v } else { mx };
    }
    assert!(
        mn >= 0.0 && mx <= 1.0 && (m / 5000.0 - 0.5).abs() < 0.05,
        "vn: values in [0,1], mean ~0.5 (m={m:.3})"
    );
}

#[test]
fn golden_state_matches_js_dump() {
    // w1/w2/w3/ratio after init - bit-for-bit against the Node dump (tests/golden.json).
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden.json");
    let data = std::fs::read(path).expect("golden.json missing - run node test/dump_golden.mjs");
    let v: serde_json::Value = serde_json::from_str(std::str::from_utf8(&data).unwrap()).unwrap();
    let sea = Sea::new();
    let tol = 1e-9;
    let cmp = |name: &str, rust: &[f32], js: &serde_json::Value| {
        let js: Vec<f32> = js
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_f64().unwrap() as f32)
            .collect();
        for (i, (r, j)) in rust.iter().zip(js.iter()).enumerate() {
            assert!((*r - *j).abs() < tol as f32, "{name}[{i}]: rust={r} js={j}");
        }
    };
    cmp("w1", &sea.w1, &v["w1"]);
    cmp("w2", &sea.w2, &v["w2"]);
    cmp("w3", &sea.w3, &v["w3"]);
    cmp("ratio", &sea.ratio, &v["ratio"]);
    // hgt at control points
    for (i, p) in v["hgt"].as_array().unwrap().iter().enumerate() {
        let x = p["x"].as_f64().unwrap();
        let z = p["z"].as_f64().unwrap();
        let t = p["t"].as_f64().unwrap();
        let hjs = p["h"].as_f64().unwrap();
        let h = sea.hgt(x, z, t);
        assert!(
            (h - hjs).abs() < 1e-6,
            "hgt[{i}]({x},{z},{t}): rust={h:.9} js={hjs:.9}"
        );
    }
}
