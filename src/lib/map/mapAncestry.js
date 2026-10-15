/**
 * mapAncestry.js — which map a map sits inside, for the breadcrumb.
 *
 * A map is inside another when the other links to it: a pin whose document is the
 * map (a system pinned on a galaxy, a galaxy on a universe), or a body whose
 * surface it is (a world in a system). The index is built by reading every map in
 * the project once, and kept until the project's maps change.
 */
import { isMapDoc } from '../docKind'
import { loadDocument } from '../FileSystem'
import { isMapPayload, normalizeMap } from './mapModel'

/**
 * From `[{ path, map }]`: childPath → `{ parent, kind }` (the parent's path, and
 * what kind of map the parent is). The first link found wins.
 */
export function parentIndex(maps) {
  const parents = new Map()
  const kinds = new Map(maps.map(({ path, map }) => [path, map.mapKind]))
  for (const { path, map } of maps) {
    const children = [
      ...map.pins.map((pin) => pin.doc).filter((doc) => doc && isMapDoc(doc)),
      ...(map.mapKind === 'system' ? map.system.bodies.map((body) => body.surface).filter(Boolean) : []),
    ]
    for (const child of children) if (child !== path && !parents.has(child)) parents.set(child, path)
  }
  return { parents, kinds }
}

/** The trail from the outermost map down to `path`: `[{ path, kind }]`, at most 12 deep. */
export function trailFor(path, index) {
  const trail = [{ path, kind: index.kinds.get(path) || null }]
  const seen = new Set([path])
  let current = path
  while (index.parents.has(current) && trail.length < 12) {
    current = index.parents.get(current)
    if (seen.has(current)) break
    seen.add(current)
    trail.unshift({ path: current, kind: index.kinds.get(current) || null })
  }
  return trail
}

const cache = new Map()

/** Read every map in the project (paths given) and index them; cached by the list of paths. */
export async function loadAncestry(projectName, mapPaths) {
  const key = `${projectName}\n${[...mapPaths].sort().join('\n')}`
  if (cache.has(key)) return cache.get(key)
  const job = Promise.all(mapPaths.map(async (path) => {
    try {
      const raw = await loadDocument(projectName, path)
      return isMapPayload(raw) ? { path, map: normalizeMap(raw) } : null
    } catch {
      return null
    }
  })).then((maps) => parentIndex(maps.filter(Boolean)))
  cache.clear()
  cache.set(key, job)
  return job
}

/** Forget the index (a map's links changed). */
export const forgetAncestry = () => cache.clear()
