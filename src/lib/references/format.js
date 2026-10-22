/**
 * format.js — citations and bibliographies, formatted by citeproc-js.
 *
 * citeproc is the reference CSL processor (it is what Zotero runs), so the output is
 * the style's, including the parts that only come out right when a document is
 * formatted whole: numbering in order of first citation, "ibid." and shortened
 * subsequent notes, and disambiguation (Smith 2020a, 2020b). That is why a document's
 * citations go through `formatDocument` together rather than one at a time.
 *
 * Every function here is synchronous and needs its style loaded first (`loadStyle`).
 * Output is HTML with only `i`, `b`, `sup`, `sub` and `span.sc` in it (`tidy`), which
 * the editor, the print path and the shell's panel can all render.
 */
import CSL from 'citeproc'
import { enLocaleXml, styleSpec, styleXml } from './styles'
import { toCsl } from './csl'

/* ---------------- engines ---------------- */

const engines = new Map()

/**
 * One engine per style and purpose, so the panel's formatting of the whole library
 * never disturbs the numbering of a document's. `items` is swapped in before each use.
 */
function engineFor(styleId, purpose) {
  const spec = styleSpec(styleId)
  const key = `${spec.id}:${purpose}`
  let entry = engines.get(key)
  if (!entry) {
    const xml = styleXml(spec.id)
    const locale = enLocaleXml()
    if (!xml || !locale) throw new Error(`citation style ${spec.id} is not loaded`)
    const sys = {
      items: new Map(),
      retrieveLocale: () => locale,
      retrieveItem(id) { return this.items.get(id) },
    }
    const engine = new CSL.Engine(sys, xml, 'en-US', true)
    engine.setOutputFormat('html')
    entry = { engine, sys }
    engines.set(key, entry)
  }
  return entry
}

/* ---------------- html ---------------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

const decodeEntities = (text) => text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
  if (code[0] === '#') {
    const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
    return Number.isFinite(n) ? String.fromCodePoint(n) : whole
  }
  return ENTITIES[code.toLowerCase()] ?? whole
})

export const escapeHtml = (text) => String(text ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const ALLOWED = /^(i|b|sup|sub)$/

/** citeproc's HTML reduced to inline formatting, entities decoded but `&<>` kept safe. */
export function tidy(html) {
  const out = []
  const stack = []
  const re = /<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi
  let m
  while ((m = re.exec(String(html || '')))) {
    if (m[4] != null) {
      out.push(escapeHtml(decodeEntities(m[4].replace(/\s*\n\s*/g, ' '))))
      continue
    }
    const [, closing, rawTag, attrs] = m
    const tag = rawTag.toLowerCase()
    if (closing) {
      const open = stack.pop()
      if (open) out.push(`</${open}>`)
      if (tag === 'div') out.push(' ')
      continue
    }
    if (ALLOWED.test(tag)) {
      stack.push(tag)
      out.push(`<${tag}>`)
    } else if (tag === 'span' && /small-caps/.test(attrs)) {
      stack.push('span')
      out.push('<span class="sc">')
    } else if (tag === 'br') {
      out.push(' ')
    } else {
      // A div or a plain span: its text stays, the element does not.
      stack.push(null)
    }
  }
  return out.join('').replace(/\s+/g, ' ').trim()
}

export const htmlToText = (html) => decodeEntities(String(html || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

/* ---------------- a document ---------------- */

const citationItem = (item) => {
  const out = { id: item.refId }
  if (item.locator) {
    out.locator = String(item.locator)
    out.label = item.label || 'page'
  }
  if (item.prefix) out.prefix = item.prefix
  if (item.suffix) out.suffix = item.suffix
  if (item.suppressAuthor) out['suppress-author'] = true
  return out
}

export const MISSING_SOURCE = '[missing source]'

/**
 * Format a document's citations and its bibliography.
 *
 * `clusters` are its citations in document order, `{ id, items: [{ refId, locator,
 * label, prefix, suffix, suppressAuthor }] }`. `references` is every source the
 * document can see, by id. The bibliography lists the cited sources, plus the attached
 * ones when `include` is `attached`.
 *
 * Returns `{ citations: Map<clusterId, html>, notes: [{ number, html }], entries:
 * [{ id, html }], noteStyle }`. Under a note style each citation is its note's number,
 * and `notes` holds the notes themselves.
 */
export function formatDocument({ styleId, references, clusters, include = 'cited', attachedIds = [], annotated = false }) {
  const spec = styleSpec(styleId)
  const { engine, sys } = engineFor(spec.id, 'document')
  sys.items = new Map()
  for (const [id, ref] of references) sys.items.set(id, toCsl(ref))

  const known = clusters.map((cluster) => ({
    ...cluster,
    items: (cluster.items || []).filter((item) => sys.items.has(item.refId)),
  }))
  const citable = known.filter((cluster) => cluster.items.length)
  const citations = new Map()
  const notes = []

  let rendered = []
  try {
    rendered = engine.rebuildProcessorState(citable.map((cluster, index) => ({
      citationID: cluster.id,
      citationItems: cluster.items.map(citationItem),
      properties: { noteIndex: spec.noteStyle ? index + 1 : 0 },
    })), 'html')
  } catch (error) {
    console.error('[references] could not format citations', error)
  }
  for (const [id, noteIndex, html] of rendered) {
    if (spec.noteStyle) {
      citations.set(id, `<sup>${noteIndex}</sup>`)
      notes.push({ number: noteIndex, html: tidy(html) })
    } else {
      citations.set(id, tidy(html))
    }
  }
  for (const cluster of known) if (!citations.has(cluster.id)) citations.set(cluster.id, MISSING_SOURCE)

  const cited = new Set(citable.flatMap((cluster) => cluster.items.map((item) => item.refId)))
  const uncited = include === 'attached' ? attachedIds.filter((id) => sys.items.has(id) && !cited.has(id)) : []
  engine.updateUncitedItems(uncited)
  const entries = bibliographyEntries(engine, references, annotated)
  return { citations, notes, entries, noteStyle: spec.noteStyle }
}

function bibliographyEntries(engine, references, annotated) {
  let result
  try {
    result = engine.makeBibliography()
  } catch (error) {
    console.error('[references] could not format the bibliography', error)
    return []
  }
  if (!result) return []
  const [params, html] = result
  return html.map((entry, index) => {
    const id = [].concat(params.entry_ids[index])[0]
    const annotation = annotated ? String(references.get(id)?.annotation || '').trim() : ''
    return { id, html: tidy(entry), annotation }
  })
}

/* ---------------- the library, for the panel ---------------- */

/**
 * Each source formatted on its own terms: its bibliography entry, and how a citation
 * of it reads. Numbers in numeric styles are the library's, which is only a preview.
 */
export function formatLibrary({ styleId, references }) {
  const spec = styleSpec(styleId)
  const { engine, sys } = engineFor(spec.id, 'library')
  sys.items = new Map()
  for (const ref of references) sys.items.set(ref.id, toCsl(ref))
  const out = new Map()
  if (!references.length) return out
  try {
    engine.updateItems([])
    engine.updateUncitedItems(references.map((ref) => ref.id))
  } catch (error) {
    console.error('[references] could not load the library', error)
    return out
  }
  for (const entry of bibliographyEntries(engine, new Map(), false)) {
    out.set(entry.id, { entryHtml: entry.html, entryText: htmlToText(entry.html), inText: '' })
  }
  for (const ref of references) {
    let inText
    try {
      inText = htmlToText(engine.previewCitationCluster(
        { citationItems: [{ id: ref.id }], properties: { noteIndex: spec.noteStyle ? 1 : 0 } }, [], [], 'html'
      ))
    } catch {
      inText = ''
    }
    const current = out.get(ref.id) || { entryHtml: '', entryText: '', inText: '' }
    out.set(ref.id, { ...current, inText })
  }
  return out
}
