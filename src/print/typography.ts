/**
 * typography.ts — type set for print: the font, size, leading, indents and scene
 * breaks a page setup prints its text in.
 *
 * Applied as CSS custom properties and classes on whatever holds the pages — Print
 * Layout's stage, the off-screen layout a print job uses, and each printed page — and
 * never on the continuous editor, which keeps the writer's own font. A setup with no
 * typography prints in the editor's font, as every document did before this existed.
 *
 * Leading follows a word processor's meaning, so "double-spaced 12 pt Courier" gives
 * the 23 or so lines a page a manuscript reader expects: single spacing is 1.15 × the
 * size, and 1.5 and double are multiples of that.
 */
import { ChapterOpening, ImageAlign, LineSpacing, PrintAlignment } from '../types'
import type { Composition, ImageTypesetting, OpenTypeFeatures, PrintTypography } from '../types'

/** Single spacing, as a multiple of the font size. */
export const SINGLE_LEADING = 1.15

export const BOOK_TYPOGRAPHY: PrintTypography = {
  fontFamily: 'Palatino, "Palatino Linotype", "Book Antiqua", Georgia, serif',
  fontSizePt: 11,
  lineSpacing: LineSpacing.Multiple,
  lineValue: 1.2,
  firstLineIndentMm: 7.62,
  paragraphSpacingPt: 0,
  alignment: PrintAlignment.Justify,
  hyphenate: true,
  sceneBreak: '* * *',
  chapterOpening: ChapterOpening.DropCapAndSmallCaps,
  chapterSinkMm: 38.1,
  noIndentAfterBreak: true,
}

/** A standard manuscript's type: 12 pt, double-spaced, ragged right, indented. */
export const manuscriptTypography = (fontFamily: string): PrintTypography => ({
  fontFamily,
  fontSizePt: 12,
  lineSpacing: LineSpacing.Double,
  lineValue: 2,
  firstLineIndentMm: 12.7,
  paragraphSpacingPt: 0,
  alignment: PrintAlignment.Left,
  hyphenate: false,
  sceneBreak: '#',
  chapterOpening: ChapterOpening.Plain,
  // A chapter opens about a third of the way down the page.
  chapterSinkMm: 63.5,
  noIndentAfterBreak: false,
})

export const COURIER = '"Courier Prime", "Courier New", Courier, monospace'
export const TIMES = '"Times New Roman", Times, serif'

const finite = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (
  allowed.includes(value as T) ? (value as T) : fallback
)

/** Anything → typography that sets, or undefined for "the editor's font". */
export const normalizeTypography = (raw: unknown): PrintTypography | undefined => {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const d = BOOK_TYPOGRAPHY
  const lineSpacing = oneOf(r.lineSpacing, Object.values(LineSpacing), d.lineSpacing)
  return {
    fontFamily: typeof r.fontFamily === 'string' && r.fontFamily.trim() ? r.fontFamily.trim() : d.fontFamily,
    fontSizePt: finite(r.fontSizePt, d.fontSizePt, 5, 72),
    lineSpacing,
    lineValue: finite(r.lineValue, lineSpacing === LineSpacing.Exact ? 14 : 1, 0.5, 144),
    firstLineIndentMm: finite(r.firstLineIndentMm, d.firstLineIndentMm, 0, 100),
    paragraphSpacingPt: finite(r.paragraphSpacingPt, d.paragraphSpacingPt, 0, 72),
    alignment: oneOf(r.alignment, Object.values(PrintAlignment), d.alignment),
    hyphenate: Boolean(r.hyphenate),
    sceneBreak: typeof r.sceneBreak === 'string' ? r.sceneBreak.replace(/[\r\n]+/g, ' ').slice(0, 40) : d.sceneBreak,
    chapterOpening: oneOf(r.chapterOpening, Object.values(ChapterOpening), d.chapterOpening),
    chapterSinkMm: finite(r.chapterSinkMm, d.chapterSinkMm, 0, 300),
    noIndentAfterBreak: Boolean(r.noIndentAfterBreak),
    ...(r.images && typeof r.images === 'object' ? { images: normalizeImageTypesetting(r.images) } : {}),
    ...(r.composition && typeof r.composition === 'object' ? { composition: normalizeComposition(r.composition) } : {}),
    ...(r.features && typeof r.features === 'object' ? { features: normalizeFeatures(r.features) } : {}),
  }
}

/**
 * How lines are composed, when a typography says nothing: balanced, punctuation hung,
 * no more than two hyphens in a row, none in a word under six letters. On in every
 * style — a book set without them looks set by a word processor.
 */
export const DEFAULT_COMPOSITION: Composition = {
  balance: true,
  hangingPunctuation: true,
  hyphenLimitLines: 2,
  hyphenMinWord: 6,
  baselineGrid: false,
}

export const normalizeComposition = (raw: unknown): Composition => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_COMPOSITION
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
  return {
    balance: bool(r.balance, d.balance),
    hangingPunctuation: bool(r.hangingPunctuation, d.hangingPunctuation),
    hyphenLimitLines: Math.round(finite(r.hyphenLimitLines, d.hyphenLimitLines, 0, 10)),
    hyphenMinWord: Math.round(finite(r.hyphenMinWord, d.hyphenMinWord, 3, 20)),
    baselineGrid: bool(r.baselineGrid, d.baselineGrid),
  }
}

/** A typography's composition, the defaults where it has none. */
export const compositionOf = (t: PrintTypography | undefined | null): Composition => (
  t?.composition ? normalizeComposition(t.composition) : DEFAULT_COMPOSITION
)

/** Ligatures and kerning, as every text face should be set; the rest when asked for. */
export const DEFAULT_FEATURES: OpenTypeFeatures = {
  ligatures: true,
  discretionaryLigatures: false,
  oldStyleFigures: false,
  kerning: true,
  swashes: false,
}

export const normalizeFeatures = (raw: unknown): OpenTypeFeatures => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out = { ...DEFAULT_FEATURES }
  for (const key of Object.keys(DEFAULT_FEATURES) as Array<keyof OpenTypeFeatures>) {
    if (typeof r[key] === 'boolean') out[key] = r[key] as boolean
  }
  return out
}

export const featuresOf = (t: PrintTypography | undefined | null): OpenTypeFeatures => (
  t?.features ? normalizeFeatures(t.features) : DEFAULT_FEATURES
)

/** The features as CSS declarations' values. */
export const featureCss = (f: OpenTypeFeatures): { ligatures: string; numeric: string; kerning: string; settings: string } => ({
  ligatures: [f.ligatures ? 'common-ligatures' : 'no-common-ligatures', f.discretionaryLigatures ? 'discretionary-ligatures' : 'no-discretionary-ligatures'].join(' '),
  numeric: f.oldStyleFigures ? 'oldstyle-nums' : 'normal',
  kerning: f.kerning ? 'normal' : 'none',
  settings: f.swashes ? '"swsh" 1' : 'normal',
})

const PX_PER_PT = 96 / 72

/** The baseline grid's pitch, in CSS px — the leading — or 0 when lines keep no grid. */
export const baselineGridPx = (t: PrintTypography | undefined | null): number => (
  t && compositionOf(t).baselineGrid ? Math.round(leadingPt(t) * PX_PER_PT * 1000) / 1000 : 0
)

/**
 * Where a line's baseline falls below the top of its line box, in CSS px: half the
 * leading's extra over the type, plus the type's ascent, near enough — for drawing the
 * grid where the lines sit.
 */
export const baselineOffsetPx = (t: PrintTypography): number => {
  const leading = leadingPt(t) * PX_PER_PT
  const size = t.fontSizePt * PX_PER_PT
  return Math.round(((leading - size) / 2 + size * 0.8) * 100) / 100
}

export const DEFAULT_IMAGE_TYPESETTING: ImageTypesetting = {
  maxWidthPct: 100,
  align: ImageAlign.Center,
  keepWithCaption: true,
  minDpi: 300,
}

/** How a book's pictures are set, with anything missing filled in. */
export const normalizeImageTypesetting = (raw: unknown): ImageTypesetting => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_IMAGE_TYPESETTING
  return {
    maxWidthPct: finite(r.maxWidthPct, d.maxWidthPct, 10, 100),
    align: oneOf(r.align, Object.values(ImageAlign), d.align),
    keepWithCaption: r.keepWithCaption === undefined ? d.keepWithCaption : Boolean(r.keepWithCaption),
    minDpi: Math.round(finite(r.minDpi, d.minDpi, 72, 1200)),
  }
}

/** Baseline to baseline, in points. */
export const leadingPt = (t: PrintTypography): number => {
  switch (t.lineSpacing) {
    case LineSpacing.Single: return t.fontSizePt * SINGLE_LEADING
    case LineSpacing.OneAndAHalf: return t.fontSizePt * SINGLE_LEADING * 1.5
    case LineSpacing.Double: return t.fontSizePt * SINGLE_LEADING * 2
    case LineSpacing.Multiple: return t.fontSizePt * SINGLE_LEADING * t.lineValue
    case LineSpacing.Exact: return t.lineValue
    default: return t.fontSizePt * SINGLE_LEADING
  }
}

/** A CSS string literal. */
const cssString = (text: string): string => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** The baseline grid as a background: a hairline at each line's baseline. */
export const baselineGridStyle = (t: PrintTypography): { backgroundImage: string; backgroundSize: string } => {
  const pitch = Math.round(leadingPt(t) * PX_PER_PT * 1000) / 1000
  const at = baselineOffsetPx(t) % pitch
  const line = 'var(--pl-grid-line, rgba(0, 150, 255, 0.45))'
  return {
    backgroundImage: `linear-gradient(to bottom, transparent calc(${at}px - 0.5px), ${line} calc(${at}px - 0.5px), ${line} calc(${at}px + 0.5px), transparent calc(${at}px + 0.5px))`,
    backgroundSize: `100% ${pitch}px`,
  }
}

/** The custom properties a page's container carries. Empty for the editor's font. */
export const typographyVars = (t: PrintTypography | undefined | null): Record<string, string> => {
  if (!t) return {}
  return {
    '--pt-font': t.fontFamily,
    '--pt-size': `${t.fontSizePt}pt`,
    '--pt-leading': `${Math.round(leadingPt(t) * 100) / 100}pt`,
    '--pt-indent': `${t.firstLineIndentMm}mm`,
    '--pt-para': `${t.paragraphSpacingPt}pt`,
    '--pt-align': t.alignment === PrintAlignment.Justify ? 'justify' : 'left',
    '--pt-hyphens': t.hyphenate ? 'auto' : 'manual',
    '--pt-break': cssString(t.sceneBreak),
    '--pt-sink': `${t.chapterSinkMm}mm`,
    ...(t.images ? { '--pt-image-max': `${t.images.maxWidthPct}%` } : {}),
    ...compositionVars(t),
  }
}

/** The composition's and the features' properties. */
const compositionVars = (t: PrintTypography): Record<string, string> => {
  const c = compositionOf(t)
  const f = featureCss(featuresOf(t))
  const leading = leadingPt(t)
  // On the grid, the space between paragraphs is whole lines.
  const para = c.baselineGrid ? Math.round(t.paragraphSpacingPt / leading) * leading : t.paragraphSpacingPt
  return {
    '--pt-hyphen-lines': c.hyphenLimitLines > 0 ? String(c.hyphenLimitLines) : 'no-limit',
    '--pt-hyphen-word': String(c.hyphenMinWord),
    '--pt-hyphen-side': String(Math.max(2, Math.floor(c.hyphenMinWord / 2))),
    '--pt-ligatures': f.ligatures,
    '--pt-numeric': f.numeric,
    '--pt-kerning': f.kerning,
    '--pt-feature-settings': f.settings,
    ...(c.baselineGrid ? { '--pt-para': `${Math.round(para * 100) / 100}pt` } : {}),
  }
}

/** The classes that switch the rules in PrintTypography.css on. */
export const typographyClasses = (t: PrintTypography | undefined | null): string[] => {
  if (!t) return []
  const out = ['has-print-type']
  if (t.chapterOpening === ChapterOpening.DropCap || t.chapterOpening === ChapterOpening.DropCapAndSmallCaps) out.push('pt-drop-cap')
  if (t.chapterOpening === ChapterOpening.SmallCaps || t.chapterOpening === ChapterOpening.DropCapAndSmallCaps) out.push('pt-small-caps')
  if (t.noIndentAfterBreak) out.push('pt-flush-after-break')
  const c = compositionOf(t)
  if (c.balance) out.push('pt-balance')
  if (c.hangingPunctuation) out.push('pt-hang')
  if (c.baselineGrid) out.push('pt-grid')
  if (t.images) {
    out.push('pt-images')
    if (t.images.align === ImageAlign.Center) out.push('pt-images-center')
    if (t.images.keepWithCaption) out.push('pt-images-keep')
  }
  return out
}

/** Put a typography on an element: its variables and classes. */
export const applyTypography = (el: HTMLElement, t: PrintTypography | undefined | null): void => {
  for (const [name, value] of Object.entries(typographyVars(t))) el.style.setProperty(name, value)
  el.classList.add(...typographyClasses(t))
}

/** Changes whenever the typography would change where lines break. */
export const typographyKey = (t: PrintTypography | undefined | null): string => (t ? JSON.stringify(t) : '')

/** The first family in a CSS font list, unquoted: what `document.fonts.load` asks for. */
export const primaryFamily = (family: string): string => (
  family.split(',')[0].trim().replace(/^["']|["']$/g, '')
)

/**
 * Wait for the print font, so nothing is measured in a fallback and laid out again a
 * moment later in the real one. A font the system lacks resolves at once, to the
 * fallback.
 */
export const loadTypographyFont = async (t: PrintTypography | undefined | null): Promise<void> => {
  if (!t || typeof document === 'undefined' || !document.fonts?.load) return
  const family = primaryFamily(t.fontFamily)
  try {
    await Promise.all([
      document.fonts.load(`${t.fontSizePt}pt "${family}"`),
      document.fonts.load(`italic ${t.fontSizePt}pt "${family}"`),
      document.fonts.load(`bold ${t.fontSizePt}pt "${family}"`),
    ])
  } catch {
    // A family the browser cannot parse: the fallback is what will print.
  }
}
