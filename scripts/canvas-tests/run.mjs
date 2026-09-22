/**
 * Headless checks for the canvas feature.
 *
 *   npm test                                               (from the repo root)
 *   node --experimental-loader ./loader.mjs run.mjs        (from this directory)
 *
 * The app is a Tauri desktop app, so most of it can only be exercised in the
 * webview. These suites cover the parts that are pure logic — the parts where a
 * bug is silent and expensive:
 *
 *   m0     document persistence, and the guard that stops saveDocument() from
 *          overwriting a canvas with an empty text document
 *   geo    viewport math (the zoom-to-cursor invariant, zoom-to-fit)
 *   red    the reducer and undo/redo (one step per gesture; delete takes edges)
 *   edge   edge anchors, normals, bezier paths
 *   card   the canvas card's TipTap schema vs. every Toolbar command
 *   asset  the content-addressed image store
 *   group  group create/ungroup, and the geometric membership a drag resolves
 *   snap   the alignment math behind a drag
 *   search finding text in a canvas (which used to silently match nothing)
 *   note   the note model, and note cards as file nodes
 *   audio  voice memos: mime resolution, the asset store, dedupe
 *   html   generateHTML(): how every non-editing card and document preview renders
 *   dom    the real CanvasSurface mounted in jsdom, under StrictMode like the app
 *   editor the real EditorCanvas mounted in jsdom: autosave, version checkpoints,
 *          the per-doc editor-state cache, and note anchor remapping — the paths
 *          where a bug loses the user's writing without saying anything
 *   tree   the file tree's per-row decisions: highlight states, icons, and where a
 *          drop indicator goes
 *   prefs  the preference store's webview half: which file a key lands in, that reads
 *          are synchronous after hydration, and that a failed write is survivable
 *   voice  the Read Aloud text normalizer, against the one inside kokoro-js — a
 *          transcription, so it is compared with its original rather than trusted
 *   bridge the Phase 4 protocol client, both ends: that a command reaches the editor
 *          it names, that a request is always answered rather than left hanging, that
 *          coalescing drops intermediate values and never the last one, and that the
 *          drag hand-off arbitrates instead of depending on running order; and that
 *          the native shell can join the wire beside the React one (Phase 5)
 *   entries renaming, moving and deleting the document being written in: the pane's
 *          final autosave must not recreate the old path
 *   shim   the Tauri IPC shim the Swift shell injects: bytes, events, and menus, driven
 *          through the real @tauri-apps/api modules
 *
 * The @tauri-apps modules are stubbed (stub-*.mjs) with an in-memory filesystem,
 * so the REAL FileSystem.js / assets.js run against them rather than a
 * reimplementation. loader.mjs maps those imports and resolves the extensionless
 * relative imports that Vite allows but Node does not.
 *
 * The `html` suite installs a jsdom document, because prosemirror-model binds to
 * `window.document` at module scope and throws under bare Node — which is what had
 * left static card rendering, the most-travelled path on a canvas, untested.
 *
 * Still not covered: anything involving layout, pointer events, or the asset://
 * protocol. Those need the real webview.
 */
const SUITES = ['m0', 'geo', 'red', 'edge', 'card', 'asset', 'group', 'snap', 'search', 'note', 'audio', 'html', 'dom', 'editor', 'tree', 'prefs', 'voice', 'bridge', 'shim', 'entries']

const failures = []

for (const suite of SUITES) {
  console.log(`\n=== ${suite} ===`)

  // Each suite reports by setting process.exitCode, so snapshot and clear it around
  // every import — otherwise the first failure masks each one after it.
  process.exitCode = 0
  try {
    await import(`./${suite}.mjs`)
  } catch (error) {
    // A suite that throws must not take the rest of the run down with it. That is
    // how four suites sat silently unrun behind one stale assertion.
    console.error(`ERROR  ${suite} threw and was abandoned:`)
    console.error(error)
    process.exitCode = 1
  }
  if (process.exitCode) failures.push(suite)
}

if (failures.length) {
  console.log(`\nFAILURES in: ${failures.join(', ')}`)
  process.exitCode = 1
} else {
  process.exitCode = 0
  console.log('\nAll suites passed.')
}
