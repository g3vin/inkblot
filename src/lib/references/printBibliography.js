/**
 * printBibliography.js — the bibliography on paper, for documents that keep none in
 * the text.
 *
 * A writer can have the bibliography live at the end of the document (the
 * `bibliography` node, printed like any other block) or only in printouts and exports
 * (`inPrint` in the document's settings). This adds the second kind as the chapters
 * are gathered for a print or an export (`loadChapters`), so every output path gets it.
 *
 * A book printed whole gets one bibliography, at its end, for every chapter that asks
 * for one — the way a book has one bibliography, not one per chapter. Those chapters'
 * citations are formatted together, and rewritten, so that numbering (IEEE, AMA,
 * Vancouver) and notes (Chicago) run through the book the way they will in the
 * bibliography. Under a note style each chapter ends with its own notes.
 *
 * Chapters this touches are marked `printBibliography`, which tells the print job not
 * to reuse the live on-screen layout of that document: what is on paper differs.
 */
import { bibliographyAttrs, collectCitationsJson } from '../../extensions/Citation'
import { formatDocument } from './format'
import { getDocCitations, loadLibrary } from './referenceStore'
import { loadStyle } from './styles'

const withRenderedCitations = (node, next, noteStyle) => {
  if (!node || typeof node !== 'object') return node
  if (node.type === 'citation') return { ...node, attrs: { ...(node.attrs || {}), rendered: next(), noteStyle } }
  if (!node.content) return node
  return { ...node, content: node.content.map((child) => withRenderedCitations(child, next, noteStyle)) }
}

const appendBlock = (content, block) => ({ ...content, content: [...(content.content || []), block] })

/**
 * `chapters` as `loadChapters` returns them, with print-only bibliographies added.
 * Returns the same array when there is nothing to add.
 */
export async function withPrintBibliography(projectName, chapters) {
  if (!projectName || !chapters?.length) return chapters
  const library = await loadLibrary(projectName)
  if (!library.references.length) return chapters

  const wanting = []
  for (const [index, chapter] of chapters.entries()) {
    const { clusters, hasBibliography } = collectCitationsJson(chapter.content)
    if (hasBibliography) continue
    const settings = await getDocCitations(projectName, chapter.path)
    if (!settings.bibliography.inPrint) continue
    const attached = library.attachments[chapter.path] || []
    const listsAttached = settings.bibliography.include === 'attached' && attached.length
    if (!clusters.length && !listsAttached) continue
    wanting.push({ index, clusters, settings, attached })
  }
  if (!wanting.length) return chapters

  // The book takes the first asking chapter's style and options.
  const { settings } = wanting[0]
  const spec = await loadStyle(settings.style || library.defaultStyle)
  const clusters = wanting.flatMap((w) => w.clusters)
  const result = formatDocument({
    styleId: spec.id,
    references: new Map(library.references.map((ref) => [ref.id, ref])),
    clusters: clusters.map((items, k) => ({ id: `p${k}`, items })),
    include: settings.bibliography.include,
    attachedIds: [...new Set(wanting.flatMap((w) => w.attached))],
    annotated: Boolean(settings.bibliography.annotated),
  })

  const out = [...chapters]
  let k = 0
  let noteCursor = 0
  wanting.forEach((w, position) => {
    const chapter = out[w.index]
    const first = k
    let content = withRenderedCitations(chapter.content, () => result.citations.get(`p${k++}`) || '', spec.noteStyle)
    if (spec.noteStyle && w.clusters.length && position < wanting.length - 1) {
      // Each chapter's notes at its end; the last chapter's go with the bibliography.
      const notes = result.notes.slice(noteCursor, noteCursor + (k - first)).map((note) => note.html)
      noteCursor += k - first
      content = appendBlock(content, { type: 'bibliography', attrs: { title: 'Notes', notes, entries: [], hanging: true } })
    }
    if (position === wanting.length - 1) {
      const attrs = bibliographyAttrs(result, { styleId: spec.id, options: settings.bibliography })
      if (spec.noteStyle) attrs.notes = attrs.notes.slice(noteCursor)
      content = appendBlock(content, { type: 'bibliography', attrs })
    }
    out[w.index] = { ...chapter, content, printBibliography: true }
  })
  return out
}
