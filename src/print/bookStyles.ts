/**
 * bookStyles.ts — whole designs for a book, one click each.
 *
 * A book designer does not set thirty controls one at a time: they choose a design — a
 * face, how chapters open, an ornament, the running heads — and adjust it. These are
 * those designs, each coordinated the way a typeset book is (a body face with its own
 * heads, leading to suit it, a drop cap where the face carries one), in faces every Mac
 * has, so they print and embed in the PDF. Applying one sets the book's type, its
 * chapter design and its running heads (`applyBookStyle`); everything after it is
 * fine-tuning, and the book remembers which it came from.
 */
import {
  ChapterBreak,
  ChapterOpening,
  HeadAlignment,
  HeadCase,
  ImageAlign,
  LineSpacing,
  OrnamentKind,
  OrnamentPosition,
  PrintAlignment,
} from '../types'
import type { BookStyleOption, ChapterDesign, PageSetup, PrintTypography, RunningText } from '../types'
import { DEFAULT_CHAPTER_DESIGN } from './chapterDesign'
import { manuscriptTypography, TIMES } from './typography'

const type = (overrides: Partial<PrintTypography>): PrintTypography => ({
  fontFamily: 'Palatino, "Palatino Linotype", "Book Antiqua", Georgia, serif',
  fontSizePt: 11,
  lineSpacing: LineSpacing.Multiple,
  lineValue: 1.2,
  firstLineIndentMm: 5,
  paragraphSpacingPt: 0,
  alignment: PrintAlignment.Justify,
  hyphenate: true,
  sceneBreak: '* * *',
  chapterOpening: ChapterOpening.Plain,
  chapterSinkMm: 45,
  noIndentAfterBreak: true,
  images: { maxWidthPct: 100, align: ImageAlign.Center, keepWithCaption: true, minDpi: 300 },
  ...overrides,
})

const design = (id: string, overrides: Partial<ChapterDesign>): ChapterDesign => ({
  ...DEFAULT_CHAPTER_DESIGN,
  showNumber: true,
  chapterBreak: ChapterBreak.NewRightPage,
  styleId: id,
  ...overrides,
})

const heads = (left: string, right: string): { header: RunningText; versoHeader: RunningText } => ({
  // A book's usual heads: the author on the left-hand page, the title on the right,
  // each on the outside; the folio in the foot is the setup's.
  header: { left: '', center: right, right: '' },
  versoHeader: { left: '', center: left, right: '' },
})

export const BOOK_STYLES: BookStyleOption[] = [
  {
    id: 'classic',
    label: 'Classic',
    description: 'Palatino, a centred "Chapter One" in small capitals and a fleuron. The literary novel.',
    typography: type({ chapterOpening: ChapterOpening.DropCapAndSmallCaps }),
    design: design('classic', {
      numberCase: HeadCase.SmallCaps,
      titleSizePt: 20,
      ornament: OrnamentKind.Glyph,
      ornamentGlyph: '❧',
      ornamentPosition: OrnamentPosition.Below,
    }),
    ...heads('{author}', '{title}'),
  },
  {
    id: 'elegant',
    label: 'Elegant',
    description: 'Baskerville with spaced capitals, an italic title and a fine rule. Historical and literary fiction.',
    typography: type({
      fontFamily: 'Baskerville, "Baskerville Old Face", "Libre Baskerville", Georgia, serif',
      fontSizePt: 11.5,
      lineValue: 1.22,
      sceneBreak: '⁂',
      chapterOpening: ChapterOpening.SmallCaps,
    }),
    design: design('elegant', {
      numberCase: HeadCase.Upper,
      titleCase: HeadCase.Italic,
      numberSizePt: 10,
      titleSizePt: 22,
      ornament: OrnamentKind.Rule,
      ornamentPosition: OrnamentPosition.Between,
    }),
    ...heads('{author}', '{chapter}'),
  },
  {
    id: 'modern',
    label: 'Modern',
    description: 'Iowan Old Style with Avenir Next heads: a large numeral set left, and a thin rule. Thrillers and contemporary fiction.',
    typography: type({
      fontFamily: '"Iowan Old Style", "Palatino Linotype", Georgia, serif',
      fontSizePt: 10.5,
      lineValue: 1.25,
      sceneBreak: '—',
      chapterOpening: ChapterOpening.SmallCaps,
      chapterSinkMm: 38,
    }),
    design: design('modern', {
      alignment: HeadAlignment.Left,
      headingFont: '"Avenir Next", Avenir, "Helvetica Neue", sans-serif',
      numberSizePt: 40,
      titleSizePt: 16,
      titleCase: HeadCase.Upper,
      ornament: OrnamentKind.Rule,
      ornamentPosition: OrnamentPosition.Between,
      chapterBreak: ChapterBreak.NewPage,
    }),
    ...heads('{author}', '{title}'),
  },
  {
    id: 'minimal',
    label: 'Minimal',
    description: 'Charter, the chapter number alone, nothing more. Non-fiction and quiet literary work.',
    typography: type({
      fontFamily: 'Charter, "Bitstream Charter", Georgia, serif',
      fontSizePt: 10.5,
      lineValue: 1.28,
      sceneBreak: '',
      chapterSinkMm: 30,
    }),
    design: design('minimal', { showTitle: false, numberSizePt: 28, chapterBreak: ChapterBreak.NewPage }),
    ...heads('{title}', '{chapter}'),
  },
  {
    id: 'ornate',
    label: 'Ornate',
    description: 'Hoefler Text with a flourish over the head, ornamental breaks and a drop cap. Fantasy, romance and fairy tales.',
    typography: type({
      fontFamily: '"Hoefler Text", Garamond, "EB Garamond", Georgia, serif',
      fontSizePt: 11.5,
      lineValue: 1.2,
      sceneBreak: '❦',
      chapterOpening: ChapterOpening.DropCap,
      chapterSinkMm: 50,
    }),
    design: design('ornate', {
      numberCase: HeadCase.SmallCaps,
      titleCase: HeadCase.Italic,
      titleSizePt: 24,
      ornament: OrnamentKind.Glyph,
      ornamentGlyph: '❦',
      ornamentPosition: OrnamentPosition.Above,
    }),
    ...heads('{author}', '{title}'),
  },
  {
    id: 'large-print',
    label: 'Large print',
    description: 'Seventeen-point Palatino, generously spaced, ragged right and unhyphenated, for readers who need it.',
    typography: type({
      fontSizePt: 17,
      lineValue: 1.3,
      alignment: PrintAlignment.Left,
      hyphenate: false,
      firstLineIndentMm: 8,
      chapterSinkMm: 30,
    }),
    design: design('large-print', { titleSizePt: 26, numberSizePt: 18, chapterBreak: ChapterBreak.NewPage }),
    ...heads('{author}', '{title}'),
  },
  {
    id: 'manuscript',
    label: 'Manuscript',
    description: 'The standard submission: 12-point Times, double-spaced, ragged right. For agents and editors, not readers.',
    typography: manuscriptTypography(TIMES),
    design: design('manuscript', {
      numberCase: HeadCase.Upper,
      titleSizePt: 12,
      numberSizePt: 12,
      chapterBreak: ChapterBreak.NewPage,
    }),
    header: { left: '', center: '', right: '{surname} / {title} / {page}' },
  },
]

export const bookStyle = (id: string): BookStyleOption | undefined => BOOK_STYLES.find((s) => s.id === id)

/**
 * A book with a style applied: its setup given the style's type and heads, its chapter
 * design the style's. The setup is the book's own, or `fallback` (the open document's)
 * when it has none, so the style reaches every chapter.
 */
export const applyBookStyle = <B extends { pageSetup?: PageSetup | null; chapterDesign?: ChapterDesign | null }>(
  book: B,
  style: BookStyleOption,
  fallback: PageSetup
): B => {
  const base = book.pageSetup || fallback
  const pageSetup: PageSetup = {
    ...base,
    typography: style.typography,
    header: style.header,
    mirrorMargins: style.id === 'manuscript' ? base.mirrorMargins : true,
    differentFirstPage: true,
    chapterStartsOnRecto: style.design.chapterBreak === ChapterBreak.NewRightPage,
  }
  if (style.versoHeader) pageSetup.versoHeader = style.versoHeader
  else delete pageSetup.versoHeader
  return { ...book, pageSetup, chapterDesign: { ...style.design } }
}
