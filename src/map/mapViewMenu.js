/**
 * mapViewMenu.js — the map toolbar's View menu: how a map is shown, as opposed to
 * what is on it.
 *
 * For the Earth: a globe or a flat map (and which projection), the plain map or
 * satellite photographs, street detail, raised terrain, the graticule and borders.
 * For a star system: in 3D or laid flat, and distances squeezed or to scale.
 * Built here as a list (`MapMenuItem`) the toolbar draws — the page's own, or a
 * native shell's — and each choice comes back as `view-option` with its id.
 *
 * Choices that fetch from the internet are marked `online`: the surface asks the
 * writer once, before the first one (onlineMaps.js).
 */
import { PROJECTION_NAMES } from '../lib/map/mapProjection'

const FLAT_PROJECTIONS = ['equalEarth', 'naturalEarth', 'equirectangular', 'mercator']
const IMAGERY = [['map', 'Map'], ['satellite', 'Satellite'], ['hybrid', 'Satellite with labels']]

/** What fetches from the internet, so the writer is asked first. */
export const ONLINE_OPTIONS = new Set(['earth.imagery.satellite', 'earth.imagery.hybrid', 'earth.streets', 'earth.terrain'])

const item = (id, label, { checked = false, disabled = false, separator = false } = {}) => ({ id, label, checked, disabled, separator })

/** The View menu for `map`. `globeAvailable` (`spaceAvailable`) is false where the globe (3D) could not start. */
export function viewMenuFor(map, { globeAvailable = true, spaceAvailable = true, lookAround = false } = {}) {
  if (map.mapKind === 'model') {
    return [
      item('model.look', 'Look around', { checked: lookAround, disabled: !spaceAvailable }),
      item('model.up', 'Model is z-up', { checked: map.model.up === 'z', separator: true }),
    ]
  }
  if (map.mapKind === 'system') {
    const { display } = map.system
    const in3d = display.view === '3d' && spaceAvailable
    return [
      item('system.view.3d', 'In 3D', { checked: in3d, disabled: !spaceAvailable }),
      item('system.view.flat', 'Flat', { checked: !in3d }),
      item('system.radial.log', 'Distances squeezed', { checked: display.radial === 'log', separator: true }),
      item('system.radial.linear', 'Distances to scale', { checked: display.radial === 'linear' }),
    ]
  }
  if (map.mapKind !== 'earth') return []
  const { earth } = map
  const globe = earth.view === 'globe' && globeAvailable
  return [
    item('earth.view.globe', 'Globe', { checked: globe, disabled: !globeAvailable }),
    item('earth.view.flat', 'Flat map', { checked: !globe }),
    ...FLAT_PROJECTIONS.map((projection, index) =>
      item(`earth.projection.${projection}`, PROJECTION_NAMES[projection], {
        checked: !globe && earth.projection === projection,
        separator: index === 0,
      })
    ),
    ...IMAGERY.map(([id, label], index) =>
      item(`earth.imagery.${id}`, label, { checked: earth.imagery === id, disabled: !globe && id !== 'map', separator: index === 0 })
    ),
    item('earth.streets', 'Street detail', { checked: earth.streets !== false, disabled: !globe }),
    item('earth.terrain', 'Terrain in 3D', { checked: earth.terrain3d, disabled: !globe }),
    item('earth.graticule', 'Graticule', { checked: earth.graticule, separator: true }),
    item('earth.borders', 'Borders', { checked: earth.borders }),
  ]
}

/**
 * The edit a View choice makes, as a patch to the map's `earth` section; null for
 * an id this map does not have.
 */
export function viewOptionPatch(map, id) {
  const { earth } = map
  if (id === 'earth.view.globe') return { view: 'globe' }
  if (id === 'earth.view.flat') return { view: 'flat', projection: earth.projection === 'orthographic' ? 'equalEarth' : earth.projection }
  if (id.startsWith('earth.projection.')) {
    const projection = id.slice('earth.projection.'.length)
    return FLAT_PROJECTIONS.includes(projection) ? { view: 'flat', projection } : null
  }
  if (id.startsWith('earth.imagery.')) {
    const imagery = id.slice('earth.imagery.'.length)
    return IMAGERY.some(([value]) => value === imagery) ? { imagery, view: 'globe' } : null
  }
  if (id === 'earth.streets') return { streets: earth.streets === false }
  if (id === 'earth.terrain') return { terrain3d: !earth.terrain3d, view: 'globe' }
  if (id === 'earth.graticule') return { graticule: !earth.graticule }
  if (id === 'earth.borders') return { borders: !earth.borders }
  return null
}

/**
 * The edit any View choice makes: `{ section, patch }` for the map reducer's
 * `section/patch`, or null for an id this map does not have.
 */
export function viewOptionEdit(map, id) {
  if (id === 'model.up' && map.mapKind === 'model') return { section: 'model', patch: { up: map.model.up === 'z' ? 'y' : 'z' } }
  if (id.startsWith('system.')) {
    if (map.mapKind !== 'system') return null
    const { display } = map.system
    if (id === 'system.view.3d' || id === 'system.view.flat') return { section: 'system', patch: { display: { ...display, view: id.slice('system.view.'.length) } } }
    if (id === 'system.radial.log' || id === 'system.radial.linear') return { section: 'system', patch: { display: { ...display, radial: id.slice('system.radial.'.length) } } }
    return null
  }
  if (map.mapKind !== 'earth') return null
  const patch = viewOptionPatch(map, id)
  return patch ? { section: 'earth', patch } : null
}

/** Does choosing `id` (on this map) turn on something fetched online? */
export function choosesOnline(map, id) {
  if (!ONLINE_OPTIONS.has(id)) return false
  if (id === 'earth.imagery.satellite' || id === 'earth.imagery.hybrid') return true
  if (id === 'earth.streets') return map.earth.streets === false
  if (id === 'earth.terrain') return !map.earth.terrain3d
  return false
}

/** How each View choice reads in the command palette: verb first. */
export const VIEW_COMMAND_TITLES = {
  'earth.view.globe': ['Show the Earth as a globe', ['3d', 'sphere', 'spin', 'apple maps', 'google earth']],
  'earth.view.flat': ['Lay the Earth out flat', ['projection', '2d', 'atlas']],
  'earth.projection.equalEarth': ['Use the Equal Earth projection', ['flat', 'area']],
  'earth.projection.naturalEarth': ['Use the Natural Earth projection', ['flat', 'atlas']],
  'earth.projection.equirectangular': ['Use the equirectangular projection', ['flat', 'plate carree', 'lat long']],
  'earth.projection.mercator': ['Use the Mercator projection', ['flat', 'web map', 'navigation']],
  'earth.imagery.map': ['Show the plain map', ['drawn', 'offline', 'no satellite']],
  'earth.imagery.satellite': ['Show satellite pictures', ['aerial', 'imagery', 'photo', 'google', 'apple']],
  'earth.imagery.hybrid': ['Show satellite pictures with labels', ['aerial', 'imagery', 'hybrid', 'names', 'roads']],
  'earth.streets': ['Show or hide street detail', ['roads', 'buildings', 'place names', 'openstreetmap']],
  'earth.terrain': ['Show or hide terrain in 3D', ['mountains', 'elevation', 'relief', 'hills']],
  'earth.graticule': ['Show or hide the graticule', ['latitude', 'longitude', 'grid lines']],
  'earth.borders': ['Show or hide borders', ['countries', 'frontiers']],
  'model.look': ['Look around inside the model', ['first person', 'walk', 'wasd', 'inside', 'explore', 'station']],
  'model.up': ['Stand the model upright (z-up)', ['rotate', 'axis', 'upright', 'blender']],
  'system.view.3d': ['Show the system in 3D', ['three dimensions', 'orbit', 'space', 'perspective']],
  'system.view.flat': ['Lay the system out flat', ['2d', 'top down', 'diagram', 'print']],
  'system.radial.log': ['Squeeze distances so everything fits', ['log', 'compress', 'scale']],
  'system.radial.linear': ['Draw distances to scale', ['linear', 'true scale', 'real']],
}
