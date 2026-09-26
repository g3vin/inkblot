/**
 * TypesetLock.ts — a chapter's prose, held still while the book is typeset.
 *
 * In Typeset mode a manuscript chapter is shown as its pages, and what the writer does
 * there is set type — a style on a paragraph, tracking to pull a line back, a picture's
 * width — not write. Proofing and rewriting happen in Write mode, with the tools for
 * them. So while a pane is locked (`editor.storage.typesetLock.locked`, set by
 * PaneEditorSurface) a transaction that would change the text is refused, and what is
 * let through is:
 *
 *   - anything marked `typeset` — the Typeset tools' own edits, whatever steps they take;
 *   - attribute steps: a node's attrs (a paragraph's style or tracking, an image's
 *     width) and the doc's (its page setup, its chapter's subtitle);
 *   - edits inside the chapter's title — its opening Heading 1, which is part of the
 *     chapter head and typed in place on the page;
 *   - a replacement of the whole document, which is a document being loaded or a
 *     version restored, never typing.
 *
 * Front and back matter (a dedication, About the Author) are only ever edited in
 * Typeset, so their panes are not locked. A double-click on locked prose offers "Edit
 * Text" (TypesetEditText.jsx): the way back to Write, at that spot.
 *
 * Typeset-only transactions are also how the text history stays about text: autosave
 * does not count one toward a version checkpoint (useEditorAutosave).
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { AttrStep, DocAttrStep, ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform'
import type { Step } from '@tiptap/pm/transform'

/** The meta key that marks a transaction as typesetting, not writing. */
export const TYPESET_META = 'typeset'

/** The event a double-click on locked prose sends, for "Edit Text" to offer itself. */
export const TYPESET_EDIT_TEXT_EVENT = 'inkblot:typeset-edit-text'

export const typesetLockKey = new PluginKey('typesetLock')

declare module '@tiptap/core' {
  interface Storage {
    typesetLock: { locked: boolean }
  }
}

/** A matter document — the book's own page, kept in its folder's `.book/`. */
export const isMatterPath = (path: string | null | undefined): boolean => (
  Boolean(path) && /(^|\/)\.book\//.test(path as string)
)

/** The chapter's title: its opening Heading 1, as a range of the document. */
export const titleRange = (doc: PMNode): { from: number; to: number } | null => {
  const first = doc.firstChild
  if (!first || first.type.name !== 'heading' || first.attrs.level !== 1) return null
  return { from: 0, to: first.nodeSize }
}

const inside = (from: number, to: number, range: { from: number; to: number } | null) => (
  Boolean(range) && from > range!.from && to < range!.to
)

/** Whether one step, applied to `doc`, leaves the prose as it was. */
const allowed = (step: Step, doc: PMNode): boolean => {
  if (step instanceof AttrStep || step instanceof DocAttrStep) return true
  if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) {
    const { from, to } = step as unknown as { from: number; to: number }
    if (from === 0 && to === doc.content.size) return true
    return inside(from, to, titleRange(doc))
  }
  // A mark added or removed: formatting the prose, which is Write's.
  const { from, to } = step as unknown as { from?: number; to?: number }
  return typeof from === 'number' && typeof to === 'number' && inside(from, to, titleRange(doc))
}

/** Whether a transaction may apply to a locked pane. */
export const allowedWhileLocked = (tr: Transaction): boolean => (
  !tr.docChanged || Boolean(tr.getMeta(TYPESET_META)) || tr.steps.every((step, i) => allowed(step, tr.docs[i]))
)

export const TypesetLock = Extension.create({
  name: 'typesetLock',

  addStorage() {
    return { locked: false }
  },

  addProseMirrorPlugins() {
    const storage = this.storage as { locked: boolean }
    return [
      new Plugin({
        key: typesetLockKey,
        filterTransaction: (tr: Transaction) => !storage.locked || allowedWhileLocked(tr),
        props: {
          handleDoubleClick: (view, pos, event) => {
            if (!storage.locked) return false
            const state: EditorState = view.state
            if (inside(pos, pos, titleRange(state.doc))) return false
            window.dispatchEvent(new CustomEvent(TYPESET_EDIT_TEXT_EVENT, {
              detail: { view, pos, x: event.clientX, y: event.clientY },
            }))
            return false
          },
        },
      }),
    ]
  },
})
