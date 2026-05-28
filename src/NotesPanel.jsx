import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import NoteCard from './RightSidebar/NoteCard'
import SFIcon from './SFIcon'
import {
  collectNoteBranchIds,
  NOTE_COLOR_OPTIONS,
  NOTE_FILTER_OPTIONS,
  createFreeNote,
  matchesNoteFilter,
  compareNotes,
  touchNote,
} from './noteUtils'

const getPopupPosition = (x, y) => ({
  left: Math.max(12, Math.min(x - 92, window.innerWidth - 204)),
  top: Math.max(12, Math.min(y + 12, window.innerHeight - 180)),
})

export default function NotesPanel({
  notes = [],
  setNotes,
  jumpToText,
  clearActiveNoteHighlight,
}) {
  const [query, setQuery] = useState('')
  const [filterValue, setFilterValue] = useState('all')
  const [colorPicker, setColorPicker] = useState(null)
  const [filterMenu, setFilterMenu] = useState(null)
  const colorPickerRef = useRef(null)
  const filterMenuRef = useRef(null)

  const closeMenus = useCallback(() => {
    setColorPicker(null)
    setFilterMenu(null)
  }, [])

  const updateNote = useCallback((id, updater) => {
    setNotes(prev =>
      prev.map(note => {
        if (note.id !== id) return note
        return typeof updater === 'function' ? updater(note) : { ...note, ...updater }
      })
    )
  }, [setNotes])

  const handleAddNote = useCallback((event) => {
    const { left, top } = getPopupPosition(event.clientX, event.clientY)
    setFilterMenu(null)
    setColorPicker({ mode: 'create', left, top })
  }, [])

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
    setFilterMenu(null)
    setColorPicker({ mode: 'edit', noteId, left, top })
  }, [])

  const handleApplyColor = useCallback((color) => {
    if (!colorPicker) return

    if (colorPicker.mode === 'create') {
      setNotes(prev => [createFreeNote(color), ...prev])
    } else if (colorPicker.noteId) {
      updateNote(colorPicker.noteId, note => touchNote(note, { color }))
    }

    setColorPicker(null)
  }, [colorPicker, setNotes, updateNote])

  const handleJump = useCallback(
    (note) => {
      jumpToText?.(note)
    },
    [jumpToText]
  )

  const handleOpenFilterMenu = useCallback((event) => {
    const { left, top } = getPopupPosition(event.clientX, event.clientY)
    setColorPicker(null)
    setFilterMenu(current => (current ? null : { left, top }))
  }, [])

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (
        colorPickerRef.current?.contains(event.target) ||
        filterMenuRef.current?.contains(event.target)
      ) {
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

  const noteMatchesCurrentFilter = useCallback((note) => (
    matchesNoteFilter(note, filterValue) && noteMatchesSearch(note)
  ), [filterValue, noteMatchesSearch])

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
      const ownMatch = noteMatchesCurrentFilter(note)

      if (!ownMatch && children.length === 0) {
        return null
      }

      return {
        note,
        children,
      }
    }

    return (byParent.get('__root__') || []).map(buildBranch).filter(Boolean)
  }, [noteMatchesCurrentFilter, notes])

  const renderBranch = (branch, depth = 0) => {
    const isSearchActive = queryText.length > 0
    const isCollapsed = branch.note.collapsedChildren && !isSearchActive

    return (
      <div key={branch.note.id} className="note-branch">
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
        />

        {branch.children.length > 0 && !isCollapsed ? (
          <div className="note-children">
            {branch.children.map((child) => renderBranch(child, depth + 1))}
          </div>
        ) : null}
      </div>
    )
  }

  const activeFilter = NOTE_FILTER_OPTIONS.find(option => option.value === filterValue)
  const activeColorValue = colorPicker?.mode === 'edit'
    ? notes.find(note => note.id === colorPicker.noteId)?.color || NOTE_COLOR_OPTIONS[0]
    : NOTE_COLOR_OPTIONS[0]

  return (
    <div className="sidebar-panel notes-panel">
      <div className="sidebar-panel-sticky notes-panel-sticky">
        <div className="panel-header">
          <div className="panel-header-title">
            <SFIcon name="doc.text" />
            <span className="panel-header-label">Notes</span>
          </div>
          <button
            className="panel-action-btn panel-icon-btn"
            onClick={handleAddNote}
            aria-label="Add note"
            title="Add note"
          >
            <SFIcon name="plus" />
          </button>
        </div>

        <div className="notes-toolbar">
          <label className="sidebar-search-field" aria-label="Search notes">
            <SFIcon name="magnifyingglass" className="sidebar-search-icon" />
            <input
              className="sidebar-search-input"
              type="search"
              placeholder="Search notes..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>

          <button
            className={`panel-action-btn panel-icon-btn notes-filter-btn${filterValue !== 'all' ? ' active' : ''}`}
            onClick={handleOpenFilterMenu}
            aria-label="Filter notes"
            title={activeFilter ? `Filter: ${activeFilter.label}` : 'Filter notes'}
          >
            <SFIcon name="line.3.horizontal.decrease.circle" />
          </button>
        </div>
      </div>

      {filterMenu && (
        <div
          ref={filterMenuRef}
          className="note-floating-menu"
          style={{ left: `${filterMenu.left}px`, top: `${filterMenu.top}px` }}
        >
          <div className="note-floating-title">Filter notes</div>
          <div className="note-filter-options">
            {NOTE_FILTER_OPTIONS.map(option => (
              <button
                key={option.value}
                className={`note-filter-option${filterValue === option.value ? ' active' : ''}`}
                onClick={() => {
                  setFilterValue(option.value)
                  setFilterMenu(null)
                }}
              >
                <span>{option.label}</span>
                {filterValue === option.value ? <SFIcon name="checkmark" /> : null}
              </button>
            ))}
          </div>
        </div>
      )}

      {colorPicker && (
        <div
          ref={colorPickerRef}
          className="note-floating-menu note-color-menu"
          style={{ left: `${colorPicker.left}px`, top: `${colorPicker.top}px` }}
        >
          <div className="note-floating-title">
            {colorPicker.mode === 'create' ? 'Pick a note color' : 'Note color'}
          </div>
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
    </div>
  )
}
