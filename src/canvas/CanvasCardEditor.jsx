/**
 * CanvasCardEditor.jsx — the live TipTap editor for the one card being edited.
 *
 * At most one of these exists at a time (CanvasSurface holds a single
 * `editingNodeId`), so a canvas with 200 cards still only ever pays for one
 * ProseMirror instance. Every other card is static HTML.
 *
 * The editor tags itself and registers as the app's `activeEditor`, which is what
 * lets the existing titlebar Toolbar drive it with no changes — see the
 * `__inkblotCanvasCard` gate in EditorLayout.
 */
import { useEffect, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { buildCardExtensions } from '../lib/editorExtensions'
import { isEditorReady } from '../lib/editorUtils'

export default function CanvasCardEditor({ node, setActiveEditor, onCommit, onExit }) {
  const editor = useEditor({
    extensions: buildCardExtensions(),
    content: node.inkblotTipTap || node.text || '',
    autofocus: 'end',
  })

  // Commit through a ref so the unmount effect below doesn't need onCommit in its
  // deps — re-running it would tear the editor down mid-edit.
  const commitRef = useRef(null)
  commitRef.current = () => {
    if (!isEditorReady(editor)) return
    onCommit({
      // `text` is the JSON Canvas spec field — a plain-text projection other
      // apps can read. `inkblotTipTap` is the lossless version we render from.
      text: editor.getText(),
      inkblotTipTap: editor.getJSON(),
    })
  }

  useEffect(() => {
    if (!isEditorReady(editor)) return

    editor.__inkblotCanvasCard = true
    setActiveEditor?.(editor)

    return () => {
      // Save whatever was typed before the instance is destroyed.
      commitRef.current?.()
      // Never leave the Toolbar holding a destroyed editor.
      setActiveEditor?.((current) => (current === editor ? null : current))
    }
  }, [editor, setActiveEditor])

  return (
    <div
      className="canvas-card-body canvas-card-editing"
      // The surface would otherwise read a click here as "start a marquee" and a
      // drag as "move the card" — while the user is selecting text.
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onExit()
        }
      }}
    >
      <EditorContent editor={editor} />
    </div>
  )
}
