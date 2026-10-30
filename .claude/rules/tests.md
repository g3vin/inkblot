---
paths:
  - "tests/**"
---

# Tests

- `npm run affected` prints the suites a diff reaches (through imports, plus the suites
  that scan the tree). Run those rather than guessing.
- `npm test` prints only failures and a summary. `npm test -- <suite> [<suite>…]` runs
  some suites. `--verbose` prints every PASS line.
- A new suite is `tests/unit/<name>.mjs` using `ok` from `assert.mjs`, added to `SUITES`
  in `tests/unit/run.mjs`. Read that file's header for what each suite covers and what
  jsdom cannot.
- Mount real components under StrictMode, with stable callback props. A fresh identity
  per render can turn a load effect into an infinite loop that hangs the run.
- `@tauri-apps/*` are stubbed by `stub-*.mjs` with an in-memory filesystem, so the real
  `FileSystem.js` runs. Extend the stubs rather than mocking app modules.
- Parity cases are in `tests/parity/cases/`. Break the Rust side once to prove a new case can fail.
