/**
 * ClipboardPanel.jsx — the Clipboard tab of the right sidebar.
 *
 * Shows the copy history as draggable tiles: dragging a tile into an editor
 * pane moves the text into the document, and dropping editor selections or
 * external text onto this panel adds a clipboard entry.
 *
 * This panel and the editor are the two ends of one drag, and they used to meet on
 * `window.__inkblot_*`. They meet on `bridge/dragHandoff` now — same shape, one owner,
 * and a drop that is *claimed* rather than flagged, so which of the two handles a drop
 * both of them can see no longer depends on the order their listeners happen to run
 * in. This panel is going native in Phase 5, so it is one of the two ends that will
 * genuinely be in a different process.
 */
import { useEffect, useRef, useState } from 'react'
import { dragHandoff, DragPayloadKind } from '../../bridge'
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
      // Unmounting mid-drag ends it: there is no longer a source to move from.
      if (dragHandoff.current()?.kind === DragPayloadKind.ClipboardEntry) dragHandoff.end()
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

  const beginTileDrag = (entry) => dragHandoff.begin({
    kind: DragPayloadKind.ClipboardEntry,
    text: entry.text || '',
    sourceId: entry.id,
  })

  const startTileDrag = (event, entry) => {
    beginTileDrag(entry)
    try {
      const payload = JSON.stringify({ id: entry.id, text: entry.text })
      event.dataTransfer?.setData(
        'application/x-inkblot-clipboard-entry',
        payload
      )
      event.dataTransfer?.setData('text/plain', entry.text || '')
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
      }
    } catch (e) {}
  }

  // The pointer can reach a tile before `dragstart` fires, and the drop caret needs
  // the payload during `dragover` — where dataTransfer is unreadable.
  const primeTileDrag = (entry) => { beginTileDrag(entry) }

  const endTileDrag = (event, entry) => {
    const point = dragHandoff.point()
    const x = event?.clientX ?? point?.x ?? null
    const y = event?.clientY ?? point?.y ?? null

    try {
      window.dispatchEvent(new CustomEvent('inkblot:clipboard-dragend-drop', {
        detail: { id: entry.id, text: entry.text || '', x, y },
      }))
    } catch (e) {}

    dragHandoff.end({ x, y })
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
    dragHandoff.claim()

    const selectionPayload = event.dataTransfer?.getData('application/x-inkblot-editor-selection')
    const clipboardPayload = event.dataTransfer?.getData('application/x-inkblot-clipboard-entry')
    const plainText = event.dataTransfer?.getData('text/plain') || ''
    const session = dragHandoff.current()
    const draggedSelection = session?.kind === DragPayloadKind.EditorSelection
      ? { text: session.text, from: session.anchor?.from, to: session.anchor?.to, docName: session.docPath || '' }
      : null

    let parsedSelection = draggedSelection
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
      draggedSelection ||
      event.dataTransfer?.types?.includes('application/x-inkblot-editor-selection')
    )

    onDropToClipboard?.({
      text: droppedText,
      fromEditorSelection,
      selection: parsedSelection || null,
    })
  }

  // Window-level fallbacks: track the drag point on the hand-off and accept drops /
  // dragends that land over the panel even when the DOM drop event is missed.
  useEffect(() => {
    const insidePanel = (x, y) => {
      const rect = getDropZoneRect()
      if (!rect) return false
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    }

    const onWindowDragOver = (event) => {
      dragHandoff.moveTo(event.clientX, event.clientY)
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
      dragHandoff.moveTo(event.clientX, event.clientY)
    }

    const onWindowDrop = (event) => {
      if (!insidePanel(event.clientX, event.clientY)) return
      handleDrop(event)
    }

    const onWindowDragEnd = (event) => {
      if (!dragHandoff.point() && (event?.clientX || event?.clientY)) {
        dragHandoff.moveTo(event.clientX, event.clientY)
      }
      const point = dragHandoff.point()
      const session = dragHandoff.current()
      const isSelection = session?.kind === DragPayloadKind.EditorSelection
      if (isSelection && session.text && point && insidePanel(point.x, point.y)) {
        // Claim first: if some other target already took this drop, `claim` is false
        // and the entry must not be added twice.
        if (dragHandoff.claim()) {
          onDropToClipboard?.({
            text: session.text,
            fromEditorSelection: true,
            selection: {
              text: session.text,
              from: session.anchor?.from,
              to: session.anchor?.to,
              docName: session.docPath || '',
            },
          })
        }
      }
      setDropActive(false)
    }

    const onEditorSelectionDragEnd = (event) => {
      const detail = event?.detail || {}
      const selection = detail.selection || null
      const held = dragHandoff.point()
      const point = { x: detail.x ?? held?.x ?? null, y: detail.y ?? held?.y ?? null }

      if (!selection?.text || !insidePanel(point.x, point.y)) return
      if (!dragHandoff.claim()) return

      onDropToClipboard?.({
        text: selection.text,
        fromEditorSelection: true,
        selection,
      })
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
