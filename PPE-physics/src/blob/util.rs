pub struct Rng { pub s: [u64; 2] }
impl Rng {
    pub fn new(seed: u32) -> Self {
        let mut z = seed as u64 ^ 0x9E3779B97F4A7C15;
        let mut sm = || {
            z = z.wrapping_add(0x9E3779B97F4A7C15);
            let mut x = z;
            x = (x ^ (x >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
            x = (x ^ (x >> 27)).wrapping_mul(0x94D049BB133111EB);
            x ^ (x >> 31)
        };
        Rng { s: [sm(), sm()] }
    }
    pub fn next(&mut self) -> u64 {
        let mut s1 = self.s[0];
        let s0 = self.s[1];
        let r = s0.wrapping_add(s1);
        self.s[0] = s0;
        s1 ^= s1 << 23;
        self.s[1] = s1 ^ s0 ^ (s1 >> 18) ^ (s0 >> 5);
        r
    }
    pub fn f(&mut self) -> f32 { ((self.next() >> 40) as f32) / 16777216.0 }
    pub fn range(&mut self, a: f32, b: f32) -> f32 { a + (b - a) * self.f() }
    pub fn below(&mut self, n: u32) -> u32 { ((self.next() >> 33) as u32) % n.max(1) }
}
pub type V3 = [f32; 3];
#[inline] pub fn len(a: V3) -> f32 { (a[0]*a[0] + a[1]*a[1] + a[2]*a[2]).sqrt() }
#[inline] pub fn norm(a: V3) -> V3 { let l = len(a).max(1e-6); [a[0]/l, a[1]/l, a[2]/l] }
#[inline] pub fn clampf(x: f32, a: f32, b: f32) -> f32 { if x < a { a } else if x > b { b } else { x } }
#[inline] pub fn smooth(a: f32, b: f32, x: f32) -> f32 { let t = clampf((x - a) / (b - a), 0.0, 1.0); t*t*(3.0 - 2.0*t) }
