/**
 * Notes on the canvas.
 *
 * Two things are worth pinning here, and both are the silent-damage kind:
 *
 *   1. saveDocumentNotes() must preserve the document. Notes normally ride along with
 *      a full save that needs a live editor for `content`; a note card editing a note
 *      in a CLOSED document has no editor, and calling saveDocument() with only notes
 *      writes `content: []` — erasing the document. Same class of bug as the canvas
 *      guard in m0.
 *   2. A note card references its note; it never copies it. If a canvas ever stored
 *      note content of its own, the two would fork and "two-way sync" would be a lie.
 */
const C = '../../src'
const { saveDocument, loadDocument, saveDocumentNotes } = await import(`${C}/lib/FileSystem.js`)
const { makeNoteNode, serializeCanvas, createEmptyCanvas } = await import(`${C}/lib/canvasModel.js`)
const ok = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) process.exitCode = 1 }

const P = 'proj'
const DOC = 'Chapters/One'

const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'the real chapter' }] }] }
const notes = [
  { id: 'n1', type: 'quote', anchor: 'the real chapter', content: 'is this too on the nose?', color: '#ffd54f' },
  { id: 'n2', type: 'free', content: 'standalone thought', color: '#4fb477' },
]

await saveDocument(P, DOC, { content, notes })

/* ---- the guard: a notes-only write must not eat the document ---- */

const wrote = await saveDocumentNotes(P, DOC, [
  ...notes,
  { id: 'n3', type: 'free', content: 'added from the canvas', parentNoteId: 'n1' },
])
ok('saveDocumentNotes reports success', wrote === true)

const after = await loadDocument(P, DOC)
ok('the document content SURVIVED a notes-only write', JSON.stringify(after.content) === JSON.stringify(content))
ok('the new note landed', after.notes.length === 3)
ok('the reply kept its parent', after.notes.find((n) => n.id === 'n3').parentNoteId === 'n1')
ok('the original notes are intact', after.notes.find((n) => n.id === 'n1').content === 'is this too on the nose?')

// Editing from the canvas side updates the note in place — one note, not a copy.
await saveDocumentNotes(P, DOC, after.notes.map((n) => (n.id === 'n1' ? { ...n, content: 'edited on the canvas' } : n)))
const edited = await loadDocument(P, DOC)
ok('an edit from the canvas reaches the document', edited.notes.find((n) => n.id === 'n1').content === 'edited on the canvas')
ok('editing a note does not disturb the content', JSON.stringify(edited.content) === JSON.stringify(content))
ok('the anchor (the referenced highlight) is preserved', edited.notes.find((n) => n.id === 'n1').anchor === 'the real chapter')

// It must refuse to conjure a document that isn't there — a note pointing at a
// deleted file must not resurrect it as an empty stub.
ok('refuses to create a missing document', (await saveDocumentNotes(P, 'Nope/Missing', [])) === false)
ok('...and really did not create it', (await loadDocument(P, 'Nope/Missing')) === null)

// A canvas is not a document and has no notes.
ok('refuses a canvas path', (await saveDocumentNotes(P, 'Board.canvas', [])) === false)

/* ---- the node references the note; it does not copy it ---- */

const node = makeNoteNode({ file: `${DOC}.json`, noteId: 'n1', x: 0, y: 0 })
ok('a note node is a spec `file` node', node.type === 'file')
ok('it points at the OWNING document', node.file === 'Chapters/One.json')
ok('it names the note', node.inkblotNoteId === 'n1')
ok('it stores no note content of its own', !('content' in node) && !('anchor' in node) && !('text' in node))

// And it survives a round-trip to disk with its reference intact.
const state = createEmptyCanvas()
state.nodes[node.id] = node
state.nodeOrder.push(node.id)
const raw = serializeCanvas(state)
const roundTripped = raw.nodes[0]
ok('the reference round-trips through the file format', roundTripped.inkblotNoteId === 'n1')
ok('...and stays a plain file node for other readers', roundTripped.type === 'file' && roundTripped.file === 'Chapters/One.json')
