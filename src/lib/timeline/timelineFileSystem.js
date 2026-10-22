/**
 * timelineFileSystem.js — persistence for timeline view documents.
 *
 * A view lives at `<projectRoot>/<path>.json`, its tree path carrying `.timeline`. It
 * holds how the chronology is shown — scale, range, filters — never the events, which
 * are the project's (`.story/timeline.json`, timelineStore.js).
 *
 * As with maps, a save refuses to overwrite a file that is not a view: `.timeline` is a
 * suffix a writer may already have used for a chapter. Such a file loads `foreign`.
 */
import { loadDocument, writeDocumentRawIf } from '../FileSystem'
import { createEmptyTimelineView, isTimelineViewPayload, normalizeTimelineView } from './timelineModel'

export async function loadTimelineView(projectName, docPath) {
  const raw = await loadDocument(projectName, docPath)
  if (!isTimelineViewPayload(raw)) return { foreign: true, view: null }
  return { foreign: false, view: raw ? normalizeTimelineView(raw) : createEmptyTimelineView() }
}

/** Write a view. Resolves to false (and writes nothing) when the file is not a view. */
export async function saveTimelineView(projectName, docPath, view) {
  try {
    const wrote = await writeDocumentRawIf(projectName, docPath, normalizeTimelineView(view), isTimelineViewPayload)
    if (!wrote) console.error('[saveTimelineView] refused: %s holds something other than a timeline.', docPath)
    return wrote
  } catch (error) {
    console.error('Failed to save timeline view:', error)
    return false
  }
}
