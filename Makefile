# Pocket Planes Expedition — build orchestration.
# WASM core: rustc -> wasm32-unknown-unknown (Homebrew cargo does not see rustup std,
# so the wasm build drives rustc via rustup run; override with RUST_TC=<toolchain>).

RUST_TC ?= 1.97.1-aarch64-apple-darwin
PORT    ?= 5173

.PHONY: all wasm test test-rust lint build dev serve clean help

all: wasm build

## wasm — rebuild the Rust physics core into PPE-graphics/sim/pocket_physics.wasm
wasm:
	cd PPE-physics && RUST_TC=$(RUST_TC) bash scripts/build.sh

## test — all JS test layers (golden, integration, human-model, units, smoke)
test:
	npm test
	node test/integration.mjs
	node test/human-model.mjs
	node test/human-units.mjs
	node test/smoke.mjs

## test-rust — cargo golden tests (incl. bit-for-bit vs tests/golden.json)
test-rust:
	cd PPE-physics && cargo test

## lint — eslint (JS) + cargo fmt --check + clippy (Rust)
lint:
	npx eslint PPE-graphics test
	cd PPE-physics && cargo fmt --check && cargo clippy --all-targets -- -D warnings

## build — production bundle into PPE-server/dist/
build: wasm
	npm run build

## dev — dev server with HMR on $(PORT)
dev:
	npx vite --port $(PORT) --strictPort

## serve — serve the production build
serve:
	npm run preview

## clean — remove build artifacts
clean:
	rm -rf PPE-server/dist PPE-physics/target

help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## //'
