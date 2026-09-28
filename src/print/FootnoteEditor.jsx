/**
 * FootnoteEditor.jsx — a note, opened to be written: a small field by its mark.
 *
 * Opened by clicking a note's mark, or by putting one in (⌥⌘F, Insert ▸ Footnote).
 * What is typed is the note's text; ⌘↩ or clicking away keeps it, Esc leaves it as it
 * was, and a note left empty when it was new goes. In Typeset a chapter's notes are
 * its text, and are written in Write: there the note is shown, not edited.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { FOOTNOTE_EDIT_EVENT } from './Footnote'

export default function FootnoteEditor({ editor, locked = false }) {
  const [open, setOpen] = useState(null)
  const fieldRef = useRef(null)

  useEffect(() => {
    if (!editor) return undefined
    const onEdit = (event) => {
      const { view, pos, rect } = event.detail || {}
      if (view !== editor.view) return
      const node = editor.state.doc.nodeAt(pos)
      if (!node || node.type.name !== 'footnote') return
      setOpen({ pos, id: node.attrs.id, text: node.attrs.text || '', fresh: !node.attrs.text, x: rect?.left ?? 100, y: rect?.bottom ?? 100 })
    }
    window.addEventListener(FOOTNOTE_EDIT_EVENT, onEdit)
    return () => window.removeEventListener(FOOTNOTE_EDIT_EVENT, onEdit)
  }, [editor])

  useEffect(() => {
    if (open && !locked) fieldRef.current?.focus()
  }, [open, locked])

  /** The note's position now: found again by its id, if the text around it moved. */
  const where = useCallback(() => {
    if (!open || !editor || editor.isDestroyed) return null
    const at = editor.state.doc.nodeAt(open.pos)
    if (at?.type.name === 'footnote' && at.attrs.id === open.id) return open.pos
    let found = null
    editor.state.doc.descendants((node, pos) => {
      if (found != null) return false
      if (node.type.name === 'footnote' && node.attrs.id === open.id) found = pos
      return true
    })
    return found
  }, [editor, open])

  const close = useCallback((keep) => {
    if (!open) return
    const pos = where()
    const text = fieldRef.current?.value ?? open.text
    setOpen(null)
    if (pos == null || locked) return
    if (keep && text !== open.text) editor.commands.setFootnoteText(pos, text.trim())
    else if (!keep && open.fresh) editor.chain().deleteRange({ from: pos, to: pos + 1 }).run()
    // A new note left empty is no note.
    if (keep && open.fresh && !text.trim()) editor.chain().deleteRange({ from: pos, to: pos + 1 }).run()
    editor.commands.focus()
  }, [editor, locked, open, where])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => {
      if (event.target?.closest?.('.footnote-editor')) return
      close(true)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [close, open])

  if (!open) return null
  const left = Math.max(12, Math.min(open.x - 20, window.innerWidth - 332))
  const top = Math.min(open.y + 8, window.innerHeight - 180)
  return createPortal(
    <div className="footnote-editor" style={{ left: `${left}px`, top: `${top}px` }} role="dialog" aria-label="Footnote">
      {locked ? (
        <>
          <p className="footnote-editor-text">{open.text || 'An empty note.'}</p>
          <span className="footnote-editor-hint">Notes are written in Write mode.</span>
        </>
      ) : (
        <>
          <textarea
            ref={fieldRef}
            defaultValue={open.text}
            placeholder="The note"
            rows={3}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { event.preventDefault(); close(false) }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); close(true) }
            }}
          />
          <div className="footnote-editor-actions">
            <button
              type="button"
              className="is-destructive"
              onClick={() => {
                const pos = where()
                setOpen(null)
                if (pos != null) editor.chain().deleteRange({ from: pos, to: pos + 1 }).focus().run()
              }}
            >
              Delete Note
            </button>
            <button type="button" onClick={() => close(true)}>Done</button>
          </div>
        </>
      )}
    </div>,
    document.body
  )
}
