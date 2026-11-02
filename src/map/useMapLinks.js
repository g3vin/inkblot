/**
 * useMapLinks — maps reached from this one. Something on the map (a body's surface, a
 * galaxy in a group, a star system in a galaxy) gets a map of its own the first time it
 * is opened, written beside this one and linked from it; and the breadcrumb shows the
 * maps that contain this one, read from the links between the project's maps.
 *
 * Returns `openSurface`, `openPinMap`, the `trail` (outermost map first) and the
 * `breadcrumb` items.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getDocDisplayName, isMapDoc, MAP_SUFFIX } from '../lib/docKind'
import { createEmptyMap, mapDocRefs } from '../lib/map/mapModel'
import { forgetAncestry, loadAncestry, trailFor } from '../lib/map/mapAncestry'
import { saveMapDocument } from '../lib/map/mapFileSystem'
import { surfaceForBody } from '../lib/map/planetPresets'
import { presetSystem } from '../lib/map/systemPresets'
import { starFields, starPreset } from '../lib/map/stars'
import { random, seedOf } from '../lib/map/seeded'
import { defaultTerrainEntries } from '../lib/map/terrains'
import { announceProjectFiles } from '../lib/projectFiles'

/** The breadcrumb's glyph for each kind of map. */
const MAP_KIND_ICONS = { earth: 'globe', planet: 'world', system: 'orbit', galaxy: 'galaxy', universe: 'universe', model: 'model' }

export function useMapLinks({ projectName, docPath, docs, map, mapRef, dispatch, saveNow, onOpenDoc }) {
  /*
   * A map of its own for something on this one — a body's surface, a galaxy in a
   * group, a star system in a galaxy: written beside this map, named after the
   * thing, linked from it (`link` patches this map with the new path), saved so the
   * new map finds this one above it, and opened.
   */
  const openLinkedMap = useCallback(async (name, created, link) => {
    const folder = docPath.includes('/') ? docPath.slice(0, docPath.lastIndexOf('/') + 1) : ''
    const base = (name || 'Untitled').replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Untitled'
    let path = `${folder}${base}${MAP_SUFFIX}`
    for (let copy = 2; docs.paths.has(path); copy += 1) path = `${folder}${base} ${copy}${MAP_SUFFIX}`
    if (!(await saveMapDocument(projectName, path, created))) return
    const linked = link(mapRef.current, path)
    dispatch({ type: 'map/patch', patch: linked })
    await saveNow(linked)
    forgetAncestry()
    announceProjectFiles()
    onOpenDoc?.(path)
  }, [dispatch, docPath, docs.paths, mapRef, onOpenDoc, projectName, saveNow])

  /** A body's surface: its planet map, made the first time to look like the body. */
  const openSurface = useCallback(async (body) => {
    if (!body) return
    if (body.surface && docs.paths.has(body.surface)) {
      onOpenDoc?.(body.surface)
      return
    }
    const bodies = new Map(mapRef.current.system.bodies.map((candidate) => [candidate.id, candidate]))
    const world = createEmptyMap('planet', {
      surface: surfaceForBody(body, bodies),
      scale: { kmPerUnit: 1, displayUnit: 'km', calibration: null, customUnits: [] },
      terrains: defaultTerrainEntries(),
      style: { theme: 'night' },
    })
    await openLinkedMap(body.name || 'World', world, (current, path) => ({
      ...current,
      system: { ...current.system, bodies: current.system.bodies.map((candidate) => (candidate.id === body.id ? { ...candidate, surface: path } : candidate)) },
    }))
  }, [docs.paths, mapRef, onOpenDoc, openLinkedMap])

  /**
   * A place in space as a map of its own: a galaxy in a group opens as that galaxy
   * (its type and seed, so it looks as its dot did); a place in a galaxy becomes a
   * star system, its star from the stars of that part of the galaxy.
   */
  const openPinMap = useCallback(async (pin) => {
    const current = mapRef.current
    let created
    if (current.mapKind === 'universe') {
      const look = pin.galaxy || { type: 'Sb', seed: seedOf(pin.id), radiusLy: 50000 }
      created = createEmptyMap('galaxy', {
        galaxy: { type: look.type, seed: look.seed, radiusLy: look.radiusLy || 50000, thicknessLy: 1000 },
        scale: { kmPerUnit: 1, displayUnit: 'ly', calibration: null, customUnits: [] },
        style: { theme: 'night' },
      })
    } else {
      const radius = current.galaxy.radiusLy || 50000
      const out = Math.hypot(pin.at?.[0] || 0, pin.at?.[1] || 0) / radius
      const rand = random(seedOf(pin.id))
      // Near the bulge the stars are old and red; out in the arms, younger and bluer.
      const spectral = out < 0.15 ? ['K5V', 'M2V', 'K3III'][Math.floor(rand() * 3)] : ['G2V', 'K5V', 'M2V', 'F5V', 'M5V'][Math.floor(rand() * 5)]
      const system = presetSystem('lone')
      const preset = starPreset(spectral)
      system.bodies = system.bodies.map((body) => (body.kind === 'star' ? { ...body, name: pin.name || 'Star', massSun: preset.massSun, radiusKm: preset.radiusSun * 695700, star: starFields(preset) } : body))
      created = createEmptyMap('system', {
        system,
        scale: { kmPerUnit: 1, displayUnit: 'AU', calibration: null, customUnits: [] },
        style: { theme: 'night' },
      })
    }
    await openLinkedMap(pin.name || (current.mapKind === 'universe' ? 'Galaxy' : 'Star system'), created, (map, path) => ({
      ...map,
      pins: map.pins.map((candidate) => (candidate.id === pin.id ? { ...candidate, doc: path } : candidate)),
    }))
  }, [mapRef, openLinkedMap])

  /*
   * Where this map sits: the maps that contain it, outermost first (a galaxy, its
   * system, this world), read from the links between the project's maps.
   */
  const [trail, setTrail] = useState([])
  const mapPathsKey = useMemo(() => docs.docs.map((doc) => doc.path).filter((path) => isMapDoc(path)).sort().join('\n'), [docs.docs])
  const linksKey = useMemo(() => mapDocRefs(map).join('\n'), [map])
  const lastLinksKey = useRef(linksKey)
  useEffect(() => {
    if (!docs.loaded || !mapPathsKey) return undefined
    if (lastLinksKey.current !== linksKey) {
      lastLinksKey.current = linksKey
      forgetAncestry()
    }
    let cancelled = false
    void loadAncestry(projectName, mapPathsKey.split('\n')).then((index) => {
      if (!cancelled) setTrail(trailFor(docPath, index))
    })
    return () => {
      cancelled = true
    }
  }, [docPath, docs.loaded, linksKey, mapPathsKey, projectName])
  const breadcrumb = useMemo(() => trail.map((step) => ({
    id: step.path,
    label: getDocDisplayName(step.path),
    icon: MAP_KIND_ICONS[step.kind] || 'map',
  })), [trail])

  return { openSurface, openPinMap, trail, breadcrumb }
}
