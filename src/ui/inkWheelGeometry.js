/**
 * inkWheelGeometry.js — the arithmetic behind InkWheel, kept apart so it can be tested
 * without a DOM.
 *
 * Angles are in degrees, 0 at twelve o'clock and growing clockwise, the way the slots
 * are laid out and the way the eye reads them. Screen y grows downward.
 */

/** The gesture's tolerances, in CSS pixels and degrees. */
export const DEAD_ZONE = 8
export const HYSTERESIS = 6
/** A ring dot's drawn size, the middle dot's, and how far from a dot's centre a finger
 * or click still lands on it (a 44px target). */
export const DOT = 24
export const CENTRE = 28
export const HIT = 22

/** The ring's radius: wider for nine slots so the dots keep the same spacing. */
export const ringRadius = (count) => (count > 8 ? 60 : 52)

export const slotAngle = (index, count) => (360 / count) * index

export const slotOffset = (index, count, radius = ringRadius(count)) => {
  const rad = (slotAngle(index, count) * Math.PI) / 180
  return { x: Math.round(radius * Math.sin(rad) * 100) / 100, y: Math.round(-radius * Math.cos(rad) * 100) / 100 }
}

/** The angle of a point relative to the centre, 0–360, clockwise from twelve. */
export const angleOf = ({ x, y }) => ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360

const angularDistance = (a, b) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/**
 * The slot a direction points at, or null inside the dead zone. The current slot holds
 * until the direction is clearly past its edge, so a hand resting on a boundary doesn't
 * flicker between two inks.
 */
export const pickSlot = (point, count, current = null, { deadZone = DEAD_ZONE, hysteresis = HYSTERESIS } = {}) => {
  if (Math.hypot(point.x, point.y) < deadZone) return null
  const angle = angleOf(point)
  const width = 360 / count
  if (current !== null && current >= 0 && current < count
    && angularDistance(angle, slotAngle(current, count)) <= width / 2 + hysteresis) return current
  return Math.round(angle / width) % count
}

/*
 * The drag is measured in how far the hand has moved, not where the dots are drawn:
 * the held dot only gives a little (it never reaches the ring, so two dots at rest never
 * cover each other), and the ink it is heading for leans in to meet it.
 */

/** Hand travel that swaps the held colour with the ink ahead; back under this, it undoes. */
export const SWAP_AT = 28
export const UNSWAP_AT = 16
/** Hand travel past the swap is dropped, so pulling back starts undoing at once. */
export const REACH = 38
/** How far the held dot is drawn from the middle at most, and how far an ink leans in. */
export const HELD_MAX = 16
export const LEAN_MAX = 5
export const LEAN_GROW = 0.15

/**
 * Keep the hand's travel within reach. Movement past the edge is dropped rather than
 * stored, so turning back starts at once instead of unwinding.
 */
export const clampToReach = (point, limit = REACH) => {
  const length = Math.hypot(point.x, point.y)
  if (length <= limit) return point
  return { x: (point.x / length) * limit, y: (point.y / length) * limit }
}

/** Where the held dot is drawn for the hand's travel: on a band that stiffens. */
export const heldOffset = (point) => {
  const length = Math.hypot(point.x, point.y)
  if (!length) return { x: 0, y: 0 }
  const give = HELD_MAX * Math.tanh((length / SWAP_AT) * 1.2)
  return { x: (point.x / length) * give, y: (point.y / length) * give }
}

/**
 * How strongly an ink answers the hand, 0–1: by how far the hand has gone toward the
 * swap and how squarely it is aimed at that ink. Smooth in both, so as the aim drifts
 * from one ink to the next neither of them snaps.
 */
export const leanFor = (index, count, point) => {
  const length = Math.hypot(point.x, point.y)
  if (!length) return 0
  const aim = Math.cos(((angleOf(point) - slotAngle(index, count)) * Math.PI) / 180)
  return Math.min(1, length / SWAP_AT) * Math.max(0, aim) ** 4
}

/**
 * The drag's state after the hand has moved by `point`: the ink it is heading for, and
 * the one it has swapped with (null until the hand goes far enough). Pulling back past
 * UNSWAP_AT undoes the swap; swinging round while swapped trades it to the next ink.
 */
export const dragState = (point, count, previous = { target: null, swapped: null }) => {
  const target = pickSlot(point, count, previous.target)
  const distance = Math.hypot(point.x, point.y)
  let swapped = previous.swapped
  if (target === null || distance < UNSWAP_AT) swapped = null
  else if (distance >= SWAP_AT || swapped !== null) swapped = target
  return { target, swapped }
}

/** The slot under a point (a finger, a click), or null between and outside them. */
export const hitSlot = (point, count, radius = ringRadius(count), hit = HIT) => {
  let best = null
  let bestDistance = hit
  for (let index = 0; index < count; index += 1) {
    const slot = slotOffset(index, count, radius)
    const distance = Math.hypot(point.x - slot.x, point.y - slot.y)
    if (distance <= bestDistance) {
      best = index
      bestDistance = distance
    }
  }
  return best
}

/** The slot `step` places round from `current`, wrapping; from nothing, the first or last. */
export const stepSlot = (current, step, count) => {
  if (current === null || current === undefined) return step > 0 ? 0 : count - 1
  return (((current + step) % count) + count) % count
}

/**
 * Where to centre the ring: on the anchor, nudged in just far enough that the whole
 * ring (and the name under it) stays inside the window.
 */
export const placeRing = (anchor, extent, viewport, margin = 8) => {
  const clamp = (value, low, high) => (low > high ? (low + high) / 2 : Math.min(Math.max(value, low), high))
  return {
    x: clamp(anchor.x, extent.left + margin, viewport.width - extent.right - margin),
    y: clamp(anchor.y, extent.top + margin, viewport.height - extent.bottom - margin),
  }
}
