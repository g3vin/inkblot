# Inkblot — Migration Handoff

State of the hybrid-native migration, what each remaining phase involves, and the things that cost time to discover the first time.

**Current branch:** `phase-0-foundations`, 20 commits ahead of `main` (`b7ceed8`).
`main` is untouched — if you want these on main, `git checkout main && git merge --ff-only phase-0-foundations`.

**Size today:** 33,803 JS/JSX · 8,984 CSS · 1,462 Rust.

---

## The gates

Run all five after every change. They are fast and they have each caught something
the others missed.

```bash
npm test          # 315 assertions, 13 suites
npm run lint      # 0 errors AND 0 warnings is the current bar
npm run typecheck # tsc --noEmit
npm run build     # the only thing that resolves dynamic imports and named exports
(cd src-tauri && cargo build --workspace)
```

**They are not redundant.** Concrete cases from this work:

| Broke | Caught only by |
|---|---|
| Slice ended mid-JSDoc, silently commenting out `getVersions` | build + `m0` suite (lint and tsc both passed) |
| `await import('../lib/openPinterest')` after moving a file deeper | build only |
| A named import the module did not export | build only |
| Linker failure from a stale clang path | `cargo build` only — `cargo check` does not link |

---

## Where things stand

### Phase 0 — done (`39c3776`)

Test harness surfaced and repaired, TypeScript toolchain installed, synonym model
moved to first-run download, dictation path resolution moved into Rust, Cargo
workspace split with `crates/inkblot-core`.

**Still owed:** launch the bundled `.app` from `/Applications` — *not* `npm run dev` —
**with the network off**, and confirm (a) the synonym tile loads from
`<AppData>/models/` without reaching HuggingFace and (b) dictation resolves its
model. No build gate can prove either.

### Phase 1 — done except three items

Eleven oversized files split. `Editor.css` 5,620 → 39. `useEditorContextMenu.js`
904 → 61. Full table in `~/.claude/plans/` or `git log`.

**Not done, deliberately:**

1. **`EditorCanvas.jsx` autosave + version checkpoints.** Nothing in the test suite
   mounts this component, and a subtle break loses the user's writing *silently*,
   possibly days later. Write a suite that mounts it first (copy the pattern from
   `scripts/canvas-tests/dom.mjs`), or do a manual save/restore/version pass.
   Its editor-state cache is also interleaved with autosave refs rather than
   contiguous — it needs five separate slices, not one.
2. **`PinterestBoard.js` preview-fetch state machine** (~330 lines). Reassigns
   `currentUrl` and `expanded` in the node view closure, so it needs setter
   callbacks, not parameters. Also the least verifiable feature in the app.
3. **`FileTree.jsx` `renderNode`** (~160 lines, recursive). Becoming a component
   means a 20+ prop list. Decide whether that is actually better.

---

## Phase 2 — Rust core

Move non-UI domain logic into `src-tauri/crates/inkblot-core`, which exists and
builds a `staticlib` (verified: `libinkblot_core.a` is produced — that is the
artifact a Swift shell links).

### Do this first: domain types

Define them once in Rust and generate TypeScript **and** Swift with
[`typeshare`](https://github.com/1Password/typeshare). This is the keystone of the
whole migration — it is what stops three languages drifting. Dependency order:

```
Viewport, Rect, EdgeSide
  → CanvasNode, CanvasEdge, CanvasState, CanvasFile
  → NoteImage, AudioClip, Note
  → VersionEntry → TreeNode → TextDocument
```

Two subtleties to encode:
- **A note node is a `file` node carrying an extra `inkblotNoteId`** (`canvasModel.js:95-104`
  explains why: the document stays the single source of truth).
- **`normalizeNote` spreads unknown keys** (`noteUtils.js:107`). Decide explicitly
  whether to preserve or drop them — an index signature or a documented drop.

### Move order (each has existing test coverage where noted)

| # | Module | Notes |
|---|---|---|
| 1 | `docKind.js` (37 lines, 0 imports) | imported by 14 files; `getDocKind` returns a literal union |
| 2 | `canvasGeometry.js` (259, 0 imports) | pure float math — covered by `geo.mjs` |
| 3 | `canvasModel.js` + `storyStructure.js` | covered by `red.mjs`, `group.mjs`, `m0.mjs` |
| 4 | `versionHistory.js` diff engine (`:96-340`) | LCS over a `Uint32Array` DP table. Highest-value CPU move. Leave `htmlToBlocks` (`DOMParser`) and the `toLocaleString` formatters in JS |
| 5 | `FileSystem.js` + `projectPaths.js` + `docLock.js` + `versionStore.js` | biggest win. `withDocLock` becomes a real `Mutex` and gets *more* correct. Replace the `versions:changed` DOM CustomEvent with a Tauri event |
| 6 | `sidebarSearch.js` matcher + JSON walk + `canvasSearch.js` | **caveat:** Rust's `regex` has no backreferences or lookaround. `useRegex` mode needs `fancy-regex` or a documented behaviour change |
| 7 | `readAloud.js` chunker (`:426-627`), `noteUtils`/`audioNotes` normalizers | pure string/offset logic |

For #4, add a **differential test**: run the JS and Rust diff engines over the same
corpus of real documents and assert identical chunk output *before* deleting the JS.

### Move `localStorage` to disk — non-negotiable

A native shell cannot see any of this. Every key currently in use:

```
inkblot-session                     open tabs, panes, split ratio, active doc
inkblot-clipboard-history           clipboard panel entries (max 80)
inkblot-order:<project>             file tree sort order
inkblot-expanded:<project>          file tree expansion state
inkblot-theme, inkblot-accent-color
inkblot-show-word-count-badge
inkblot-focus-mode-settings
inkblot.canvas.snap                 snap/guide preferences
inkblot.search.recent               recent searches
inkblot.fonts.pinned, .recent
inkblot:read-aloud-voice
inkblot:pinterest-preview:<url>     scraped pin cache
inkblot:pinterest-project-refresh:  per-project-open refresh flag (sessionStorage)
inkblot:project-open-id             (sessionStorage)
```

Concentrated in `lib/fileTreeState.js` (9 sites), `App.jsx` (8), `lib/editorSession.js`,
`lib/pinterestBoard.js`, `extensions/pinterestCache.js`. Phase 1 deliberately moved
the file-tree and Pinterest ones into files *named after the concern*, so they are
easy to find. Note `.inkblot-order.json` is already reserved as a filename in
`FileSystem.js` but never written.

### Replace Kokoro's Python dependency — this blocks iOS

`kokoro_commands.rs:47` spawns a **long-lived Python child process**, with
`python_candidates()` probing anaconda/homebrew/system Python, and requires the user
to have run `pip install 'kokoro>=0.9.4' soundfile misaki[en]`. Consequences:

- Read Aloud works on the original dev machine and silently falls back to WASM elsewhere
- **Subprocesses are impossible on iOS/iPadOS**, so this blocks two of the three new targets

`ort` and `ndarray` are already dependencies. Port it to pure-Rust ONNX. Once native
TTS is reliable, drop the `kokoro-js` WASM fallback — that also deletes the
`window.fetch`/`window.caches` monkey-patches at `readAloud.js:366-410` and the
`onnxruntime-web` dependency.

**Acceptance test: Read Aloud works on a machine with no Python installed.**

### Rewrite the Pinterest return channel

`eval_webview` discards its result (`main.rs`: `webview.eval(script)` returns
`Result<(), String>`). So the injected script smuggles data out through
`location.hash` while JS polls `get_webview_url` **every 220ms**
(`pinterestScrape.js:137`). Give Rust a real IPC handler and return
`Vec<ScrapedPin>` directly. That deletes the hash protocol, the poller, the
progress-payload dance, and the `new Function` syntax pre-check.

In a Swift shell this collapses further: `WKUserContentController` gives a real
message handler and `evaluateJavaScript(completionHandler:)` a real return value.

---

## Phase 3 — TypeScript (runs alongside Phase 2)

Scoped deliberately: **bridge and domain layers, not components.**

- `typeshare` output lands as generated types — do not hand-write these
- Hand-convert the pure modules in the Phase 2 order. Phase 1 created several
  ready-made candidates: `lib/fileTreeOrder.js`, `lib/editorSession.js`,
  `lib/notePreviewGeometry.js`, `extensions/conversationModel.js`,
  `lib/projectPaths.js`, `lib/docLock.js` — all pure, no React, no I/O
- `canvasReducer.js` (285) is a textbook discriminated-union win, covered by `red.mjs`
- Type the bridge client (Phase 4) fully — this is where TS earns the most

`tsconfig.json` is already set to `allowJs: true, checkJs: false, strict: true`, so
conversion is file-by-file with no big-bang.

**Not converting:** `components/`, node views, anything touching a live TipTap instance.

---

## Phase 4 — Bridge protocol — *the phase that decides whether this works*

Define the protocol in Rust, then **refactor the existing React shell onto it while
everything is still in one process.** This proves the protocol, keeps the app
shippable, and means the Swift shell is built against a contract with a working
reference implementation. Skipping this is how the port becomes a rewrite.

**Native → webview:** `applyMark`, `setColor`, `setHighlight`, `setFontFamily`,
`setFontSize`, `setAlignment`, `insertTable`, `insertConversationTile`,
`openDocument`, `setSelection`, `jumpToAnchor`, `setContent`, `replaceRanges`,
`setCaretAtDocPos`, `dictationPartial/Final/Cancel`, `syncNotes`, `canvasCommand`,
`canvasDropDoc`, `canvasDropNote`, `canvasReveal`, `canvasRestore`.

**Webview → native:** `toolbarState`, `selectionContext`, `docChanged`,
`notesRemapped`, `noteMarkerHover/leave/pin`, `activeEditorChanged`, `searchMatches`,
`focusModeView`, `readAloudPayload`, drag hand-off.

### The five sharp edges

1. **`Toolbar.jsx` inverts from pull to push.** `readToolbarState()` (`:102-145`)
   synchronously reads ~10 selection facts per `selectionUpdate`. The webview must
   emit a `ToolbarState` struct instead. It also mutates
   `editor.storage.lastHighlightColor` (`:240`) and reads it back in
   `contextMenu/editorMenu.js` — shared mutable state across the seam; move it into
   the protocol.

2. **`DictationControl.replaceInlineDraft`** is read-modify-write **at speaking
   rate**: it reads the draft range, diffs prefix/suffix, and dispatches text +
   decoration in one transaction. Round-tripping each partial would race whisper.
   The whole draft state machine stays in the webview; native sends only
   `onPartial/onFinal/onLevel`.

3. **ProseMirror positions are the currency, and every edit invalidates them.**
   Anything native holds — notes, workbench tiles, search results, read-aloud words —
   must be re-pushed after each remap or re-resolved by anchor text. Two places
   already do the anchor-fallback dance (`EditorLayout.jsx:291-304`,
   `Workbench.jsx:40-64`); make that the standard.

4. **`notesRemapped` fires on every transaction** (`EditorCanvas.jsx`, note anchor
   remapping). Batch it or it saturates the bridge.

5. **`activeEditor` election is driven by mouse movement** over a pane, and has a
   third state — a canvas card being double-click edited, tagged
   `editor.__inkblotCanvasCard`. Decide how that resolves across a process boundary.

Also in this phase: delete the `window.__inkblot_*` globals
(`__inkblot_draggedEditorSelection`, `__inkblot_draggedClipboardEntry`,
`__inkblot_dragPoint`, `__inkblot_dropHandled`, `__inkblot_forcePlainPaste`,
`__inkblotProjectOpenId`, `__inkblotProjectName`). They cannot survive a process
boundary.

---

## Phase 5 — Swift shell (macOS 26+)

Xcode project; `inkblot-core` as an XCFramework via UniFFI; `WKWebView` hosting the
built editor bundle with `WKUserContentController` for the bridge.

**Goes native immediately — zero editor coupling today:** `LeftSidebar`, `FileTree`,
`TabDock`, `ClipboardPanel`, `NotesPanel`, `NoteCard`, `SidebarTabs`, `AudioNotes`
(→ AVFoundation), `DraftTabPane`, `Bubble`, the theme/accent/menu layer,
`useResizableSidebar`.

**Deleted, not ported:**
- `EditorLayout.jsx:128-224` — a JS reimplementation of macOS titlebar chrome
- `RightSidebar.jsx:415-636` — ~450 lines reverse-engineering WebKit's private
  `webkitMomentumPhase` to fake trackpad momentum

`NSScrollView` and real window chrome give both for free.

**Mechanical async, semantics intact:** `HistoryPanel.handleRestore` (already async
and busy-gated), `VersionComparePane` (its toolbar portal becomes native titlebar
content — *simpler*), `Workbench.selectTileWord/replaceWord`, `jumpToText`, the
context menu (already async for the Tauri menu import; needs a `getSelectionContext()`
call before building).

**Stays in the webview:** the whole document surface, `FocusModeOverlay` (re-derives
from the full doc on every transaction — pushing that per keystroke is the cost to
watch), `ReadAloudControl`'s highlight scheduler (position mapping cannot cross the
boundary; only audio generation/playback goes native).

**`NoteHoverPreview` is the one honest casualty.** It needs
`marker.getBoundingClientRect()` from inside the document, re-queried on every scroll
and resize, to draw SVG strings from floating cards to in-document text — and
`NoteAnnotation.js:155` ships a live `EditorView` object in its event payload. Either
keep previews inside the webview (recommended) or accept a frame of lag.

Liquid Glass via `.glassEffect()` / `GlassEffectContainer`, no fallback path.

---

## Phase 6 — iPadOS / iOS

Same Swift view layer with platform-conditional chrome, same core, same editor
bundle. Unblocked by Phase 2's Kokoro work. New work: touch and Pencil interaction
on the canvas, and a native keyboard accessory replacing the toolbar.

---

## Things that will bite you

### Refactoring technique

- **Derive extracted text from actual output, not source**, for anything inside a
  template literal. `\S` inside a template literal collapses to `S` — the source and
  the emitted string are *not the same program*. This is how the Pinterest DOM
  scraper shipped as invalid JavaScript and was never noticed.
- **Assert every slice brace-balanced and comment-balanced before writing it.**
  Line-range slicing breaks silently on comments. One cut ended mid-JSDoc, leaving an
  unterminated `/**` that commented out an exported function — lint *and* tsc both
  passed. This check then caught three more bad boundaries.
- **Check for closure writes before extracting.** If a region reassigns `let`s
  declared outside it, parameters will break silently (reassigning a destructured
  binding does not propagate). Move that state *into* the extracted module and make
  it a factory. `extensions/conversationMessageDrag.js` is the worked example.
- **Pass mutable closure state as an accessor, not a value.** Same file:
  `getAttrs()` rather than `currentAttrs`, because the node view replaces its
  attribute object on every commit.
- **Extracting `useState` setters or `useRef`s into hook parameters trips the React
  Compiler** (`react-hooks/preserve-manual-memoization`). It could see they were
  stable inside the component and cannot across a hook boundary. Adding them to the
  dependency array is a runtime no-op — setter and ref identities never change.
  The error message names the inferred dependency, so this is scriptable.

### Verification recipes that actually proved things

- **CSS refactors:** build, `shasum` the emitted bundle, compare. A byte-identical
  bundle makes a visual diff impossible. When rules legitimately move, parse the
  minified CSS into top-level rules, sort, and compare sets — identical sets plus
  differing positions proves reordering only.
- **Code-generating functions:** evaluate the old and new versions with identical
  inputs and diff the strings.
- **Module splits:** compare the *set of exports* before and after.
- **Mechanical moves:** count the constructs (`MenuItem.new`, `items.push`, …) on
  both sides.

### Build and environment

- `.cargo/config.toml` used to hardcode a clang **17** path; installed toolchains are
  clang **21**. It is now empty with an explanation — do not reintroduce a pinned path.
- `ort-sys` caches its build-script output including linker search paths. If linking
  fails after a toolchain change: `cargo clean -p ort-sys`.
- `cargo check` does **not** link, so it cannot catch linker errors. The `[lib]`
  target (`staticlib`/`cdylib`) is what a Swift shell links, and it is what surfaces
  them — build the workspace, not just check it.

### The test suite

`scripts/canvas-tests/` — 13 suites, custom Node ESM loader, jsdom, in-memory fs
stubs. The **real** `FileSystem.js`/`assets.js` run against the stubs rather than
being reimplemented, which is why it catches real persistence bugs.

- `loader.mjs` maps `@tauri-apps/*` and `lodash` to stubs, resolves extensionless
  imports, and transpiles `.jsx` with esbuild
- `dom.mjs` mounts the real `CanvasSurface` under **StrictMode** — which
  double-invokes effect setup/teardown, the case that catches cleanup bugs
- `run.mjs` resets `process.exitCode` per suite and catches throws, so one broken
  suite cannot hide the rest. It could before, and did: four suites sat unrun behind
  one stale assertion.

**Covered:** canvas geometry/reducer/groups/snapping/search, document persistence,
notes, audio, `generateHTML` rendering, `CanvasSurface` mounting.

**Not covered, and these are where Phase 1 moved the most code:** the context menu,
session restore, file-tree drag, note previews, Pinterest embeds, editor paste/drag,
and everything in `EditorCanvas.jsx`. Adding a mounting suite for `EditorCanvas`
would unblock the riskiest remaining refactor.

### Known broken / dead weight

- **`RhymeTile` does not work.** It loads `/rhyme_model.onnx` and `/vocab.json`;
  neither exists and nothing downloads them. Best fixed by moving rhyme inference
  into Rust — which already has `ort` and `tokenizers`.
- **`public/ort/` is 109 MB** of ~20 onnxruntime-web variants (webgpu, webgl, node…)
  when `vite.config.js` aliases only `ort.wasm.min.mjs`. That is most of the
  remaining `dist/` bulk, and moving rhymes to Rust would delete the dependency
  entirely.
- **`.history-tile` / `.history-tile-header` are declared at equal specificity** in
  both `components/Editor.historyPanel.css` and
  `components/RightSidebar/HistoryPanel.css`. Load order decides the winner. Merging
  them is a behaviour change, not a refactor — do it deliberately.
- **`Editor.css` is an ordered `@import` manifest and the order is load-bearing.**
  Several selectors are declared in more than one place (`.toolbar-group` across
  Toolbar/Canvas/VersionComparePane, `.ProseMirror` and `.pane` across Editor and
  Canvas). Do not rearrange it, and do not move a section's import to its component —
  that changes where the rules land in the cascade.

### Data model facts worth not rediscovering

- **The canvas is a document *kind*, not a view mode** — routing is purely by the
  `.canvas` path suffix (`docKind.js`). A canvas occupies the same pane a text
  document would, so split view can show a canvas beside prose.
- **A canvas hosts at most one live TipTap instance at a time** (`editingNodeId`).
  Non-editing cards are static HTML from `generateHTML`.
- **Text versions store both HTML and ProseMirror JSON** — HTML for diffing and
  preview, JSON for restore.
- **Version retention:** cap of 200 *unnamed* entries evicted oldest-first; **named
  versions are never evicted**.
- **Two version stores:** text documents embed `versions` in their own file; canvases
  use a `.versions/` sidecar, because a canvas file must stay spec-shaped JSON Canvas
  (it round-trips with Obsidian). The sidecar is also the legacy fallback for old
  text documents.
- **Images take two different paths:** canvas images and voice memos are
  content-addressed in `.assets/<sha256[0..20]>.<ext>`; note images and pasted editor
  images are **base64 data-URIs inlined in the document JSON**. A native shell must
  handle both.
- **A project can live anywhere on disk.** `projectLocations.js` maps project name →
  absolute path; everything resolves through `getProjectRoot` before touching the
  filesystem.
