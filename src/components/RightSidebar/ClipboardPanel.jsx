/**
 * ClipboardPanel.jsx — the Clipboard tab of the right sidebar.
 *
 * Shows the copy history as pieces straight on the panel, one per section, each
 * collapsible: copied text, or a copied image shown as itself. Each piece's header
 * holds its actions: make it a note, copy it, delete it. Dragging a piece of text carries it into an editor
 * pane (useClipboardPieceDrag), and dropping editor selections or external text onto
 * this panel adds a clipboard entry.
 *
 * Drops onto the panel meet the editor on `bridge/dragHandoff`. A drop both of them
 * can see is *claimed*, so which one handles it does not depend on the order their
 * listeners run in.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { dragHandoff, DragPayloadKind } from '../../bridge'
import IconButton from '../../ui/IconButton.jsx'
import Section from '../../ui/Section.jsx'
import { EmptyState } from '../../ui/Surfaces.jsx'
import { useClipboardPieceDrag } from './useClipboardPieceDrag'
import { EDITOR_SELECTION_DRAGEND } from '../../lib/appEvents'

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

const firstLine = (text = '') => text.trim().split('\n')[0]

const isImage = (entry) => entry?.kind === 'image'

// The clipboard takes images as PNG; anything else is redrawn as one.
const imageAsPng = async (src) => {
  const blob = await (await fetch(src)).blob()
  if (blob.type === 'image/png') return blob
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d').drawImage(bitmap, 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob((png) => (png ? resolve(png) : reject(new Error('Could not redraw the image'))), 'image/png')
  })
}

export default function ClipboardPanel({ entries = [], query = '', onDropToClipboard, onRemoveEntry, onMakeNote }) {
  const [copiedId, setCopiedId] = useState('')
  const [dropActive, setDropActive] = useState(false)
  const panelRef = useRef(null)
  const { ghost, ghostRef, onPointerDown } = useClipboardPieceDrag()
  const normalizedQuery = query.trim().toLowerCase()
  const visibleEntries = normalizedQuery
    ? entries.filter((entry) => (
        `${entry.docName || ''} ${isImage(entry) ? 'image' : entry.text || ''} ${entry.timestamp || ''}`
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

  const copyEntry = async (entry) => {
    if (isImage(entry) ? !entry.src : !entry?.text) return
    try {
      if (isImage(entry)) {
        // The item takes the promise, so the write still counts as the click's.
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': imageAsPng(entry.src) })])
      } else {
        await navigator.clipboard.writeText(entry.text)
      }
      setCopiedId(entry.id)
      window.setTimeout(() => setCopiedId(''), 1100)
    } catch (e) {
      console.error('Failed to copy clipboard entry:', e)
    }
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
    window.addEventListener(EDITOR_SELECTION_DRAGEND, onEditorSelectionDragEnd)

    return () => {
      window.removeEventListener('drag', onWindowDrag, true)
      window.removeEventListener('dragover', onWindowDragOver, true)
      window.removeEventListener('drop', onWindowDrop, true)
      window.removeEventListener('dragend', onWindowDragEnd, true)
      window.removeEventListener(EDITOR_SELECTION_DRAGEND, onEditorSelectionDragEnd)
    }
  // Drag handlers intentionally read live window DnD state at event time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDropToClipboard])

  return (
    <div
      ref={panelRef}
      className={`sidebar-panel clipboard-panel${dropActive ? ' drop-active' : ''}`}
      data-help="clipboard.panel"
      onDragOverCapture={handleDragOver}
      onDragEnterCapture={() => setDropActive(true)}
      onDragLeaveCapture={handleDragLeave}
      onDropCapture={handleDrop}
    >
      <div className={`clipboard-list${visibleEntries.length === 0 ? ' is-empty' : ''}`}>
        {visibleEntries.length === 0 ? (
          entries.length === 0 ? (
            <EmptyState
              className="clipboard-empty-state"
              icon="clipboard"
              title="Nothing copied yet."
              hint="Copy some text or an image, or drag a selection here, to keep it to hand."
              dropActive={dropActive}
            />
          ) : <EmptyState compact title="No matching clipboard items." />
        ) : (
          visibleEntries.map((entry) => {
            const copied = copiedId === entry.id
            const image = isImage(entry)
            const meta = [entry.docName || 'Untitled', formatTimestamp(entry.timestamp)].filter(Boolean).join(' · ')
            return (
              <div
                key={entry.id}
                className={`clipboard-item${image ? ' is-image' : ''}`}
                onPointerDown={(event) => {
                  // Only words can be dropped into the page.
                  if (image) return
                  const open = event.currentTarget.querySelector('.ui-section')?.dataset.open === 'true'
                  onPointerDown(event, entry, event.currentTarget.querySelector(open ? '.clipboard-text' : '.clipboard-peek'))
                }}
              >
                <Section
                  title={(
                    <>
                      <span className="clipboard-peek">{image ? 'Image' : firstLine(entry.text)}</span>
                      <span className="clipboard-meta">{meta}</span>
                    </>
                  )}
                  accessory={(
                    <>
                      <IconButton icon="note" label="Make a note" size="circle" onClick={() => onMakeNote?.(entry)} />
                      <IconButton
                        icon={copied ? 'check' : 'copy'}
                        label={copied ? 'Copied' : 'Copy'}
                        size="circle"
                        onClick={() => copyEntry(entry)}
                      />
                      <IconButton icon="delete" label="Delete" size="circle" onClick={() => onRemoveEntry?.(entry.id)} />
                    </>
                  )}
                >
                  {image ? (
                    <img className="clipboard-image" src={entry.src} alt="Copied image" draggable={false} />
                  ) : (
                    <div className="clipboard-text">{entry.text}</div>
                  )}
                </Section>
              </div>
            )
          })
        )}
      </div>
      {ghost ? createPortal(
        <div ref={ghostRef} className="clipboard-ghost" style={{ width: ghost.width }} aria-hidden="true">
          {ghost.text}
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
