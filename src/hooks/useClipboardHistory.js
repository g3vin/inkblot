/**
 * useClipboardHistory — the clipboard panel's entries, and dragging text into it.
 *
 * Dropping a selection onto the panel is a MOVE, not a copy, so the drop has to
 * know whether the pointer landed on the panel or back inside an editor pane —
 * hence the hit-testing helpers alongside the entry list.
 */
import { useCallback } from 'react'
import { dragHandoff, DragPayloadKind } from '../bridge'
import { MAX_CLIPBOARD_ENTRIES, MAX_CLIPBOARD_IMAGES } from '../lib/editorSession'

export function useClipboardHistory({
  activeDoc,
  currentDoc,
  draggedSelectionRef,
  editor,
  secondaryEditor,
  setClipboardHistory,
}) {

  const getClipboardDropZoneRect = useCallback(() => {
    const clipboardPanel = document.querySelector('.clipboard-panel')
    if (!clipboardPanel) return null
    const rightSidebar = clipboardPanel.closest('.right-sidebar')
    const sidebarContent = clipboardPanel.closest('.sidebar-content')
    return (
      rightSidebar?.getBoundingClientRect?.() ||
      sidebarContent?.getBoundingClientRect?.() ||
      clipboardPanel.getBoundingClientRect?.() ||
      null
    )
  }, [])

  const isPointInsideRect = useCallback((x, y, rect) => {
    if (!rect || x == null || y == null) return false
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }, [])

  const isPointInAnyEditorPane = useCallback((x, y) => {
    const primaryPane = document.querySelector('.primary-pane')
    const secondaryPane = document.querySelector('.secondary-pane')
    const primaryRect = primaryPane?.getBoundingClientRect?.() || null
    const secondaryRect = secondaryPane?.getBoundingClientRect?.() || null

    return (
      isPointInsideRect(x, y, primaryRect) ||
      isPointInsideRect(x, y, secondaryRect)
    )
  }, [isPointInsideRect])

  const addClipboardEntry = useCallback((text) => {
    const normalized = (text || '').trim()
    if (!normalized) return

    setClipboardHistory(prev => {
      const nextEntry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        text: normalized,
        docName: activeDoc || currentDoc || '',
        timestamp: new Date().toISOString(),
      }

      const deduped = prev.filter(entry => entry.text !== nextEntry.text)
      return [nextEntry, ...deduped].slice(0, MAX_CLIPBOARD_ENTRIES)
    })
  }, [activeDoc, currentDoc, setClipboardHistory])

  // A copied image keeps its src (usually a data URL) and no text.
  const addClipboardImage = useCallback((src) => {
    if (!src) return

    setClipboardHistory(prev => {
      const nextEntry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        kind: 'image',
        text: '',
        src,
        docName: activeDoc || currentDoc || '',
        timestamp: new Date().toISOString(),
      }

      let images = 0
      const kept = [nextEntry, ...prev.filter(entry => entry.src !== src)].filter(entry => (
        entry.kind !== 'image' || ++images <= MAX_CLIPBOARD_IMAGES
      ))
      return kept.slice(0, MAX_CLIPBOARD_ENTRIES)
    })
  }, [activeDoc, currentDoc, setClipboardHistory])

  const removeClipboardEntry = useCallback((entryId) => {
    if (!entryId) return
    setClipboardHistory(prev => prev.filter(entry => entry.id !== entryId))
  }, [setClipboardHistory])

  const clearClipboardHistory = useCallback(() => {
    setClipboardHistory([])
  }, [setClipboardHistory])

  // Dropped into a page, a piece leaves the clipboard.
  const moveClipboardEntryToEditor = removeClipboardEntry

  // Handle text dropped onto the clipboard panel. If the drag originated from an
  // editor selection, this is a "move": the selection is deleted from its source doc.
  const handleDropToClipboard = useCallback((payload) => {
    const text = (payload?.text || '').trim()
    if (!text) return

    const draggedSelection = draggedSelectionRef.current || payload?.selection
    const matchesDraggedSelection = Boolean(
      draggedSelection && draggedSelection.text?.trim() === text
    )
    const shouldRemoveFromDoc = Boolean(
      draggedSelection && (payload?.fromEditorSelection || matchesDraggedSelection)
    )

    if (shouldRemoveFromDoc) {
      const sourceEditor =
        draggedSelection.source === 'secondary' ? secondaryEditor : editor

      if (sourceEditor) {
        const docSize = sourceEditor.state?.doc?.content?.size ?? 0
        const from = Math.max(0, Math.min(draggedSelection.from, docSize))
        const to = Math.max(from, Math.min(draggedSelection.to, docSize))

        if (to > from) {
          sourceEditor
            .chain()
            .focus()
            .setTextSelection({ from, to })
            .deleteSelection()
            .run()
        }
      }
    }

    addClipboardEntry(text)
    draggedSelectionRef.current = null
    // The selection has been moved out of the document; the drag it belonged to is
    // over whether or not a dragend has arrived yet.
    if (dragHandoff.current()?.kind === DragPayloadKind.EditorSelection) dragHandoff.end()
  }, [addClipboardEntry, editor, secondaryEditor, draggedSelectionRef])

  return {
    getClipboardDropZoneRect,
    isPointInAnyEditorPane,
    addClipboardEntry,
    addClipboardImage,
    removeClipboardEntry,
    clearClipboardHistory,
    moveClipboardEntryToEditor,
    handleDropToClipboard,
  }
}
