/**
 * ClipboardPanel.jsx — the Clipboard tab of the right sidebar.
 *
 * Shows the copy history as draggable tiles: dragging a tile into an editor
 * pane moves the text into the document, and dropping editor selections or
 * external text onto this panel adds a clipboard entry. Uses the shared
 * window-global drag state (window.__inkblot_*) to coordinate with
 * EditorCanvas across native drag events.
 */
import { useEffect, useRef, useState } from 'react'
import SFIcon from '../SFIcon'

const formatTimestamp = (iso) => {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export default function ClipboardPanel({ entries = [], query = '', onDropToClipboard }) {
  const [copiedId, setCopiedId] = useState('')
  const [dropActive, setDropActive] = useState(false)
  const panelRef = useRef(null)
  const normalizedQuery = query.trim().toLowerCase()
  const visibleEntries = normalizedQuery
    ? entries.filter((entry) => (
        `${entry.docName || ''} ${entry.text || ''} ${entry.timestamp || ''}`
          .toLowerCase()
          .includes(normalizedQuery)
      ))
    : entries

  const getDropZoneRect = () => {
    const panel = panelRef.current
    if (!panel) return null
    const rightSidebar = panel.closest('.right-sidebar')
    const sidebarContent = panel.closest('.sidebar-content')
    return (
      rightSidebar?.getBoundingClientRect?.() ||
      sidebarContent?.getBoundingClientRect?.() ||
      panel.getBoundingClientRect?.() ||
      null
    )
  }

  useEffect(() => {
    return () => {
      try { window.__inkblot_draggedClipboardEntry = null } catch (e) {}
    }
  }, [])

  const copyEntry = async (entry) => {
    if (!entry?.text) return
    try {
      await navigator.clipboard.writeText(entry.text)
      setCopiedId(entry.id)
      window.setTimeout(() => setCopiedId(''), 1100)
    } catch (e) {
      console.error('Failed to copy clipboard entry:', e)
    }
  }

  const startTileDrag = (event, entry) => {
    try {
      window.__inkblot_dropHandled = false
      const payload = JSON.stringify({ id: entry.id, text: entry.text })
      event.dataTransfer?.setData(
        'application/x-inkblot-clipboard-entry',
        payload
      )
      event.dataTransfer?.setData('text/plain', entry.text || '')
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
      }
      window.__inkblot_draggedClipboardEntry = { id: entry.id, text: entry.text || '' }
    } catch (e) {}
  }

  const primeTileDrag = (entry) => {
    try { window.__inkblot_draggedClipboardEntry = { id: entry.id, text: entry.text || '' } } catch (e) {}
  }

  const endTileDrag = (event, entry) => {
    const point = {
      x: event?.clientX ?? window.__inkblot_dragPoint?.x ?? null,
      y: event?.clientY ?? window.__inkblot_dragPoint?.y ?? null,
    }

    try {
      window.dispatchEvent(new CustomEvent('inkblot:clipboard-dragend-drop', {
        detail: {
          id: entry.id,
          text: entry.text || '',
          x: point.x,
          y: point.y,
        },
      }))
    } catch (e) {}

    try { window.__inkblot_draggedClipboardEntry = null } catch (e) {}
    try { window.__inkblot_dragPoint = null } catch (e) {}
    setDropActive(false)
  }

  const handleDragOver = (event) => {
    event.preventDefault()
    setDropActive(true)
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
  }

  const handleDragLeave = (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setDropActive(false)
    }
  }

  // Accept drops of editor selections or plain text; ignore drops of our own
  // clipboard tiles (those are reorders, not new entries).
  const handleDrop = (event) => {
    event.preventDefault()
    event.stopPropagation()
    setDropActive(false)
    try { window.__inkblot_dropHandled = true } catch (e) {}

    const selectionPayload = event.dataTransfer?.getData('application/x-inkblot-editor-selection')
    const clipboardPayload = event.dataTransfer?.getData('application/x-inkblot-clipboard-entry')
    const plainText = event.dataTransfer?.getData('text/plain') || ''
    const globalDraggedSelection = window.__inkblot_draggedEditorSelection || null

    let parsedSelection = globalDraggedSelection
    if (selectionPayload) {
      try {
        parsedSelection = JSON.parse(selectionPayload)
      } catch (e) {}
    }

    let parsedClipboard = null
    if (clipboardPayload) {
      try {
        parsedClipboard = JSON.parse(clipboardPayload)
      } catch (e) {}
    }

    if (parsedClipboard && !parsedSelection) return

    const droppedText = parsedSelection?.text || plainText || parsedClipboard?.text || ''
    if (!droppedText.trim()) return

    const fromEditorSelection = Boolean(
      parsedSelection ||
      globalDraggedSelection ||
      event.dataTransfer?.types?.includes('application/x-inkblot-editor-selection')
    )

    onDropToClipboard?.({
      text: droppedText,
      fromEditorSelection,
      selection: parsedSelection || null,
    })
  }

  // Window-level fallbacks: track the drag point globally and accept drops /
  // dragends that land over the panel even when the DOM drop event is missed.
  useEffect(() => {
    const insidePanel = (x, y) => {
      const rect = getDropZoneRect()
      if (!rect) return false
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    }

    const onWindowDragOver = (event) => {
      try { window.__inkblot_dragPoint = { x: event.clientX, y: event.clientY } } catch (e) {}
      if (!insidePanel(event.clientX, event.clientY)) {
        setDropActive(false)
        return
      }

      event.preventDefault()
      setDropActive(true)
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
    }

    const onWindowDrag = (event) => {
      try { window.__inkblot_dragPoint = { x: event.clientX, y: event.clientY } } catch (e) {}
    }

    const onWindowDrop = (event) => {
      if (!insidePanel(event.clientX, event.clientY)) return
      handleDrop(event)
    }

    const onWindowDragEnd = (event) => {
      if (!window.__inkblot_dragPoint && (event?.clientX || event?.clientY)) {
        try { window.__inkblot_dragPoint = { x: event.clientX, y: event.clientY } } catch (e) {}
      }
      const dropHandled = Boolean(window.__inkblot_dropHandled)
      const point = window.__inkblot_dragPoint || null
      const selection = window.__inkblot_draggedEditorSelection || null
      if (!dropHandled && selection?.text && point && insidePanel(point.x, point.y)) {
        onDropToClipboard?.({
          text: selection.text,
          fromEditorSelection: true,
          selection,
        })
        try { window.__inkblot_dropHandled = true } catch (e) {}
      }
      setDropActive(false)
    }

    const onEditorSelectionDragEnd = (event) => {
      const detail = event?.detail || {}
      const selection = detail.selection || null
      const point = {
        x: detail.x ?? window.__inkblot_dragPoint?.x ?? null,
        y: detail.y ?? window.__inkblot_dragPoint?.y ?? null,
      }

      if (window.__inkblot_dropHandled) return
      if (!selection?.text || !insidePanel(point.x, point.y)) return

      onDropToClipboard?.({
        text: selection.text,
        fromEditorSelection: true,
        selection,
      })
      try { window.__inkblot_dropHandled = true } catch (e) {}
    }

    window.addEventListener('drag', onWindowDrag, true)
    window.addEventListener('dragover', onWindowDragOver, true)
    window.addEventListener('drop', onWindowDrop, true)
    window.addEventListener('dragend', onWindowDragEnd, true)
    window.addEventListener('inkblot:editor-selection-dragend', onEditorSelectionDragEnd)

    return () => {
      window.removeEventListener('drag', onWindowDrag, true)
      window.removeEventListener('dragover', onWindowDragOver, true)
      window.removeEventListener('drop', onWindowDrop, true)
      window.removeEventListener('dragend', onWindowDragEnd, true)
      window.removeEventListener('inkblot:editor-selection-dragend', onEditorSelectionDragEnd)
    }
  // Drag handlers intentionally read live window DnD state at event time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDropToClipboard])

  return (
    <div
      ref={panelRef}
      className={`sidebar-panel clipboard-panel${dropActive ? ' drop-active' : ''}`}
      onDragOverCapture={handleDragOver}
      onDragEnterCapture={() => setDropActive(true)}
      onDragLeaveCapture={handleDragLeave}
      onDropCapture={handleDrop}
    >
      <div className={`clipboard-list${visibleEntries.length === 0 ? ' is-empty' : ''}`}>
        {visibleEntries.length === 0 ? (
          <div className="notes-empty clipboard-empty-state">
            {entries.length === 0 ? 'Copy text or drag selected text here.' : 'No matching clipboard items.'}
          </div>
        ) : (
          visibleEntries.map((entry) => (
            <div
              key={entry.id}
              className="tile clipboard-item"
              draggable
              onMouseDown={() => primeTileDrag(entry)}
              onDragStart={(event) => startTileDrag(event, entry)}
              onDragEnd={(event) => endTileDrag(event, entry)}
            >
              <div className="clipboard-item-header">
                <span className="clipboard-meta">
                  {entry.docName || 'Untitled'} {entry.timestamp ? `• ${formatTimestamp(entry.timestamp)}` : ''}
                </span>
              </div>

              <div className="clipboard-text">{entry.text}</div>

              <div className="clipboard-actions">
                <button
                  className="clipboard-icon-btn panel-action-btn panel-icon-btn"
                  onClick={() => copyEntry(entry)}
                  title={copiedId === entry.id ? 'Copied' : 'Copy'}
                  aria-label={copiedId === entry.id ? 'Copied' : 'Copy'}
                >
                  <SFIcon name={copiedId === entry.id ? 'checkmark' : 'doc.on.doc'} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
