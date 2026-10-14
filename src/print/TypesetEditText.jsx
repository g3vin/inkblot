/**
 * TypesetEditText.jsx — the round trip from Typeset to Write and back, for a text fix.
 *
 * A chapter's prose is locked in Typeset (TypesetLock.ts). Double-clicking it offers
 * "Edit Text": that switches the window to Write with the caret where the click was,
 * and the pane shows "Back to Typeset" until the writer takes it — which returns to
 * Typeset, on the page the caret is on now. Mounted by PaneEditorSurface, one per pane.
 */
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { TYPESET_EDIT_TEXT_EVENT } from './TypesetLock'
import { getTypesetReturn, setEditorMode, setTypesetReturn } from './printLayoutStore'

/** Put the caret at `pos` and bring it into view, once the pane has re-rendered. */
const placeCaret = (editor, pos) => {
  setTimeout(() => {
    if (!editor || editor.isDestroyed) return
    const size = editor.state.doc.content.size
    const at = Math.max(0, Math.min(size, pos ?? 0))
    editor.chain().setTextSelection(at).scrollIntoView().focus().run()
  }, 60)
}

export default function TypesetEditText({ editor, projectName, docPath, typesetting }) {
  const [offer, setOffer] = useState(null)

  useEffect(() => {
    if (!editor || !typesetting) return undefined
    const onEditText = (event) => {
      if (event.detail?.view !== editor.view) return
      setOffer({ pos: event.detail.pos, x: event.detail.x, y: event.detail.y })
    }
    window.addEventListener(TYPESET_EDIT_TEXT_EVENT, onEditText)
    return () => window.removeEventListener(TYPESET_EDIT_TEXT_EVENT, onEditText)
  }, [editor, typesetting])

  // The offer goes when anything else is done: a key, a click elsewhere, a scroll.
  useEffect(() => {
    if (!offer) return undefined
    const dismiss = (event) => {
      if (event.target?.closest?.('.typeset-edit-text')) return
      setOffer(null)
    }
    window.addEventListener('keydown', dismiss, true)
    window.addEventListener('mousedown', dismiss, true)
    window.addEventListener('wheel', dismiss, { capture: true, passive: true })
    return () => {
      window.removeEventListener('keydown', dismiss, true)
      window.removeEventListener('mousedown', dismiss, true)
      window.removeEventListener('wheel', dismiss, true)
    }
  }, [offer])

  useEffect(() => {
    if (!typesetting) setOffer(null)
  }, [typesetting])

  const editText = useCallback(() => {
    if (!offer) return
    setOffer(null)
    setTypesetReturn({ docPath, pos: offer.pos })
    setEditorMode(projectName, 'write')
    placeCaret(editor, offer.pos)
  }, [docPath, editor, offer, projectName])

  const back = useCallback(() => {
    const pos = editor && !editor.isDestroyed ? editor.state.selection.from : getTypesetReturn()?.pos
    setTypesetReturn(null)
    setEditorMode(projectName, 'typeset')
    placeCaret(editor, pos)
  }, [editor, projectName])

  // In Write — continuous or on its pages — until the writer goes back.
  const returning = !typesetting && getTypesetReturn()?.docPath === docPath

  return (
    <>
      {returning ? (
        <div className="typeset-return">
          <button type="button" className="typeset-return-pill" onClick={back}>
            Back to Typeset
          </button>
        </div>
      ) : null}
      {offer ? createPortal(
        <div className="typeset-edit-text" style={{ left: `${offer.x}px`, top: `${offer.y + 14}px` }} role="dialog">
          <button type="button" onClick={editText}>Edit text</button>
          <span>The prose is edited in Write mode.</span>
        </div>,
        document.body
      ) : null}
    </>
  )
}
