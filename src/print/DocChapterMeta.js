/**
 * DocChapterMeta.js — what a chapter's head shows beyond its title: a subtitle, a
 * picture of its own, an epigraph. An attribute of the chapter's `doc` node, as its
 * page setup is (DocPageSetup.js), so it travels with the document, its versions and
 * its undo.
 *
 * The title is the chapter's opening Heading 1, typed in place; these sit around it in
 * the chapter head, which the book's design sets (ChapterHead.js). Typesetting, not
 * writing: `setChapterMeta` is marked so, and so is allowed on a locked chapter.
 */
import { Extension } from '@tiptap/core'

import { TYPESET_META } from './TypesetLock'

const text = (value, max = 400) => (typeof value === 'string' ? value.replace(/\r\n?/g, '\n').slice(0, max) : '')

/** Anything → the chapter's head, or null when it has nothing beyond its title. */
export const normalizeChapterMeta = (raw) => {
  if (!raw || typeof raw !== 'object') return null
  const meta = {
    subtitle: text(raw.subtitle, 200).replace(/\n+/g, ' '),
    epigraph: text(raw.epigraph, 1200),
    epigraphSource: text(raw.epigraphSource, 200).replace(/\n+/g, ' '),
  }
  if (typeof raw.image === 'string' && raw.image) meta.image = raw.image
  return meta.subtitle || meta.epigraph || meta.epigraphSource || meta.image ? meta : null
}

export const DocChapterMeta = Extension.create({
  name: 'docChapterMeta',

  addGlobalAttributes() {
    return [
      {
        types: ['doc'],
        attributes: {
          chapter: {
            default: null,
            parseHTML: () => null,
            renderHTML: () => ({}),
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setChapterMeta: (meta) => ({ tr, dispatch }) => {
        if (dispatch) {
          tr.setDocAttribute('chapter', normalizeChapterMeta(meta))
          tr.setMeta(TYPESET_META, true)
        }
        return true
      },
    }
  },
})

/** A document's chapter head, from its doc node or its JSON: `{ subtitle, image, … }`. */
export const readChapterMeta = (doc) => normalizeChapterMeta(doc?.attrs?.chapter)

export default DocChapterMeta
