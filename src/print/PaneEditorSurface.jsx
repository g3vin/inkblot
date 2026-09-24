/**
 * PaneEditorSurface.jsx — a text pane's scroll area: the continuous editor, or the
 * same editor as pages.
 *
 * EditorCanvas renders one of these per text pane. Which view it shows is the
 * document's own view state (printLayoutStore), so each pane — and each document in
 * it — remembers whether it was being read as pages. The <EditorContent> is mounted
 * in both cases, and in the same place in the tree relative to the editor, so
 * switching views never recreates the editor: selection, undo history and every
 * node view survive the switch.
 */
import { useCallback, useState } from 'react'
import { EditorContent } from '@tiptap/react'

import PrintLayoutView from './PrintLayoutView'
import { useDocPageSetup } from './useDocPageSetup'
import { getPrintZoom, isPrintLayoutEnabled, setPrintZoom, usePrintLayoutStore } from './printLayoutStore'

const baseName = (path) => (path || '').split('/').filter(Boolean).pop() || ''

export default function PaneEditorSurface({ editor, projectName, docPath, header = null, scrollRef }) {
  usePrintLayoutStore()
  const [scrollEl, setScrollEl] = useState(null)
  const pageSetup = useDocPageSetup(editor)
  const printLayout = Boolean(editor) && isPrintLayoutEnabled(projectName, docPath)
  const zoom = getPrintZoom()

  const setScroll = useCallback((el) => {
    setScrollEl(el)
    if (typeof scrollRef === 'function') scrollRef(el)
    else if (scrollRef) scrollRef.current = el
  }, [scrollRef])

  const content = editor ? <EditorContent editor={editor} className="editor" /> : null

  return (
    <div ref={setScroll} className={`pane-scroll${printLayout ? ' is-print-layout' : ''}`} tabIndex={printLayout ? -1 : undefined}>
      {header}
      {printLayout ? (
        <PrintLayoutView
          editor={editor}
          pageSetup={pageSetup}
          zoom={zoom}
          onZoomChange={setPrintZoom}
          docTitle={baseName(docPath)}
          scrollEl={scrollEl}
          // The pane, not the scroller: the zoom bar stays put while the pages scroll.
          statusHost={scrollEl?.parentElement || null}
        >
          {content}
        </PrintLayoutView>
      ) : content}
    </div>
  )
}
