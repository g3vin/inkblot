/**
 * typesetHistory.ts — what a typeset is, apart from its text, and what changed between
 * two of them.
 *
 * A book's typesetting is kept apart from its writing, so either can go back without
 * the other. A snapshot holds only typesetting:
 *
 *   the book     its settings — setup, design, contents and their order, what is
 *                hidden, numbering, covers — less its title, author and language, which
 *                are the book's, not its setting
 *   each chapter its own page setup and head (the `doc` node's `pageSetup` and
 *                `chapter`), and what was set on its paragraphs and pictures, by each
 *                block's `typesetId` (TypesetAnchors.ts)
 *
 * Restoring one (`applyChapterTypeset`) sets those back onto the text as it is now —
 * written since or not — and says how many had no block left to go to.
 */
import { TYPESET_BLOCKS, typesetAttrsOf } from './TypesetAnchors'

interface PMJSON { type: string; attrs?: Record<string, unknown>; content?: PMJSON[]; text?: string }

/** A chapter's typesetting. */
export interface ChapterTypeset {
  pageSetup: unknown
  chapter: unknown
  blocks: Record<string, Record<string, unknown>>
}

export interface TypesetSnapshot {
  book: Record<string, unknown>
  chapters: Record<string, ChapterTypeset>
}

export type TypesetEntryKind = 'auto' | 'named' | 'export' | 'restore'

export interface TypesetEntry {
  id: string
  timestamp: string
  kind: TypesetEntryKind
  name?: string
  summary: string[]
  snapshot: TypesetSnapshot
}

/** The book's own, not its setting: never restored with a typeset. */
const NOT_TYPESET = new Set(['folder', 'title', 'author', 'language'])

/** Automatic entries a book keeps; named ones and exports are kept however many. */
export const AUTO_CAP = 60

/** A chapter's typesetting, from its content. */
export const chapterTypesetOf = (content: PMJSON | null | undefined): ChapterTypeset => {
  const blocks: Record<string, Record<string, unknown>> = {}
  const walk = (node: PMJSON) => {
    const id = node.attrs?.typesetId as string | undefined
    if (id && node.type in TYPESET_BLOCKS) blocks[id] = typesetAttrsOf(node)
    for (const child of node.content || []) walk(child)
  }
  if (content) walk(content)
  return { pageSetup: content?.attrs?.pageSetup ?? null, chapter: content?.attrs?.chapter ?? null, blocks }
}

/** A book's typesetting: its settings, and each chapter's. */
export const snapshotOf = (book: Record<string, unknown>, chapters: Record<string, PMJSON | null>): TypesetSnapshot => {
  const typesetBook: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(book || {})) if (!NOT_TYPESET.has(key)) typesetBook[key] = value
  const out: Record<string, ChapterTypeset> = {}
  for (const [path, content] of Object.entries(chapters)) out[path] = chapterTypesetOf(content)
  return { book: typesetBook, chapters: out }
}

/** A value's canonical text, key order and all, for comparing. */
const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) => (
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
    : v
))

export const sameSnapshot = (a: TypesetSnapshot | null | undefined, b: TypesetSnapshot | null | undefined): boolean => (
  Boolean(a && b) && canonical(a) === canonical(b)
)

/* ---------------- what changed ---------------- */

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {})
const mm = (v: unknown) => `${Math.round(Number(v) * 10) / 10} mm`
const text = (v: unknown) => (v === '' || v == null ? 'none' : String(v))

const MARGIN_NAMES: Record<string, string> = {
  topMm: 'Top margin', bottomMm: 'Bottom margin', insideMm: 'Inside margin', outsideMm: 'Outside margin', gutterMm: 'Gutter',
}
const TYPE_NAMES: Record<string, [string, (v: unknown) => string]> = {
  fontFamily: ['Font', (v) => String(v).split(',')[0].replace(/"/g, '').trim()],
  fontSizePt: ['Type size', (v) => `${v} pt`],
  lineValue: ['Leading', (v) => String(v)],
  lineSpacing: ['Line spacing', text],
  alignment: ['Alignment', text],
  hyphenate: ['Hyphenation', (v) => (v ? 'on' : 'off')],
  sceneBreak: ['Scene break', (v) => (v ? String(v) : 'a blank line')],
  chapterOpening: ['Chapter opening', text],
  chapterSinkMm: ['Chapter head', mm],
  firstLineIndentMm: ['Indent', mm],
}

const setupChanges = (a: Obj, b: Obj, where = ''): string[] => {
  const out: string[] = []
  const prefix = where ? `${where}: ` : ''
  if (a.presetId !== b.presetId || a.widthMm !== b.widthMm || a.heightMm !== b.heightMm) {
    out.push(`${prefix}Trim ${Math.round(Number(b.widthMm))} × ${Math.round(Number(b.heightMm))} mm`)
  }
  const ma = obj(a.margins)
  const mb = obj(b.margins)
  for (const [key, name] of Object.entries(MARGIN_NAMES)) {
    if (ma[key] !== mb[key] && ma[key] !== undefined && mb[key] !== undefined) out.push(`${prefix}${name} ${mm(ma[key])} → ${mm(mb[key])}`)
  }
  const ta = obj(a.typography)
  const tb = obj(b.typography)
  if (!a.typography && b.typography) out.push(`${prefix}Type set for print`)
  else if (a.typography && !b.typography) out.push(`${prefix}Type no longer set`)
  else {
    for (const [key, [name, show]] of Object.entries(TYPE_NAMES)) {
      if (ta[key] !== tb[key]) out.push(`${prefix}${name} ${show(ta[key])} → ${show(tb[key])}`)
    }
  }
  if (canonical([a.header, a.versoHeader]) !== canonical([b.header, b.versoHeader])) out.push(`${prefix}Running heads`)
  if (canonical([a.footer, a.versoFooter, a.pageNumberFormat, a.pageNumberStart]) !== canonical([b.footer, b.versoFooter, b.pageNumberFormat, b.pageNumberStart])) {
    out.push(`${prefix}Folios`)
  }
  if (a.headerDistanceMm !== b.headerDistanceMm || a.footerDistanceMm !== b.footerDistanceMm) out.push(`${prefix}Running heads moved`)
  if (a.mirrorMargins !== b.mirrorMargins) out.push(`${prefix}Facing pages ${b.mirrorMargins ? 'on' : 'off'}`)
  return out
}

const itemName = (item: Obj): string => String(item.title || item.matter || item.generated || String(item.path || '').split('/').pop() || 'An entry')

/** What changed from one typeset to the next, a line a change, as the history lists it. */
export const typesetDiff = (before: TypesetSnapshot | null | undefined, after: TypesetSnapshot): string[] => {
  if (!before) return ['Typesetting begun']
  const out: string[] = []
  const a = before.book
  const b = after.book
  const da = obj(a.chapterDesign)
  const db = obj(b.chapterDesign)
  if (da.styleId !== db.styleId && db.styleId) out.push(`Style ${text(da.styleId ?? 'own')} → ${db.styleId}`)
  else if (canonical(da) !== canonical(db)) out.push('Chapter openings')
  if (canonical(a.chapterNumbering) !== canonical(b.chapterNumbering)) out.push('Chapter numbers')
  if (canonical(a.pageSetup) !== canonical(b.pageSetup)) {
    out.push(...(a.pageSetup && b.pageSetup ? setupChanges(obj(a.pageSetup), obj(b.pageSetup)) : [b.pageSetup ? 'The book’s own setup' : 'Each chapter’s own setup']))
  }
  const ia = (Array.isArray(a.items) ? a.items : []) as Obj[]
  const ib = (Array.isArray(b.items) ? b.items : []) as Obj[]
  const byIdA = new Map(ia.map((it) => [it.id, it]))
  const byIdB = new Map(ib.map((it) => [it.id, it]))
  for (const item of ib) if (!byIdA.has(item.id) && ia.length) out.push(`${itemName(item)} added`)
  for (const item of ia) if (!byIdB.has(item.id) && ib.length) out.push(`${itemName(item)} removed`)
  for (const item of ib) {
    const was = byIdA.get(item.id)
    if (was && Boolean(was.hidden) !== Boolean(item.hidden)) out.push(`${itemName(item)} ${item.hidden ? 'hidden' : 'shown'}`)
    if (was && was.chapterType !== item.chapterType) out.push(`${itemName(item)} made ${item.chapterType || 'a chapter'}`)
  }
  const orderA = ia.map((it) => it.id).filter((id) => byIdB.has(id))
  const orderB = ib.map((it) => it.id).filter((id) => byIdA.has(id))
  if (orderA.join('\u0000') !== orderB.join('\u0000')) out.push('Contents reordered')
  if (canonical([a.covers, a.activeCover]) !== canonical([b.covers, b.activeCover])) out.push('Cover')
  if (canonical(a.editions) !== canonical(b.editions) || a.activeEdition !== b.activeEdition) out.push('Editions')
  if (canonical(a.textStyles) !== canonical(b.textStyles)) out.push('Text styles')
  if (canonical(a.notes) !== canonical(b.notes)) out.push('Notes')

  let blockChanges = 0
  for (const [path, ch] of Object.entries(after.chapters)) {
    const was = before.chapters[path]
    const name = path.split('/').pop() || path
    if (!was) continue
    if (canonical(was.pageSetup) !== canonical(ch.pageSetup)) {
      out.push(...(was.pageSetup && ch.pageSetup ? setupChanges(obj(was.pageSetup), obj(ch.pageSetup), name) : [`${name}: its own setup`]))
    }
    const ma = obj(was.chapter)
    const mb = obj(ch.chapter)
    if (ma.subtitle !== mb.subtitle) out.push(`${name}: subtitle ${mb.subtitle ? (ma.subtitle ? 'changed' : 'added') : 'removed'}`)
    if (ma.image !== mb.image) out.push(`${name}: picture ${mb.image ? (ma.image ? 'changed' : 'added') : 'removed'}`)
    if (ma.epigraph !== mb.epigraph) out.push(`${name}: epigraph`)
    for (const id of new Set([...Object.keys(was.blocks), ...Object.keys(ch.blocks)])) {
      if (canonical(was.blocks[id] || {}) !== canonical(ch.blocks[id] || {})) blockChanges += 1
    }
  }
  if (blockChanges) out.push(`${blockChanges} ${blockChanges === 1 ? 'paragraph or picture' : 'paragraphs and pictures'} set`)
  return out.length ? out : ['No change to the typesetting']
}

/* ---------------- restoring ---------------- */

/** A block's typeset attributes set to `target`, the rest back to their defaults. */
const withBlockTypeset = (node: PMJSON, target: Record<string, unknown> | undefined): PMJSON => {
  const keys = TYPESET_BLOCKS[node.type] || []
  const attrs = { ...(node.attrs || {}) }
  for (const key of keys) {
    if (target && key in target) attrs[key] = target[key]
    else if (key in attrs) attrs[key] = null
  }
  return { ...node, attrs }
}

/**
 * A chapter's content with a typeset's settings put back on it: its page setup and head,
 * and each typeset block's attributes by its id. The text is not touched. `orphans` is
 * how many of the typeset's blocks are no longer in the chapter.
 */
export const applyChapterTypeset = (content: PMJSON, typeset: ChapterTypeset | null | undefined): { content: PMJSON; orphans: number } => {
  const target = typeset || { pageSetup: null, chapter: null, blocks: {} }
  const found = new Set<string>()
  const walk = (node: PMJSON): PMJSON => {
    const id = node.attrs?.typesetId as string | undefined
    let next = node
    if (id && node.type in TYPESET_BLOCKS) {
      if (target.blocks[id]) found.add(id)
      next = withBlockTypeset(node, target.blocks[id])
    }
    return next.content ? { ...next, content: next.content.map(walk) } : next
  }
  const walked = walk(content)
  const attrs = { ...(walked.attrs || {}), pageSetup: target.pageSetup ?? null, chapter: target.chapter ?? null }
  return {
    content: { ...walked, attrs },
    orphans: Object.keys(target.blocks).filter((id) => !found.has(id)).length,
  }
}

/** A book with a typeset's settings put back, keeping what is its own: title, author. */
export const restoreBook = <B extends Record<string, unknown>>(current: B, snapshot: TypesetSnapshot): B => {
  const out: Record<string, unknown> = {}
  for (const key of NOT_TYPESET) if (key in current) out[key] = current[key]
  return { ...snapshot.book, ...out } as B
}

/** An entry added to a book's history, oldest automatic entries evicted past the cap. */
export const pushEntry = (entries: TypesetEntry[], entry: TypesetEntry, cap = AUTO_CAP): TypesetEntry[] => {
  const next = [...entries, entry]
  let autos = next.filter((e) => e.kind === 'auto').length
  return next.filter((e) => {
    if (e.kind !== 'auto' || autos <= cap) return true
    autos -= 1
    return false
  })
}
