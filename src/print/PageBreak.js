/**
 * PageBreak.js — a manual break: what follows starts on a new page, in the next
 * column, or on the next right-hand (recto) page, as a chapter opening does.
 *
 * A block atom, so it has a place in the document the author can select, delete
 * and undo like any other. In the continuous editor it draws as a labelled rule;
 * in Print Layout it takes no space and the pagination plugin turns it into the
 * jump itself. In exports it becomes each format's own break (CSS
 * `break-after: page` in HTML, a new chapter file in EPUB).
 */
import { Node, mergeAttributes } from '@tiptap/core'

export const PAGE_BREAK_KINDS = ['page', 'column', 'recto']

const LABELS = {
  page: 'Page break',
  column: 'Column break',
  recto: 'Page break · next right-hand page',
}

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      kind: {
        default: 'page',
        parseHTML: (element) => {
          const kind = element.getAttribute('data-page-break')
          return PAGE_BREAK_KINDS.includes(kind) ? kind : 'page'
        },
        renderHTML: (attributes) => ({ 'data-page-break': attributes.kind || 'page' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-page-break]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const kind = PAGE_BREAK_KINDS.includes(node.attrs.kind) ? node.attrs.kind : 'page'
    return ['div', mergeAttributes(HTMLAttributes, {
      class: `page-break page-break-${kind}`,
      'data-label': LABELS[kind],
      contenteditable: 'false',
    })]
  },

  renderText() {
    return '\n'
  },

  addCommands() {
    return {
      insertPageBreak: (kind = 'page') => ({ chain }) => chain()
        .insertContent({ type: this.name, attrs: { kind: PAGE_BREAK_KINDS.includes(kind) ? kind : 'page' } })
        .run(),
    }
  },

  addKeyboardShortcuts() {
    return {
      // Word and Google Docs both put a page break on ⌘↩ / Ctrl+Enter.
      'Mod-Enter': () => this.editor.commands.insertPageBreak('page'),
      'Shift-Mod-Enter': () => this.editor.commands.insertPageBreak('column'),
    }
  },
})

export default PageBreak
