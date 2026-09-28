/**
 * BubbleTopControls — the bar at the top: how the text is split (Sentences, Clauses,
 * Words) and Archive; and, in its own green circle beside it, Done.
 */
import { BubbleMode } from '../../types'
import Segmented from '../../ui/Segmented'
import { ArchiveIcon } from '../RightSidebar/ArchivePanel'

/** Sentences first: the widest grouping, for reordering a paragraph. */
const MODES = [
  { value: BubbleMode.Sentences, label: 'Sentences' },
  { value: BubbleMode.Clauses, label: 'Clauses' },
  { value: BubbleMode.Words, label: 'Words' },
]

export default function BubbleTopControls({ mode, onMode, onArchive, onDone }) {
  return (
    <div className="bubble-editor-top" onPointerDown={(event) => event.stopPropagation()}>
      <header className="bubble-editor-bar floating-capsule">
        <Segmented value={mode} onChange={onMode} options={MODES} label="Split into" className="bubble-modes" />
        <button
          type="button"
          className="bubble-editor-button is-icon"
          onClick={onArchive}
          title="Write the sentence into the document and archive this session — it can be restored from History ▸ Archive"
          aria-label="Archive"
        >
          <ArchiveIcon size={15} />
        </button>
      </header>
      <button
        type="button"
        className="bubble-editor-done"
        onClick={onDone}
        title="Done — write the sentence into the document and keep this session (⌘↩)"
        aria-label="Done"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}
