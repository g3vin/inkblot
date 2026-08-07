import { useCallback, useEffect, useRef, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import SFIcon from '../SFIcon'
import NoteImageGallery from '../NoteImageGallery'
import { readClipboardImages } from '../noteImageUtils'

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
  hasChildren = false,
  depth = 0,
}) {
  const textareaRef = useRef(null)
  const [editing, setEditing] = useState(false)

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
        '--note-color': note.color || '#007aff',
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

      <div className="note-footer">
        <div className="note-color-chip" />
        <div className="note-timestamp">
          {note.timestamp}
        </div>
      </div>
    </div>
  )
}
