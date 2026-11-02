/**
 * The webview's test suites, run headless under Node.
 *
 *   npm test                                               (from the repo root)
 *   npm test -- landing focus                              (only those suites)
 *   npm test -- --verbose                                  (every PASS line too)
 *   node --experimental-loader ./loader.mjs run.mjs        (from this directory)
 *
 * PASS lines are counted, not printed, unless --verbose (or TEST_VERBOSE=1): a full
 * run makes about 3,000 of them and they bury the FAIL lines. Anything else a suite
 * prints appears under that suite's heading.
 *
 * They cover the parts of the page where a bug is silent and expensive, and mount the
 * components whose failures nothing static can see (a component no test mounts can
 * throw on every render while lint, tsc and the build all pass):
 *
 *   persistence  document persistence, and the guard that stops saveDocument() from
 *          overwriting a canvas with an empty text document
 *   geo    viewport math (the zoom-to-cursor invariant, zoom-to-fit)
 *   red    the reducer and undo/redo (one step per gesture; delete takes edges)
 *   edge   edge anchors, normals, bezier paths
 *   card   the canvas card's TipTap schema vs. every Toolbar command
 *   asset  the content-addressed image store
 *   group  group create/ungroup, and the geometric membership a drag resolves
 *   snap   the alignment math behind a drag
 *   search finding text in a canvas
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
 *   speech Read Aloud's speech from the page's side: the voices agree with Rust's, the
 *          samples arrive intact, and a missing model is not mistaken for a missing backend
 *   bridge the bridge protocol client, both ends: that a command reaches the editor
 *          it names, that a request is always answered rather than left hanging, that
 *          coalescing drops intermediate values and never the last one, that the
 *          drag hand-off arbitrates instead of depending on running order, and that
 *          the native shell can join the wire beside the React one
 *   entries renaming, moving and deleting the document being written in: the pane's
 *          final autosave must not recreate the old path
 *   sidebar the right sidebar drawn by the shell: what the page publishes, and each
 *          edit applied the way the React panel applied it
 *   bubble a sentence taken apart into bubbles: the word and clause rules, where a drop
 *          lands, and a session written back into a real editor — kept, reopened,
 *          round-tripped through JSON and HTML, resolved behind a checkpoint
 *   references citations: what a paste is, what a page says about itself, citeproc in the
 *          bundled styles, lookups against canned answers, and the library file
 *   citations citations and the bibliography in a real editor: the renderer, style changes,
 *          round trips, and the bibliography added on paper, a book numbered through
 *   finishing the Finishing tabs' page half: formats, which setup prints, what the
 *          controller publishes and when, and the print queue
 *   print  Print Layout's pure logic: page sizes and geometry, where pages break,
 *          and signature imposition for binding
 *   typeset how a book's chapters open, its contents, covers and history, and what an
 *          old book reads as the first time it is typeset
 *   tabs   document tabs and split view: what closing a tab leaves in each pane, and
 *          the tabs as the tab bar reads them, driven over the bridge
 *   css    the stylesheets keep to the design system: no decorative gradients, the
 *          one blur token, no prefers-color-scheme duplicates
 *   ui     the shared controls (src/ui): reorder and placement math, native menus,
 *          and the controls mounted
 *   inkwheel the ink wheel: the ring and drag arithmetic, the swap and its undo, and
 *          the control driven by keyboard and by a mouse drag
 *   icons  every icon name in src/ is registered in src/ui/icons.js, and each means one
 *          thing: trash deletes, × closes, the magnifier finds, no glyph has two names
 *   help   every help topic a control points at exists in src/lib/help.ts
 *   conversation  a chat tile's style (Inkblot, iMessage, Generic), its legacy look,
 *          its snapshot, and the DOM icon helper node views draw with
 *   chromeLayout what the toolbars and the inspector hold: the item ids, default sets,
 *          and every migration a saved layout goes through
 *   toolbar the toolbars drawn from their layouts: every item renders disabled with no
 *          state, what a customize drag does, the palette and the display modes
 *   inspector the inspector's two layouts: Customize Inspector Layout… mounted, and a
 *          layout that follows the window's mode
 *   stats  the writing stats: the tracker, the timer, goals, streaks, deadlines,
 *          reminders, rhythm and the config, on clocks of their own
 *   statsdom the stats running in the page: the tracker fed by the bridge, the Stats
 *          tab, the timer capsule and the settings sheet
 *   book   the Book navigator: the book's rows, commands, where a drop lands
 *   notegeom where a note's hover card goes
 *   timeline the story's chronology: sequence keys, dated and undated events in one order,
 *          the lens, flashbacks in the manuscript, renames followed, undo across
 *          files, and passages kept on their words in a real editor and on disk
 *   spaceswipe the sidebars' swipe between panels: one panel per flick, several when
 *          held, and the momentum after a lift swallowed
 *   locks  locked documents and folders: the flag kept through every save, folder
 *          markers, the editor and the canvas and map refusing edits, the badge
 *   keys   keyboard shortcuts: the notation, rebinding, conflicts, the one key
 *          handler, and Settings ▸ Shortcuts recording a new one
 *   tables cell fills and table borders in the document and the exports, and the
 *          table toolbar's tools
 *   presets the writer's own folder types: matching, saved with the project, the sheet
 *   updates after an update: once per version, highlights from a release, the banner
 *   windows a tab dragged out into a window of its own, put back, kept on top
 *   emptiness which notes, documents and folders are blank enough to delete without asking
 *   reveal content arriving: a quick load shows no skeleton, a slow one holds it long
 *          enough not to flicker, a gate waits for every piece, and the parallel tree
 *          read and the prefetch read what they should, once
 *   landing the landing page: excerpts and the recent list kept and moved with their
 *          documents, a pile's sheets, a sheet's flight onto the card, the frost AA
 *          over the footage, and the page mounted
 *   focus  focus mode: the document as sentences and where the caret is among them,
 *          and the overlay driving a real editor — ↑/↓ to the end and past it, a typed
 *          space shown, its keys kept out of a palette over it
 *   physics motion is physical: the spring against its equation, velocity kept through a
 *          release and a retarget, the same at any refresh rate, Apple's projection and
 *          rubber band, and the --spring-* tokens generated from the same springs
 *   selection several rows chosen in the file tree and the Book: ⌘- and ⇧-clicks, entries
 *          moved and deleted together, and the Book's selection menu
 *   affected scripts/affected.mjs: the import graph, scanning suites, Mirrors: twins and
 *          the Rust commands it prints for a set of changed files
 *   hooks  the Claude Code hooks: the writer's own documents kept out of every session,
 *          and commands that would flood one blocked
 *
 * The @tauri-apps modules are stubbed (stub-*.mjs) with an in-memory filesystem,
 * so the REAL FileSystem.js / assets.js run against them rather than a
 * reimplementation. loader.mjs maps those imports, resolves the extensionless
 * relative imports that Vite allows but Node does not, and transpiles .jsx and .ts.
 *
 * The `html` suite installs a jsdom document, because prosemirror-model binds to
 * `window.document` at module scope and throws under bare Node.
 *
 * Adding a suite: write `<name>.mjs` using `ok` from assert.mjs, and add its name to
 * SUITES below. Mount real components under StrictMode where you can (see dom.mjs,
 * editor.mjs), and give them stable callback props — a fresh identity per render can
 * turn a load effect into an infinite loop that hangs the suite instead of failing it.
 *
 * Not covered: layout, real pointer events, the asset:// protocol, the context menu,
 * session restore, file-tree drag, note previews, Pinterest embeds, and editor
 * paste/drag. Those need the real webview.
 */
const SUITES = ['persistence', 'geo', 'red', 'edge', 'card', 'asset', 'group', 'snap', 'search', 'note', 'audio', 'html', 'dom', 'editor', 'tree', 'prefs', 'speech', 'bridge', 'entries', 'sidebar', 'bubble', 'print', 'finishing', 'typeset', 'references', 'citations', 'maplib', 'maptrace', 'mapdom', 'mapchrome', 'tabs', 'css', 'ui', 'inkwheel', 'icons', 'help', 'chromeLayout', 'toolbar', 'inspector', 'stats', 'statsdom', 'book', 'notegeom', 'timeline', 'conversation', 'spaceswipe', 'locks', 'keys', 'tables', 'presets', 'updates', 'windows', 'emptiness', 'reveal', 'landing', 'selection', 'focus', 'physics', 'toolwheel', 'affected', 'hooks']

const args = process.argv.slice(2)
const verbose = args.includes('--verbose') || process.env.TEST_VERBOSE === '1'
const chosen = args.filter((arg) => !arg.startsWith('--'))
const unknown = chosen.filter((name) => !SUITES.includes(name))
if (unknown.length) {
  console.error(`No suite named ${unknown.join(', ')}. The suites: ${SUITES.join(', ')}`)
  process.exit(1)
}
const toRun = chosen.length ? SUITES.filter((name) => chosen.includes(name)) : SUITES

const print = { log: console.log, error: console.error, warn: console.warn }
let current = null
let headed = false
let passes = 0
const heading = () => {
  if (headed || !current) return
  headed = true
  print.log(`\n=== ${current} ===`)
}
if (!verbose) {
  console.log = (...parts) => {
    if (typeof parts[0] === 'string' && parts[0].startsWith('PASS  ')) {
      passes++
      return
    }
    heading()
    print.log(...parts)
  }
  // Expected warnings (a preference write the harness refuses, a guarded save) log an
  // Error each; its message says what happened, and its stack is mostly React's.
  const brief = (part) => (part instanceof Error ? `${part.name}: ${part.message}` : part)
  console.warn = (...parts) => {
    heading()
    print.warn(...parts.map(brief))
  }
  console.error = (...parts) => {
    heading()
    print.error(...parts.map(brief))
  }
}

const failures = []

for (const suite of toRun) {
  current = suite
  headed = false
  if (verbose) heading()

  // Each suite reports by setting process.exitCode, so snapshot and clear it around
  // every import — otherwise the first failure masks each one after it.
  process.exitCode = 0
  try {
    await import(`./${suite}.mjs`)
  } catch (error) {
    // A suite that throws must not take the rest of the run down with it, or one
    // broken suite would hide every suite after it.
    heading()
    print.error(`ERROR  ${suite} threw and was abandoned:`)
    print.error(error)
    process.exitCode = 1
  }
  if (process.exitCode) failures.push(suite)
}
current = null

const ran = `${toRun.length} suite${toRun.length === 1 ? '' : 's'}`
const passed = verbose ? '' : `, ${passes} assertions passed`
if (failures.length) {
  print.log(`\nFAILURES in: ${failures.join(', ')} (${ran}${passed})`)
  process.exitCode = 1
} else {
  process.exitCode = 0
  print.log(`\nAll ${ran} passed${passed}.`)
}
