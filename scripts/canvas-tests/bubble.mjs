/**
 * Bubble: a sentence taken apart into bubbles, and written back.
 *
 * The text rules (words, clauses, joins) and the drop rules are pure and checked
 * directly. What a session does to a document is checked on a real TipTap editor with
 * the real `bubbleSession` mark: that Done leaves the session on the sentence, that it
 * comes back out of the document's JSON and HTML exactly as it went in (which is what
 * version history stores), that Archive takes it off and keeps it in the document's archive, the
 * document *before* it does, and that pasting a sentence does not copy its session.
 *
 * `BubbleTextTests.swift` holds the same text cases for the Swift port.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
})
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent',
  'MutationObserver', 'getComputedStyle', 'DOMParser'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true
// jsdom does no layout. ProseMirror measures when it scrolls the selection into view,
// which writing a session back does.
// Nor scrolling: restoring a session scrolls to it.
dom.window.scrollBy = () => {}
const noRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })
for (const proto of [dom.window.Element.prototype, dom.window.Range.prototype, dom.window.Text.prototype]) {
  proto.getClientRects ??= () => []
  proto.getBoundingClientRect ??= noRect
}

const S = '../../src'
const text = await import(`${S}/lib/bubbleText.ts`)
const forms = await import(`${S}/lib/bubbleForms.ts`)
const drop = await import(`${S}/lib/bubbleDrop.js`)
const { Editor } = await import('@tiptap/core')
const { StarterKit } = await import('@tiptap/starter-kit')
const { Slice } = await import('@tiptap/pm/model')
const { TextSelection } = await import('@tiptap/pm/state')
const { BubbleSession, findBubbleSession, bubbleSessionAt, findBubbleSessions, showSessionForm, sessionForms } =
  await import(`${S}/extensions/BubbleSession.js`)
const { writeBubbleSession, selectionForBubble, useBubbleSessions } =
  await import(`${S}/components/useBubbleSessions.js`)
const { files } = await import('./stub-fs.mjs')
const { getProjectRoot } = await import(`${S}/lib/projectPaths.ts`)
const archiveStore = await import(`${S}/lib/archiveStore.js`)
const { saveDocument } = await import(`${S}/lib/FileSystem.js`)

const ok = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) process.exitCode = 1 }
const texts = (words) => words.map((word) => word.text)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/* ---------------- the text ---------------- */

ok('words split on any whitespace, punctuation kept on its word',
  same(text.splitWords('  She hesitated,\tthen   left. '), ['She', 'hesitated,', 'then', 'left.']))

const clauseCases = [
  ['She hesitated at the door, then she left.', ['She hesitated at the door', ',', 'then she left', '.']],
  ['I stayed because it rained; the roads were closed.',
    ['I stayed', 'because it rained', ';', 'the roads were closed', '.']],
  ['When she left the house was quiet.', ['When she left the house was quiet', '.']],
  ['He knew the man who had called.', ['He knew the man', 'who had called', '.']],
  ['Salt and pepper.', ['Salt and pepper', '.']],
  ['Wait — "listen," she said.', ['Wait', '—', '"', 'listen', ',', '"', 'she said', '.']],
]
for (const [input, expected] of clauseCases) {
  ok(`clauses: ${JSON.stringify(input)}`, same(text.splitClauses(input), expected))
}

/* punctuation and capitals */
const tokenCases = [
  ['She hesitated, then left.', ['She', 'hesitated', ',', 'then', 'left', '.']],
  ['"Wait," she said.', ['"', 'Wait', ',', '"', 'she', 'said', '.']],
  ['Really?! No...', ['Really', '?!', 'No', '...']],
  ["Mr. Smith's dog didn't bark (much).", ['Mr.', "Smith's", 'dog', "didn't", 'bark', '(', 'much', ')', '.']],
  ['The U.S. team — tired — won.', ['The', 'U.S.', 'team', '—', 'tired', '—', 'won', '.']],
  ["'Hello,' she said, 'goodbye.'", ["'", 'Hello', ',', "'", 'she', 'said', ',', "'", 'goodbye', '.', "'"]],
  ["The dogs' bowls.", ['The', "dogs'", 'bowls', '.']],
]
for (const [input, expected] of tokenCases) ok(`tokens: ${JSON.stringify(input)}`, same(text.tokenize(input), expected))
for (const [input] of tokenCases) {
  ok(`put back together unchanged: ${JSON.stringify(input)}`, text.joinTokens(text.tokenize(input)) === input)
}
ok('a mark is punctuation, a word is not', text.isPunctuation('?!') && text.isPunctuation('—') && !text.isPunctuation("didn't"))
ok('joining a period onto a word hugs it', text.joinText('door', '.') === 'door.' && text.joinText('"', 'wait') === '"wait')
ok('sentence-start capitals come off; I and acronyms keep theirs',
  same(text.sentenceTokens('She ran. I stayed. NASA called. Then McDonald left.'),
    ['she', 'ran', '.', 'I', 'stayed', '.', 'NASA', 'called', '.', 'then', 'McDonald', 'left', '.']))
ok('a dialogue tag after ! or ? is not a new sentence',
  same(text.sentenceTokens('"Stop!" She said.').slice(3, 5), ['"', 'She']))
ok('capitals go back where sentences now begin',
  text.joinTokens(['left', '.', 'she', 'ran', '.', '"', 'why', '?', '"', 'he', 'asked', '.'], { startsSentence: true })
    === 'Left. She ran. "Why?" he asked.')
ok('a fragment from mid-sentence stays lowercase',
  text.composeSentence([{ id: 'a', text: 'the' }, { id: 'b', text: 'door' }], 'the door opened') === 'the door')

const session = text.createSession('She quietly hesitated at the door.')
ok('a new session is one bubble per word and per mark, the sentence-start capital left off',
  same(texts(session.words), ['she', 'quietly', 'hesitated', 'at', 'the', 'door', '.']))
ok('and keeps the sentence it began from', session.original === 'She quietly hesitated at the door.')
ok('every bubble has its own id', new Set(session.words.map((word) => word.id)).size === 7)
ok('compose puts it back as it was', text.composeSentence(session.words, session.original) === 'She quietly hesitated at the door.')

const clauses = text.regroupClauses(text.createSession('She left, and the door closed.').words)
ok('regrouped into clauses, their punctuation apart', same(texts(clauses), ['she left', ',', 'and the door closed', '.']))
const split = text.splitBubble(clauses, clauses[2].id)
ok('one clause split back into its words, in place',
  same(texts(split), ['she left', ',', 'and', 'the', 'door', 'closed', '.']))
ok('regrouping into words splits every bubble', same(texts(text.regroupWords(clauses)), ['she', 'left', ',', 'and', 'the', 'door', 'closed', '.']))
ok('join puts one space between', text.joinText(' the ', 'door ') === 'the door')
ok('moveTo places into the list without the moved item', same(text.moveTo(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']))

const aside = [{ id: 'x', text: 'quietly', x: 0.02, y: 0.4 }]
const kept = text.reconcileSession({ ...session, aside }, 'She quietly hesitated at the door.')
ok('reopening an unedited sentence keeps its bubbles as they were', same(kept.words, session.words) && same(kept.aside, aside))
const edited = text.reconcileSession({ ...session, aside }, 'She paused at the door.')
ok('a sentence edited in the document since wins over the stored bubbles',
  same(texts(edited.words), ['she', 'paused', 'at', 'the', 'door', '.']))
ok('but the set-aside words survive it', same(edited.aside, aside))

const normalized = text.normalizeSession({
  id: 'b', original: 'x', words: [{ id: 'a', text: '  hi ' }, { id: 'e', text: '   ' }],
  aside: [{ id: 'z', text: 'far', x: 4, y: -1 }],
})
ok('normalize drops empty bubbles and trims', same(texts(normalized.words), ['hi']))
ok('and keeps a set-aside bubble on the screen', normalized.aside[0].x === 1 && normalized.aside[0].y === 0)

/* sentences: reordering a paragraph */
ok('sentences, each taking its opening marks with it',
  same(text.splitSentences('She ran. He stayed! "Why?" she asked. (Then) it rained.'),
    ['She ran.', 'He stayed!', '"Why?" she asked.', '(Then) it rained.']))
ok('clauses do not run across a sentence end',
  same(text.splitClauses('She ran, then stopped. He stayed.'), ['She ran', ',', 'then stopped', '.', 'He stayed', '.']))
const paragraph = text.createSession('She ran. He stayed.', 'sentences')
ok('a paragraph session is a bubble per sentence, capitals left off',
  same(texts(paragraph.words), ['she ran.', 'he stayed.']) && paragraph.mode === 'sentences')
ok('reordered sentences are recapitalized',
  text.composeSentence([paragraph.words[1], paragraph.words[0]], paragraph.original) === 'He stayed. She ran.')
ok('regrouping sentences into words and back',
  same(texts(text.regroup(text.regroup(paragraph.words, 'words'), 'sentences')), ['she ran.', 'he stayed.']))
ok('the mode is kept through normalizing', text.normalizeSession(paragraph).mode === 'sentences')

/* forms: saved versions of the arrangement */
{
  const w = (...list) => list.map((word) => ({ id: word, text: word }))
  let state = { words: w('a', 'b'), aside: [], mode: 'words', forms: [], unsaved: null }
  ok('with no forms there is one page, unsaved', forms.formPages(state) === 1 && forms.currentForm(state) === -1)
  state = forms.saveForm(state, 'f1')
  ok('saving makes the arrangement form 1, and there is no unsaved page',
    forms.currentForm(state) === 0 && forms.formPages(state) === 1 && state.forms[0].mode === undefined)
  ok('saving it again does nothing', forms.saveForm(state, 'f2') === state)
  state = forms.settleForms({ ...state, words: w('b', 'a') })
  ok('an edit makes it unsaved, a page after the form',
    forms.currentForm(state) === -1 && forms.formPages(state) === 2 && forms.formPage(state) === 1)
  state = forms.saveForm(state, 'f2')
  state = forms.settleForms({ ...state, words: w('c'), mode: 'clauses' })
  state = forms.showFormPage(state, 0)
  ok('showing a form puts its bubbles back exactly, and keeps the unsaved ones',
    same(state.words, w('a', 'b')) && state.mode === 'words' && same(state.unsaved?.words, w('c'))
    && forms.formPages(state) === 3 && forms.formPage(state) === 0)
  state = forms.showFormPage(state, 1)
  ok('moving between forms keeps the unsaved ones still', same(state.words, w('b', 'a')) && same(state.unsaved?.words, w('c')))
  state = forms.showFormPage(state, 2)
  ok('and coming back finds them as they were',
    same(state.words, w('c')) && state.mode === 'clauses' && state.unsaved === null && forms.formPage(state) === 2)
  ok('there is no page past the last', forms.showFormPage(state, 3) === state)
  state = forms.showFormPage(state, 0)
  state = forms.settleForms({ ...state, words: w('a') })
  ok('editing a form that is showing lets the kept arrangement go',
    state.unsaved === null && forms.formPages(state) === 3 && forms.formPage(state) === 2)
  state = forms.showFormPage(state, 1)
  state = forms.deleteForm(state, 1)
  ok('deleting the form showing leaves its bubbles, unsaved',
    same(state.words, w('b', 'a')) && state.forms.length === 1 && forms.currentForm(state) === -1
    && forms.formPages(state) === 2)
  ok('a clauses form stores its mode', forms.saveForm({ ...state, mode: 'clauses' }, 'f3').forms[1].mode === 'clauses')
  const stored = text.normalizeSession({ id: 'b', original: 'x', words: [], forms: [
    { id: 'f', words: [{ id: 'a', text: ' hi ' }], aside: [{ id: 'z', text: 'far', x: 3, y: 0.5 }], mode: 'words' },
  ] })
  ok('forms are kept through normalizing, trimmed and on screen',
    same(stored.forms, [{ id: 'f', words: [{ id: 'a', text: 'hi' }], aside: [{ id: 'z', text: 'far', x: 1, y: 0.5 }] }]))
  ok('and a session with none stores none', !('forms' in text.normalizeSession({ id: 'b', original: '', words: [] })))
}

/* capitals follow the words */
const moved = [{ id: 'a', text: 'she' }, { id: 'b', text: 'left' }, { id: 'c', text: 'quietly' }, { id: 'd', text: '.' },
  { id: 'e', text: 'he' }, { id: 'f', text: 'stayed' }, { id: 'g', text: '.' }]
ok('the word that begins each sentence is shown with a capital',
  same(text.displayTexts(moved, 'She left quietly.'), ['She', 'left', 'quietly', '.', 'He', 'stayed', '.']))
ok('moved to the front, a word takes the capital and the old first word gives it up',
  same(text.displayTexts(text.moveTo(moved, 2, 0), 'She left quietly.').slice(0, 3), ['Quietly', 'she', 'left']))
ok('a bubble holding a sentence start shows it inside',
  same(text.displayTexts([{ id: 'a', text: 'she left.' }, { id: 'b', text: 'he stayed.' }], 'She left.'), ['She left.', 'He stayed.']))
ok('a fragment from mid-sentence stays lowercase', text.displayTexts(moved.slice(0, 2), 'she left')[0] === 'she')
ok('names and I keep their capitals anywhere', same(text.displayTexts([{ id: 'a', text: 'then' }, { id: 'b', text: 'I' }], 'Then I'), ['Then', 'I']))

/* pinching */
ok('spreading splits one level at a time: sentences, then clauses, then words',
  same(text.splitOnce('she ran, then stopped. he stayed.'), ['she ran, then stopped.', 'he stayed.'])
  && same(text.splitOnce('she ran, then stopped.'), ['she ran', ',', 'then stopped', '.'])
  && same(text.splitOnce('then stopped.'), ['then stopped', '.'])
  && same(text.splitOnce('then stopped'), ['then', 'stopped']))
const pair = [{ id: 'a', text: 'the' }, { id: 'b', text: 'door' }, { id: 'c', text: '.' }]
ok('pinching merges two neighbours, keeping the first one\'s id',
  same(text.mergeAdjacent(pair, 1), [{ id: 'a', text: 'the' }, { id: 'b', text: 'door.' }])
  && same(text.mergeAdjacent(pair, 0)[0], { id: 'a', text: 'the door' }))

/* ---------------- the drops ---------------- */

const present = {
  words: [{ id: 'a', text: 'She' }, { id: 'b', text: 'hesitated' }, { id: 'c', text: 'quietly' }],
  aside: [{ id: 'd', text: 'at dawn', x: 0.05, y: 0.5 }],
}
ok('insert moves a bubble to a slot',
  same(texts(drop.applyDrop(present, 'c', { kind: 'insert', index: 1 }).words), ['She', 'quietly', 'hesitated']))
const joinedAfter = drop.applyDrop(present, 'c', { kind: 'join', id: 'b', before: false })
ok('join after: target first, one bubble, target keeps its id',
  same(joinedAfter.words, [{ id: 'a', text: 'She' }, { id: 'b', text: 'hesitated quietly' }]))
ok('join before: the dragged bubble first',
  drop.applyDrop(present, 'c', { kind: 'join', id: 'a', before: true }).words[0].text === 'quietly She')
ok('joins build up across as many words as you like',
  drop.applyDrop(joinedAfter, 'a', { kind: 'join', id: 'b', before: true }).words[0].text === 'She hesitated quietly')
const setAside = drop.applyDrop(present, 'a', { kind: 'aside', x: 0.97, y: 0.3 })
ok('aside takes it out of the sentence and puts it where it was thrown',
  same(texts(setAside.words), ['hesitated', 'quietly']) && same(setAside.aside[1], { id: 'a', text: 'She', x: 0.97, y: 0.3 }))
ok('a set-aside bubble comes back into the sentence',
  same(texts(drop.applyDrop(present, 'd', { kind: 'insert', index: 3 }).words), ['She', 'hesitated', 'quietly', 'at dawn']))
ok('a set-aside bubble can be joined onto',
  drop.applyDrop(present, 'b', { kind: 'join', id: 'd', before: true }).aside[0].text === 'hesitated at dawn')
const trashed = drop.applyDrop(present, 'b', { kind: 'trash' })
ok('trash removes it from wherever it was', same(texts(trashed.words), ['She', 'quietly']) && trashed.aside.length === 1)

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height })
const stage = rect(0, 0, 1000, 800)
ok('near an edge is the aside band; the middle is not',
  drop.nearEdge(stage, 40, 400) && drop.nearEdge(stage, 500, 780) && !drop.nearEdge(stage, 500, 400))
const leftRest = drop.asidePoint(stage, 30, 400, { width: 80, height: 40 })
ok('set aside against the nearest edge, where it was put along it',
  leftRest.x === (drop.EDGE_MARGIN + 40) / 1000 && leftRest.y === 0.5)
const topRest = drop.asidePoint(stage, 500, 5, { width: 80, height: 40 })
ok('against the top edge it rests below the controls', topRest.y * 800 === drop.TOP_CLEARANCE + 20)
const row = [
  { id: 'a', rect: rect(100, 100, 60, 40) },
  { id: 'b', rect: rect(170, 100, 60, 40) },
  { id: 'c', rect: rect(100, 150, 60, 40) },
]
const geometry = { row, rowRect: rect(100, 100, 400, 90), stage }
ok('the slot before the first bubble past the pointer', drop.insertion(geometry, 150, 120).index === 1)
ok('after the last on its line', drop.insertion(geometry, 400, 110).index === 2)
ok('on the second line', drop.insertion(geometry, 400, 170).index === 3 && drop.insertion(geometry, 110, 170).index === 2)
ok('a pinch in the gap between two bubbles, or just over their edges, is over that gap',
  drop.gapAt(row, 165, 120) === 0 && drop.gapAt(row, 150, 120) === 0 && drop.gapAt(row, 185, 125) === 0)
ok('but not over the middle of a bubble, nor between lines', drop.gapAt(row, 130, 120) === -1 && drop.gapAt(row, 165, 170) === -1)
ok('the bubble under a spread', drop.bubbleAt(row, 200, 120)?.id === 'b' && drop.bubbleAt(row, 165, 120) === null)
const dragged = (left, right, top = 100) => ({ left, right, top, bottom: top + 40 })
ok('touching one bubble joins with it, on the side it touched',
  same(drop.touchTarget(dragged(232, 292), row), { id: 'b', before: false })
  && same(drop.touchTarget(dragged(40, 102), row), { id: 'a', before: true }))
ok('not quite touching is not a join', drop.touchTarget(dragged(240, 300), row) === null)
ok('held over the gap between two, touching both, it goes between them',
  drop.touchTarget(dragged(140, 190), row) === null)
ok('unless pressed much further into one', drop.touchTarget(dragged(110, 175), row)?.id === 'a')
ok('a bubble on another line is not touched', drop.touchTarget(dragged(100, 160, 30), [row[2]]) === null)
const v = drop.velocityOf([{ x: 0, y: 0, t: 0 }, { x: 50, y: 0, t: 50 }, { x: 150, y: 0, t: 100 }])
ok('velocity over the last moments of a drag', v.x > 1 && v.y === 0)

/* ---------------- the document ---------------- */

const makeEditor = (html) => new Editor({
  element: document.getElementById('root').appendChild(document.createElement('div')),
  extensions: [StarterKit, BubbleSession],
  content: html,
})

const editor = makeEditor('<p>Before it. She hesitated at the <strong>door</strong>. After it.</p>')
const select = (from, to) => editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)))
const find = (needle) => {
  const start = editor.state.doc.textContent.indexOf(needle) + 1
  return { from: start, to: start + needle.length }
}

const target = find('She hesitated at the door.')
select(target.from - 1, target.to + 1) // with the spaces either side
const range = selectionForBubble(editor)
ok('a selection is trimmed of its surrounding spaces', same(range, target))

const bubble = text.createSession('She hesitated at the door.')
bubble.words = drop.applyDrop(
  { words: bubble.words, aside: [] }, bubble.words[3].id, { kind: 'join', id: bubble.words[4].id, before: true },
).words // she hesitated at [the door] .
bubble.words = text.moveTo(bubble.words, 3, 0) // [the door] she hesitated at .
bubble.aside = [{ id: 'q', text: 'quietly', x: 0.02, y: 0.4 }]
ok('the arrangement, capitalized where the sentence now begins',
  text.composeSentence(bubble.words, bubble.original) === 'The door she hesitated at.')

writeBubbleSession(editor, range, bubble, { keep: true })
ok('Done writes the sentence into the document',
  editor.state.doc.textContent === 'Before it. The door she hesitated at. After it.')
let found = findBubbleSession(editor.state.doc, bubble.id)
ok('and leaves the session on it', !!found && editor.state.doc.textBetween(found.from, found.to) === 'The door she hesitated at.')
ok('with the set-aside words in it', same(found.session.aside, bubble.aside))
ok('the chip marks it in the editor',
  editor.view.dom.querySelectorAll(`.bubble-session-chip[data-bubble-session-id="${bubble.id}"]`).length === 1)
ok('the caret is after the sentence', editor.state.selection.from === found.to)
// Hung in the margin (lib/marginHang.js), so a full line never pushes it onto its own.
const hang = editor.view.dom.querySelector('.bubble-session-chip').parentElement
ok('the chip hangs, taking the width of the space after the sentence',
  hang.classList.contains('margin-hang') && hang.classList.contains('is-before-space')
  && hang.lastElementChild.classList.contains('margin-hang-space'))
ok('…which is made droppable at the end of a line',
  [...editor.view.dom.querySelectorAll('.margin-hang-after')].map((el) => el.textContent).join('|') === ' ')

// Typing right after it is not typing into it.
editor.chain().insertContent('!').run()
ok('the mark does not grow at its end', findBubbleSession(editor.state.doc, bubble.id).to === found.to)
ok('and with no space after it now, its chip has none to stand in for',
  !editor.view.dom.querySelector('.bubble-session-chip').parentElement.classList.contains('is-before-space')
  && !editor.view.dom.querySelector('.margin-hang-after'))

// A note's dot hangs the same way.
{
  const { NoteAnnotation, syncEditorNotes } = await import(`${S}/extensions/NoteAnnotation.js`)
  const noted = new Editor({
    element: document.getElementById('root').appendChild(document.createElement('div')),
    extensions: [StarterKit, NoteAnnotation],
    content: '<p>One word here.</p>',
  })
  syncEditorNotes(noted, [{ id: 'n1', type: 'quote', from: 1, to: 9 }], 'doc') // "One word"
  const dotHang = () => noted.view.dom.querySelector('.note-marker')?.parentElement
  ok('a note\'s dot hangs, standing in for the space after it',
    dotHang()?.classList.contains('is-before-space') && noted.view.dom.querySelectorAll('.margin-hang-after').length === 1)
  noted.commands.setContent('<p>One word, here.</p>')
  syncEditorNotes(noted, [{ id: 'n2', type: 'quote', from: 1, to: 9 }], 'doc')
  ok('a dot before a comma has no space to stand in for',
    dotHang() && !dotHang().classList.contains('is-before-space'))
  noted.commands.insertContentAt(9, 'y')
  ok('…nor, typed at its place, does it get one: the text goes before it',
    noted.state.doc.textContent === 'One wordy, here.' && dotHang() && !dotHang().classList.contains('is-before-space'))
  noted.destroy()
}

// What version history stores, and restores.
const json = editor.getJSON()
const restored = makeEditor('')
restored.commands.setContent(json)
const fromJson = findBubbleSession(restored.state.doc, bubble.id)
ok('the session survives the document JSON', same(fromJson?.session, found.session))
const fromHtml = findBubbleSession(makeEditor(editor.getHTML()).state.doc, bubble.id)
ok('and the document HTML', same(fromHtml?.session, found.session))

ok('the caret inside the sentence finds its session', bubbleSessionAt(editor.state.doc, found.from + 3)?.id === bubble.id)
ok('outside it, none', bubbleSessionAt(editor.state.doc, 2) === null)

// A pasted copy of the sentence is not a second copy of the session.
const slice = editor.state.doc.slice(found.from, found.to)
let pasted = slice
editor.view.someProp('transformPasted', (transform) => { pasted = transform(pasted, editor.view) })
let pastedMarks = 0
pasted.content.descendants((node) => { if (node.marks.some((m) => m.type.name === 'bubbleSession')) pastedMarks += 1 })
ok('pasting strips the session', pasted instanceof Slice && pastedMarks === 0 && pasted.content.size === slice.content.size)

// Reopened, changed only in what is set aside: the text and its formatting are untouched.
const bold = makeEditor('<p>A <strong>bold</strong> move.</p>')
const boldRange = { from: 1, to: bold.state.doc.content.size - 1 }
const boldSession = text.createSession('A bold move.')
writeBubbleSession(bold, boldRange, boldSession, { keep: true })
const again = findBubbleSession(bold.state.doc, boldSession.id)
writeBubbleSession(bold, again, { ...boldSession, aside: [{ id: 'z', text: 'daring', x: 1, y: 0.5 }] }, { keep: true })
ok('an unchanged sentence keeps its own formatting', bold.getHTML().includes('<strong'))
ok('and takes the new session', findBubbleSession(bold.state.doc, boldSession.id)?.session.aside[0].text === 'daring')
ok('still one run', findBubbleSessions(bold.state.doc).length === 1)

/* ---------------- forms, switched in the document ---------------- */
{
  const doc = makeEditor('<p>Intro. She left the room quietly. Outro.</p>')
  const start = doc.state.doc.textContent.indexOf('She') + 1
  const spot = { from: start, to: start + 'She left the room quietly.'.length }
  let session = text.createSession('She left the room quietly.')
  let state = forms.saveForm(forms.formsStateOf(session), 'f1')
  const w = state.words
  state = forms.saveForm(forms.settleForms({ ...state, words: [w[4], ...w.slice(0, 4), w[5]] }), 'f2')
  state = forms.settleForms({ ...state, words: [w[1], w[0], ...w.slice(2)] })
  session = forms.withFormsState(session, state)
  writeBubbleSession(doc, spot, session, { keep: true })
  const entry = () => findBubbleSession(doc.state.doc, session.id)
  ok('a session with forms is on the unsaved page, the last of three',
    same(sessionForms(doc.state.doc, entry()).page, 2) && sessionForms(doc.state.doc, entry()).pages === 3)
  const chip = doc.view.dom.querySelector('.bubble-session-chip')
  ok('its chip shows a dot for each page, the one showing marked',
    chip.querySelectorAll('.bubble-session-chip-dot').length === 3
    && chip.querySelectorAll('.bubble-session-chip-dot')[2].classList.contains('is-current')
    && chip.dataset.formPages === '3')
  doc.view.dispatch(doc.state.tr.setSelection(TextSelection.create(doc.state.doc, 2)))
  ok('turning to form 1 writes it into the sentence', showSessionForm(doc, session.id, 0)
    && doc.state.doc.textContent === 'Intro. She left the room quietly. Outro.')
  ok('without moving the caret', doc.state.selection.from === 2)
  ok('and keeps the unsaved arrangement in the session',
    !!entry().session.unsaved && sessionForms(doc.state.doc, entry()).pages === 3)
  ok('the next form, by step', showSessionForm(doc, session.id, (page) => page + 1)
    && doc.state.doc.textContent === 'Intro. Quietly she left the room. Outro.')
  ok('and back to the unsaved one', showSessionForm(doc, session.id, 2)
    && doc.state.doc.textContent === 'Intro. Left she the room quietly. Outro.' && !entry().session.unsaved)
  ok('there is nothing past the last page', !showSessionForm(doc, session.id, 3))
  doc.view.dispatch(doc.state.tr.setSelection(TextSelection.create(doc.state.doc, entry().from + 2)))
  // Mod is whatever ProseMirror's keymap decided when it loaded, from the platform then.
  const { keydownHandler } = await import('@tiptap/pm/keymap')
  let modIsMeta = false
  keydownHandler({ 'Mod-x': () => { modIsMeta = true; return true } })(doc.view, new window.KeyboardEvent('keydown', { key: 'x', metaKey: true }))
  const key = new window.KeyboardEvent('keydown', {
    key: '[', metaKey: modIsMeta, ctrlKey: !modIsMeta, altKey: true, bubbles: true, cancelable: true,
  })
  // Turns made moments apart are one undo step; a writer's are not.
  const { closeHistory } = await import('@tiptap/pm/history')
  doc.view.dispatch(closeHistory(doc.state.tr))
  doc.view.dom.dispatchEvent(key)
  ok('⌥⌘[ with the caret in the sentence turns back a page',
    key.defaultPrevented && doc.state.doc.textContent === 'Intro. Quietly she left the room. Outro.')
  doc.commands.undo()
  ok('and ⌘Z in the document turns it back', doc.state.doc.textContent === 'Intro. Left she the room quietly. Outro.')
  doc.destroy()
}

/* ---------------- opening and closing, through the hook ---------------- */

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

let api = null
function Harness() {
  api = useBubbleSessions({ docPath: 'one.md', projectName: 'Archive Project' })
  return null
}
const root = createRoot(document.getElementById('root').appendChild(document.createElement('div')))
await act(async () => { root.render(React.createElement(Harness)) })

const doc = makeEditor('<p>One. Two three four. Five.</p>')
const at = (needle) => {
  const start = doc.state.doc.textContent.indexOf(needle) + 1
  return { from: start, to: start + needle.length }
}
const sentence = at('Two three four.')
doc.view.dispatch(doc.state.tr.setSelection(TextSelection.create(doc.state.doc, sentence.from, sentence.to)))
await act(async () => { api.openFromSelection(doc) })
ok('Bubble opens a new session on the selection', same(texts(api.open?.session.words ?? []), ['two', 'three', 'four', '.']))
ok('nothing is written while it is open', !findBubbleSessions(doc.state.doc).length)

const opened = api.open.session
await act(async () => { api.close({ ...opened, id: 'someone-else' }, false) })
ok('a close for another session is ignored', !!api.open)

const rearranged = { ...opened, words: [opened.words[2], opened.words[0], opened.words[3]], aside: [{ ...opened.words[1], x: 0, y: 0.5 }] }
await act(async () => { api.close(rearranged, false) })
ok('Done closes it', api.open === null)
ok('and writes the sentence, recapitalized', doc.state.doc.textContent === 'One. Four two. Five.')
ok('keeping the session', findBubbleSession(doc.state.doc, opened.id)?.session.aside[0].text === 'three')

// The chip reopens it, set-aside words and all.
const chip = doc.view.dom.querySelector('.bubble-session-chip')
await act(async () => { chip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
ok('clicking the chip reopens the session as it was left',
  api.open?.session.id === opened.id && same(texts(api.open.session.words), ['four', 'two', '.'])
  && api.open.session.aside[0].text === 'three')

// Archive: the session comes off the sentence and goes into the document's archive.
const docFile = `${await getProjectRoot('Archive Project')}/one.md.json`
files.set(docFile, JSON.stringify({ content: [], notes: [], versions: [] }))
const archived = new Promise((done) => window.addEventListener(archiveStore.ARCHIVE_CHANGED_EVENT, done, { once: true }))
await act(async () => { api.close(api.open.session, true) })
await archived
ok('Archive removes the session from the sentence', findBubbleSessions(doc.state.doc).length === 0
  && !doc.view.dom.querySelector('.bubble-session-chip'))
ok('leaving the sentence as arranged', doc.state.doc.textContent === 'One. Four two. Five.')
const archive = await archiveStore.getArchive('Archive Project', 'one.md')
ok('and keeps the session in the document\'s archive, set-aside words and all',
  archive.length === 1 && archive[0].kind === 'bubble' && archive[0].title === 'Four two.'
  && archive[0].bubble.id === opened.id && archive[0].bubble.aside[0].text === 'three')
await saveDocument('Archive Project', 'one.md', { content: { type: 'doc' }, notes: [] })
ok('an autosave carries the archive forward', JSON.parse(files.get(docFile)).archive?.length === 1)

// Restoring puts it back on its sentence, where the sentence still is.
const { restoreArchivedItem } = await import(`${S}/components/useDocumentArchive.js`)
ok('restoring puts the session back on its sentence', restoreArchivedItem(doc, archive[0])
  && findBubbleSession(doc.state.doc, opened.id)?.session.aside[0].text === 'three'
  && doc.state.doc.textBetween(findBubbleSession(doc.state.doc, opened.id).from, findBubbleSession(doc.state.doc, opened.id).to) === 'Four two.')
ok('but not twice', !restoreArchivedItem(doc, archive[0]))
await archiveStore.removeArchivedItem('Archive Project', 'one.md', archive[0].id)
ok('and it can be taken out of the archive', (await archiveStore.getArchive('Archive Project', 'one.md')).length === 0)
const elsewhere = makeEditor('<p>Nothing like it.</p>')
ok('a sentence no longer in the document cannot take it back', !restoreArchivedItem(elsewhere, archive[0]))

// Archive from the context menu, without opening: the text stays.
const beforeText = doc.state.doc.textContent
await act(async () => { api.archiveSession(doc, opened.id) })
ok('archiving from the menu leaves the text alone', doc.state.doc.textContent === beforeText && !findBubbleSessions(doc.state.doc).length)

// Undo in the document brings the archived session back, as any edit would.
doc.commands.undo()
ok('⌘Z in the document undoes an archive', findBubbleSessions(doc.state.doc).length === 1)
doc.commands.redo()

// Bubble Paragraph: the whole paragraph around the caret, a bubble per sentence.
const para = makeEditor('<p>First one. Second one! Third one?</p>')
para.view.dispatch(para.state.tr.setSelection(TextSelection.create(para.state.doc, 4)))
await act(async () => { api.openParagraph(para) })
ok('Bubble Paragraph opens the paragraph as sentences',
  same(texts(api.open?.session.words ?? []), ['first one.', 'second one!', 'third one?']) && api.open.session.mode === 'sentences')
const ws = api.open.session.words
await act(async () => { api.close({ ...api.open.session, words: [ws[2], ws[0], ws[1]] }, false) })
ok('and writes the paragraph back reordered', para.state.doc.textContent === 'Third one? First one. Second one!')
ok('keeping the mode on the session', findBubbleSessions(para.state.doc)[0]?.session.mode === 'sentences')

// Every word thrown away: the sentence goes, and the session with it.
const lone = makeEditor('<p>Keep this. Drop this. Keep that.</p>')
const loneStart = lone.state.doc.textContent.indexOf('Drop this.') + 1
lone.view.dispatch(lone.state.tr.setSelection(TextSelection.create(lone.state.doc, loneStart, loneStart + 10)))
await act(async () => { api.openFromSelection(lone) })
await act(async () => { api.close({ ...api.open.session, words: [] }, false) })
ok('an emptied sentence is removed, without a double space', lone.state.doc.textContent === 'Keep this. Keep that.')
ok('and leaves no session', findBubbleSessions(lone.state.doc).length === 0)

await act(async () => { root.unmount() })
for (const instance of [editor, restored, bold, doc, lone, para]) instance.destroy()

/* ---------------- the page's editor, mounted ---------------- */

const BubbleEditor = (await import(`${S}/components/BubbleEditor.jsx`)).default
const editorRoot = createRoot(document.getElementById('root').appendChild(document.createElement('div')))
let closed = null
const start = text.createSession('She hesitated at the door, then she left.')
await act(async () => {
  editorRoot.render(React.createElement(BubbleEditor, {
    session: { ...start, aside: [{ id: 'q', text: 'quietly', x: 0.02, y: 0.4 }] },
    onClose: (value, archive) => { closed = { value, archive } },
  }))
})
const overlay = document.querySelector('.bubble-editor')
const rowTexts = () => [...overlay.querySelectorAll('.bubble-row .bubble-text')].map((node) => node.textContent)
const press = (key, init = {}) => act(async () => {
  (document.activeElement || overlay).dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, ...init }))
})
const click = (element) => act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
const button = (label) => [...overlay.querySelectorAll('button')].find((node) => (node.textContent.trim() || node.getAttribute('aria-label')) === label)

ok('the editor mounts with one bubble per word and per mark',
  same(rowTexts(), ['She', 'hesitated', 'at', 'the', 'door', ',', 'then', 'she', 'left', '.']))
ok('punctuation bubbles are the round ones',
  [...overlay.querySelectorAll('.bubble-row .bubble.is-punctuation .bubble-text')].map((node) => node.textContent).join('') === ',.')
ok('and the set-aside word where it was left', overlay.querySelector('.bubble-aside-layer .bubble-text')?.textContent === 'quietly')
ok('it takes the keyboard from the document', document.activeElement === overlay)

await press('n')
const draft = overlay.querySelector('.bubble.is-draft input')
ok('typing starts a new word with what was typed', draft?.value === 'n')
await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  setter.call(draft, 'now')
  draft.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})
await press('Enter')
ok('Enter puts it at the end, capitalized, since it begins a sentence there', rowTexts().at(-1) === 'Now')

await click(button('Clauses'))
ok('Clauses regroups the sentence, breaking at sentence ends too',
  same(rowTexts(), ['She hesitated at the door', ',', 'then she left', '.', 'Now']))
await press('z', { metaKey: true })
ok('⌘Z undoes it', rowTexts().length === 11)
await press('z', { metaKey: true, shiftKey: true })
ok('⇧⌘Z redoes it', rowTexts().length === 5)
await click(button('Words'))
ok('Words splits it back', rowTexts().length === 11)
await click(button('Sentences'))
ok('Sentences groups it by sentence', same(rowTexts(), ['She hesitated at the door, then she left.', 'Now']))
await click(button('Words'))
ok('there is no title in the bar', !overlay.querySelector('.bubble-editor-bar').textContent.includes('Bubble'))
ok('Done is its own round button beside the bar',
  !!overlay.querySelector('.bubble-editor-top > .bubble-editor-done') && !overlay.querySelector('.bubble-editor-bar .bubble-editor-done'))

// Select a bubble with a press and release, then delete it from the keyboard.
const first = overlay.querySelector('.bubble-row .bubble')
const pointer = (type, target, x = 10, y = 10) => act(async () => {
  target.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }))
})
await pointer('pointerdown', first)
await pointer('pointerup', window)
ok('a press without a drag selects', overlay.querySelector('.bubble.is-selected .bubble-text')?.textContent === 'She')
ok('and offers what can be done to it', !!button('Set aside') && !!button('Delete'))
await press('Backspace')
ok('Backspace deletes the selected bubble, and the new first word takes the capital',
  rowTexts()[0] === 'Hesitated')

// A pinch (Chromium's ctrl-wheel) over the gap between the first two bubbles merges them.
const place = (element, left, width) => {
  element.getBoundingClientRect = () => ({ left, right: left + width, top: 100, bottom: 144, width, height: 44 })
}
const rowBubbles = [...overlay.querySelectorAll('.bubble-row .bubble[data-bubble-id]')]
rowBubbles.forEach((element, index) => place(element, 100 + index * 70, 60))
const beforePinch = rowTexts()
const pinchAt = (deltaY, x) => act(async () => {
  overlay.dispatchEvent(new dom.window.WheelEvent('wheel', { deltaY, ctrlKey: true, clientX: x, clientY: 120, bubbles: true, cancelable: true }))
})
await pinchAt(30, 165)
ok('pinching in over a gap merges the bubbles either side', rowTexts()[0] === `${beforePinch[0]} ${beforePinch[1]}`
  && rowTexts().length === beforePinch.length - 1)
await pinchAt(30, 165)
ok('one pinch makes one change', rowTexts().length === beforePinch.length - 1)
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 260)) })
const merged = overlay.querySelector('.bubble-row .bubble[data-bubble-id]')
place(merged, 100, 130)
await pinchAt(-30, 160)
ok('spreading over a joined bubble splits it', same(rowTexts(), beforePinch))
await press('z', { metaKey: true })
await press('z', { metaKey: true })
ok('and both are undoable', same(rowTexts(), beforePinch))

await click(overlay.querySelector('.bubble-editor-done'))
ok('Done hands back the arrangement, keeping the session',
  closed?.archive === false && text.composeSentence(closed.value.words, closed.value.original) === 'Hesitated at the door, then she left. Now'
  && closed.value.aside[0].text === 'quietly' && closed.value.id === start.id && closed.value.mode === 'words')
await click(button('Archive'))
ok('Archive hands it back to be archived', closed?.archive === true)

await act(async () => { editorRoot.unmount() })

/* ---------------- under the Swift shell ---------------- */

// The shell owns the `bubble` chrome: the page draws neither the editor nor the chips.
const { shellBridge } = await import(`${S}/bridge/index.ts`)
window.__inkblotNative = { post: () => {}, listen: () => () => {}, chrome: ['bubble'] }
const heard = { bubbleChipsChanged: [], bubbleSessionOpened: [] }
for (const type of Object.keys(heard)) shellBridge.on(type, (payload) => heard[type].push(payload))
const frame = () => act(async () => {
  await new Promise((resolve) => dom.window.requestAnimationFrame(() => resolve()))
  await new Promise((resolve) => setTimeout(resolve, 10))
})

const native = makeEditor('<p>Alpha beta. Gamma delta.</p>')
let nativeApi = null
function NativeHarness() {
  nativeApi = useBubbleSessions({ docPath: 'native.md' })
  return null
}
const nativeRoot = createRoot(document.getElementById('root').appendChild(document.createElement('div')))
await act(async () => { nativeRoot.render(React.createElement(NativeHarness)) })

native.view.dispatch(native.state.tr.setSelection(TextSelection.create(native.state.doc, 3)))
await act(async () => { nativeApi.openParagraph(native) })
const openedNatively = heard.bubbleSessionOpened.at(-1)
ok('opening goes to the shell, not the page', nativeApi.open === null && openedNatively?.docPath === 'native.md'
  && same(texts(openedNatively.session.words), ['alpha beta.', 'gamma delta.']))
const nw = openedNatively.session.words
await act(async () => {
  shellBridge.send('closeBubbleSession', { session: { ...openedNatively.session, words: [nw[1], nw[0]] }, archive: false })
})
ok('and the shell closing it writes the paragraph', native.state.doc.textContent === 'Gamma delta. Alpha beta.')

// The chips stay the page's: drawn over from reported positions, they trailed the text
// through every scroll.
await frame()
await frame()
ok('the page draws its own chips, reporting none to the shell',
  !!native.view.dom.querySelector('.bubble-session-chip') && heard.bubbleChipsChanged.length === 0)

await act(async () => { nativeRoot.unmount() })
delete window.__inkblotNative
native.destroy()
