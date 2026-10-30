/**
 * Choosing several rows in the left sidebar (lib/treeSelection.js) and acting on them
 * at once: clicks with ⌘ and ⇧, what a refresh leaves chosen, entries moved and
 * deleted together on disk, and the Book's selection menu and drop arithmetic.
 */
import { ok } from './assert.mjs'

const sel = await import('../../src/lib/treeSelection.js')
const entryOps = await import('../../src/lib/entryOperations.ts')
const { saveDocument, loadDocument, createFolder, listProjectTree } = await import('../../src/lib/FileSystem.js')
const { selectionMenu, moveTarget, gatherTarget } = await import('../../src/components/book/bookMenu.js')
const { documentSurface } = await import('../../src/bridge/index.ts')

/* ---------------- clicks ---------------- */

const order = ['a', 'b', 'c', 'd', 'e']
const none = { selection: new Set(), anchor: null }
const ids = (picked) => [...picked.selection].sort().join()

const one = sel.clickRow(none, 'b', order)
ok('a click chooses one row and anchors there', ids(one) === 'b' && one.anchor === 'b')
const two = sel.clickRow(one, 'd', order, { toggle: true })
ok('⌘-click adds a row and moves the anchor to it', ids(two) === 'b,d' && two.anchor === 'd')
ok('⌘-click on a chosen row takes it away', ids(sel.clickRow(two, 'b', order, { toggle: true })) === 'd')
const run = sel.clickRow(one, 'e', order, { range: true })
ok('⇧-click chooses the run from the anchor, and keeps the anchor', ids(run) === 'b,c,d,e' && run.anchor === 'b')
ok('a second ⇧-click re-draws the run from the same anchor', ids(sel.clickRow(run, 'a', order, { range: true })) === 'a,b')
ok('⌘⇧-click adds the run to what is chosen', ids(sel.clickRow(sel.clickRow(two, 'e', order), 'a', order, { range: true, toggle: true })) === 'a,b,c,d,e')
ok('⇧-click with no anchor showing chooses just the row', ids(sel.clickRow({ selection: new Set(['x']), anchor: 'x' }, 'c', order, { range: true })) === 'c')
ok('a plain click after a selection is one row again', ids(sel.clickRow(run, 'c', order)) === 'c')

const chosen = new Set(['a', 'b'])
ok('pruning keeps the same set when nothing went', sel.pruneSelection(chosen, ['a', 'b', 'c']) === chosen)
ok('and drops what went', [...sel.pruneSelection(chosen, new Set(['b']))].join() === 'b')

const tree = {
  type: 'folder', path: '', children: [
    { type: 'folder', name: 'Part', path: 'Part', children: [{ type: 'file', name: 'One', path: 'Part/One' }] },
    { type: 'file', name: 'Notes', path: 'Notes' },
  ],
}
ok('the rows showing skip what is in a shut folder', sel.visibleEntryIds(tree, new Set()).join() === 'folder:Part,file:Notes')
ok('and include an open folder’s', sel.visibleEntryIds(tree, new Set(['Part'])).join() === 'folder:Part,file:Part/One,file:Notes')
ok('every entry, open or shut', sel.allEntryIds(tree).length === 3)
ok('an id names its entry, colons in the name and all', sel.entryOf('file:Act: One/Scene').path === 'Act: One/Scene' && sel.entryOf('folder:A').type === 'folder')

/* ---------------- entries together ---------------- */

const top = entryOps.topmostEntries([
  { type: 'folder', path: 'Part' }, { type: 'file', path: 'Part/One' }, { type: 'file', path: 'Partial' }, { type: 'file', path: 'Partial' },
])
ok('a chosen folder carries what is chosen inside it, once', top.map((entry) => entry.path).join() === 'Part,Partial')
ok('nothing moves to where it already is', !entryOps.canMoveInto({ type: 'file', path: 'Part/One' }, 'Part'))
ok('nor a folder into itself or its own', !entryOps.canMoveInto({ type: 'folder', path: 'Part' }, 'Part') && !entryOps.canMoveInto({ type: 'folder', path: 'Part' }, 'Part/Sub'))
ok('but a folder can go beside a folder named like it', entryOps.canMoveInto({ type: 'folder', path: 'Part' }, 'Partial'))

const P = 'Selection'
const doc = (text) => ({ content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, notes: [] })
for (const name of ['One', 'Two', 'Three']) await saveDocument(P, name, doc(name))
await createFolder(P, 'Drafts')
await saveDocument(P, 'Drafts/Old', doc('Old'))
await createFolder(P, 'Kept')

const moved = await entryOps.moveEntries(P, [
  { type: 'file', path: 'One' }, { type: 'file', path: 'Two' }, { type: 'folder', path: 'Drafts' }, { type: 'file', path: 'Drafts/Old' }, { type: 'folder', path: 'Kept' },
], 'Kept')
ok('moving a selection moves each, its folder with what is in it, and skips the folder it goes into',
  moved.map((entry) => entry.nextPath).join() === 'Kept/One,Kept/Two,Kept/Drafts')
ok('…and they are there on disk', (await loadDocument(P, 'Kept/One')) && (await loadDocument(P, 'Kept/Drafts/Old')) && !(await loadDocument(P, 'One')))

await entryOps.deleteEntries(P, [{ type: 'folder', path: 'Kept/Drafts' }, { type: 'file', path: 'Kept/Drafts/Old' }, { type: 'file', path: 'Three' }])
const left = JSON.stringify(await listProjectTree(P))
ok('deleting a selection deletes each, once', !left.includes('Drafts') && !left.includes('"Three"') && left.includes('Kept/One'))

/* ---------------- the Book ---------------- */

const sent = []
for (const type of ['setBookItemHidden']) documentSurface.onCommand(type, (payload) => sent.push({ type, payload }))
const rows = [
  { id: 'c1', kind: 'chapter', hidden: true },
  { id: 'c2', kind: 'chapter', hidden: false },
]
const menu = selectionMenu(rows, { onGroup: () => {}, onRemove: () => {} })
ok('a selection of chapters is hidden together, grouped, and not removed',
  menu[0].text === 'Hide 2 from the Book' && menu.some((item) => item.text === 'Group into a part') && menu.at(-1).enabled === false)
menu[0].action()
await new Promise((resolve) => setTimeout(resolve, 20))
ok('hiding them is one command naming them all', sent.at(-1)?.payload.ids.join() === 'c1,c2' && sent.at(-1).payload.hidden === true)
const mixed = selectionMenu([{ id: 'm', kind: 'matter', hidden: true }, { id: 'p', kind: 'part', hidden: true }, { id: 'c', kind: 'chapter', hidden: true }], {})
ok('all hidden, they are shown; pages can be removed, and only they are counted',
  mixed[0].text === 'Show 3 in the Book' && !mixed.some((item) => item.text === 'Group into a part') && mixed.at(-1).text === 'Remove 2 from the Book…')

const book = ['a', 'b', 'c', 'd', 'e']
ok('a block dropped lands before the first entry after it that it isn’t carrying', moveTarget(book, ['b', 'c'], 2) === 'd')
ok('a block gathers where its first entry is', gatherTarget(book, ['b', 'd']) === 'c' && gatherTarget(book, ['d', 'e']) === null)
