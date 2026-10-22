/**
 * An indicator after a word — a bubble session's chip, a note's dot — that never ends up
 * alone at the start of the next line, away from the word it belongs to.
 *
 * The browser may break a line between a word and an inline widget, so a word that
 * filled its line pushed the widget down onto a line of its own. Here the indicator
 * takes no room in the line: it sits after the word and, when the line is full, runs out
 * past the text into the margin. The room it would have taken is a space after it
 * instead (`.margin-hang-space`), as wide as the indicator. Mid-line that keeps the words
 * after it clear of it; at the end of a line a space is not something a line wraps for —
 * it is dropped there.
 *
 * Not the editor's own spaces, though: they are `break-spaces`, which wrap rather than
 * drop, so the space after a sentence would have gone down and started the next line one
 * space in. When one follows the indicator it is made droppable too
 * (`.margin-hang-after`), and the indicator's space takes its width (`is-before-space`).
 *
 * `--hang-width` on the wrapper is the indicator's width, its left margin included: the
 * indicator's stylesheet sets it where the width is fixed, its plugin where it is not.
 */
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration } from '@tiptap/pm/view'

const hangInMargin = (indicator, beforeSpace) => {
  const hang = document.createElement('span')
  hang.className = beforeSpace ? 'margin-hang is-before-space' : 'margin-hang'
  hang.contentEditable = 'false'
  const space = document.createElement('span')
  space.className = 'margin-hang-space'
  space.textContent = ' '
  hang.append(indicator, space)
  return hang
}

const spaceAt = (doc, pos) => {
  const next = doc.resolve(pos).nodeAfter
  return Boolean(next?.isText && next.text.startsWith(' '))
}

/**
 * The decorations for an indicator at `pos`: the widget `toDOM` draws, hung in the
 * margin, and the space after it if there is one. `spec` is the widget's, `key` included.
 *
 * The widget belongs to the word before it (side -1): the caret at its place is drawn
 * after it, so a writer can put the cursor after a dot and type there, and arrowing
 * right from the word steps over it. Mapped through an edit it stays with that word.
 */
export const marginHangDecorations = (doc, pos, toDOM, spec) => {
  const beforeSpace = spaceAt(doc, pos)
  const widget = Decoration.widget(pos, (view, getPos) => hangInMargin(toDOM(view, getPos), beforeSpace), {
    ...spec,
    side: -1,
    key: `${spec.key}:${beforeSpace ? 'space' : 'none'}`,
  })
  return beforeSpace ? [widget, Decoration.inline(pos, pos + 1, { class: 'margin-hang-after' })] : [widget]
}


/** The indicator hung at a document position, if there is one. */
const hangAt = (view, pos) => {
  for (const hang of view.dom.querySelectorAll('.margin-hang')) {
    try {
      if (view.posAtDOM(hang, 0) === pos) return hang
    } catch {
      // Not in the document any more.
    }
  }
  return null
}

/**
 * The caret at an indicator's place is drawn after it, not before. The browser would
 * put it at the end of the word, left of the dot, though typing there goes after it;
 * now what you see is where it goes. ArrowLeft from there steps back into the word,
 * rather than stopping a second time on the dot's other side. One plugin for every
 * indicator (notes' dots and bubbles' chips); NoteAnnotation registers it.
 */
export const marginHangCaret = () => new Plugin({
  key: new PluginKey('marginHangCaret'),
  props: {
    handleKeyDown(view, event) {
      if (event.key !== 'ArrowLeft' || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false
      const { selection } = view.state
      if (!selection.empty || selection.head <= 1 || !hangAt(view, selection.head)) return false
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, selection.head - 1)).scrollIntoView())
      return true
    },
  },
  view: () => ({
    update(view) {
      const { selection } = view.state
      if (!selection.empty || !view.hasFocus()) return
      const hang = hangAt(view, selection.head)
      const dom = view.dom.ownerDocument.getSelection()
      if (!hang || !dom) return
      const range = view.dom.ownerDocument.createRange()
      range.setStartAfter(hang)
      range.collapse(true)
      dom.removeAllRanges()
      dom.addRange(range)
    },
  }),
})
