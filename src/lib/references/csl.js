/**
 * csl.js — a source record to CSL-JSON and back, and the parsing both directions need.
 *
 * A record keeps its details as flat strings by CSL variable name (`fields`), its
 * people as `contributors` with a role, and dates as ISO strings — the shape a form
 * edits. CSL-JSON wants names grouped by role and dates as `date-parts`; this is the
 * one place that knows the difference.
 */
import { kindForCslType, kindSpec } from './referenceKinds'

const DATE_FIELDS = ['issued', 'accessed', 'event-date', 'original-date']
const NUMBER_FIELDS = new Set(['volume', 'issue', 'number', 'edition', 'number-of-pages', 'page'])

/* ---------------- dates ---------------- */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n) => String(n).padStart(2, '0')

/**
 * Any date a page or an API gives — `2021-03-04T10:00:00Z`, `March 4, 2021`,
 * `4 Mar 2021`, `2021 Mar 4`, `2021/03`, `2021` — as an ISO date with as much precision
 * as it had, or '' when there is no year in it.
 */
export function normalizeDate(value) {
  if (value == null) return ''
  if (Array.isArray(value)) return partsToIso(value)
  if (typeof value === 'object') {
    if (Array.isArray(value['date-parts'])) return partsToIso(value['date-parts'][0] || [])
    if (value.raw) return normalizeDate(value.raw)
    if (value.literal) return normalizeDate(value.literal)
    return ''
  }
  const text = String(value).trim()
  if (!text) return ''
  let m = text.match(/^(\d{4})(?:[-/.](\d{1,2}))?(?:[-/.](\d{1,2}))?(?:$|T|\s+\d{1,2}:)/)
  if (m) return partsToIso([m[1], m[2], m[3]])
  const lower = text.toLowerCase()
  const year = lower.match(/\b(1[5-9]\d{2}|20\d{2})\b/)
  if (!year) return ''
  const monthIndex = MONTHS.findIndex((name) => new RegExp(`\\b${name}`).test(lower))
  if (monthIndex < 0) return year[1]
  const rest = lower.replace(year[1], ' ')
  m = rest.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/)
  return partsToIso([year[1], monthIndex + 1, m ? m[1] : undefined])
}

function partsToIso(parts) {
  const [y, mo, d] = parts.map((part) => (part == null || part === '' ? null : Number(part)))
  if (!y || !Number.isFinite(y)) return ''
  if (!mo || mo < 1 || mo > 12) return String(y)
  if (!d || d < 1 || d > 31) return `${y}-${pad(mo)}`
  return `${y}-${pad(mo)}-${pad(d)}`
}

const isoToParts = (iso) => {
  const parts = String(iso || '').split('-').map(Number).filter((n) => Number.isFinite(n) && n > 0)
  return parts.length ? { 'date-parts': [parts] } : null
}

export const todayIso = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

/* ---------------- names ---------------- */

const PARTICLES = new Set(['van', 'von', 'der', 'den', 'de', 'del', 'della', 'di', 'da', 'du', 'la', 'le', 'dos', 'das', 'bin', 'al', 'ter', 'ten'])
const SUFFIXES = /^(jr\.?|sr\.?|ii|iii|iv|phd|md)$/i
const ORGANISATION = /\b(inc|llc|ltd|corp|corporation|company|co\.|news|staff|team|editors|editorial|board|university|college|institute|association|society|organi[sz]ation|foundation|agency|department|ministry|council|committee|office|press|group|center|centre|bureau|commission|service|administration|reuters|associated press|wikipedia|contributors)\b/i

/** "Smith, Jane", "Jane Q. Smith", "Ludwig van Beethoven", "World Health Organization". */
export function parseName(raw, role = 'author') {
  const text = String(raw || '').replace(/\s+/g, ' ').replace(/^by\s+/i, '').trim()
  if (!text) return null
  if (ORGANISATION.test(text)) return { role, literal: text }
  if (text.includes(',')) {
    const [family, ...rest] = text.split(',').map((part) => part.trim())
    const given = rest.filter((part) => !SUFFIXES.test(part)).join(' ')
    if (family && given) return { role, family, given }
  }
  const words = text.split(' ')
  if (words.length === 1) return { role, literal: text }
  while (words.length > 2 && SUFFIXES.test(words[words.length - 1])) words.pop()
  let split = words.length - 1
  while (split > 1 && PARTICLES.has(words[split - 1].toLowerCase())) split -= 1
  return { role, given: words.slice(0, split).join(' '), family: words.slice(split).join(' ') }
}

/** "Smith J" or "Smith JA", as PubMed writes names. */
export const parsePubmedName = (raw, role = 'author') => {
  const m = String(raw || '').trim().match(/^(.+?)\s+([A-Z]{1,3})$/)
  if (!m) return parseName(raw, role)
  return { role, family: m[1], given: m[2].split('').join('. ') + '.' }
}

const cslName = (c) => (c.literal ? { literal: c.literal } : { family: c.family || '', given: c.given || '' })

export const contributorLabel = (c) => c?.literal || [c?.given, c?.family].filter(Boolean).join(' ')

/* ---------------- record → CSL ---------------- */

/** The CSL-JSON item citeproc formats a record as. */
export function toCsl(ref) {
  const spec = kindSpec(ref.kind)
  const item = { id: ref.id, type: spec.csl }
  for (const [key, value] of Object.entries(ref.fields || {})) {
    if (value == null || String(value).trim() === '') continue
    if (DATE_FIELDS.includes(key)) {
      const parts = isoToParts(value)
      if (parts) item[key] = parts
    } else {
      item[key] = String(value)
    }
  }
  for (const c of ref.contributors || []) {
    if (!c || (!c.literal && !c.family && !c.given)) continue
    const role = c.role || 'author'
    ;(item[role] = item[role] || []).push(cslName(c))
  }
  return item
}

/* ---------------- CSL → record ---------------- */

const NAME_ROLES = ['author', 'editor', 'translator', 'container-author', 'collection-editor', 'director', 'producer',
  'executive-producer', 'script-writer', 'performer', 'composer', 'host', 'guest', 'narrator', 'illustrator',
  'interviewer', 'recipient', 'curator']

const SKIP = new Set(['id', 'type', 'citation-key', 'source', 'license', 'reference', 'link', 'funder', 'assertion',
  'content-domain', 'indexed', 'deposited', 'created', 'member', 'prefix', 'score', 'references-count',
  'is-referenced-by-count', 'relation', 'subject', 'update-policy', 'journal-issue', 'short-container-title',
  'container-title-short', 'original-title', 'published', 'published-print', 'published-online', 'short-title',
  'alternative-id', 'archive_collection', 'categories', 'keyword', 'language', 'note'])

const stripTags = (value) => String(value).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

/** A CSL-JSON item (from doi.org, or anything that speaks CSL) as a record's parts. */
export function fromCsl(item) {
  const kind = kindForCslType(item.type)
  const fields = {}
  const contributors = []
  for (const [key, value] of Object.entries(item || {})) {
    if (SKIP.has(key) || value == null) continue
    if (NAME_ROLES.includes(key)) {
      for (const person of Array.isArray(value) ? value : []) {
        if (person.literal || person.name) contributors.push({ role: key, literal: person.literal || person.name })
        else if (person.family || person.given) {
          contributors.push({ role: key, family: person.family || '', given: person.given || '' })
        }
      }
    } else if (DATE_FIELDS.includes(key)) {
      const iso = normalizeDate(value)
      if (iso) fields[key] = iso
    } else if (typeof value === 'string' || typeof value === 'number') {
      const text = stripTags(value)
      if (text) fields[key] = text
    } else if (Array.isArray(value) && value.length && typeof value[0] === 'string') {
      fields[key] = stripTags(value[0])
    }
  }
  if (!fields.issued) {
    const fallback = normalizeDate(item['published-print'] || item['published-online'] || item.published)
    if (fallback) fields.issued = fallback
  }
  for (const key of NUMBER_FIELDS) if (fields[key]) fields[key] = String(fields[key])
  return { kind, contributors, fields }
}

/** A short "who · when · where" line to tell candidates apart. */
export function describe({ contributors = [], fields = {} }) {
  const people = contributors.slice(0, 2).map((c) => c.literal || c.family).filter(Boolean)
  const who = people.length ? people.join(', ') + (contributors.length > 2 ? ' et al.' : '') : ''
  const when = (fields.issued || '').slice(0, 4)
  const where = fields['container-title'] || fields.publisher || ''
  return [who, when, where].filter(Boolean).join(' · ')
}
