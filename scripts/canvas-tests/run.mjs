/**
 * Headless checks for the canvas feature.
 *
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
 *   html   generateHTML(): how every non-editing card and document preview renders
 *   dom    the real CanvasSurface mounted in jsdom, under StrictMode like the app
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
const SUITES = ['m0', 'geo', 'red', 'edge', 'card', 'asset', 'group', 'snap', 'search', 'note', 'audio', 'html', 'dom']

let failed = false

for (const suite of SUITES) {
  console.log(`\n=== ${suite} ===`)
  const before = process.exitCode
  await import(`./${suite}.mjs`)
  if (process.exitCode && process.exitCode !== before) failed = true
}

console.log(failed ? '\nFAILURES above.' : '\nAll suites passed.')
