---
paths:
  - "src-tauri/**"
---

# Rust work

- `inkblot-core` is domain logic with no UI knowledge. `inkblot-models` holds the on-device
  models. `src-tauri/src/*_commands.rs` are thin `#[tauri::command]` wrappers. Logic goes in
  a crate, never in a wrapper.
- A `#[typeshare]` type changed: run `npm run types`. Never edit `src/types/inkblot-core.ts`
  by hand. The typeshare limits are in ARCHITECTURE.md → Recipes → A domain type.
- A mirrored module changed (its JS file has a `Mirrors:` line; table in ARCHITECTURE.md →
  "JavaScript and Rust parity", which also lists the float, rounding and string pitfalls):
  change both sides and run `npm run parity`.
- Checks: `npm run check:rust` (fmt, clippy -D warnings, cargo test, parity, types:check).
  For a quick loop, run `cargo test -p inkblot-core <filter>` from `src-tauri/`.
