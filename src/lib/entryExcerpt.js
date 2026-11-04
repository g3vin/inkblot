/**
 * entryExcerpt.js — the opening words of a story entry, for its hover card
 * (EntityPreview.jsx): a document's first blocks, or a canvas's first text cards.
 * Read when the card opens, so it is never stale; a canvas is read raw, as JSON
 * Canvas, without building its model.
 */
import { getDocKind } from './docKind'
import { excerptOfContent } from './docExcerpts'
import { loadDocument } from './FileSystem'

const EXCERPT_CHARS = 220

const clip = (text) => (text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS - 1).trimEnd()}…` : text)

/** The opening words of an entry: a document's first blocks, or a canvas's first cards. */
export async function entryExcerpt(projectName, path) {
  const raw = await loadDocument(projectName, path)
  if (!raw) return ''
  if (getDocKind(path) === 'canvas') {
    const cards = (Array.isArray(raw.nodes) ? raw.nodes : []).filter((node) => node?.type === 'text' && typeof node.text === 'string')
    return clip(cards.map((node) => node.text.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · '))
  }
  return clip(excerptOfContent(raw.content).map((block) => block.x).join(' '))
}
