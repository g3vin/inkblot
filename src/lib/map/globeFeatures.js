/**
 * globeFeatures.js — a map's regions and routes as GeoJSON, for the globe.
 *
 * The globe (MapLibre) draws them on the GPU, under satellite labels and over
 * terrain. Routes are drawn along the same great circles they are measured on
 * (measuredLine), and unwrapped across the antimeridian so a route from Japan to
 * California crosses the Pacific rather than the whole world.
 *
 * Each feature carries the item's id and kind, which is how a click on the globe is
 * turned back into the item it hit, and `selected`, which the style emphasises.
 */
import { measuredLine, routeCoords } from './mapSpace'
import { isItemShown } from './mapVisibility'

/** Longitudes made continuous: each within 180° of the one before. */
export function unwrapLongitudes(points) {
  if (!points.length) return []
  const out = [[points[0][0], points[0][1]]]
  for (let index = 1; index < points.length; index += 1) {
    const previous = out[index - 1][0]
    let lon = points[index][0]
    while (lon - previous > 180) lon -= 360
    while (lon - previous < -180) lon += 360
    out.push([lon, points[index][1]])
  }
  return out
}

const closed = (ring) => {
  const points = ring.map((point) => [point[0], point[1]])
  const first = points[0]
  const last = points[points.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) points.push([first[0], first[1]])
  return points
}

export function regionFeatures(map, selection, day = 0) {
  const terrains = new Map(map.terrains.map((terrain) => [terrain.id, terrain]))
  return {
    type: 'FeatureCollection',
    features: map.regions.filter((region) => isItemShown(map, region, day)).map((region) => {
      const terrain = region.terrain ? terrains.get(region.terrain) : null
      return {
        type: 'Feature',
        properties: {
          id: region.id,
          kind: 'region',
          fill: region.fill || terrain?.fill || null,
          stroke: region.stroke || null,
          selected: selection?.kind === 'region' && selection.id === region.id,
        },
        geometry: { type: 'Polygon', coordinates: region.rings.map(closed) },
      }
    }),
  }
}

export function routeFeatures(map, space, day, selection) {
  return {
    type: 'FeatureCollection',
    features: map.routes.filter((route) => isItemShown(map, route, day)).flatMap((route) => {
      const line = measuredLine(space, routeCoords(map, space, route, day))
      if (line.points.length < 2) return []
      return [{
        type: 'Feature',
        properties: {
          id: route.id,
          kind: 'route',
          stroke: route.style.stroke || null,
          width: route.style.width,
          selected: selection?.kind === 'route' && selection.id === route.id,
        },
        geometry: { type: 'LineString', coordinates: unwrapLongitudes(line.points) },
      }]
    }),
  }
}
