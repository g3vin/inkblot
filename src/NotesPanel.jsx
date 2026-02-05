import NoteCard from './RightSidebar/NoteCard'

export default function NotesPanel({ notes, setNotes, jumpToText }) {
  return (
    <>
      <div className="panel-header">
        <span>NOTES</span>
        {notes.length > 0 && (
          <button className="clear-btn" onClick={() => setNotes([])}>
            Clear All
          </button>
        )}
      </div>

      {notes.map(note => (
        <NoteCard
          key={note.id}
          note={note}
          onJump={() => jumpToText(note.anchor)}
          onRemove={() =>
            setNotes(p => p.filter(n => n.id !== note.id))
          }
          onChange={content =>
            setNotes(p =>
              p.map(n =>
                n.id === note.id ? { ...n, content } : n
              )
            )
          }
        />
      ))}
    </>
  )
}