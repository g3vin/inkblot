/**
 * DocPageSetup.js — the document's page setup, as an attribute of its `doc` node.
 *
 * Stored on the node rather than beside `content` in the file, because that is the
 * one place that already travels everywhere a document does: autosave writes
 * `editor.getJSON()`, every version snapshot stores that JSON, and restoring a
 * version restores the layout it was written in. saveDocument's key whitelist
 * never has to hear about it.
 *
 * Set through `setPageSetup`, which uses ProseMirror's `setDocAttribute` step — so a
 * change of paper size is one undo away like any other edit.
 *
 * `null` means "never set up": the document has no page setup of its own, and
 * Print Layout shows it on the default page until the author picks one.
 */
import { Extension } from '@tiptap/core'

import { normalizePageSetup } from './pageSetup'
import { TYPESET_META } from './TypesetLock'
import { chapterTypesetOf } from './typesetHistory'

export const DocPageSetup = Extension.create({
  name: 'docPageSetup',

  addGlobalAttributes() {
    return [
      {
        types: ['doc'],
        attributes: {
          pageSetup: {
            default: null,
            // A doc node is never parsed from or rendered to HTML, so the attribute
            // exists only in JSON — which is exactly where it is stored.
            parseHTML: () => null,
            renderHTML: () => ({}),
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      // Typesetting, not writing: allowed on a locked chapter, and kept out of the text
      // history (TypesetLock.ts).
      setPageSetup: (setup) => ({ tr, dispatch }) => {
        if (dispatch) {
          tr.setDocAttribute('pageSetup', setup ? normalizePageSetup(setup) : null)
          tr.setMeta(TYPESET_META, true)
        }
        return true
      },
    }
  },
})

/** The document's own page setup, or null when it has never been given one. */
export const readDocPageSetup = (doc) => doc?.attrs?.pageSetup || null

/**
 * Replace an editor's content — a text version restored, a merge — keeping its
 * typesetting as it is now.
 *
 * The text history and the typeset history are apart (typesetHistory.ts): going back to
 * an older draft of the words must not take the book's page setup, the chapter's head,
 * or what was set on its paragraphs and pictures back with it. So the typesetting is
 * read before and set again after, onto the blocks that still carry the same
 * `typesetId`. (`setContent` builds a new doc node, which would otherwise start with
 * default attributes — and a version stored only as HTML has none at all.)
 */
export const setContentKeepingPageSetup = (editor, content) => {
  const typeset = chapterTypesetOf(editor.getJSON())
  const applied = editor.chain().setContent(content).run()
  const tr = editor.state.tr
  tr.setDocAttribute('pageSetup', typeset.pageSetup ?? null)
  tr.setDocAttribute('chapter', typeset.chapter ?? null)
  // The blocks that are still there get what was set on them.
  editor.state.doc.descendants((node, pos) => {
    const id = node.attrs?.typesetId
    const target = id ? typeset.blocks[id] : null
    if (!target) return
    for (const [key, value] of Object.entries(target)) {
      if (key in node.attrs && node.attrs[key] !== value) tr.setNodeAttribute(pos, key, value)
    }
  })
  tr.setMeta(TYPESET_META, true)
  editor.view.dispatch(tr)
  return applied
}

/** A TipTap JSON document with a page setup attached — for content built from HTML. */
export const withPageSetup = (json, setup) => (
  setup && json && typeof json === 'object'
    ? { ...json, attrs: { ...(json.attrs || {}), pageSetup: setup } }
    : json
)

export default DocPageSetup
