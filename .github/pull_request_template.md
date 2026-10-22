## What and why

<!-- What this changes, and the reason. Link the issue if there is one. -->

## How it was tested

<!-- The checks you ran, and anything you clicked through by hand in either app. -->

- [ ] Every commit is signed off (`git commit -s`; see [CONTRIBUTING.md](../CONTRIBUTING.md#licensing-your-contribution))
- [ ] `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`
- [ ] `npm run parity` and `npm run types:check` (if JS/Rust mirrors or `#[typeshare]` types changed)
- [ ] `cargo test --workspace` (if `src-tauri/` changed)
- [ ] Xcode tests and an iOS Simulator build (if `native/` or `src-tauri/crates/` changed)
- [ ] `npm run test:layout` (if `src/print/` changed)

## Notes for review

<!-- Anything risky, deliberately left out, or needing a follow-up. Delete if none. -->
