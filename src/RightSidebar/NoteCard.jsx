import { useEffect, useRef, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'

export default function NoteCard({
  note,
  onJump,
  onRemove,
  onChange,
}) {
  const textareaRef = useRef(null)
  const [editing, setEditing] = useState(false)

  const resizeTextarea = () => {
    const el = textareaRef.current
    if (!el) return

    el.style.height = 'auto'

    if (editing) {
      el.style.height = `${el.scrollHeight}px`
      return
    }

    const styles = window.getComputedStyle(el)
    const maxHeightValue = styles.maxHeight
    const maxHeight = maxHeightValue && maxHeightValue !== 'none'
      ? parseFloat(maxHeightValue)
      : Infinity

    const nextHeight = Math.min(el.scrollHeight, maxHeight)
    el.style.height = `${nextHeight}px`
  }

  // Auto-resize on load and whenever content/expand state changes
  useEffect(() => {
    resizeTextarea()
  }, [note.content, editing])

  return (
    <div
      id={`note-${note.id}`}
      className="note-tile"
      onClick={note.type === 'quote' ? onJump : undefined}
    >
      <button
        className="note-delete"
        onClick={async e => {
          e.stopPropagation()
          const ok = await confirm('Delete note?')
          if (ok) onRemove()
        }}
      >
        ×
      </button>

      {note.type === 'quote' && (
        <div className="note-anchor-label">
          "{note.anchor}"
        </div>
      )}


      <textarea
        ref={textareaRef}
        className={`note-textarea ${editing ? 'expanded' : ''}`}
        value={note.content}
        placeholder="Type your note here..."
        rows={1}
        onClick={e => e.stopPropagation()}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        onChange={e => onChange(e.target.value)}
      />

      <div className="note-timestamp">
        {note.timestamp}
      </div>
    </div>
  )
}