/**
 * Deleting something blank skips the confirmation.
 *
 * The hazard is one-sided: calling a document empty when it is not deletes the
 * writer's work without asking. So every kind of content is checked here — text,
 * notes, history, a canvas card, a map pin, a picture dropped in a folder — and each
 * must keep the question.
 */
import { files } from './stub-fs.mjs'
import { ok } from './assert.mjs'

const S = '../../src'
const { saveDocument, writeDocumentRaw, createFolder } = await import(`${S}/lib/FileSystem.js`)
const { getProjectRoot, joinPath } = await import(`${S}/lib/projectPaths.ts`)
const { isEntryEmpty, isRichTextEmpty } = await import(`${S}/lib/emptiness.js`)
const { isNoteEmpty } = await import(`${S}/lib/noteUtils.js`)
const { createDocumentOfKind } = await import(`${S}/lib/createDocument.js`)

const P = 'emptyproj'
const para = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined })

/* ---- notes ---- */

ok('a blank note is empty', isNoteEmpty({ content: '  \n', images: [], audio: [] }))
ok('a quote note with no words of its own is empty', isNoteEmpty({ type: 'quote', anchor: 'the text', content: '' }))
ok('a note with words is not', !isNoteEmpty({ content: 'x' }))
ok('a note with only a picture is not', !isNoteEmpty({ content: '', images: [{ src: 'data:' }] }))
ok('a note with only a voice memo is not', !isNoteEmpty({ content: '', audio: [{ path: 'a.m4a' }] }))

/* ---- rich text ---- */

ok('no content is empty', isRichTextEmpty([]))
ok('blank paragraphs are empty', isRichTextEmpty({ type: 'doc', content: [para(''), para('   ')] }))
ok('an empty list is empty', isRichTextEmpty([{ type: 'bulletList', content: [{ type: 'listItem', content: [para('')] }] }]))
ok('a word is content', !isRichTextEmpty([para(''), para('hello')]))
ok('an image is content', !isRichTextEmpty([{ type: 'image', attrs: { src: 'x' } }]))
ok('a rule is content', !isRichTextEmpty([{ type: 'horizontalRule' }]))

/* ---- files, by kind ---- */

for (const [kind, path] of [['file', 'Blank'], ['canvas', 'Board.canvas'], ['map', 'World.map'], ['timeline', 'When.timeline']]) {
  await createDocumentOfKind(P, path, kind)
  ok(`a new ${kind} is empty`, await isEntryEmpty(P, path, 'file'))
}

await saveDocument(P, 'Written', { content: [para('Once upon a time')] })
ok('a document with words is not empty', !(await isEntryEmpty(P, 'Written', 'file')))

await saveDocument(P, 'Noted', { content: [], notes: [{ id: 'n', content: '' }] })
ok('a blank page with a note is not empty', !(await isEntryEmpty(P, 'Noted', 'file')))

await saveDocument(P, 'Cleared', { content: [para('gone')] })
await saveDocument(P, 'Cleared', { content: [], _appendVersion: true, _version: { contentJson: { type: 'doc', content: [para('gone')] } } })
ok('a cleared page with history is not empty', !(await isEntryEmpty(P, 'Cleared', 'file')))

await writeDocumentRaw(P, 'Cards.canvas', { nodes: [{ id: 'a', type: 'text', text: 'hi' }], edges: [] })
ok('a canvas with a card is not empty', !(await isEntryEmpty(P, 'Cards.canvas', 'file')))

await writeDocumentRaw(P, 'Pinned.map', { type: 'map', mapKind: 'blank', pins: [{ id: 'p', at: { x: 1, y: 1 } }] })
ok('a map with a pin is not empty', !(await isEntryEmpty(P, 'Pinned.map', 'file')))

await writeDocumentRaw(P, 'Chapter.map', { content: [para('a chapter that predates maps')] })
ok('a text file that only looks like a map is not empty', !(await isEntryEmpty(P, 'Chapter.map', 'file')))


/* ---- folders ---- */

await createFolder(P, 'Drafts')
ok('a new folder is empty', await isEntryEmpty(P, 'Drafts', 'folder'))

await createDocumentOfKind(P, 'Drafts/Sub/Untitled', 'file')
ok('a folder of blank documents is empty', await isEntryEmpty(P, 'Drafts', 'folder'))

await saveDocument(P, 'Drafts/Sub/Real', { content: [para('words')] })
ok('a folder with one written document deep inside is not', !(await isEntryEmpty(P, 'Drafts', 'folder')))

await createFolder(P, 'Pictures')
files.set(joinPath(await getProjectRoot(P), 'Pictures/photo.png'), 'png')
ok('a folder holding a picture is not empty', !(await isEntryEmpty(P, 'Pictures', 'folder')))
