/**
 * notePreviewGeometry.ts — where note preview cards sit, and the strings between them.
 *
 * Note previews float above the document and are joined to their in-text marker by
 * a curve, so their layout is real geometry: clamping to the viewport, laying
 * children out beneath a parent, and drawing a quadratic path from card to anchor.
 *
 * Pure. The one DOM-bound helper, queryAnchorRect, stays in the component, next to
 * the live EditorView it reads from.
 */
import type { Note, NotePreviewSize, Point } from '../types'

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

/**
 * The part of a `DOMRect` this module reads. Declared structurally so a real
 * `DOMRect` from `getBoundingClientRect` and a plain object both fit — the preview
 * holds on to a rect across scrolls and compares it with the next one.
 */
export interface AnchorRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/**
 * What the hover preview is showing. `editorView` is a live ProseMirror `EditorView`
 * and is only ever compared by identity here — this module does not touch it, which
 * is what keeps it pure.
 */
export interface PreviewIdentity {
  note?: { id?: string } | null
  locked?: boolean
  editorView?: unknown
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

export const clampPosition = (
  position: Point,
  size: NotePreviewSize = { width: TILE_WIDTH, height: TILE_MIN_HEIGHT },
): Point => ({
  x: clamp(position.x, VIEWPORT_PADDING, window.innerWidth - size.width - VIEWPORT_PADDING),
  y: clamp(position.y, VIEWPORT_PADDING, window.innerHeight - size.height - VIEWPORT_PADDING),
})

/** Default root-card position beside the anchor: right of it when there's room, else left. */
export const getInitialTilePosition = (
  anchorRect: AnchorRect,
  tileWidth: number = TILE_WIDTH,
  tileHeight: number = TILE_MIN_HEIGHT,
): Point => {
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

export const getDotPoint = (anchorRect: AnchorRect): Point => ({
  x: anchorRect.left + anchorRect.width / 2,
  y: anchorRect.top + anchorRect.height / 2,
})

export const getCardCenter = (
  position: Point,
  size: NotePreviewSize = { width: TILE_WIDTH, height: TILE_MIN_HEIGHT },
): Point => ({
  x: position.x + size.width / 2,
  y: position.y + size.height / 2,
})

export const getDefaultChildOffset = (
  index: number,
  total: number,
): { offsetX: number; offsetY: number } => ({
  offsetX: (index - (total - 1) / 2) * 48 + CHILD_OFFSET_X,
  offsetY: CHILD_OFFSET_Y,
})

/** Quadratic bezier "string" between two points, bowing upward with distance. */
export const getCurvePath = (fromPoint: Point, toPoint: Point): string => {
  const distance = Math.hypot(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y)
  const sway = clamp(distance * 0.12, 18, 70)
  const controlPoint = {
    x: (fromPoint.x + toPoint.x) / 2,
    y: (fromPoint.y + toPoint.y) / 2 - sway,
  }

  return `M ${fromPoint.x} ${fromPoint.y} Q ${controlPoint.x} ${controlPoint.y} ${toPoint.x} ${toPoint.y}`
}

export const isSamePreviewIdentity = (
  left: PreviewIdentity | null | undefined,
  right: PreviewIdentity | null | undefined,
): boolean => {
  if (left === right) return true
  if (!left || !right) return false

  return (
    left.note?.id === right.note?.id &&
    left.locked === right.locked &&
    left.editorView === right.editorView
  )
}

export const isDragEdge = (clientX: number, clientY: number, rect: AnchorRect): boolean => (
  clientX - rect.left <= EDGE_GRAB_THRESHOLD ||
  rect.right - clientX <= EDGE_GRAB_THRESHOLD ||
  clientY - rect.top <= EDGE_GRAB_THRESHOLD ||
  rect.bottom - clientY <= EDGE_GRAB_THRESHOLD
)

export const setPointerCaptureSafely = (target: Element | null | undefined, pointerId: number) => {
  try {
    target?.setPointerCapture?.(pointerId)
  } catch {
    // Pointer capture is a nice-to-have; window listeners still keep drag working.
  }
}

export const releasePointerCaptureSafely = (target: Element | null | undefined, pointerId: number) => {
  try {
    target?.releasePointerCapture?.(pointerId)
  } catch {
    // Ignore stale pointer ids after the drag has ended.
  }
}

export const addPointerDragListeners = (
  target: HTMLElement | null | undefined,
  handlePointerMove: (event: PointerEvent) => void,
  handlePointerUp: (event: PointerEvent) => void,
): (() => void) => {
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

export const hasStoredChildOffset = (note: Note | null | undefined): boolean => (
  Math.abs(note?.previewLayout?.offsetX || 0) > 1 ||
  Math.abs(note?.previewLayout?.offsetY || 0) > 1
)

export const collectDescendantIds = (
  childMap: Map<string, Note[]>,
  rootId: string,
): Set<string> => {
  const ids = new Set<string>()
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

export const areRectsEqual = (
  left: AnchorRect | null | undefined,
  right: AnchorRect | null | undefined,
): boolean => {
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
