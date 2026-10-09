/**
 * Locked documents and folders (docLocks.ts).
 *
 *   - the lock is in the document's own file, and every save keeps it there: the text
 *     autosave, a notes-only save, a canvas's raw write; only unlocking removes it;
 *   - a folder's lock is a marker file inside it, hidden from the tree, and locks
 *     everything beneath it;
 *   - the project's locks are read back from disk (here by the JS scan, as there is no
 *     app to ask);
 *   - a locked text document refuses edits in a real TipTap editor but still takes a
 *     selection, which a note needs, and says that it refused;
 *   - a locked canvas and map drop the writer's edits at their reducer, but not upkeep;
 *   - the lock badge shows, and its Unlock unlocks.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { files } from './stub-fs.mjs'
import { setInvokeHandler } from './stub-core.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent',
  'MutationObserver', 'getComputedStyle', 'DOMParser'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true
dom.window.scrollBy = () => {}
const noRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })
for (const proto of [dom.window.Element.prototype, dom.window.Range.prototype, dom.window.Text.prototype]) {
  proto.getClientRects ??= () => []
  proto.getBoundingClientRect ??= noRect
}
// No app here: `project_locks` is not answered, so the page scans for itself.
setInvokeHandler(async () => null)

const S = '../../src'
const FS = await import(`${S}/lib/FileSystem.js`)
const { saveCanvasDocument } = await import(`${S}/lib/canvasFileSystem.js`)
const { createEmptyCanvas, makeTextNode } = await import(`${S}/lib/canvasModel.js`)
const locks = await import(`${S}/lib/docLocks.ts`)

const P = 'Locks'
const file = (path) => JSON.parse(files.get(`/appdata/${P}/${path}.json`))
const paragraph = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

/* ---------------- on disk ---------------- */

await FS.saveDocument(P, 'Drafts/One', { content: paragraph('first'), notes: [] })
await FS.saveDocument(P, 'Two', { content: paragraph('second'), notes: [] })
await saveCanvasDocument(P, 'Board.canvas', createEmptyCanvas())
await locks.refreshLocks(P)

ok('nothing starts locked', !locks.isLocked('Drafts/One') && !locks.isLocked('Two'))

ok('locking a document resolves true', await locks.setDocumentLocked(P, 'Two', true))
ok('the lock is in the document’s own file', file('Two').locked === true)
ok('and in the store', locks.lockReason('Two')?.by === 'document')

await FS.saveDocument(P, 'Two', { content: paragraph('second'), notes: [{ id: 'n1' }], _appendVersion: true, _version: { contentHtml: '<p>second</p>' } })
ok('an autosave keeps the lock', file('Two').locked === true)
ok('and the note it carried', file('Two').notes[0]?.id === 'n1')
await FS.saveDocumentNotes(P, 'Two', [{ id: 'n2' }])
ok('a notes-only save keeps the lock', file('Two').locked === true && file('Two').notes[0]?.id === 'n2')

await locks.setDocumentLocked(P, 'Board.canvas', true)
await saveCanvasDocument(P, 'Board.canvas', createEmptyCanvas(), { x: 1, y: 2, zoom: 1 })
ok('a canvas’s raw write keeps the lock', file('Board.canvas').locked === true)

await locks.setDocumentLocked(P, 'Two', false)
ok('unlocking takes the flag out of the file', !('locked' in file('Two')))
ok('and out of the store', !locks.isLocked('Two'))
ok('a document that is not there cannot be locked', !(await locks.setDocumentLocked(P, 'Missing', true)))

ok('locking a folder resolves true', await locks.setFolderLocked(P, 'Drafts', true))
ok('the folder holds the marker', JSON.parse(files.get(`/appdata/${P}/Drafts/.inkblot-folder.json`)).locked === true)
const tree = await FS.listProjectTree(P)
ok('the marker is not in the tree', JSON.stringify(tree).indexOf('inkblot-folder') === -1)
const inFolder = locks.lockReason('Drafts/One')
ok('a document in a locked folder is locked by it', inFolder?.by === 'folder' && inFolder.folder === 'Drafts')
ok('and the folder by itself', locks.lockReason('Drafts')?.by === 'folder')
ok('a folder lock reaches no sibling', !locks.isLocked('DraftsTwo/One'))
ok('the badge names the folder', locks.describeLock(inFolder) === 'Locked with “Drafts”')

// Read back from disk, as after a restart.
await locks.refreshLocks(null)
ok('a closed project has no locks', !locks.isLocked('Board.canvas'))
await locks.refreshLocks(P)
ok('a reopened project finds its locked documents', locks.lockReason('Board.canvas')?.by === 'document')
ok('and its locked folders', locks.lockReason('Drafts/One')?.by === 'folder')

ok('toggling unlocks a locked document', (await locks.toggleDocumentLock('Board.canvas')) && !locks.isLocked('Board.canvas'))
await locks.setFolderLocked(P, 'Drafts', false)
ok('unlocking a folder removes its marker', !files.has(`/appdata/${P}/Drafts/.inkblot-folder.json`) && !locks.isLocked('Drafts/One'))

/* ---------------- a locked text document ---------------- */

const { Editor } = await import('@tiptap/core')
const { StarterKit } = await import('@tiptap/starter-kit')
const { TextSelection } = await import('@tiptap/pm/state')
const { DocumentLock, setEditorLock } = await import(`${S}/extensions/DocumentLock.js`)

const editor = new Editor({
  element: document.getElementById('root').appendChild(document.createElement('div')),
  extensions: [StarterKit, DocumentLock],
  content: '<p>Fixed words.</p>',
})
const refused = []
window.addEventListener(locks.LOCKED_EDIT_EVENT, (event) => refused.push(event.detail.docPath))

setEditorLock(editor, 'Two', true)
editor.commands.insertContent('more ')
ok('a locked document refuses typing', editor.getText() === 'Fixed words.')
ok('and says it did, naming the document', refused.at(-1) === 'Two')
editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)))
ok('a selection still lands, so a note can be made', editor.state.selection.from === 1 && editor.state.selection.to === 6)
editor.commands.toggleBold()
ok('formatting is refused too', !editor.getHTML().includes('<strong>'))

setEditorLock(editor, 'Two', false)
editor.commands.insertContent('Still ')
ok('unlocked, it takes edits again', editor.getText().startsWith('Still'))
editor.destroy()

/* ---------------- a locked canvas and map ---------------- */

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { useCanvasDocument } = await import(`${S}/canvas/useCanvasDocument.js`)
const { useMapDocument } = await import(`${S}/map/useMapDocument.js`)
const { createEmptyMap } = await import(`${S}/lib/map/mapModel.js`)

let canvas = null
let map = null
const viewportRef = { current: { x: 0, y: 0, zoom: 1 } }
function Harness({ locked }) {
  canvas = useCanvasDocument({ projectName: P, docPath: 'Board.canvas', initialState: createEmptyCanvas(), viewportRef, locked })
  map = useMapDocument({ projectName: P, docPath: 'World.map', initialMap: createEmptyMap(), viewportRef, dayRef: { current: 0 }, locked })
  return null
}
const root = createRoot(document.getElementById('root').appendChild(document.createElement('div')))
await act(async () => root.render(React.createElement(Harness, { locked: true })))

const card = makeTextNode({ x: 0, y: 0, text: 'Card' })
await act(async () => canvas.dispatch({ type: 'nodes/add', nodes: [card] }))
ok('a locked canvas drops an edit', canvas.state.nodeOrder.length === 0)
ok('and says so', refused.at(-1) === 'Board.canvas')
await act(async () => canvas.dispatch({ type: 'nodes/add', nodes: [card], meta: { upkeep: true } }))
ok('upkeep still goes through', canvas.state.nodeOrder.length === 1)

const titleBefore = map.map.title
await act(async () => map.dispatch({ type: 'map/patch', patch: { title: 'Renamed' } }))
ok('a locked map drops an edit', map.map.title === titleBefore)

await act(async () => root.render(React.createElement(Harness, { locked: false })))
await act(async () => map.dispatch({ type: 'map/patch', patch: { title: 'Renamed' } }))
ok('unlocked, the map takes it', map.map.title === 'Renamed')
await act(async () => root.unmount())

/* ---------------- the badge ---------------- */

const { default: DocLockBadge } = await import(`${S}/components/DocLockBadge.jsx`)
await locks.setDocumentLocked(P, 'Two', true)
const badgeRoot = createRoot(document.getElementById('root').appendChild(document.createElement('div')))
const badgeHost = document.getElementById('root').lastChild
await act(async () => badgeRoot.render(React.createElement(DocLockBadge, { projectName: P, docPath: 'Two' })))
ok('a locked document shows its badge', badgeHost.querySelector('.doc-lock-badge')?.textContent.includes('Locked'))
await act(async () => { window.dispatchEvent(new CustomEvent(locks.LOCKED_EDIT_EVENT, { detail: { docPath: 'Two' } })) })
ok('a refused edit lights it', badgeHost.querySelector('.doc-lock-badge')?.dataset.nudged === 'true')
await act(async () => { badgeHost.querySelector('.doc-lock-unlock').click() })
await act(async () => {})
ok('its Unlock unlocks the document', !locks.isLocked('Two') && !('locked' in file('Two')))
ok('and the badge goes', !badgeHost.querySelector('.doc-lock-badge'))
await act(async () => badgeRoot.unmount())
