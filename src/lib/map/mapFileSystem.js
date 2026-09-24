/**
 * mapFileSystem.js — persistence for map documents.
 *
 * Maps live alongside everything else at `<projectRoot>/<path>.json` (their tree
 * path carries the `.map` suffix). Like canvases they cannot go through
 * saveDocument, which whitelists a text document's keys and refuses anything else.
 *
 * The one thing a map save does that a canvas save does not is refuse to overwrite
 * a file that is not a map. Routing is by suffix alone, and `.map` is a suffix people
 * used in document names before maps existed — `Treasure.map` may be a chapter. Such
 * a file loads as `foreign`, the pane says so, and nothing is ever written over it.
 * The Rust store makes the same check (`save_map_document`).
 */
import { loadDocument, writeDocumentRawIf } from '../FileSystem'
import { appendVersionEntry, buildMapVersionEntry } from '../versionStore'
import { isMapPayload, normalizeMap, readMapViewport, serializeMap } from './mapModel'

/**
 * Load a map. A missing or corrupt file opens blank; a file that is something else
 * entirely comes back `foreign: true` with no map.
 */
export async function loadMapDocument(projectName, docPath) {
  const raw = await loadDocument(projectName, docPath)
  if (!isMapPayload(raw)) return { foreign: true, map: null, viewport: readMapViewport(null) }
  const map = normalizeMap(raw)
  return { foreign: false, map, viewport: map.viewport }
}

/** Write a map. Resolves to false (and writes nothing) when the file is not a map. */
export async function saveMapDocument(projectName, docPath, map, viewport) {
  try {
    const wrote = await writeDocumentRawIf(projectName, docPath, serializeMap(map, viewport), isMapPayload)
    if (!wrote) console.error('[saveMapDocument] refused: %s holds something other than a map.', docPath)
    return wrote
  } catch (error) {
    console.error('Failed to save map:', error)
    return false
  }
}

/** Checkpoint a map into its version history. */
export function appendMapVersion(projectName, docPath, map, { name = null, auto = true } = {}) {
  return appendVersionEntry(projectName, docPath, buildMapVersionEntry({ map, name, auto }))
}
