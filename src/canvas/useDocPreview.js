/**
 * useDocPreview.js — the rendered contents of a project document, for a file card.
 *
 * A `file` node pointing at a project document shows a read-only preview of that
 * document. The preview is static HTML from generateHTML(), exactly as a text card
 * renders its own stored JSON (CanvasTextNode) — no editor is instantiated, so a
 * canvas full of document cards costs no more than a canvas full of text cards.
 *
 * The document is read from disk, not from a live editor: a card may point at a
 * document that isn't open in any pane. That means the preview is as of load; it
 * refreshes when the card remounts, which is good enough for a thumbnail and keeps
 * this off the save path entirely.
 */
import { useEffect, useState } from 'react'
import { generateHTML } from '@tiptap/core'
import { loadDocument } from '../lib/FileSystem'
import { getDocPreviewExtensions } from '../lib/editorExtensions'

/** `Chapters/One.json` (what the node stores) → `Chapters/One` (what FileSystem takes). */
export const filePathToDocPath = (file) => String(file || '').replace(/\.json$/i, '')

/** `Chapters/One` → `Chapters/One.json`. The node stores the real file, per the spec. */
export const docPathToFilePath = (docPath) => `${String(docPath || '')}.json`

export function useDocPreview(projectName, file) {
  const [preview, setPreview] = useState({ status: 'loading', html: '', title: '' })

  useEffect(() => {
    const docPath = filePathToDocPath(file)
    if (!projectName || !docPath) {
      setPreview({ status: 'missing', html: '', title: '' })
      return
    }

    let cancelled = false

    loadDocument(projectName, docPath).then((doc) => {
      if (cancelled) return

      const title = docPath.split('/').filter(Boolean).pop() || docPath

      if (!doc) {
        // The document was renamed, moved, or deleted out from under the card. Say
        // so rather than rendering an empty card that looks like a bug.
        setPreview({ status: 'missing', html: '', title })
        return
      }

      let html = ''
      try {
        // The DOCUMENT extension set, not the card one: a document can hold nodes a
        // card cannot (ConversationTile, PinterestBoard), and generateHTML throws on
        // an unknown type — which would blank the whole preview, not just that node.
        html = doc.content ? generateHTML(doc.content, getDocPreviewExtensions()) : ''
      } catch (error) {
        // Still guarded: a document written by a future version may hold something
        // even this schema lacks. Say the preview failed rather than render blank.
        console.warn('[canvas] could not render document preview:', error)
        setPreview({ status: 'unrenderable', html: '', title })
        return
      }

      setPreview({ status: 'ready', html, title })
    })

    return () => {
      cancelled = true
    }
  }, [file, projectName])

  return preview
}
