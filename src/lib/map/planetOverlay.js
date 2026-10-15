/**
 * planetOverlay.js — a planet map's regions and routes, painted onto a picture
 * that wraps the 3D world (equirectangular, like its surface).
 *
 * Painted rather than drawn as an SVG over the globe, so a region round the far
 * side or across a pole is still one shape, and a route follows the curve of the
 * world. Regions are outlined (and filled, unless the surface already grew them as
 * land: `filled`); routes run along great circles; the selected one is drawn in
 * the accent colour. A latitude–longitude grid is drawn beneath when asked.
 *
 * Map content, so colours are the map theme's (read off the surface) with raw
 * fallbacks, and this lives in src/lib/map/ with the rest of what a map draws.
 */
import { measuredLine, routeCoords } from './mapSpace'
import { isItemShown } from './mapVisibility'

/** The theme colours the overlay paints with, read off the map surface. */
export function overlayColors(element) {
  const style = element ? getComputedStyle(element) : null
  const read = (name, fallback) => style?.getPropertyValue(name).trim() || fallback
  return {
    region: read('--map-region', '#6d9c5a'),
    route: read('--map-route', '#b3462f'),
    accent: read('--map-accent', '#3b82f6'),
    grid: 'rgba(255,255,255,0.18)',
    edge: 'rgba(20,20,20,0.55)',
  }
}

const unwrap = (points) => {
  const out = []
  let previous = null
  for (const point of points) {
    let lon = point[0]
    if (previous !== null) {
      while (lon - previous > 180) lon -= 360
      while (lon - previous < -180) lon += 360
    }
    previous = lon
    out.push([lon, point[1]])
  }
  return out
}

/**
 * Paint `map`'s regions and routes on `day` into `canvas` (its size sets the
 * resolution). `selection` is highlighted; `filled` paints region fills.
 */
export function paintOverlay(canvas, map, space, day, { selection = null, colors, filled = true, grid = false } = {}) {
  const context = canvas.getContext('2d')
  const { width, height } = canvas
  const x = (lon) => ((lon + 180) / 360) * width
  const y = (lat) => ((90 - lat) / 180) * height
  const scale = width / 2048
  context.clearRect(0, 0, width, height)
  context.lineJoin = 'round'
  context.lineCap = 'round'

  if (grid) {
    context.strokeStyle = colors.grid
    context.lineWidth = 1 * scale
    context.beginPath()
    for (let lon = -180; lon <= 180; lon += 15) {
      context.moveTo(x(lon), 0)
      context.lineTo(x(lon), height)
    }
    for (let lat = -75; lat <= 75; lat += 15) {
      context.moveTo(0, y(lat))
      context.lineTo(width, y(lat))
    }
    context.stroke()
  }

  // Every shape three times, a world apart, so what crosses the antimeridian wraps.
  const traceWrapped = (lines, closed) => {
    for (const shift of [-360, 0, 360]) {
      for (const line of lines) {
        line.forEach((point, index) => {
          if (index === 0) context.moveTo(x(point[0] + shift), y(point[1]))
          else context.lineTo(x(point[0] + shift), y(point[1]))
        })
        if (closed) context.closePath()
      }
    }
  }

  const terrains = new Map(map.terrains.map((terrain) => [terrain.id, terrain]))
  for (const region of map.regions) {
    if (!isItemShown(map, region, day)) continue
    const rings = region.rings.filter((ring) => ring.length >= 3).map(unwrap)
    if (!rings.length) continue
    const selected = selection?.kind === 'region' && selection.id === region.id
    const fill = region.fill || terrains.get(region.terrain)?.fill || colors.region
    context.beginPath()
    traceWrapped(rings, true)
    if (filled) {
      context.globalAlpha = 0.42
      context.fillStyle = fill
      context.fill('evenodd')
      context.globalAlpha = 1
    }
    context.strokeStyle = selected ? colors.accent : region.stroke || colors.edge
    context.lineWidth = (selected ? 4 : 1.6) * scale
    context.stroke()
  }

  for (const route of map.routes) {
    if (!isItemShown(map, route, day)) continue
    const line = measuredLine(space, routeCoords(map, space, route, day))
    if (line.points.length < 2) continue
    const selected = selection?.kind === 'route' && selection.id === route.id
    context.beginPath()
    traceWrapped([unwrap(line.points)], false)
    context.strokeStyle = selected ? colors.accent : route.style.stroke || colors.route
    context.lineWidth = (route.style.width || 2) * (selected ? 1.8 : 1.2) * scale
    context.setLineDash(route.style.dash === 'dashed' ? [10 * scale, 7 * scale] : route.style.dash === 'dotted' ? [1, 6 * scale] : [])
    context.stroke()
    context.setLineDash([])
  }
}

/** What the overlay depends on, as a key: repaint only when it changes. */
export const overlayKey = (map, day, selection) =>
  JSON.stringify([
    map.regions.filter((item) => isItemShown(map, item, day)).map((region) => [region.id, region.rings, region.fill, region.stroke, region.terrain]),
    map.routes.filter((item) => isItemShown(map, item, day)).map((route) => [route.id, route.nodes, route.style]),
    map.pins.map((pin) => [pin.id, pin.at]),
    selection,
  ])
