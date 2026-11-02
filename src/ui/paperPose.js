/**
 * paperPose.js — how the sheets of a pile lie (ui/Paper.jsx), kept apart from the
 * components so it can be tested.
 */

/** A stable number in [-1, 1) from a string, so a sheet's turn is the same every time. */
export function tiltOf(key) {
  let hash = 2166136261
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) / 4294967296) * 2 - 1
}

/**
 * Where sheet `index` of `count` lies, at rest and fanned. The top sheet (0) stays
 * nearly square; the ones beneath turn further, and fanned they open out to either
 * side and up, so the top of each shows past the one in front.
 */
export function sheetPose(key, index, count) {
  const tilt = tiltOf(key)
  const rest = index === 0
    ? { x: 0, y: 0, rotate: tilt * 1.2 }
    : { x: tilt * 5, y: index * 3, rotate: tilt * 4 + (index % 2 ? -1.5 : 1.5) }
  if (count < 2) return { rest, fan: { x: 0, y: -4, rotate: rest.rotate } }
  const reach = Math.ceil(index / 2)
  const side = index % 2 ? -1 : 1
  const fan = index === 0
    ? { x: 0, y: -6, rotate: 0 }
    : { x: side * reach * 30, y: -reach * 12, rotate: side * reach * 6 }
  return { rest, fan }
}
