#!/bin/bash
# WASM core build: rustc → wasm32-unknown-unknown → PPE-graphics/sim/pocket_physics.wasm.
# Homebrew cargo does not see rustup std for wasm32, so we drive rustc directly.
# Exports are #[no_mangle] extern "C" + linear memory; JS reads memory without bindgen.
set -e
cd "$(dirname "$0")/.."
TC="${RUST_TC:-1.97.1-aarch64-apple-darwin}"
rustup run "$TC" rustc --edition 2021 --crate-type cdylib -O \
  -C strip=symbols -C panic=abort \
  --target wasm32-unknown-unknown src/lib.rs \
  -o ../PPE-graphics/sim/pocket_physics.wasm
echo "== done: ../PPE-graphics/sim/pocket_physics.wasm"
echo "== exports: pp_init, pp_step(dt,t), pp_hgt(x,z,t), pp_at(x,y,z), pp_set_obstacles(count), pp_mod_ptr"