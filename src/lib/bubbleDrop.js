/**
 * bubbleDrop.js — where a dragged bubble lands, and what landing there does.
 *
 * The bubble editor's hit-testing and drop rules, apart from the component so they can
 * be tested without a layout engine. Rects are client rects; `stage` is the editor's
 * own.
 */
import { clampAside, joinText } from './bubbleText'
import { project, velocityFrom } from '../ui/physics.js'

/**
 * How deep the shelf along the top is: a drop this close to the top sets the bubble
 * aside. The editor keeps the sentence out of it (`--bubble-shelf`, BubbleEditor.css).
 */
export const SHELF_DEPTH = 88
/** How far a set-aside bubble rests from the top and sides of the editor. */
export const SHELF_MARGIN = 18
export const ROW_GAP = 12

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

/** Whether a point is over the shelf along the top, where a drop sets a bubble aside. */
export const nearShelf = (stage, y) => y - stage.top < SHELF_DEPTH

/**
 * Where a bubble set aside at `x` rests: on the shelf, as far along it as it was put,
 * kept inside the editor. Only the top, so the sentence can use the whole width of a
 * narrow pane.
 */
export const shelfPoint = (stage, x, size) => {
  const halfW = size.width / 2
  const minX = SHELF_MARGIN + halfW
  const maxX = Math.max(minX, stage.width - SHELF_MARGIN - halfW)
  const cy = Math.min(SHELF_MARGIN + size.height / 2, stage.height / 2)
  return { x: clamp(x - stage.left, minX, maxX) / stage.width, y: cy / stage.height }
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

/** A drag's speed at `at`, the release (the last move by default). */
export const velocityOf = (samples, at = samples[samples.length - 1]?.t) => velocityFrom(samples, undefined, at)

/* ---------------- throwing ---------------- */

/** A release whose projection lands this far from the pointer is a throw. */
export const THROW_REACH = 160

/**
 * Where a bubble released at `point` moving at `velocity` (px/ms) lands, when that is a
 * throw up onto the shelf: where it would coast to under friction (`project`), kept
 * inside the stage, more than `THROW_REACH` away, and over the shelf. Otherwise null —
 * it lands where it was let go.
 */
export const throwLanding = (stage, point, velocity) => {
  const x = clamp(point.x + project(velocity.x), stage.left, stage.right)
  const y = clamp(point.y + project(velocity.y), stage.top, stage.bottom)
  if (Math.hypot(x - point.x, y - point.y) <= THROW_REACH) return null
  return nearShelf(stage, y) ? { x, y } : null
}

/* ---------------- swiping between forms ---------------- */

/** How far two fingers must travel sideways to turn to the next form. */
export const SWIPE_DISTANCE = 140
/** Movement before a two-finger gesture is judged sideways or not. */
export const SWIPE_LOCK = 12
/** A flick turns the page short of the distance: this fast (px/ms) at the end, this far. */
export const FLICK_SPEED = 0.45
export const FLICK_DISTANCE = 36
/** How far back in a gesture its speed at the end is measured. */
export const FLICK_WINDOW_MS = 100

/**
 * Which way the form turns when a sideways swipe ends: +1 to the next form (the fingers
 * went left), -1 to the previous, 0 not at all. `travel` is how far the fingers went
 * (negative is leftward); `samples` are `{ t, x }`, x being the travel so far.
 * (BubbleFormsBar.swift: far enough, or a flick that way.)
 */
export const decideFormSwipe = (travel, samples = []) => {
  if (Math.abs(travel) >= SWIPE_DISTANCE) return travel < 0 ? 1 : -1
  if (Math.abs(travel) < FLICK_DISTANCE || samples.length < 2) return 0
  const last = samples[samples.length - 1]
  const first = samples.find((sample) => last.t - sample.t <= FLICK_WINDOW_MS) ?? samples[0]
  if (last.t <= first.t) return 0
  const speed = (last.x - first.x) / (last.t - first.t)
  if (Math.abs(speed) < FLICK_SPEED || (speed < 0) !== (travel < 0)) return 0
  return travel < 0 ? 1 : -1
}

/**
 * How far the bubbles follow a swipe: less and less the further it goes, and much less
 * where there is no form that way to turn to.
 */
export const swipeOffset = (travel, possible = true) => {
  const reach = possible ? 220 : 40
  return Math.sign(travel) * reach * (1 - Math.exp(-Math.abs(travel) / reach))
}
