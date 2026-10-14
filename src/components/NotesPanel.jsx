/**
 * NotesPanel.jsx — the Notes tab of the right sidebar.
 *
 * Renders the active document's notes as a nested tree of NoteCards
 * (children via parentNoteId), with search filtering, pin/collapse toggles,
 * per-note color picking, image attachments, and jump-to-anchor.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import NoteCard from './RightSidebar/NoteCard'
import NoteBranchLines from './NoteBranchLines'
import { canvasSurfaceAt, dispatchCanvasDropNote } from '../canvas/canvasEvents'
import {
  collectNoteBranchIds,
  compareNotes,
  createFreeNote,
  noteColor,
  touchNote,
} from '../lib/noteUtils'
import { EmptyState } from '../ui/Surfaces.jsx'
import { NOTE_POP_MS, closeSchedule, drawMs, lineStart, openTiming, prefersReducedMotion } from '../lib/noteReveal'

const findBranch = (branches, id) => {
  for (const branch of branches) {
    if (branch.note.id === id) return branch
    const found = findBranch(branch.children, id)
    if (found) return found
  }
  return null
}

/** The replies showing under a branch, generation by generation, as [parentId, child]. */
const visibleEdges = (branch, isRoot = true) => {
  if (!isRoot && branch.note.collapsedChildren) return []
  return branch.children.flatMap((child) => [[branch.note.id, child], ...visibleEdges(child, false)])
}

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
 * The note's TEXTAREA is a legitimate place to start a drag: `.note-textarea` is
 * width:100% and fills the tile, so nearly every press lands on it, and skipping
 * textareas outright would leave only a few pixels of margin draggable. So a press on the textarea arms a
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


  // A connected note, in the parent's colour, opened under it with the caret in it.
  const handleAddChild = useCallback((parentId) => {
    const parent = notes.find((note) => note.id === parentId)
    const child = touchNote(createFreeNote(parent?.color), { parentNoteId: parentId, collapsedChildren: false })
    finishMotion()
    setNotes((prev) => [
      ...prev.map((note) => (note.id === parentId && note.collapsedChildren ? { ...note, collapsedChildren: false } : note)),
      child,
    ])
    // It draws and pops in on its own, as one added to a hover note does.
    if (!prefersReducedMotion()) setMotion({ kind: 'pending', rootId: parentId, only: child.id })
    requestAnimationFrame(() => document.querySelector(`#note-${child.id} textarea`)?.focus())
  // finishMotion is stable in all but name: it reads the motion through a ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, setNotes])

  const handleChangeColor = useCallback((id, color) => {
    updateNote(id, note => touchNote(note, { color }))
  }, [updateNote])

  const handleJump = useCallback(
    (note) => {
      jumpToText?.(note)
    },
    [jumpToText]
  )

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

  /* ---------------- opening and closing a branch ----------------
     As a hover note's do (lib/noteReveal): opening, the lines draw from the parent a
     generation at a time and each reply grows out of its line's end; closing, the
     same backwards and quicker, deepest first, and the branch folds once it has
     played. 'pending' is the commit the replies first appear in, hidden, so they can
     be measured (NoteBranchLines) before the timings are set, all before a paint. */

  const [motion, setMotion] = useState(null)
  const motionRef = useRef(null)
  motionRef.current = motion
  const motionTimerRef = useRef(0)
  // Each reply's line length, by id, as last measured.
  const [lineLengths] = useState(() => new Map())

  // Settle whatever is playing: a closing folds its branch now.
  const finishMotion = () => {
    window.clearTimeout(motionTimerRef.current)
    motionTimerRef.current = 0
    const playing = motionRef.current
    if (playing?.kind === 'close') {
      updateNote(playing.rootId, (note) => ({ ...note, collapsedChildren: true }))
    }
    if (playing) setMotion(null)
  }
  useEffect(() => () => window.clearTimeout(motionTimerRef.current), [])

  const handleToggleCollapse = (id) => {
    finishMotion()
    const branch = findBranch(noteTree, id)
    const animate = !queryText && !prefersReducedMotion() && branch
    if (branch?.note.collapsedChildren) {
      updateNote(id, (note) => ({ ...note, collapsedChildren: false }))
      if (animate) setMotion({ kind: 'pending', rootId: id })
      return
    }
    if (!animate) {
      updateNote(id, (note) => ({ ...note, collapsedChildren: true }))
      return
    }
    const edges = visibleEdges(branch).map(([fromId, child]) => ({
      fromNoteId: fromId === id ? null : fromId,
      toNoteId: child.note.id,
      duration: drawMs(lineLengths.get(child.note.id)),
    }))
    const { schedule, total } = closeSchedule(edges)
    const notesMotion = new Map()
    schedule.forEach(({ card, string }, noteId) => notesMotion.set(noteId, { state: 'closing', card, line: string }))
    setMotion({ kind: 'close', rootId: id, notes: notesMotion })
    motionTimerRef.current = window.setTimeout(finishMotion, total)
  }

  // The replies are in and measured: time the opening by their lines.
  useLayoutEffect(() => {
    if (motion?.kind !== 'pending') return
    const branch = findBranch(noteTree, motion.rootId)
    if (!branch) {
      setMotion(null)
      return
    }
    const timings = new Map()
    const notesMotion = new Map()
    let total = 0
    visibleEdges(branch).forEach(([fromId, child]) => {
      const id = child.note.id
      if (motion.only && id !== motion.only) return
      const draw = drawMs(lineLengths.get(id))
      const timing = openTiming(motion.only ? 0 : lineStart(fromId === motion.rootId ? null : timings.get(fromId)), draw)
      timings.set(id, timing)
      notesMotion.set(id, {
        state: 'opening',
        card: { delay: timing.pop, ms: NOTE_POP_MS },
        line: { delay: timing.line, ms: timing.draw },
      })
      total = Math.max(total, timing.pop + NOTE_POP_MS)
    })
    setMotion({ kind: 'open', rootId: motion.rootId, notes: notesMotion })
    motionTimerRef.current = window.setTimeout(finishMotion, total)
  // Runs once per pending opening; the rest is read as it stands then.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motion])

  // While a branch opens, its replies wait hidden until their turn.
  const pendingIds = useMemo(() => {
    if (motion?.kind !== 'pending') return null
    if (motion.only) return new Set([motion.only])
    const branch = findBranch(noteTree, motion.rootId)
    return new Set(branch ? visibleEdges(branch).map(([, child]) => child.note.id) : [])
  }, [motion, noteTree])

  const motionFor = (id) => (pendingIds?.has(id) ? { state: 'pending' } : motion?.notes?.get(id) ?? null)

  // A reply hangs from its parent by a line in the parent's ink (NoteBranchLines);
  // its depth sets its indent.
  const renderBranch = (branch, depth = 0) => {
    const isCollapsed = branch.note.collapsedChildren && !queryText

    return (
      <div
        key={branch.note.id}
        className="note-branch"
        data-note-id={branch.note.id}
        style={{ '--note-depth': depth }}
        // Dragging the tile onto a canvas places it there; a plain click still jumps
        // to the anchor, because the drag only arms after ~4px of movement.
        onPointerDown={(event) => startNoteDrag(event, branch.note.id, branch.note)}
      >
        <NoteCard
          note={branch.note}
          motion={motionFor(branch.note.id)}
          hasChildren={branch.children.length > 0}
          onJump={() => handleJump(branch.note)}
          onRemove={() => handleRemove(branch.note.id)}
          onChange={(content) => handleChange(branch.note.id, content)}
          onAddImages={(images) => handleAddImages(branch.note.id, images)}
          onRemoveImage={(imageId) => handleRemoveImage(branch.note.id, imageId)}
          onTogglePin={() => handleTogglePin(branch.note.id)}
          onToggleCollapse={() => handleToggleCollapse(branch.note.id)}
          onAddChild={() => handleAddChild(branch.note.id)}
          onChangeColor={(ink) => handleChangeColor(branch.note.id, ink)}
          onStopEditing={clearActiveNoteHighlight}
          onChangeAudio={(audio) => handleChangeAudio(branch.note.id, audio)}
          projectName={projectName}
        />

        {branch.children.length > 0 && !isCollapsed ? (
          <div className="note-children">
            <NoteBranchLines
              parentColor={branch.note.color}
              childIds={branch.children.map((child) => child.note.id)}
              lengths={lineLengths}
              motionFor={motionFor}
            />
            {branch.children.map((child) => renderBranch(child, depth + 1))}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="sidebar-panel notes-panel" data-help="notes.panel">
      <div className="notes-list">
        {noteTree.length === 0 ? (
          notes.length === 0
            ? <EmptyState icon="note" title="No notes yet." hint="Select some text and press ⌥⌘N to leave yourself a note." />
            : <EmptyState compact title="No matching notes." />
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
            '--note-color': noteColor(dragGhost.note?.color),
          }}
        >
          {dragGhost.note?.anchor || dragGhost.note?.content || 'Note'}
        </div>
      ) : null}
    </div>
  )
}
