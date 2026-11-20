use super::util::*;
use std::mem::MaybeUninit;

pub const NM: usize = 8192;
pub const HB: usize = 1 << 16;
pub const MC: usize = 3000;
pub const KN: usize = 12; // skeleton nodes
pub const TC: usize = 6;  // chains
pub const MP: usize = 6;  // points per chain

// [K, T, rho_mult, C_mult, kb_mult, r_t]  blob crown whip net eye storm
pub const FORMS: [[f32; 6]; 6] = [
    [6.0, 0.0, 1.00, 1.00, 1.00, 0.07],
    [10.0, 4.0, 0.85, 0.80, 1.30, 0.07],
    [8.0, 2.0, 0.70, 0.55, 1.60, 0.06],
    [12.0, 6.0, 0.60, 0.45, 1.80, 0.05],
    [7.0, 1.0, 1.10, 1.30, 0.90, 0.08],
    [12.0, 6.0, 0.50, 0.35, 2.00, 0.05],
];

pub struct B {
    pub inited: u32,
    pub n: usize,
    pub t: f32,
    pub frame: u32,
    pub rng: Rng,
    pub p: [[f32; 3]; NM],
    pub v: [[f32; 3]; NM],
    pub r: [f32; NM],
    pub m: [f32; NM],
    pub rho: [f32; NM],
    pub chroma: [f32; NM],
    pub chroma2: [f32; NM],
    pub hue: [f32; NM],
    pub age: [f32; NM],
    pub flags: [u32; NM],
    pub detach: [f32; NM],
    pub node: [u8; NM],
    pub chain: [u8; NM],
    pub sp: [f32; NM],
    pub off: [[f32; 3]; NM],
    pub bond: [[u32; 4]; NM],
    pub rest: [[f32; 4]; NM],
    pub health: [[f32; 4]; NM],
    pub strain: [f32; NM],
    pub rho_s: [f32; NM],
    pub key: [u16; NM],
    pub order: [u32; NM],
    pub cstart: [u32; HB + 1],
    pub q: [[f32; 3]; KN],
    pub qv: [[f32; 3]; KN],
    pub qr: [f32; KN],
    pub agg: [[f32; 3]; KN],
    pub cp: [[[f32; 3]; MP]; TC],
    pub cpp: [[[f32; 3]; MP]; TC],
    pub cw: [f32; TC],
    pub center: [f32; 3],
    pub rho0: f32,
    pub wild_x: f32,
    pub wild_t: f32,
    pub wild: f32,
    pub phase: [f32; 8],
    pub form: u32,
    pub prev_form: u32,
    pub fb: f32,
    pub fbv: f32,
    pub fb_target: f32,
    pub next_burst: f32,
    pub next_form: f32,
    pub next_tear: f32,
    pub body_f: [[f32; 3]; 2],
    pub out: [f32; 16 * NM + 16],
    pub clump: [u16; NM],
    pub r0: [[f32; 3]; NM],
    pub ft: [f32; NM],
    pub srt: [(u32, u32); NM],
    pub ncl: usize,
    pub cc: [[f32; 3]; MC],
    pub cv: [[f32; 3]; MC],
    pub cca: [[f32; 3]; MC],
    pub cbd: [[f32; 3]; MC],
    pub cr: [f32; MC],
    pub ccnt: [f32; MC],
    pub cbk: [f32; MC],
    pub cbi: [f32; MC],
    pub tear_scale: f32,
    pub tear_rate: f32,
    pub inp: [f32; 544],
    pub pst: u32,
    pub ptimer: f32,
    pub lose_t: f32,
    pub brk: f32,
    pub pw: f32,
    pub pv: [f32; 3],
    pub home: [f32; 3],
    pub pdist: f32,
    pub oside: f32,
    pub caim: [f32; TC],
    pub vm: [f32; 3],
    pub aggro: f32,
    pub stolen: u32,
    pub enc: f32,
    pub grab: f32,
    pub sqz: f32,
    pub tslot: u32,
    pub lvl: [u8; NM],
    pub hitcd: [f32; NM],
    pub obc: [u8; 1024],
    pub obl: [[u8; 8]; 1024],
}

static mut S: MaybeUninit<B> = MaybeUninit::zeroed();
pub fn st() -> &'static mut B {
    unsafe { &mut *(*core::ptr::addr_of_mut!(S)).as_mut_ptr() }
}

pub fn init(seed: u32, n: u32) -> &'static mut B {
    let b = st();
    // re-init with a different n must not inherit clump accumulators from the last run
    for c in 0..MC { b.cc[c] = [0.0; 3]; b.cv[c] = [0.0; 3]; b.cca[c] = [0.0; 3]; b.cbd[c] = [0.0; 3]; b.cr[c] = 0.0; b.ccnt[c] = 0.0; b.cbk[c] = 0.0; b.cbi[c] = 0.0; }
    let n = (n as usize).clamp(64, NM);
    b.inited = 1;
    b.n = n;
    b.t = 0.0;
    b.frame = 0;
    b.rng = Rng::new(seed);
    let rb = 1.1 * (n as f32 / 3000.0).cbrt();
    for i in 0..n {
        loop {
            let x = b.rng.range(-1.0, 1.0);
            let y = b.rng.range(-1.0, 1.0);
            let z = b.rng.range(-1.0, 1.0);
            if x*x + y*y + z*z <= 1.0 {
                b.p[i] = [x * rb, y * rb, z * rb];
                break;
            }
        }
        b.v[i] = [0.0; 3];
        b.r[i] = b.rng.range(0.02, 0.05);
        b.m[i] = 900.0 * 4.0 / 3.0 * std::f32::consts::PI * b.r[i].powi(3);
        b.chroma[i] = 0.0;
        b.hue[i] = 0.0;
        b.age[i] = b.rng.range(0.0, 5.0);
        b.flags[i] = 0;
        b.detach[i] = 0.0;
        b.chain[i] = if i % 2 == 0 { ((i / 2) % TC) as u8 } else { 255 };
        b.sp[i] = b.rng.f();
        let d = norm([b.rng.range(-1.0, 1.0), b.rng.range(-1.0, 1.0), b.rng.range(-1.0, 1.0)]);
        b.off[i] = d;
    }
    // clumps: Morton-sorted chunks of 3..8 cells (log-normal sizes)
    for i in 0..n {
        let q = |v: f32| (((v + 3.0) / 6.0).clamp(0.0, 0.999) * 1024.0) as u32;
        let (x, y, z) = (q(b.p[i][0]), q(b.p[i][1]), q(b.p[i][2]));
        let mut k = 0u32;
        for bit in 0..10 { k |= ((x >> bit) & 1) << (3*bit); k |= ((y >> bit) & 1) << (3*bit+1); k |= ((z >> bit) & 1) << (3*bit+2); }
        b.srt[i] = (k, i as u32);
    }
    b.srt[..n].sort_unstable();
    let mut s0 = 0usize; let mut m = 0usize;
    while s0 < n {
        let g = (b.rng.f() + b.rng.f() + b.rng.f() + b.rng.f() - 2.0) * 1.73;
        let sz = ((1.6094f32 + 0.3 * g).exp().round() as usize).clamp(3, 8);
        let e = (s0 + sz).min(n);
        for k in s0..e { b.clump[b.srt[k].1 as usize] = m as u16; }
        s0 = e; m += 1;
    }
    b.ncl = m;
    for i in 0..n {
        let c = b.clump[i] as usize;
        b.chain[i] = if c % 2 == 0 { ((c / 2) % TC) as u8 } else { 255 };
        b.ft[i] = 0.0;
        for k in 0..3 { b.cc[c][k] += b.p[i][k]; }
        b.ccnt[c] += 1.0;
    }
    for c in 0..m { for k in 0..3 { b.cc[c][k] /= b.ccnt[c].max(1.0); } }
    for i in 0..n { let c = b.clump[i] as usize; for k in 0..3 { b.r0[i][k] = b.p[i][k] - b.cc[c][k]; } }
    // clump radius is a REST property: recomputing it every frame fed the
    // clump-clump repulsion back into itself and blew the body apart.
    for i in 0..n { let c = b.clump[i] as usize; for k in 0..3 { b.cr[c] += b.r0[i][k] * b.r0[i][k]; } }
    for c in 0..m { b.cr[c] = (b.cr[c] / b.ccnt[c].max(1.0)).sqrt() * 1.3 + 0.04; }
    b.tear_scale = 1.0; b.tear_rate = 0.0;
    // skeleton
    for k in 0..KN {
        b.q[k] = fib(k);
        b.q[k] = [b.q[k][0]*0.6, b.q[k][1]*0.6, b.q[k][2]*0.6];
        b.qv[k] = [0.0; 3];
        b.qr[k] = if k < 6 { 0.55 } else { 0.0 };
        b.agg[k] = [0.0; 3];
    }
    for c in 0..TC {
        let d = fib(c * 2 + 1);
        for m in 0..MP {
            let s = 0.6 + 0.2 * m as f32;
            b.cp[c][m] = [d[0]*s, d[1]*s, d[2]*s];
            b.cpp[c][m] = b.cp[c][m];
        }
        b.cw[c] = 0.0;
    }
    for i in 0..n { b.node[i] = 0; }
    b.center = [0.0; 3];
    for i in 0..8 { b.phase[i] = b.rng.range(0.0, 6.2831853); }
    b.wild_x = b.rng.range(0.2, 0.8);
    b.wild_t = 0.0;
    b.wild = 0.5;
    b.form = 0; b.prev_form = 0; b.fb = 1.0; b.fbv = 0.0; b.fb_target = 1.0;
    b.next_burst = 3.0;
    b.next_form = 10.0;
    b.next_tear = 6.0;
    b.body_f = [[0.0; 3]; 2];
    b.inp = [0.0; 544];
    b.pst = 0; b.ptimer = 0.0; b.lose_t = 0.0; b.brk = 0.0; b.pw = 0.0; b.pv = [0.0; 3]; b.home = [0.0; 3]; b.pdist = 1e3; b.aggro = 0.0; b.stolen = 0; b.enc = 0.0; b.grab = 0.0; b.sqz = 0.0; b.tslot = 0;
    b.inp[4] = -100.0; // water level far below
    super::sim::build_grid(b);
    super::sim::assign_nodes(b, true);
    super::sim::build_grid(b);
    // bonds (kNN via grid)
    super::sim::init_bonds(b);
    super::sim::density(b);
    // rho0 from interior mean
    let mut s = 0.0; let mut c = 0.0;
    for i in 0..n {
        if len(b.p[i]) < 0.5 * rb { s += b.rho[i]; c += 1.0; }
    }
    b.rho0 = 0.6 * if c > 0.0 { s / c } else { 80.0 };
    b
}

pub fn fib(k: usize) -> [f32; 3] {
    let g = 2.399963229728653f32;
    let y = 1.0 - 2.0 * (k as f32 + 0.5) / 12.0;
    let r = (1.0 - y * y).max(0.0).sqrt();
    let a = g * k as f32;
    [r * a.cos(), y, r * a.sin()]
}
