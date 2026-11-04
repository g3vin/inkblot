/**
 * Name tags and the fields behind them (storyEntries.ts, EntityMentions.js,
 * documentFields.ts, markVisibility.ts, noteCharacterLinks.js).
 *
 *   - the entries are every document under a preset folder but the book's, a canvas
 *     standing for the document of the same name, with the aliases the writer gave;
 *   - names match as whole words, longest first, case and all, never in a document's
 *     own text;
 *   - in a real editor the tags follow edits, and an edit's rescan agrees with a whole
 *     scan; ⌘-click opens the entry, a plain click does not; hiding names clears them;
 *   - aliases and a point of view are saved with the project and follow renames;
 *   - the Show menu's layers persist and mark the root for the CSS;
 *   - a note's characters follow a rename;
 *   - a name that reads as an ordinary word at a sentence's start is judged in context
 *     ("Will you come?" is not Will), unless its entry is always tagged;
 *   - a static canvas card's HTML carries the same tags;
 *   - resting on a tag shows the entry's card, with the opening of its document.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent',
  'MutationObserver', 'getComputedStyle', 'DOMParser', 'NodeFilter'])
dom.window.scrollBy = () => {}
// A plain click reaches ProseMirror, which asks where it landed; jsdom does no layout.
dom.window.document.elementFromPoint = () => null
const noRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })
for (const proto of [dom.window.Element.prototype, dom.window.Range.prototype, dom.window.Text.prototype]) {
  proto.getClientRects ??= () => []
  proto.getBoundingClientRect ??= noRect
}

const entriesLib = await import('../../src/lib/storyEntries.ts')
const fields = await import('../../src/lib/documentFields.ts')
const marks = await import('../../src/lib/markVisibility.ts')
const { remapNoteCharacters } = await import('../../src/lib/noteCharacterLinks.js')
const { rememberTree } = await import('../../src/lib/projectPrefetch.js')
const { STORY_FOLDER_PRESETS, customPreset } = await import('../../src/lib/storyStructure.js')
const FS = await import('../../src/lib/FileSystem.js')
const { documentSurface, editorRegistry } = await import('../../src/bridge/index.ts')
const { Editor } = await import('@tiptap/core')
const { StarterKit } = await import('@tiptap/starter-kit')
const { EntityMentions, ENTITY_MENTIONS_KEY } = await import('../../src/extensions/EntityMentions.js')

const nameContext = await import('../../src/lib/nameContext.ts')
const { tagCardHtml } = await import('../../src/canvas/cardTags.js')

const { buildStoryEntries, buildNameIndex, findMentions, tagMentions } = entriesLib

// Loaded first, so a name opening a sentence is judged rather than left for later.
ok('a name opening a sentence waits for the tagger while it loads', nameContext.isNameHere('Will you come?', 0, 'Will') === null)
await nameContext.loadNameContext()

const file = (path) => ({ type: 'file', path, name: path.split('/').pop() })
const folder = (path, children) => ({ type: 'folder', path, name: path.split('/').pop(), children })
const tree = folder('', [
  folder('Characters', [file('Characters/Kira'), file('Characters/Kira.canvas'), file('Characters/Kira Vale'), file('Characters/I')]),
  folder('Places', [file('Places/Harbor')]),
  folder('Book', [file('Book/Chapter One')]),
  folder('Flora', [file('Flora/Rose')]),
  file('Chapter Two'),
])
const flora = customPreset({ id: 'f', name: 'Flora', icon: 'flora', ink: 'green' })
const presets = [...STORY_FOLDER_PRESETS, flora]

/* ---------------- the entries ---------------- */

const built = buildStoryEntries(tree, presets, { 'Characters/Kira': { aliases: ['Kiki'] } })
const byName = (name) => built.find((entry) => entry.name === name)
ok('every preset folder’s documents but the book’s', built.map((entry) => entry.name).join() === 'Harbor,I,Kira,Kira Vale,Rose')
ok('a canvas stands for the document of the same name', byName('Kira').path === 'Characters/Kira.canvas')
ok('and keeps the document’s aliases', byName('Kira').aliases.join() === 'Kiki')
ok('characters are known as characters', byName('Kira').isCharacter && !byName('Harbor').isCharacter)
ok('a writer’s own type wears its own ink', byName('Rose').ink === 'green')
ok('built-in types are told apart by ink', byName('Kira').ink !== byName('Harbor').ink)
ok('no tree, no entries', buildStoryEntries(null, presets, {}).length === 0)

/* ---------------- matching ---------------- */

const index = buildNameIndex(built)
const names = (text, except = null) => findMentions(text, index, except).map((m) => text.slice(m.from, m.to)).join('|')
ok('a name is found', names('Then Kira ran.') === 'Kira')
ok('the longest name wins', names('Kira Vale said so.') === 'Kira Vale')
ok('a possessive is still the name', names('Kira’s coat and Kira\'s hat') === 'Kira|Kira')
ok('never inside a longer word', names('Kirakos and Roses') === '')
ok('case matters: a rose is not Rose', names('a rose for Rose') === 'Rose')
ok('aliases are names', names('Kiki waved.') === 'Kiki' && findMentions('Kiki', index)[0].entry.path === 'Characters/Kira.canvas')
ok('one letter is not a name', names('I said I would.') === '')
ok('a document does not tag itself', names('Kira and Harbor', 'Characters/Kira.canvas') === 'Harbor')
ok('accented names match whole', buildNameIndex(buildStoryEntries(folder('', [folder('Characters', [file('Characters/Zoë')])]), presets, {}))
  .pattern.test('Zoë!'))
ok('no names, no pattern', buildNameIndex([]).pattern === null && findMentions('Kira', buildNameIndex([])).length === 0)

/* ---------------- document fields ---------------- */

const P = 'Names'
await FS.saveDocument(P, 'Chapter Two', { content: [], notes: [] })
await fields.refreshDocumentFields(P)
ok('a project starts with no fields', Object.keys(fields.allDocumentFields()).length === 0)

await fields.setDocumentField('Characters/Kira', 'aliases', [' Kiki ', 'kiki', '', 'Kay'])
await fields.setDocumentField('Chapter Two', 'pov', 'Characters/Kira')
ok('aliases are trimmed and each kept once', fields.documentFields('Characters/Kira').aliases.join() === 'Kiki,Kay')
await fields.refreshDocumentFields(P)
ok('fields are saved with the project', fields.documentFields('Chapter Two').pov === 'Characters/Kira')

await fields.setDocumentField('Chapter Two', 'pov', null)
ok('clearing the last field forgets the document', !('Chapter Two' in fields.allDocumentFields()))

const saved = { 'Characters/Kira': { aliases: ['Kiki'] }, 'Book/One': { pov: 'Characters/Kira' }, 'Book/Two': { pov: 'Characters/Olm' } }
let moved = fields.remapFieldMap(saved, 'Characters/Kira', 'Characters/Kirra', 'file')
ok('a renamed document keeps its fields', moved['Characters/Kirra']?.aliases[0] === 'Kiki' && !moved['Characters/Kira'])
ok('and a point of view on it follows', moved['Book/One'].pov === 'Characters/Kirra' && moved['Book/Two'].pov === 'Characters/Olm')
moved = fields.remapFieldMap(saved, 'Characters', 'Cast', 'folder')
ok('a renamed folder carries what is in it', moved['Cast/Kira'] && moved['Book/Two'].pov === 'Cast/Olm')
moved = fields.remapFieldMap(saved, 'Characters/Kira', null, 'file')
ok('a deleted document’s fields go, and a point of view on it stays, shown missing',
  !moved['Characters/Kira'] && moved['Book/One'].pov === 'Characters/Kira')
ok('an untouched map is the same map', fields.remapFieldMap(saved, 'Elsewhere', 'Gone', 'file') === saved)
ok('junk on disk is dropped', Object.keys(fields.cleanFieldMap({ a: 7, b: { pov: 3 }, '': { pov: 'x' }, c: { aliases: ['Ok'] } })).join() === 'c')

/* ---------------- the Show menu ---------------- */

ok('every layer starts shown', marks.allMarksShown(marks.getMarkVisibility()) && !document.documentElement.dataset.hideMarks)
marks.setMarkVisible('notes', false)
ok('a hidden layer is named on the root, for the CSS', document.documentElement.dataset.hideMarks === 'notes')
marks.setAllMarksVisible(false)
ok('hide all names every layer', document.documentElement.dataset.hideMarks === 'names notes bubbles timeline')
marks.setAllMarksVisible(true)
ok('show all clears it', !document.documentElement.dataset.hideMarks)

/* ---------------- in an editor ---------------- */

const opened = []
documentSurface.setDelegates({ openDocument: (payload) => opened.push(payload) })
rememberTree(P, tree)
await fields.setDocumentField('Characters/Kira', 'aliases', ['Kiki'])

const editor = new Editor({
  element: document.getElementById('root').appendChild(document.createElement('div')),
  extensions: [StarterKit, EntityMentions],
  content: '<p>Kira met Kiki at the Harbor.</p><p>Nobody else.</p>',
})
editorRegistry.register('primary', { getEditor: () => editor, getDocPath: () => 'Chapter Two' })
const frame = () => new Promise((resolve) => setTimeout(resolve, 30))
await frame()

const tagged = () => {
  const set = ENTITY_MENTIONS_KEY.getState(editor.state).decorations
  return set.find().map((d) => `${editor.state.doc.textBetween(d.from, d.to)}@${d.from}`).sort().join()
}
const tags = () => tagged().split(',').filter(Boolean).map((tag) => tag.split('@')[0]).sort().join()
ok('the names in the text are tagged', tags() === 'Harbor,Kiki,Kira')
ok('a tag carries its entry', editor.view.dom.querySelector('.entity-mention[data-entity-path="Places/Harbor"]') !== null)

editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' Then Kira Vale came.')
ok('an edit tags what it adds', tags() === 'Harbor,Kiki,Kira,Kira Vale')
editor.commands.insertContentAt(1, 'At dawn, ')
const afterEdits = tagged()
editor.view.dispatch(editor.state.tr.setMeta(ENTITY_MENTIONS_KEY, { exceptPath: 'Chapter Two' }))
ok('an edit’s rescan agrees with a whole scan', tagged() === afterEdits)

const kira = editor.view.dom.querySelector('.entity-mention[data-entity-path="Characters/Kira.canvas"]')
kira.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
ok('a plain click edits, it does not open', opened.length === 0)
kira.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, metaKey: true, ctrlKey: true }))
ok('⌘-click opens the entry in its pane', opened.length === 1 && opened[0].path === 'Characters/Kira.canvas' && opened[0].pane === 'primary')

marks.setMarkVisible('names', false)
await frame()
ok('hiding names clears the tags', tags() === '')
marks.setMarkVisible('names', true)
await frame()
ok('and showing them brings them back', tags().includes('Kira'))
editor.destroy()

/* ---------------- a note's characters ---------------- */

const notes = [{ id: 'a', characters: ['Characters/Kira', 'Places/Harbor'] }, { id: 'b', characters: [] }, { id: 'c' }]
const renamed = remapNoteCharacters(notes, 'Characters/Kira', 'Characters/Kirra', 'file')
ok('a note’s character follows a rename', renamed[0].characters.join() === 'Characters/Kirra,Places/Harbor')
ok('the other notes are the same objects', renamed[1] === notes[1] && renamed[2] === notes[2])
ok('notes that name nothing touched are the same list', remapNoteCharacters(notes, 'Elsewhere', 'Gone', 'file') === notes)
ok('a folder rename carries its characters', remapNoteCharacters(notes, 'Characters', 'Cast', 'folder')[0].characters[0] === 'Cast/Kira')

/* ---------------- the Details tab ---------------- */

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const DetailsPanel = (await import('../../src/components/details/DetailsPanel.jsx')).default
const host = document.getElementById('root').appendChild(document.createElement('div'))
const root = createRoot(host)
const render = (docPath) => act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(DetailsPanel, { docPath }))))

await render('Chapter Two')
const pov = () => host.querySelector('select[aria-label="Point of view"]')
ok('a chapter offers the characters as its point of view', [...pov().options].map((o) => o.textContent).join() === 'None,I,Kira,Kira Vale')
ok('and has no other names to give', !host.textContent.includes('Also called'))
await act(async () => {
  pov().value = 'Characters/Kira.canvas'
  pov().dispatchEvent(new Event('change', { bubbles: true }))
})
ok('choosing one saves it', fields.documentFields('Chapter Two').pov === 'Characters/Kira.canvas')

await render('Characters/Kira.canvas')
ok('a character does not offer itself', ![...pov().options].some((o) => o.value === 'Characters/Kira.canvas'))
ok('a story entry lists its other names', host.textContent.includes('Also called') && host.textContent.includes('Kiki'))
const input = host.querySelector('input[aria-label="Add another name"]')
await act(async () => {
  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  setValue.call(input, 'Kay')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
await act(async () => host.querySelector('form.details-alias-add').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
ok('adding a name saves it on the entry the tags read', fields.documentFields('Characters/Kira.canvas').aliases?.includes('Kay'))
await act(async () => host.querySelector('button[aria-label="Remove Kay"]').click())
ok('and removing one takes it off', !fields.documentFields('Characters/Kira.canvas').aliases?.includes('Kay'))
await act(async () => host.querySelector('button[role="switch"][aria-label="Always tag"]').click())
ok('“Always tag” is saved on the entry', fields.documentFields('Characters/Kira.canvas').alwaysTag === true)
await act(async () => host.querySelector('button[role="switch"][aria-label="Always tag"]').click())
ok('and turned off, forgotten', fields.documentFields('Characters/Kira.canvas').alwaysTag === undefined)

await render(null)
ok('with nothing open it says so', host.textContent.includes('No document open.'))
await act(async () => root.unmount())

/* ---------------- a name that reads as a word ---------------- */

const wordy = buildNameIndex(buildStoryEntries(folder('', [folder('Characters', [file('Characters/Will'), file('Characters/Rose')])]), presets, {}))
const tagsIn = (text, given = wordy) => tagMentions(text, given).mentions.map((m) => text.slice(m.from, m.to)).join('|')
ok('“Will you come?” is not Will', tagsIn('Will you come?') === '')
ok('“Will walked in.” is', tagsIn('Will walked in.') === 'Will')
ok('so is a “Will” before a verb no modal takes', tagsIn('Will follows Rose up the stairs.') === 'Will|Rose')
ok('nor is the Rose of “Rose petals”', tagsIn('Rose petals fell.') === '')
ok('but Rose smiling is Rose', tagsIn('Rose smiled.') === 'Rose')
ok('a possessive opening a sentence is someone’s', tagsIn('Rose’s coat was red.') === 'Rose')
ok('after a full stop is a sentence’s start too', tagsIn('He left. Will you stay?') === '')
ok('and after an opening quote', tagsIn('“Will you come?” she asked.') === '')
ok('mid-sentence, a capital is a name', tagsIn('He asked if Will would stay.') === 'Will')
ok('a name it does not know as a word is never doubted', nameContext.isNameHere('Olm said no.', 0, 'Olm') === true)
const always = buildNameIndex(buildStoryEntries(folder('', [folder('Characters', [file('Characters/Will')])]), presets, { 'Characters/Will': { alwaysTag: true } }))
ok('an entry always tagged is tagged anyway', tagsIn('Will you come?', always) === 'Will')

/* ---------------- static canvas cards ---------------- */

const cardHtml = tagCardHtml('<p>Then Kira met <strong>Kiki</strong> at the Harbor.</p><pre><code>Kira</code></pre>', index)
ok('a static card’s names are tagged in its HTML, across formatting', (cardHtml.match(/class="entity-mention"/g) || []).length === 3)
ok('a tag on a card carries its entry', cardHtml.includes('data-entity-path="Places/Harbor"'))
ok('never inside code', !cardHtml.includes('<code><span'))
ok('a card on the entry’s own canvas leaves its name', !tagCardHtml('<p>Then Kira waits.</p>', index, 'Characters/Kira.canvas').includes('entity-mention'))
ok('nothing to tag, the same HTML', tagCardHtml('<p>Nobody.</p>', index) === '<p>Nobody.</p>')
ok('names hidden, nothing tagged', tagCardHtml('<p>Then Kira.</p>', null) === '<p>Then Kira.</p>')

/* ---------------- the hover card ---------------- */

const { ENTITY_PREVIEW_EVENT } = await import('../../src/lib/entityLinks.js')
const EntityPreview = (await import('../../src/components/EntityPreview.jsx')).default
await FS.saveDocument(P, 'Places/Harbor', { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A grey harbour town.' }] }] }, notes: [] })
const previewHost = document.getElementById('root').appendChild(document.createElement('div'))
const previewRoot = createRoot(previewHost)
await act(async () => previewRoot.render(React.createElement(React.StrictMode, null, React.createElement(EntityPreview))))
const wait = (ms) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))
const point = (path) => window.dispatchEvent(new CustomEvent(ENTITY_PREVIEW_EVENT, { detail: { path, rect: { left: 10, top: 10, right: 60, bottom: 30, width: 50, height: 20 } } }))
const card = () => document.querySelector('.entity-preview')

point('Places/Harbor')
await wait(100)
ok('passing over a tag opens nothing', !card())
await wait(500)
ok('resting on one shows its card', card()?.textContent.includes('Harbor') && card().textContent.includes('Setting'))
ok('with the opening of its document', card()?.textContent.includes('A grey harbour town.'))
ok('and takes no focus', document.activeElement === document.body)
window.dispatchEvent(new CustomEvent(ENTITY_PREVIEW_EVENT, { detail: { path: null } }))
await wait(300)
ok('leaving the tag lets it go', !card())
await act(async () => previewRoot.unmount())

/* ---------------- notes by character ---------------- */

const NotesPanel = (await import('../../src/components/NotesPanel.jsx')).default
const notesHost = document.getElementById('root').appendChild(document.createElement('div'))
const notesRoot = createRoot(notesHost)
const someNotes = [
  { id: 'k', type: 'free', content: 'About Kira', characters: ['Characters/Kira.canvas'] },
  { id: 'v', type: 'free', content: 'About Vale', characters: ['Characters/Kira Vale'] },
  { id: 'x', type: 'free', content: 'About nobody' },
]
const keepNotes = () => {}
await act(async () => notesRoot.render(React.createElement(NotesPanel, { notes: someNotes, setNotes: keepNotes, docName: 'Chapter Two', projectName: P })))
const shownNotes = () => [...notesHost.querySelectorAll('.note-textarea')].map((el) => el.value).sort().join()
const scope = notesHost.querySelector('.ib-scope-menu')
ok('the notes panel offers the characters its notes name', scope?.getAttribute('aria-label') === 'Show: All notes')
ok('and shows every note to begin with', shownNotes() === 'About Kira,About Vale,About nobody')
await act(async () => scope.click())
const kiraItem = [...document.querySelectorAll('[role^="menuitem"]')].find((item) => item.textContent.includes('Kira') && !item.textContent.includes('Vale'))
await act(async () => kiraItem.click())
ok('choosing one shows only its notes', shownNotes() === 'About Kira')
await act(async () => notesRoot.render(React.createElement(NotesPanel, { notes: [someNotes[2]], setNotes: keepNotes, docName: 'Chapter Two', projectName: P })))
ok('notes that name no one offer no menu', !notesHost.querySelector('.ib-scope-menu') && shownNotes() === 'About nobody')
await act(async () => notesRoot.unmount())
