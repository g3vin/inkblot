/**
 * DocumentLock.js — keeps a locked document's text from changing (docLocks.ts).
 *
 * A transaction that would change the document is refused while the editor holds a
 * locked document. Everything else goes through: selecting, notes (which are
 * positions beside the text, not marks in it), timeline passages (plugin state),
 * Print Layout's pagination (decorations). Loading a document replaces the editor's
 * state outright (useEditorDocCache), which no filter sees, so a locked document
 * still opens.
 *
 * The editor is left editable, because a selection made in a read-only ProseMirror
 * view never reaches its state, and a note needs one. The caret is hidden instead
 * (`.pane[data-locked]` in DocLockBadge.css), and a refused keystroke tells the pane's
 * lock badge (`noteLockedEdit`).
 *
 * `setEditorLock` is how a pane says which document it holds and whether it is
 * locked; it is per editor, in the extension's storage.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { noteLockedEdit } from '../lib/docLocks'

const DOCUMENT_LOCK_KEY = new PluginKey('documentLock')

export const DocumentLock = Extension.create({
  name: 'documentLock',

  addStorage() {
    return { locked: false, docPath: null }
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    return [
      new Plugin({
        key: DOCUMENT_LOCK_KEY,
        filterTransaction(transaction) {
          if (!storage.locked || !transaction.docChanged) return true
          noteLockedEdit(storage.docPath)
          return false
        },
      }),
    ]
  },
})

/** Tell an editor which document it holds and whether that document is locked. */
export function setEditorLock(editor, docPath, locked) {
  const storage = editor?.storage?.documentLock
  if (!storage) return
  storage.docPath = docPath ?? null
  storage.locked = Boolean(locked)
}
