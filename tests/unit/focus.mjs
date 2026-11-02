/**
 * Focus mode: the document read as sentences, and the overlay driving a real editor.
 *
 *   - text offsets map back to document positions, a block break resolving to the
 *     character after it
 *   - sentences keep their punctuation and are numbered within their paragraphs
 *   - the caret past a sentence's end is in its trailing spaces or on a fresh line
 *   - the overlay mounted: ↓ steps sentence by sentence and on past the last one to an
 *     empty line, where the first word typed is spaced from the sentence before
 *   - its keys stay out of a palette or menu open over it, and leaving reports back
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'NodeFilter',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent',
  'WheelEvent', 'MutationObserver', 'getComputedStyle', 'DOMParser'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
dom.window.scrollBy = () => {}
const noRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })
for (const proto of [dom.window.Element.prototype, dom.window.Range.prototype, dom.window.Text.prototype]) {
  proto.getClientRects ??= () => []
  proto.getBoundingClientRect ??= noRect
}

const S = '../../src'
const F = await import(`${S}/lib/focusText.js`)
const { Editor } = await import('@tiptap/core')
const { StarterKit } = await import('@tiptap/starter-kit')
const { TextSelection } = await import('@tiptap/pm/state')
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: FocusModeOverlay } = await import(`${S}/components/FocusModeOverlay.jsx`)

const makeEditor = (html) => new Editor({
  element: document.getElementById('root').appendChild(document.createElement('div')),
  extensions: [StarterKit],
  content: html,
})

// ---- the text map ----
const editor = makeEditor('<p>One. Two!</p><p>Three?</p>')
const map = F.buildFocusTextMap(editor.state.doc)
ok('blocks are joined by a blank line', map.text === 'One. Two!\n\nThree?')
ok('one more position than characters, for the very end', map.positions.length === map.text.length + 1)
const threeAt = map.text.indexOf('Three')
ok('a block break resolves to the character after it',
  F.getTextOffsetForDocPosition(map.positions, map.positions[threeAt]) === threeAt)
ok('every character maps back to itself',
  [...map.text].every((character, offset) => character === '\n' || F.getTextOffsetForDocPosition(map.positions, map.positions[offset]) === offset))
ok('past the end is the end', F.getTextOffsetForDocPosition(map.positions, 10_000) === map.positions.length - 1)

// ---- sentences ----
const spans = F.getSentenceSpans(map.text)
ok('three sentences, punctuation kept', spans.map((span) => span.text).join('|') === 'One.|Two!|Three?')
ok('numbered within their paragraphs',
  spans.map((span) => `${span.paragraph}:${span.sentence}/${span.sentences}`).join() === '0:0/2,0:1/2,1:0/1')
ok('a closing quote stays with its sentence', F.getSentenceSpans('“Go.” Then.').map((span) => span.text).join('|') === '“Go.”|Then.')
ok('the readout counts from one', F.describePosition(spans[1]) === '¶ 1 · Sentence 2 of 2')
ok('an empty line after a sentence reads as a new one', F.describePosition(spans[2], 'sentence') === '¶ 2 · New sentence')

// ---- the caret among them ----
const text = 'One. Two.  \nThree'
const lineSpans = F.getSentenceSpans(text)
ok('inside a sentence', JSON.stringify(F.locateCaret(lineSpans, text, 1)) === '{"index":0,"slot":null}')
ok('at its end, still in it', JSON.stringify(F.locateCaret(lineSpans, text, 4)) === '{"index":0,"slot":null}')
ok('a space typed after it is its trailing space', JSON.stringify(F.locateCaret(lineSpans, text, 10)) === '{"index":1,"slot":"trailing"}')
const broken = text.slice(0, 12)
ok('past a line break is a fresh line', JSON.stringify(F.locateCaret(F.getSentenceSpans(broken), broken, 12)) === '{"index":1,"slot":"next"}')
ok('no sentences: an empty line', F.locateCaret([], '', 0).slot === 'next')
const windowed = F.getSentenceWindow(lineSpans, text, 1, 0, 0, 1)
ok('the window carries its buffer and each line\'s break', windowed.map((s) => `${s.index}${s.breakBefore}`).join() === '0,1,2line')

// ---- the overlay, mounted ----
const writer = makeEditor('<p>First one. Second one.</p>')
writer.commands.setTextSelection(1)
const root = createRoot(document.body.appendChild(document.createElement('div')))
let exits = 0
let exited = 0
const render = (leaving) => React.act(() => root.render(React.createElement(FocusModeOverlay, {
  editor: writer,
  leaving,
  onExit: () => { exits += 1 },
  onExited: () => { exited += 1 },
})))
await render(false)
const current = () => document.querySelector('.focus-mode-sentence.current')?.textContent ?? ''
ok('opens on the sentence the caret is in', current() === 'First one.')
const key = (name, target = writer.view.dom) => React.act(() => {
  target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
})
await key('ArrowDown')
ok('↓ goes to the next sentence', current() === 'Second one.' && writer.state.selection.from === 12)
await key('ArrowDown')
ok('↓ from the last opens an empty line after it', Boolean(document.querySelector('.focus-mode-slot.current .focus-mode-caret')))
ok('with the caret at the very end', writer.state.selection.from === writer.state.doc.content.size - 1)
await React.act(() => {
  const { from, to } = writer.state.selection
  writer.view.someProp('handleTextInput', (handle) => handle(writer.view, from, to, 'T'))
})
ok('the first letter typed there is spaced from the sentence', writer.getText() === 'First one. Second one. T')
await key('ArrowUp')
ok('↑ goes back a sentence', writer.state.selection.from === 12)

// Typing a space after a sentence shows it, with the caret after it.
await React.act(() => {
  writer.view.dispatch(writer.state.tr.setSelection(TextSelection.create(writer.state.doc, 11)))
})
await React.act(() => { writer.view.dispatch(writer.state.tr.insertText(' ', 11)) })
const caretSentence = document.querySelector('.focus-mode-caret')?.parentElement
ok('a typed space is drawn, the caret after it', caretSentence?.textContent === 'First one. ' && caretSentence.lastChild?.className === 'focus-mode-caret')
ok('the caret holds still while typing', document.querySelector('.focus-mode-overlay')?.classList.contains('is-typing'))

const palette = document.body.appendChild(document.createElement('input'))
const before = writer.state.selection.from
await key('ArrowDown', palette)
await key('Escape', palette)
ok('a palette over focus mode keeps its own keys', writer.state.selection.from === before && exits === 0)
await key('Escape')
ok('Escape in the text asks to leave', exits === 1)
await render(true)
ok('leaving reports when it is done', exited === 1)
await React.act(() => root.unmount())
ok('the slot plugin goes with it', !writer.state.plugins.some((plugin) => plugin.spec.key?.key?.startsWith('focusModeSlot')))
