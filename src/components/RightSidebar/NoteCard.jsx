/**
 * NoteCard.jsx — a single note in the NotesPanel tree.
 *
 * Shows the quote anchor (for anchored notes), an auto-resizing textarea for
 * the note body, attached images, and per-note actions. Pasting images into the
 * textarea attaches them.
 *
 * Its tools sit where a hover note's do (NoteHoverPreview), so a hand that knows one
 * knows the other: the colour dot top left and delete top right; memo and image
 * bottom left, a connected note in the middle, the branch's collapse bottom right.
 * The panel adds the time and the pin before delete.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import Icon from '../../ui/Icon.jsx'
import NoteImageGallery from '../NoteImageGallery'
import { AudioClipList, AudioRecordButton } from '../AudioNotes'
import { pickNoteImages, readClipboardImages } from '../../lib/noteImageUtils'
import { NOTE_COLOR_OPTIONS, isNoteEmpty, noteColor, noteInk } from '../../lib/noteUtils'
import InkWheel from '../../ui/InkWheel.jsx'

const NOTE_COLOR_TRIGGER = { className: 'note-tool-btn', children: <span className="note-color-dot" aria-hidden="true" /> }

export default function NoteCard({
  note,
  onJump,
  onRemove,
  onChange,
  onTogglePin,
  onToggleCollapse,
  onAddChild,
  onChangeColor,
  onStopEditing,
  onAddImages,
  onRemoveImage,
  onChangeAudio,
  projectName,
  hasChildren = false,
  // Opening or closing with its branch (NotesPanel): { state, card: { delay, ms } }.
  motion = null,
}) {
  const textareaRef = useRef(null)
  const [editing, setEditing] = useState(false)

  // Grow the textarea to fit its content; when not editing, cap at the CSS max-height.
  const resizeTextarea = useCallback(() => {
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
  }, [editing])

  useEffect(() => {
    resizeTextarea()
  }, [note.content, note.images, editing, resizeTextarea])

  const handlePaste = useCallback(async (event) => {
    const images = await readClipboardImages(event.clipboardData)
    if (images.length === 0) return

    event.preventDefault()
    event.stopPropagation()
    onAddImages?.(images)
  }, [onAddImages])

  return (
    <div
      id={`note-${note.id}`}
      className={`note-tile${note.pinned ? ' pinned' : ''}${motion?.state ? ` is-${motion.state}` : ''}`}
      style={{
        '--note-color': noteColor(note.color),
        ...(motion?.card ? { '--card-delay': `${motion.card.delay}ms`, '--card-ms': `${motion.card.ms}ms` } : null),
      }}
      onClick={note.type === 'quote' ? onJump : undefined}
    >
      <div className="note-tile-header">
        <InkWheel
          label="Note colour"
          value={noteInk(note)}
          inks={NOTE_COLOR_OPTIONS}
          onChange={(ink) => onChangeColor?.(ink)}
          as="button"
          triggerProps={NOTE_COLOR_TRIGGER}
        />

        <div className="note-tile-header-end">
          <div className="note-timestamp ib-meta">
            {note.timestamp}
          </div>

          <button
            type="button"
            className={`note-tool-btn${note.pinned ? ' active' : ''}`}
            onClick={(event) => {
              event.stopPropagation()
              onTogglePin?.()
            }}
            aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
            title={note.pinned ? 'Unpin note' : 'Pin note'}
          >
            <Icon name="pin" active={note.pinned} />
          </button>

          <button
            type="button"
            className="note-tool-btn"
            onClick={async (event) => {
              event.stopPropagation()
              const ok = isNoteEmpty(note) || await confirm('Delete note?')
              if (ok) onRemove()
            }}
            aria-label="Delete note"
            title="Delete note"
          >
            <Icon name="delete" />
          </button>
        </div>
      </div>

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
        onClick={event => event.stopPropagation()}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false)
          onStopEditing?.()
        }}
        onPaste={handlePaste}
        onChange={event => onChange(event.target.value)}
      />

      <NoteImageGallery
        images={note.images}
        onRemoveImage={onRemoveImage}
      />

      {/* The clips stay visible whether or not the note is being edited — a memo has
          to be playable without first clicking into the note to edit it. Only the
          controls that CREATE something are tucked away in the footer. */}
      <AudioClipList
        audio={note.audio}
        projectName={projectName}
        onChange={onChangeAudio}
      />

      <div className="note-tile-footer">
        {/* Keeps the focus where it is: clicking one of these while writing must not
            blur the note out from under the click. */}
        <div className="note-tile-footer-start" onMouseDown={(event) => event.preventDefault()}>
          <AudioRecordButton
            audio={note.audio}
            projectName={projectName}
            onChange={onChangeAudio}
            iconOnly
          />
          <button
            type="button"
            className="note-tool-btn"
            onClick={async (event) => {
              event.stopPropagation()
              const images = await pickNoteImages()
              if (images.length) onAddImages?.(images)
            }}
            aria-label="Add image"
            title="Add image"
          >
            <Icon name="image" />
          </button>
        </div>

        <button
          type="button"
          className="note-tool-btn"
          onClick={(event) => {
            event.stopPropagation()
            onAddChild?.()
          }}
          aria-label={hasChildren ? 'Add another connected note' : 'Add connected note'}
          title={hasChildren ? 'Add another connected note' : 'Add connected note'}
        >
          <Icon name={hasChildren ? 'branch' : 'add'} />
        </button>

        <div className="note-tile-footer-end">
          {hasChildren ? (
            <button
              type="button"
              className={`note-tool-btn${note.collapsedChildren ? ' active' : ''}`}
              onClick={(event) => {
                event.stopPropagation()
                onToggleCollapse?.()
              }}
              aria-label={note.collapsedChildren ? 'Expand branch' : 'Collapse branch'}
              title={note.collapsedChildren ? 'Expand branch' : 'Collapse branch'}
            >
              <Icon name={note.collapsedChildren ? 'chevron-right' : 'chevron-down'} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
