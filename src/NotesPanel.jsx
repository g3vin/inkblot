import { useCallback, useMemo, useState } from 'react'
import NoteCard from './RightSidebar/NoteCard'

export default function NotesPanel({
  notes = [],
  setNotes,
  jumpToText,
}) {
  const [query, setQuery] = useState('')
  /* ----------------------------- */
  /* Helpers                       */
  /* ----------------------------- */

  const createNote = () => ({
    id: crypto.randomUUID(),
    type: 'free',
    content: '',
    timestamp: new Date().toLocaleTimeString(),
  })

  /* ----------------------------- */
  /* Actions                       */
  /* ----------------------------- */

  const handleAddNote = useCallback(() => {
    setNotes(prev => [createNote(), ...prev])
  }, [setNotes])

  const handleClearAll = useCallback(() => {
    setNotes([])
  }, [setNotes])

  const handleRemove = useCallback(
    (id) => {
      setNotes(prev => prev.filter(note => note.id !== id))
    },
    [setNotes]
  )

  const handleChange = useCallback(
    (id, content) => {
      setNotes(prev =>
        prev.map(note =>
          note.id === id ? { ...note, content } : note
        )
      )
    },
    [setNotes]
  )

  const handleJump = useCallback(
    (note) => {
      jumpToText?.(note)
    },
    [jumpToText]
  )

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return notes
    return notes.filter(note => {
      const anchor = (note.anchor || '').toLowerCase()
      const content = (note.content || '').toLowerCase()
      return anchor.includes(q) || content.includes(q)
    })
  }, [notes, query])

  /* ----------------------------- */
  /* Render                        */
  /* ----------------------------- */

  return (
    <div className="notes-panel">
      {/* Header */}
      <div className="panel-header">
        <span>NOTES</span>

        {notes.length > 0 && (
          <button
            className="clear-btn"
            onClick={handleClearAll}
          >
            Clear All
          </button>
        )}
      </div>

      {/* Add Button */}
      <button
        className="add-note-btn"
        onClick={handleAddNote}
      >
        + Free Note
      </button>

      {/* Search */}
      <input
        className="notes-search"
        type="search"
        placeholder="Search notes..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {/* Notes List */}
      <div className="notes-list">
        {filteredNotes.length === 0 ? (
          <div className="notes-empty">
            {notes.length === 0 ? 'No notes yet.' : 'No matching notes.'}
          </div>
        ) : (
          filteredNotes.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              onJump={() => handleJump(note)}
              onRemove={() => handleRemove(note.id)}
              onChange={(content) =>
                handleChange(note.id, content)
              }
            />
          ))
        )}
      </div>
    </div>
  )
}