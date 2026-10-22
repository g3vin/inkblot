/**
 * timelineRanges.js — passages of text attached to timeline events.
 *
 * A range lives in its document, beside the notes: `timeline: [{ id, eventId, from,
 * to, anchor }]`, ProseMirror positions plus the text they covered. It has to: the
 * positions move with every keystroke (useEditorTimeline.js maps them through each
 * transaction) and must be saved together with the content they point into. The
 * chronology's `{ kind: 'text', doc }` link is only the index — which documents hold a
 * passage of an event — so nothing ever scans every document to draw a view.
 *
 * An open document's ranges run ahead of its file until the autosave, so the editor
 * publishes them here (`publishLiveRanges`) and readers take the live copy first.
 */
import { newId } from '../map/mapModel'

export const TIMELINE_RANGES_CHANGED_EVENT = 'timeline:ranges-changed'

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Anything → a document's ranges: whole, positive, and in document order. */
export function normalizeRanges(raw) {
  const seen = new Set()
  return (Array.isArray(raw) ? raw : [])
    .filter((range) => isObject(range) && typeof range.eventId === 'string' && range.eventId && Number.isInteger(range.from) && Number.isInteger(range.to) && range.to > range.from && range.from >= 0)
    .map((range) => {
      let id = typeof range.id === 'string' && range.id ? range.id : newId()
      while (seen.has(id)) id = newId()
      seen.add(id)
      return { ...range, id, anchor: typeof range.anchor === 'string' ? range.anchor : '' }
    })
    .sort((a, b) => a.from - b.from || a.to - b.to)
}

/** projectName → docPath → ranges, for documents open in an editor. */
const live = new Map()

export function publishLiveRanges(projectName, docPath, ranges) {
  if (!projectName || !docPath) return
  let docs = live.get(projectName)
  if (!docs) {
    docs = new Map()
    live.set(projectName, docs)
  }
  docs.set(docPath, ranges)
  window.dispatchEvent(new CustomEvent(TIMELINE_RANGES_CHANGED_EVENT, { detail: { projectName, docPath, ranges } }))
}

export function forgetLiveRanges(projectName, docPath) {
  live.get(projectName)?.delete(docPath)
}

export const liveRanges = (projectName, docPath) => live.get(projectName)?.get(docPath) ?? null
