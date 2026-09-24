/**
 * bubbleDrop.js — where a dragged bubble lands, and what landing there does.
 *
 * The bubble editor's hit-testing and drop rules, apart from the component so they can
 * be tested without a layout engine. Rects are client rects; `stage` is the editor's
 * own. `native/…/Bubble/BubbleDrop.swift` makes the same decisions for the Swift
 * shell's editor.
 */
import { clampAside, joinText } from './bubbleText'

/** How close to an edge of the window a drop sets the bubble aside. */
export const EDGE_BAND = 88
/** How far a set-aside bubble rests from the edge it was put against. */
export const EDGE_MARGIN = 18
/** A set-aside bubble against the top edge rests below the editor's controls. */
export const TOP_CLEARANCE = 76
export const ROW_GAP = 10

export const findBubble = (present, id) =>
  present.words.find((word) => word.id === id) ?? present.aside.find((word) => word.id === id) ?? null

export const without = (present, id) => ({
  words: present.words.filter((word) => word.id !== id),
  aside: present.aside.filter((word) => word.id !== id),
})

/** What a drop does to the session. Pure: the reducer calls it. */
export const applyDrop = (present, id, target) => {
  const bubble = findBubble(present, id)
  if (!bubble || !target) return present
  const rest = without(present, id)
  switch (target.kind) {
    case 'trash':
      return rest
    case 'aside':
      return {
        words: rest.words,
        aside: [...rest.aside, clampAside({ id: bubble.id, text: bubble.text, x: target.x, y: target.y })],
      }
    case 'join': {
      const merge = (word) => (word.id !== target.id ? word : {
        ...word,
        text: target.before ? joinText(bubble.text, word.text) : joinText(word.text, bubble.text),
      })
      return { words: rest.words.map(merge), aside: rest.aside.map(merge) }
    }
    case 'insert': {
      const words = rest.words.slice()
      words.splice(Math.max(0, Math.min(target.index, words.length)), 0, { id: bubble.id, text: bubble.text })
      return { words, aside: rest.aside }
    }
    default:
      return present
  }
}

export const inside = (rect, x, y, pad = 0) =>
  x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad

/** How close two bubbles' edges must come to count as touching. */
export const TOUCH_SLACK = 4

/**
 * The bubble a dragged bubble is touching, which a drop joins it to — or null.
 *
 * Joining is touching: a bubble brought up against another merges with it, on the side
 * it touched ("best" touching "thing" from its left makes "best thing"). A bubble held
 * over the gap between two others touches both, and goes between them instead — unless
 * it is pressed much further into one than the other. `rect` is the dragged bubble's.
 */
export const touchTarget = (rect, items) => {
  const touches = []
  for (const item of items) {
    const across = Math.min(rect.right, item.rect.right) - Math.max(rect.left, item.rect.left)
    const down = Math.min(rect.bottom, item.rect.bottom) - Math.max(rect.top, item.rect.top)
    if (across < -TOUCH_SLACK) continue
    if (down < 0.3 * Math.min(rect.bottom - rect.top, item.rect.bottom - item.rect.top)) continue
    touches.push({ item, weight: across + TOUCH_SLACK })
  }
  if (!touches.length) return null
  touches.sort((a, b) => b.weight - a.weight)
  if (touches.length > 1 && touches[0].weight < 2 * touches[1].weight) return null
  const { item } = touches[0]
  const center = (r) => (r.left + r.right) / 2
  return { id: item.id, before: center(rect) < center(item.rect) }
}

/** How far past a gap's edges a pinch still counts as over it. */
export const GAP_REACH = 16

/**
 * The gap in the sentence a point is over, as the index of the bubble before it — or
 * -1. `row` is the sentence's bubbles in order; a gap is only between two on one line.
 * Where two gaps are in reach, the nearer one.
 */
export const gapAt = (row, x, y) => {
  let best = -1
  let bestDistance = Infinity
  for (let index = 0; index + 1 < row.length; index += 1) {
    const a = row[index].rect
    const b = row[index + 1].rect
    if (Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) > (a.bottom - a.top) / 2) continue
    if (y < Math.min(a.top, b.top) - 8 || y > Math.max(a.bottom, b.bottom) + 8) continue
    if (x < a.right - GAP_REACH || x > b.left + GAP_REACH) continue
    const distance = Math.abs(x - (a.right + b.left) / 2)
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  }
  return best
}

/** The bubble a point is over, or null. */
export const bubbleAt = (items, x, y) => items.find((item) => inside(item.rect, x, y)) ?? null

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export const nearEdge = (stage, x, y) =>
  x - stage.left < EDGE_BAND || stage.right - x < EDGE_BAND
  || y - stage.top < EDGE_BAND || stage.bottom - y < EDGE_BAND

/** Where a bubble set aside at (x, y) rests: against the nearest edge, where it was put. */
export const asidePoint = (stage, x, y, size) => {
  const localX = x - stage.left
  const localY = y - stage.top
  const halfW = size.width / 2
  const halfH = size.height / 2
  const minX = EDGE_MARGIN + halfW
  const maxX = Math.max(minX, stage.width - EDGE_MARGIN - halfW)
  const minY = EDGE_MARGIN + halfH
  const maxY = Math.max(minY, stage.height - EDGE_MARGIN - halfH)
  const distances = {
    left: localX,
    right: stage.width - localX,
    top: localY,
    bottom: stage.height - localY,
  }
  const edge = Object.keys(distances).reduce((best, key) => (distances[key] < distances[best] ? key : best))
  let cx = clamp(localX, minX, maxX)
  let cy = clamp(localY, Math.max(minY, TOP_CLEARANCE + halfH), maxY)
  if (edge === 'left') cx = minX
  if (edge === 'right') cx = maxX
  if (edge === 'top') cy = Math.min(maxY, TOP_CLEARANCE + halfH)
  if (edge === 'bottom') cy = maxY
  return { x: cx / stage.width, y: cy / stage.height }
}

/** Which slot of the sentence a pointer is over, and where to draw the caret for it. */
export const insertion = (geometry, x, y) => {
  const { row, rowRect, stage } = geometry
  if (!row.length) {
    return {
      index: 0,
      caret: { left: rowRect.left + rowRect.width / 2 - stage.left, top: rowRect.top - stage.top, height: 44 },
    }
  }
  const lines = []
  row.forEach((item, index) => {
    const line = lines.find((candidate) => Math.abs(candidate.top - item.rect.top) < item.rect.height / 2)
    if (line) {
      line.items.push({ ...item, index })
      line.bottom = Math.max(line.bottom, item.rect.bottom)
    } else {
      lines.push({ top: item.rect.top, bottom: item.rect.bottom, items: [{ ...item, index }] })
    }
  })
  let best = lines[0]
  let bestDistance = Infinity
  for (const line of lines) {
    const distance = y < line.top ? line.top - y : y > line.bottom ? y - line.bottom : 0
    if (distance < bestDistance) {
      best = line
      bestDistance = distance
    }
  }
  const next = best.items.find((item) => x < item.rect.left + item.rect.width / 2)
  if (next) {
    return {
      index: next.index,
      caret: { left: next.rect.left - ROW_GAP / 2 - stage.left, top: next.rect.top - stage.top, height: next.rect.height },
    }
  }
  const last = best.items[best.items.length - 1]
  return {
    index: last.index + 1,
    caret: { left: last.rect.right + ROW_GAP / 2 - stage.left, top: last.rect.top - stage.top, height: last.rect.height },
  }
}

export const velocityOf = (samples) => {
  if (samples.length < 2) return { x: 0, y: 0 }
  const last = samples[samples.length - 1]
  const first = samples.find((sample) => last.t - sample.t <= 90) ?? samples[0]
  const dt = Math.max(1, last.t - first.t)
  return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt }
}
