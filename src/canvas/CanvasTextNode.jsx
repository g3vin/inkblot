/**
 * CanvasTextNode.jsx — the body of a text card.
 *
 * A card that isn't being edited is static HTML, not an editor: generateHTML()
 * only calls each node's renderHTML, so no ProseMirror instance and no node view
 * is created. That's what makes a canvas of hundreds of cards affordable.
 *
 * Memoized on the node's stored JSON, so dragging a card (which doesn't change
 * its content) regenerates nothing.
 */
import { useMemo } from 'react'
import { generateHTML } from '@tiptap/core'
import { getCardExtensions } from '../lib/editorExtensions'
import CanvasCardEditor from './CanvasCardEditor'

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

/** Fallback for cards authored elsewhere: JSON Canvas stores plain text/markdown. */
const plainTextToHtml = (text) =>
  String(text || '')
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('')

export default function CanvasTextNode({ node, editing, setActiveEditor, onCommit, onExit }) {
  const html = useMemo(() => {
    if (node.inkblotTipTap) {
      try {
        return generateHTML(node.inkblotTipTap, getCardExtensions())
      } catch (error) {
        // A card written by another app (or a future version) shouldn't blank the
        // canvas — fall back to its plain text.
        console.warn('[canvas] could not render card content, falling back to text:', error)
      }
    }
    return plainTextToHtml(node.text)
  }, [node.inkblotTipTap, node.text])

  if (editing) {
    return (
      <CanvasCardEditor
        node={node}
        setActiveEditor={setActiveEditor}
        onCommit={onCommit}
        onExit={onExit}
      />
    )
  }

  const isEmpty = !node.text && !node.inkblotTipTap

  return isEmpty ? (
    <div className="canvas-card-body">
      <p className="canvas-card-empty">Empty card</p>
    </div>
  ) : (
    // `ProseMirror` reuses the editor typography already defined in Editor.css, so
    // a static card and an editing card look identical.
    <div
      className="canvas-card-body ProseMirror"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
