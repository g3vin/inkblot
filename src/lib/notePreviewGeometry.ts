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
/** How close a note may come to the window's edge: the gap the document card keeps from
 *  it, where the tray shows (--space-3). */
export const VIEWPORT_PADDING = 8
export const HIDE_DELAY_MS = 110
/** How far in from a card's edge a press resizes it, from that edge or corner. */
export const RESIZE_GRIP = 6
/** The band across a card's top that moves it, as a window's titlebar does. */
export const MOVE_BAND = 28
export const DRAG_MIN_DELTA = 3
/** Leaving a note's dot or card: how far the pointer may drift back from every card
 *  before they close, and how long it may pause on the way to one. */
export const HOVER_INTENT_SLACK = 6
export const HOVER_INTENT_STALL_MS = 450
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

export interface PreviewIdentity {
  note?: { id?: string } | null
  locked?: boolean
  editorView?: unknown
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

/** A rect, as a card's position and size. */
export interface Box { x: number; y: number; width: number; height: number }

/**
 * Keep a card inside the window, VIEWPORT_PADDING in from every edge, and out of any
 * `keepOut` box (the traffic lights): a card that would overlap one is pushed out of
 * it whichever way is shorter, down or right.
 */
export const clampPosition = (
  position: Point,
  size: NotePreviewSize = { width: TILE_WIDTH, height: TILE_MIN_HEIGHT },
  keepOut: Box[] = [],
): Point => {
  const inWindow = (point: Point): Point => ({
    x: clamp(point.x, VIEWPORT_PADDING, window.innerWidth - size.width - VIEWPORT_PADDING),
    y: clamp(point.y, VIEWPORT_PADDING, window.innerHeight - size.height - VIEWPORT_PADDING),
  })
  let next = inWindow(position)
  keepOut.forEach((box) => {
    const overlaps = next.x < box.x + box.width && next.x + size.width > box.x
      && next.y < box.y + box.height && next.y + size.height > box.y
    if (!overlaps) return
    const down = box.y + box.height - next.y
    const right = box.x + box.width - next.x
    next = inWindow(down <= right ? { x: next.x, y: box.y + box.height } : { x: box.x + box.width, y: next.y })
  })
  return next
}

/** The room left between a new note and its parent, and around the notes it avoids. */
export const OPEN_SPOT_GAP = 40

/**
 * Where a new note goes beside `parent`: the first place, nearest first, where it
 * overlaps none of `others` (with OPEN_SPOT_GAP around them), stays in the window and
 * out of `keepOut`. Below the parent first, then down and to either side, to the
 * right, to the left and above; each further out in turn. Its top-left corner, or
 * straight below the parent if there is no room anywhere.
 */
export const findOpenSpot = (parent: Box, size: NotePreviewSize, others: Box[], keepOut: Box[] = []): Point => {
  const gap = OPEN_SPOT_GAP
  const fits = (point: Point) => {
    if (point.x < VIEWPORT_PADDING || point.y < VIEWPORT_PADDING) return false
    if (point.x + size.width > window.innerWidth - VIEWPORT_PADDING) return false
    if (point.y + size.height > window.innerHeight - VIEWPORT_PADDING) return false
    const clear = (box: Box, room: number) => (
      point.x >= box.x + box.width + room || point.x + size.width + room <= box.x
      || point.y >= box.y + box.height + room || point.y + size.height + room <= box.y
    )
    return others.every((box) => clear(box, gap / 2)) && keepOut.every((box) => clear(box, 0))
  }
  const below = parent.y + parent.height + gap
  const above = parent.y - gap - size.height
  const right = parent.x + parent.width + gap
  const left = parent.x - gap - size.width
  for (let ring = 0; ring < 6; ring += 1) {
    const down = ring * (size.height + gap)
    const across = ring * (size.width + gap)
    const candidates: Point[] = [
      { x: parent.x, y: below + down },
      { x: parent.x + (size.width + gap) * (ring + 1), y: below },
      { x: parent.x - (size.width + gap) * (ring + 1), y: below },
      { x: right + across, y: parent.y },
      { x: left - across, y: parent.y },
      { x: parent.x, y: above - down },
    ]
    const spot = candidates.find(fits)
    if (spot) return spot
  }
  return { x: parent.x, y: below }
}

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

const insideBox = (point: Point, box: Box): boolean => (
  point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height
)

/**
 * A string from one note to the next: the same curve as getCurvePath between their
 * centres, but only the part between the cards, from where it leaves `fromBox` (none
 * for the dot in the text) to where it reaches `toBox`. So all of it shows as it
 * draws, and `end` is where it touches the note, which grows from there.
 */
export const getStringPath = (fromPoint: Point, toPoint: Point, fromBox: Box | null, toBox: Box) => {
  const distance = Math.hypot(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y)
  const sway = clamp(distance * 0.12, 18, 70)
  const p0 = fromPoint
  const p1 = { x: (fromPoint.x + toPoint.x) / 2, y: (fromPoint.y + toPoint.y) / 2 - sway }
  const p2 = toPoint
  const at = (t: number): Point => ({
    x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x,
    y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y,
  })
  // The first t where `inside` changes, by stepping then halving.
  const edge = (from: number, to: number, inside: (t: number) => boolean): number => {
    const steps = 48
    const start = inside(from)
    let lo = from
    let hi = to
    for (let i = 1; i <= steps; i += 1) {
      const t = from + ((to - from) * i) / steps
      if (inside(t) !== start) { hi = t; break }
      lo = t
      if (i === steps) return to
    }
    for (let i = 0; i < 20; i += 1) {
      const mid = (lo + hi) / 2
      if (inside(mid) === start) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }
  const t0 = fromBox && insideBox(p0, fromBox) ? edge(0, 1, (t) => insideBox(at(t), fromBox)) : 0
  const t1 = insideBox(p2, toBox) ? edge(t0, 1, (t) => insideBox(at(t), toBox)) : 1
  const start = at(t0)
  const end = at(t1)
  // The piece of a quadratic between t0 and t1 is a quadratic; this is its control point.
  const control = {
    x: (1 - t0) * (1 - t1) * p0.x + ((1 - t0) * t1 + t0 * (1 - t1)) * p1.x + t0 * t1 * p2.x,
    y: (1 - t0) * (1 - t1) * p0.y + ((1 - t0) * t1 + t0 * (1 - t1)) * p1.y + t0 * t1 * p2.y,
  }
  // Its length, near enough, from points along it: a longer string takes longer to draw.
  let length = 0
  let previous = start
  for (let i = 1; i <= 24; i += 1) {
    const point = at(t0 + ((t1 - t0) * i) / 24)
    length += Math.hypot(point.x - previous.x, point.y - previous.y)
    previous = point
  }
  return { d: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`, start, end, length }
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

/** How far a point is from a rect: 0 inside it. */
export const distanceToRect = (x: number, y: number, rect: AnchorRect): number => {
  const dx = Math.max(rect.left - x, 0, x - rect.right)
  const dy = Math.max(rect.top - y, 0, y - rect.bottom)
  return Math.hypot(dx, dy)
}

/**
 * Hover intent, for a pointer that has left a note's dot or card: it is still on its
 * way while it is getting closer to any of `targets`, and has gone once it is further
 * from all of them than it has been (by more than the slack). `nearest` holds each
 * target's closest distance so far, and is updated.
 */
export const hoverIntent = (x: number, y: number, targets: AnchorRect[], nearest: number[]): 'approaching' | 'away' | 'idle' => {
  let approaching = false
  let away = true
  targets.forEach((rect, i) => {
    const d = distanceToRect(x, y, rect)
    const best = nearest[i] ?? Infinity
    if (d < best - 0.5) approaching = true
    if (d <= best + HOVER_INTENT_SLACK) away = false
    nearest[i] = Math.min(best, d)
  })
  if (away) return 'away'
  return approaching ? 'approaching' : 'idle'
}

/** Which edges a resize moves: some of n, s, e and w, as 'se' or 'n'. */
export type ResizeEdges = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export type CardGrip = ResizeEdges | 'move' | null

/**
 * What a press at this point on a card does: an edge or corner resizes it (a corner
 * reaches a little further in, so it is easy to catch), the band across the top moves
 * it, and anywhere else is the note's own content.
 */
export const getCardGrip = (clientX: number, clientY: number, rect: AnchorRect): CardGrip => {
  const corner = RESIZE_GRIP * 2
  const nearTop = clientY - rect.top
  const nearBottom = rect.bottom - clientY
  const nearLeft = clientX - rect.left
  const nearRight = rect.right - clientX
  const atCorner = (a: number, b: number) => a <= corner && b <= corner && (a <= RESIZE_GRIP || b <= RESIZE_GRIP)
  if (atCorner(nearTop, nearLeft)) return 'nw'
  if (atCorner(nearTop, nearRight)) return 'ne'
  if (atCorner(nearBottom, nearLeft)) return 'sw'
  if (atCorner(nearBottom, nearRight)) return 'se'
  if (nearTop <= RESIZE_GRIP) return 'n'
  if (nearBottom <= RESIZE_GRIP) return 's'
  if (nearLeft <= RESIZE_GRIP) return 'w'
  if (nearRight <= RESIZE_GRIP) return 'e'
  if (nearTop <= MOVE_BAND) return 'move'
  return null
}

/**
 * A card's box after its `edges` are dragged by (dx, dy): the far edges stay put, and
 * it is never smaller than the minimum or pushed past the viewport's padding.
 */
export const resizeCardBox = (
  box: { x: number; y: number; width: number; height: number },
  edges: ResizeEdges,
  dx: number,
  dy: number,
  viewport: { width: number; height: number },
) => {
  let { x, y, width, height } = box
  const right = x + width
  const bottom = y + height
  if (edges.includes('e')) width = Math.min(Math.max(TILE_MIN_RESIZE_WIDTH, width + dx), viewport.width - VIEWPORT_PADDING - x)
  if (edges.includes('s')) height = Math.min(Math.max(TILE_MIN_RESIZE_HEIGHT, height + dy), viewport.height - VIEWPORT_PADDING - y)
  if (edges.includes('w')) {
    x = Math.min(Math.max(VIEWPORT_PADDING, x + dx), right - TILE_MIN_RESIZE_WIDTH)
    width = right - x
  }
  if (edges.includes('n')) {
    y = Math.min(Math.max(VIEWPORT_PADDING, y + dy), bottom - TILE_MIN_RESIZE_HEIGHT)
    height = bottom - y
  }
  return { x, y, width, height }
}

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

/**
 * How high each card in a branch stacks: a card sits lower the more strings lie between
 * it and the focus (the held card, or the root when none is), so the focus is on top,
 * parents cover their children, and a held card's ancestors and descendants fall away
 * from it a step at a time on either side.
 */
export const getStackOrder = (
  notes: Array<Pick<Note, 'id' | 'parentNoteId'>>,
  focusId: string | null | undefined,
): Map<string, number> => {
  const parentOf = new Map(notes.map((note) => [note.id, note.parentNoteId || null]))
  const chainOf = (id: string) => {
    const chain: string[] = []
    for (let at: string | null | undefined = id; at && parentOf.has(at) && !chain.includes(at); at = parentOf.get(at)) {
      chain.push(at)
    }
    return chain
  }
  const root = notes.find((note) => !note.parentNoteId || !parentOf.has(note.parentNoteId))?.id
  const focus = focusId && parentOf.has(focusId) ? focusId : root
  const focusChain = focus ? chainOf(focus) : []
  const stepsFromFocus = new Map(focusChain.map((id, steps) => [id, steps]))

  const order = new Map<string, number>()
  notes.forEach((note) => {
    const chain = chainOf(note.id)
    const meet = chain.findIndex((id) => stepsFromFocus.has(id))
    const distance = meet < 0 ? chain.length + focusChain.length : meet + (stepsFromFocus.get(chain[meet]) ?? 0)
    order.set(note.id, notes.length - distance)
  })
  return order
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
