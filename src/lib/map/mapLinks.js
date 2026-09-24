/**
 * mapLinks.js — keeping maps' links to documents alive through renames and moves.
 *
 * A pin or traveller names its document by tree path. When that document (or a
 * folder above it) is renamed or moved, every map in the project that links to it
 * is rewritten on disk — and a `map:doc-moved` event tells any map open in a pane to
 * make the same change to what it holds, because its next autosave would otherwise
 * write the old path back.
 *
 * A delete rewrites nothing: the pin stays, marked missing, for the writer to relink.
 */
import { listProjectTree, loadDocument, writeDocumentRawIf } from '../FileSystem'
import { isMapDoc } from '../docKind'
import { isMapPayload, rewriteMapDocRefs } from './mapModel'

export const MAP_DOC_MOVED_EVENT = 'map:doc-moved'

const mapPaths = (node, out = []) => {
  if (!node) return out
  if (node.type === 'file') {
    if (isMapDoc(node.path)) out.push(node.path)
    return out
  }
  for (const child of node.children || []) mapPaths(child, out)
  return out
}

/** Rewrite links to `entryPath` (now `nextPath`) in every map. Resolves to the maps changed. */
export async function followMovedDoc(projectName, entryPath, nextPath, type = 'file') {
  if (!projectName || !entryPath || !nextPath || entryPath === nextPath) return []
  try {
    window.dispatchEvent(new CustomEvent(MAP_DOC_MOVED_EVENT, { detail: { projectName, entryPath, nextPath, type } }))
  } catch {
    void 0
  }
  const changed = []
  try {
    for (const path of mapPaths(await listProjectTree(projectName))) {
      const raw = await loadDocument(projectName, path)
      if (!isMapPayload(raw) || !raw) continue
      const { map, changed: touched } = rewriteMapDocRefs(raw, entryPath, nextPath, type)
      if (!touched) continue
      if (await writeDocumentRawIf(projectName, path, map, isMapPayload)) changed.push(path)
    }
  } catch (error) {
    console.error('[mapLinks] could not update maps after a move:', error)
  }
  return changed
}
