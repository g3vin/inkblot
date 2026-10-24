/**
 * BubbleTopControls — the bubble editor's bar, in the card's toolbar while it is open:
 * how the text is split (Sentences, Clauses, Words), Archive, and Done.
 */
import { BubbleMode } from '../../types'
import { Button, Icon, IconButton, Segmented } from '../../ui'

/** Sentences first: the widest grouping, for reordering a paragraph. */
const MODES = [
  { value: BubbleMode.Sentences, label: 'Sentences' },
  { value: BubbleMode.Clauses, label: 'Clauses' },
  { value: BubbleMode.Words, label: 'Words' },
]

export default function BubbleTopControls({ mode, onMode, onArchive, onDone }) {
  return (
    <div className="bubble-editor-top" role="toolbar" aria-label="Bubble" onPointerDown={(event) => event.stopPropagation()}>
      <Segmented value={mode} onChange={onMode} options={MODES} label="Split into" className="bubble-modes" />
      <IconButton
        icon="archive"
        label="Archive"
        title="Write the sentence into the document and archive this session — it can be restored from History ▸ Archive"
        onClick={onArchive}
      />
      <Button
        variant="filled"
        size="toolbar"
        className="bubble-editor-done"
        onClick={onDone}
        title="Write the sentence into the document and keep this session (⌘↩)"
      >
        <Icon name="check" size={16} />
        Done
      </Button>
    </div>
  )
}
