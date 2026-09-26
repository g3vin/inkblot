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

/** The setup a document lays out in: its own, or the default page. */
export const effectivePageSetup = (doc) => normalizePageSetup(readDocPageSetup(doc))

/**
 * Replace an editor's content without losing its page setup.
 *
 * `setContent` builds a new doc node, and a new doc node starts with default
 * attributes — so restoring a version stored only as HTML (every entry written
 * before JSON was stamped, and every merge, which is built as HTML) would quietly
 * reset the document to the default page. Content that carries a setup of its own
 * (a JSON version written after this attribute existed) brings it: restoring that
 * version restores its layout too.
 */
export const setContentKeepingPageSetup = (editor, content) => {
  // setContent replaces the doc's children, never its attributes — so a JSON
  // version's own setup has to be applied explicitly, like the carried one.
  const own = content && typeof content === 'object' ? content.attrs?.pageSetup || null : null
  const setup = own || readDocPageSetup(editor.state.doc)
  const chain = editor.chain().setContent(content)
  if (setup) chain.setPageSetup(setup)
  return chain.run()
}

/** A TipTap JSON document with a page setup attached — for content built from HTML. */
export const withPageSetup = (json, setup) => (
  setup && json && typeof json === 'object'
    ? { ...json, attrs: { ...(json.attrs || {}), pageSetup: setup } }
    : json
)

export default DocPageSetup
