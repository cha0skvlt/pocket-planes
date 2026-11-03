//! Sea. Line-by-line port of `src/sim/sea.js`.
//! f64 inside (like JS numbers), f32 in the w1/w2/w3/ratio arrays (Float32Array on the JS side).
//! Any formula change goes here and into shaders/ocean.js at the same time (golden: tests/sim.rs).

use crate::rng::Rng;

pub const G: f64 = 9.81;
pub const N: usize = 7;
pub const NMOD: usize = 5;
pub const U_REF: f64 = 12.0;
pub const MOD_SIZE: usize = 256;
pub const WARP: f64 = 1.5;
pub const TH0: f64 = 0.6435011087932844; // Math.atan2(.6,.8)

const K: [f64; N] = [0.045, 0.08, 0.14, 0.27, 0.5, 1.2, 2.3];
const A0: [f64; N] = [5.0, 3.2, 2.0, 1.0, 0.5, 0.12, 0.06];
const D0: [[f64; 2]; N] = [
    [0.8, 0.6],
    [-0.5, 0.85],
    [0.95, -0.3],
    [0.2, -0.98],
    [-0.9, -0.45],
    [0.6, 0.8],
    [-0.7, 0.7],
];

pub struct Sea {
    /// shader uniform arrays: w1=(dx,dz,k,A) w2=(ω,φ,sAlong,sAcross) w3=(cg,offU,offV,warp).
    pub w1: [f32; N * 4],
    pub w2: [f32; N * 4],
    pub w3: [f32; N * 4],
    pub us: f64,
    pub th: f64,
    pub drift: (f64, f64),
    pub ratio: [f32; N],
    om: [f64; N],
    cg: [f64; N],
    ph: [f64; N],
    ou: [f64; N],
    ov: [f64; N],
    sal: [f64; N],
    sac: [f64; N],
    off: [f64; N],
    /// RGBA modulation tile: R - group envelope, G - phase shift (crest bending).
    pub mod_field: Vec<u8>,
}

impl Default for Sea {
    fn default() -> Self {
        Self::new()
    }
}

impl Sea {
    pub fn new() -> Self {
        let mut off = [0.0; N];
        for i in 0..N {
            off[i] = D0[i][1].atan2(D0[i][0]) - TH0;
        }
        let om: [f64; N] = core::array::from_fn(|i| (G * K[i]).sqrt());
        let cg: [f64; N] = core::array::from_fn(|i| om[i] / (2.0 * K[i]));
        let mut r = Rng::new(20261102);
        let ph: [f64; N] = core::array::from_fn(|_| r.next() * core::f64::consts::TAU);
        let ou: [f64; N] = core::array::from_fn(|_| r.next());
        let ov: [f64; N] = core::array::from_fn(|_| r.next());
        // group length ~6λ, crest length ~4λ
        let sal: [f64; N] =
            core::array::from_fn(|i| 1.0 / (8.0 * 6.0 * (core::f64::consts::TAU / K[i])));
        let sac: [f64; N] =
            core::array::from_fn(|i| 1.0 / (8.0 * 4.0 * (core::f64::consts::TAU / K[i])));

        let mut sea = Sea {
            w1: [0.0; N * 4],
            w2: [0.0; N * 4],
            w3: [0.0; N * 4],
            us: U_REF,
            th: TH0,
            drift: (0.0, 0.0),
            ratio: [1.0; N],
            om,
            cg,
            ph,
            ou,
            ov,
            sal,
            sac,
            off,
            mod_field: make_mod(),
        };
        sea.update(0.0, U_REF, TH0);
        sea
    }

    /// One sea step. `u10`/`dir` - the wind (as in sea.js: `updateSea(dt, wind)`).
    pub fn update(&mut self, dt: f64, u10: f64, dir: f64) {
        // the sea spins up over minutes
        self.us += (u10 - self.us) * (1.0 - (-dt / 150.0).exp());
        let mut d = dir - self.th;
        d = d.sin().atan2(d.cos());
        self.th += d * (1.0 - (-dt / 70.0).exp());
        // drift current ~ 3% of wind — a VELOCITY, not an accumulated position
        self.drift.0 = dir.cos() * 0.03 * self.us;
        self.drift.1 = dir.sin() * 0.03 * self.us;
        let wp4 = (0.877 * G / self.us).powi(4);
        let wr4 = (0.877 * G / U_REF).powi(4);
        for i in 0..N {
            // sqrt(S_PM(w;U)/S_PM(w;Uref)): long waves grow with wind, short ones saturate
            let mut r = if i < NMOD {
                (-0.625 * (wp4 - wr4) / self.om[i].powi(4)).exp()
            } else {
                (self.us / U_REF).sqrt()
            };
            r = if i < NMOD {
                r.clamp(0.45, 2.2)
            } else {
                r.clamp(0.6, 1.5)
            };
            self.ratio[i] = r as f32;
            let a = self.th + self.off[i];
            let o = i * 4;
            self.w1[o] = a.cos() as f32;
            self.w1[o + 1] = a.sin() as f32;
            self.w1[o + 2] = K[i] as f32;
            self.w1[o + 3] = (A0[i] * r) as f32;
            self.w2[o] = self.om[i] as f32;
            self.w2[o + 1] = self.ph[i] as f32;
            self.w2[o + 2] = self.sal[i] as f32;
            self.w2[o + 3] = self.sac[i] as f32;
            self.w3[o] = self.cg[i] as f32;
            self.w3[o + 1] = self.ou[i] as f32;
            self.w3[o + 2] = self.ov[i] as f32;
            self.w3[o + 3] = (if i < NMOD { WARP } else { 0.0 }) as f32;
        }
    }

    /// Water height at (x,z) at time t. Mirror of the GLSL H() from shaders/ocean.js.
    pub fn hgt(&self, x: f64, z: f64, t: f64) -> f64 {
        let mut h = 0.0;
        for i in 0..NMOD {
            let o = i * 4;
            let dx = self.w1[o] as f64;
            let dz = self.w1[o + 1] as f64;
            let kd = x * dx + z * dz;
            let (mu, mv) = self.sample_mod(
                (kd - self.w3[o] as f64 * t) * self.w2[o + 2] as f64 + self.w3[o + 1] as f64,
                (z * dx - x * dz) * self.w2[o + 3] as f64 + self.w3[o + 2] as f64,
            );
            let s = 0.5
                + 0.5
                    * (self.w1[o + 2] as f64 * kd
                        + self.w2[o + 1] as f64
                        + (mv - 0.5) * 2.0 * self.w3[o + 3] as f64
                        - self.w2[o] as f64 * t)
                        .sin();
            let sc = s * s * s - 0.3125;
            h += self.w1[o + 3] as f64 * (0.45 + 1.1 * mu) * sc;
        }
        h
    }

    /// Bilinear sample from the tiled RGBA modulation field: (R, G) in [0,1].
    pub fn sample_mod_pub(&self, u: f64, v: f64) -> (f64, f64) {
        self.sample_mod(u, v)
    }

    /// Bilinear sample from the tiled RGBA modulation field: (R, G) in [0,1].
    pub(crate) fn sample_mod(&self, u: f64, v: f64) -> (f64, f64) {
        let m = MOD_SIZE;
        let mf = m as f64;
        let fx = (u - u.floor()) * mf - 0.5;
        let fy = (v - v.floor()) * mf - 0.5;
        let x0 = fx.floor() as i64;
        let y0 = fy.floor() as i64;
        let tx = fx - x0 as f64;
        let ty = fy - y0 as f64;
        let xa = ((x0 + m as i64) % m as i64) as usize;
        let xb = ((x0 + 1 + m as i64) % m as i64) as usize;
        let ya = ((y0 + m as i64) % m as i64) as usize;
        let yb = ((y0 + 1 + m as i64) % m as i64) as usize;
        let mut out = [0.0f64; 2];
        for (c, cell) in out.iter_mut().enumerate() {
            let a = self.mod_field[(ya * m + xa) * 4 + c] as f64;
            let b = self.mod_field[(ya * m + xb) * 4 + c] as f64;
            let cc = self.mod_field[(yb * m + xa) * 4 + c] as f64;
            let d = self.mod_field[(yb * m + xb) * 4 + c] as f64;
            *cell = ((a + (b - a) * tx) * (1.0 - ty) + (cc + (d - cc) * tx) * ty) / 255.0;
        }
        (out[0], out[1])
    }
}

/// Tiled noise field (smoothstep bilinear over a cells×cells grid, values from r).
fn tile_noise(m: usize, cells: usize, r: &mut Rng) -> Vec<f32> {
    let g: Vec<f32> = (0..cells * cells).map(|_| r.next() as f32).collect();
    let mut out = vec![0.0f32; m * m];
    for y in 0..m {
        let fy = y as f64 / m as f64 * cells as f64;
        let y0 = fy.floor() as usize;
        let ty = fy - y0 as f64;
        let sy = ty * ty * (3.0 - 2.0 * ty);
        for x in 0..m {
            let fx = x as f64 / m as f64 * cells as f64;
            let x0 = fx.floor() as usize;
            let tx = fx - x0 as f64;
            let sx = tx * tx * (3.0 - 2.0 * tx);
            let x1 = (x0 + 1) % cells;
            let y1 = (y0 + 1) % cells;
            let a = g[y0 * cells + x0] as f64;
            let b = g[y0 * cells + x1] as f64;
            let c = g[y1 * cells + x0] as f64;
            let d = g[y1 * cells + x1] as f64;
            out[y * m + x] = ((a + (b - a) * sx) * (1.0 - sy) + (c + (d - c) * sx) * sy) as f32;
        }
    }
    out
}

/// 4 octaves of tiled noise, normalized to mean .5, ±2σ → [0,1].
fn field(m: usize, r: &mut Rng) -> Vec<f32> {
    let mut f = vec![0.0f32; m * m];
    let mut a = 1.0f64;
    for o in 0..4 {
        let n = tile_noise(m, 8 << o, r);
        for i in 0..f.len() {
            f[i] += (n[i] as f64 * a) as f32;
        }
        a *= 0.5;
    }
    let mut mean = 0.0f64;
    for v in &f {
        mean += *v as f64;
    }
    mean /= f.len() as f64;
    let mut var = 0.0f64;
    for v in &f {
        var += (*v as f64 - mean) * (*v as f64 - mean);
    }
    let sd = (var / f.len() as f64).sqrt();
    let sd = if sd == 0.0 { 1.0 } else { sd };
    f.iter()
        .map(|v| {
            let x = 0.5 + (*v as f64 - mean) / sd * 0.2;
            x.clamp(0.0, 1.0) as f32
        })
        .collect()
}

/// RGBA modulation texture: R — envelope, G — phase shift, B=128, A=255.
fn make_mod() -> Vec<u8> {
    let mut r = Rng::new(777);
    let e = field(MOD_SIZE, &mut r);
    let w = field(MOD_SIZE, &mut r);
    let mut d = vec![0u8; MOD_SIZE * MOD_SIZE * 4];
    for i in 0..e.len() {
        d[i * 4] = (e[i] * 255.0).round() as u8;
        d[i * 4 + 1] = (w[i] * 255.0).round() as u8;
        d[i * 4 + 2] = 128;
        d[i * 4 + 3] = 255;
    }
    d
}
