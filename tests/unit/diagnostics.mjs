/**
 * Bug reports and crash reports (src/lib/diagnostics): that a report never carries a
 * writer's words.
 *
 * The rule has three layers, and each is tested on its own and then together:
 *
 *   - the allowlist: a string survives `summarize` only under a key known to hold an
 *     id, a mode or a name, so a selection's text, a heading's title and a read-aloud
 *     chunk come out as lengths;
 *   - the console: a log call keeps its message and errors, not its other arguments;
 *   - the leak guard: a finished report shares no run of four words with an open
 *     document, even when an error message or the writer's own note quotes one.
 *
 * Then the plumbing: bounded logs, crashes saved once per distinct error, a missing
 * native side answering null rather than throwing, and Report a bug… mounted, from
 * the command to the file the native side is asked to write.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { setInvokeHandler } from './stub-core.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent',
  'MutationObserver', 'getComputedStyle', 'DOMParser', 'CSS'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
dom.window.scrollBy = () => {}
const noRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })
for (const proto of [dom.window.Element.prototype, dom.window.Range.prototype, dom.window.Text.prototype]) {
  proto.getClientRects ??= () => []
  proto.getBoundingClientRect ??= noRect
}

const written = []
let native = true
setInvokeHandler(async (command, args) => {
  if (command === 'preferences_load') {
    return { app: { 'inkblot-theme': 'dark', 'inkblot-clipboard-history': '["She kept the letter folded in her coat"]' } }
  }
  if (!native) return null
  if (command === 'diagnostics_write_report') {
    written.push(args)
    return `/Users/someone/Library/Logs/Inkblot/reports/${written.length}.json`
  }
  if (command === 'diagnostics_info') return { dir: '/Users/someone/Library/Logs/Inkblot', os: 'macOS 26.1 (arm64)', process: { peakRssBytes: 1 }, debugBuild: true }
  if (command === 'diagnostics_rust_log') return ['2026-11-02T10:00:00.000Z INFO  inkblot: launched']
  return null
})

const prefs = await import('../../src/lib/preferences.ts')
if (!prefs.isHydrated()) await prefs.hydratePreferences()
// An earlier suite may have hydrated the store with its own answers.
prefs.setPreference('inkblot-theme', 'dark')
prefs.setPreference('inkblot-clipboard-history', '["She kept the letter folded in her coat"]')

const { Ring } = await import('../../src/lib/diagnostics/ring.ts')
const sanitize = await import('../../src/lib/diagnostics/sanitize.ts')
const capture = await import('../../src/lib/diagnostics/capture.ts')
const crumbs = await import('../../src/lib/diagnostics/breadcrumbs.ts')
const diagnostics = await import('../../src/lib/diagnostics/index.ts')
const { editorRegistry } = await import('../../src/bridge/appBridge.ts')
const { registerCommands, runCommand } = await import('../../src/lib/commands.ts')
const { Editor } = await import('@tiptap/core')
const { StarterKit } = await import('@tiptap/starter-kit')

const STORY = 'Margaret walked down to the harbour before dawn. The boats had not come back, and nobody on the quay would say why.'
const editor = new Editor({
  element: document.getElementById('root').appendChild(document.createElement('div')),
  extensions: [StarterKit],
  content: `<h1>The quiet harbour</h1><p>${STORY}</p><ul><li><p>one</p></li></ul>`,
})
const unregister = editorRegistry.register('primary', { getEditor: () => editor, getDocPath: () => '/Users/someone/Novel/Chapter one.json' })
editorRegistry.setActive('primary')

/** True if `text` contains any run of four words from the story. */
const quotesTheStory = (text) => {
  const words = STORY.toLowerCase().match(/[\p{L}\p{N}']+/gu)
  const haystack = text.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, ' ')
  for (let i = 0; i + 4 <= words.length; i++) if (haystack.includes(words.slice(i, i + 4).join(' '))) return true
  return false
}

/* ---------------- the allowlist ---------------- */

{
  const out = sanitize.summarize({
    anchor: { text: 'the boats had not come back', from: 12, to: 40 },
    target: 'primary',
    docPath: 'Novel/Chapter one.json',
    title: 'The quiet harbour',
    chunks: [{ text: 'Margaret walked down', id: 'c1' }],
    marks: ['bold', 'italic'],
    words: 812,
    focused: true,
  })
  ok('a selection’s text becomes its length', out.anchor.text === '<string len=27>')
  ok('offsets, counts and flags are kept', out.anchor.from === 12 && out.words === 812 && out.focused === true)
  ok('ids, modes and document names are kept', out.target === 'primary' && out.docPath === 'Novel/Chapter one.json' && out.chunks[0].id === 'c1')
  ok('a heading’s title is writing, not a name', out.title === '<string len=17>')
  ok('a list under a safe key keeps its items', out.marks.join() === 'bold,italic')
  ok('a chunk’s text inside an array is redacted too', out.chunks[0].text === '<string len=20>')

  const long = sanitize.summarize({ items: Array.from({ length: 40 }, (_, i) => i) })
  ok('a long array is cut, and says how long it was', long.items.length === 40 && long.items.first.length === 25)
  ok('functions are dropped', !('run' in sanitize.summarize({ run: () => {} })))
}

/* ---------------- the console ---------------- */

{
  const line = sanitize.sanitizeConsoleArgs(['[preferences] write failed for %s:', 'inkblot-theme', 'the boats had not come back that morning', { content: 'x', notes: [] }])
  ok('the message the code wrote is kept', line.startsWith('[preferences] write failed for %s:'))
  ok('a short id argument is kept', line.includes('inkblot-theme'))
  ok('a sentence argument becomes its length', line.includes('<string len=40>') && !line.includes('boats'))
  ok('an object argument is its keys', line.includes('<object keys=[content, notes]>'))
  const withError = sanitize.sanitizeConsoleArgs(['save failed', new TypeError('x is undefined')])
  ok('an error keeps its stack', withError.includes('TypeError: x is undefined'))
  ok('a path argument is kept', sanitize.sanitizeConsoleArgs(['open', '/Users/someone/Novel/Chapter one.json']).includes('Chapter one.json'))
}

ok('home folders become ~', sanitize.scrubHome('at /Users/someone/Novel and /home/x/y') === 'at ~/Novel and ~/y')

/* ---------------- the leak guard ---------------- */

{
  const shingles = sanitize.documentShingles([STORY])
  const report = {
    message: 'Unexpected token near "The boats had not come back"',
    nested: [{ text: 'nobody on the quay would say why' }],
    harmless: 'Cannot read properties of undefined (reading nodeSize)',
    short: 'harbour',
  }
  const count = sanitize.guardAgainstDocuments(report, shingles)
  ok('a string quoting the document is replaced', report.message === sanitize.REDACTED_TEXT)
  ok('so is one nested in an array', report.nested[0].text === sanitize.REDACTED_TEXT)
  ok('an ordinary error message is left alone', report.harmless.startsWith('Cannot read'))
  ok('a single shared word is not a quotation', report.short === 'harbour')
  ok('the guard counts what it took out', count === 2)
  ok('with no document open, nothing is guarded', sanitize.guardAgainstDocuments({ a: STORY }, new Set()) === 0)
}

/* ---------------- bounded logs ---------------- */

{
  const ring = new Ring(3)
  for (let i = 1; i <= 5; i++) ring.push(i)
  ok('a ring keeps its newest entries, oldest first', ring.toArray().join() === '3,4,5' && ring.size === 3)
  ok('its last is the newest', ring.last() === 5)
  ok('a limit takes the newest', ring.toArray(2).join() === '4,5')
}

{
  // Thrown from the same place both times, as a repeating bug is.
  const boom = () => new Error('one')
  ok('an error is new the first time', capture.isNewCrash(capture.recordError('error', boom())))
  ok('and not the second', !capture.isNewCrash(capture.recordError('error', boom())))
  for (let i = 0; i < 10; i++) capture.isNewCrash(capture.recordError('error', new Error(`distinct ${i}`)))
  ok('a launch saves at most five crash reports', !capture.isNewCrash(capture.recordError('error', new Error('yet another'))))
  ok('ResizeObserver noise is not an error', capture.recordError('error', new Error('ResizeObserver loop completed with undelivered notifications.')) === null)
}

/* ---------------- breadcrumbs ---------------- */

const stopCrumbs = crumbs.installBreadcrumbs()
const stopCapture = capture.installCapture(() => {})
{
  const unregisterCommand = registerCommands([{ id: 'test.run', title: 'Run', section: 'Test', run: () => {} }])
  await runCommand('test.run')
  unregisterCommand()
  const trail = crumbs.breadcrumbs()
  ok('a command run leaves a crumb with its id', trail.some((c) => c.type === 'command' && c.data.id === 'test.run'))

  const prose = editor.view.dom
  for (let i = 0; i < 30; i++) prose.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
  const typing = crumbs.breadcrumbs().filter((c) => c.type === 'typing')
  ok('typing is one crumb with a count, not thirty', typing.length === 1 && typing[0].count === 30)
  ok('and records no keys', !JSON.stringify(typing).includes('"a"'))

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: true }))
  ok('a shortcut is recorded by its keys', crumbs.breadcrumbs().some((c) => c.type === 'shortcut' && c.data.keys === 'Cmd+KeyK'))

  const button = document.body.appendChild(document.createElement('button'))
  button.textContent = STORY
  button.click()
  const click = crumbs.breadcrumbs().filter((c) => c.type === 'click').pop()
  ok('a long button text is a length, not its words', click.data.name === `<text len=${STORY.length}>`)
  button.setAttribute('aria-label', 'Add note')
  button.click()
  ok('a labelled control is named by its label', crumbs.breadcrumbs().filter((c) => c.type === 'click').pop().data.name === 'Add note')
  button.remove()
}

/* ---------------- a whole report ---------------- */

{
  console.error(`Failed to parse near "${STORY.slice(0, 48)}"`)
  capture.recordError('error', new Error(`Unexpected text: ${STORY.slice(20, 80)}`))
  const report = await diagnostics.buildReport({ kind: 'bug' })
  const text = JSON.stringify(report)
  ok('a report never quotes the open document', !quotesTheStory(text))
  ok('the guard took out the console line and the error', report.redactions >= 2)
  ok('home folders are scrubbed', !text.includes('/Users/someone') && text.includes('~/Novel/Chapter one.json'))
  ok('clipboard history is never read', !text.includes('folded in her coat') && !text.includes('clipboard'))
  ok('allowed preferences are there', report.state.preferences['inkblot-theme'] === 'dark')

  const [shape] = report.documents
  ok('the open document is described by shape', shape.target === 'primary' && shape.words === 26 && shape.topLevelBlocks === 3)
  ok('with its node types counted', shape.nodeTypes.heading === 1 && shape.nodeTypes.bulletList === 1)
  ok('and its selection and history', typeof shape.selection.from === 'number' && shape.history?.undo === 0)
  ok('the heading is not in it', !text.includes('quiet harbour'))
  ok('the native side’s log and system are in it', report.rustLog.length === 1 && report.app.os.startsWith('macOS'))
  ok('performance is measured', typeof report.perf.domNodes === 'number')
}

/* ---------------- saving ---------------- */

{
  const path = await diagnostics.saveBugReport()
  ok('a bug report is written as a bug', written.at(-1).kind === 'bug' && path.endsWith('.json'))

  const report = await diagnostics.buildReport({ kind: 'bug' })
  await diagnostics.saveReport(report, `The cursor jumped when I typed "${STORY.slice(0, 50)}"`)
  ok('a note quoting the document is guarded too', written.at(-1).report.note === sanitize.REDACTED_TEXT)
  await diagnostics.saveReport(report, '  The cursor jumped to the top after undo  ')
  ok('an ordinary note is kept, trimmed', written.at(-1).report.note === 'The cursor jumped to the top after undo')

  native = false
  let threw = false
  try {
    ok('with no native side, saving answers null', (await diagnostics.saveBugReport()) === null)
    ok('and counts are null', (await diagnostics.reportCounts()) === null)
  } catch (error) {
    threw = error
  }
  ok(`and nothing throws${threw ? `: ${threw.stack}` : ''}`, !threw)
  native = true
}

/* ---------------- Report a bug… mounted ---------------- */

{
  const React = (await import('react')).default
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { default: BugReporter } = await import('../../src/components/BugReporter.jsx')
  const { default: Toaster } = await import('../../src/ui/Toast.jsx')
  const { REPORT_BUG } = await import('../../src/lib/appEvents.ts')
  const { listAllCommands } = await import('../../src/lib/commands.ts')

  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => {
    root.render(React.createElement(React.StrictMode, null,
      React.createElement(BugReporter), React.createElement(Toaster)))
  })
  ok('Report a bug… is in the palette with its shortcut', listAllCommands().some((c) => c.id === 'app.report-bug' && c.keys === 'Mod+Alt+B'))

  const before = written.length
  await act(async () => { window.dispatchEvent(new CustomEvent(REPORT_BUG)) })
  const dialog = () => document.querySelector('[role="dialog"]:not(.is-leaving)')
  ok('the menu’s event opens the dialog', dialog()?.textContent.includes('Report a bug'))
  const note = document.getElementById('bug-report-note')
  ok('the note takes focus', document.activeElement === note)

  const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  await act(async () => {
    setValue.call(note, 'Undo skipped a step')
    note.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    note.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  ok('⌘↩ saves the report with its note', written.length === before + 1 && written.at(-1).report.note === 'Undo skipped a step')
  ok('the dialog closes', !dialog())
  const toast = document.querySelector('.ib-toast[role="status"]')
  ok('a toast says it was saved, with a way to find it', toast?.textContent.includes('Bug report saved') && toast.textContent.includes('Show in Finder'))

  await act(async () => { toast.querySelector('[aria-label="Dismiss"]').click() })
  ok('the toast can be dismissed', !document.querySelector('.ib-toast[role="status"]'))
  await act(async () => { root.unmount() })
  host.remove()
}

stopCrumbs()
stopCapture()
unregister()
editor.destroy()
