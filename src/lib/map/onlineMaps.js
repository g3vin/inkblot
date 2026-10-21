/**
 * onlineMaps.js — the map pictures Inkblot fetches from the internet, and the
 * writer's say over them.
 *
 * Everything a map needs is bundled and works offline: the Earth's coastlines and
 * borders, a writer's own worlds, star systems and galaxies. Three things are only
 * online, and only when the writer turns them on (Settings ▸ Maps, or the first time
 * they choose one on a map):
 *
 *   satellite   photographs of the ground, from a free source (Sentinel-2 cloudless,
 *               by EOX, CC BY 4.0) or a provider the writer has a key for
 *   streets     roads, buildings and place names, from OpenFreeMap (OpenStreetMap
 *               data, no key)
 *   terrain     elevation, to raise mountains on the globe (Terrain Tiles on AWS,
 *               from Mapzen; open data)
 *   search      finding a real place by name (Photon, by Komoot; OpenStreetMap data)
 *
 * What those services see is the part of the world being looked at, and what is
 * searched for. Nothing about the writer's project leaves the computer. PRIVACY.md
 * says the same.
 *
 * Settings live in preferences (on this computer, never in a project), so a key is
 * never shared along with a project folder.
 */
import { getPreference, setPreference } from '../preferences'

const KEYS = {
  enabled: 'inkblot.maps.online',
  provider: 'inkblot.maps.satellite-provider',
  key: 'inkblot.maps.satellite-key',
  customUrl: 'inkblot.maps.satellite-url',
}

export const ONLINE_MAPS_CHANGED = 'inkblot:online-maps-changed'

/** The satellite sources on offer. `free` needs no key; `custom` is any XYZ tile URL. */
export const SATELLITE_PROVIDERS = [
  { id: 'free', label: 'Sentinel-2 (free)', needsKey: false },
  { id: 'maptiler', label: 'MapTiler', needsKey: true },
  { id: 'mapbox', label: 'Mapbox', needsKey: true },
  { id: 'google', label: 'Google Maps', needsKey: true },
  { id: 'custom', label: 'Another source…', needsKey: false },
]

/** The writer's online-maps choice, from preferences; an unknown provider reads as 'free'. */
export function readOnlineMaps() {
  const provider = getPreference(KEYS.provider)
  return {
    enabled: getPreference(KEYS.enabled) === '1',
    provider: SATELLITE_PROVIDERS.some((option) => option.id === provider) ? provider : 'free',
    key: getPreference(KEYS.key) || '',
    customUrl: getPreference(KEYS.customUrl) || '',
  }
}

/** Merge `patch` into the choice, save it, and tell open maps (`ONLINE_MAPS_CHANGED`). */
export function saveOnlineMaps(patch) {
  const next = { ...readOnlineMaps(), ...patch }
  setPreference(KEYS.enabled, next.enabled ? '1' : '0')
  setPreference(KEYS.provider, next.provider)
  setPreference(KEYS.key, next.key.trim())
  setPreference(KEYS.customUrl, next.customUrl.trim())
  window.dispatchEvent(new CustomEvent(ONLINE_MAPS_CHANGED, { detail: next }))
  return next
}

/* ---------------- what is fetched, from where ---------------- */

const EOX_ATTRIBUTION = 'Sentinel-2 cloudless 2016 by <a href="https://s2maps.eu">EOX IT Services GmbH</a> (contains modified Copernicus Sentinel data 2016)'
const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · <a href="https://openfreemap.org">OpenFreeMap</a>'

/** A {z}/{x}/{y} template with `{key}` filled in. */
const withKey = (template, key) => template.replaceAll('{key}', encodeURIComponent(key))

/**
 * The satellite raster source for MapLibre: `{ tiles, tileSize, maxzoom, attribution }`,
 * or null when the provider needs a key it has not been given. Google asks for a
 * session first, so this is async.
 */
export async function satelliteSource(settings = readOnlineMaps()) {
  const { provider, key, customUrl } = settings
  if (provider === 'maptiler' && key) {
    return {
      tiles: [withKey('https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key={key}', key)],
      tileSize: 512,
      maxzoom: 20,
      attribution: '© <a href="https://www.maptiler.com/copyright/">MapTiler</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }
  }
  if (provider === 'mapbox' && key) {
    return {
      tiles: [withKey('https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token={key}', key)],
      tileSize: 512,
      maxzoom: 21,
      attribution: '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="https://www.maxar.com/">Maxar</a>',
    }
  }
  if (provider === 'google' && key) {
    const session = await googleSession(key)
    if (!session) return null
    return {
      tiles: [`https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(key)}`],
      tileSize: 256,
      maxzoom: 22,
      attribution: 'Google',
    }
  }
  if (provider === 'custom' && /^https:\/\/.*\{z\}.*\{x\}.*\{y\}/.test(customUrl)) {
    return { tiles: [withKey(customUrl, key)], tileSize: 256, maxzoom: 19, attribution: '' }
  }
  if (provider !== 'free') return null
  return {
    tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'],
    tileSize: 256,
    maxzoom: 15,
    attribution: EOX_ATTRIBUTION,
  }
}

const googleSessions = new Map()

/** Google's Map Tiles API hands out a session per map type, good for about two weeks. */
async function googleSession(key) {
  const cached = googleSessions.get(key)
  if (cached && cached.expires > Date.now()) return cached.session
  try {
    const response = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapType: 'satellite', language: navigator.language || 'en-US', region: 'US' }),
    })
    if (!response.ok) return null
    const body = await response.json()
    const expires = Number(body.expiry) * 1000 || Date.now() + 86400000
    googleSessions.set(key, { session: body.session, expires })
    return body.session
  } catch {
    return null
  }
}

/** Streets, buildings and place names (OpenMapTiles schema), and the fonts their labels need. */
export const STREETS_SOURCE = { url: 'https://tiles.openfreemap.org/planet', attribution: OSM_ATTRIBUTION }
export const STREETS_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'

/** Heights as Terrarium-encoded PNGs. */
export const TERRAIN_SOURCE = {
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  tileSize: 256,
  maxzoom: 15,
  encoding: 'terrarium',
  attribution: 'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Mapzen, and others</a>',
}

/**
 * Real places matching `query`, nearest `near` first when given: `[{ name, detail, at }]`.
 * Photon asks for a light touch: one search per Return, never per keystroke.
 */
export async function searchPlaces(query, near = null, { signal } = {}) {
  const text = String(query || '').trim()
  if (!text) return []
  const params = new URLSearchParams({ q: text, limit: '8', lang: 'en' })
  if (near) {
    params.set('lon', String(near[0]))
    params.set('lat', String(near[1]))
  }
  const response = await fetch(`https://photon.komoot.io/api/?${params}`, { signal })
  if (!response.ok) throw new Error(`Search answered ${response.status}`)
  const body = await response.json()
  return (body.features || []).map((feature) => {
    const props = feature.properties || {}
    const detail = [props.city, props.state, props.country].filter((part) => part && part !== props.name).join(', ')
    return { name: props.name || detail || 'Unnamed place', detail, at: feature.geometry.coordinates.slice(0, 2), kind: props.osm_value || null }
  })
}
