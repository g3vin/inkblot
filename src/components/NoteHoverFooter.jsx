/**
 * NoteHoverFooter.jsx — the lower half of a hover note's card (NoteHoverPreview): its
 * voice memos and characters, then the tools along the bottom edge, placed where the
 * notes panel's card has them (NoteCard): memo, image and characters bottom left, a
 * connected note in the middle, the branch's collapse bottom right.
 */
import Icon from '../ui/Icon.jsx'
import { AudioClipList, AudioRecordButton } from './AudioNotes'
import { pickNoteImages } from '../lib/noteImageUtils'
import { NoteCharacterButton, NoteCharacterChips } from './NoteCharacters'

export default function NoteHoverFooter({
  note,
  projectName,
  childCount,
  lockPreview,
  onChangeAudio,
  onAddImages,
  onChangeCharacters,
  onAddChild,
  onToggleCollapse,
}) {
  return (
    <>
      {/* Voice memos are stored on the note, so one recorded here is the same
          memo the notes panel and any canvas card show. */}
      <AudioClipList audio={note.audio} projectName={projectName} onChange={onChangeAudio} />

      <NoteCharacterChips characters={note.characters} />

      <div className="note-preview-footer">
        <div className="note-preview-footer-start">
          <AudioRecordButton
            audio={note.audio}
            projectName={projectName}
            onChange={onChangeAudio}
            iconOnly
          />
          <button
            type="button"
            className="note-tool-btn note-preview-tool"
            onClick={async (event) => {
              event.stopPropagation()
              lockPreview()
              const images = await pickNoteImages()
              if (images.length) onAddImages(images)
            }}
            aria-label="Add image"
            title="Add image"
          >
            <Icon name="image" />
          </button>
          <NoteCharacterButton
            className="note-tool-btn note-preview-tool"
            characters={note.characters}
            onOpen={lockPreview}
            onChange={onChangeCharacters}
          />
        </div>

        <button
          type="button"
          className="note-tool-btn note-preview-tool"
          onClick={(event) => {
            event.stopPropagation()
            onAddChild()
          }}
          aria-label={childCount > 0 ? 'Add another connected note' : 'Add connected note'}
          title={childCount > 0 ? 'Add another connected note' : 'Add connected note'}
        >
          <Icon name={childCount > 0 ? 'branch' : 'add'} />
        </button>

        <div className="note-preview-footer-end">
          {childCount > 0 ? (
            <button
              type="button"
              className={`note-tool-btn note-preview-tool${note.collapsedChildren ? ' active' : ''}`}
              onClick={(event) => {
                event.stopPropagation()
                onToggleCollapse()
              }}
              aria-label={note.collapsedChildren ? 'Expand branch' : 'Collapse branch'}
              title={note.collapsedChildren ? 'Expand branch' : 'Collapse branch'}
            >
              <Icon name={note.collapsedChildren ? 'chevron-right' : 'chevron-down'} />
            </button>
          ) : null}
        </div>
      </div>
    </>
  )
}
