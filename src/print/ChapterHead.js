/**
 * ChapterHead.js — a chapter's head, set as the book designs it: its number, its title,
 * its subtitle, an ornament or a picture, an epigraph.
 *
 * One renderer for every place a chapter is set — printed and exported (as a node a
 * compiled chapter opens with, `bookMatter.ts`), and in the live editor, where the same
 * DOM is drawn around the chapter's real title (ChapterHeadDecorations.ts) — so the head
 * on the Typeset pages is the head that prints.
 *
 * The node is compile-only: a chapter never holds one on disk. Its one attribute,
 * `head`, is everything it shows, resolved from the book's design and the chapter's
 * own head (`chapterHeadFor`), so it renders without knowing the book.
 */
import { Node } from '@tiptap/core'

/** The head's CSS variables: its face and sizes. */
const headStyle = (head) => [
  head.headingFont ? `--ch-font: ${head.headingFont}` : '',
  head.numberSizePt ? `--ch-number-size: ${head.numberSizePt}pt` : '',
  head.titleSizePt ? `--ch-title-size: ${head.titleSizePt}pt` : '',
].filter(Boolean).join('; ')

/** The ornament and the chapter's picture that sit at `slot`, as DOM specs. */
const slotSpecs = (head, slot) => {
  if ((head.ornamentPosition || 'above') !== slot) return []
  const out = []
  if (head.ornament === 'rule') out.push(['div', { class: 'ch-ornament is-rule', 'data-slot': slot }])
  if (head.ornament === 'glyph' && head.ornamentGlyph) out.push(['div', { class: 'ch-ornament is-glyph', 'data-slot': slot }, head.ornamentGlyph])
  if (head.ornament === 'image' && head.ornamentImage) {
    out.push(['div', { class: 'ch-ornament is-image', 'data-slot': slot }, ['img', { src: head.ornamentImage, alt: '' }]])
  }
  if (head.image) {
    out.push(['div', { class: 'ch-image', 'data-slot': slot, style: `width: ${head.imageWidthPct || 40}%` }, ['img', { src: head.image, alt: '' }]])
  }
  return out
}

/** The whole head as a DOM spec: `['header', attrs, …children]`. */
export const chapterHeadSpec = (head = {}) => {
  const children = [...slotSpecs(head, 'above')]
  if (head.label) children.push(['div', { class: 'ch-number' }, head.label])
  children.push(...slotSpecs(head, 'between'))
  if (head.title) children.push(['h1', { class: 'ch-title' }, head.title])
  if (head.subtitle) children.push(['div', { class: 'ch-subtitle' }, head.subtitle])
  children.push(...slotSpecs(head, 'below'))
  if (head.epigraph) {
    const quote = ['blockquote', { class: 'ch-epigraph' }, ['p', {}, head.epigraph]]
    if (head.epigraphSource) quote.push(['p', { class: 'ch-epigraph-source' }, `— ${head.epigraphSource}`])
    children.push(quote)
  }
  return ['header', {
    class: 'chapter-head',
    'data-align': head.alignment || 'center',
    'data-number-case': head.numberCase || 'asWritten',
    'data-title-case': head.titleCase || 'asWritten',
    ...(headStyle(head) ? { style: headStyle(head) } : {}),
  }, ...children]
}

/** A DOM spec as elements, for the live editor's decorations. */
export const renderSpec = (spec, doc = document) => {
  if (typeof spec === 'string') return doc.createTextNode(spec)
  const [tag, attrs, ...children] = spec
  const el = doc.createElement(tag)
  for (const [name, value] of Object.entries(attrs || {})) el.setAttribute(name, value)
  for (const child of children) el.appendChild(renderSpec(child, doc))
  return el
}

/** The head as a chapter's running head and a contents entry say it. */
export const chapterHeadText = (head = {}) => (
  [head.label, head.title].filter(Boolean).join(': ')
)

export const ChapterHead = Node.create({
  name: 'chapterHead',
  group: 'block',
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      head: { default: {}, parseHTML: () => ({}), renderHTML: () => ({}) },
    }
  },

  // Never parsed back: a head is made when a chapter compiles, not typed or pasted.
  parseHTML() {
    return []
  },

  renderHTML({ node }) {
    return chapterHeadSpec(node.attrs.head || {})
  },
})

export default ChapterHead
