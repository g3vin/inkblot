/**
 * manuscript.js — the passages a reader meets, in the order they meet them.
 *
 * Reading order is the book's: documents depth-first in the file tree's saved order,
 * the same order Print and Export compile (print/compile.ts), and inside a document
 * the order of its text. Only documents that hold a timeline passage take part.
 */
import { loadDocument } from '../FileSystem'
import { listBookChapters } from '../../print/compile'
import { liveRanges, normalizeRanges } from './timelineRanges'

/**
 * `{ docs, passages }`: the documents in reading order, and every passage as
 * `{ doc, docIndex, id, eventId, from, to, anchor }`. `folder` limits it to one part
 * of the project ('' for all of it).
 */
export async function loadManuscriptPassages(projectName, folder = '') {
  const docs = []
  const passages = []
  if (!projectName) return { docs, passages }
  let paths = []
  try {
    paths = await listBookChapters(projectName, folder)
  } catch (error) {
    console.warn('[manuscript] could not list the documents:', error)
    return { docs, passages }
  }
  for (const doc of paths) {
    let ranges = liveRanges(projectName, doc)
    if (!ranges) {
      const raw = await loadDocument(projectName, doc)
      ranges = normalizeRanges(raw?.timeline)
    }
    if (!ranges.length) continue
    const docIndex = docs.length
    docs.push(doc)
    for (const range of ranges) passages.push({ doc, docIndex, id: range.id, eventId: range.eventId, from: range.from, to: range.to, anchor: range.anchor })
  }
  return { docs, passages }
}
