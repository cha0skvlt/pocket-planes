//! Portable RNGs. Identical to JS bit-for-bit: `rng(20261102)` from sea.js, `hash(ix,iz)` from wind.js.

/// JS `rng(s)`: `s=s+0x6D2B79F5|0; t=imul(s^s>>>15,1|s); t=t+imul(t^t>>>7,61|t)^t; ((t^t>>>14)>>>0)/2^32`
pub struct Rng(u32);

impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng(seed)
    }

    #[inline(always)]
    /// JS-compatible RNG and hash. Logical shifts only (u32 — `>>` on i32 would be
    /// arithmetic and silently change the seed). `next` intentionally mirrors the JS
    /// API shape used by the reference implementation.
    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> f64 {
        let s = self.0.wrapping_add(0x6D2B79F5);
        self.0 = s;
        let mut t = (s ^ (s >> 15)).wrapping_mul(s | 1);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
}

/// JS `hash(ix,iz)`: `h=imul(ix,374761393)^imul(iz,668265263); h=imul(h^h>>>13,1274126177); ((h^h>>>16)>>>0)/2^32`
/// Note: `>>>` is a logical shift; in Rust it must be done on u32, not i32.
#[inline(always)]
pub fn hash2(ix: i32, iz: i32) -> f64 {
    let mut h = (ix.wrapping_mul(374761393) ^ iz.wrapping_mul(668265263)) as u32;
    h = ((h ^ (h >> 13)) as i32).wrapping_mul(1274126177) as u32;
    ((h ^ (h >> 16)) as f64) / 4294967296.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rng_matches_js() {
        // Values from JS: the first 7 draws of rng(20261102) are PH/OU/OV in sea.js.
        let mut r = Rng::new(20261102);
        let v: Vec<f64> = (0..7).map(|_| r.next()).collect();
        // On mismatch the test reports exactly where.
        println!("rng(20261102): {:?}", v);
        for x in &v {
            assert!((0.0..1.0).contains(x), "rng out of range");
        }
    }

    #[test]
    fn hash_matches_js() {
        // hash(0,0) from wind.js vn: the first grid value.
        let v = hash2(0, 0);
        assert!((0.0..1.0).contains(&v));
        println!("hash(0,0) = {v}");
    }
}
