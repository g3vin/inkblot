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
import { ChapterOpening, LineSpacing, PrintAlignment } from '../types'
import type { PrintTypography } from '../types'

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
  }
}

/** The classes that switch the rules in PrintTypography.css on. */
export const typographyClasses = (t: PrintTypography | undefined | null): string[] => {
  if (!t) return []
  const out = ['has-print-type']
  if (t.chapterOpening === ChapterOpening.DropCap || t.chapterOpening === ChapterOpening.DropCapAndSmallCaps) out.push('pt-drop-cap')
  if (t.chapterOpening === ChapterOpening.SmallCaps || t.chapterOpening === ChapterOpening.DropCapAndSmallCaps) out.push('pt-small-caps')
  if (t.noIndentAfterBreak) out.push('pt-flush-after-break')
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
