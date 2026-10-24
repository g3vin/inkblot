/**
 * Documents in windows of their own (docWindow.js, useWindowPop.js).
 *
 *   - a detached window's document goes back: its pending save is written first, then
 *     the main window is told, then the window closes;
 *   - the main window opens a document given back in a tab;
 *   - a detached window can be kept on top.
 *
 * The real @tauri-apps window and event modules run against a stand-in for the IPC,
 * which records what they ask for.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'DOMParser',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'getComputedStyle'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.CSS ??= { escape: (value) => value }
window.PointerEvent ??= window.MouseEvent
globalThis.PointerEvent ??= window.MouseEvent

const ipc = []
const callbacks = new Map()
let nextCallback = 1
window.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: 'doc-x' }, currentWebview: { windowLabel: 'doc-x', label: 'doc-x' } },
  transformCallback: (callback) => { const id = nextCallback++; callbacks.set(id, callback); return id },
  unregisterCallback: (id) => callbacks.delete(id),
  invoke: async (cmd, args) => {
    ipc.push({ cmd, args })
    if (cmd === 'plugin:event|listen') return 1
    if (cmd === 'plugin:window|get_all_windows') return ['main', 'doc-x']
    return null
  },
}
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { useWindowPop } = await import('../../src/hooks/useWindowPop.js')
const { DOCK_EVENT } = await import('../../src/lib/docWindow.js')
const { withDocLock } = await import('../../src/lib/docLock.ts')
const { runCommand } = await import('../../src/lib/commands.ts')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* ---------------- a detached window ---------------- */

let currentDoc = 'Notes/Reference'
let saved = false
function Detached() {
  const [doc, setDoc] = React.useState(currentDoc)
  currentDoc = doc
  Detached.pop = useWindowPop({ detached: true, projectName: 'P', currentDoc: doc, setCurrentDoc: setDoc, openDocInTab: () => {}, openProject: () => {} })
  React.useEffect(() => () => {
    // A pane letting go flushes its autosave, which writes under the document's lock.
    if (doc) void withDocLock('P', doc, () => wait(30).then(() => { saved = true }))
  }, [doc])
  return null
}
const detachedRoot = createRoot(document.getElementById('root').appendChild(document.createElement('div')))
await act(async () => detachedRoot.render(React.createElement(Detached)))

await act(async () => { await runCommand('window.on-top') })
ok('it can be kept on top', ipc.some((c) => c.cmd === 'plugin:window|set_always_on_top' && c.args.value === true) && Detached.pop.onTop)

ipc.length = 0
await act(async () => { await Detached.pop.dock() })
const emitted = ipc.findIndex((c) => c.cmd === 'plugin:event|emit_to')
ok('docking lets go of the document', currentDoc === '')
ok('and waits for its save', saved)
ok('then gives it to the main window', emitted >= 0 && ipc[emitted].args.event === DOCK_EVENT
  && ipc[emitted].args.target?.label === 'main' && ipc[emitted].args.payload?.docPath === 'Notes/Reference')
ok('then closes', ipc.findIndex((c) => c.cmd === 'plugin:window|close') > emitted)
await act(async () => detachedRoot.unmount())

/* ---------------- the main window ---------------- */

const opened = []
function Main() {
  useWindowPop({ detached: false, projectName: 'P', currentDoc: 'One', setCurrentDoc: () => {}, openDocInTab: (path) => opened.push(path), openProject: () => {} })
  return null
}
ipc.length = 0
const mainRoot = createRoot(document.getElementById('root').appendChild(document.createElement('div')))
await act(async () => mainRoot.render(React.createElement(Main)))
await act(async () => wait(10))
const listening = ipc.find((c) => c.cmd === 'plugin:event|listen' && c.args.event === DOCK_EVENT)
ok('the main window listens for documents given back', Boolean(listening))
await act(async () => { callbacks.get(listening.args.handler)({ event: DOCK_EVENT, id: 1, payload: { projectName: 'P', docPath: 'Notes/Reference' } }) })
ok('and opens one in a tab', opened.join() === 'Notes/Reference')
await act(async () => mainRoot.unmount())
