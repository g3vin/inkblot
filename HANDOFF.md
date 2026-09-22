# Inkblot — Migration Handoff

State of the hybrid-native migration, what each remaining phase involves, and the things that cost time to discover the first time.

**Current branch:** `phase-0-foundations`, 37 commits ahead of `main` (`b7ceed8`).
`main` is untouched — if you want these on main, `git checkout main && git merge --ff-only phase-0-foundations`.

**Size today:** 34,704 JS/JSX · 8,984 CSS · 9,524 Rust.

---

## The gates

Run all seven after every change. They are fast and they have each caught something
the others missed.

```bash
npm test            # 434 assertions, 17 suites
npm run lint        # 0 errors AND 0 warnings is the current bar
npm run typecheck   # tsc --noEmit
npm run build       # the only thing that resolves dynamic imports and named exports
npm run parity      # 15,915 cases through BOTH the JS and the Rust implementation
npm run types:check # fails if the generated TS/Swift is stale, and typechecks the Swift
(cd src-tauri && cargo build --workspace && cargo test --workspace)   # 103 tests
```

`parity` and `types:check` arrived with Phase 2 and need `cargo` and
`cargo install typeshare-cli --locked` on PATH. Both are load-bearing rather than
tidy: see the table below.

**They are not redundant.** Concrete cases from this work:

| Broke | Caught only by |
|---|---|
| Slice ended mid-JSDoc, silently commenting out `getVersions` | build + `m0` suite (lint and tsc both passed) |
| `await import('../lib/openPinterest')` after moving a file deeper | build only |
| A named import the module did not export | build only |
| Linker failure from a stale clang path | `cargo build` only — `cargo check` does not link |
| `useEditorDnd({ editor })` read in its temporal dead zone — EditorCanvas threw on **every** mount | the `editor` suite only. Lint, tsc *and* build all passed; nothing mounted the component |
| serde_json's float parser off by 1 ULP — every canvas coordinate shifting in its last bit on every load | `parity` only (785 of 6,044 numbers) |
| Rust and JS breaking exact float ties in opposite directions | `parity` only |
| `Math.hypot` ≠ `f64::hypot`, changing an emitted SVG path string | `parity` only |
| A query of only a byte order mark counted as a search, not as an empty one | `parity` only |
| `pinned: "yes"` read as not pinned, because `as_bool()` is not `Boolean()` | `parity` only |

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

### Phase 1 — done

Fourteen oversized files split. `Editor.css` 5,620 → 39. `useEditorContextMenu.js`
904 → 61. Full table in `~/.claude/plans/` or `git log`.

The last three items, the ones held back as too risky to do blind:

1. **`EditorCanvas.jsx`** 1,209 → 740, as five hooks: `useEditorDocCache` (what each
   pane holds and whether it is mid-swap), `useEditorDocLoader`, `useEditorAutosave`,
   `useEditorWordCount`, `useEditorNotes`.

   `scripts/canvas-tests/editor.mjs` went in first and **found a live crash**:
   `useEditorDnd` was handed the `editor` binding forty lines before its own
   `const editor = useEditor()`, so every mount threw. Both editor bindings are now
   passed as accessors. Worth internalising — lint, tsc and the production build all
   passed on a component that could not mount. If a component is not mounted by a
   test, nothing you can run knows whether it works.

2. **`PinterestBoard.js`** 1,028 → 358, as `pinterestBoardPreview.js` (the four-route
   fetch: cache → pidgets JSON → pinit.js embed → session scrape, with
   `refreshRunId`/`inFlightForUrl` keeping concurrent attempts apart) and
   `pinterestBoardCollapse.js`. Factories, not modules of functions, for the reason
   this file predicted: the node view reassigns `currentUrl`, `expanded` and
   `showingCachedPreview` from half a dozen callbacks. Verified by comparing
   normalized line multisets across the three files — every difference is a dead
   import dropped, a call requalified, or a seam added.

3. **`FileTree.jsx` `renderNode` — decided: not a component.** It reads two dozen
   values out of its closure and nearly all of them are plumbing for the markup and
   the handlers, not for the decisions; a `<FileNode>` would be a two-dozen-prop
   interface that moved nothing hard. The cut went the other way: the ~20 derived
   constants are now `lib/fileTreeNodeState.js`, pure and testable, and the JSX
   stayed put. `tree.mjs` is the first coverage FileTree has ever had.

---

## Phase 2 — Rust core — done

Non-UI domain logic now lives in `src-tauri/crates/inkblot-core`, which builds a
`staticlib` (verified: `libinkblot_core.a` is produced — that is the artifact a Swift
shell links).

**Two things are owed and cannot be checked from here**, both flagged in their sections
below: Read Aloud on a machine with no Python, and a Pinterest scrape against a live
logged-in session.

### Domain types — done

Defined in `crates/inkblot-core/src/types/`, generated into TypeScript and Swift by
`./scripts/generate-types.sh` (`npm run types`). The generated files —
`src/types/inkblot-core.ts` and `crates/inkblot-core/generated/InkblotCore.swift` —
are never hand-edited; `npm run types:check` regenerates into a temp dir and diffs,
so a stale one fails rather than rots. It also runs `swiftc -typecheck` over the
Swift against a stub `AnyCodable` — otherwise nothing would look at that file until
the Phase 5 Xcode target exists, which is much too late to find out that a Rust type
generates something Swift will not accept. Skipped where `swiftc` is absent.

Declared in dependency order:

```
Viewport, Rect, Point, EdgeSide
  → CanvasNode, CanvasEdge, CanvasState, CanvasFile
  → NoteImage, AudioClip, Note
  → VersionEntry → TreeNode → TextDocument
  → DiffOp, HtmlBlock, DiffChunk, CanvasDiff   (the diff engine's results)
```

Both subtleties are encoded. A note node is a `file` node with an extra
`inkblotNoteId`, documented on the type. **Unknown keys are preserved, not dropped**
— canvas nodes, canvas edges and notes each carry a `#[serde(flatten)]` extras map.

Three things typeshare cannot do, and what was done instead:

- **It rejects `#[serde(flatten)]` outright.** The extras fields are
  `#[typeshare(skip)]`, and the index signature lives in the hand-written façade at
  `src/types/index.ts` as `StoredCanvasNode` / `StoredCanvasEdge` / `StoredNote`.
  Use a `Stored*` type for anything that came off disk or is going back to it.
- **It only generates adjacently-tagged enums** (`{ type, content }`). `DiffChunk`
  is internally tagged on the wire (`{ type: 'equal', blocks }`), so it is a struct
  with optional fields and constructors, not an enum. Do not "fix" this without
  changing the compare panel that reads it.
- **It does not map `BTreeMap`.** Use `HashMap`, which becomes `Record<K, V>` and
  `[K: V]`. `CanvasState`'s maps are therefore unordered — `nodeOrder`/`edgeOrder`
  are the only thing that may decide sequence.

Swift reaches arbitrary JSON through `AnyCodable`, which the Phase 5 Xcode target
supplies; it is only reachable from TipTap content and the extras maps.

### The parity harness — the thing that makes any of this safe

`npm run parity` (`scripts/parity/`) sends one corpus through both implementations
in a single run and compares. A corpus each half maintains is a corpus that drifts.

Each module under `scripts/parity/cases/` yields `{ fn, args, expected }` rows where
`expected` comes from calling the real function in `src/lib/`; the runner pipes the
same rows to the Rust `parity` binary and deep-compares after a JSON round-trip on
both sides. A module may supply a `canon(value, case)` hook that runs on **both**
sides — `canvasModel` uses it to rewrite generated ids — so it can only erase a
difference it erases symmetrically.

**Check it is not passing vacuously** by breaking the Rust side deliberately before
you trust a green run. Every port below was verified that way.

### Move order

| # | Module | Status |
|---|---|---|
| 1 | `docKind.js` | **done** — `doc_kind.rs` |
| 2 | `canvasGeometry.js` | **done** — `canvas_geometry.rs` |
| 3 | `canvasModel.js` + `storyStructure.js` | **done** — `canvas_model.rs`, `story_structure.rs` |
| 4 | `versionHistory.js` diff engine (`:96-340`) | **done** — `version_history.rs`, with the differential test over real documents |
| 5 | `FileSystem.js` + `projectPaths.js` + `docLock.js` + `versionStore.js` | **done** — `store/`. `withDocLock` is a real `Mutex`; `versions:changed` is a listener the shell wires up |
| 6 | `sidebarSearch.js` matcher + JSON walk + `canvasSearch.js` | **done** — `search/`, on `fancy-regex` with the JS dialect translated |
| 7 | `readAloud.js` chunker, `noteUtils`/`audioNotes` normalizers | **done** — `read_aloud.rs`, `notes.rs` |

**The JS is still in place and still what the app runs.** These are parallel
implementations kept honest by the harness; deleting a JS module is Phase 4 work,
once the bridge exists to call the Rust one. Nothing per-frame — `worldTransform`,
`panBy` — can survive an IPC round-trip, so those particular ones only lose their JS
copy in the Swift shell.

### Where the I/O modules are verified instead

#5's path arithmetic and `pushVersionEntry` go through the parity harness; its **I/O
does not**, and deliberately. The JS runs against an in-memory stub that does not model
directories, so a differential test there would be comparing against a fiction. The
filesystem half is covered by 20 Rust tests against a real temp directory, and the same
split applies to `search_project`.

### Six ways "the same arithmetic" is not the same arithmetic

Every one of these was found by the harness and none by reading.

- **serde_json's float parser is off by up to 1 ULP** without the `float_roundtrip`
  feature. It is enabled in the workspace now. Do not remove it.
- **Exact ties round differently.** ECMA-262 §6.1.6.1.20 takes the even last digit,
  Rust takes the larger: `2083078717175940.25` is `…40.2` in JS and `…40.3` in Rust.
  Handled in `js_number::format_js_number`, which also fixes the envelope — Rust
  never goes exponential, JS does outside `1e-7 .. 1e21`. **Any string the core
  builds out of a float must go through it**, not through `Display`.
- **`Math.min`/`Math.max` propagate NaN; `f64::min`/`max` swallow it.** Use
  `canvas_geometry`'s `js_min`/`js_max`.
- **`Math.hypot` is not `f64::hypot`.** V8's is a scale-and-Kahan-sum and is not
  correctly rounded. `js_hypot` transcribes V8's.
- **`Math.round` breaks ties toward +Infinity**; Rust's breaks them away from zero.
- **`Boolean(x)` is not `as_bool()`.** `pinned: "yes"` is pinned. See `notes::js_truthy`.

Two more of the same family: `charCodeAt` iterates **UTF-16 code units** (use
`encode_utf16()`), and JS's `\s` and `trim()` include **U+FEFF**, which Unicode's
`White_Space` does not. Both live in `js_string.rs` now.

**Every offset in this codebase is a UTF-16 code unit.** A JS string index, a
ProseMirror position and `String.length` all count them, and a Rust byte or `char`
offset counts neither — an emoji is one `char`, four bytes and two units. A match
reported in either of the other two puts the caret in the wrong place in any document
containing one. `js_string` holds the conversions; use them.

**The one thing that cannot be made to agree.** A JS regex without the `u` flag matches
UTF-16 code units, so `\W` against an emoji finds its two surrogate halves separately —
and a Rust `&str` cannot hold half of one. The harness spots a JS result containing an
unpaired surrogate, counts it unrepresentable rather than failed, and fails a function
where *every* case is unrepresentable, since that means nothing was checked.

### One deliberate divergence, and one deliberate improvement

`canvas_model::normalize_canvas` **drops an edge whose `fromNode`/`toNode` is not a
string**, where JS uses the raw value as an object key and so finds the node `"5"`
for `fromNode: 5`. Coercing would change what gets written back out. Documented at
the top of the module and covered by a unit test.

`version_history::diff_canvases` compares parsed content rather than
`JSON.stringify` of it, so two TipTap documents with the same content in a different
key order are no longer counted as an edit.

`store::rename_project` **refuses a name another project already holds**, anywhere.
`renameProject` only checks the new path inside the same parent, so a custom-located
project can be renamed onto an AppData project's name; both then answer to it,
`getProjectRoot` resolves to the registry entry, and the AppData project becomes
unreachable. That is the exact stranding `linkProject` goes out of its way to avoid.

`notes::normalize_note` **accepts a non-object**. `normalizeNote(note = {})` defaults
on `undefined` and not on `null`, so `normalizeNotes([null])` throws — on a function
documented as safe for untrusted data, reachable from a corrupt document.

Both of those are **pre-existing bugs in the JS, found by porting.** The JS is
untouched: it is still what ships, and changing its behaviour is a decision, not a
port. Two decisions owed.

### `localStorage` moved to disk — done

A native shell cannot see any of it: a `WKWebView` gets its own per-origin store that
no native code can read. All 28 call sites go through `lib/preferences.js` onto
`inkblot_core::store::preferences`, which writes under AppData.

**The API stayed synchronous**, because every call site reads during render — a
`useState` initializer, a node view's constructor — and none can await. `main.jsx`
hydrates the whole store before React mounts; reads answer from that cache and writes
reach disk on their own time. Mounting first would mean a frame of the wrong theme, an
editor that opens with no tabs and then replaces them, and a file tree that expands
everything before collapsing it again.

**Three files, not one:** `preferences.json`, `file-tree-state.json`,
`pinterest-cache.json`. The first is read at every launch and is tiny; the last holds
pin data per board and is by far the largest. Keeping them apart means a corrupt or
enormous cache cannot take the theme with it.

Two things deliberately did not move:

- **`sessionStorage`.** The project-open id and the per-project Pinterest refresh flag
  describe one app launch; on disk they would outlive what they describe, and a stale
  "already refreshed" flag is a board that never refreshes again. They are an in-memory
  Map in the facade.
- **The file tree's order and expansion stay machine-local**, in AppData rather than in
  the project. `fileTreeState.js` says plainly they are kept out of the project so they
  do not travel with it, so `.inkblot-order.json` stays reserved and unwritten — using
  it would put one machine's collapsed folders into another's checkout.

The `prefs` suite covers the half that only exists in the webview, and above all
**which file a key lands in**: a key routed to the wrong scope is written to one file
and read from another, so the setting appears to save and is simply gone next launch.

### Kokoro's Python dependency — done

`kokoro_commands.rs` no longer spawns anything. The model runs through `ort`, and the
work splits across the seam:

```
webview:  text -> normalize -> phonemize -> token ids   (lib/readAloudVoice.js)
native:   token ids + voice style + speed -> ONNX -> f32 @ 24kHz
```

Phonemization stayed in the webview: a correct English grapheme-to-phoneme pass is a
lexicon and several thousand rules, `phonemizer` already implements one, and none of it
is a subprocess — so none of it blocks iOS, which is the whole point.

Two things are **never written down** in our source. The phoneme→id vocabulary is
downloaded with the weights and read back through `kokoro_vocab`; transcribing it from
memory is the one mistake that produces fluent, confident, wrong speech. The voice
style vector is sliced out of the model's own voice file by `inkblot_core::kokoro`,
whose index arithmetic is unit-tested — get it wrong and nothing fails, the voice just
sounds wrong.

**The normalizer IS a transcription, and is tested as one.** kokoro-js keeps it
module-private and reaching it loads the model into the webview. The `voice` suite
slices the real function out of the installed bundle *at test time*, evaluates it, and
runs both over 27 inputs. It tracks the dependency rather than a snapshot of it. If
kokoro-js is upgraded and that suite starts failing, the bundle's layout moved — fix
the slice, then look at what actually changed.

Model, tokenizer and voice download on first use into `<AppData>/models/kokoro/`, from
the same public repo the WASM fallback fetches from, so the two paths cannot end up on
different weights.

**Still owed — this is the acceptance test:** Read Aloud on a machine with **no Python
installed**. Nothing in this repo can run the model or listen to it, so what is proven
is the arithmetic, the normalizer, the path handling and the build. The `kokoro-js`
WASM fallback is still in place; dropping it (and with it the `window.fetch` /
`window.caches` monkey-patches at `readAloud.js:366-410`, the `onnxruntime-web`
dependency and `public/ort/`'s 109MB) is the reward for confirming the native path
works.

### The Pinterest return channel — done

`eval_webview` throws its result away, so the injected script used to smuggle its
payload out through `location.hash` while the app polled `get_webview_url` every 220ms.
It now calls `pinterest_report_scrape` directly.

That works because Tauri injects `__TAURI_INTERNALS__` into the main frame of **every**
webview it creates, including one showing pinterest.com, and app commands are only
ACL-gated when the app ships its own permission manifest — which this one does not
(`gen/schemas/acl-manifests.json` has no `__app__` key). **If a `permissions/`
directory is ever added to `src-tauri`, that stops being true and this breaks.**

Two commands, not one: the report arrives on the Pinterest webview's IPC and the result
is wanted on the app's. `pinterest_begin_scrape` opens a slot *before* the script is
injected, which is what makes it impossible for a report to arrive before anything is
listening — a race the polling version could not have had.

Gone: the hash protocol, the poller, and the progress-payload dance. **Kept, against
the original plan: the `new Function` syntax pre-check.** IPC carries a real error for
a script that *throws*, but not for one that fails to *parse*, because the wrapper's
catch never runs. That is the bug this repo has already shipped once.

**Still owed:** it needs a live logged-in session and a real webview to exercise, and
it is already on the manual list. This makes that check more important, not less.

## Phase 3 — TypeScript (runs alongside Phase 2)

Scoped deliberately: **bridge and domain layers, not components.**

- `typeshare` output lands as generated types — do not hand-write these
- Hand-convert the pure modules in the Phase 2 order. Phase 1 created several
  ready-made candidates: `lib/fileTreeOrder.js`, `lib/editorSession.js`,
  `lib/notePreviewGeometry.js`, `extensions/conversationModel.js`,
  `lib/projectPaths.js`, `lib/docLock.js` — all pure, no React, no I/O
- `lib/preferences.js` and `lib/readAloudVoice.js` are Phase 2's additions to that
  list: both pure, both already the only door to what they wrap
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

4. **`notesRemapped` fires on every transaction** (`useEditorNotes.js`, note anchor
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
- **Assert every slice brace-balanced and comment-balanced before writing it —
  every slice, not the big ones.** Line-range slicing breaks silently on comments.
  One cut ended mid-JSDoc, leaving an unterminated `/**` that commented out an
  exported function; lint *and* tsc both passed. The check then caught three more bad
  boundaries — and, the one time it was skipped as overkill for a 30-line context
  menu, that slice ended one line short of its closing brace.
- **A hook call that takes `editor` must come after `const editor = useEditor()`.**
  Reading a `const` before its declaration throws, and because the call sites are
  hook arguments rather than statements, nothing static sees it. Pass accessors —
  `getEditor: () => editor` — when the order cannot be changed, which it often
  cannot: `editor`'s own `editorProps.handlePaste` comes out of the same hook.
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

`scripts/canvas-tests/` — 15 suites, custom Node ESM loader, jsdom, in-memory fs
stubs. The **real** `FileSystem.js`/`assets.js` run against the stubs rather than
being reimplemented, which is why it catches real persistence bugs.

- `loader.mjs` maps `@tauri-apps/*` and `lodash` to stubs, resolves extensionless
  imports, and transpiles `.jsx` with esbuild
- `dom.mjs` mounts the real `CanvasSurface` under **StrictMode** — which
  double-invokes effect setup/teardown, the case that catches cleanup bugs
- `editor.mjs` mounts the real `EditorCanvas` the same way. Its harness passes
  **stable** callback props, and that is load-bearing rather than tidy: the
  document-load effect depends on `setVersions`, so a fresh identity each render
  gives load → setVersions → render → load and the suite hangs instead of failing
- `run.mjs` resets `process.exitCode` per suite and catches throws, so one broken
  suite cannot hide the rest. It could before, and did: four suites sat unrun behind
  one stale assertion.

**Covered:** canvas geometry/reducer/groups/snapping/search, document persistence,
notes, audio, `generateHTML` rendering, `CanvasSurface` mounting, `EditorCanvas`
mounting (autosave reaching disk, version checkpoints, the per-doc editor-state
cache, note anchor remapping, split-pane autosave, the unmount flush), the file
tree's per-row decisions, the preference store's scope routing, and the Read Aloud
normalizer against kokoro-js's own.

`loader.mjs` also neutralizes `import.meta.glob`, which is a Vite build-time transform
with no Node equivalent — a module using it threw on import before any of its exports
existed, which is what had kept `readAloud.js` unreachable from the harness entirely.

**`scripts/parity/` is the other half.** It is not a suite; it runs both
implementations of a ported module over one corpus. Its rule: **check it is not
passing vacuously by breaking the Rust side deliberately** before trusting a green
run. Every port in Phase 2 was verified that way, and one injected "break" turned out
to be a no-op, which was worth learning about that branch.

When adding to `editor.mjs`: autosave debounces at 800ms and the checkpoint at 15s,
and the suite does not wait them out. Switching documents tears both effects down
and their cleanups flush — which is the same path the app takes when you click
another file, so it is the path worth asserting on anyway.

**Still not covered:** the context menu, session restore, file-tree *drag*, note
previews, Pinterest embeds, and editor paste/drag. Pinterest is the least verifiable
thing in the app — it needs a live logged-in session and a real webview — so treat
`pinterestBoardPreview.js` as the piece where a careful reading is the only review
you get.

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
