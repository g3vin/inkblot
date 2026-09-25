/**
 * formats.ts — whole page setups by name: the Page tab's Format menu.
 *
 * Defined once, here, and published to every shell in the catalog
 * (`PageLayoutCatalog.formats`); a shell applies one by id (`applyFormat`) and the page
 * builds it. So "Trade Paperback 6 × 9" is the same setup in the Swift inspector, the
 * Tauri sheet and the tests — which is not what happened when each shell had its own
 * "Set Up as a Book".
 *
 * A setup remembers the format it was made from (`formatId`), so after the author
 * changes a margin the inspector can still say what it started as: "(modified)".
 */
import { FormatKind } from '../types'
import type { FormatOption, PageSetup } from '../types'
import { DEFAULT_PAGE_SETUP, bookPageSetup, normalizePageSetup } from './pageSetup'
import { getPageSizePreset } from './pageSizes'

export interface FormatPreset extends FormatOption {
  build: () => PageSetup
}

/** A plain page of a paper size: the default setup on it. */
const plainPage = (presetId: string): PageSetup => {
  const preset = getPageSizePreset(presetId)!
  return { ...structuredClone(DEFAULT_PAGE_SETUP), presetId, widthMm: preset.widthMm, heightMm: preset.heightMm }
}

const GROUP_EVERYDAY = 'Everyday'
const GROUP_BOOK = 'Books'

export const FORMAT_PRESETS: FormatPreset[] = [
  {
    id: 'letter',
    label: 'US Letter',
    group: GROUP_EVERYDAY,
    summary: 'A plain page with one-inch margins and a page number at the foot.',
    kind: FormatKind.Prose,
    build: () => plainPage('letter'),
  },
  {
    id: 'a4',
    label: 'A4',
    group: GROUP_EVERYDAY,
    summary: 'A plain page with 25 mm margins and a page number at the foot.',
    kind: FormatKind.Prose,
    build: () => plainPage('a4'),
  },
  {
    id: 'trade-6x9',
    label: 'Trade Paperback 6 × 9 in',
    group: GROUP_BOOK,
    summary: 'The common US novel size: mirrored margins, running heads, chapters opening on the right.',
    kind: FormatKind.Prose,
    build: () => bookPageSetup('trade-6x9'),
  },
  {
    id: 'trade-5.5x8.5',
    label: 'Digest 5.5 × 8.5 in',
    group: GROUP_BOOK,
    summary: 'A smaller trade paperback, common for memoir, poetry and novellas.',
    kind: FormatKind.Prose,
    build: () => bookPageSetup('digest'),
  },
  {
    id: 'trade-5x8',
    label: 'Trade 5 × 8 in',
    group: GROUP_BOOK,
    summary: 'A compact trade paperback, popular for fiction.',
    kind: FormatKind.Prose,
    build: () => bookPageSetup('trade-5x8'),
  },
  {
    id: 'b-format',
    label: 'UK B-Format',
    group: GROUP_BOOK,
    summary: 'The standard British paperback, 129 × 198 mm.',
    kind: FormatKind.Prose,
    build: () => bookPageSetup('b-format'),
  },
  {
    id: 'a5-novel',
    label: 'A5 Novel',
    group: GROUP_BOOK,
    summary: 'A book on A5, which any home printer can make two to a sheet of A4.',
    kind: FormatKind.Prose,
    build: () => bookPageSetup('a5'),
  },
]

const BY_ID = new Map(FORMAT_PRESETS.map((f) => [f.id, f]))

export const getFormat = (id: string | null | undefined): FormatPreset | null => (id && BY_ID.get(id)) || null

/** The catalog's formats, as they cross the bridge. */
export const FORMAT_OPTIONS: FormatOption[] = FORMAT_PRESETS.map(({ id, label, group, summary, kind }) => ({
  id, label, group, summary, kind,
}))

/** A format's setup, marked as made from it. Null for an id the catalog lacks. */
export const applyFormat = (id: string): PageSetup | null => {
  const format = getFormat(id)
  if (!format) return null
  return normalizePageSetup({ ...format.build(), formatId: format.id })
}

/**
 * Two setups that lay out the same, whichever format either says it came from. Lengths
 * are compared to the micrometre: 8.5 in and 215.9 mm are the same page, though
 * `8.5 * 25.4` is not quite `215.9`.
 */
const sameLayout = (a: PageSetup, b: PageSetup): boolean => {
  const strip = (s: PageSetup) => JSON.stringify(
    { ...normalizePageSetup(s), formatId: undefined },
    (_key, value) => (typeof value === 'number' ? Math.round(value * 1000) / 1000 : value)
  )
  return strip(a) === strip(b)
}

/**
 * Which format a setup is, and whether it has been changed since. A setup that names
 * no format is matched against them all, so a document set up by hand as a plain
 * Letter page still reads as "US Letter".
 */
export const formatOf = (setup: PageSetup | null | undefined): { formatId: string | null, modified: boolean } => {
  if (!setup) return { formatId: null, modified: false }
  const named = getFormat(setup.formatId)
  if (named) return { formatId: named.id, modified: !sameLayout(named.build(), setup) }
  const match = FORMAT_PRESETS.find((f) => sameLayout(f.build(), setup))
  return { formatId: match?.id ?? null, modified: false }
}
