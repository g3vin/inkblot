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

Inkblot is a Tauri app: the React/TipTap page in `src/` draws all of it — the editor,
the file tree, the inspector, the toolbar — and the Rust crates in `src-tauri/` hold
the domain logic, persistence and on-device models. How the pieces fit is in
[ARCHITECTURE.md](ARCHITECTURE.md); read it before changing anything that crosses a
boundary.

## Prerequisites

- Node 20+ and npm
- Rust (stable) with `cargo`
- `typeshare-cli` 1.13.4 for the generated types: `cargo install typeshare-cli --version 1.13.4 --locked`

```bash
npm install
```

## Running

```bash
npm run tauri dev      # Vite dev server + the Tauri window, with hot reload
npm run tauri build    # a bundled .app
```

The app keeps its data in `~/Library/Application Support/com.inkblot.app`.

## Where to start

Read [ARCHITECTURE.md](ARCHITECTURE.md) first, then these, in order:

1. `src/main.jsx`: the entry point, and why preferences load before the first render.
2. `src/components/Editor.jsx`: the open project's state (documents, panes, notes)
   and what it hands to `EditorLayout`.
3. `src/bridge/surface.ts`: how the chrome and the documents talk, from the page's side.
   The protocol itself is in `src-tauri/crates/inkblot-core/src/bridge/mod.rs`.
4. `src/lib/FileSystem.js`: how documents are read and written.
5. `src-tauri/src/lib.rs`: every Tauri command the page can call.

Where to look for common tasks:

| To… | Look in |
|---|---|
| Add a toolbar button | `src/lib/chromeLayout.ts`, `src/components/toolbar/registry.jsx` |
| Add a ⌘K command | `useCommands` in `src/lib/commands.ts` |
| Build or restyle UI | `src/ui/`, `src/styles/tokens.css`, [docs/DESIGN.md](docs/DESIGN.md) |
| Change an editor feature | `src/extensions/` (TipTap extensions and node views) |
| Change canvases, maps, timelines, print | `src/canvas/`, `src/map/` + `src/lib/map/`, `src/timeline/` + `src/lib/timeline/`, `src/print/` |
| Add a Rust command | `src-tauri/src/*_commands.rs`, logic in `src-tauri/crates/` |
| Add a test | the header of `tests/unit/run.mjs` |

Step-by-step recipes for each are in [ARCHITECTURE.md → Recipes](ARCHITECTURE.md#recipes).

## Checks

Run these before every commit. Each catches failures the others can't. CI
(`.github/workflows/ci.yml`) runs all of them except `npm run test:layout`.

| Command | What it checks | What only it catches |
|---|---|---|
| `npm test` | The suites under `tests/unit/`, in jsdom, mounting real components | A component that throws on every render: lint, tsc and the build all pass on it |
| `npm run lint` | ESLint, including the React Compiler rules. The bar is 0 errors and 0 warnings | A ref written during render |
| `npm run lint:design` | No new raw colours, fonts, radii or shadows outside `src/styles/tokens.css` (a per-file ratchet; see [docs/DESIGN.md](docs/DESIGN.md#14-guardrails)) | A hard-coded hex that ignores the theme |
| `npm run typecheck` | `tsc --noEmit` over the TypeScript | |
| `npm run build` | The Vite production build | Bad dynamic imports, and named imports a module does not export |
| `npm run parity` | One corpus (about 19,000 cases) through both the JS and the Rust implementation of every mirrored function | Float, rounding and string-semantics drift between JS and Rust |
| `npm run types:check` | The generated TypeScript types are current | A Rust type change that was never regenerated |
| `npm run test:layout` | Print Layout in real WebKit (needs `playwright-core` and its WebKit; see `tests/layout/run.mjs`) | Page breaks that differ between jsdom and a real browser |
| `cd src-tauri && cargo build --workspace && cargo test --workspace` | The Rust crates and their tests | Linker errors: `cargo check` does not link |

The one ignored Rust test runs the rhyme index against the real pronouncing
dictionary: `INKBLOT_CMUDICT=/path/to/cmudict.dict cargo test -p inkblot-models -- --ignored`.

## Repository layout

| Path | What it is |
|---|---|
| `src/` | The app: React components, TipTap extensions, the canvas, the bridge |
| `src-tauri/src/` | The Tauri app: command registration and thin wrappers |
| `src-tauri/crates/inkblot-core/` | Domain logic, persistence, search, version history, the bridge protocol |
| `src-tauri/crates/inkblot-models/` | On-device models: synonyms, rhymes, Kokoro speech, dictation |
| `tests/unit/` | The jsdom suites (`npm test`) |
| `tests/parity/` | The JS/Rust differential harness (`npm run parity`) |
| `tests/layout/` | Print Layout in real WebKit (`npm run test:layout`) |
| `scripts/` | Type generation, the pronouncing dictionaries (`npm run lexicon`) |

## Contributing

Branch naming, commit messages and the pull request flow are in
[CONTRIBUTING.md](CONTRIBUTING.md). Notable changes are recorded in
[CHANGELOG.md](CHANGELOG.md). To report a security problem, follow
[SECURITY.md](SECURITY.md) rather than opening an issue.

## License

Inkblot is open source under the [Apache License 2.0](LICENSE). Copyright 2026 Gavin
Bowden and contributors (see [NOTICE](NOTICE)).

The Inkblot name, the ib monogram, the wordmark and the app icon are trademarks and
aren't covered by the licence. If you distribute a modified version, give it its own
name and icon; [TRADEMARKS.md](TRADEMARKS.md) has the details.
