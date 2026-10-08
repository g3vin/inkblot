/**
 * timelineLinks.js — keeping the chronology's links alive through renames and moves.
 *
 * Events name documents by tree path: participants, a place, linked passages, notes,
 * map legs and canvas cards. When a document (or a folder above it) is renamed or
 * moved, the chronology is rewritten — undo snapshots too, so an undo afterwards does
 * not bring the old path back — and every timeline view document that filters on it.
 *
 * A delete rewrites nothing: the link stays, shown missing, for the writer to relink.
 */
import { listProjectTree, loadDocument, writeDocumentRawIf } from '../FileSystem'
import { isTimelineDoc } from '../docKind'
import { rewriteTimelineDocRefs, isTimelineViewPayload } from './timelineModel'
import { rewriteStoryTimeline } from './timelineStore'

export const TIMELINE_DOC_MOVED_EVENT = 'timeline:doc-moved'

const viewPaths = (node, out = []) => {
  if (!node) return out
  if (node.type === 'file') {
    if (isTimelineDoc(node.path)) out.push(node.path)
    return out
  }
  for (const child of node.children || []) viewPaths(child, out)
  return out
}

export const movedPath = (path, from, to, type) => {
  if (path === from) return to
  if (type === 'folder' && path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`
  return path
}

/** Rewrite links to `entryPath` (now `nextPath`) in the chronology and in every view. */
export async function followMovedDocInTimeline(projectName, entryPath, nextPath, type = 'file') {
  if (!projectName || !entryPath || !nextPath || entryPath === nextPath) return false
  let changed = false
  try {
    // A view open in a pane rewrites what it holds, or its next autosave writes the old path back.
    window.dispatchEvent(new CustomEvent(TIMELINE_DOC_MOVED_EVENT, { detail: { projectName, entryPath, nextPath, type } }))
  } catch {
    void 0
  }
  try {
    changed = await rewriteStoryTimeline(projectName, (timeline) => rewriteTimelineDocRefs(timeline, entryPath, nextPath, type))
    for (const path of viewPaths(await listProjectTree(projectName))) {
      const raw = await loadDocument(projectName, path)
      if (!isTimelineViewPayload(raw)) continue
      const participants = raw.filter?.participants
      if (!Array.isArray(participants)) continue
      const next = participants.map((item) => movedPath(item, entryPath, nextPath, type))
      if (next.every((item, index) => item === participants[index])) continue
      await writeDocumentRawIf(projectName, path, { ...raw, filter: { ...raw.filter, participants: next } }, isTimelineViewPayload)
      changed = true
    }
  } catch (error) {
    console.error('[timelineLinks] could not update the timeline after a move:', error)
  }
  return changed
}
