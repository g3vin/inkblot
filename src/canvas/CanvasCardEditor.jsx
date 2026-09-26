/**
 * CanvasCardEditor.jsx — the live TipTap editor for the one card being edited.
 *
 * At most one of these exists at a time (CanvasSurface holds a single
 * `editingNodeId`), so a canvas with 200 cards still only ever pays for one
 * ProseMirror instance. Every other card is static HTML.
 *
 * This is the third state of the active-editor election (see bridge/editorRegistry).
 * The card registers itself as `EditorTarget.CanvasCard` and wins the election while
 * it is open; the pane's own two TipTap instances are idle and hold no document, so a
 * toolbar pointed at `Primary` would be driving nothing. When the card closes it
 * withdraws, the registry resolves `CanvasCard` to no editor, and the toolbar goes
 * quiet.
 */
import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { EditorTarget } from '../types'
import { editorRegistry, useRegisterEditor } from '../bridge'
import { canvasSurfaceIdOf } from './canvasEvents'
import { buildCardExtensions } from '../lib/editorExtensions'
import { isEditorReady } from '../lib/editorUtils'

export default function CanvasCardEditor({ node, setActiveEditor, onCommit, onExit, docPath = null }) {
  const containerRef = useRef(null)
  // Built once: new extension instances each render made useEditor call setOptions
  // on every render. The card's content is read at creation only, as before.
  const [options] = useState(() => ({
    extensions: buildCardExtensions(),
    content: node.inkblotTipTap || node.text || '',
    autofocus: 'end',
  }))
  const editor = useEditor(options)

  // Commit through a ref so the unmount effect below doesn't need onCommit in its
  // deps — re-running it would tear the editor down mid-edit.
  //
  // Refreshed in an effect rather than during render: writing a ref while rendering
  // is what the React Compiler forbids. No dependency array, so every render leaves the ref holding a commit
  // that closes over the current `editor` and `onCommit`; the unmount cleanup below
  // then calls whatever the last render left.
  const commitRef = useRef(null)
  useEffect(() => {
    commitRef.current = () => {
      if (!isEditorReady(editor)) return
      onCommit({
        // `text` is the JSON Canvas spec field — a plain-text projection other
        // apps can read. `inkblotTipTap` is the lossless version we render from.
        text: editor.getText(),
        inkblotTipTap: editor.getJSON(),
      })
    }
  })

  // Which canvas this card is on, read off the DOM rather than threaded down as a
  // prop: the id is on the surface element, and the card is inside it. An accessor,
  // so it is resolved when the registry asks rather than during the render that
  // happens before this element is attached.
  useRegisterEditor(EditorTarget.CanvasCard, {
    getEditor: () => editor,
    getDocPath: () => docPath,
    getSurfaceId: () => canvasSurfaceIdOf(containerRef.current),
  })

  useEffect(() => {
    if (!isEditorReady(editor)) return

    setActiveEditor?.(editor)
    editorRegistry.setActive(EditorTarget.CanvasCard)

    return () => {
      // Save whatever was typed before the instance is destroyed.
      commitRef.current?.()
      // Never leave the Toolbar holding a destroyed editor.
      setActiveEditor?.((current) => (current === editor ? null : current))
      // The registration is withdrawn by useRegisterEditor's own cleanup; clearing the
      // election as well is what stops the registry naming a winner that is gone.
      if (editorRegistry.activeTarget() === EditorTarget.CanvasCard) {
        editorRegistry.setActive(null)
      }
    }
  }, [editor, setActiveEditor])

  return (
    <div
      ref={containerRef}
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
