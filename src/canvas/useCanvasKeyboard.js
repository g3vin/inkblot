/**
 * useCanvasKeyboard — surface-level key handling.
 *
 * Bound to the surface element rather than the window, so a card being edited
 * keeps its own keys: ⌘Z inside a live TipTap card belongs to that editor, not to
 * the canvas undo stack.
 */
import { useEffect } from 'react'

export function useCanvasKeyboard({
  clear,
  deleteSelection,
  groupSelection,
  locked,
  redo,
  reorderSelection,
  selectAll,
  selectionRef,
  stateRef,
  surfaceRef,
  toggleLocked,
  undo,
  ungroupSelection,
}) {
  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return

    const onKeyDown = (event) => {
      // Never steal keys from a card that is being edited — ⌘Z there belongs to
      // that editor's own history.
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]')) {
        return
      }

      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      // L locks and unlocks — read mode. No modifier: it is a mode switch you reach
      // for constantly while browsing a board, not a rare command.
      if (!mod && key === 'l') {
        event.preventDefault()
        toggleLocked()
        return
      }

      // Everything below edits. In read mode there is nothing to edit.
      if (locked) return

      if (mod && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }

      if (mod && key === 'a') {
        event.preventDefault()
        selectAll(stateRef.current)
        return
      }

      if (mod && key === 'g') {
        event.preventDefault()
        if (event.shiftKey) ungroupSelection()
        else groupSelection()
        return
      }

      // ⌘⇧] and ⌘⇧[ — the keys Keynote and Figma use for front and back. By code,
      // because with Shift held `key` is `}` or `{` on some layouts and not others.
      if (mod && event.shiftKey && (event.code === 'BracketRight' || event.code === 'BracketLeft')) {
        event.preventDefault()
        reorderSelection(event.code === 'BracketRight' ? 'front' : 'back')
        return
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        const current = selectionRef.current
        if (!current.nodes.size && !current.edges.size) return
        event.preventDefault()
        deleteSelection()
        return
      }

      if (event.key === 'Escape') {
        clear()
      }
    }

    surface.addEventListener('keydown', onKeyDown)
    return () => surface.removeEventListener('keydown', onKeyDown)
  }, [
    clear,
    deleteSelection,
    groupSelection,
    locked,
    redo,
    reorderSelection,
    selectAll,
    selectionRef,
    stateRef,
    surfaceRef,
    toggleLocked,
    undo,
    ungroupSelection,
  ])

}
