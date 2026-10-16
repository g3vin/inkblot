/**
 * plotParts.js — the pen strokes every plate is drawn with: numbers written short,
 * dots, polylines split where they pass behind, and names that keep out of each
 * other's way.
 */

export const fmt = (value) => (Math.round(value * 10) / 10).toString()
export const escapeXml = (text) => String(text).replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char])

/** Dots as one path: a zero-length stroke with a round cap is a dot. */
export const dotsPath = (points) => points.map(([x, y]) => `M${fmt(x)} ${fmt(y)}h0`).join('')

/** A polyline's points split into runs (`split(index)` says which side a point is on). */
export function runs(points, side) {
  const out = []
  let current = null
  points.forEach((point, index) => {
    if (!point) {
      current = null
      return
    }
    const which = side(index)
    if (!current || current.side !== which) {
      // Each run starts where the last ended, so the line is unbroken.
      current = { side: which, points: current ? [current.points[current.points.length - 1], point] : [point] }
      out.push(current)
    } else current.points.push(point)
  })
  return out
}
export const linePath = (points) => points.map(([x, y], index) => `${index ? 'L' : 'M'}${fmt(x)} ${fmt(y)}`).join('')

/** Names placed where they do not overlap one already written. */
export function namer(scale) {
  const boxes = []
  const out = []
  return {
    add(text, [x, y], dx = 8, { bold = false, force = false } = {}) {
      if (!text) return
      const size = 11 * scale
      const box = { left: x + dx * scale, right: x + dx * scale + text.length * size * 0.56, top: y - size, bottom: y + size * 0.3 }
      if (!force && boxes.some((other) => box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom)) return
      boxes.push(box)
      out.push(`<text x="${fmt(box.left)}" y="${fmt(y + size * 0.35)}" font-size="${fmt(size)}"${bold ? ' font-weight="600"' : ''}>${escapeXml(text)}</text>`)
    },
    svg: () => out.join(''),
  }
}
