/**
 * Footnote.ts — a note, written where it belongs.
 *
 * An inline atom at the note's mark, holding the note's own text (`text`), so moving
 * the sentence moves its note. In the editor it shows as its mark, numbered by the
 * page's CSS counter in document order; clicking it opens it to be written
 * (FootnoteEditor.jsx). Compiled (notes.ts), it carries its `mark`, and `end` when the
 * book sets its notes after the chapter or the book rather than at the page's foot.
 *
 * ⌥⌘F (as in Word), or Insert ▸ Footnote, puts one at the caret and opens it.
 */
import { Node, mergeAttributes } from '@tiptap/core'

/** Sent when a note's mark is clicked, or a note is put in: the editor opens. */
export const FOOTNOTE_EDIT_EVENT = 'inkblot:edit-footnote'

let counter = 0
const newNoteId = () => {
  counter = (counter + 1) % 46656
  return `fn${Date.now().toString(36)}${counter.toString(36)}`
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      /** A note at the caret, opened to be written. */
      insertFootnote: (text?: string) => ReturnType
      /** The note at `pos` given `text`; an empty text leaves it empty. */
      setFootnoteText: (pos: number, text: string) => ReturnType
    }
  }
}

const openEditor = (view: unknown, pos: number, el: Element | null) => {
  if (typeof window === 'undefined') return
  const rect = el?.getBoundingClientRect?.() || null
  window.dispatchEvent(new CustomEvent(FOOTNOTE_EDIT_EVENT, { detail: { view, pos, rect } }))
}

export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-footnote') || null },
      text: { default: '', parseHTML: (el) => el.getAttribute('data-text') || '' },
      // Given when a book is compiled: the note's mark, and whether it is set later.
      mark: { default: null, parseHTML: (el) => el.getAttribute('data-mark') || null },
      end: { default: null, parseHTML: (el) => (el.hasAttribute('data-end') ? true : null) },
    }
  },

  parseHTML() {
    return [{ tag: 'sup[data-footnote]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const { id, text, mark, end } = node.attrs
    return ['sup', mergeAttributes(HTMLAttributes, {
      class: 'footnote-ref',
      'data-footnote': id || '',
      'data-text': text || '',
      ...(mark ? { 'data-mark': mark } : {}),
      ...(end ? { 'data-end': '' } : {}),
    }), mark || '']
  },

  renderText({ node }) {
    return node.attrs.mark ? `[${node.attrs.mark}]` : ''
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('sup')
      dom.className = 'footnote-ref'
      dom.contentEditable = 'false'
      const draw = (n: typeof node) => {
        dom.dataset.footnote = n.attrs.id || ''
        if (n.attrs.mark) dom.dataset.mark = n.attrs.mark
        else delete dom.dataset.mark
        dom.textContent = n.attrs.mark || ''
        dom.title = n.attrs.text || 'An empty note'
        dom.classList.toggle('is-empty', !n.attrs.text)
      }
      draw(node)
      dom.addEventListener('mousedown', (event) => {
        event.preventDefault()
        const pos = typeof getPos === 'function' ? getPos() : null
        if (typeof pos === 'number') openEditor(editor.view, pos, dom)
      })
      return {
        dom,
        update: (next) => {
          if (next.type.name !== 'footnote') return false
          draw(next)
          return true
        },
        ignoreMutation: () => true,
        stopEvent: (event) => event.type === 'mousedown',
      }
    }
  },

  addCommands() {
    return {
      insertFootnote: (text = '') => ({ state, dispatch, view }) => {
        // After the selection, as a mark follows the words it is about.
        const at = state.selection.to
        const node = state.schema.nodes.footnote.create({ id: newNoteId(), text })
        if (dispatch) {
          dispatch(state.tr.insert(at, node).scrollIntoView())
          // Opened once it is drawn.
          setTimeout(() => {
            if (view.isDestroyed) return
            openEditor(view, at, view.nodeDOM(at) as Element | null)
          }, 0)
        }
        return true
      },
      setFootnoteText: (pos, text) => ({ state, dispatch }) => {
        const node = state.doc.nodeAt(pos)
        if (!node || node.type.name !== 'footnote') return false
        if (dispatch) dispatch(state.tr.setNodeAttribute(pos, 'text', text))
        return true
      },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-f': () => this.editor.commands.insertFootnote(),
    }
  },
})
