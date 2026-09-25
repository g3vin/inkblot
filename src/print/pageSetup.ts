/**
 * pageSetup.ts — a document's page setup: its defaults, its normalizer, and the
 * geometry every page is laid out in.
 *
 * The setup is the `PageSetup` type generated from Rust (see
 * crates/inkblot-core/src/types/page_setup.rs). It is stored on the TipTap `doc`
 * node's `pageSetup` attribute, and everything read off disk goes through
 * `normalizePageSetup` so an old or hand-edited file can never produce a page of
 * negative width.
 *
 * Geometry is in CSS px (1in = 96px). Only the *horizontal* margins differ between
 * a recto and a verso — top, bottom and the content height never do — so where the
 * text breaks is independent of which side of the spread a page falls on.
 */
import { PageNumberFormat, PageOrientation, SetupSource } from '../types'
import type { PageMargins, PageSetup, RunningText } from '../types'
import { getPageSizePreset, mmToPx } from './pageSizes'

export type { PageSetup }

const EMPTY_RUNNING_TEXT: RunningText = { left: '', center: '', right: '' }

export const DEFAULT_PAGE_SETUP: PageSetup = {
  presetId: 'letter',
  widthMm: 215.9,
  heightMm: 279.4,
  orientation: PageOrientation.Portrait,
  margins: { topMm: 25.4, bottomMm: 25.4, insideMm: 25.4, outsideMm: 25.4, gutterMm: 0 },
  mirrorMargins: false,
  columns: 1,
  columnGapMm: 6.35,
  header: { ...EMPTY_RUNNING_TEXT },
  footer: { left: '', center: '{page}', right: '' },
  versoHeader: undefined,
  versoFooter: undefined,
  headerDistanceMm: 12.7,
  footerDistanceMm: 12.7,
  differentFirstPage: false,
  pageNumberStart: 1,
  pageNumberFormat: PageNumberFormat.Arabic,
  widowOrphanLines: 2,
  chapterStartsOnRecto: false,
  formatId: undefined,
}

/**
 * A setup suited to a printed book at a trim size: mirrored margins with a gutter,
 * running heads with the title on the verso and the chapter on the recto, folios
 * outside at the foot, chapters opening on a recto.
 */
export const bookPageSetup = (presetId = 'trade-6x9'): PageSetup => {
  const preset = getPageSizePreset(presetId) || getPageSizePreset('trade-6x9')!
  return {
    ...DEFAULT_PAGE_SETUP,
    presetId: preset.id,
    widthMm: preset.widthMm,
    heightMm: preset.heightMm,
    margins: { topMm: 19.05, bottomMm: 19.05, insideMm: 15.875, outsideMm: 15.875, gutterMm: 3.175 },
    mirrorMargins: true,
    header: { left: '', center: '{chapter}', right: '' },
    versoHeader: { left: '', center: '{title}', right: '' },
    footer: { left: '', center: '{page}', right: '' },
    headerDistanceMm: 9.525,
    footerDistanceMm: 9.525,
    differentFirstPage: true,
    chapterStartsOnRecto: true,
  }
}

const finite = (value: unknown, fallback: number, min = -Infinity, max = Infinity): number => {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

const normalizeRunningText = (value: unknown, fallback: RunningText): RunningText => {
  if (!value || typeof value !== 'object') return { ...fallback }
  const v = value as Record<string, unknown>
  return { left: text(v.left), center: text(v.center), right: text(v.right) }
}

const enumValue = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (
  allowed.includes(value as T) ? (value as T) : fallback
)

/** Smallest page we will lay out: 25mm, about a large postage stamp. */
const MIN_PAGE_MM = 25
/** Largest: A0's long side with room to spare. */
const MAX_PAGE_MM = 1500
/** The text block may not shrink below this in either direction. */
const MIN_CONTENT_MM = 10

/**
 * Anything → a setup that lays out. Missing keys take the defaults; margins that
 * would leave less than MIN_CONTENT_MM of text are scaled back proportionally
 * rather than rejected, so an A4 setup moved onto A7 still has a text block.
 */
export const normalizePageSetup = (raw: unknown): PageSetup => {
  const d = DEFAULT_PAGE_SETUP
  if (!raw || typeof raw !== 'object') return structuredClone(d)
  const r = raw as Record<string, unknown>
  const m = (r.margins && typeof r.margins === 'object' ? r.margins : {}) as Record<string, unknown>

  const widthMm = finite(r.widthMm, d.widthMm, MIN_PAGE_MM, MAX_PAGE_MM)
  const heightMm = finite(r.heightMm, d.heightMm, MIN_PAGE_MM, MAX_PAGE_MM)
  const orientation = enumValue(r.orientation, [PageOrientation.Portrait, PageOrientation.Landscape], d.orientation)
  const [pageW, pageH] = orientation === PageOrientation.Landscape ? [heightMm, widthMm] : [widthMm, heightMm]

  const margins: PageMargins = {
    topMm: finite(m.topMm, d.margins.topMm, 0),
    bottomMm: finite(m.bottomMm, d.margins.bottomMm, 0),
    insideMm: finite(m.insideMm, d.margins.insideMm, 0),
    outsideMm: finite(m.outsideMm, d.margins.outsideMm, 0),
    gutterMm: finite(m.gutterMm, d.margins.gutterMm, 0),
  }
  const horizontal = margins.insideMm + margins.outsideMm + margins.gutterMm
  if (pageW - horizontal < MIN_CONTENT_MM) {
    const k = Math.max(0, pageW - MIN_CONTENT_MM) / horizontal
    margins.insideMm *= k
    margins.outsideMm *= k
    margins.gutterMm *= k
  }
  const vertical = margins.topMm + margins.bottomMm
  if (pageH - vertical < MIN_CONTENT_MM) {
    const k = Math.max(0, pageH - MIN_CONTENT_MM) / vertical
    margins.topMm *= k
    margins.bottomMm *= k
  }

  const presetId = typeof r.presetId === 'string' && (r.presetId === 'custom' || getPageSizePreset(r.presetId))
    ? r.presetId
    : 'custom'

  return {
    presetId,
    widthMm,
    heightMm,
    orientation,
    margins,
    mirrorMargins: Boolean(r.mirrorMargins),
    columns: Math.round(finite(r.columns, d.columns, 1, 3)),
    columnGapMm: finite(r.columnGapMm, d.columnGapMm, 0, 50),
    header: normalizeRunningText(r.header, d.header),
    footer: normalizeRunningText(r.footer, d.footer),
    versoHeader: r.versoHeader ? normalizeRunningText(r.versoHeader, EMPTY_RUNNING_TEXT) : undefined,
    versoFooter: r.versoFooter ? normalizeRunningText(r.versoFooter, EMPTY_RUNNING_TEXT) : undefined,
    headerDistanceMm: finite(r.headerDistanceMm, d.headerDistanceMm, 0, margins.topMm),
    footerDistanceMm: finite(r.footerDistanceMm, d.footerDistanceMm, 0, margins.bottomMm),
    differentFirstPage: Boolean(r.differentFirstPage),
    pageNumberStart: Math.round(finite(r.pageNumberStart, d.pageNumberStart, 0, 99999)),
    pageNumberFormat: enumValue(
      r.pageNumberFormat,
      [PageNumberFormat.Arabic, PageNumberFormat.UpperRoman, PageNumberFormat.LowerRoman],
      d.pageNumberFormat
    ),
    widowOrphanLines: Math.round(finite(r.widowOrphanLines, d.widowOrphanLines, 1, 5)),
    chapterStartsOnRecto: Boolean(r.chapterStartsOnRecto),
    formatId: typeof r.formatId === 'string' && r.formatId ? r.formatId : undefined,
  }
}

/** Where a document's setup comes from, and the setup itself. */
export interface ResolvedPageSetup {
  setup: PageSetup
  source: SetupSource
}

/**
 * The setup a document lays out in, and prints in.
 *
 * A book with a setup of its own prints every chapter in it: that is what the author
 * set it for. On screen, and printed alone, a document shows its own setup, then its
 * book's, then the default — so a chapter with none of its own looks the way the book
 * will print it. `scope` is what is being printed; on screen it is `'document'`.
 */
export const resolvePageSetup = ({
  docSetup,
  bookSetup,
  scope = 'document',
}: {
  docSetup?: unknown
  bookSetup?: unknown
  scope?: 'document' | 'folder' | 'project'
}): ResolvedPageSetup => {
  if (scope !== 'document' && bookSetup) return { setup: normalizePageSetup(bookSetup), source: SetupSource.Book }
  if (docSetup) return { setup: normalizePageSetup(docSetup), source: SetupSource.Document }
  if (bookSetup) return { setup: normalizePageSetup(bookSetup), source: SetupSource.Book }
  return { setup: normalizePageSetup(null), source: SetupSource.Default }
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The px geometry shared by every page of a setup. */
export interface PageMetrics {
  width: number
  height: number
  /** Top margin and the text block's height: the same on every page. */
  contentTop: number
  contentHeight: number
  /** The text block's width: the same on every page; only its x moves. */
  contentWidth: number
  columns: number
  columnGap: number
  columnWidth: number
  headerTop: number
  footerBottom: number
}

export const pageMetrics = (setupInput: PageSetup): PageMetrics => {
  const setup = normalizePageSetup(setupInput)
  const landscape = setup.orientation === PageOrientation.Landscape
  const width = mmToPx(landscape ? setup.heightMm : setup.widthMm)
  const height = mmToPx(landscape ? setup.widthMm : setup.heightMm)
  const { margins } = setup
  const contentWidth = width - mmToPx(margins.insideMm + margins.outsideMm + margins.gutterMm)
  const contentHeight = height - mmToPx(margins.topMm + margins.bottomMm)
  const columnGap = setup.columns > 1 ? mmToPx(setup.columnGapMm) : 0
  return {
    width,
    height,
    contentTop: mmToPx(margins.topMm),
    contentHeight,
    contentWidth,
    columns: setup.columns,
    columnGap,
    columnWidth: (contentWidth - columnGap * (setup.columns - 1)) / setup.columns,
    headerTop: mmToPx(setup.headerDistanceMm),
    footerBottom: height - mmToPx(setup.footerDistanceMm),
  }
}

/**
 * Physical page n (1-based, counting every page including blanks) is a recto when
 * odd — the right-hand page of a spread, as in every Western book.
 */
export const isRecto = (physicalPage: number): boolean => physicalPage % 2 === 1

/** Left margin of a physical page, in px. The inside (+ gutter) is on the left of a recto. */
export const pageLeftMargin = (setup: PageSetup, physicalPage: number): number => {
  const { insideMm, outsideMm, gutterMm } = setup.margins
  if (setup.mirrorMargins && !isRecto(physicalPage)) return mmToPx(outsideMm)
  return mmToPx(insideMm + gutterMm)
}

/** The text block of a physical page. */
export const contentBox = (setup: PageSetup, physicalPage: number): Box => {
  const m = pageMetrics(setup)
  return { x: pageLeftMargin(setup, physicalPage), y: m.contentTop, width: m.contentWidth, height: m.contentHeight }
}

/**
 * Suggested inside margin (including gutter) by page count, after the minimums the
 * print-on-demand services publish for perfect-bound books: a thicker book curves
 * further into the spine, so it needs more.
 */
export const suggestedInsideMarginMm = (pageCount: number): number => {
  const inches = pageCount <= 150 ? 0.375
    : pageCount <= 300 ? 0.5
      : pageCount <= 500 ? 0.625
        : pageCount <= 700 ? 0.75
          : 0.875
  return inches * 25.4
}

const ROMAN: Array<[number, string]> = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
]

export const toRoman = (value: number): string => {
  let n = Math.floor(value)
  if (n <= 0) return String(n)
  let out = ''
  for (const [v, s] of ROMAN) {
    while (n >= v) {
      out += s
      n -= v
    }
  }
  return out
}

export const formatPageNumber = (n: number, format: PageNumberFormat): string => {
  if (format === PageNumberFormat.UpperRoman) return toRoman(n)
  if (format === PageNumberFormat.LowerRoman) return toRoman(n).toLowerCase()
  return String(n)
}

export interface RunningTextContext {
  /** The printed folio, already offset by pageNumberStart. */
  page: number
  pages: number
  title: string
  chapter: string
  author: string
}

export const resolveRunningTemplate = (
  template: string,
  ctx: RunningTextContext,
  format: PageNumberFormat
): string => template.replace(/\{(page|pages|title|chapter|author)\}/g, (_, token: string) => {
  if (token === 'page') return formatPageNumber(ctx.page, format)
  if (token === 'pages') return formatPageNumber(ctx.pages, format)
  return ctx[token as 'title' | 'chapter' | 'author'] || ''
})

/**
 * The header or footer of one physical page, resolved to text. A verso uses its
 * override when the setup has one; otherwise, on a mirrored setup, the recto's
 * left and right swap so what was outside stays outside. Null when the page shows
 * none (a chapter's first page under differentFirstPage, or a blank).
 */
export const runningTextFor = (
  setup: PageSetup,
  which: 'header' | 'footer',
  physicalPage: number,
  ctx: RunningTextContext,
  { chapterFirstPage = false, blank = false } = {}
): RunningText | null => {
  if (blank) return null
  if (chapterFirstPage && setup.differentFirstPage) return null
  const verso = !isRecto(physicalPage)
  const override = verso ? (which === 'header' ? setup.versoHeader : setup.versoFooter) : null
  const source = override || setup[which]
  const resolve = (t: string) => resolveRunningTemplate(t, ctx, setup.pageNumberFormat)
  const left = resolve(source.left)
  const center = resolve(source.center)
  const right = resolve(source.right)
  if (!left && !center && !right) return null
  if (!override && setup.mirrorMargins && verso) return { left: right, center, right: left }
  return { left, center, right }
}
