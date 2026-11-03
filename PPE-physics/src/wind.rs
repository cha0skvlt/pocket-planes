//! Wind. Line-by-line port of `src/sim/wind.js`.
//! One field for the drone, rain, clouds and sea: mean wind breathes, log profile over height,
//! gusts advected by the wind itself, buildings — stagnation/upwash/wake/side speed-up.

use crate::rng::hash2;
use crate::MAX_OBST;

pub const TAU: f64 = core::f64::consts::TAU;
pub const TH0: f64 = 0.6435011087932844; // Math.atan2(.6,.8)
pub const U0: f64 = 12.0;
pub const Z0: f64 = 0.02;
const LN10: f64 = 6.214608098422191; // Math.log(10/Z0) = Math.log(500)

#[derive(Clone, Copy)]
pub struct Obstacle {
    pub x: f64,
    pub z: f64,
    pub hw: f64,
    pub hd: f64,
    pub top: f64,
}

pub struct Wind {
    pub u10: f64,
    pub dir: f64,
    pub g: f64,
    pub t: f64,
    pub adv: (f64, f64),
    pub obst: Vec<Obstacle>,
    acc: Acc,
}

#[derive(Clone, Copy, Default)]
struct Acc {
    k: f64,
    n: f64,
    dy: f64,
    t: f64,
}

/// JS `vn(x,z)`: value noise from hash2, smoothstep bilinear.
#[inline]
pub fn vn(x: f64, z: f64) -> f64 {
    let ix = x.floor() as i32;
    let iz = z.floor() as i32;
    let fx = x - ix as f64;
    let fz = z - iz as f64;
    let sx = fx * fx * (3.0 - 2.0 * fx);
    let sz = fz * fz * (3.0 - 2.0 * fz);
    let a = hash2(ix, iz);
    let b = hash2(ix + 1, iz);
    let c = hash2(ix, iz + 1);
    let d = hash2(ix + 1, iz + 1);
    (a + (b - a) * sx) * (1.0 - sz) + (c + (d - c) * sx) * sz
}

/// smoothstep clamp from wind.js: `sm(a,b,x)`.
#[inline]
fn sm(a: f64, b: f64, x: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Wake model: the trail behind a tower. Port of JS `wake()` with a shared acc accumulator.
fn wake(acc: &mut Acc, b: &Obstacle, x: f64, y: f64, z: f64, cx: f64, cz: f64) {
    let dx = x - b.x;
    let dz = z - b.z;
    let s = dx * cx + dz * cz;
    let c = dz * cx - dx * cz;
    let ac = cx.abs();
    let as_ = cz.abs();
    let ay = c.abs();
    // half-width across the wind / half-length along the wind
    let wp = b.hw * as_ + b.hd * ac;
    let lp = b.hw * ac + b.hd * as_;
    if s > lp + 14.0 * wp || s < -lp - 5.0 * wp || ay > wp * 3.5 {
        return;
    }
    // above the roof the wake disappears
    let fh = 1.0 - sm(b.top, b.top + 0.6 * wp, y);
    if fh <= 0.0 {
        return;
    }
    if s > lp {
        let d = 0.75 * (-(s - lp) / (3.5 * wp)).exp() * (-(c / (0.85 * wp)).powi(2)).exp() * fh;
        acc.k -= d;
        acc.t += 0.25 * d;
        acc.dy -= 0.12 * d;
    } else if s < -lp {
        let st = (-(-s - lp) / (1.3 * wp)).exp() * (-(c / (1.1 * wp)).powi(2)).exp() * fh;
        acc.k -= 0.4 * st;
        acc.dy += 0.5 * st;
    }
    if ay > wp * 0.9 && s > -lp * 1.2 && s < lp * 3.0 + 3.0 * wp {
        let f = (-(ay - wp) / (0.8 * wp)).exp() * fh;
        acc.k += 0.18 * f;
        acc.n += c.signum() * 0.4 * f;
    }
}

/// Wind vector (m/s) at a point; g in [0,1] - gustiness.
pub struct WindOut {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub g: f64,
}

impl Default for Wind {
    fn default() -> Self {
        Self::new()
    }
}

impl Wind {
    pub fn new() -> Self {
        Wind {
            u10: U0,
            dir: TH0,
            g: 0.5,
            t: 0.0,
            adv: (0.0, 0.0),
            // ⚠ Reserve MAX_OBST before views are created: an allocation must NOT grow WASM linear memory after pp_init -
            // otherwise the Float32Array views created in pp_init detach from the buffer and everything dies.
            obst: Vec::with_capacity(MAX_OBST),
            acc: Acc::default(),
        }
    }

    pub fn set_obstacles(&mut self, list: Vec<Obstacle>) {
        self.obst = list;
    }

    /// Fill obstacles from a flat slice - no allocations (buffer reserved in new).
    /// ⚠ No collect(): an allocation after pp_init grows WASM linear memory and kills the JS views.
    pub fn set_obstacles_flat(&mut self, flat: &[[f32; 5]], count: usize) {
        let count = count.min(MAX_OBST).min(flat.len());
        self.obst.clear();
        for o in flat.iter().take(count) {
            self.obst.push(Obstacle {
                x: o[0] as f64,
                z: o[1] as f64,
                hw: o[2] as f64,
                hd: o[3] as f64,
                top: o[4] as f64,
            });
        }
    }

    pub fn update(&mut self, dt: f64, t: f64) {
        self.t = t;
        self.u10 = U0 * (1.0 + 0.22 * (TAU * t / 410.0).sin() + 0.1 * (TAU * t / 97.0).sin());
        self.dir = TH0 + 0.3 * (TAU * t / 530.0).sin() + 0.12 * (TAU * t / 151.0).sin();
        // gusts advected by the wind itself
        self.adv.0 += self.dir.cos() * self.u10 * 0.85 * dt;
        self.adv.1 += self.dir.sin() * self.u10 * 0.85 * dt;
    }

    /// Wind vector at a point. Port of JS `at()` with the acc accumulator.
    pub fn at(&mut self, x: f64, y: f64, z: f64) -> WindOut {
        let t = self.t;
        let ax = x - self.adv.0;
        let az = z - self.adv.1;
        let g1 = vn(ax / 240.0, az / 240.0);
        let g2 = vn(ax / 90.0 + 17.3, az / 90.0 - 4.1);
        let g = 0.65 * g1 + 0.35 * g2;
        let u = self.u10 * (1.0 + 0.7 * (g - 0.5)) * (y.max(0.5) / Z0).ln() / LN10;
        let th = self.dir + 0.5 * (g1 - 0.5);
        let cx = th.cos();
        let cz = th.sin();
        self.acc = Acc::default();
        let mut acc = self.acc;
        for b in &self.obst {
            if (b.x - x).abs() > 260.0 || (b.z - z).abs() > 260.0 {
                continue;
            }
            wake(&mut acc, b, x, y, z, cx, cz);
        }
        self.acc = acc;
        self.g = (g + acc.t * 1.2).min(1.0);
        let f = (1.0 + acc.k).max(0.15);
        let sg = u * (0.05 + 0.06 * (g - 0.4).max(0.0) + acc.t);
        WindOut {
            x: u * cx * f - cz * acc.n * u
                + sg * ((2.3 * t + 0.11 * x + 0.05 * z).sin()
                    + 0.7 * (5.1 * t + 0.23 * z + 1.0).sin()),
            z: u * cz * f
                + cx * acc.n * u
                + sg * ((2.9 * t + 0.09 * z + 0.04 * x + 2.0).sin()
                    + 0.7 * (4.3 * t + 0.19 * x).sin()),
            y: acc.dy * u
                + sg * 0.6 * ((3.7 * t + 0.17 * (x + z)).sin() + 0.5 * (7.3 * t + 0.3 * x).sin()),
            g: self.g,
        }
    }
}
