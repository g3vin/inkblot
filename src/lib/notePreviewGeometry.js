/**
 * notePreviewGeometry.js — where note preview cards sit, and the strings between them.
 *
 * Note previews float above the document and are joined to their in-text marker by
 * a curve, so their layout is real geometry: clamping to the viewport, laying
 * children out beneath a parent, and drawing a quadratic path from card to anchor.
 *
 * Pure. The one DOM-bound helper, queryAnchorRect, stays in the component, next to
 * the live EditorView it reads from.
 */
export const TILE_WIDTH = 260
export const TILE_MIN_HEIGHT = 88
export const TILE_MIN_RESIZE_WIDTH = 220
export const TILE_MIN_RESIZE_HEIGHT = 64
export const VIEWPORT_PADDING = 20
export const HIDE_DELAY_MS = 110
export const EDGE_GRAB_THRESHOLD = 18
export const DRAG_MIN_DELTA = 3
export const CHILD_OFFSET_X = 0
export const CHILD_OFFSET_Y = 184

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export const clampPosition = (position, size = { width: TILE_WIDTH, height: TILE_MIN_HEIGHT }) => ({
  x: clamp(position.x, VIEWPORT_PADDING, window.innerWidth - size.width - VIEWPORT_PADDING),
  y: clamp(position.y, VIEWPORT_PADDING, window.innerHeight - size.height - VIEWPORT_PADDING),
})

/** Default root-card position beside the anchor: right of it when there's room, else left. */
export const getInitialTilePosition = (anchorRect, tileWidth = TILE_WIDTH, tileHeight = TILE_MIN_HEIGHT) => {
  const prefersRight = anchorRect.right + tileWidth + 28 <= window.innerWidth - VIEWPORT_PADDING
  const x = prefersRight
    ? anchorRect.right + 22
    : anchorRect.left - tileWidth - 22
  const y = clamp(
    anchorRect.top - tileHeight * 0.3,
    VIEWPORT_PADDING,
    window.innerHeight - tileHeight - VIEWPORT_PADDING
  )

  return {
    x: clamp(x, VIEWPORT_PADDING, window.innerWidth - tileWidth - VIEWPORT_PADDING),
    y,
  }
}

export const getDotPoint = (anchorRect) => ({
  x: anchorRect.left + anchorRect.width / 2,
  y: anchorRect.top + anchorRect.height / 2,
})

export const getCardCenter = (position, size = { width: TILE_WIDTH, height: TILE_MIN_HEIGHT }) => ({
  x: position.x + size.width / 2,
  y: position.y + size.height / 2,
})

export const getDefaultChildOffset = (index, total) => ({
  offsetX: (index - (total - 1) / 2) * 48 + CHILD_OFFSET_X,
  offsetY: CHILD_OFFSET_Y,
})

/** Quadratic bezier "string" between two points, bowing upward with distance. */
export const getCurvePath = (fromPoint, toPoint) => {
  const distance = Math.hypot(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y)
  const sway = clamp(distance * 0.12, 18, 70)
  const controlPoint = {
    x: (fromPoint.x + toPoint.x) / 2,
    y: (fromPoint.y + toPoint.y) / 2 - sway,
  }

  return `M ${fromPoint.x} ${fromPoint.y} Q ${controlPoint.x} ${controlPoint.y} ${toPoint.x} ${toPoint.y}`
}

export const isSamePreviewIdentity = (left, right) => {
  if (left === right) return true
  if (!left || !right) return false

  return (
    left.note?.id === right.note?.id &&
    left.locked === right.locked &&
    left.editorView === right.editorView
  )
}

export const isDragEdge = (clientX, clientY, rect) => (
  clientX - rect.left <= EDGE_GRAB_THRESHOLD ||
  rect.right - clientX <= EDGE_GRAB_THRESHOLD ||
  clientY - rect.top <= EDGE_GRAB_THRESHOLD ||
  rect.bottom - clientY <= EDGE_GRAB_THRESHOLD
)

export const setPointerCaptureSafely = (target, pointerId) => {
  try {
    target?.setPointerCapture?.(pointerId)
  } catch {
    // Pointer capture is a nice-to-have; window listeners still keep drag working.
  }
}

export const releasePointerCaptureSafely = (target, pointerId) => {
  try {
    target?.releasePointerCapture?.(pointerId)
  } catch {
    // Ignore stale pointer ids after the drag has ended.
  }
}

export const addPointerDragListeners = (target, handlePointerMove, handlePointerUp) => {
  window.addEventListener('pointermove', handlePointerMove, true)
  window.addEventListener('pointerup', handlePointerUp, true)
  target?.addEventListener?.('pointermove', handlePointerMove, true)
  target?.addEventListener?.('pointerup', handlePointerUp, true)

  return () => {
    window.removeEventListener('pointermove', handlePointerMove, true)
    window.removeEventListener('pointerup', handlePointerUp, true)
    target?.removeEventListener?.('pointermove', handlePointerMove, true)
    target?.removeEventListener?.('pointerup', handlePointerUp, true)
  }
}

export const hasStoredChildOffset = (note) => (
  Math.abs(note?.previewLayout?.offsetX || 0) > 1 ||
  Math.abs(note?.previewLayout?.offsetY || 0) > 1
)

export const collectDescendantIds = (childMap, rootId) => {
  const ids = new Set()
  const stack = [...(childMap.get(rootId) || [])]

  while (stack.length > 0) {
    const note = stack.pop()
    if (!note || ids.has(note.id)) continue
    ids.add(note.id)
    const children = childMap.get(note.id) || []
    children.forEach((child) => stack.push(child))
  }

  return ids
}

export const areRectsEqual = (left, right) => {
  if (left === right) return true
  if (!left || !right) return false

  return (
    left.left === right.left &&
    left.top === right.top &&
    left.right === right.right &&
    left.bottom === right.bottom &&
    left.width === right.width &&
    left.height === right.height
  )
}
