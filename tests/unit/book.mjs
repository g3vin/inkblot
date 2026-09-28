/**
 * The Book navigator (components/book): the book's rows as the page publishes them,
 * each change a command, and where a dragged row lands.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'DOMParser',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { documentSurface } = await import('../../src/bridge/index.ts')
const { moveTarget, addMenu, rowMenu } = await import('../../src/components/book/bookMenu.js')
const { default: BookNavigator } = await import('../../src/components/book/BookNavigator.jsx')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

ok('a drop lands before the entry at its place', moveTarget(['a', 'b', 'c'], 'a', 2) === 'c' && moveTarget(['a', 'b', 'c'], 'c', 0) === 'a')
ok('a drop past the end has nothing after it', moveTarget(['a', 'b', 'c'], 'a', 3) === null)
const menu = addMenu([{ id: 'x', generated: 'contents' }])
ok('the + menu offers a generated page once', menu[0].items.find((i) => i.text === 'Contents').enabled === false && menu[0].items.find((i) => i.text === 'Title Page').enabled === true)
ok('a chapter’s menu has its type; a page of the book’s own can be renamed',
  rowMenu({ id: 'c', kind: 'chapter', hidden: false }, {}).some((i) => i.text === 'Chapter Type')
  && rowMenu({ id: 'm', kind: 'matter', hidden: false }, {}).some((i) => i.text === 'Rename…'))

const commands = []
for (const type of ['openBookItem', 'setBookItemHidden', 'moveBookItem']) documentSurface.onCommand(type, (payload) => commands.push({ type, payload }))

const root = createRoot(document.getElementById('root'))
await act(async () => { root.render(React.createElement(BookNavigator, { hasProject: true })) })
await act(async () => {
  documentSurface.publishPageLayoutState({
    mode: 'typeset', book: { title: 'The Novel', folder: 'Novel' }, selectedBookItem: 'ch1',
    cover: { sets: [], trimWidthMm: 0, trimHeightMm: 0, spineWidthMm: 0, bleedMm: 0, wrapWidthMm: 0, wrapHeightMm: 0, pageCount: 0, checks: [] },
    bookItems: [
      { id: 'ded', kind: 'matter', title: 'Dedication', hidden: false, section: 'front', page: {} },
      { id: 'ch1', kind: 'chapter', title: 'Chapter 1', number: 1, label: 'Chapter One', hidden: false, section: 'body', page: {} },
      { id: 'ch2', kind: 'chapter', title: 'Chapter 2', number: 2, hidden: true, section: 'body', page: {} },
      { id: 'ack', kind: 'matter', title: 'Acknowledgements', hidden: false, section: 'back', page: {} },
    ],
  })
  await wait(40)
})
const text = document.body.textContent
ok('the sections, in the book’s order', text.indexOf('Front Matter') < text.indexOf('Dedication') && text.indexOf('Chapters') < text.indexOf('Chapter 1') && text.indexOf('Back Matter') < text.indexOf('Acknowledgements'))
ok('the book is named at the foot', text.includes('The Novel'))
const rows = [...document.querySelectorAll('.book-row[data-reorder-id]')]
ok('the selected row is marked', rows.find((r) => r.dataset.reorderId === 'ch1').getAttribute('aria-selected') === 'true')
ok('a hidden row is marked', rows.find((r) => r.dataset.reorderId === 'ch2').dataset.hidden === 'true')
await act(async () => { rows.find((r) => r.dataset.reorderId === 'ack').click() })
ok('a click opens the row by command', commands.at(-1)?.type === 'openBookItem' && commands.at(-1).payload.id === 'ack')
await act(async () => { rows.find((r) => r.dataset.reorderId === 'ch2').querySelector('.book-row-eye').click() })
ok('the eye shows a hidden row again', commands.at(-1)?.type === 'setBookItemHidden' && commands.at(-1).payload.hidden === false)
await act(async () => { document.querySelector('.book-cover-row').click() })
ok('the cover opens as a row', commands.at(-1)?.payload.id === 'cover')

await act(async () => { root.unmount() })
