# Inkblot — Migration Handoff

State of the hybrid-native migration, what each remaining phase involves, and the things that cost time to discover the first time.

**Current branch:** `phase-0-foundations`, 54 commits ahead of `main` (`b7ceed8`).
`main` is untouched — if you want these on main, `git checkout main && git merge --ff-only phase-0-foundations`.

**Size today:** 33,415 JS/JSX · 5,367 TS · 8,984 CSS · 11,023 Rust.

---

## The gates

Run all seven after every change, and the Swift tests below once you touch `native/`.
They are fast and they have each caught something the others missed.

```bash
npm test            # 598 assertions, 21 suites
npm run lint        # 0 errors AND 0 warnings is the current bar
npm run typecheck   # tsc --noEmit
npm run build       # the only thing that resolves dynamic imports and named exports
npm run parity      # 15,915 cases through BOTH the JS and the Rust implementation
npm run types:check # fails if the generated TS/Swift is stale, and typechecks the Swift
(cd src-tauri && cargo build --workspace && cargo test --workspace)   # 125 tests
```

And for the Swift shell (Phase 5), after `./scripts/build-xcframework.sh` and `npm run build`:

```bash
xcodebuild test -project native/inkblot-core/inkblot-core.xcodeproj -scheme inkblot-core \
  -destination 'platform=macOS' -only-testing:inkblot-coreTests      # 29 tests
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
| A coalescer that stopped delivering after its first push under a synchronous scheduler — one toolbar state for the life of the app | the `bridge` suite only |
| A ref written during render in `CanvasCardEditor`, invisible for as long as the file had existed | `lint` only, and only once an unrelated mutation was removed and the component became analyzable |

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

## Phase 3 — TypeScript — done

Scoped deliberately: **bridge and domain layers, not components.** Nine modules moved,
in dependency order, each one verified against the JavaScript it replaced before the
next was started.

| Module | Was | What the types bought |
|---|---|---|
| `lib/docLock.ts` | 29 | `withDocLock<T>` — the queue no longer erases the task's return type |
| `lib/projectPaths.ts` | 43 | `PathInput`: absent and empty are both ordinary, and now say so |
| `lib/fileTreeOrder.ts` | 124 | `OrderMap`, and `TreeNode` from the generated types |
| `lib/preferences.ts` | 143 | `PreferenceScope` — the three scope strings are a wire format shared with Rust |
| `lib/editorSession.ts` | 163 | `ProjectSession`/`DocTab`; the restore path's shape was previously only in prose |
| `lib/notePreviewGeometry.ts` | 154 | `Point`/`NotePreviewSize` from the generated types; `AnchorRect` for the DOM half |
| `lib/readAloudVoice.ts` | 217 | `VoiceLanguage`, `KokoroVocab`; `invoke<KokoroVocab>` types the Rust boundary |
| `extensions/conversationModel.ts` | 216 | `ConversationAttrs`, `Message`, `ReceiptStatus` |
| `canvas/canvasReducer.ts` | 285 | `CanvasAction` — the discriminated union |

`tsconfig.json` was already `allowJs: true, checkJs: false, strict: true`, so this was
file-by-file with no big-bang, and the unconverted JavaScript that imports these
modules is unaffected.

**Not converted:** `components/`, node views, anything touching a live TipTap instance.

### The three things that cost time

**The test loader had to learn `.ts` first.** `scripts/canvas-tests/loader.mjs` now
probes `.ts` when resolving an extensionless import and transpiles it with esbuild
(erasing types — it does not typecheck, and should not; `npm run typecheck` is what
looks at them). Without that, the first conversion takes its suite with it. Its
`import.meta.glob` rewrite now runs *before* the transpile rather than instead of it,
because a module can need both.

**A rename breaks the explicit `.js` specifiers.** Most imports here are
extensionless, but the suites and the parity cases spell the extension out —
`` await import(`${C}/canvas/canvasReducer.js`) `` — and a few doc comments name the
file. Grep for `<name>.js` across `scripts/` and `src/` after every rename. The
failure is loud (`run.mjs` catches the throw and names the suite), but it is a failure,
not a warning.

**The generated enums are string enums, so a literal does not compare.**
`node.type !== 'folder'` stops compiling the moment `node` is a `TreeNode`; it has to
be `TreeNodeType.Folder`. The emitted value is the same string, so this is a
compile-time change only — but it does mean a converted module imports the generated
file for its *values*, not just its types.

### Two additions to the types façade

- **`Loose<T>`** — `{ [K in keyof T]?: unknown }`, the input side of a normalizer.
  Most of what Phase 3 converted is a normalizer, and all of them exist because their
  input came from somewhere they do not control. The output is `T`; the input is this.
- **`StoredCanvasState`** — a whole canvas in memory between a load and the save that
  follows, so its nodes and edges are `StoredCanvasNode`/`StoredCanvasEdge` and keep
  the keys we do not model. This is what the reducer holds.

### The casts are assertions, not checks

`normalizeProjectSession` reads `session.currentDoc || ''` where the field is
`unknown`. Coercing it properly — `typeof x === 'string' ? x : ''` — would be a
**behaviour change**: today a stored `5` comes back out as `5`. So it is an `as`,
which is erased, and the module answers exactly as it did. Same in
`conversationModel`'s `parseNumber` and `safeJsonParse`. Fixing any of them is a
decision, not a port; they are noted where they sit.

### How the ports were verified

`tsc` proves nothing about a port — it never saw the JavaScript. So each module was
checked the way Phase 2 checked its Rust: **both implementations, one corpus, one
run.**

The pre-conversion file is copied out of `HEAD` beside its replacement
(`git show HEAD:src/lib/x.js > src/lib/__pre_x.js` — the relative imports still
resolve from there), and a throwaway harness imports both, compares their export sets,
and runs a corpus of arguments through each, JSON-comparing results, thrown messages
included. `Math.random`, `Date.now` and `crypto` are pinned and reset before each
side, so a generated id becomes *comparable* rather than disappearing — a difference
in which branch generates one still shows.

91 checks, 0 differing. Then the rule that makes a green run mean something: **every
module was broken on purpose and the corpus was made to catch it** — `HISTORY_LIMIT`
halved, `joinPath`'s separator doubled, one prefix dropped from `scopeFor`,
`phonemesToTokens`'s leading pad changed. All nine caught. The harness is not
committed, because after the commit there is no second implementation for it to
compare against; it is reproducible from this paragraph.

`readAloudVoice`'s regexes were **not retyped** — the file is a transcription of
kokoro-js's normalizer, and the emitted string is the program. Only signature lines
were edited, and the regex lines were diffed byte-for-byte against `HEAD`.

### Found while porting, not fixed

- **`phonemizer` is an undeclared direct dependency.** `readAloudVoice.ts` imports it;
  it is in `node_modules` only because `kokoro-js` pulls it in. A kokoro-js release
  that drops or moves it breaks Read Aloud's native path with no version to point at.
- **`nodes/reorder` is dispatched by nothing.** The case is live in the reducer, typed
  with the rest, and unreachable — send-to-front/send-to-back is not wired up.

### Still owed — done in Phase 4

The bridge client was the one part of the Phase 3 scope that could not be written before
the protocol existed, and it is where TypeScript earned the most: `send('setColor', …)`
does not compile with a `SetFontSizeCommand`'s fields, and `onCommand('setColor', …)`
hands its handler a `SetColorCommand`. `src/bridge/` is 1,500 lines of it.

---

## Phase 4 — Bridge protocol — done

The protocol is defined in Rust (`crates/inkblot-core/src/bridge/`), generated into
TypeScript and Swift like the domain types, and **the React shell now runs on it** —
both halves in one process, talking through `src/bridge/`. That second part is what
makes it a contract rather than a guess: every wrong assumption became a failing test
here instead of a puzzling silence in an Xcode debugger, and the app stayed shippable
the whole way.

### The shape of it

`InboundMessage` (shell → surface) and `OutboundMessage` (surface → shell), each
wrapping an adjacently-tagged enum. Adjacent tagging is the only representation
typeshare emits, and here it is also the one to want: a discriminated union in
TypeScript, a real `Codable` enum in Swift, so an unhandled case is a compile error on
both sides rather than a silent no-op.

- **24 commands**, the list from the original scope plus `dictationLevel`.
- **14 events**, the original list with the drag hand-off split into
  `dragStarted`/`dragMoved`/`dragEnded`.
- **4 requests and their replies.** Not in the original scope and not optional: the
  context menu is built at the moment of the right-click and has to be built from the
  selection *as it is then*, so a pushed `selectionContext` from the last selection
  change is a different question's answer. A reply is always sent, including an error
  one — a shell blocked on an answer that never arrives is a hang with no symptom, and
  the commonest cause is entirely ordinary: the user closed the pane.

### The one rule to carry forward

**No message carries a bare ProseMirror position.** Every place in a document is a
`TextAnchor` — positions *plus the text they covered*. In one process a bare position
is survivable because the holder remaps through every transaction and is never more
than a tick stale. Across a process boundary it is not: native holds positions from
before an edit it never saw, and trusting them puts the caret in the wrong place with
no signal that anything went wrong.

`only_set_caret_addresses_a_document_by_bare_position` walks the serialized form of
every command and asserts that exactly one — `setCaretAtDocPos`, which addresses a
caret and so has no text to be about — is an exception. That is what keeps the
exception at one.

`bridge/anchors.ts` is the other half: `resolveAnchor` trusts the positions only if
they still cover the anchor's text, searches for the text otherwise, and returns null
when the text is gone. Null is a real outcome callers must handle — a note whose words
were deleted has genuinely lost what it was about, and a guessed position is worse than
no movement.

### The five sharp edges, as they turned out

1. **The toolbar inverted.** `Toolbar.jsx` no longer holds an editor. The ten-fact read
   is `bridge/readState.ts`, the `requestAnimationFrame` coalescing is
   `bridge/coalesce.ts`, and `bridge/useSurfacePublisher.ts` follows the election and
   decides when to publish. `editor.storage.lastHighlightColor` — written by the
   toolbar, read by `editorMenu.js` — is protocol state now: `setHighlight` says what
   to remember, `ToolbarState` reports it back.

2. **Dictation split where it had to.** `bridge/dictationSource.ts` sends
   `dictationPartial`/`Final`/`Level` and is a stand-in for Swift; the whole draft state
   machine stays in the webview. Confirmed rather than assumed: the real machine now
   runs against the real protocol.

3. **The anchor dance is the standard.** Both hand-rolled versions
   (`EditorLayout.jumpToText`, `Workbench.findAnchorRange`) go through `resolveAnchor`.
   **This changed behaviour deliberately** — neither checked that its stored positions
   still covered the text they were made from (`jumpToText` trusted any pair of finite
   numbers, `findAnchorRange` any non-empty range), so a stale range acted on whatever
   had moved into it.

4. **`notesRemapped` is coalesced to one per frame**, per document. Safe only because
   the event carries the *whole* remapped set rather than a delta: dropping an
   intermediate value loses nothing when the next one is complete. Check that property
   before reaching for `createCoalescer` — a delta stream coalesced the same way would
   corrupt silently.

5. **The election result is a name.** `EditorTarget` is `primary` | `secondary` |
   `canvasCard`, and `bridge/editorRegistry.ts` is the only thing that turns a name back
   into an object. `__inkblotCanvasCard` is gone.

### The Toolbar is mounted by a test

It is the most heavily rewritten file in this phase and it had no coverage anywhere in
the harness — which is precisely the position `EditorCanvas` was in when it threw on
every mount while lint, tsc and the build all passed. The `bridge` suite mounts it,
asserts that it renders a pushed `ToolbarState` **without touching the editor**, and
that clicking Bold leaves as an `applyMark` command watched on the surface end of the
app's own bridge. Both halves were verified by breaking them: a binding read in its
temporal dead zone, and `applyMark` made a no-op.

### The globals are gone, all seven

| Was | Is | Note |
|---|---|---|
| `__inkblot_draggedEditorSelection` | `dragHandoff` session | carries a `TextAnchor`, so a move survives an edit the target did not see |
| `__inkblot_draggedClipboardEntry` | same session, different `kind` | |
| `__inkblot_dragPoint` | `dragHandoff.point()` | |
| `__inkblot_dropHandled` | `dragHandoff.claim()` | **test-and-set, not a flag** — see below |
| `__inkblot_forcePlainPaste` | deleted | read and never set; the branch was unreachable |
| `__inkblotProjectOpenId` | `lib/projectContext` | still ambient, now owned |
| `__inkblotProjectName` | `lib/projectContext` | |

`claim()` is the one worth understanding. Two drop targets can see the same drop — an
editor and the clipboard panel underneath it — and the flag they each set and checked
made correctness depend on an order nobody had written down. The first caller now gets
`true` and everyone after gets `false`, so the arbitration has an answer even when the
order changes.

`__inkblot_forcePlainPaste` gated a plain-paste branch whose comment referred to a
"Cmd+Shift+V handler" that does not exist. macOS's **"Paste and Match Style" is a real
thing a native Edit menu will want in Phase 5** — it should arrive as a command on the
protocol, not as a resurrected flag.

`lib/projectContext` is still ambient because a TipTap node view has no React path to
reach, but it has one owner, a type, and the same fall-through to the session store the
readers already had. It is now also cleared when the last project closes, which the
window property never was — a Pinterest board mounting on the landing screen kept the
previous project's cache key.

### Where the transports are

`bridge/transport.ts`. `createInProcessTransports` is what runs today;
`createDeferredTransports` is the same pair delivering on a later turn, and the suite
runs through it to prove the client never relies on a reply having already arrived.
Phase 5 replaces this file and nothing above it.

**Every message is round-tripped through JSON**, which is slower than passing the object
and is the point: a payload holding something unserializable fails here rather than in
Phase 5. `NoteAnnotation.js:155` ships a live `EditorView` in an event payload today,
which is exactly the class of bug this catches — `NoteMarkerEvent` carries a rect
instead.

### What this phase found

- **The coalescer wedged after its first push** under a synchronous scheduler.
  `schedule` may run its callback before returning, so the canceller it hands back is
  already stale, and the guard then saw work outstanding that had in fact been
  delivered. It would have published exactly one toolbar state for the life of the app.
- **The `bridge` suite's fake editor was wrong three times**, and each way was
  instructive. Missing `schema.nodes`, which `isEditorReady` checks, made four
  assertions about commands reaching an editor pass without ever running one. Missing
  `on`/`off` broke the Toolbar mount from inside `ReadAloudControl`, two hundred lines
  from the fake. And `commands: {}` threw on unmount, *after* every assertion had
  printed `PASS` — `run.mjs` reported the suite abandoned, which is the only reason it
  was noticed at all. A fake that is almost right makes assertions pass for the wrong
  reason; the proxies it uses now are there so that the failure is a missing assertion
  rather than a false one.
- **`CanvasCardEditor` had been writing a ref during render** for as long as the file
  had existed. Lint only saw it once the `__inkblotCanvasCard` mutation was removed and
  the component became analyzable.

### Still owed

- **`getReadAloudPayload` has no handler.** The surface deliberately does not answer it;
  building the payload needs the chunker and the document's block structure, which
  `ReadAloudControl` owns. It should register its own handler while mounted. Until it
  does, the request replies with an error rather than hanging — which is correct, but it
  is not the same as working.
- **`docChanged`, `searchMatches` and `focusModeView` have publishers and no callers.**
  The protocol and the plumbing exist and are tested; the three components that should
  emit them (`useEditorWordCount`, `SidebarSearch`, `FocusModeOverlay`) still only talk
  to React state. Nothing is broken by that — the shell is in the same process and reads
  the state directly — and it is exactly the work that has no consumer until Phase 5.
- **`nodes/reorder` is still dispatched by nothing** (carried over from Phase 3).

---

## Phase 5 — Swift shell (macOS 26+) — foundation done

`native/inkblot-core/` is a SwiftUI app that hosts the unmodified `dist/` in a
`WKWebView`, links `inkblot-core` as an XCFramework through UniFFI, and speaks the Phase 4
protocol from Swift. The Tauri app is untouched and still ships: one bundle serves both
shells, and it asks the host which chrome to draw rather than being built differently.

**Verified:** the app builds warning-free, the page boots in it, preferences load
through the Rust core, the page's View menu reaches the native menu bar, and
`projectChanged` arrives over the bridge as event seq 0 (read off the unified log).
**Not verified — nobody has clicked through it yet:** opening a project, the native
tree opening a document, a context menu, a save. The session that built this had no
screen-recording or UI-scripting permission. Do that first, with the Tauri app closed
(both use the same data folder).

### Building and running it

```bash
npm run build                        # the shell embeds dist/; it does not build it
./scripts/build-xcframework.sh       # after any change to inkblot-core or inkblot-ffi
open native/inkblot-core/inkblot-core.xcodeproj    # ⌘R
```

- The **Embed Web Bundle** phase copies `dist/` into `Resources/web`. It warns when
  `src/` is newer than `dist/`, and fails if `dist/` is missing.
- Set `INKBLOT_DEV_URL=http://localhost:5173` in the scheme's environment and run
  `npm run dev` to load the page from Vite instead. That gives hot reload inside the
  native shell, and the injected scripts work the same either way.
- Debug builds send the page's `console.error`, uncaught errors and unhandled
  rejections to the unified log, along with a trace of every bridge message and Tauri
  call. Debug-level lines are not persisted, so stream them:
  `/usr/bin/log stream --level debug --predicate 'subsystem == "inkblot"'`. (Plain
  `log` in zsh is a shell builtin.)
- Web Inspector: the web view is `isInspectable`, so Safari ▸ Develop ▸ *your Mac*.
- The project name, target and product are still Xcode's `inkblot-core` template names.
  The window and Finder say "Inkblot". Rename the target when you like; nothing
  depends on the name except the test target's `@testable import inkblot_core`.

**Project settings changed from the template, deliberately:**
- **App sandbox off.** The shell must read `~/Library/Application Support/com.inkblot.app`,
  which is the Tauri app's folder and not this bundle ID's, and projects can live
  anywhere on disk. A sandboxed build would see an empty container.
- **macOS only.** The XCFramework is `macos-arm64`, so building for iOS would fail to
  link. Phase 6 adds the iOS slices and turns the platforms back on.
- **User script sandboxing off.** The Embed Web Bundle phase has to read `dist/`.
- `OTHER_LDFLAGS` adds CoreText, CoreGraphics and libiconv, which font-kit needs. A Rust
  staticlib carries no autolink information; `cargo rustc -- --print native-static-libs`
  is where the list came from.

### How the pieces fit

```text
 SwiftUI (Shell/)                              WKWebView — dist/, unmodified
 ─────────────────                             ──────────────────────────────
 FileTreeSidebar ─┐                            React chrome (toolbar, panes, right
 InkblotCommands ─┼─ ShellBridge ◄─ inkblotBridge ─► createNativeHostTransports
 AppModel        ─┘   (protocol JSON)            (src/bridge/transport.ts)
                                                     │  merged with the in-process
 TauriHost ◄──────── tauri (reply handler) ──── tauri-shim.js   React shell
   fs / path / dialog / opener / menus /            (window.__TAURI_INTERNALS__)
   preferences / fonts / haptics
 CoreService ── InkblotFFI.xcframework (inkblot-ffi → inkblot-core)
 AppSchemeHandler: inkblot://app/ (dist) · asset://localhost/ (disk)
```

**The native shell joins the wire alongside the React shell. It does not replace it.**
`createNativeHostTransports` merges the Swift shell onto the surface's wire next to the
in-process React chrome:
- Events go to both shells.
- Commands from both are re-sequenced into one stream. Otherwise each shell's own
  numbering would look like a gap on every interleave.
- Replies go back to whoever asked. Native request ids are prefixed going in and
  stripped coming out, so two `r0`s cannot cross.

That is what lets chrome move a piece at a time: until the last piece moves, both
shells drive the same document. `bridge.mjs` covers it, and two deliberate breaks
(no re-sequencing, reply routing off) both fail it.

**The Tauri shim is what lets the bundle run unmodified.** Every save goes through
`@tauri-apps/plugin-fs`, every delete confirmation through `plugin-dialog`, and every
context menu through `api/menu`. All of them call `window.__TAURI_INTERNALS__` and
nothing else. `Web/tauri-shim.js` implements that object:
- It keeps callbacks, channels, event listeners and the whole menu resource tree in the
  page. Building a menu costs nothing; showing it costs one round trip.
- It forwards to `TauriHost` only what needs the machine.
- Bytes cross as base64 inside JSON.

`scripts/canvas-tests/shim.mjs` drives the shim through the **real** `@tauri-apps/api`
modules, imported by path so `loader.mjs` does not stub them. It found a cross-realm
`instanceof` bug on its first run.

**Structured values cross UniFFI as JSON strings.** They decode into the
typeshare-generated `Codable` types, so there is one definition per type. A UniFFI
`Record` for `TreeNode` would have been a second definition, made by a second tool.
The UniFFI object is `InkblotCore` in `Generated/inkblot_ffi.swift`; that file is
gitignored because it must come from the same build as the library (see
`build-xcframework.sh` on checksums). `Generated/InkblotCore.swift` *is* committed:
`generate-types.sh` writes it, and `types:check` diffs it.

### What is native now

| Piece | State |
|---|---|
| Window chrome | No title and no titlebar row: the page's toolbar is the top of the window. The traffic lights float over the file tree; with the tree hidden (or with the right sidebar closed, for its reopen button) the shell sends `setTitlebarInset` and the page leaves room. The page's top strip drags the window again — the shim's `start_dragging` becomes `performDrag` with the mouse-down recorded on the way in. The sidebars toggle from View ▸ Show/Hide Sidebar and Inspector. |
| File tree | Native. Browse, open, New Document / Canvas / Folder, Rename, Move (menu and drag), Duplicate, Delete, Reveal. **Every change is a command the page performs** (`createEntry`, `renameEntry`, …) through `useEntryOperations` — see below. |
| Right sidebar | Native inspector: a glass selector bar under its own toggle (Xcode-style; the selection bubble can be grabbed and slid), a search bar with scopes and match options, and the Clipboard, Workbench, Notes and History panels. State stays the page's; `useNativeSidebar` publishes it and applies the shell's edits. Version rows and search come from the core through `inkblot-ffi`. |
| Note hover cards | Native Liquid Glass over the web view (`Notes/`), placed from marker events the page publishes (`useNativeNotePreviews`): hover, leave, pin, the anchor following a scroll, dismissal. Draggable, resizable, replies on strings, layout stored on the note. |
| Voice memos | AVFoundation, content-addressed into `.assets/` exactly as `assets.js` does, so either shell plays the other's. Needs the audio-input entitlement (`Inkblot.entitlements`) under the hardened runtime. |
| Menu bar | Format (checkmarks follow `ToolbarState`), Edit ▸ Paste and Match Style (`insertPlainText`), and the page's View items. |
| Context menus, dialogs, preferences, fonts, haptics | As before: through the shim and `TauriHost`. |

### Rename, move and delete — a bug the Tauri app had too

An earlier version of this section said the page's own tree retargets open documents
when it renames one. **It did not.** A pane that lets go of a document flushes its
pending autosave to the path it had, so renaming the open document recreated it under
the old name, and deleting it did not stick. `useEntryOperations` now closes what an
entry touches (with `flushSync`, so the flushes run now), waits for those writes on the
document locks, does the disk operation, and reopens at the new paths with tabs, notes
and versions carried across. Every caller goes through `lib/entryOperations`.
`writeDocumentRaw` takes the lock too (a canvas save was the one write that did not),
and `saveDocumentNotes`, which already holds it, writes through an unlocked twin —
the lock is a queue, not re-entrant, and taking it twice hangs. The `entries` suite
mounts the real `EditorCanvas`, types without waiting out the debounce, and renames
and deletes the open document; a control case shows the ghost file without the fix.

### Protocol additions this phase

`insertPlainText`, `projectChanged`, the entry commands (`createEntry`, `renameEntry`,
`moveEntry`, `deleteEntry`, `duplicateEntry`), the sidebar's (`bridge/sidebar.rs`:
notes by patch, clipboard, tiles, version actions, `revealSearchResult`, `addReply`),
the preview events (`noteMarkerMoved`, `notePreviewDismissed`) and `setTitlebarInset`.
Two rules held that are worth keeping:

- **Notes are edited by `NotePatch`, never sent whole.** `Note` flattens unknown keys
  that typeshare cannot express, so the shell's copy lacks them; a whole note sent back
  would drop them.
- **No bare document positions**, still. `revealSearchResult` first carried a
  `SearchResult` with raw offsets and `only_set_caret_addresses_a_document_by_bare_position`
  failed the build; it carries a `TextAnchor` now.

### Still owed, in the order I'd do them

1. **Click through it.** Much has now been built without being seen. The user has
   been testing the window and the sidebar; nobody has yet exercised a rename of an
   open document in the native tree, a restore from native History, a voice memo, or a
   glass note card being dragged.
2. **The Rust features that live in the Tauri app crate:** synonyms, Kokoro, whisper
   dictation, the Pinterest scrape. `TauriHost` rejects their commands by name and the
   workbench's synonym and rhyme tiles say "not available in the native app yet" through
   `LanguageServices` — the one file that changes when they move into a crate
   `inkblot-ffi` can link. Rhymes never worked in either shell (see Known broken).
3. **The formatting toolbar** is still the page's, and at the top of the window now,
   which is where the user asked for it. Porting it natively would move it into a
   titlebar row that was just removed at their request — decide with them before doing it.
4. **Detached document windows and the Pinterest webviews** (`WebviewWindow`, answered
   with nothing by the shim).
5. **Finder drag-and-drop onto a canvas** (Tauri's `drag-drop` event with paths; in
   `WKWebView` it is an HTML5 drop with `File` objects).
6. `TabDock`, `DraftTabPane`, `Bubble`, `useResizableSidebar`. The momentum hack in
   `RightSidebar.jsx` can be deleted only when the Tauri app stops shipping that sidebar.
7. **Dragging a note from the native Notes panel onto a canvas** — the page's version
   hit-tests the canvas with a pointer drag, which a native drag cannot reach.

### Things that bit

- **`MACOSX_DEPLOYMENT_TARGET` in the environment breaks the Rust build.** It reaches
  the host proc-macro dylibs as well as the target, and the linker then emits dylibs
  that dyld refuses to load ("mis-aligned LINKEDIT string pool"), a hundred crates in.
  Leave it unset; rustc's default is older than the app, which is the harmless
  direction. If it has been set once, delete the stale `target/release/deps/*.dylib`.
- **`uniffi-bindgen --library` runs `cargo metadata` in the working directory,** so it
  must run from `src-tauri/`.
- **UniFFI already makes its error type `LocalizedError`.** Adding the conformance is a
  redeclaration error.
- **`WKWebView` refuses module scripts from `file://`,** hence the `inkblot://` scheme
  rather than `loadFileURL`.
- **Reset the bridge's counters when a navigation commits, not when it finishes.** The
  page starts sending as soon as its scripts run. Resetting at `didFinish` counted
  those early events as a gap.
- **A find-and-replace can make a function call itself.** Renaming `NotePatch(content:`
  to `.with(content:` everywhere also rewrote the call inside `.with`, which then
  recursed; it compiled, and every native note edit would have overflowed the stack.
  `NotePreviewTests.aPatchNamesOnlyWhatChanged` is the guard.
- **A `GlassEffectContainer` draws its glass over plain content inside it.** Apply
  `.glassEffect` to the content view (glass goes behind it), or keep the content outside
  the container — the selector bar's icons were frosted over until they moved out.
- **jsdom has no `CSS.escape`.** WebKit does; `useNativeNotePreviews` falls back anyway.
- **The generated protocol decodes with `try?` per case,** so a payload missing one
  required field fails the whole message. `ShellBridge` logs the raw JSON when that
  happens. That log line is the first place to look if the native side seems deaf.

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
  imports (`.js`, `.jsx`, `.ts`), and transpiles `.jsx` and `.ts` with esbuild
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
