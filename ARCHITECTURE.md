# Architecture

How Inkblot is put together, the rules that keep it working, and how to add to it.
Setup and the checks are in the [README](README.md). The details of any one module are
in its header comment. This document covers what spans modules.

## The pieces

```text
 Swift app (native/)                             WKWebView — dist/, unmodified
 ───────────────────                             ─────────────────────────────
 FileTreeSidebar, InspectorView,                 React chrome (toolbar, panes;
 WorkspaceOverlay, InkblotCommands               the sidebars when not native)
        │                                                │
   ShellBridge ◄── bridge protocol (JSON) ──► createNativeHostTransports
   (Bridge/)          native-host.js             (src/bridge/transport.ts)
                                                 merged with the in-process
                                                 React shell
   TauriHost ◄──── Tauri IPC (JSON) ──────── tauri-shim.js
   (Web/)        window.__TAURI_INTERNALS__      (the page calls Tauri's API)
     ├─ ModelService ─► InkblotModels ┐
     └─ AuxiliaryWindows              ├─ inkblot-ffi (UniFFI) ─► inkblot-core
   CoreService ─────► InkblotCore ────┘                         inkblot-models
   AppSchemeHandler: inkblot://app/ (dist) · asset://localhost/ (files on disk)

 Tauri app: the same page, the in-process transport only, and
            src-tauri/src/*_commands.rs ─► inkblot-core, inkblot-models
```

- **The page** (`src/`) is the editor and everything around it. It is the same bundle
  in both apps. It never checks which app it is in at build time. It asks the host at
  runtime which chrome to draw (`src/lib/host.ts`).
- **`inkblot-core`** is domain logic with no knowledge of any shell. That covers
  persistence, search, version history, the canvas model and the bridge protocol
  types.
- **`inkblot-models`** holds the on-device models, also shell-independent.
- **The Tauri app** wraps both crates as `#[tauri::command]`s.
- **The Swift app** reaches both crates through `inkblot-ffi`. It answers the page's
  Tauri calls in `TauriHost`, and talks to the page about chrome over the bridge.

## Data model

- **A canvas is a document kind, not a view mode.** The routing is purely the
  `.canvas` path suffix (`docKind`). A canvas occupies a pane like any document, so
  split view can show a canvas beside prose. On disk it is `<name>.canvas.json` in the
  open JSON Canvas format, so it round-trips with Obsidian. Unknown keys are preserved.
- **A canvas hosts at most one live TipTap editor**, the card being edited
  (`editingNodeId`). Every other card is static HTML from `generateHTML`.
- **Text documents** are `<path>.json`: `{ content, notes, versions? }`.
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

  They are not in `localStorage`, which a `WKWebView` keeps where native code cannot
  read it. The page hydrates them before React mounts and reads them synchronously
  afterwards (`src/lib/preferences.ts`). Per-launch values (the project-open id, the
  Pinterest refresh flag) stay in memory. File-tree order and expansion are
  machine-local, so they are never written into the project.
- **Every offset is a UTF-16 code unit**: ProseMirror positions, JS string indices,
  and every offset on the bridge. A Rust byte or `char` offset is neither. Convert
  with `inkblot_core::js_string`.

## The bridge protocol

The page and a shell talk through a protocol defined once in Rust
(`src-tauri/crates/inkblot-core/src/bridge/`) and generated into TypeScript
(`src/types/inkblot-core.ts`) and Swift (`Generated/InkblotCore.swift`).

- `InboundMessage` (shell → page) carries `NativeCommand`s and `BridgeRequest`s.
- `OutboundMessage` (page → shell) carries `WebviewEvent`s and `BridgeReply`s.
- Every enum is adjacently tagged (`{ type, payload }`). That makes a discriminated
  union in TypeScript and a `Codable` enum in Swift, so an unhandled case is a compile
  error on both sides.
- **Every request gets a reply**, with an error if necessary. A shell waiting on an
  answer that never comes is a hang with no symptom, and the commonest cause is
  ordinary: the user closed the pane.
- **No message carries a bare ProseMirror position.** A place in a document is a
  `TextAnchor`: positions plus the text they covered. `resolveAnchor`
  (`src/bridge/anchors.ts`) trusts the positions only while they still cover the text.
  Otherwise it searches for the text, and it returns `null` when the text is gone.
  Callers must handle `null`, and a guessed position is always worse. One command,
  `setCaretAtDocPos`, is exempt, and a Rust test keeps it the only one.
- **High-rate events are coalesced to one per frame.** This is only safe for events
  that carry the whole current state (`notesRemapped`, `toolbarState`), never a delta.
  Check that property before using `createCoalescer`.
- **The React chrome runs on the protocol too**, through an in-process transport
  that round-trips every message through JSON. A payload that could not cross a
  process boundary therefore fails in the test suites.
- **In the Swift app, the native shell joins the wire beside the React chrome**
  (`createNativeHostTransports`):
  - Events go to both shells.
  - Commands from both are merged and re-sequenced into one stream.
  - Native request ids are prefixed, so each shell gets its own replies.
  - This is how some chrome can be native (file tree, inspector, tab dock) while the
    rest stays in the page (the formatting toolbar).
- **State stays in the page.** Native chrome renders what the page publishes and
  changes it by command. For example, `useNativeSidebar` publishes notes and applies
  `updateNote`. Notes are edited by `NotePatch`, never sent whole: `Note` preserves
  keys typeshare cannot express, and a whole note sent back would drop them.
- **The Tauri shim.** The page calls Tauri's API for files, dialogs, menus and windows.
  In the Swift app, `Web/tauri-shim.js` implements `window.__TAURI_INTERNALS__`:
  - It keeps callbacks, events and menu trees in the page.
  - It forwards only what needs the machine to `TauriHost`.
  - Bytes cross as base64.
  - `scripts/canvas-tests/shim.mjs` drives it through the real `@tauri-apps/api`
    modules.
- **Structured values cross UniFFI as JSON strings** of the typeshare types. This keeps
  one definition per type instead of a second, UniFFI-generated one.

## JavaScript and Rust parity

Several domain modules exist twice:
- JavaScript in `src/lib/`, which the page runs.
- Rust in `inkblot-core`, which the Swift app and the Tauri commands call.

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
4. Handle it in `src/bridge/surface.ts` (or a delegate the app registers).
5. Handle it in Swift.

**A domain type.** Define it in `inkblot-core/src/types/` with `#[typeshare]` and
`#[serde(rename_all = "camelCase")]`, then run `npm run types`. Keep these limits in
mind:
- typeshare rejects `#[serde(flatten)]`. Mark such fields `#[typeshare(skip)]` and add
  a `Stored*` type in `src/types/index.ts`.
- It only emits adjacently tagged enums.
- It does not map `BTreeMap`; use `HashMap`.
- A `#[serde(default)]` field becomes optional in Swift.
- Generated string enums don't compare to literals in TypeScript: use
  `TreeNodeType.Folder`, not `'folder'`.

**A Tauri command.** See the header of `src-tauri/src/lib.rs`:
1. Put the logic in a crate.
2. Wrap it in a `*_commands.rs` module and register it.
3. Answer the same command name in the Swift app's `TauriHost` (or `ModelService`).

**A model.** See the header of `inkblot-models/src/lib.rs`:
1. Write the engine (status, download, inference, and `MODEL_NOT_INSTALLED` when the
   model is missing).
2. Add the Tauri wrapper.
3. Add the method to both `inkblot-ffi/src/models.rs` and `models_unavailable.rs`,
   with identical signatures and doc comments.
4. Add the `ModelService` case, then run `./scripts/build-xcframework.sh`.

**An FFI export.** See the header of `inkblot-ffi/src/lib.rs`. Then run
`./scripts/build-xcframework.sh`: the Swift bindings must come from the same build as
the library.

**Native chrome that mirrors page state.**
1. The page publishes the state as an event, from a `useNative*` hook in `src/hooks/`.
2. The page applies commands for every change.
3. `src/lib/host.ts` gains a `nativeOwns` part, so the page stops drawing its own
   version when the shell says it draws it.
4. The Swift side renders the latest event and sends commands. It never keeps a
   second copy of the state.

`useNativeSidebar` and `useNativeTabDock` are the worked examples.

**A test suite.** See the header of `scripts/canvas-tests/run.mjs`.

**Porting a JS function to Rust.** Write it against the pitfalls above. Add a case
module in `scripts/parity/cases/` whose `expected` comes from calling the real JS
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
- **Suite timing.** Autosave debounces at 800 ms and the version checkpoint at 15 s.
  Suites don't wait these out. Switching documents flushes both, which is the path
  worth asserting on anyway.

**Builds**

- **Never set `MACOSX_DEPLOYMENT_TARGET` in the environment for a Rust build.** It
  reaches the host's proc-macro dylibs, and dyld then refuses to load them ("mis-aligned
  LINKEDIT string pool"). `build-xcframework.sh` targets the app's OS through
  `CFLAGS_<triple>` instead. If you set it once, delete the stale
  `target/release/deps/*.dylib`.
- **cmake and `ort-sys` cache their builds.** After changing compiler flags or
  toolchains, run `cargo clean -p whisper-rs-sys --release --target aarch64-apple-darwin`
  or `cargo clean -p ort-sys`.
- **`uniffi-bindgen --library` must run from `src-tauri/`.** It runs `cargo metadata`
  in the working directory.
- **The generated UniFFI bindings are made `nonisolated`** by `build-xcframework.sh`.
  The app target defaults to the main actor, which would otherwise make every Rust
  call main-thread-only.
- **UniFFI already makes its error type `LocalizedError`.** Adding the conformance again
  is a redeclaration error.
- **`WKWebView` refuses module scripts from `file://`.** That is why the page is served
  from the `inkblot://` scheme.
- **The Swift decoder drops a whole message** when one required field is missing
  (`try?` per case). `ShellBridge` logs the raw JSON when that happens. Check that log
  first if the native side seems deaf.
- **Reset the bridge's sequence counters when a navigation commits**, not when it
  finishes. The page starts sending as soon as its scripts run.
- **A `GlassEffectContainer` draws its glass over plain content inside it.** Put
  `.glassEffect` on the content view, or keep content outside the container.
- **A real window toolbar would swallow the page's clicks.** The Mac window uses a
  hidden titlebar, and `WindowChrome` places the traffic lights. AppKit resets them on
  every titlebar layout.

## Swift app project settings

These differ from Xcode's template on purpose:

- **App sandbox off.** The app reads the Tauri app's data folder
  (`~/Library/Application Support/com.inkblot.app`, not this bundle's container), and
  projects can live anywhere on disk.
- **User script sandboxing off.** The Embed Web Bundle phase has to read `dist/`, and
  it also copies `src-tauri/resources/minilm-tokenizer.json` into the app.
- **Platforms:** macOS, iPadOS and iOS. The entitlements file applies to macOS only,
  and the simulator build excludes x86_64 (the Rust slices are arm64).
- **`OTHER_LDFLAGS`** lists what the Rust static library needs, because it carries no
  autolink information:
  - CoreText, CoreGraphics and libiconv, for font-kit
  - `-lc++`, Accelerate, Metal and MetalKit, for whisper.cpp and onnxruntime
  - AudioToolbox and CoreAudio, for cpal

  To regenerate the list, run `cargo rustc -p inkblot-ffi --lib --crate-type staticlib
  --release -- --print native-static-libs`.
- The Xcode project, target and Swift module are named `inkblot-core`/`inkblot_core`.
  That is the app, not the Rust crate of the same name.

## Known gaps

**Not yet verified by hand**
- **The Swift app's native UI** was built without anyone seeing it. That covers the
  file tree, inspector, tab dock, new-tab chooser, sentence bubble, detached and
  Pinterest windows, drops onto a canvas, and model downloads. Click through it with
  the Tauri app closed.
- **Offline launch.** Launch the bundled Tauri `.app` with the network off, and check
  that the synonym model loads from AppData and dictation finds its model.
- **Read Aloud's native voice** on a machine with no Python installed.
- **A Pinterest board scrape** against a live, logged-in session.

**Not built**
- **The Kokoro download.** The page never offers it (`download_kokoro_model` exists in
  both apps), so native Read Aloud needs the model installed by other means and
  otherwise falls back to kokoro-js's in-browser WASM build.
- **A native context menu** built from the `getSelectionContext` request, which would
  take the page out of the right-click. Today's menus are the page's, shown through
  `WebMenus`.

**iPadOS and iOS**

The app builds and links for devices and the simulator, but has not been run: it needs
an iOS 26+ simulator runtime (`xcodebuild -downloadPlatform iOS`). Missing:
- **The models.** `ort` has no iOS library, and whisper.cpp's cmake has not been run
  for the iOS SDKs. The iOS slices use `models_unavailable.rs`. To enable them, link
  an onnxruntime built for iOS (`ORT_LIB_LOCATION`) and drop `--no-default-features`
  for the iOS targets in `build-xcframework.sh`. Rhymes and the scrape channel need no
  ONNX, so splitting `inkblot-models`' features would bring those first.
- **Context menus.** A long press shows WebKit's own menu, and the page's
  `contextmenu` handler never runs.
- **Save panels, and folders outside the app's container.** A picked folder is lent
  for a security scope nothing holds open. Projects live in the app's container.
- **Detached documents side by side.** A detached window is presented over the app,
  not as a second scene.

**Warnings**
Four Swift compiler warnings remain:
- main-actor statics called from nonisolated contexts in `NotesPanelView`,
  `NotePreviewOverlay` and `ClipboardPanelView`
- a deprecated `Text` `+` in `HistoryPanelView`
