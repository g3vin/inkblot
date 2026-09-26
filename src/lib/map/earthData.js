/**
 * earthData.js — the Earth's outlines, bundled and offline.
 *
 * Natural Earth (public domain) by way of the `world-atlas` TopoJSON builds: land
 * and country outlines at 1:110m for the whole-world view and 1:50m once zoomed in.
 * Each file is its own lazy chunk, so an app that never opens an Earth map never
 * loads a byte of it, and nothing is ever fetched from the network.
 *
 * `projectedEarth` turns the geometry into SVG path strings ONCE per projection and
 * detail level. Panning and zooming then only move the world group, so a coastline
 * of tens of thousands of points costs nothing per frame.
 */
import { feature, mesh } from 'topojson-client'
import { geoGraticule10 } from 'd3-geo'

const LOADERS = {
  '110m': () => import('world-atlas/countries-110m.json'),
  '50m': () => import('world-atlas/countries-50m.json'),
}

const importer = (level) => LOADERS[level]()

const loaded = new Map()

/** `{ land, borders, countries }` as GeoJSON for a detail level ('110m' | '50m'). */
export function loadEarth(level = '110m') {
  if (!loaded.has(level)) {
    loaded.set(
      level,
      importer(level).then((module) => {
        const topology = module.default || module
        const countries = feature(topology, topology.objects.countries)
        return {
          countries,
          land: feature(topology, topology.objects.land),
          // Shared borders only, each drawn once — not every country's full outline.
          borders: mesh(topology, topology.objects.countries, (a, b) => a !== b),
        }
      })
    )
  }
  return loaded.get(level)
}

const GRATICULE = geoGraticule10()
const SPHERE = { type: 'Sphere' }

/** At most this many projections' worth of path strings are kept. */
const PROJECTED_LIMIT = 6
const projected = new Map()

/**
 * The drawn Earth for a projector: `{ sphere, land, borders, graticule, countries }`
 * path strings (`countries` is `[{ name, d }]`, for hit-testing a country name).
 */
export async function projectedEarth(projector, level) {
  const key = `${projector.key}|${level}`
  if (projected.has(key)) {
    const hit = projected.get(key)
    projected.delete(key)
    projected.set(key, hit)
    return hit
  }
  const earth = await loadEarth(level)
  const path = projector.path
  // Every country's own outline is most of the work (1.6 MB of path at 50m) and only
  // a country hit-test wants it, so it is drawn the first time it is asked for.
  let countries = null
  const result = {
    sphere: path(SPHERE) || '',
    graticule: path(GRATICULE) || '',
    land: path(earth.land) || '',
    borders: path(earth.borders) || '',
    get countries() {
      countries ??= earth.countries.features.map((country) => ({
        name: country.properties?.name || '',
        d: path(country) || '',
      }))
      return countries
    },
  }
  projected.set(key, result)
  while (projected.size > PROJECTED_LIMIT) projected.delete(projected.keys().next().value)
  return result
}
