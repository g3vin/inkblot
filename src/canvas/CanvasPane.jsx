/**
 * CanvasPane.jsx — the canvas document shown in one editor pane.
 *
 * Loads the document and owns the pane chrome; CanvasSurface owns the canvas.
 * The surface is mounted only once loading finishes, and is keyed by doc path,
 * so it can take the loaded state and viewport as initial values — switching
 * documents remounts it with a clean viewport rather than animating from the
 * previous document's pan and zoom.
 *
 * A canvas never touches the TipTap editors in EditorCanvas, and saveDocument()
 * refuses to write one (see FileSystem.js) — all persistence goes through
 * canvasFileSystem.js.
 */
import { useEffect, useState } from 'react'
import { loadCanvasDocument } from '../lib/canvasFileSystem'
import { getDocDisplayName } from '../lib/docKind'
import { CanvasNotesProvider } from './CanvasNotesContext'
import CanvasSurface from './CanvasSurface'
import './Canvas.css'

export default function CanvasPane({
  projectName,
  docPath,
  onActivate,
  onOpenDoc,
  showHeader = false,
  onClose,
  setActiveEditor,
  notesByDoc,
  setNotesForDoc,
  openDocs,
  isActive = true,
}) {
  const [doc, setDoc] = useState(null)

  useEffect(() => {
    if (!projectName || !docPath) return
    let cancelled = false

    setDoc(null)
    loadCanvasDocument(projectName, docPath).then((loaded) => {
      if (!cancelled) setDoc(loaded)
    })

    return () => {
      cancelled = true
    }
  }, [docPath, projectName])

  return (
    <div className="canvas-pane">
      {showHeader ? (
        <div className="pane-header pane-header-centered">
          <span>{getDocDisplayName(docPath)}</span>
          <button onClick={onClose}>×</button>
        </div>
      ) : null}

      {doc ? (
        // Note cards reach the app's notes through context, not props: CanvasNode is
        // memoized on its node, and threading notesByDoc through it would re-render
        // every card on every keystroke in any note.
        <CanvasNotesProvider
          projectName={projectName}
          notesByDoc={notesByDoc}
          setNotesForDoc={setNotesForDoc}
          openDocs={openDocs}
        >
          <CanvasSurface
            key={docPath}
            projectName={projectName}
            docPath={docPath}
            initialState={doc.state}
            initialViewport={doc.viewport}
            onActivate={onActivate}
            onOpenDoc={onOpenDoc}
            setActiveEditor={setActiveEditor}
            isActive={isActive}
          />
        </CanvasNotesProvider>
      ) : (
        <div className="canvas-surface" />
      )}
    </div>
  )
}
