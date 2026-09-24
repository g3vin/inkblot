/**
 * pageSizes.ts — paper and trim sizes, and the units they are measured in.
 *
 * Every size is its standard's own definition in millimetres (ISO 216/269, JIS P
 * 0138, ANSI/ASME Y14.1 for the US sizes, the trade trim sizes printers publish).
 * US sizes are defined in inches, so they are stored as inch × 25.4 — exact, not
 * rounded — which is what makes US Letter come out at 816 × 1056 CSS px.
 *
 * CSS fixes 1in = 96px = 72pt, independent of the screen; a page laid out in these
 * units prints at exactly its real size.
 */

export const MM_PER_INCH = 25.4
export const PX_PER_INCH = 96
export const PT_PER_INCH = 72

export type LengthUnit = 'mm' | 'cm' | 'in' | 'pt'

export const mmToPx = (mm: number): number => (mm * PX_PER_INCH) / MM_PER_INCH
export const pxToMm = (px: number): number => (px * MM_PER_INCH) / PX_PER_INCH
export const mmToPt = (mm: number): number => (mm * PT_PER_INCH) / MM_PER_INCH
export const pxToPt = (px: number): number => (px * PT_PER_INCH) / PX_PER_INCH

const PER_MM: Record<LengthUnit, number> = {
  mm: 1,
  cm: 0.1,
  in: 1 / MM_PER_INCH,
  pt: PT_PER_INCH / MM_PER_INCH,
}

export const fromMm = (mm: number, unit: LengthUnit): number => mm * PER_MM[unit]
export const toMm = (value: number, unit: LengthUnit): number => value / PER_MM[unit]

export type PageSizeGroup = 'iso-a' | 'iso-b' | 'north-america' | 'jis' | 'book'

export interface PageSizePreset {
  id: string
  label: string
  group: PageSizeGroup
  /** Portrait width and height. */
  widthMm: number
  heightMm: number
}

export const PAGE_SIZE_GROUP_LABELS: Record<PageSizeGroup, string> = {
  'iso-a': 'ISO A',
  'iso-b': 'ISO B',
  'north-america': 'North America',
  jis: 'Japan (JIS)',
  book: 'Book trim sizes',
}

const inch = (w: number, h: number) => ({ widthMm: w * MM_PER_INCH, heightMm: h * MM_PER_INCH })

// ISO 216: A0 is 841 × 1189mm and each next size halves the long side, with the
// standard's own rounding down to whole millimetres — so the table is the standard,
// not a computation that drifts from it by a millimetre at A7.
const ISO_A: Array<[number, number]> = [
  [841, 1189], [594, 841], [420, 594], [297, 420], [210, 297], [148, 210],
  [105, 148], [74, 105], [52, 74], [37, 52], [26, 37],
]
const ISO_B: Array<[number, number]> = [
  [1000, 1414], [707, 1000], [500, 707], [353, 500], [250, 353], [176, 250],
  [125, 176], [88, 125], [62, 88], [44, 62], [31, 44],
]

export const PAGE_SIZE_PRESETS: PageSizePreset[] = [
  { id: 'letter', label: 'US Letter', group: 'north-america', ...inch(8.5, 11) },
  { id: 'legal', label: 'US Legal', group: 'north-america', ...inch(8.5, 14) },
  { id: 'tabloid', label: 'Tabloid / Ledger', group: 'north-america', ...inch(11, 17) },
  { id: 'executive', label: 'Executive', group: 'north-america', ...inch(7.25, 10.5) },
  { id: 'statement', label: 'Statement / Half Letter', group: 'north-america', ...inch(5.5, 8.5) },
  { id: 'government-letter', label: 'Government Letter', group: 'north-america', ...inch(8, 10.5) },
  ...ISO_A.map(([w, h], i) => ({ id: `a${i}`, label: `A${i}`, group: 'iso-a' as const, widthMm: w, heightMm: h })),
  ...ISO_B.map(([w, h], i) => ({ id: `b${i}`, label: `B${i}`, group: 'iso-b' as const, widthMm: w, heightMm: h })),
  { id: 'jis-b4', label: 'JIS B4', group: 'jis', widthMm: 257, heightMm: 364 },
  { id: 'jis-b5', label: 'JIS B5', group: 'jis', widthMm: 182, heightMm: 257 },
  { id: 'jis-b6', label: 'JIS B6', group: 'jis', widthMm: 128, heightMm: 182 },
  { id: 'mass-market', label: 'Mass-market paperback (4.25 × 6.87 in)', group: 'book', ...inch(4.25, 6.87) },
  { id: 'trade-5x8', label: 'Trade 5 × 8 in', group: 'book', ...inch(5, 8) },
  { id: 'trade-5.25x8', label: 'Trade 5.25 × 8 in', group: 'book', ...inch(5.25, 8) },
  { id: 'digest', label: 'Digest 5.5 × 8.5 in', group: 'book', ...inch(5.5, 8.5) },
  { id: 'trade-6x9', label: 'US Trade 6 × 9 in', group: 'book', ...inch(6, 9) },
  { id: 'trade-7x10', label: 'Textbook 7 × 10 in', group: 'book', ...inch(7, 10) },
  { id: 'b-format', label: 'UK B-format (129 × 198 mm)', group: 'book', widthMm: 129, heightMm: 198 },
  { id: 'demy', label: 'Demy (138 × 216 mm)', group: 'book', widthMm: 138, heightMm: 216 },
  { id: 'royal', label: 'Royal (156 × 234 mm)', group: 'book', widthMm: 156, heightMm: 234 },
  { id: 'crown-quarto', label: 'Crown Quarto (189 × 246 mm)', group: 'book', widthMm: 189, heightMm: 246 },
]

const PRESETS_BY_ID = new Map(PAGE_SIZE_PRESETS.map((preset) => [preset.id, preset]))

export const getPageSizePreset = (id: string): PageSizePreset | null => PRESETS_BY_ID.get(id) || null

/** The preset a width × height is, if any — so a custom size typed as 210 × 297 reads as A4. */
export const matchPageSizePreset = (widthMm: number, heightMm: number): PageSizePreset | null => {
  const [w, h] = widthMm <= heightMm ? [widthMm, heightMm] : [heightMm, widthMm]
  return PAGE_SIZE_PRESETS.find((p) => Math.abs(p.widthMm - w) < 0.5 && Math.abs(p.heightMm - h) < 0.5) || null
}

/** Sheets a document can be printed onto for imposition — the common desktop printer sizes. */
export const SHEET_SIZE_IDS = ['letter', 'a4', 'legal', 'tabloid', 'a3'] as const
