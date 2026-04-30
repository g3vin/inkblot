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

export default function ClipboardPanel({ entries = [], onClear, onDropToClipboard }) {
  const [copiedId, setCopiedId] = useState('')
  const [dropActive, setDropActive] = useState(false)
  const panelRef = useRef(null)

  const emitDnDDebug = (phase, status = {}, info = '', transient = false) => {
    try {
      window.dispatchEvent(new CustomEvent('inkblot:dnd-debug', {
        detail: { phase, status, info, transient },
      }))
    } catch (e) {}
  }

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
      emitDnDDebug('clipboard-tile-dragstart', {
        source: 'clipboard',
        clipboardPayload: true,
        dropHandled: false,
      }, `id=${entry.id} len=${(entry.text || '').length}`)
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

    emitDnDDebug('clipboard-tile-dragend', {
      source: 'clipboard',
      clipboardPayload: Boolean(entry?.text),
      dropHandled: Boolean(window.__inkblot_dropHandled),
    }, `x=${String(point.x)} y=${String(point.y)}`)

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
    emitDnDDebug('clipboard-dragover', {
      over: 'clipboard',
    }, '', true)
  }

  const handleDragLeave = (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setDropActive(false)
    }
  }

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

    if (parsedClipboard && !parsedSelection) {
      emitDnDDebug('clipboard-drop-ignored-tile', {
        over: 'clipboard',
        clipboardPayload: true,
      })
      return
    }

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
    emitDnDDebug('clipboard-drop', {
      over: 'clipboard',
      dropHandled: true,
      editorSelection: fromEditorSelection,
    }, `len=${droppedText.length}`)
  }

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
        emitDnDDebug('clipboard-dragover-outside', { over: 'none' }, '', true)
        return
      }

      event.preventDefault()
      setDropActive(true)
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
      emitDnDDebug('clipboard-window-dragover-target', { over: 'clipboard' }, '', true)
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
        emitDnDDebug('clipboard-fallback-drop-on-dragend', {
          over: 'clipboard',
          dropHandled: true,
          editorSelection: true,
        }, `len=${selection.text.length}`)
      }
      setDropActive(false)
      emitDnDDebug('clipboard-window-dragend', {
        over: 'none',
        dropHandled: Boolean(window.__inkblot_dropHandled),
      }, `fallback=${String(!dropHandled)}`)
    }

    const onEditorSelectionDragEnd = (event) => {
      const detail = event?.detail || {}
      const selection = detail.selection || null
      const point = {
        x: detail.x ?? window.__inkblot_dragPoint?.x ?? null,
        y: detail.y ?? window.__inkblot_dragPoint?.y ?? null,
      }

      if (window.__inkblot_dropHandled) return
      if (!selection?.text || !insidePanel(point.x, point.y)) {
        emitDnDDebug('clipboard-editor-selection-dragend-miss', {
          over: 'none',
          editorSelection: Boolean(selection?.text),
        }, `x=${String(point.x)} y=${String(point.y)}`)
        return
      }

      onDropToClipboard?.({
        text: selection.text,
        fromEditorSelection: true,
        selection,
      })
      try { window.__inkblot_dropHandled = true } catch (e) {}
      emitDnDDebug('clipboard-editor-selection-dragend-target', {
        over: 'clipboard',
        dropHandled: true,
        editorSelection: true,
      }, `len=${selection.text.length}`)
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
      <div className="panel-header">
        <div className="panel-header-title">
          <SFIcon name="doc.on.clipboard" />
          <span className="panel-header-label">Clipboard</span>
        </div>
        {entries.length > 0 ? (
          <button className="panel-action-btn" onClick={onClear}>Clear</button>
        ) : null}
      </div>

      <div className={`clipboard-list${entries.length === 0 ? ' is-empty' : ''}`}>
        {entries.length === 0 ? (
          <div className="notes-empty clipboard-empty-state">Copy text or drag selected text here.</div>
        ) : (
          entries.map((entry) => (
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
