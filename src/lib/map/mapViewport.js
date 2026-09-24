/**
 * mapViewport.js — pan and zoom arithmetic for a map.
 *
 * The convention is canvasGeometry's: a viewport `{ x, y, zoom }` names the WORLD
 * point at the view's top-left corner, so screen = (world − origin) × zoom. It is a
 * separate module rather than a reuse because a map needs a far wider zoom range —
 * from a whole continent down to a street — and canvasGeometry's limits are part of
 * the canvas's contract with the Rust core.
 *
 * Per-frame view math, not domain logic: nothing outside the page renders a map, so
 * this has no Rust twin.
 */

export const MAP_MIN_ZOOM = 0.02
export const MAP_MAX_ZOOM = 256
export const MAP_ZOOM_STEP = 1.25

export const clampMapZoom = (zoom) =>
  Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, Number.isFinite(zoom) ? zoom : 1))

export const worldToScreen = (x, y, viewport) => ({
  x: (x - viewport.x) * viewport.zoom,
  y: (y - viewport.y) * viewport.zoom,
})

export const screenToWorld = (x, y, viewport) => ({
  x: x / viewport.zoom + viewport.x,
  y: y / viewport.zoom + viewport.y,
})

/** The SVG `transform` attribute that puts the world under `viewport`. */
export const svgWorldTransform = (viewport) =>
  `translate(${-viewport.x * viewport.zoom} ${-viewport.y * viewport.zoom}) scale(${viewport.zoom})`

/** Zoom by `factor` keeping the world point under screen point (sx, sy) where it is. */
export function zoomMapAt(viewport, sx, sy, factor) {
  const zoom = clampMapZoom(viewport.zoom * factor)
  const anchor = screenToWorld(sx, sy, viewport)
  return { x: anchor.x - sx / zoom, y: anchor.y - sy / zoom, zoom }
}

/** Pan by a screen-space delta (the direction the content should move). */
export const panMapBy = (viewport, dx, dy) => ({
  ...viewport,
  x: viewport.x - dx / viewport.zoom,
  y: viewport.y - dy / viewport.zoom,
})

/** A viewport that shows `bounds` ({x, y, width, height}) inside a view, padded. */
export function fitMapBounds(bounds, viewWidth, viewHeight, padding = 48) {
  if (!bounds || !(viewWidth > 0) || !(viewHeight > 0)) return { x: 0, y: 0, zoom: 1 }
  const width = Math.max(bounds.width, 1)
  const height = Math.max(bounds.height, 1)
  const zoom = clampMapZoom(
    Math.min((viewWidth - padding * 2) / width, (viewHeight - padding * 2) / height)
  )
  return {
    x: bounds.x + width / 2 - viewWidth / 2 / zoom,
    y: bounds.y + height / 2 - viewHeight / 2 / zoom,
    zoom,
  }
}

/** The smallest rect holding every point, or null for none. */
export function pointsBounds(points) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    if (!point) continue
    const [x, y] = point
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  if (minX === Infinity) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}
