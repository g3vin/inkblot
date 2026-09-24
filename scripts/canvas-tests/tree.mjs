/**
 * The file tree's per-row decisions.
 *
 * FileTree.jsx had no coverage at all, and the part worth covering was buried: the
 * twenty-odd constants renderNode derives before it emits any markup. They are now
 * deriveFileNodeState(), which is pure, so this suite can ask it directly what a row
 * should look like instead of mounting a tree and reading class names back out.
 *
 * The cases here are the ones where the rule is not obvious from the call site:
 * four highlight states that overlap, an icon that fills only for documents, and
 * drop indicators that belong to the row above the gap — except at the end of a
 * list, where the last row has to draw one below itself because there is no row
 * after it to do the job.
 */
const { deriveFileNodeState } = await import('../../src/lib/fileTreeNodeState.js')

const ok = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) process.exitCode = 1 }

const file = (name, path) => ({ type: 'file', name, path: path ?? name })
const folder = (name, path, children = []) => ({ type: 'folder', name, path: path ?? name, children })

const chapterOne = file('chapter-one', 'Act One/chapter-one')
const chapterTwo = file('chapter-two', 'Act One/chapter-two')
const board = file('plan.canvas', 'Act One/plan.canvas')
const actOne = folder('Act One', 'Act One', [chapterOne, chapterTwo, board])
const siblings = actOne.children

const at = (node, context = {}) => deriveFileNodeState(node, { siblings, ...context })

/* ---- identity ---- */

ok('a file is not a folder', at(chapterOne).isFolder === false)
ok('a folder is', at(actOne, { siblings: [actOne] }).isFolder === true)
ok('the node id namespaces the path by type',
  at(chapterOne).nodeId === 'file:Act One/chapter-one')
// The id has to carry the type: a folder and a document can hold the same path in
// different parts of the tree, and the drag source is tracked by this id alone.
ok('a folder and a file at one path get different ids',
  at({ type: 'folder', name: 'x', path: 'p' }).nodeId !==
  at({ type: 'file', name: 'x', path: 'p' }).nodeId)
ok('the parent path is the containing folder', at(chapterOne).parentPath === 'Act One')

/* ---- the four highlight states ---- */

const primaryOnly = at(chapterOne, { currentDoc: 'Act One/chapter-one' })
ok('the main pane\'s document is primary', primaryOnly.isPrimary)
// activeDoc is whichever pane the writer is in. Before anything is active it has to
// fall back to primary, or a freshly opened document looks unselected.
ok('with no active doc, primary is also active', primaryOnly.isActive)
ok('an unrelated row is neither',
  !at(chapterTwo, { currentDoc: 'Act One/chapter-one' }).isPrimary &&
  !at(chapterTwo, { currentDoc: 'Act One/chapter-one' }).isActive)

const splitActive = at(chapterTwo, {
  currentDoc: 'Act One/chapter-one',
  secondaryDoc: 'Act One/chapter-two',
  activeDoc: 'Act One/chapter-two',
  splitView: 'editor',
})
ok('the split pane\'s document is secondary', splitActive.isSecondary)
ok('and it is the active one when the writer is in it', splitActive.isActive)
ok('primary is no longer active while the split pane has focus',
  !at(chapterOne, {
    currentDoc: 'Act One/chapter-one',
    activeDoc: 'Act One/chapter-two',
  }).isActive)

// secondaryDoc survives the split being closed, so the flag has to be gated on the
// split actually being up — otherwise a stale row keeps its highlight.
ok('secondary needs the split to be open',
  !at(chapterTwo, { secondaryDoc: 'Act One/chapter-two', splitView: null }).isSecondary)

/* ---- icons ---- */

ok('a plain document has no icon', at(chapterOne).iconName === null)
ok('a canvas does', at(board).iconName === 'canvas')
ok('a closed folder is an outline', at(actOne, { siblings: [actOne] }).iconName === 'folder')
ok('an open folder is filled',
  at(actOne, { siblings: [actOne], expanded: new Set(['Act One']) }).iconName === 'folder.fill')

// The icon fills to mark the active document. A folder's is already solid when open,
// so filling it again would make an expanded folder look selected.
ok('an active canvas fills its icon',
  at(board, { currentDoc: 'Act One/plan.canvas' }).iconFilled === true)
ok('an inactive canvas does not', at(board).iconFilled === false)
ok('an active folder never fills',
  at(actOne, {
    siblings: [actOne],
    expanded: new Set(['Act One']),
    currentDoc: 'Act One',
  }).iconFilled === false)
ok('a document with no icon cannot fill one',
  at(chapterOne, { currentDoc: 'Act One/chapter-one' }).iconFilled === false)

/* ---- drop indicators ---- */

// The gap above row N is drawn by row N.
const dropAboveSecond = { parentPath: 'Act One', index: 1 }
ok('the row below the gap draws the indicator',
  at(chapterTwo, { dragInsert: dropAboveSecond }).showInsertSlot)
ok('no other row draws it',
  !at(chapterOne, { dragInsert: dropAboveSecond }).showInsertSlot &&
  !at(board, { dragInsert: dropAboveSecond }).showInsertSlot)

// There is no row after the last one, so the last row draws the trailing gap below
// itself. Without this a drop at the end of a folder has no indicator at all.
const dropAtEnd = { parentPath: 'Act One', index: 3 }
ok('the last row draws the trailing indicator below itself',
  at(board, { dragInsert: dropAtEnd }).showInsertAfterLast)
ok('and not above itself', !at(board, { dragInsert: dropAtEnd }).showInsertSlot)
ok('a middle row never draws the trailing indicator',
  !at(chapterTwo, { dragInsert: dropAtEnd }).showInsertAfterLast)

// A drag over a different folder must not light up this one's rows.
ok('an insert in another folder is ignored',
  !at(chapterTwo, { dragInsert: { parentPath: 'Act Two', index: 1 } }).showInsertSlot)

/* ---- renaming, dragging, inline creation ---- */

ok('renaming matches on path AND type',
  at(chapterOne, { renamingEntry: { path: 'Act One/chapter-one', type: 'file' } }).isRenaming)
ok('a folder rename does not put the file of the same path into rename mode',
  !at(chapterOne, { renamingEntry: { path: 'Act One/chapter-one', type: 'folder' } }).isRenaming)

ok('the dragged row knows it is the source',
  at(chapterOne, { dragSourceId: 'file:Act One/chapter-one' }).isDragSource)
ok('the hovered row knows it is the target',
  at(chapterOne, { dragOverPath: 'Act One/chapter-one' }).isDragOver)

ok('a new entry\'s input opens inside the folder it was asked for',
  Boolean(at(actOne, { siblings: [actOne], isAddingEntry: true, newEntryParent: 'Act One' }).showInlineInput))
ok('and not in its siblings',
  !at(chapterOne, { isAddingEntry: true, newEntryParent: 'Act One' }).showInlineInput)
ok('nothing opens when nothing is being added',
  !at(actOne, { siblings: [actOne], isAddingEntry: false, newEntryParent: 'Act One' }).showInlineInput)

/* ---- labels ---- */

// The label drops the canvas suffix; the drag payload carries the same display name,
// so a dragged canvas does not suddenly read "plan.canvas" under the cursor.
ok('a canvas row is labelled without its suffix', at(board).label === 'plan')
ok('the drag name matches the label', at(board).dragName === at(board).label)
ok('a folder keeps its name verbatim', at(actOne, { siblings: [actOne] }).label === 'Act One')

/* ---- defaults ---- */

// renderNode calls this on every row on every render; an absent context must not throw.
const bare = deriveFileNodeState(chapterOne)
ok('an empty context is safe', bare.isFolder === false && bare.siblingIndex === -1)
ok('and draws no indicators', !bare.showInsertSlot && !bare.showInsertAfterLast)
