/**
 * usePeekDismiss — puts a hovering (peeked) sidebar away again.
 *
 * A sidebar peeked by the pointer at the window edge goes when the pointer leaves it
 * (the sidebar's own onMouseLeave). One that came up because something asked for it
 * (a note clicked with the inspector hidden) may never have had the pointer in it, so
 * it also goes on a click anywhere outside it, or Escape.
 */
import { useEffect } from 'react'

export default function usePeekDismiss(ref, peeked, onDismiss) {
  useEffect(() => {
    if (!peeked) return undefined
    const onPointerDown = (event) => {
      const panel = ref.current
      if (!panel || !(event.target instanceof Node)) return
      if (panel.contains(event.target)) return
      // Menus, popovers and dialogs opened from the sidebar are portaled out of it.
      if (event.target instanceof Element && event.target.closest('[role="menu"], [role="dialog"], [role="listbox"], .ib-popover, .ib-menu')) return
      onDismiss?.()
    }
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      onDismiss?.()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [ref, peeked, onDismiss])
}
