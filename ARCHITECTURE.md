# Architecture

How Inkblot is put together, the rules that keep it working, and how to add to it.
Setup and the checks are in the [README](README.md). The details of any one module are
in its header comment. This document covers what spans modules.

## The pieces

```text
 The page (src/)                                       Tauri (src-tauri/)
 ──────────────────────────────────────────────        ─────────────────────────────
 The chrome: toolbar, file tree, inspector,            *_commands.rs ─► inkblot-core
 tab bar, menus, settings, stats                                     └► inkblot-models
        │                                                     ▲
   shellBridge ◄── bridge protocol (JSON, in process) ──►     │ invoke()
        │          (src/bridge/transport.ts)                   │
   documentSurface: the panes, editors, canvases, maps ────────┘
```

- **The page** (`src/`) is the whole app: the editor and everything around it.
- **The chrome and the document surface talk through the bridge protocol**, in
  process. The chrome renders what the surface publishes (`toolbarState`,
  `tabsChanged`, `pageLayoutState`, `mapChromeChanged`, …) and changes it by command,
  never by reaching into editor state. See [The chrome](#the-chrome).
- **`inkblot-core`** is domain logic with no knowledge of any UI. That covers
  persistence, search, version history, writing stats, the canvas model and the bridge
  protocol types.
- **`inkblot-models`** holds the on-device models.
- **The Tauri app** wraps both crates as `#[tauri::command]`s, which the page calls
  through `invoke`.

## Data model

- **A canvas is a document kind, not a view mode.** The routing is purely the
  `.canvas` path suffix (`docKind`). A canvas occupies a pane like any document, so
  split view can show a canvas beside prose. On disk it is `<name>.canvas.json` in the
  open JSON Canvas format, so it round-trips with Obsidian. Unknown keys are preserved.
- **A canvas hosts at most one live TipTap editor**, the card being edited
  (`editingNodeId`). Every other card is static HTML from `generateHTML`.
- **A map is the third document kind**, routed by the `.map` suffix the same way:
  `<name>.map.json`. See [Maps](#maps).
- **A timeline view is the fourth**, `<name>.timeline.json`. It holds how the project's
  one chronology is shown, never events. See [Timeline](#timeline).
- **Text documents** are `<path>.json`: `{ content, notes, versions?, archive?,
  citations?, timeline? }`. `timeline` is the passages attached to timeline events.
  - `archive` holds bubble sessions the writer archived (`bridge/archive.rs`). A
    session still open lives in the text as a `bubbleSession` mark whose attributes
    are the whole session, so version history restores it.
  - `citations` is the document's style, attached sources and bibliography options.
    The sources themselves are the project's, in `.inkblot-references.json`, so a
    source cited in three chapters is edited once. Citations are nodes naming sources
    by id. The page formats everything (citeproc).
  - Print Layout's page setup is an attribute of the `doc` node, so it rides in
    autosave and every version. `setContent` drops doc attributes, so restores and
    merges go through `setContentKeepingPageSetup`.
- **Version history.**
  - Text versions store both HTML (for diffing and preview) and ProseMirror JSON (for
    restore).
  - At most 200 unnamed versions are kept, evicted oldest first. Named versions are
    never evicted.
  - Text documents embed their history. Canvases keep theirs in a
    `.versions/<path>.versions.json` sidecar, because the canvas file must stay
    spec-shaped. The sidecar is also read for text documents that have no embedded
    history.
- **Images take two paths.**
  - Canvas images and voice memos are content-addressed files in
    `.assets/<sha256[0..20]>.<ext>`.
  - Note images and images pasted into a document are base64 data URIs inside the
    document JSON.
- **A project can live anywhere on disk.** A project not under AppData is recorded in
  a registry (`projectLocations.js`, `store::locations`). Everything resolves a
  project name through `getProjectRoot` before touching the filesystem.
- **Preferences** live in three files under AppData:
  - `preferences.json`
  - `file-tree-state.json`
  - `pinterest-cache.json`

  They are not in `localStorage`, which the web view keeps where the Rust side cannot
  read it. The page hydrates them before React mounts and reads them synchronously
  afterwards (`src/lib/preferences.ts`). Per-launch values (the project-open id, the
  Pinterest refresh flag) stay in memory. File-tree order and expansion are
  machine-local, so they are never written into the project.
- **Every offset is a UTF-16 code unit**: ProseMirror positions, JS string indices,
  and every offset on the bridge. A Rust byte or `char` offset is neither. Convert
  with `inkblot_core::js_string`.

## The bridge protocol

The chrome and the document surface talk through a protocol defined once in Rust
(`src-tauri/crates/inkblot-core/src/bridge/`) and generated into TypeScript
(`src/types/inkblot-core.ts`).

- `InboundMessage` (chrome → surface) carries `NativeCommand`s and `BridgeRequest`s.
- `OutboundMessage` (surface → chrome) carries `WebviewEvent`s and `BridgeReply`s.
- Every enum is adjacently tagged (`{ type, payload }`), which makes a discriminated
  union in TypeScript, so an unhandled case is a compile error.
- **Every request gets a reply**, with an error if necessary. A caller waiting on an
  answer that never comes is a hang with no symptom, and the commonest cause is
  ordinary: the user closed the pane.
- **No message carries a bare ProseMirror position.** A place in a document is a
  `TextAnchor`: positions plus the text they covered. `resolveAnchor`
  (`src/bridge/anchors.ts`) trusts the positions only while they still cover the text.
  Otherwise it searches for the text, and it returns `null` when the text is gone.
  Callers must handle `null`, and a guessed position is always worse. One command,
  `setCaretAtDocPos`, is exempt, and a Rust test keeps it the only one.
- **High-rate events are coalesced to one per frame.** This is only safe for events
  that carry the whole current state (`toolbarState`, `tabsChanged`), never a delta.
  Check that property before using `createCoalescer`.
- **The chrome runs on the protocol**, through an in-process transport that
  round-trips every message through JSON. A payload that could not cross a process
  boundary therefore fails in the test suites — and a native shell (an iOS app's Swift
  plugin, say) could be put on the same wire without the page changing.
- **State stays in the document surface.** The chrome renders what is published and
  changes it by command. Notes are edited by `NotePatch`, never sent whole: `Note`
  preserves keys typeshare cannot express, and a whole note sent back would drop them.
- **Events are not replayed.** A component that mounts after an event was sent reads
  the last payload with `useLatestBridgeState` / `latestBridgeEvent`.

## The chrome

Everything is drawn by the page, from what the document surface publishes:

| Part | How |
|---|---|
| Toolbar | Customizable (`components/toolbar/`): four saved layouts — a document's, a canvas's, a map's and Typeset's (`lib/chromeLayout.ts`), with item ids that are storage keys. Each item reads `toolbarState`, `canvasToolbarChanged`, `mapChromeChanged`, `pageLayoutState` or `viewOptions` and sends commands. Items that do not fit go behind ». |
| Inspector | A selector bar over the panels (Clipboard, Workbench, Notes, References, History, Stats, Typeset, Print & Export, and a map's panel), in two layouts — drafting and finishing — the writer arranges (Customize Layout…). The panels' edits are commands (`useSidebarCommands`). |
| Tab bar | Floats over the page column (`components/tabs/`), drawn from `tabsChanged` (`useTabsPublisher`) and changed by command. A tab owns its split. |
| File tree and Book | The left sidebar shows the project's files (with a filter bar, `lib/treeFilter.ts`) or, in Typeset mode, the book's contents from `pageLayoutState.bookItems`. |
| Stats, timer, settings | `src/stats/`: the tracker, the writing timer and goals, recorded through the `stats_*` Tauri commands; the Stats panel, a floating timer capsule, a Timer menu and the Settings sheet (⌘,). |
| Floating surfaces | The tab bar, word count, the pages' zoom, the timer and the note cards are the one translucent, blurred surface over the page (`.floating-capsule`); everything else is flat. `tests/unit/css.mjs` keeps it that way. |

## Print Layout

The editor shown as physical pages (View ▸ Print Layout, ⌥⌘P), printed exactly as
shown, imposed for self-binding, and exported to PDF, EPUB, Markdown and HTML, for one
document or a folder compiled as a book. All of it is in `src/print/`.

- **One live editor, pushed, not split.** Content never moves between containers.
  `PaginationExtension.ts` measures the laid-out document (`measure.ts`), decides the
  breaks (`paginate.ts`, pure) and draws them as decorations that push content to the
  next page. Every node view keeps working because it is the same editor, and nothing
  the pagination adds is saved, undone, copied or exported.
- **Measure natural geometry, or it oscillates.** The measurer subtracts the pushes it
  finds, so applying a result cannot change the input. One pass settles.
- **Line geometry is cached by node identity**, and a line's position is resolved only
  where a page breaks: a 36 ms pass on 300 pages instead of 20 s.
- **Never `posAtCoords` for off-screen lines** (it hit-tests) **and never
  `coordsAtPos` for a line start** (at a soft wrap WebKit answers with the end of the
  previous line). `charTopAt` measures the character's own box.
- **WebKit will not move the caret ↑/↓ over a push**, so the plugin makes vertical
  moves itself (`handleVerticalArrow`).
- **Zoom is a `transform`**, never CSS `zoom`, so line breaks are identical at every
  zoom. A pinch scales the page stack as one composited layer and lays out once when
  it ends. 100% is CSS real size; Actual Size uses the display density sent with
  `setDisplayDensity`.
- **Top-level blocks are `display: flow-root`**, so a margin that collapses on screen
  collapses the same way on paper.
- **Printing is the layout cut up, not re-typeset** (`printRender.js`): each page is a
  window onto the paginated flow. `src-tauri/src/print_commands.rs` then prints the web
  view at the exact paper size with zero margins. PDF is the same operation, saved.
- **Columns** are a single running column while editing; print, PDF and binding set
  them side by side. Live multi-column editing in WebKit was judged unreliable.

`npm run test:layout` runs the real editor in WebKit (it needs `playwright-core` and
its WebKit, which are not project dependencies; see `tests/layout/run.mjs`).

## Maps

A map (`Name.map`) holds places (pins, optionally linked to documents), routes,
regions with terrain, labels, and characters' journeys on a story timeline. It starts
as a blank sheet at a scale, a picture (which can be traced to vectors), the Earth
(Natural Earth, bundled), or a star system with Kepler orbits. The logic is in
`src/lib/map/`, the UI in `src/map/` (`MapPane` → `MapSurface`, with `MapLayers` the
one renderer for the surface, thumbnails and export). Suites: `maplib`, `maptrace`,
`mapdom`.

- **Kind comes from the suffix only** (`docKind.js`, `doc_kind.rs`). Code that meant "not a text document" asks `!isTextDoc`, not `isCanvasDoc`: a
  map that reaches `saveDocument` is wiped.
- **A `.map` that is not a map is never written over.** People named text documents
  `Treasure.map` before maps existed. `loadMapDocument` returns `foreign`, and every
  map save checks the payload on disk first, in JS and in Rust.
- **Links survive renames.** `mapLinks.followMovedDoc` rewrites every map on disk and
  fires `map:doc-moved` so an open map changes in memory too; otherwise its next
  autosave writes the old path back.
- **Viewport and timeline day are saved but not undone.** They live in refs and are
  folded in at save time.
- **The story calendar is per project** (`.story/calendar.json`); `story-calendar:changed`
  tells open maps to re-read it.
- **Heavy things are lazy.** d3-geo and the atlases load only when an Earth map opens.
  The tracer runs in a module worker and falls back to the main thread if the worker
  will not start under `inkblot://`.
- **The inspector is a form the page builds** (`useMapPanel`, `inspector/panelBuilder.js`):
  sections of typed fields named by id (`MapPanel`, `bridge/map.rs`), drawn by the
  map's floating panel and the inspector's Map tab (`MapPanelView.jsx`), each edit sent
  back as `mapCommand { panel-field | panel-action, id }`. Add a field in the builder
  and both have it; add a field *type* in `map.rs` and draw it in `MapPanelView`.
- **What a map draws over itself** — the scale bar, compass, title, tool hint and
  timeline — is placed in `useVisibleBox`.
- **Rust twins only what Rust uses**: the kind, normalizing and creating maps, word
  counts, links, search matches and version entries. The maths (geometry, geodesy,
  travel, orbits, calendar) is JS only. Port a module, with parity cases, when Rust
  first needs it.

## Timeline

- **One chronology per project**, `.story/timeline.json` beside `.story/calendar.json`:
  events, lanes, eras and tags (`types/timeline.rs`, `src/lib/timeline/`). Timeline
  documents are views of it — scale, range, filters — so every view, document, map and
  canvas card shows the same events, and a change anywhere is drawn everywhere.
- **Time is the map's axis**: a float story day in the project calendar. A date is
  optional. `order`, a fractional-index key compared as a plain string, is sequence;
  `setEventTime` keeps a dated event's key between its dated neighbours, so sequence and
  chronology never disagree, and undated events are placed by key alone.
- **Links go one way by id and the other by path.** Everything names an event by id; an
  event names documents, map legs, canvas cards and notes by path, kept right through
  renames by `timelineLinks.js` (which also rewrites undo snapshots).
- **Passages live in their document**, in a ProseMirror plugin's state
  (`TimelineAnchors.js`): mapped through every transaction, restored with the cached
  EditorState, saved by the autosave with the text (`timeline` is carried forward by
  both the JS and Rust saves). A change that moves no text is saved alone
  (`saveDocumentTimeline`).
- **One store, previews and one undo** (`timelineStore.js`): a drag previews the
  chronology everywhere and commits on release. An undo step can carry `effects` on other
  files — a map leg moved with its linked event — so one ⌘Z puts both back. A map open in
  a pane claims a leg edit (`map:set-leg`) rather than being written under.
- **The story's "now" and the time lens** (`storyCursor.js`) are shared, unsaved state:
  maps scrub and follow the day; the lens is a window of time the editor highlights
  passages in, draggable in the lens bar and in any view.
- **Three layouts**: by date, in order, and the manuscript — passages in reading order
  (the book's compile order) joined to when they happen, flashbacks and flash-forwards
  found by `manuscriptThreads`.
- **Chrome of its own**: a timeline view draws its tool bar (`TimelineToolbar.jsx`) and
  its inspector, a `MapPanel` form drawn by `MapPanelView`, in the page. The logic is JS
  only; port it with parity cases when Rust first needs it.

## JavaScript and Rust parity

Several domain modules exist twice:
- JavaScript in `src/lib/`, which the page runs.
- Rust in `inkblot-core`, which the Tauri commands call.

The mirrored modules are `docKind`, `canvasGeometry`, `canvasModel`, `storyStructure`,
the version-history diff engine, project paths, version storage, search, the Read
Aloud chunker, and the note normalizers. `npm run parity` sends one corpus through
both and fails on any difference. A green run means something only if the harness can
fail, so after adding a case, break the Rust side on purpose and watch it fail.

"The same arithmetic" is not the same arithmetic. Every one of these was found by the
harness:

- **Float parsing.** serde_json's float parser is off by up to 1 ULP without the
  `float_roundtrip` feature (enabled workspace-wide; keep it).
- **Rounding ties.** Exact ties format differently: JS takes the even last digit, Rust
  the larger. Any string the core builds from a float goes through
  `js_number::format_js_number`, never `Display`.
- **NaN.** `Math.min`/`max` propagate NaN, and `f64::min`/`max` swallow it. Use
  `canvas_geometry::js_min`/`js_max`.
- **`Math.hypot`** is not correctly rounded and differs from `f64::hypot`. Use
  `js_hypot`.
- **`Math.round`** breaks ties toward +∞, while Rust rounds them away from zero.
- **Truthiness.** `Boolean(x)` is not `as_bool()`: `pinned: "yes"` is pinned. Use
  `notes::js_truthy`.
- **Strings.** `charCodeAt` iterates UTF-16 code units, and JS `\s`/`trim()` include
  U+FEFF. Both are handled in `js_string`.
- **Unpaired surrogates.** A JS regex without the `u` flag can match half a surrogate
  pair, which a Rust `String` cannot hold. The harness counts such cases as
  unrepresentable, and fails a function only if every case is.

Deliberate divergences, each documented where it lives:
- `normalize_canvas` drops an edge whose endpoints are not strings.
- `diff_canvases` compares parsed content rather than serialized JSON.
- `store::rename_project` refuses a name any project already holds.
- `normalize_note` accepts a non-object.

The last two fix bugs the JS still has. Whether to fix the JS too is an open decision.

## Recipes

**A bridge command or event.** Follow the steps in the header of
`src-tauri/crates/inkblot-core/src/bridge/mod.rs`:
1. Add a named payload struct and the enum variant.
2. Add a wire-name test.
3. Run `npm run types`.
4. Handle it in `src/bridge/surface.ts` (or a delegate the app registers), and use it
   from the chrome.

**A domain type.** Define it in `inkblot-core/src/types/` with `#[typeshare]` and
`#[serde(rename_all = "camelCase")]`, then run `npm run types`. Keep these limits in
mind:
- typeshare rejects `#[serde(flatten)]`. Mark such fields `#[typeshare(skip)]` and add
  a `Stored*` type in `src/types/index.ts`.
- It only emits adjacently tagged enums.
- It does not map `BTreeMap`; use `HashMap`.
- Generated string enums don't compare to literals in TypeScript: use
  `TreeNodeType.Folder`, not `'folder'`.

**A Tauri command.** See the header of `src-tauri/src/lib.rs`:
1. Put the logic in a crate.
2. Wrap it in a `*_commands.rs` module and register it.

**A model.** See the header of `inkblot-models/src/lib.rs`:
1. Write the engine (status, download, inference, and `MODEL_NOT_INSTALLED` when the
   model is missing).
2. Add the Tauri wrapper.

**Chrome that mirrors page state.**
1. The document surface publishes the state as an event (a hook in `src/hooks/`, or
   `surface.ts`).
2. It applies a command for every change.
3. The chrome renders the latest event (`useLatestBridgeState`) and sends commands. It
   never keeps a second copy of the state.

`useTabsPublisher` and the tab bar are the worked example.

**A toolbar item.** See `src/lib/chromeLayout.ts` and `components/toolbar/registry.jsx`.
1. Add it to `TOOLBAR_ITEMS` with an id `inkblot.<area>.<name>`, a label, a semantic
   icon name (`src/ui/icons.js`) and its contexts. Ids are keys in people's saved layouts: never rename or reuse
   one; a removed item's id goes in `RETIRED_TOOLBAR_IDS`.
2. Add its component to `registry.jsx`, built from `ToolbarControls.jsx`.
3. Add it to a default set only if every new user should see it.
4. **Disable, never omit.** An item that returns nothing moves the rest of the layout.
5. If it has on/off state, the surface publishes it: editor facts in
   `ToolbarState`/`ActiveMarks`, canvas facts in `CanvasToolbarState`, app settings in
   `ViewOptions`.
6. Add its id to the list in `tests/unit/chromeLayout.mjs`.

**A test suite.** See the header of `tests/unit/run.mjs`.

**Porting a JS function to Rust.** Write it against the pitfalls above. Add a case
module in `tests/parity/cases/` whose `expected` comes from calling the real JS
function, and add an arm in `inkblot-core/src/bin/parity.rs`. Break the Rust side once
to prove the case can fail.

## Things that will bite you

**Code**

- **Mount it or it's untested.** A component that throws on every render passes lint,
  tsc and the production build. Every component with logic worth keeping should be
  mounted by a suite.
- **A hook argument read before its `const` throws** (temporal dead zone), and nothing
  static notices, because it is an argument rather than a statement. When a hook needs
  `editor` before `const editor = useEditor()` can run, pass an accessor:
  `getEditor: () => editor`.
- **Pass mutable state as an accessor, not a value.** Node views replace their
  attribute objects on every commit, and TipTap editors are replaced when a pane swaps
  documents. The editor registry and the node-view factories take accessors for this
  reason.
- **Extracting `useState` setters or refs into a custom hook's parameters trips the
  React Compiler** (`react-hooks/preserve-manual-memoization`). Adding them to the
  dependency array is a runtime no-op, because their identities never change.
- **Anything inside a template literal is not the source you see.** `\S` in a template
  literal is `S`. Derive injected scripts from the emitted string, or keep them in
  their own file loaded with `?raw` (as `src/lib/pinterestScripts/` does).
- **Pinterest's scrape script** keeps a `new Function` syntax check before injection.
  IPC reports a script that throws, but not one that fails to parse.
- **`pinterest_report_scrape` is reachable from pinterest.com** only because the app
  ships no Tauri permission manifest. Adding a `src-tauri/permissions/` directory
  breaks it; see `inkblot-models/src/scrape.rs`.
- **`readAloudVoice.ts` is a transcription** of kokoro-js's private normalizer. Don't
  "tidy" its regexes. The `voice` suite compares it with the real function at test
  time. Kokoro's phoneme vocabulary is read from the downloaded model and must never be
  written out by hand.
- **`Editor.css` is an ordered `@import` manifest**, and the order decides which of
  several duplicate selectors wins. Don't reorder it, or move a section's import into
  its component.
- **Close a document before renaming, moving or deleting it.** A pane that lets go of
  a document flushes its pending autosave to the path it had, so a rename recreated the
  old file and a delete did not stick. Every caller goes through
  `lib/entryOperations`, which closes what an entry touches, waits for those writes on
  the document locks, does the disk operation and reopens at the new paths. The lock
  is a queue, not re-entrant: taking it twice hangs.
- **Suite timing.** Autosave debounces at 800 ms and the version checkpoint at 15 s.
  Suites don't wait these out. Switching documents flushes both, which is the path
  worth asserting on anyway.

**Builds**

- **Never set `MACOSX_DEPLOYMENT_TARGET` in the environment for a Rust build.** It
  reaches the host's proc-macro dylibs, and dyld then refuses to load them ("mis-aligned
  LINKEDIT string pool"). If you set it once, delete the stale
  `target/release/deps/*.dylib`.
- **cmake and `ort-sys` cache their builds.** After changing compiler flags or
  toolchains, run `cargo clean -p whisper-rs-sys --release --target aarch64-apple-darwin`
  or `cargo clean -p ort-sys`.

## Known gaps

**Not yet verified by hand**
- **The web chrome in the running app.** It was checked in Chromium and in the unit
  suites: the tab bar (a tab's context menu, drag to reorder, a document dropped from
  the file tree), the toolbar's » overflow, the menus (Insert, Format, Timer, View),
  notifications and the tray title, and the timer's sounds.
- **Print Layout:** a real print and PDF, the Page Setup sheet, a folded 16-page
  signature, an EPUB in Apple Books or `epubcheck`, and a Pinterest embed in print (a
  cloned iframe reloads, and may print blank).
- **Maps:** the map tracer's worker, the Earth chunks' first-open latency, and the
  fantasy themes' SVG filter cost at high zoom.
- **Timeline:** driven in WebKit through a harness (drag, undo, the lens, the three
  layouts); not yet clicked through in the running app.
- **Offline launch.** Launch the bundled `.app` with the network off, and check that
  the synonym model loads from AppData and dictation finds its model.
- **Read Aloud's native voice** on a machine with no Python installed.
- **A Pinterest board scrape** against a live, logged-in session.

**Not built**
- **The Kokoro download.** The page never offers it (`download_kokoro_model` exists),
  so native Read Aloud needs the model installed by other means and otherwise falls
  back to kokoro-js's in-browser WASM build.
- **Timeline, still to come:** version history for the chronology, a timeline view in
  the window's toolbar and inspector (it keeps its own in the page), attaching an
  existing note to an event, continuity checks, relative dates, and export.
- **Reminders while Inkblot is closed.** The page posts them while it runs; nothing is
  left with the system to fire later.
- **Toolbar items** still wanted: New Document/Canvas/Folder, Bubble, workbench
  lookups, and focusing the inspector's search.

**iOS and iPadOS**

The plan is Tauri 2's iOS target: the same page, with a small Swift plugin for the few
controls that should be Liquid Glass. The models are the open question — `ort` has no
iOS library and whisper.cpp's cmake has not been run for the iOS SDKs.
