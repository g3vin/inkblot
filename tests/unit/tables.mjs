/**
 * Tables (extensions/TableStyles.js, components/TableToolbar.jsx, print/export/tableStyles.ts).
 *
 *   - a cell's fill and a table's borders are saved in the document, round-trip through
 *     its HTML, and reach the page (the borders through the node view's wrapper);
 *   - the exports draw them: HTML and EPUB by stylesheet, Word by shading and borders;
 *   - the toolbar shows while the caret is in a table, and its tools change the table.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'DOMParser',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent',
  'MutationObserver', 'getComputedStyle'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.CSS ??= { escape: (value) => String(value) }
dom.window.scrollBy = () => {}
const noRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })
for (const proto of [dom.window.Element.prototype, dom.window.Range.prototype, dom.window.Text.prototype]) {
  proto.getClientRects ??= () => []
  proto.getBoundingClientRect ??= noRect
}

const S = '../../src'
const { Editor } = await import('@tiptap/core')
const { StarterKit } = await import('@tiptap/starter-kit')
const { TextAlign } = await import('@tiptap/extension-text-align')
const { TableRow } = await import('@tiptap/extension-table-row')
const { StyledTable, StyledTableCell, StyledTableHeader } = await import(`${S}/extensions/TableStyles.js`)

const makeEditor = (content = '<p>Before</p>') => new Editor({
  element: document.getElementById('root').appendChild(document.createElement('div')),
  extensions: [
    StarterKit,
    TextAlign.configure({ types: ['heading', 'paragraph', 'tableCell', 'tableHeader'] }),
    StyledTable.configure({ resizable: true }), TableRow, StyledTableHeader, StyledTableCell,
  ],
  content,
})

/* ---------------- in the document ---------------- */

const editor = makeEditor()
editor.chain().focus('end').insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
const cellPos = () => {
  let found = null
  editor.state.doc.descendants((node, pos) => {
    if (found === null && node.type.name === 'tableCell') found = pos
    return found === null
  })
  return found
}
editor.commands.setTextSelection(cellPos() + 2)
ok('the caret is in a body cell', editor.isActive('tableCell'))

editor.commands.setCellAttribute('fill', 'teal')
ok('a cell takes a fill', editor.getAttributes('tableCell').fill === 'teal')
ok('saved as an ink id', JSON.stringify(editor.getJSON()).includes('"fill":"teal"'))
ok('and in its HTML', editor.getHTML().includes('data-fill="teal"'))
ok('the page shows it', Boolean(editor.view.dom.querySelector('td[data-fill="teal"]')))

editor.commands.setTableBorders('outer')
const table = () => editor.getJSON().content.find((node) => node.type === 'table')
ok('a table takes its borders', table().attrs.borders === 'outer')
ok('saved in its HTML', editor.getHTML().includes('data-borders="outer"'))
ok('and drawn on the node view’s wrapper', editor.view.dom.querySelector('.tableWrapper')?.getAttribute('data-borders') === 'outer')
ok('a border style that does not exist is refused', !editor.commands.setTableBorders('dotted') && table().attrs.borders === 'outer')
editor.commands.setTableBorders('all')
ok('all borders is the default, and needs no mark', !editor.getHTML().includes('data-borders') && !editor.view.dom.querySelector('.tableWrapper[data-borders]'))
editor.commands.setTableBorders('none')

const html = editor.getHTML()
const reloaded = makeEditor(html)
const reloadedTable = reloaded.getJSON().content.find((node) => node.type === 'table')
ok('fills and borders come back from HTML', reloadedTable.attrs.borders === 'none' && JSON.stringify(reloadedTable).includes('"fill":"teal"'))
const stray = makeEditor('<table><tbody><tr><td data-fill="#ff0000"><p>x</p></td></tr></tbody></table>')
ok('a fill that is not an ink is dropped', !JSON.stringify(stray.getJSON()).includes('"fill":"#'))
reloaded.destroy()
stray.destroy()

/* ---------------- in the exports ---------------- */

const { fillHex, tableEdges, TABLE_STYLES_CSS } = await import(`${S}/print/export/tableStyles.ts`)
ok('a fill is a pale wash of its paper ink', /^[0-9A-F]{6}$/.test(fillHex('teal')) && parseInt(fillHex('teal').slice(0, 2), 16) > 200)
ok('no fill for something else', fillHex('#123456') === null && fillHex(null) === null)
ok('edges by style', tableEdges('inner').inner && !tableEdges('inner').outer && !tableEdges('none').outer && tableEdges(undefined).outer)
ok('the stylesheet draws fills and borders', TABLE_STYLES_CSS.includes(`td[data-fill="teal"] { background: #${fillHex('teal')}; }`) && TABLE_STYLES_CSS.includes('table[data-borders="none"]'))

const { chapterBodyHtml, PROSE_CSS } = await import(`${S}/print/export/html.ts`)
const body = chapterBodyHtml(editor.getJSON())
ok('an exported chapter keeps the fill and the borders', body.includes('data-fill="teal"') && body.includes('data-borders="none"'))
ok('and the export stylesheet has the rules', PROSE_CSS.includes(TABLE_STYLES_CSS))

const { buildDocx } = await import(`${S}/print/export/docx.ts`)
const { listZip } = await import(`${S}/print/export/zip.ts`)
const { inflateRawSync } = await import('node:zlib')
const readZipEntry = (bytes, name) => {
  const e = listZip(bytes).find((entry) => entry.name === name)
  if (!e) return ''
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + e.extraLength
  const size = view.getUint32(e.offset + 18, true)
  const raw = bytes.subarray(start, start + size)
  return (e.method === 8 ? inflateRawSync(raw) : Buffer.from(raw)).toString('utf8')
}
globalThis.XMLSerializer ??= dom.window.XMLSerializer
const docx = await buildDocx({ title: 'T', chapters: [{ title: 'One', content: editor.getJSON() }], resolveImage: async () => null, modified: new Date(0) })
const wordDoc = readZipEntry(docx, 'word/document.xml')
ok('Word shades a filled cell', wordDoc.includes(`w:fill="${fillHex('teal')}"`))
ok('and draws no borders on a table without them', wordDoc.includes('<w:insideH w:val="nil"/>') && wordDoc.includes('<w:top w:val="nil"/>'))

/* ---------------- the toolbar ---------------- */

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: TableToolbar } = await import(`${S}/components/TableToolbar.jsx`)
const { listCommands } = await import(`${S}/lib/commands.ts`)

const host = document.getElementById('root').appendChild(document.createElement('div'))
const root = createRoot(host)
await act(async () => root.render(React.createElement(TableToolbar, { editor })))
const bar = () => document.querySelector('.table-toolbar')
const button = (label) => bar()?.querySelector(`[aria-label="${label}"]`)

await act(async () => { editor.commands.setTextSelection(1); editor.commands.focus() })
ok('no toolbar outside a table', !bar())

await act(async () => { editor.commands.setTextSelection(cellPos() + 2); editor.commands.focus() })
ok('in a table, the toolbar shows', Boolean(bar()))
ok('its tools are in ⌘K while it does', listCommands().some((command) => command.id === 'table.row-below'))

const rows = () => table().content.length
const before = rows()
await act(async () => { button('Add row below').click() })
ok('Add row below adds a row', rows() === before + 1)
await act(async () => { button('Delete row').click() })
ok('Delete row takes it out', rows() === before)
const columns = () => table().content[0].content.length
await act(async () => { button('Add column right').click() })
ok('Add column right adds a column', columns() === 4)

await act(async () => { button('Borders').click() })
const borderItem = [...document.querySelectorAll('[role="menuitemcheckbox"]')].find((item) => item.textContent.includes('Inside only'))
await act(async () => { borderItem.click() })
ok('the borders menu sets the table’s borders', table().attrs.borders === 'inner')

await act(async () => { editor.commands.setTextSelection(cellPos() + 2); editor.commands.focus() })
const fillButton = () => bar()?.querySelector('[aria-label^="Cell fill"]')
ok('the fill control says the cell has none', fillButton()?.getAttribute('aria-label') === 'Cell fill: No fill')
await act(async () => { fillButton().click() })
const wheel = () => document.querySelector('.ib-ink-wheel [role="listbox"]')
ok('the fill control opens the ink wheel, and the toolbar stays', Boolean(wheel()) && Boolean(bar()))
const press = (key) => act(async () => { wheel().dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true })) })
await press('7')
await press('Enter')
ok('the fill wheel fills the cell', editor.getAttributes('tableCell').fill === 'violet')
// The taken ink springs to the middle, the ring folds on its spring, then it is gone.
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 800)) })
ok('and folds away', !wheel())

editor.storage.documentLock = { locked: true }
await act(async () => { editor.commands.setTextSelection(cellPos() + 3) })
ok('a locked document has no table toolbar', !bar())
delete editor.storage.documentLock

await act(async () => root.unmount())
editor.destroy()
