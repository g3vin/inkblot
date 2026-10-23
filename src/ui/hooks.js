/**
 * hooks.js — the behaviour every floating or keyboard-driven primitive shares.
 *
 *   useDismiss         close on Escape or a pointer-down outside
 *   useFocusTrap       keep Tab inside a dialog; restore focus on close
 *   trapTab            keep one Tab keypress inside a container (dialogs, popovers)
 *   useRovingFocus     arrow keys / Home / End / typeahead across a list of items
 *   useAnchoredPosition place a floating element beside its anchor, kept on screen
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** What can take focus with Tab. */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',')

export const focusableWithin = (root) =>
  root ? [...root.querySelectorAll(FOCUSABLE_SELECTOR)].filter((el) => !el.closest('[inert]') && el.offsetParent !== null) : []

/**
 * Call `onDismiss` on Escape or on a pointer-down outside every ref in `refs`.
 * @param {boolean} active
 * @param {() => void} onDismiss
 * @param {React.RefObject<HTMLElement>[]} refs  inside these, a click is not "outside"
 */
export function useDismiss(active, onDismiss, refs) {
  const onDismissRef = useRef(onDismiss)
  useEffect(() => { onDismissRef.current = onDismiss })

  useEffect(() => {
    if (!active) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onDismissRef.current?.()
      }
    }
    const onPointer = (event) => {
      const inside = refs.some((ref) => ref.current?.contains(event.target))
      if (!inside) onDismissRef.current?.()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointer, true)
    }
    // refs are stable ref objects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}

/**
 * If `event` is a Tab that would leave `container`, wrap it round to the other end.
 * Only what Tab reaches counts: a roving group (a row of swatches) is one stop.
 */
export function trapTab(event, container) {
  if (event.key !== 'Tab') return
  const items = focusableWithin(container).filter((el) => el.tabIndex >= 0)
  if (items.length === 0) {
    event.preventDefault()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  const at = document.activeElement
  if (event.shiftKey && (at === first || !items.includes(at) && at === container)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && at === last) {
    event.preventDefault()
    first.focus()
  }
}

/**
 * While active: focus the first focusable (or `initialFocusRef`), wrap Tab inside
 * `containerRef`, and on deactivate return focus to whatever had it before.
 */
export function useFocusTrap(active, containerRef, initialFocusRef) {
  useEffect(() => {
    if (!active) return undefined
    const previouslyFocused = document.activeElement
    const container = containerRef.current
    const first = initialFocusRef?.current || focusableWithin(container)[0] || container
    first?.focus?.({ preventScroll: true })

    const onKey = (event) => { if (container) trapTab(event, container) }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus({ preventScroll: true })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable; the trap follows `active`
  }, [active])
}

/**
 * Roving focus over the items matched by `itemSelector` inside `containerRef`.
 * Returns an onKeyDown handler for the container.
 * @param {{ orientation?: 'vertical'|'horizontal', loop?: boolean, typeahead?: boolean }} [options]
 */
export function useRovingFocus(containerRef, itemSelector, options = {}) {
  const { orientation = 'vertical', loop = true, typeahead = true } = options
  const buffer = useRef({ text: '', timer: 0 })

  return useCallback((event) => {
    const container = containerRef.current
    if (!container) return
    const items = [...container.querySelectorAll(itemSelector)]
      .filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true')
    if (items.length === 0) return
    const index = items.indexOf(document.activeElement)
    const next = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'
    const prev = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'

    const focusAt = (i) => {
      const bounded = loop ? (i + items.length) % items.length : Math.max(0, Math.min(items.length - 1, i))
      items[bounded]?.focus()
    }

    if (event.key === next) { event.preventDefault(); focusAt(index < 0 ? 0 : index + 1) }
    else if (event.key === prev) { event.preventDefault(); focusAt(index < 0 ? items.length - 1 : index - 1) }
    else if (event.key === 'Home') { event.preventDefault(); focusAt(0) }
    else if (event.key === 'End') { event.preventDefault(); focusAt(items.length - 1) }
    else if (typeahead && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      window.clearTimeout(buffer.current.timer)
      buffer.current.text += event.key.toLowerCase()
      buffer.current.timer = window.setTimeout(() => { buffer.current.text = '' }, 500)
      const match = items.find((el) => el.textContent.trim().toLowerCase().startsWith(buffer.current.text))
      match?.focus()
    }
  }, [containerRef, itemSelector, orientation, loop, typeahead])
}

const VIEWPORT_MARGIN = 8

/**
 * Position `floatingRef` beside `anchorRef` (or a point) using fixed coordinates,
 * flipping to the other side when it would leave the viewport.
 * @param {boolean} open
 * @param {{ anchorRef?: React.RefObject<HTMLElement>, point?: {x:number,y:number},
 *   placement?: 'bottom-start'|'bottom-end'|'bottom'|'top-start'|'top-end'|'top'|'right-start'|'left-start',
 *   offset?: number }} options
 */
export function useAnchoredPosition(open, floatingRef, { anchorRef, point, placement = 'bottom-start', offset = 6 } = {}) {
  const [style, setStyle] = useState({ position: 'fixed', top: 0, left: 0, visibility: 'hidden' })

  const update = useCallback(() => {
    const floating = floatingRef.current
    if (!floating) return
    const rect = point
      ? { top: point.y, bottom: point.y, left: point.x, right: point.x, width: 0, height: 0 }
      : anchorRef?.current?.getBoundingClientRect()
    if (!rect) return
    const { width, height } = floating.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const [side, align = 'center'] = placement.split('-')

    let top
    let left
    if (side === 'bottom' || side === 'top') {
      top = side === 'bottom' ? rect.bottom + offset : rect.top - height - offset
      if (side === 'bottom' && top + height > vh - VIEWPORT_MARGIN && rect.top - height - offset > VIEWPORT_MARGIN) {
        top = rect.top - height - offset
      } else if (side === 'top' && top < VIEWPORT_MARGIN) {
        top = rect.bottom + offset
      }
      left = align === 'start' ? rect.left : align === 'end' ? rect.right - width : rect.left + rect.width / 2 - width / 2
    } else {
      left = side === 'right' ? rect.right + offset : rect.left - width - offset
      if (side === 'right' && left + width > vw - VIEWPORT_MARGIN) left = rect.left - width - offset
      if (side === 'left' && left < VIEWPORT_MARGIN) left = rect.right + offset
      top = align === 'start' ? rect.top : align === 'end' ? rect.bottom - height : rect.top + rect.height / 2 - height / 2
    }

    left = Math.min(Math.max(VIEWPORT_MARGIN, left), vw - width - VIEWPORT_MARGIN)
    top = Math.min(Math.max(VIEWPORT_MARGIN, top), vh - height - VIEWPORT_MARGIN)
    setStyle({ position: 'fixed', top: Math.round(top), left: Math.round(left), visibility: 'visible' })
  }, [anchorRef, floatingRef, placement, offset, point])

  useLayoutEffect(() => {
    if (!open) return undefined
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, update])

  return style
}

/**
 * Let `ref`'s element leave the way it came when its component unmounts: a copy is put
 * back in the body with `leavingClass`, plays that class's animation, and is removed.
 * The caller unmounts as usual and needs no "closing" state. Skipped under reduced
 * motion, and where there's no matchMedia (tests). The copy keeps no ids or roles. (Under
 * StrictMode's trial unmount the element is still in the page, so no copy is made.)
 */
export function useExitAnimation(ref, leavingClass = 'is-leaving') {
  useLayoutEffect(() => {
    const node = ref.current
    return () => {
      queueMicrotask(() => {
        if (!node || node.isConnected) return
        // No matchMedia means no real browser (tests); reduced motion means no motion.
        if (!window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
        const ghost = node.cloneNode(true)
        // A copy, not the thing: nothing in it can be found as a dialog or by its id.
        for (const el of [ghost, ...ghost.querySelectorAll('[id], [role]')]) { el.removeAttribute('id'); el.removeAttribute('role') }
        ghost.classList.add(leavingClass)
        ghost.setAttribute('aria-hidden', 'true')
        ghost.inert = true
        document.body.append(ghost)
        const done = () => ghost.remove()
        ghost.addEventListener('animationend', (event) => { if (event.target === ghost) done() })
        setTimeout(done, 400)
      })
    }
  }, [ref, leavingClass])
}
