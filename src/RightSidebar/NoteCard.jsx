import { useEffect, useRef, useState } from 'react'

export default function NoteCard({
  note,
  onJump,
  onRemove,
  onChange,
}) {
  const textareaRef = useRef(null)
  const [editing, setEditing] = useState(false)

  // Auto-resize while editing
  useEffect(() => {
    if (!editing || !textareaRef.current) return

    const el = textareaRef.current
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [note.content, editing])

  return (
    <div
      id={`note-${note.id}`}
      className="note-tile"
      onClick={onJump}
    >
      <button
        className="note-delete"
        onClick={e => {
          e.stopPropagation()
          onRemove()
        }}
      >
        ×
      </button>

      <div className="note-anchor-label">
        "{note.anchor}"
      </div>

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