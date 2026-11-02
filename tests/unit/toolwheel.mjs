/**
 * The selection wheel (src/ui/ToolWheel.jsx, lib/selectionTools.js,
 * components/selectionWheelSettings.js) and hidden text (extensions/HiddenText.js,
 * print/hiddenText.ts):
 *
 *   - the tool ring's places never touch, at any count it allows;
 *   - the wheel mounted: turned and taken from the keyboard, a flick taken by letting go
 *     of the held key, a highlight ink chosen from its options, Escape takes nothing;
 *   - the tools: what they show for a selection, and what they do to it;
 *   - hidden text folds to one pill per passage, the caret steps over it, Backspace
 *     against it opens it, and print and export leave it out;
 *   - the saved settings are made valid however they were left.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'DOMParser',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent',
  'MutationObserver', 'getComputedStyle'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true
// Reduced motion: the wheel opens and closes without waiting on its animations.
window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
const noRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })
for (const proto of [dom.window.Element.prototype, dom.window.Range.prototype, dom.window.Text.prototype]) {
  proto.getClientRects ??= () => []
  proto.getBoundingClientRect ??= noRect
}
window.PointerEvent ??= class extends window.MouseEvent {}

const S = '../../src'
const G = await import(`${S}/ui/inkWheelGeometry.js`)
const { StrictMode, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { default: ToolWheel } = await import(`${S}/ui/ToolWheel.jsx`)
const { Editor } = await import('@tiptap/core')
const { StarterKit } = await import('@tiptap/starter-kit')
const { Highlight } = await import('@tiptap/extension-highlight')
const { HiddenText, HIDDEN_TEXT_KEY } = await import(`${S}/extensions/HiddenText.js`)
const { wheelItems, runSelectionTool } = await import(`${S}/lib/selectionTools.js`)
const { withoutHiddenText } = await import(`${S}/print/hiddenText.ts`)
const { normalizeSelectionWheel, DEFAULT_SELECTION_WHEEL } = await import(`${S}/components/selectionWheelSettings.js`)

/* ---------------- the ring ---------------- */

const gap = (count) => {
  const a = G.slotOffset(0, count, G.toolRingRadius(count))
  const b = G.slotOffset(1, count, G.toolRingRadius(count))
  return Math.hypot(a.x - b.x, a.y - b.y) - G.TOOL_DISC
}
ok('six tools never touch', gap(6) > 0)
ok('eight tools never touch', gap(8) > 0)
ok('nine options (eight inks and Remove) never touch', gap(9) > 0)
ok('a resting hand points at nothing', G.pickSlot({ x: 6, y: -8 }, 6, null, { deadZone: G.TOOL_DEAD_ZONE }) === null)

/* ---------------- the wheel, mounted ---------------- */

const ITEMS = [
  { id: 'highlight', label: 'Highlight', icon: 'highlight', submenu: [
    { id: 'amber', label: 'Amber', color: 'var(--ink-amber)' },
    { id: 'blue', label: 'Ink Blue', color: 'var(--ink-blue)' },
  ] },
  { id: 'bold', label: 'Bold', icon: 'bold', active: false },
  { id: 'hide', label: 'Hide', icon: 'hide' },
  { id: 'bubble', label: 'Bubble', icon: 'chats', disabled: true },
]

const mount = async (props) => {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const picks = []
  let closed = false
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(ToolWheel, {
      anchor: { x: 400, y: 300 },
      items: ITEMS,
      label: 'Selection',
      onPick: (...args) => picks.push(args),
      onClose: () => { closed = true; root.render(null) },
      ...props,
    })))
  })
  return { picks, closed: () => closed, root }
}
const key = (type, k) => act(async () => { window.dispatchEvent(new window.KeyboardEvent(type, { key: k, bubbles: true })) })
const move = (x, y) => act(async () => { window.dispatchEvent(new window.PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true })) })
const ring = () => document.querySelector('.ib-tool-wheel [role="menu"]')

{
  const wheel = await mount({ mode: 'keyboard' })
  ok('the wheel opens as a menu of its tools', ring()?.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]').length === 4)
  ok('a tool that can be on says whether it is', ring()?.querySelector('[aria-label="Bold"]')?.getAttribute('aria-checked') === 'false')
  await key('keydown', 'ArrowRight')
  await key('keydown', 'Enter')
  ok('turned once and taken: Bold', wheel.picks.length === 1 && wheel.picks[0][0] === 'bold')
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  ok('and it folds away', wheel.closed() && !ring())
}

{
  const wheel = await mount({ mode: 'keyboard' })
  await key('keydown', '4')
  await key('keydown', 'Enter')
  ok('a tool that can\'t act here is passed over', wheel.picks.length === 0 && Boolean(ring()))
  await key('keydown', 'Escape')
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  ok('Escape puts it away untouched', wheel.picks.length === 0 && wheel.closed())
}

{
  const wheel = await mount({ mode: 'hold', holdKey: 'Alt', fromPointer: true })
  await move(400 + 40, 300)
  ok('a flick to three o\'clock points at the second of four', ring()?.querySelector('[data-target="true"]')?.getAttribute('aria-label') === 'Bold')
  await key('keyup', 'Alt')
  ok('letting go of the key takes it', wheel.picks.length === 1 && wheel.picks[0][0] === 'bold')
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

{
  const wheel = await mount({ mode: 'hold', holdKey: 'Alt', fromPointer: true })
  await move(403, 298)
  await key('keyup', 'Alt')
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  ok('let go at rest, nothing is taken', wheel.picks.length === 0 && wheel.closed())
}

{
  const wheel = await mount({ mode: 'keyboard' })
  await key('keydown', ' ')
  ok('Space on Highlight opens its inks', ring()?.getAttribute('aria-label') === 'Highlight' && ring()?.querySelectorAll('[role="menuitem"]').length === 2)
  await key('keydown', 'ArrowRight')
  await key('keydown', 'Enter')
  ok('and an ink is taken under it', wheel.picks.length === 1 && wheel.picks[0][0] === 'highlight' && wheel.picks[0][1] === 'blue')
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

{
  const wheel = await mount({ mode: 'touch', fromPointer: true })
  await move(400, 300 + 40)
  const up = () => act(async () => { window.dispatchEvent(new window.PointerEvent('pointerup', { clientX: 400, clientY: 340, bubbles: true })) })
  ok('a finger dragged down points at the tool at six o\'clock', ring()?.querySelector('[data-target="true"]')?.getAttribute('aria-label') === 'Hide')
  await up()
  ok('lifting it takes the tool', wheel.picks.length === 1 && wheel.picks[0][0] === 'hide')
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

{
  const wheel = await mount({ mode: 'touch', fromPointer: true })
  await act(async () => { window.dispatchEvent(new window.PointerEvent('pointerup', { clientX: 400, clientY: 300, bubbles: true })) })
  ok('a finger lifted at rest leaves the wheel open to tap', wheel.picks.length === 0 && Boolean(ring()))
  // Bold is the second of four: at three o'clock.
  const bold = G.slotOffset(1, 4, G.toolRingRadius(4))
  await act(async () => { window.dispatchEvent(new window.PointerEvent('pointerdown', { clientX: 400 + bold.x, clientY: 300 + bold.y, bubbles: true })) })
  ok('and a tap on a tool takes it', wheel.picks.length === 1 && wheel.picks[0][0] === 'bold')
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

/* ---------------- the tools ---------------- */

const makeEditor = (content) => new Editor({
  element: document.getElementById('root').appendChild(document.createElement('div')),
  extensions: [StarterKit, Highlight.configure({ multicolor: true }), HiddenText],
  content,
})

{
  const editor = makeEditor('<p>One two three</p>')
  editor.commands.setTextSelection({ from: 5, to: 8 })
  const items = wheelItems(editor, {}, ['bold', 'bubble', 'nothing'])
  ok('the wheel holds the tools it knows', items.length === 2)
  ok('Bubble is dimmed without a bubble session to open', items[1].disabled === true)
  runSelectionTool(editor, {}, 'bold')
  ok('Bold makes the selection bold', editor.isActive('bold'))
  ok('and the wheel shows it so next time', wheelItems(editor, {}, ['bold'])[0].active === true)
  const sent = []
  runSelectionTool(editor, { lastHighlightColor: () => '#ffff00', setHighlight: (...args) => sent.push(args) }, 'highlight')
  ok('Highlight uses the remembered colour, without remembering it again', sent.length === 1 && sent[0][0] === '#ffff00' && sent[0][1] === false)
  editor.commands.setHighlight({ color: '#ffff00' })
  runSelectionTool(editor, {}, 'highlight', 'none')
  ok('Remove highlight takes it off', !editor.isActive('highlight'))
  editor.destroy()
}

/* ---------------- hidden text ---------------- */

const pills = (editor) => editor.view.dom.querySelectorAll('.hidden-text-pill[data-folded="true"]')

{
  const editor = makeEditor('<p>Keep this hide this keep</p>')
  // "hide this" is 11–20.
  editor.commands.setTextSelection({ from: 11, to: 20 })
  runSelectionTool(editor, {}, 'hide')
  ok('Hide marks the text', JSON.stringify(editor.getJSON()).includes('"hiddenText"'))
  ok('and folds it to one pill', pills(editor).length === 1 && editor.view.dom.querySelectorAll('.hidden-text-folded').length === 1)
  ok('the caret goes past it, where it can be seen', editor.state.selection.empty && editor.state.selection.from >= 20)

  editor.commands.setTextSelection(15)
  ok('a caret put inside it moves out', editor.state.selection.from === 20 || editor.state.selection.from === 11)

  editor.commands.setTextSelection(20)
  // A real keydown: the keyboardShortcut command keeps a handler's steps but not its meta.
  editor.view.dom.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
  ok('Backspace against it opens it rather than eating it', pills(editor).length === 0 && editor.state.doc.textContent.includes('hide this'))

  editor.view.dispatch(editor.state.tr.setMeta(HIDDEN_TEXT_KEY, { fold: 11 }))
  ok('it folds again', pills(editor).length === 1)
  editor.commands.setAllHiddenOpen(true)
  ok('Show all opens every fold', pills(editor).length === 0)
  editor.commands.setAllHiddenOpen(false)

  editor.commands.setTextSelection({ from: 11, to: 20 })
  ok('the wheel offers Show on hidden text', wheelItems(editor, {}, ['hide'])[0].label === 'Show')
  runSelectionTool(editor, {}, 'hide')
  ok('and Show takes the mark off', !JSON.stringify(editor.getJSON()).includes('"hiddenText"') && pills(editor).length === 0)
  editor.destroy()
}

{
  const editor = makeEditor('<p>Before</p><p>First hidden</p><p>Second hidden</p><p>After</p>')
  const { doc } = editor.state
  let from = 0
  let to = 0
  doc.descendants((node, pos) => {
    if (node.isText && node.text === 'First hidden') from = pos
    if (node.isText && node.text === 'Second hidden') to = pos + node.nodeSize
  })
  editor.commands.setTextSelection({ from, to })
  editor.commands.setHiddenText()
  ok('a passage across paragraphs folds to one pill', pills(editor).length === 1)
  ok('its paragraphs fold whole', editor.view.dom.querySelectorAll('p.hidden-text-folded').length === 2)
  editor.destroy()
}

{
  const { getReadableEditorPayload } = await import(`${S}/lib/readAloud.js`)
  const editor = makeEditor('<p>Keep this hide this keep</p>')
  editor.commands.setTextSelection({ from: 11, to: 20 })
  editor.commands.setHiddenText()
  ok('Read Aloud leaves folded text unread', getReadableEditorPayload(editor, { scope: 'document' }).text.replace(/\s+/g, ' ') === 'Keep this keep')
  editor.commands.setAllHiddenOpen(true)
  ok('and reads it once it is opened', getReadableEditorPayload(editor, { scope: 'document' }).text === 'Keep this hide this keep')
  editor.destroy()
}

{
  // Closing the wheel gives the page its focus back, so holding the key again reopens it.
  const { default: SelectionWheel } = await import(`${S}/components/SelectionWheel.jsx`)
  const editor = makeEditor('<p>One two three</p>')
  // jsdom focuses a contenteditable only with a tabindex; a browser needs none.
  editor.view.dom.tabIndex = 0
  editor.view.focus()
  editor.commands.setTextSelection({ from: 5, to: 8 })
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const getEditor = () => editor
  const ctx = {}
  await act(async () => { root.render(createElement(StrictMode, null, createElement(SelectionWheel, { getEditor, ctx, enabled: true }))) })
  const tap = async () => {
    await key('keydown', 'Alt')
    await key('keyup', 'Alt')
  }
  await tap()
  ok('a tap of Option over a selection opens the wheel', Boolean(ring()))
  await key('keydown', 'Escape')
  // The editor takes focus back on the next frame.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
  ok('Escape closes it and the page has its focus back', !ring() && editor.view.hasFocus())
  await tap()
  ok('and it opens again on the same selection', Boolean(ring()))
  await key('keydown', 'Escape')
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); root.unmount() })
  editor.destroy()
}

/* ---------------- print and export ---------------- */

const text = (value, hidden = false) => ({ type: 'text', text: value, ...(hidden ? { marks: [{ type: 'hiddenText' }] } : {}) })
const docJson = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [text('Keep '), text('gone', true), text(' kept')] },
    { type: 'paragraph', content: [text('all gone', true)] },
    { type: 'paragraph' },
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [text('x', true)] }] }] }] },
  ],
}
const stripped = withoutHiddenText(docJson)
ok('print leaves hidden text out of a paragraph', JSON.stringify(stripped.content[0]) === JSON.stringify({ type: 'paragraph', content: [text('Keep '), text(' kept')] }))
ok('a paragraph all hidden goes, an empty one stays', stripped.content.length === 3 && stripped.content[1].type === 'paragraph' && !stripped.content[1].content)
ok('a table cell all hidden keeps its place', stripped.content[2].content[0].content[0].content[0].type === 'paragraph')
const plain = { type: 'doc', content: [{ type: 'paragraph', content: [text('Nothing hidden')] }] }
ok('a document with nothing hidden is passed through as it is', withoutHiddenText(plain) === plain)

/* ---------------- the settings ---------------- */

ok('unread settings are the defaults', JSON.stringify(normalizeSelectionWheel({})) === JSON.stringify(DEFAULT_SELECTION_WHEEL))
const odd = normalizeSelectionWheel({ tools: ['bold', 'bold', 'gone', 'hide', 'italic', 'strike', 'underline', 'note', 'define', 'synonyms', 'clear'], holdKey: 'Meta' })
ok('unknown tools and repeats are dropped, and at most eight are kept', odd.tools.length === 8 && odd.tools[0] === 'bold' && odd.tools[1] === 'hide' && !odd.tools.includes('gone'))
ok('an unknown hold key falls back to Option', odd.holdKey === 'Alt')
