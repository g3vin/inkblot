---
paths:
  - "src/**"
  - "src-tauri/src/**"
  - "src-tauri/crates/**"
  - "tests/unit/**"
---

# Keep files small

A source file stays under **700 lines**; aim for under 500 when you write a new one.
`npm run lint:size` enforces it (in `npm run check` and CI), and the post-edit hook
reports the moment an edit crosses it. The files already larger are in
`scripts/size-baseline.json`: they may shrink, never grow. When a change would grow
one, split something out of it first, in its own commit, then make the change.
Don't raise a baseline to make room.

How to split without changing behaviour (one commit per file, then the suites
`npm run affected` prints):

- **A React component**: move a group of state, effects and callbacks that belong
  together into a custom hook (`src/hooks/useX.js`, or beside the component), and call
  it exactly where the moved effects were, so effect order and listener registration
  order stay the same. Copy dependency arrays and `eslint-disable` lines unchanged.
  Destructure what the hook returns at once. A ref or setter passed in can join a
  dependency array (it is stable); a fresh object can't (pass its stable parts).
- **Pure logic** (geometry, layout, parsing): a function in `src/lib/`, with a test in
  the suite that covers that module.
- **Too tangled**: if a hook would need more than 8 inputs, or would have to share
  mutable closure state, leave that part and add section markers
  (`/* ---------------- name ---------------- */`) so it can be read by part.
- **Rust**: inline `mod tests { … }` → `mod tests;` in its own file; a large module →
  a directory (`x/mod.rs` plus child modules, re-exported with `pub use` so paths don't
  change); one big `impl` → `impl` blocks in child modules, cross-file helpers
  `pub(super)`. typeshare finds types in new files; `npm run types:check` confirms.
- Every new file opens with a header comment saying what it owns. Update a `Mirrors:`
  line, the ARCHITECTURE.md parity table, and any doc or skill that named the old path.
