/**
 * NotesPanel.jsx — the Notes tab of the right sidebar.
 *
 * Renders the active document's notes as a nested tree of NoteCards
 * (children via parentNoteId), with search filtering, pin/collapse toggles,
 * per-note color picking, image attachments, and jump-to-anchor.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import NoteCard from './RightSidebar/NoteCard'
import { canvasSurfaceAt, dispatchCanvasDropNote } from '../canvas/canvasEvents'
import {
  collectNoteBranchIds,
  NOTE_COLOR_OPTIONS,
  compareNotes,
  touchNote,
} from '../lib/noteUtils'

const getPopupPosition = (x, y) => ({
  left: Math.max(12, Math.min(x - 92, window.innerWidth - 204)),
  top: Math.max(12, Math.min(y + 12, window.innerHeight - 180)),
})

/**
 * Drag a note onto an open canvas.
 *
 * The canvas card REFERENCES the note in this document rather than copying it, so
 * `docName` (the owning document) travels with the id — without it the canvas would
 * have a note id and nowhere to look it up.
 *
 * Manual pointer drag rather than HTML5 DnD, matching FileTree: the canvas already
 * hit-tests drops with elementFromPoint, and a real dragstart would fight the buttons
 * living inside every note tile.
 *
 * The note's TEXTAREA is a legitimate place to start a drag, and this is the whole
 * reason the first version of this didn't work: `.note-textarea` is width:100% and
 * fills the tile, so nearly every press lands on it. Skipping textareas outright left
 * only a few pixels of margin actually draggable. So a press on the textarea arms a
 * drag too — unless it is already focused, in which case the user is editing and the
 * pointer belongs to their text selection.
 */
function useNoteCanvasDrag(docName, setGhost) {
  const dragRef = useRef(null)

  return useCallback(
    (event, noteId, note) => {
      if (event.button !== 0 || !docName || !noteId) return

      const target = event.target
      if (target instanceof HTMLElement) {
        // Never hijack a press meant for the note's own controls.
        if (target.closest('button, a, input, [contenteditable="true"]')) return
        // Editing the note: the pointer is for selecting text, not for dragging.
        if (target.closest('textarea') && document.activeElement === target) return
      }

      dragRef.current = {
        noteId,
        note,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        dragging: false,
      }

      const onMove = (moveEvent) => {
        const drag = dragRef.current
        if (!drag) return

        if (!drag.dragging) {
          const moved =
            Math.abs(moveEvent.clientX - drag.startX) + Math.abs(moveEvent.clientY - drag.startY)
          if (moved < 4) return
          drag.dragging = true

          // Starting from the textarea would otherwise drag-SELECT its text as the
          // pointer travels. Take the focus and the selection away from it.
          document.activeElement?.blur?.()
          window.getSelection?.()?.removeAllRanges?.()
        }

        drag.x = moveEvent.clientX
        drag.y = moveEvent.clientY
        // A drag with no feedback looks like a drag that isn't working.
        setGhost({
          x: moveEvent.clientX,
          y: moveEvent.clientY,
          note: drag.note,
          overCanvas: !!canvasSurfaceAt(moveEvent.clientX, moveEvent.clientY),
        })
      }

      const onUp = () => {
        window.removeEventListener('pointermove', onMove, true)
        window.removeEventListener('pointerup', onUp, true)
        window.removeEventListener('pointercancel', onUp, true)
        setGhost(null)

        const drag = dragRef.current
        dragRef.current = null
        if (!drag?.dragging) return

        const surface = canvasSurfaceAt(drag.x, drag.y)
        if (!surface) return

        dispatchCanvasDropNote(surface, {
          docPath: docName,
          noteId: drag.noteId,
          clientX: drag.x,
          clientY: drag.y,
        })
      }

      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('pointercancel', onUp, true)
    },
    [docName, setGhost]
  )
}

export default function NotesPanel({
  notes = [],
  setNotes,
  docName,
  projectName,
  query = '',
  jumpToText,
  clearActiveNoteHighlight,
}) {
  const [dragGhost, setDragGhost] = useState(null)
  const startNoteDrag = useNoteCanvasDrag(docName, setDragGhost)
  const [colorPicker, setColorPicker] = useState(null)
  const colorPickerRef = useRef(null)

  const closeMenus = useCallback(() => {
    setColorPicker(null)
  }, [])

  const updateNote = useCallback((id, updater) => {
    setNotes(prev =>
      prev.map(note => {
        if (note.id !== id) return note
        return typeof updater === 'function' ? updater(note) : { ...note, ...updater }
      })
    )
  }, [setNotes])

  const handleRemove = useCallback(
    (id) => {
      setNotes((prev) => {
        const idsToRemove = new Set(collectNoteBranchIds(prev, id))
        return prev.filter((note) => !idsToRemove.has(note.id))
      })
    },
    [setNotes]
  )

  const handleChange = useCallback(
    (id, content) => {
      updateNote(id, note => touchNote(note, { content }))
    },
    [updateNote]
  )

  const handleAddImages = useCallback((id, images) => {
    if (!Array.isArray(images) || images.length === 0) return

    updateNote(id, (note) => touchNote(note, {
      images: [...(note.images || []), ...images],
    }))
  }, [updateNote])

  const handleChangeAudio = useCallback((id, audio) => {
    updateNote(id, (note) => touchNote(note, { audio }))
  }, [updateNote])

  const handleRemoveImage = useCallback((id, imageId) => {
    updateNote(id, (note) => touchNote(note, {
      images: (note.images || []).filter((image) => image.id !== imageId),
    }))
  }, [updateNote])

  const handleTogglePin = useCallback((id) => {
    updateNote(id, note => touchNote(note, { pinned: !note.pinned }))
  }, [updateNote])

  const handleToggleCollapse = useCallback((id) => {
    updateNote(id, note => ({
      ...note,
      collapsedChildren: !note.collapsedChildren,
    }))
  }, [updateNote])

  const handleOpenColorPicker = useCallback((event, noteId) => {
    const { left, top } = getPopupPosition(event.clientX, event.clientY)
    setColorPicker({ mode: 'edit', noteId, left, top })
  }, [])

  const handleApplyColor = useCallback((color) => {
    if (!colorPicker) return

    if (colorPicker.noteId) {
      updateNote(colorPicker.noteId, note => touchNote(note, { color }))
    }

    setColorPicker(null)
  }, [colorPicker, updateNote])

  const handleJump = useCallback(
    (note) => {
      jumpToText?.(note)
    },
    [jumpToText]
  )

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (colorPickerRef.current?.contains(event.target)) {
        return
      }

      closeMenus()
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [closeMenus])

  const queryText = query.trim().toLowerCase()

  const noteMatchesSearch = useCallback((note) => {
    if (!queryText) return true
    const anchor = (note.anchor || '').toLowerCase()
    const content = (note.content || '').toLowerCase()
    return anchor.includes(queryText) || content.includes(queryText)
  }, [queryText])

  // Build the display tree: sort, group children under parents, and prune
  // branches where neither the note nor any descendant matches the search.
  const noteTree = useMemo(() => {
    const byParent = new Map()
    const sortedNotes = [...notes].sort(compareNotes)

    sortedNotes.forEach((note) => {
      const parentId = note.parentNoteId || '__root__'
      if (!byParent.has(parentId)) {
        byParent.set(parentId, [])
      }
      byParent.get(parentId).push(note)
    })

    const buildBranch = (note) => {
      const children = (byParent.get(note.id) || []).map(buildBranch).filter(Boolean)
      const ownMatch = noteMatchesSearch(note)

      if (!ownMatch && children.length === 0) {
        return null
      }

      return {
        note,
        children,
      }
    }

    return (byParent.get('__root__') || []).map(buildBranch).filter(Boolean)
  }, [noteMatchesSearch, notes])

  const renderBranch = (branch, depth = 0) => {
    const isCollapsed = branch.note.collapsedChildren && !queryText

    return (
      <div
        key={branch.note.id}
        className="note-branch"
        // Dragging the tile onto a canvas places it there; a plain click still jumps
        // to the anchor, because the drag only arms after ~4px of movement.
        onPointerDown={(event) => startNoteDrag(event, branch.note.id, branch.note)}
      >
        <NoteCard
          note={branch.note}
          depth={depth}
          hasChildren={branch.children.length > 0}
          onJump={() => handleJump(branch.note)}
          onRemove={() => handleRemove(branch.note.id)}
          onChange={(content) => handleChange(branch.note.id, content)}
          onAddImages={(images) => handleAddImages(branch.note.id, images)}
          onRemoveImage={(imageId) => handleRemoveImage(branch.note.id, imageId)}
          onTogglePin={() => handleTogglePin(branch.note.id)}
          onToggleCollapse={() => handleToggleCollapse(branch.note.id)}
          onOpenColorPicker={(event) => handleOpenColorPicker(event, branch.note.id)}
          onStopEditing={clearActiveNoteHighlight}
          onChangeAudio={(audio) => handleChangeAudio(branch.note.id, audio)}
          projectName={projectName}
        />

        {branch.children.length > 0 && !isCollapsed ? (
          <div className="note-children">
            {branch.children.map((child) => renderBranch(child, depth + 1))}
          </div>
        ) : null}
      </div>
    )
  }

  const activeColorValue = colorPicker?.mode === 'edit'
    ? notes.find(note => note.id === colorPicker.noteId)?.color || NOTE_COLOR_OPTIONS[0]
    : NOTE_COLOR_OPTIONS[0]

  return (
    <div className="sidebar-panel notes-panel">
      {colorPicker && (
        <div
          ref={colorPickerRef}
          className="note-floating-menu note-color-menu"
          style={{ left: `${colorPicker.left}px`, top: `${colorPicker.top}px` }}
        >
          <div className="note-floating-title">Note color</div>
          <div className="note-color-options">
            {NOTE_COLOR_OPTIONS.map(color => (
              <button
                key={color}
                className="note-color-swatch"
                style={{ '--swatch-color': color }}
                onClick={() => handleApplyColor(color)}
                aria-label={`Use ${color} for note`}
                title={color}
              />
            ))}
            <label className="note-color-custom" title="Custom color">
              <span>Custom</span>
              <input
                type="color"
                defaultValue={activeColorValue}
                onChange={(event) => handleApplyColor(event.target.value)}
              />
            </label>
          </div>
        </div>
      )}

      <div className="notes-list">
        {noteTree.length === 0 ? (
          <div className="notes-empty">
            {notes.length === 0 ? 'No notes yet.' : 'No matching notes.'}
          </div>
        ) : (
          noteTree.map((branch) => renderBranch(branch))
        )}
      </div>

      {/* Follows the cursor while a note is dragged out to a canvas, and says whether
          it is actually over one. Without it the drag gives no sign it is working,
          which is indistinguishable from it not working. */}
      {dragGhost ? (
        <div
          className={`note-drag-ghost${dragGhost.overCanvas ? ' is-over-canvas' : ''}`}
          style={{
            transform: `translate3d(${dragGhost.x + 12}px, ${dragGhost.y + 12}px, 0)`,
            '--note-color': dragGhost.note?.color,
          }}
        >
          {dragGhost.note?.anchor || dragGhost.note?.content || 'Note'}
        </div>
      ) : null}
    </div>
  )
}
