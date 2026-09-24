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
 * Mapped through an edit they stay true: the widget sits with the text after it, so
 * typing at its place goes before it, and deleting what follows it deletes it too.
 */
export const marginHangDecorations = (doc, pos, toDOM, spec) => {
  const beforeSpace = spaceAt(doc, pos)
  const widget = Decoration.widget(pos, (view, getPos) => hangInMargin(toDOM(view, getPos), beforeSpace), {
    ...spec,
    key: `${spec.key}:${beforeSpace ? 'space' : 'none'}`,
  })
  return beforeSpace ? [widget, Decoration.inline(pos, pos + 1, { class: 'margin-hang-after' })] : [widget]
}

