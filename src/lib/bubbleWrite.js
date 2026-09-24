/**
 * bubbleWrite.js — writing a bubble session's sentence into the document.
 *
 * Apart from `useBubbleSessions`, which closes the editor with it, because the
 * `bubbleSession` extension uses it too: a sentence switched to another of its forms
 * from the document is written the same way.
 */
import { TextSelection } from '@tiptap/pm/state'
import { isEditorReady } from './editorUtils'
import { composeSentence } from './bubbleText'

/**
 * Write a session's sentence over `range`. `keep` puts the session on it; without it the
 * sentence is plain text. `quiet` leaves the caret, the scroll and the focus where they
 * are — for switching a sentence's form from where the writer is reading it. Returns
 * whether anything was written.
 */
export const writeBubbleSession = (editor, range, session, { keep, quiet = false }) => {
  if (!isEditorReady(editor) || !range) return false
  const { state } = editor
  const type = state.schema.marks.bubbleSession
  if (!type) return false
  const { from, to } = range
  const text = composeSentence(session.words, session.original)
  const current = state.doc.textBetween(from, to, ' ')
  const tr = state.tr

  if (!text) {
    // Nothing left of the sentence. Take one neighbouring space with it, so the prose
    // around it does not close up on a double space.
    const before = from > 0 ? state.doc.textBetween(from - 1, from) : ''
    const after = to < state.doc.content.size ? state.doc.textBetween(to, to + 1) : ''
    tr.delete(from, after === ' ' && (before === ' ' || before === '') ? to + 1 : to)
  } else if (current === text) {
    // Only the session changed. Leave the text, and its formatting, alone.
    tr.removeMark(from, to, type)
    if (keep) tr.addMark(from, to, type.create({ id: session.id, session }))
  } else {
    // The sentence's own formatting is taken from its first character.
    const base = type.removeFromSet(state.doc.nodeAt(from)?.marks ?? [])
    const marks = keep ? type.create({ id: session.id, session }).addToSet(base) : base
    tr.replaceWith(from, to, state.schema.text(text, marks))
  }
  if (quiet) {
    editor.view.dispatch(tr)
    return true
  }
  const end = Math.min(tr.doc.content.size, from + text.length)
  tr.setSelection(TextSelection.create(tr.doc, end))
  editor.view.dispatch(tr.scrollIntoView())
  editor.commands.focus()
  return true
}
