/**
 * FootnoteEditor.jsx — a note, opened to be written: a small field by its mark.
 *
 * Opened by clicking a note's mark, or by putting one in (⌥⌘F, Insert ▸ Footnote).
 * What is typed is the note's text; ⌘↩ or clicking away keeps it, Esc leaves it as it
 * was, and a note left empty when it was new goes. In Typeset a chapter's notes are
 * its text, and are written in Write: there the note is shown, not edited.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import Button from '../ui/Button.jsx'
import { TextArea } from '../ui/Field.jsx'
import Kbd from '../ui/Kbd.jsx'
import Popover from '../ui/Popover.jsx'
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

  if (!open) return null
  const remove = () => {
    const pos = where()
    setOpen(null)
    if (pos != null) editor.chain().deleteRange({ from: pos, to: pos + 1 }).focus().run()
  }
  // The mark is a place in the text, not a control: the pop-up opens under its rect.
  const at = { left: open.x, right: open.x, width: 0, top: open.y, bottom: open.y, height: 0 }
  return (
    <Popover open anchorRect={at} onClose={() => close(true)} onEscape={() => close(false)} eyebrow="Footnote" className="footnote-editor" role="dialog" aria-label="Footnote">
      {locked ? (
        <>
          <p className="footnote-editor-text">{open.text || 'An empty note.'}</p>
          <p className="ib-hint">Notes are written in Write mode.</p>
        </>
      ) : (
        <>
          <TextArea
            ref={fieldRef}
            defaultValue={open.text}
            placeholder="The note"
            rows={3}
            aria-label="Footnote"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); close(true) }
            }}
          />
          <div className="footnote-editor-actions">
            <Button variant="destructive" onClick={remove}>Delete note</Button>
            <Kbd>⌘↩</Kbd>
            <Button variant="filled" onClick={() => close(true)}>Done</Button>
          </div>
        </>
      )}
    </Popover>
  )
}
