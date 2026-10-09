/**
 * formats.ts — whole page setups by name: the Page tab's Format menu.
 *
 * Defined once, here, and published to every shell in the catalog
 * (`PageLayoutCatalog.formats`); a shell applies one by id (`applyFormat`) and the page
 * builds it. So "Trade Paperback 6 × 9" is the same setup in the Typeset tab, the Page
 * Setup sheet and the tests.
 *
 * A setup remembers the format it was made from (`formatId`), so after the author
 * changes a margin the inspector can still say what it started as: "(modified)".
 */
import { ChapterOpening, FormatKind, LineSpacing, PrintAlignment, TitlePageStyle } from '../types'
import type { FormatOption, PageSetup } from '../types'
import { DEFAULT_PAGE_SETUP, bookPageSetup, normalizePageSetup } from './pageSetup'
import { getPageSizePreset } from './pageSizes'
import { BOOK_TYPOGRAPHY, COURIER, TIMES, manuscriptTypography } from './typography'

export interface FormatPreset extends FormatOption {
  build: () => PageSetup
}

/** A plain page of a paper size: the default setup on it. */
const plainPage = (presetId: string): PageSetup => {
  const preset = getPageSizePreset(presetId)!
  return { ...structuredClone(DEFAULT_PAGE_SETUP), presetId, widthMm: preset.widthMm, heightMm: preset.heightMm }
}

/**
 * A manuscript as agents, editors and magazines ask for it (William Shunn's "Proper
 * Manuscript Format"): one-inch margins, 12 pt, double-spaced, the surname, title and
 * page number at the head of every page, scene breaks as a centred #, and a title page
 * with the author's contact details and a rounded word count.
 */
const manuscriptPage = (presetId: string, fontFamily: string): PageSetup => ({
  ...plainPage(presetId),
  header: { left: '', center: '', right: '{surname} / {title} / {page}' },
  footer: { left: '', center: '', right: '' },
  typography: manuscriptTypography(fontFamily),
  titlePage: { style: TitlePageStyle.Manuscript, showContact: true, showWordCount: true },
})

/** A printed book at a trim size: book margins and running heads, set as a book. */
const bookPage = (presetId: string): PageSetup => ({
  ...bookPageSetup(presetId),
  typography: { ...BOOK_TYPOGRAPHY },
  titlePage: { style: TitlePageStyle.Book, showContact: false, showWordCount: false },
})

/**
 * A script's page: Courier 12 on exact 12-point lines — ten characters to the inch and
 * six lines to it, which is what makes a page about a minute of screen time. The left
 * margin is wider, for the brads; the page number sits at the head, with a full stop,
 * and not on the first page. Where each element sits across it is Script.css.
 */
const scriptPage = (presetId: string, left: number): PageSetup => {
  const inch = 25.4
  return {
    ...plainPage(presetId),
    margins: { topMm: inch, bottomMm: inch, insideMm: Math.round(left * inch * 1000) / 1000, outsideMm: inch, gutterMm: 0 },
    header: { left: '', center: '', right: '{page}.' },
    footer: { left: '', center: '', right: '' },
    headerDistanceMm: inch / 2,
    differentFirstPage: true,
    // A script's own rules decide where speeches break (paginate.ts).
    widowOrphanLines: 1,
    typography: {
      fontFamily: COURIER,
      fontSizePt: 12,
      lineSpacing: LineSpacing.Exact,
      lineValue: 12,
      firstLineIndentMm: 0,
      paragraphSpacingPt: 0,
      alignment: PrintAlignment.Left,
      hyphenate: false,
      sceneBreak: '',
      chapterOpening: ChapterOpening.Plain,
      chapterSinkMm: 0,
      noIndentAfterBreak: false,
    },
    titlePage: { style: TitlePageStyle.Screenplay, showContact: true, showWordCount: false },
  }
}

const GROUP_EVERYDAY = 'Everyday'
const GROUP_SCRIPT = 'Scripts'
const GROUP_SUBMISSION = 'Submission'
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
    id: 'manuscript',
    label: 'Standard manuscript',
    group: GROUP_SUBMISSION,
    summary: 'What agents, editors and magazines ask for: Courier 12 pt, double-spaced, one-inch margins, a title page with your contact details and word count.',
    kind: FormatKind.Prose,
    build: () => manuscriptPage('letter', COURIER),
  },
  {
    id: 'manuscript-times',
    label: 'Standard manuscript, Times',
    group: GROUP_SUBMISSION,
    summary: 'The same manuscript in Times New Roman, which many publishers now prefer.',
    kind: FormatKind.Prose,
    build: () => manuscriptPage('letter', TIMES),
  },
  {
    id: 'manuscript-a4',
    label: 'Standard manuscript, A4',
    group: GROUP_SUBMISSION,
    summary: 'The standard manuscript on A4, for submissions outside North America.',
    kind: FormatKind.Prose,
    build: () => manuscriptPage('a4', TIMES),
  },
  {
    id: 'trade-6x9',
    label: 'Trade paperback 6 × 9 in',
    group: GROUP_BOOK,
    summary: 'The common US novel size: mirrored margins, running heads, chapters opening on the right.',
    kind: FormatKind.Prose,
    build: () => bookPage('trade-6x9'),
  },
  {
    id: 'trade-5.5x8.5',
    label: 'Digest 5.5 × 8.5 in',
    group: GROUP_BOOK,
    summary: 'A smaller trade paperback, common for memoir, poetry and novellas.',
    kind: FormatKind.Prose,
    build: () => bookPage('digest'),
  },
  {
    id: 'trade-5x8',
    label: 'Trade 5 × 8 in',
    group: GROUP_BOOK,
    summary: 'A compact trade paperback, popular for fiction.',
    kind: FormatKind.Prose,
    build: () => bookPage('trade-5x8'),
  },
  {
    id: 'b-format',
    label: 'UK B-Format',
    group: GROUP_BOOK,
    summary: 'The standard British paperback, 129 × 198 mm.',
    kind: FormatKind.Prose,
    build: () => bookPage('b-format'),
  },
  {
    id: 'mass-market',
    label: 'Mass-market paperback',
    group: GROUP_BOOK,
    summary: 'The pocket paperback, 4.25 × 6.87 in: genre fiction on the rack.',
    kind: FormatKind.Prose,
    build: () => ({
      ...bookPage('mass-market'),
      margins: { topMm: 15.875, bottomMm: 15.875, insideMm: 12.7, outsideMm: 12.7, gutterMm: 3.175 },
      typography: { ...BOOK_TYPOGRAPHY, fontSizePt: 10, lineValue: 1.1 },
    }),
  },
  {
    id: 'a5-novel',
    label: 'A5 novel',
    group: GROUP_BOOK,
    summary: 'A book on A5, which any home printer can make two to a sheet of A4.',
    kind: FormatKind.Prose,
    build: () => bookPage('a5'),
  },
  {
    id: 'screenplay',
    label: 'Screenplay',
    group: GROUP_SCRIPT,
    summary: 'The industry page: Courier 12, 1½-inch left margin, a page about a minute of screen time.',
    kind: FormatKind.Screenplay,
    build: () => scriptPage('letter', 1.5),
  },
  {
    id: 'screenplay-a4',
    label: 'Screenplay (A4)',
    group: GROUP_SCRIPT,
    summary: 'The same screenplay page on A4, as British and European productions print it.',
    kind: FormatKind.Screenplay,
    build: () => scriptPage('a4', 1.5),
  },
  {
    id: 'stageplay',
    label: 'Stage play',
    group: GROUP_SCRIPT,
    summary: 'A play as theatres and publishers read it: names centred, directions indented and in italics.',
    kind: FormatKind.StagePlay,
    build: () => scriptPage('letter', 1.5),
  },
]

const BY_ID = new Map(FORMAT_PRESETS.map((f) => [f.id, f]))

export const getFormat = (id: string | null | undefined): FormatPreset | null => (id && BY_ID.get(id)) || null

/** What a format makes a document written as: a script's, or null for prose. */
export const writingFormatOf = (id: string | null | undefined): 'screenplay' | 'stageplay' | null => {
  const kind = getFormat(id)?.kind
  return kind === FormatKind.Screenplay ? 'screenplay' : kind === FormatKind.StagePlay ? 'stageplay' : null
}

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
