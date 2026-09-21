/**
 * useClipboardHistory — the clipboard panel's entries, and dragging text into it.
 *
 * Dropping a selection onto the panel is a MOVE, not a copy, so the drop has to
 * know whether the pointer landed on the panel or back inside an editor pane —
 * hence the hit-testing helpers alongside the entry list.
 */
import { useCallback } from 'react'
import { CLIPBOARD_PERSIST_KEY, MAX_CLIPBOARD_ENTRIES } from '../lib/editorSession'

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

  const clearClipboardHistory = useCallback(() => {
    setClipboardHistory([])
  }, [setClipboardHistory])

  const moveClipboardEntryToEditor = useCallback((entryId) => {
    if (!entryId) return
    setClipboardHistory(prev => prev.filter(entry => entry.id !== entryId))
  }, [setClipboardHistory])

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
    try { window.__inkblot_draggedEditorSelection = null } catch (e) {}
  }, [addClipboardEntry, editor, secondaryEditor, draggedSelectionRef])

  return {
    getClipboardDropZoneRect,
    isPointInAnyEditorPane,
    addClipboardEntry,
    clearClipboardHistory,
    moveClipboardEntryToEditor,
    handleDropToClipboard,
  }
}
