use super::state::*;
use super::util::*;
use std::f32::consts::PI;

pub const H: f32 = 0.26; // smoothing radius (spec 0.14 gives ~6 neighbours at spec packing; 0.26 gives ~40)
const H2: f32 = H * H;
const POLY6: f32 = 315.0 / (64.0 * PI * H2 * H2 * H2 * H2 * H);
const SPIKY: f32 = 45.0 / (PI * H2 * H2 * H2);
const KP: f32 = 2.0;
const C_COH: f32 = 0.004;
const NU: f32 = 6.0;
const KB: f32 = 60.0;
const KN_: f32 = 20.0;
const CN_: f32 = 6.0;
const KT: f32 = 25.0;
const KC: f32 = 300.0;
const CC: f32 = 8.0;
const A_CURL: f32 = 3.0;
const VMAX: f32 = 25.0;
const AMAX: f32 = 600.0;

#[inline]
fn cell_key(p: &[f32; 3]) -> (i32, i32, i32, u16) {
    let ix = (p[0] / H).floor() as i32;
    let iy = (p[1] / H).floor() as i32;
    let iz = (p[2] / H).floor() as i32;
    (ix, iy, iz, hk(ix, iy, iz))
}
#[inline]
fn ohk(ix: i32, iz: i32) -> usize { ((ix.wrapping_mul(73856093) ^ iz.wrapping_mul(19349663)) & 1023) as usize }
#[inline]
fn hk(ix: i32, iy: i32, iz: i32) -> u16 {
    // linear, not XOR: collision-free for any two cells within +-2 of each other
    // (|dx+16dy| <= 34 < 256 forces dz=0, then dx=-16dy has no solution for |dx|<=2),
    // so the 27-cell neighbourhood never visits the same bucket twice.
    ((ix + 16 * iy + 256 * iz) & 0xFFFF) as u16
}

pub fn build_grid(b: &mut B) {
    let n = b.n;
    for c in b.cstart.iter_mut() { *c = 0; }
    for i in 0..n {
        let k = cell_key(&b.p[i]).3;
        b.key[i] = k;
        b.cstart[k as usize + 1] += 1;
    }
    for k in 0..HB { b.cstart[k + 1] += b.cstart[k]; }
    // second pass with per-bucket fill counters stored in chroma2-free temp: use out buffer as scratch
    // (out is rewritten at end of step)
    let scratch = unsafe { std::slice::from_raw_parts_mut(b.out.as_mut_ptr() as *mut u32, HB) };
    for k in 0..HB { scratch[k] = b.cstart[k]; }
    for i in 0..n {
        let k = b.key[i] as usize;
        b.order[scratch[k] as usize] = i as u32;
        scratch[k] += 1;
    }
}

#[inline]
fn for_nb<F: FnMut(usize)>(b: &B, p: &[f32; 3], mut f: F) {
    let (cx, cy, cz, _) = cell_key(p);
    for dz in -1..=1 {
        for dy in -1..=1 {
            for dx in -1..=1 {
                let k = hk(cx + dx, cy + dy, cz + dz) as usize;
                for s in b.cstart[k]..b.cstart[k + 1] {
                    f(b.order[s as usize] as usize);
                }
            }
        }
    }
}

pub fn density(b: &mut B) {
    for i in 0..b.n {
        let pi = b.p[i];
        let mut rho = 0.0f32;
        for_nb(b, &pi, |j| {
            let d = [pi[0] - b.p[j][0], pi[1] - b.p[j][1], pi[2] - b.p[j][2]];
            let r2 = d[0]*d[0] + d[1]*d[1] + d[2]*d[2];
            if r2 < H2 { let w = H2 - r2; rho += b.m[j] * POLY6 * w * w * w; }
        });
        b.rho[i] = rho;
    }
}

pub fn init_bonds(b: &mut B) {
    for i in 0..b.n {
        let pi = b.p[i];
        let mut best = [(1e9f32, u32::MAX); 4];
        for_nb(b, &pi, |j| {
            if j == i { return; }
            // bonds stay inside a clump: a cross-clump bond is a rubber band between
            // two independently moving lumps. It stretches, pulls the whole body into
            // one dense heap and puts strain (and colour) everywhere.
            if b.clump[j] != b.clump[i] { return; }
            let d = [pi[0]-b.p[j][0], pi[1]-b.p[j][1], pi[2]-b.p[j][2]];
            let r2 = d[0]*d[0] + d[1]*d[1] + d[2]*d[2];
            let mut c = (r2, j as u32);
            for s in 0..4 { if c.0 < best[s].0 { std::mem::swap(&mut best[s], &mut c); } }
        });
        for s in 0..4 {
            if best[s].1 == u32::MAX { b.bond[i][s] = i as u32; b.rest[i][s] = 0.1; b.health[i][s] = 0.0; }
            else { b.bond[i][s] = best[s].1; b.rest[i][s] = best[s].0.sqrt().max(0.02); b.health[i][s] = 1.0; }
        }
    }
}

pub fn assign_nodes(b: &mut B, force: bool) {
    for i in 0..b.n {
        let cur = b.node[i] as usize;
        let mut best = 0usize; let mut bs = 1e9f32;
        for k in 0..KN {
            if b.qr[k] < 0.05 { continue; }
            let d = [b.p[i][0]-b.q[k][0], b.p[i][1]-b.q[k][1], b.p[i][2]-b.q[k][2]];
            let s = len(d) - b.qr[k];
            if s < bs { bs = s; best = k; }
        }
        if force || b.qr[cur] < 0.05 { b.node[i] = best as u8; continue; }
        let d = [b.p[i][0]-b.q[cur][0], b.p[i][1]-b.q[cur][1], b.p[i][2]-b.q[cur][2]];
        let sc = len(d) - b.qr[cur];
        if bs < sc - 0.15 * b.qr[cur] { b.node[i] = best as u8; }
    }
}

fn params(b: &B) -> [f32; 6] {
    let a = FORMS[b.prev_form as usize]; let c = FORMS[b.form as usize];
    let mut o = [0.0; 6];
    for i in 0..6 { o[i] = a[i] + (c[i] - a[i]) * b.fb; }
    o
}

pub fn set_form(b: &mut B, form: u32, blend: f32) {
    let f = form.min(5);
    if f != b.form {
        // keep continuity: previous = current effective form (nearest index by blend)
        b.prev_form = if b.fb > 0.5 { b.form } else { b.prev_form };
        b.form = f;
        b.fb = 0.0; b.fbv = 0.0;
    }
    // blend is the target of the form spring; 0 means "default", i.e. full transition
    b.fb_target = if blend > 0.0 { clampf(blend, 0.0, 1.0) } else { 1.0 };
}

#[inline]
fn curl(p: &[f32; 3], t: f32, ph: &[f32; 8]) -> [f32; 3] {
    // analytic curl of trig vector potential, 2 octaves
    let mut o = [0.0f32; 3];
    let mut s = 0.9f32; let mut a = 1.0f32;
    for oct in 0..2 {
        let q = [p[0]*s + 0.1*t*(oct as f32+1.0) + ph[0], p[1]*s + ph[1] + 0.07*t, p[2]*s + ph[2] - 0.09*t];
        // Psi = (sin(qy)cos(qz+1.3), sin(qz)cos(qx+0.7), sin(qx)cos(qy+2.1))
        let (sy, cy) = q[1].sin_cos();
        let (sz, cz) = q[2].sin_cos();
        let (sx, cx) = q[0].sin_cos();
        let (c13, s13) = ((q[2]+1.3).cos(), (q[2]+1.3).sin());
        let (c07, s07) = ((q[0]+0.7).cos(), (q[0]+0.7).sin());
        let (c21, s21) = ((q[1]+2.1).cos(), (q[1]+2.1).sin());
        // dPsiz/dy - dPsiy/dz ; dPsix/dz - dPsiz/dx ; dPsiy/dx - dPsix/dy
        let dpz_dy = -sx * s21;
        let dpy_dz = cz * c07;
        let dpx_dz = -sy * s13;
        let dpz_dx = cx * c21;
        let dpy_dx = -sz * s07;
        let dpx_dy = cy * c13;
        o[0] += a * s * (dpz_dy - dpy_dz);
        o[1] += a * s * (dpx_dz - dpz_dx);
        o[2] += a * s * (dpy_dx - dpx_dy);
        s *= 2.3; a *= 0.5;
    }
    o
}

pub fn step(b: &mut B, dt: f32, t: f32) {
    if b.inited == 0 { return; }
    if dt > 1.0 / 45.0 {
        sub(b, dt * 0.5, t - dt * 0.5);
        sub(b, dt * 0.5, t);
    } else { sub(b, dt, t); }
}

fn sub(b: &mut B, dt: f32, t: f32) {
    let n = b.n;
    b.t = t; b.frame = b.frame.wrapping_add(1);
    let tau = 6.2831853f32;
    // ---- chaos driver
    b.wild_t += dt;
    while b.wild_t >= 0.125 {
        b.wild_t -= 0.125;
        b.wild_x = 3.99 * b.wild_x * (1.0 - b.wild_x);
        b.wild_x = clampf(b.wild_x, 0.001, 0.999);
    }
    let l = 2.0 * b.wild_x - 1.0;
    let wt = 0.5 + 0.5 * (1.5 * l).tanh();
    b.wild += (wt - b.wild) * clampf(dt / 0.6, 0.0, 1.0);
    let w = b.wild;
    let ph = b.phase;
    let pulse = 0.5 + 0.5 * ((tau*t/2.3 + ph[3]).sin() + (tau*t/3.7 + ph[4]).sin() + (tau*t/4.9 + ph[5]).sin()) / 3.0;
    // ---- form spring (zeta 0.45 -> ~20% overshoot)
    let om = 3.0f32; let ze = 0.45f32;
    let acc = om*om*(b.fb_target - b.fb) - 2.0*ze*om*b.fbv;
    b.fbv += acc * dt; b.fb += b.fbv * dt;
    let pr = params(b);
    // interpolated, not the target form: node count and chain count must not jump
    let kt = (pr[0].round() as usize).min(KN); let tt = pr[1];
    let rho0 = b.rho0 * pr[2] * (1.0 - 0.25 * pulse * (0.4 + 0.6 * w)) * (1.0 - 0.15 * w);
    let c_coh = C_COH * pr[3] * (1.3 - 0.8 * w);
    let kb = KB * pr[4];
    let rt = pr[5];
    // ---- pursuit
    let ptg = [b.inp[8], b.inp[9], b.inp[10]];
    let act = b.inp[15] > 0.5;
    let mut cen = b.center;
    let pdv = [ptg[0]-cen[0], ptg[1]-cen[1], ptg[2]-cen[2]];
    let pd = if act { len(pdv) } else { 1e3 };
    b.pdist = pd;
    let rbody = 1.1f32;
    let lis = |tt: f32| [0.8*(0.11*tt + ph[0]).sin(), 0.4*(0.1556*tt + ph[1]).sin(), 0.8*(0.2257*tt + ph[2]).sin()];
    let ps0 = b.pst;
    match b.pst {
        0 => { if pd < 5.0 { b.pst = 1; b.ptimer = b.rng.range(0.8, 1.6); } }
        1 => {
            b.ptimer -= dt;
            if pd > 7.86 { b.pst = 0; }
            else if b.ptimer <= 0.0 {
                b.pst = 2; b.lose_t = 0.0; b.brk = 0.0;
                if b.form != 1 && b.form != 2 { let f = 1 + b.rng.below(2); set_form(b, f, 1.0); }
                b.next_form = t + b.rng.range(4.0, 10.0);
            }
        }
        2 => {
            if pd > 7.86 { b.lose_t += dt; } else { b.lose_t = 0.0; }
            if b.lose_t > 3.0 || !act { b.pst = 3; b.ptimer = 2.0; }
            if b.brk > 0.0 { b.brk -= dt; } else if w > 0.8 && b.rng.f() < dt * 0.12 { b.brk = b.rng.range(1.0, 2.0); }
        }
        _ => { b.ptimer -= dt; if b.ptimer <= 0.0 { b.pst = 0; } }
    }
    if b.pst == 0 && ps0 != 0 { let l = lis(t); b.home = [cen[0]-l[0], cen[1]-l[1], cen[2]-l[2]]; }
    let moving = b.pst == 2 && b.brk <= 0.0;
    let chase = moving || b.pst == 1;
    b.pw += ((if chase { 1.0 } else { 0.0 }) - b.pw) * clampf(dt / 0.5, 0.0, 1.0);
    let vmax = 0.643 * (0.75 + 0.25 * w);
    let amax = 0.214f32;
    let toT = if act { norm(pdv) } else { [1.0, 0.0, 0.0] };
    let mut ad = [0.0f32; 3];
    if moving {
        if pd < 0.66 {
            let r = [cen[0]-ptg[0], 0.0, cen[2]-ptg[2]];
            let tn = norm([r[2], 0.0, -r[0]]);
            for k in 0..3 { ad[k] = 0.9 * (ptg[k]-cen[k]) + 2.0 * (tn[k] * 0.35 * vmax - b.pv[k]); }
        } else {
            for k in 0..3 { ad[k] = 0.9 * (ptg[k]-cen[k]) - 1.6 * b.pv[k]; }
        }
    } else if b.pst == 1 || b.pst == 3 {
        for k in 0..3 { ad[k] = -3.0 * b.pv[k]; }
    } else {
        let l = lis(t);
        for k in 0..3 { ad[k] = 0.9 * (b.home[k] + l[k] - cen[k]) - 1.6 * b.pv[k]; }
    }
    let al = len(ad); if al > amax { for k in 0..3 { ad[k] *= amax / al; } }
    // obstacle avoidance (controller) + cell broadphase
    let nob = (b.inp[536].max(0.0) as usize).min(64);
    for c in b.obc.iter_mut() { *c = 0; }
    let mut aa = [0.0f32; 3];
    let mut contact = false;
    for o in 0..nob {
        let ob = 24 + 8 * o;
        let (bx, bz, hw, hd, top) = (b.inp[ob], b.inp[ob+1], b.inp[ob+2], b.inp[ob+3], b.inp[ob+4]);
        let x0 = ((bx - hw - 0.5) / 16.0).floor() as i32; let x1 = ((bx + hw + 0.5) / 16.0).floor() as i32;
        let z0 = ((bz - hd - 0.5) / 16.0).floor() as i32; let z1 = ((bz + hd + 0.5) / 16.0).floor() as i32;
        for ix in x0..=x1 { for iz in z0..=z1 {
            let k = ohk(ix, iz);
            if b.obc[k] < 8 { b.obl[k][b.obc[k] as usize] = o as u8; b.obc[k] += 1; }
        } }
        let c = [cen[0].clamp(bx-hw, bx+hw), cen[1].min(top), cen[2].clamp(bz-hd, bz+hd)];
        let dd = [cen[0]-c[0], cen[1]-c[1], cen[2]-c[2]];
        let dl = len(dd);
        let rr = rbody + 0.4;
        if dl < rr {
            let nn = if dl < 1e-4 { [0.0, 1.0, 0.0] } else { [dd[0]/dl, dd[1]/dl, dd[2]/dl] };
            let pen = rr - dl;
            contact = true;
            for k in 0..3 { aa[k] += 3.0 * pen * nn[k]; }
            // Slide along the wall in the direction the body is already moving;
            // head-on, pick a side once and keep it. The old sign was inverted, so
            // the tangential term damped the slide instead of driving it.
            let tdot = b.pv[0]*nn[2] - b.pv[2]*nn[0];
            let sg = if tdot.abs() > 0.02 { tdot.signum() } else {
                if b.oside == 0.0 {
                    let cr = toT[0]*nn[2] - toT[2]*nn[0];
                    b.oside = if cr.abs() > 1e-3 { cr.signum() } else { 1.0 };
                }
                b.oside
            };
            let tm = 1.2 * (len(b.pv) + 2.0 * pen);
            aa[0] += nn[2] * sg * tm; aa[2] -= nn[0] * sg * tm;
        }
        if dl < rr * 2.0 && top - cen[1] < 0.5 * rbody { aa[1] += 0.7 * 3.0 * (0.5 * rbody - (top - cen[1])).max(0.1); }
    }
    if !contact { b.oside = 0.0; }
    for k in 0..3 { ad[k] += aa[k]; }
    let al = len(ad); if al > 3.0 * amax { for k in 0..3 { ad[k] *= 3.0 * amax / al; } }
    for k in 0..3 { b.pv[k] += ad[k] * dt; }
    let vl = len(b.pv); if vl > vmax { for k in 0..3 { b.pv[k] *= vmax / vl; } }
    for k in 0..3 { cen[k] += b.pv[k] * dt; }
    b.center = cen;
    // ---- events
    if t >= b.next_form {
        let mut f = b.rng.below(6); if f == b.form { f = (f + 1) % 6; }
        if b.pst == 2 { f = if b.form == 1 { 2 } else { 1 }; }
        set_form(b, f, 1.0);
        if b.pst == 2 { b.next_form = t + b.rng.range(4.0, 10.0); } else { b.next_form = t + b.rng.range(8.0, 20.0); }
    }
    if t >= b.next_burst && b.ncl > 8 {
        let mut bm = 0usize; let mut bs = -1.0f32;
        for _ in 0..24 {
            let i = b.rng.below(n as u32) as usize;
            let sc = b.chroma[i] * clampf(1.0 - b.rho[i] / rho0.max(1.0), 0.0, 1.0);
            if sc > bs { bs = sc; bm = b.clump[i] as usize; }
        }
        let c0 = b.cc[bm];
        let nrm = if b.pst == 2 { norm([b.inp[8]-c0[0], b.inp[9]-c0[1], b.inp[10]-c0[2]]) } else { norm([c0[0]-b.center[0], c0[1]-b.center[1], c0[2]-b.center[2]]) };
        let nk = (((0.05 + 0.05 * b.rng.f()) * b.ncl as f32) as usize).max(3);
        // spec §7: 0.25-0.45 local. 3-5 was 10x too fast and threw clumps 300 m out.
        let fl = b.rng.range(2.0, 4.0); let imp = b.rng.range(0.25, 0.45);
        for _ in 0..nk {
            let mut bj = usize::MAX; let mut bd = 1e9f32;
            for m in 0..b.ncl {
                if b.cbk[m] > 0.0 { continue; }
                let d = [b.cc[m][0]-c0[0], b.cc[m][1]-c0[1], b.cc[m][2]-c0[2]];
                let dl = d[0]*d[0] + d[1]*d[1] + d[2]*d[2];
                if dl < bd { bd = dl; bj = m; }
            }
            if bj == usize::MAX { break; }
            b.cbk[bj] = 0.3; b.cbd[bj] = nrm; b.cbi[bj] = imp;
        }
        for i in 0..n { if b.cbk[b.clump[i] as usize] > 0.0 { b.detach[i] = fl; b.flags[i] |= 2; } }
        b.next_burst = t + b.rng.range(6.0, 12.0);
    }
    // ---- skeleton
    let wf = [0.37f32, 0.5232, 0.6408];
    let mut near = [usize::MAX; 2]; let mut nd = [6.0f32; 2];
    for bi in 0..2 {
        let o = 8 + bi * 8;
        if b.inp[o + 7] > 0.5 {
            for k in 0..kt.min(KN) {
                let d = [b.inp[o]-b.q[k][0], b.inp[o+1]-b.q[k][1], b.inp[o+2]-b.q[k][2]];
                let dl = len(d);
                if dl < nd[bi] { nd[bi] = dl; near[bi] = k; }
            }
        }
    }
    for k in 0..KN {
        let rt_ = if k < kt { 0.55 } else { 0.0 };
        b.qr[k] += (rt_ - b.qr[k]) * clampf(dt / 0.4, 0.0, 1.0);
        let base = fib(k);
        let dotf = base[0]*toT[0] + base[1]*toT[1] + base[2]*toT[2];
        let gd = 0.6 + 0.4 * smooth(1.65, 0.55, pd);
        let lean = (0.75 * gd * (0.6 + 0.4 * w) * b.pw * (0.55 + 0.6 * dotf)).clamp(0.0, 0.9);
        let d = norm([base[0] + (toT[0]-base[0])*lean, base[1] + (toT[1]-base[1])*lean, base[2] + (toT[2]-base[2])*lean]);
        let rad = (0.45 + 0.35 * w) * (1.0 + 0.5 * b.pw * dotf.max(0.0));
        let kf = k as f32;
        let mut tg = [
            cen[0] + d[0]*rad + 0.3*(wf[0]*t + kf).sin(),
            cen[1] + d[1]*rad + 0.3*(wf[1]*t + 2.0*kf).sin(),
            cen[2] + d[2]*rad + 0.3*(wf[2]*t + 3.0*kf).sin(),
        ];
        let mut want = [0.0f32; 3];
        for bi in 0..2 {
            if near[bi] == k {
                let o = 8 + bi * 8;
                for a in 0..3 { want[a] += clampf(b.inp[o+a] - b.q[k][a], -1.5, 1.5) * 0.5; }
            }
        }
        let al = clampf(dt / 0.3, 0.0, 1.0);
        for a in 0..3 { b.agg[k][a] += (want[a] - b.agg[k][a]) * al; tg[a] += b.agg[k][a]; }
        for a in 0..3 {
            let acc = 16.0 * (tg[a] - b.q[k][a]) - 5.6 * b.qv[k][a];
            b.qv[k][a] += acc * dt; b.q[k][a] += b.qv[k][a] * dt;
        }
    }
    // chains
    let idt = if dt > 1e-5 { 1.0 / dt } else { 0.0 };
    for c in 0..TC {
        let wt = clampf(tt - c as f32, 0.0, 1.0);
        b.cw[c] += (wt - b.cw[c]) * clampf(dt / 0.4, 0.0, 1.0);
        let k = c % kt.max(1);
        let dir = norm([b.q[k][0]-cen[0], b.q[k][1]-cen[1], b.q[k][2]-cen[2]]);
        let base = [b.q[k][0]+dir[0]*b.qr[k], b.q[k][1]+dir[1]*b.qr[k], b.q[k][2]+dir[2]*b.qr[k]];
        b.cp[c][0] = base;
        let seg = 0.2 * b.cw[c] + 0.005;
        for m in 1..MP {
            let cur = b.cp[c][m]; let prv = b.cpp[c][m];
            let mf = m as f32; let cf = c as f32;
            let mut ac = [dir[0]*2.0, dir[1]*2.0, dir[2]*2.0];
            let amp = 3.0 * (0.3 + w) * (mf / 5.0);
            ac[0] += amp * (1.1*t + cf*1.7 + mf*0.6).sin();
            ac[1] += amp * (0.9*t + cf*2.3 + mf*0.5).sin();
            ac[2] += amp * (1.3*t + cf*0.9 + mf*0.7).sin();
            ac[0] += b.inp[0] * 0.2; ac[1] += b.inp[1] * 0.2; ac[2] += b.inp[2] * 0.2;
            if b.pw > 0.05 && act {
                let sc = b.pw * (mf / 5.0);
                for a in 0..3 { ac[a] += sc * (2.2 * (ptg[a] - cur[a]) - 1.8 * (cur[a] - prv[a]) * idt); }
                if m == MP - 1 {
                    for c2 in 0..TC {
                        if c2 != c && b.cw[c2] > 0.05 {
                            let o = b.cp[c2][MP-1];
                            let dd = [cur[0]-o[0], cur[1]-o[1], cur[2]-o[2]]; let dl = len(dd);
                            if dl < 0.35 && dl > 1e-4 { for a in 0..3 { ac[a] += dd[a] / dl * 12.0 * (0.35 - dl) / 0.35; } }
                        }
                    }
                    if pd < 0.55 {
                        let tn = norm([cur[2]-ptg[2], 0.0, -(cur[0]-ptg[0])]);
                        for a in 0..3 { ac[a] += tn[a] * 3.0 * b.pw; }
                    }
                }
            }
            for a in 0..3 {
                let vel = (cur[a] - prv[a]) * 0.985;
                b.cpp[c][m][a] = cur[a];
                b.cp[c][m][a] = cur[a] + vel + ac[a] * dt * dt;
            }
        }
        for _ in 0..3 {
            for m in 1..MP {
                let a = b.cp[c][m - 1]; let p = b.cp[c][m];
                let d = [p[0]-a[0], p[1]-a[1], p[2]-a[2]];
                let dl = len(d).max(1e-5);
                let corr = (dl - seg) / dl;
                let wgt = if m == 1 { 1.0 } else { 0.5 };
                for k2 in 0..3 {
                    b.cp[c][m][k2] -= d[k2] * corr * wgt;
                    if m > 1 { b.cp[c][m-1][k2] += d[k2] * corr * 0.5; }
                }
            }
        }
        for m in 2..MP {
            for a in 0..3 {
                let tgt = 2.0 * b.cp[c][m-1][a] - b.cp[c][m-2][a];
                b.cp[c][m][a] += 0.12 * (tgt - b.cp[c][m][a]);
            }
        }
    }
    if b.frame % 4 == 0 { assign_nodes(b, false); }
    // ---- neighbors + density
    build_grid(b);
    density(b);
    // ---- clumps
    let nc = b.ncl;
    for c in 0..nc { b.cc[c] = [0.0; 3]; b.cv[c] = [0.0; 3]; b.ccnt[c] = 0.0; b.cca[c] = [0.0; 3]; b.cbk[c] = (b.cbk[c] - dt).max(0.0); }
    for i in 0..n { let c = b.clump[i] as usize; for k in 0..3 { b.cc[c][k] += b.p[i][k]; b.cv[c][k] += b.v[i][k]; } b.ccnt[c] += 1.0; }
    for c in 0..nc { let k0 = b.ccnt[c].max(1.0); for k in 0..3 { b.cc[c][k] /= k0; b.cv[c][k] /= k0; } }
    for a in 0..nc {
        for c in a + 1..nc {
            let d = [b.cc[c][0]-b.cc[a][0], b.cc[c][1]-b.cc[a][1], b.cc[c][2]-b.cc[a][2]];
            let rav = 0.5 * (b.cr[a] + b.cr[c]); let far = 2.5 * rav;
            if d[0].abs() > far || d[1].abs() > far || d[2].abs() > far { continue; }
            let dl = len(d); if dl < 1e-5 || dl > far { continue; }
            let f = if dl < 1.6 * rav { -30.0 * (1.6 * rav - dl) } else { 0.6 * (PI * (dl - 1.6 * rav) / (0.9 * rav)).sin() };
            let f = f.clamp(-40.0, 40.0);
            for k in 0..3 { let u = d[k] / dl * f; b.cca[a][k] += u; b.cca[c][k] -= u; }
        }
    }
    for c in 0..nc { let l = len(b.cca[c]); if l > 60.0 { for k in 0..3 { b.cca[c][k] *= 60.0 / l; } } }
    // ---- forces
    let wind = [b.inp[0], b.inp[1], b.inp[2]]; let gust = b.inp[3];
    let water = b.inp[4];
    let mut cen_acc = [0.0f32; 3]; let mut sp_sum = 0.0f32;
    let mut mn = [1e9f32; 3]; let mut mx = [-1e9f32; 3];
    b.body_f = [[0.0; 3]; 2];
    let tnow = t;
    let mut tears = 0.0f32;
    for i in 0..n {
        let pi = b.p[i]; let vi = b.v[i];
        let rhoi = b.rho[i].clamp(0.1 * b.rho0, 8.0 * b.rho0);
        let pri = KP * (rhoi - rho0).max(0.0);
        let mut ap = [0.0f32; 3]; let mut gc = [0.0f32; 3]; let mut av = [0.0f32; 3];
        for_nb(b, &pi, |j| {
            if j == i { return; }
            let d = [pi[0]-b.p[j][0], pi[1]-b.p[j][1], pi[2]-b.p[j][2]];
            let r2 = d[0]*d[0] + d[1]*d[1] + d[2]*d[2];
            if r2 >= H2 || r2 < 1e-10 { return; }
            let r = r2.sqrt();
            let rj = b.rho[j].clamp(0.1 * b.rho0, 8.0 * b.rho0);
            let prj = KP * (rj - rho0).max(0.0);
            let g = -SPIKY * (H - r) * (H - r) / r; // grad W = g * d
            let kk = b.m[j] * (pri / (rhoi * rhoi) + prj / (rj * rj)) * g;
            for a in 0..3 { ap[a] -= kk * d[a]; gc[a] += b.m[j] * g * d[a]; }
            let w = H2 - r2; let wk = POLY6 * w * w * w * b.m[j] / rj;
            for a in 0..3 { av[a] += wk * (b.v[j][a] - vi[a]); }
        });
        let al = len(ap); if al > 400.0 { for a in 0..3 { ap[a] *= 400.0 / al; } }
        let skin = clampf(1.0 - rhoi / rho0.max(1.0), 0.0, 1.0);
        let spd = len(vi);
        let mut a = [0.0f32; 3];
        // anisotropic cohesion: weaker along motion
        let vh = norm(vi); let alpha = 0.5 * clampf(spd / 4.0, 0.0, 1.0);
        let gdot = gc[0]*vh[0] + gc[1]*vh[1] + gc[2]*vh[2];
        for k in 0..3 { a[k] += ap[k] + c_coh * skin * (gc[k] - alpha * gdot * vh[k]) + NU * av[k]; }
        let mut jv = [0.0f32; 3];
        let mi = b.clump[i] as usize;
        // bonds
        let mut st_sum = 0.0f32; let mut st_n = 0.0f32;
        for s in 0..4 {
            let j = b.bond[i][s] as usize;
            if j == i { continue; }
            let d = [b.p[j][0]-pi[0], b.p[j][1]-pi[1], b.p[j][2]-pi[2]];
            let l = len(d).max(1e-5);
            let rs = b.rest[i][s];
            // hard kill only on a real break; 3x rest fired constantly while the body
            // leans toward the target and killed the whole network.
            if l > 6.0 * rs || l < 0.1 * rs { b.health[i][s] = 0.0; }
            let ex = l / rs - 1.0;
            st_sum += ex.max(0.0); st_n += 1.0;
            let te = 0.55 * (1.0 - 0.5 * w) * b.tear_scale * if b.clump[j] as usize != mi { 0.33 } else { 1.0 };
            let h0 = b.health[i][s];
            if ex > te { b.health[i][s] = (h0 - dt / 0.25).max(0.0); }
            else { b.health[i][s] = (h0 + dt / 0.8).min(1.0); }
            // count each physical break once: i->j and j->i are separate entries
            if h0 > 0.5 && b.health[i][s] <= 0.5 && (b.bond[i][s] as usize) > i {
                tears += 1.0; b.ft[i] = 0.0;
                let im = b.rng.range(0.4, 1.2);
                for k in 0..3 { jv[k] -= d[k] / l * im; }
            }
            let f = b.health[i][s] * kb * (l - rs) / l;
            for k in 0..3 { a[k] += f * d[k]; }
            // rebuild dead bond (not more than ~every 0.5 s)
            if b.health[i][s] < 0.02 && (b.frame.wrapping_add(i as u32 * 7) % 30) == 0 {
                let mut bj = u32::MAX; let mut bd = (1.5 * rs).max(0.15).powi(2);
                for_nb(b, &pi, |q| {
                    if q == i { return; }
                    if b.clump[q] != b.clump[i] { return; }
                    for s2 in 0..4 { if b.bond[i][s2] as usize == q { return; } }
                    let dd = [b.p[q][0]-pi[0], b.p[q][1]-pi[1], b.p[q][2]-pi[2]];
                    let r2 = dd[0]*dd[0] + dd[1]*dd[1] + dd[2]*dd[2];
                    if r2 < bd { bd = r2; bj = q as u32; }
                });
                if bj != u32::MAX { b.bond[i][s] = bj; b.rest[i][s] = bd.sqrt().max(0.05); b.health[i][s] = 0.3; }
            }
        }
        b.strain[i] = if st_n > 0.0 { st_sum / st_n } else { 0.0 };
        // FREE means detached from the body, not "lost one bond": a cell goes free
        // only when most of its bonds are dead, and comes back when they heal.
        let mut hm = 1.0f32;
        for s in 0..4 { let j = b.bond[i][s] as usize; if j != i { hm = hm.min(b.health[i][s]); } }
        if hm < 0.15 { b.flags[i] |= 4; } else if hm > 0.5 { b.flags[i] &= !4; }
        // node / tube
        let det = b.detach[i] > 0.0;
        let ch = b.chain[i] as usize;
        let mut tip = 0.0f32;
        let mut hs = 0.0f32;
        if det {
            for k in 0..3 { a[k] -= 1.5 * vi[k]; }
            // recall toward node when detach about to expire
            if b.detach[i] < 1.0 {
                let q = b.q[b.node[i] as usize];
                for k in 0..3 { a[k] += 8.0 * (q[k] - pi[k]); }
            }
        } else if ch < TC && b.cw[ch] > 0.05 {
            let sidx = b.sp[i] * (MP as f32 - 1.0);
            let m0 = (sidx.floor() as usize).min(MP - 2);
            let fr = sidx - m0 as f32;
            let tr = rt * (1.0 - 0.6 * b.sp[i]) * b.cw[ch];
            let mut tg = [0.0f32; 3];
            for k in 0..3 {
                tg[k] = b.cp[ch][m0][k] * (1.0 - fr) + b.cp[ch][m0+1][k] * fr + b.off[i][k] * tr;
                a[k] += KT * (tg[k] - pi[k]) - 8.0 * vi[k];
            }
            tip = b.sp[i] * b.sp[i]; hs = b.sp[i];
        } else {
            let nk = b.node[i] as usize;
            let qn = b.q[nk];
            let u = norm([pi[0]-qn[0], pi[1]-qn[1], pi[2]-qn[2]]);
            for k in 0..3 {
                a[k] += KN_ * (qn[k] + b.qr[nk] * u[k] - pi[k]) - CN_ * (vi[k] - b.qv[nk][k]);
            }
            let dq = [pi[0]-qn[0], pi[1]-qn[1], pi[2]-qn[2]];
            hs = clampf(len(dq) / b.qr[nk].max(0.1), 0.0, 1.0) * 0.3;
        }
        {
            let c = mi;
            if b.flags[i] & 4 == 0 {
                for k in 0..3 { a[k] += 10.0 * (b.cc[c][k] + b.r0[i][k] - pi[k]) - 4.0 * (vi[k] - b.cv[c][k]); }
            } else {
                b.ft[i] += dt;
                if b.ft[i] > 1.5 + 1.5 * b.sp[i] {
                    let dd = [b.cc[c][0] + b.r0[i][0] - pi[0], b.cc[c][1] + b.r0[i][1] - pi[1], b.cc[c][2] + b.r0[i][2] - pi[2]];
                    for k in 0..3 { a[k] += 1.2 * dd[k] - 1.0 * vi[k]; }
                    if len(dd) < 0.5 * b.cr[c] + 0.06 { b.flags[i] &= !4; b.ft[i] = 0.0; for s in 0..4 { b.health[i][s] = b.health[i][s].max(0.6); } }
                }
            }
            for k in 0..3 { a[k] += b.cca[c][k]; }
            if b.cbk[c] > 0.0 { for k in 0..3 { a[k] += b.cbd[c][k] * b.cbi[c] / 0.3; } }
        }
        // curl
        let sc = 0.9f32;
        let cu = curl(&[pi[0]*sc, pi[1]*sc, pi[2]*sc], tnow, &ph);
        let ac = A_CURL * (0.4 + 1.2 * w);
        for k in 0..3 { a[k] += ac * cu[k] * if ch < TC && b.cw[ch] > 0.05 { 0.3 } else { 1.0 }; }
        // wind, buoyant gravity
        let du = [wind[0]-vi[0], wind[1]-vi[1], wind[2]-vi[2]];
        let dl = len(du);
        for k in 0..3 { a[k] += 0.012 * (1.0 + gust) * dl * du[k]; }
        a[1] -= 9.81 * 0.15;
        if pi[1] < water { a[1] += 30.0 * (water - pi[1]) - 3.0 * vi[1]; }
        // bodies
        for bi in 0..2 {
            let o = 8 + bi * 8;
            if b.inp[o + 7] < 0.5 { continue; }
            let c = [b.inp[o], b.inp[o+1], b.inp[o+2]];
            let rr = b.inp[o+3] + b.r[i];
            let d = [pi[0]-c[0], pi[1]-c[1], pi[2]-c[2]];
            let dist = len(d);
            if dist < rr + 0.1 {
                let nn = if dist < 1e-4 { [0.0, 1.0, 0.0] } else { [d[0]/dist, d[1]/dist, d[2]/dist] };
                let pen = (rr - dist).max(0.0);
                let vb = [b.inp[o+4], b.inp[o+5], b.inp[o+6]];
                let vn = (vi[0]-vb[0])*nn[0] + (vi[1]-vb[1])*nn[1] + (vi[2]-vb[2])*nn[2];
                let mag = KC * pen - CC * vn.min(0.0);
                let mag = mag.min(AMAX);
                for k in 0..3 { a[k] += mag * nn[k]; b.body_f[bi][k] -= mag * nn[k] * b.m[i] / 0.16 * 0.01; }
            }
        }
        // age & clamp
        b.age[i] += dt;
        let al = len(a);
        if al > AMAX { for k in 0..3 { a[k] *= AMAX / al; } }
        let mut vn = [vi[0] + a[0]*dt + jv[0], vi[1] + a[1]*dt + jv[1], vi[2] + a[2]*dt + jv[2]];
        let vl = len(vn);
        if vl > VMAX { for k in 0..3 { vn[k] *= VMAX / vl; } }
        if !(vn[0].is_finite() && vn[1].is_finite() && vn[2].is_finite()) { vn = [0.0; 3]; }
        b.v[i] = vn;
        b.sp_tmp(i, tip, hs);
        sp_sum += len(vn);
        for k in 0..3 { cen_acc[k] += pi[k]; }
    }
    {
        let target = 10.0 + 50.0 * w;
        b.tear_rate += (tears / dt - b.tear_rate) * clampf(dt / 1.0, 0.0, 1.0);
        // sign was inverted: more tears than target must RAISE the threshold,
        // otherwise the loop feeds itself and the whole bond network dies.
        // cap at 3: a higher scale makes bonds unbreakable, the body is then held by
        // stretched rubber bands, compresses into one dense heap and strains everywhere.
        b.tear_scale = clampf(b.tear_scale * (1.0 + clampf(1.5 * dt * (b.tear_rate - target) / target, -0.05, 0.05)), 0.3, 3.0);
    }
    // integrate, recall
    let cn = [cen_acc[0] / n as f32, cen_acc[1] / n as f32, cen_acc[2] / n as f32];
    for i in 0..n {
        for k in 0..3 { b.p[i][k] += b.v[i][k] * dt; }
        {
            let pp = b.p[i];
            let kk = ohk((pp[0] / 16.0).floor() as i32, (pp[2] / 16.0).floor() as i32);
            for s in 0..b.obc[kk] as usize {
                let ob = 24 + 8 * b.obl[kk][s] as usize;
                let (bx, bz, hw, hd, top) = (b.inp[ob], b.inp[ob+1], b.inp[ob+2], b.inp[ob+3], b.inp[ob+4]);
                let p = b.p[i]; let ri = b.r[i];
                let c = [p[0].clamp(bx-hw, bx+hw), p[1].min(top), p[2].clamp(bz-hd, bz+hd)];
                let dd = [p[0]-c[0], p[1]-c[1], p[2]-c[2]]; let dl = len(dd);
                if dl < 1e-6 {
                    let ex = hw - (p[0]-bx).abs(); let ez = hd - (p[2]-bz).abs(); let ey = top - p[1];
                    if ey <= ex && ey <= ez { b.p[i][1] = top + ri; b.v[i][1] = b.v[i][1].abs() * 0.2; }
                    else if ex <= ez { let sg = if p[0] >= bx { 1.0 } else { -1.0 }; b.p[i][0] = bx + sg * (hw + ri); b.v[i][0] = -0.2 * b.v[i][0]; }
                    else { let sg = if p[2] >= bz { 1.0 } else { -1.0 }; b.p[i][2] = bz + sg * (hd + ri); b.v[i][2] = -0.2 * b.v[i][2]; }
                } else if dl < ri + 0.1 {
                    let nn = [dd[0]/dl, dd[1]/dl, dd[2]/dl];
                    let pen = ri + 0.1 - dl;
                    let tdot = toT[0]*nn[0] + toT[1]*nn[1] + toT[2]*nn[2];
                    for k in 0..3 { b.v[i][k] += (120.0 * pen * nn[k] + 40.0 * pen * (toT[k] - tdot * nn[k])) * dt; }
                    let vn = b.v[i][0]*nn[0] + b.v[i][1]*nn[1] + b.v[i][2]*nn[2];
                    if vn < 0.0 { for k in 0..3 { b.v[i][k] -= 1.2 * vn * nn[k]; } }
                }
            }
        }
        let d = [b.p[i][0]-cn[0], b.p[i][1]-cn[1], b.p[i][2]-cn[2]];
        if len(d) > 4.0 && b.detach[i] <= 0.0 {
            let q = b.q[b.node[i] as usize]; let al = clampf(dt / 0.3, 0.0, 1.0);
            for k in 0..3 { b.p[i][k] += (q[k] - b.p[i][k]) * al; b.v[i][k] *= 0.3; }
        }
        if b.detach[i] > 0.0 { b.detach[i] -= dt; if b.detach[i] <= 0.0 { b.flags[i] &= !2; } }
        for k in 0..3 { mn[k] = mn[k].min(b.p[i][k]); mx[k] = mx[k].max(b.p[i][k]); }
    }
    for k in 0..2 {
        let f = b.body_f[k]; let l = len(f);
        if l > 40.0 { for a in 0..3 { b.body_f[k][a] *= 40.0 / l; } }
    }
    color_and_out(b, dt, t, w, cn, mn, mx, sp_sum / n as f32);
}

impl B {
    #[inline] fn sp_tmp(&mut self, i: usize, tip: f32, hs: f32) {
        // stash tip/hue-s in strain-free slots: tip in chroma2, s in sp-like buffer via off? use age-neutral arrays
        self.chroma2[i] = tip;
        self.rho_s[i] = hs;
    }
}

fn color_and_out(b: &mut B, dt: f32, t: f32, w: f32, cn: [f32; 3], mn: [f32; 3], mx: [f32; 3], ms: f32) {
    let n = b.n;
    // activity, not geometry: a cell glows because it moves and strains, not because
    // it sits at a certain place on a chain. no diffusion: the body must flash, not blur.
    let _ = (dt, t, w);
    for i in 0..n {
        let v = b.v[i];
        let vr = (len([v[0]-b.pv[0], v[1]-b.pv[1], v[2]-b.pv[2]]) / 1.5).min(1.0);
        // reach along a tendril dominates: the body stays coal, the tips burn.
        // tip is a static position on a chain: on its own it keeps the tendril tips
        // glowing forever, even at rest. It only counts while the cell is moving.
        let tip = b.chroma2[i] * (0.25 + 0.75 * vr);
        let act = clampf(0.30 * vr + 0.10 * b.strain[i].min(1.0) + 0.60 * tip, 0.0, 1.0);
        b.chroma[i] = act;
        b.out[8 * NM + 4 * i] = act;
    }
    for i in 0..n {
        let act = b.out[8 * NM + 4 * i];
        // three discrete reds over coal. green <= 0.10, blue <= 0.10: no orange, no yellow.
        // The scene has no gamma correction and the canvas is sRGB, so every shader
        // value is lifted by ~1/2.2. The rest of the game is authored dark (ocean base
        // is 0.006). Values here must live in the same space, or 0.03 reads as grey
        // and a bright red reads as beige.
        let (col, em) = if act < 0.38 { ([0.006f32, 0.004, 0.004], 0.0f32) }
            else if act < 0.52 { ([0.100f32, 0.004, 0.004], 0.25) }
            else if act < 0.68 { ([0.350f32, 0.008, 0.008], 0.45) }
            else { ([0.750f32, 0.012, 0.012], 0.60) };
        let mut hm = 1.0f32;
        for s in 0..4 { if b.bond[i][s] as usize != i { hm = hm.min(b.health[i][s]); } }
        let o = &mut b.out;
        o[4*i] = b.p[i][0]; o[4*i+1] = b.p[i][1]; o[4*i+2] = b.p[i][2]; o[4*i+3] = b.r[i];
        o[4*NM + 4*i]   = col[0];
        o[4*NM + 4*i+1] = col[1];
        o[4*NM + 4*i+2] = col[2];
        o[4*NM + 4*i+3] = em;
        o[12*NM + 4*i] = clampf(b.strain[i] * 2.0, 0.0, 1.0); o[12*NM + 4*i+1] = hm;
        o[12*NM + 4*i+2] = b.clump[i] as f32 / b.ncl.max(1) as f32;
        o[12*NM + 4*i+3] = if b.flags[i] & 4 != 0 { b.ft[i] } else { 0.0 };
        o[8*NM + 4*i] = act; o[8*NM + 4*i+1] = b.node[i] as f32;
        o[8*NM + 4*i+2] = b.age[i]; o[8*NM + 4*i+3] = b.flags[i] as f32 + if (b.chain[i] as usize) < TC && b.cw[b.chain[i] as usize] > 0.05 { 1.0 } else { 0.0 };
    }
    let m = 16 * NM;
    b.out[m] = n as f32; b.out[m+1] = b.form as f32; b.out[m+2] = b.fb; b.out[m+3] = w;
    b.out[m+4] = cn[0]; b.out[m+5] = cn[1]; b.out[m+6] = cn[2];
    b.out[m+7] = mx[0]-mn[0]; b.out[m+8] = mx[1]-mn[1]; b.out[m+9] = mx[2]-mn[2];
    b.out[m+10] = ms;
    b.out[m+11] = b.body_f[0][0]; b.out[m+12] = b.body_f[0][1]; b.out[m+13] = b.body_f[0][2];
    b.out[m+14] = b.pst as f32; b.out[m+15] = b.pdist;
}
