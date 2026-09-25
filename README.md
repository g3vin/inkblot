# Inkblot

Inkblot is a local-first writing app for long-form work. Documents live as files on
your disk; nothing is synced anywhere (see [PRIVACY.md](PRIVACY.md)).

- **Three kinds of document:** prose, infinite canvases (JSON Canvas, compatible with
  Obsidian) and maps with places, routes and journeys on a story timeline. Any two can
  sit side by side in a split.
- **Notes anchored to the text,** with images and voice memos, and a Bubble editor for
  reworking a sentence word by word.
- **Version history** with named versions, side-by-side comparison and restore.
- **A workbench of on-device language tools:** synonyms, rhymes, definitions and parts
  of speech, plus dictation and Read Aloud that run on your machine.
- **References and citations** in APA, MLA, Chicago and more, with sources shared
  across a project.
- **Print Layout:** the document as real pages, printed as shown, imposed for binding,
  and exported to PDF, EPUB, Markdown or HTML, for one document or a whole book.

There are two apps, and they share one editor:

- **The Tauri app** (macOS desktop): the React/TipTap page in `src/`, hosted by Tauri,
  with Rust commands in `src-tauri/`.
- **The Swift app** (macOS, iPadOS, iOS): a SwiftUI shell in `native/` that hosts the
  same built page (`dist/`) in a `WKWebView` and draws the file tree, inspector, toolbar
  and menu bar natively.

Both link the same Rust crates for domain logic and models. How the pieces fit is in
[ARCHITECTURE.md](ARCHITECTURE.md); read it before changing anything that crosses a
boundary.

## Prerequisites

- Node 20+ and npm
- Rust (stable) with `cargo`
- `typeshare-cli` 1.13.4 for the generated types: `cargo install typeshare-cli --version 1.13.4 --locked`
- For the Swift app: Xcode 26 with the macOS 26.4 SDK. For iOS slices:
  `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`

```bash
npm install
```

## Running

**Tauri app**

```bash
npm run tauri dev      # Vite dev server + the Tauri window, with hot reload
npm run tauri build    # a bundled .app
```

**Swift app**

```bash
npm run build                    # the Swift app embeds dist/; it does not build it
./scripts/build-xcframework.sh   # after any change under src-tauri/crates/
open native/inkblot-core/inkblot-core.xcodeproj   # then ⌘R
```

- The **Embed Web Bundle** build phase copies `dist/` into the app and warns when `src/`
  is newer than `dist/`.
- For hot reload inside the Swift app, set `INKBLOT_DEV_URL=http://localhost:5173` in
  the scheme's environment and run `npm run dev`.
- Debug builds send the page's console errors, uncaught errors and a trace of every
  bridge message and Tauri call to the unified log:
  `/usr/bin/log stream --level debug --predicate 'subsystem == "inkblot"'`
  (plain `log` in zsh is a shell builtin).
- The web view is inspectable: Safari ▸ Develop ▸ *your Mac*.
- Both apps use the same data folder, `~/Library/Application Support/com.inkblot.app`.
  Don't run them at the same time.

## Checks

Run these before every commit, and the Swift ones as well when you touch `native/` or
`src-tauri/crates/`. Each catches failures the others can't. CI
(`.github/workflows/ci.yml`) runs all of them except the Swift ones and
`npm run test:layout`.

| Command | What it checks | What only it catches |
|---|---|---|
| `npm test` | 28 suites under `tests/unit/`, in jsdom, mounting real components | A component that throws on every render: lint, tsc and the build all pass on it |
| `npm run lint` | ESLint, including the React Compiler rules. The bar is 0 errors and 0 warnings | A ref written during render |
| `npm run typecheck` | `tsc --noEmit` over the TypeScript | |
| `npm run build` | The Vite production build | Bad dynamic imports, and named imports a module does not export |
| `npm run parity` | One corpus (about 17,000 cases) through both the JS and the Rust implementation of every mirrored function | Float, rounding and string-semantics drift between JS and Rust |
| `npm run types:check` | The generated TypeScript and Swift types are current, and the Swift typechecks | A Rust type change that was never regenerated |
| `npm run test:layout` | Print Layout in real WebKit (needs `playwright-core` and its WebKit; see `tests/layout/run.mjs`) | Page breaks that differ between jsdom and a real browser |
| `cd src-tauri && cargo build --workspace && cargo test --workspace` | The Rust crates and their tests | Linker errors: `cargo check` does not link |

For the Swift app:

```bash
xcodebuild test -project native/inkblot-core/inkblot-core.xcodeproj -scheme inkblot-core \
  -destination 'platform=macOS,arch=arm64' -only-testing:inkblot-coreTests
xcodebuild build -project native/inkblot-core/inkblot-core.xcodeproj -scheme inkblot-core \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO
```

The one ignored Rust test runs the rhyme index against the real pronouncing
dictionary: `INKBLOT_CMUDICT=/path/to/cmudict.dict cargo test -p inkblot-models -- --ignored`.

## Repository layout

| Path | What it is |
|---|---|
| `src/` | The page: React components, TipTap extensions, the canvas, the bridge client |
| `src-tauri/src/` | The Tauri app: command registration and thin wrappers |
| `src-tauri/crates/inkblot-core/` | Domain logic, persistence, search, version history, the bridge protocol |
| `src-tauri/crates/inkblot-models/` | On-device models: synonyms, rhymes, Kokoro speech, dictation |
| `src-tauri/crates/inkblot-ffi/` | `inkblot-core` and `inkblot-models` exposed to Swift through UniFFI |
| `native/inkblot-core/` | The Swift app (the Xcode project, target and module are all named `inkblot-core`) |
| `tests/unit/` | The jsdom suites (`npm test`) |
| `tests/parity/` | The JS/Rust differential harness (`npm run parity`) |
| `tests/layout/` | Print Layout in real WebKit (`npm run test:layout`) |
| `scripts/` | Type generation and the XCFramework build |

## Contributing

Branch naming, commit messages and the pull request flow are in
[CONTRIBUTING.md](CONTRIBUTING.md). Notable changes are recorded in
[CHANGELOG.md](CHANGELOG.md).

## License

Copyright (c) 2026 Gavin Bowden. All rights reserved. Inkblot is proprietary software;
see [LICENSE](LICENSE).
