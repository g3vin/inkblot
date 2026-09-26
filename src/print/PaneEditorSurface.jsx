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
import { useCallback, useMemo, useState } from 'react'
import { EditorContent } from '@tiptap/react'

import PrintLayoutView from './PrintLayoutView'
import { useDocPageSetup } from './useDocPageSetup'
import { bookAuthor, getBookForDoc, getPrintZoom, isPrintLayoutEnabled, setPrintZoom, usePrintLayoutStore } from './printLayoutStore'
import { resolvePageSetup } from './pageSetup'

/**
 * The book's setup, when the document has none of its own to show instead — as JSON,
 * because the store parses a fresh object on every read and a memo keyed on that
 * would lay the pages out again on every render.
 */
const bookSetupJson = (projectName, docPath, ownSetup) => {
  if (ownSetup || !projectName || !docPath) return ''
  const setup = getBookForDoc(projectName, docPath).pageSetup
  return setup ? JSON.stringify(setup) : ''
}

const baseName = (path) => (path || '').split('/').filter(Boolean).pop() || ''

export default function PaneEditorSurface({ editor, projectName, docPath, header = null, scrollRef }) {
  usePrintLayoutStore()
  const [scrollEl, setScrollEl] = useState(null)
  const ownSetup = useDocPageSetup(editor)
  // A chapter with no setup of its own shows its book's, as the book will print it.
  const bookJson = bookSetupJson(projectName, docPath, ownSetup)
  const pageSetup = useMemo(
    () => resolvePageSetup({ docSetup: ownSetup, bookSetup: bookJson ? JSON.parse(bookJson) : null }).setup,
    [ownSetup, bookJson]
  )
  const printLayout = Boolean(editor) && isPrintLayoutEnabled(projectName, docPath)
  const zoom = getPrintZoom(projectName, docPath)
  const onZoomChange = useCallback((z) => setPrintZoom(z, projectName, docPath), [projectName, docPath])
  const author = projectName && docPath ? bookAuthor(getBookForDoc(projectName, docPath)) : ''

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
          docPath={docPath}
          zoom={zoom}
          onZoomChange={onZoomChange}
          docTitle={baseName(docPath)}
          author={author}
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
