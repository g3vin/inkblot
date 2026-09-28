/**
 * usePointerReorder — drag to reorder, with pointer events.
 *
 * Tauri swallows the HTML5 drop event (see useFileTreeDrag), so a drag is tracked by
 * hand: pointer capture on the item, document.elementFromPoint to find what is under
 * the pointer, and an insertion index from the midpoints of the items in the list.
 *
 *   const { dragging, ghost, insertIndex, onPointerDown } = usePointerReorder({
 *     listRef, itemSelector: '[data-reorder-id]', axis: 'x',
 *     onDrop: ({ id, index, inside }) => …,
 *   })
 *
 * `inside` is false when the pointer was let go outside the list: the caller decides
 * whether that removes the item (the toolbar does) or cancels (everything else).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const DRAG_THRESHOLD = 4

/**
 * Where an item dropped at `point` goes among items with these rects (in order):
 * before the first whose midpoint is past the point, else at the end.
 */
export function insertionIndex(point, rects, axis = 'x') {
  const along = axis === 'x' ? point.x : point.y
  for (let i = 0; i < rects.length; i += 1) {
    const r = rects[i]
    const mid = axis === 'x' ? r.left + r.width / 2 : r.top + r.height / 2
    if (along < mid) return i
  }
  return rects.length
}

/** A list with `id` moved to `index` (an index into the list as it was, id included). */
export function moveTo(list, id, index) {
  const from = list.indexOf(id)
  const without = list.filter((item) => item !== id)
  let at = Math.max(0, Math.min(index, list.length))
  if (from !== -1 && from < at) at -= 1
  without.splice(Math.min(at, without.length), 0, id)
  return without
}

const within = (rect, point, slop = 0) => point.x >= rect.left - slop && point.x <= rect.right + slop
  && point.y >= rect.top - slop && point.y <= rect.bottom + slop

export default function usePointerReorder({ listRef, itemSelector = '[data-reorder-id]', axis = 'x', onDrop, onMove, slop = 12, disabled = false }) {
  const [drag, setDrag] = useState(null)
  const dragRef = useRef(null)
  const handlers = useRef({ onDrop, onMove })
  useEffect(() => { handlers.current = { onDrop, onMove } }, [onDrop, onMove])

  const measure = useCallback((excludeId) => {
    const list = listRef.current
    if (!list) return { rects: [], listRect: null }
    const items = [...list.querySelectorAll(itemSelector)].filter((el) => el.dataset.reorderId !== excludeId)
    return { rects: items.map((el) => el.getBoundingClientRect()), listRect: list.getBoundingClientRect() }
  }, [listRef, itemSelector])

  const update = useCallback((point) => {
    const current = dragRef.current
    if (!current) return
    const { rects, listRect } = measure(current.id)
    const inside = Boolean(listRect && within(listRect, point, slop))
    const index = inside ? insertionIndex(point, rects, axis) : null
    const next = { ...current, point, inside, insertIndex: index, started: true }
    dragRef.current = next
    setDrag(next)
    handlers.current.onMove?.(next)
  }, [axis, measure, slop])

  /**
   * Start tracking from a pointerdown on an item. `id` is the item's id; pass
   * `external` for an item that comes from outside the list (a palette), so a drop
   * inserts rather than moves.
   */
  const onPointerDown = useCallback((event, id, { external = false, payload } = {}) => {
    if (disabled || event.button !== 0) return
    const origin = { x: event.clientX, y: event.clientY }
    dragRef.current = { id, external, payload, origin, point: origin, started: false, inside: !external, insertIndex: null }

    const move = (e) => {
      const point = { x: e.clientX, y: e.clientY }
      const current = dragRef.current
      if (!current) return
      if (!current.started && Math.hypot(point.x - origin.x, point.y - origin.y) < DRAG_THRESHOLD) return
      e.preventDefault()
      update(point)
    }
    const end = (e) => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', cancel, true)
      const current = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!current?.started) return
      e.preventDefault()
      const { rects } = measure(current.id)
      const point = { x: e.clientX, y: e.clientY }
      const listRect = listRef.current?.getBoundingClientRect()
      const inside = Boolean(listRect && within(listRect, point, slop))
      handlers.current.onDrop?.({
        id: current.id,
        external: current.external,
        payload: current.payload,
        inside,
        index: inside ? insertionIndex(point, rects, axis) : null,
        point,
      })
    }
    const cancel = () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', cancel, true)
      dragRef.current = null
      setDrag(null)
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', cancel, true)
  }, [axis, disabled, listRef, measure, slop, update])

  useEffect(() => () => { dragRef.current = null }, [])

  return {
    dragging: drag?.started ? drag.id : null,
    ghost: drag?.started ? drag.point : null,
    insertIndex: drag?.started ? drag.insertIndex : null,
    inside: drag?.started ? drag.inside : false,
    external: drag?.external ?? false,
    onPointerDown,
  }
}
