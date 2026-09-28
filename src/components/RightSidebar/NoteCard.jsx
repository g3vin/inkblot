/**
 * NoteCard.jsx — a single note in the NotesPanel tree.
 *
 * Shows the quote anchor (for anchored notes), an auto-resizing textarea for
 * the note body, attached images, and per-note actions (collapse branch,
 * recolor, pin, delete). Pasting images into the textarea attaches them.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import SFIcon from '../SFIcon'
import NoteImageGallery from '../NoteImageGallery'
import { AudioClipList, AudioRecordButton } from '../AudioNotes'
import { pickNoteImages, readClipboardImages } from '../../lib/noteImageUtils'
import { noteColor } from '../../lib/noteUtils'

export default function NoteCard({
  note,
  onJump,
  onRemove,
  onChange,
  onTogglePin,
  onToggleCollapse,
  onOpenColorPicker,
  onStopEditing,
  onAddImages,
  onRemoveImage,
  onChangeAudio,
  projectName,
  hasChildren = false,
  depth = 0,
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
      className={`note-tile${note.pinned ? ' pinned' : ''}`}
      style={{
        '--note-color': noteColor(note.color),
        marginLeft: `${depth * 18}px`,
      }}
      onClick={note.type === 'quote' ? onJump : undefined}
    >
      <div className="note-actions">
        {hasChildren ? (
          <button
            className={`note-tool-btn${note.collapsedChildren ? ' active' : ''}`}
            onClick={(event) => {
              event.stopPropagation()
              onToggleCollapse?.()
            }}
            aria-label={note.collapsedChildren ? 'Expand branch' : 'Collapse branch'}
            title={note.collapsedChildren ? 'Expand branch' : 'Collapse branch'}
          >
            <SFIcon name="arrow.up.from.dot" />
          </button>
        ) : null}

        <button
          className="note-tool-btn"
          onClick={(event) => {
            event.stopPropagation()
            onOpenColorPicker?.(event)
          }}
          aria-label="Change note color"
          title="Change note color"
        >
          <SFIcon name="paintpalette" />
        </button>

        <button
          className={`note-tool-btn${note.pinned ? ' active' : ''}`}
          onClick={(event) => {
            event.stopPropagation()
            onTogglePin?.()
          }}
          aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
          title={note.pinned ? 'Unpin note' : 'Pin note'}
        >
          <SFIcon name="pin" filled={note.pinned} />
        </button>

        <button
          className="note-delete"
          onClick={async event => {
            event.stopPropagation()
            const ok = await confirm('Delete note?')
            if (ok) onRemove()
          }}
          aria-label="Delete note"
          title="Delete note"
        >
          <SFIcon name="xmark" />
        </button>
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

      <div className="note-footer">
        <div className="note-color-chip" />

        {/*
          Attach controls live between the colour chip and the timestamp, and only
          while the note is being edited: a wall of buttons on every note in a long
          list is noise, and these are only useful once you are actually writing.

          `editing` is cleared by the textarea's blur — so the controls must keep the
          focus, or clicking one would dismiss the very row it lives in before the
          click landed. onMouseDown/preventDefault is what stops that.
        */}
        {editing ? (
          <div
            className="note-attach-actions"
            onMouseDown={(event) => event.preventDefault()}
          >
            <AudioRecordButton
              audio={note.audio}
              projectName={projectName}
              onChange={onChangeAudio}
              iconOnly
            />

            <button
              type="button"
              className="note-attach-btn"
              onClick={async (event) => {
                event.stopPropagation()
                const images = await pickNoteImages()
                if (images.length) onAddImages?.(images)
              }}
              aria-label="Add image"
              title="Add image"
            >
              <SFIcon name="photo" size={12} />
            </button>
          </div>
        ) : null}

        <div className="note-timestamp">
          {note.timestamp}
        </div>
      </div>
    </div>
  )
}
