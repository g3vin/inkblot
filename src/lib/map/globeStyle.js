/**
 * globeStyle.js — what the globe draws beneath the writer's places, as a MapLibre
 * style.
 *
 * Offline and always there: the sea, the land and the borders, in the map's theme
 * (Natural Earth, bundled). Online and only when asked for (onlineMaps.js):
 * satellite photographs, streets and place names, and terrain. The writer's own
 * regions and routes are drawn here too, so they sit under the satellite labels and
 * bend with the terrain; places, labels and travellers are the overlay's (GlobeView).
 *
 * Colours come from the map's theme as the live surface has it resolved (themeColors),
 * so a theme is still defined once, in mapThemes.css.
 */
import { STREETS_GLYPHS, STREETS_SOURCE, TERRAIN_SOURCE } from './onlineMaps'

/** The theme's colours, read off the surface the globe sits in. */
export function themeColors(element) {
  const style = element ? getComputedStyle(element) : null
  const read = (name, fallback) => style?.getPropertyValue(name).trim() || fallback
  return {
    water: read('--map-water', '#cfe1ee'),
    land: read('--map-land', '#e7e3d6'),
    landEdge: read('--map-land-edge', '#9c937e'),
    border: read('--map-border', 'rgba(80,70,60,0.45)'),
    ink: read('--map-ink', '#1b1f27'),
    route: read('--map-route', '#b3462f'),
    region: read('--map-region', '#6d9c5a'),
    paper: read('--map-paper', '#0b1020'),
  }
}

/** Every 10°, as lines: the graticule. */
export function graticule() {
  const lines = []
  for (let lon = -180; lon < 180; lon += 10) {
    const coords = []
    for (let lat = -80; lat <= 80; lat += 2) coords.push([lon, lat])
    lines.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } })
  }
  for (let lat = -80; lat <= 80; lat += 10) {
    const coords = []
    for (let lon = -180; lon <= 180; lon += 2) coords.push([lon, lat])
    lines.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } })
  }
  return { type: 'FeatureCollection', features: lines }
}

export const EMPTY = { type: 'FeatureCollection', features: [] }

/** Ids of the layers the writer's items are drawn in; GlobeView hit-tests these. */
export const ITEM_LAYERS = {
  regionFill: 'ib-region-fill',
  regionEdge: 'ib-region-edge',
  route: 'ib-route',
  routeHit: 'ib-route-hit',
}

/** Street detail from the OpenMapTiles schema: enough to read a town by, in the theme's colours. */
function streetLayers(colors, { overImagery }) {
  const roads = overImagery ? 'rgba(255,255,255,0.55)' : colors.landEdge
  const text = overImagery ? '#ffffff' : colors.ink
  const halo = overImagery ? 'rgba(0,0,0,0.6)' : colors.land
  const layers = []
  if (!overImagery) {
    layers.push(
      { id: 'st-water', type: 'fill', source: 'streets', 'source-layer': 'water', paint: { 'fill-color': colors.water } },
      { id: 'st-park', type: 'fill', source: 'streets', 'source-layer': 'park', minzoom: 8, paint: { 'fill-color': colors.region, 'fill-opacity': 0.18 } },
      { id: 'st-building', type: 'fill', source: 'streets', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': colors.landEdge, 'fill-opacity': 0.25 } },
    )
  }
  layers.push(
    {
      id: 'st-road', type: 'line', source: 'streets', 'source-layer': 'transportation', minzoom: 5,
      filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']]],
      paint: {
        'line-color': roads,
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 5, 0.3, 10, 1, 16, 8],
        'line-opacity': ['match', ['get', 'class'], ['minor', 'service'], 0.6, 1],
      },
    },
    {
      id: 'st-place', type: 'symbol', source: 'streets', 'source-layer': 'place',
      layout: {
        'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['match', ['get', 'class'], 'country', 13, 'state', 11, 'city', 13, 'town', 12, 11],
        'text-max-width': 8,
      },
      paint: { 'text-color': text, 'text-halo-color': halo, 'text-halo-width': 1.2 },
    },
    {
      id: 'st-road-name', type: 'symbol', source: 'streets', 'source-layer': 'transportation_name', minzoom: 13,
      layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11 },
      paint: { 'text-color': text, 'text-halo-color': halo, 'text-halo-width': 1 },
    },
  )
  return layers
}

/**
 * The style for an Earth globe. `earth` is the map's section (view, imagery, terrain,
 * graticule, borders); `online` says whether fetching is allowed; `satellite` is the
 * raster source when one is configured; `land` / `borders` are GeoJSON.
 */
export function buildGlobeStyle({ earth, colors, online, satellite, land, borders, regions, routes }) {
  const imagery = online && satellite ? earth.imagery : 'map'
  const showImagery = imagery === 'satellite' || imagery === 'hybrid'
  const streets = online && (imagery === 'hybrid' || earth.streets !== false)
  const sources = {
    'ib-land': { type: 'geojson', data: land || EMPTY },
    'ib-borders': { type: 'geojson', data: borders || EMPTY },
    'ib-graticule': { type: 'geojson', data: graticule() },
    'ib-regions': { type: 'geojson', data: regions || EMPTY },
    'ib-routes': { type: 'geojson', data: routes || EMPTY, lineMetrics: false },
  }
  if (showImagery) sources.satellite = { type: 'raster', ...satellite }
  if (streets) sources.streets = { type: 'vector', url: STREETS_SOURCE.url, attribution: STREETS_SOURCE.attribution }
  if (online && earth.terrain3d) sources['ib-dem'] = { type: 'raster-dem', ...TERRAIN_SOURCE }

  const layers = [
    { id: 'ib-water', type: 'background', paint: { 'background-color': colors.water } },
    { id: 'ib-land', type: 'fill', source: 'ib-land', paint: { 'fill-color': colors.land, 'fill-outline-color': colors.landEdge } },
  ]
  if (showImagery) layers.push({ id: 'ib-satellite', type: 'raster', source: 'satellite', paint: { 'raster-fade-duration': 150 } })
  if (streets) layers.push(...streetLayers(colors, { overImagery: showImagery }).filter((layer) => layer.type !== 'symbol'))
  if (online && earth.terrain3d) {
    layers.push({ id: 'ib-hillshade', type: 'hillshade', source: 'ib-dem', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': colors.ink } })
  }
  if (earth.graticule) layers.push({ id: 'ib-graticule', type: 'line', source: 'ib-graticule', paint: { 'line-color': showImagery ? 'rgba(255,255,255,0.25)' : colors.border, 'line-width': 0.5 } })
  if (earth.borders) layers.push({ id: 'ib-borders', type: 'line', source: 'ib-borders', paint: { 'line-color': showImagery ? 'rgba(255,255,255,0.6)' : colors.border, 'line-width': 0.8 } })

  // The writer's regions and routes, over the ground and under the names.
  layers.push(
    {
      id: ITEM_LAYERS.regionFill, type: 'fill', source: 'ib-regions',
      paint: { 'fill-color': ['coalesce', ['get', 'fill'], colors.region], 'fill-opacity': ['case', ['get', 'selected'], 0.5, 0.35] },
    },
    {
      id: ITEM_LAYERS.regionEdge, type: 'line', source: 'ib-regions',
      paint: { 'line-color': ['coalesce', ['get', 'stroke'], ['get', 'fill'], colors.region], 'line-width': ['case', ['get', 'selected'], 2.5, 1.2] },
    },
    { id: ITEM_LAYERS.routeHit, type: 'line', source: 'ib-routes', paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 14 } },
    {
      id: ITEM_LAYERS.route, type: 'line', source: 'ib-routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', 'stroke'], colors.route],
        'line-width': ['case', ['get', 'selected'], ['+', ['get', 'width'], 1.5], ['get', 'width']],
      },
    },
  )
  if (streets) layers.push(...streetLayers(colors, { overImagery: showImagery }).filter((layer) => layer.type === 'symbol'))

  const style = {
    version: 8,
    projection: { type: 'globe' },
    sources,
    layers,
    sky: {
      'sky-color': colors.paper,
      'horizon-color': colors.water,
      'fog-color': colors.water,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
    },
  }
  if (streets) style.glyphs = STREETS_GLYPHS
  return style
}
