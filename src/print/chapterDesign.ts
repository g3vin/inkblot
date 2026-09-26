/**
 * chapterDesign.ts — how a book's chapters open, and its covers, as the book reads them.
 *
 * A book set up before chapter designs had its heads decided by two older settings: its
 * chapter numbering ("Chapter One" or none, the title kept or not) and its setup's
 * "chapters start on a right-hand page". `designFor` derives the design those settings
 * describe, so an old book looks the same the first time it is typeset; the design is
 * stored from then on. Covers likewise: a book with one `coverImage` has one version.
 */
import { ChapterBreak, ChapterNumberStyle, CoverFit, HeadAlignment, HeadCase, OrnamentKind, OrnamentPosition } from '../types'
import type { BookSettings, ChapterDesign, ChapterNumbering, CoverSet, PageSetup } from '../types'

export const DEFAULT_CHAPTER_DESIGN: ChapterDesign = {
  showNumber: false,
  showTitle: true,
  showSubtitle: true,
  showImage: true,
  ornament: OrnamentKind.None,
  ornamentGlyph: '',
  ornamentPosition: OrnamentPosition.Above,
  imageWidthPct: 40,
  alignment: HeadAlignment.Center,
  numberCase: HeadCase.AsWritten,
  titleCase: HeadCase.AsWritten,
  numberSizePt: 12,
  titleSizePt: 20,
  chapterBreak: ChapterBreak.NewPage,
}

const objectOr = <T extends object>(value: unknown): Partial<T> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<T> : {}
)

/** A stored design with anything missing filled in. */
export const normalizeChapterDesign = (value: unknown): ChapterDesign => {
  const stored = objectOr<ChapterDesign>(value)
  const design = { ...DEFAULT_CHAPTER_DESIGN, ...stored }
  const width = Number(design.imageWidthPct)
  design.imageWidthPct = Number.isFinite(width) ? Math.min(100, Math.max(5, width)) : DEFAULT_CHAPTER_DESIGN.imageWidthPct
  return design
}

/**
 * The design a book's chapters open with: its own, or — for a book from before designs —
 * the one its numbering and recto rule describe.
 */
export const designFor = (
  book: { chapterDesign?: ChapterDesign | null; chapterNumbering?: Partial<ChapterNumbering> | null } | null | undefined,
  setup?: Pick<PageSetup, 'chapterStartsOnRecto'> | null
): ChapterDesign => {
  if (book?.chapterDesign) return normalizeChapterDesign(book.chapterDesign)
  const numbered = Boolean(book?.chapterNumbering?.style) && book?.chapterNumbering?.style !== ChapterNumberStyle.None
  return {
    ...DEFAULT_CHAPTER_DESIGN,
    showNumber: numbered,
    // Numbered chapters used to keep their title only when asked to.
    showTitle: !numbered || book?.chapterNumbering?.includeTitle !== false,
    chapterBreak: setup?.chapterStartsOnRecto ? ChapterBreak.NewRightPage : ChapterBreak.NewPage,
  }
}

const cleanCover = (value: unknown, index: number): CoverSet | null => {
  const cover = objectOr<CoverSet>(value)
  const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
  const id = text(cover.id) || `cover-${index + 1}`
  const out: CoverSet = {
    id,
    name: text(cover.name) || (index ? `Cover ${index + 1}` : 'Cover'),
    fit: Object.values(CoverFit).includes(cover.fit as CoverFit) ? cover.fit as CoverFit : CoverFit.Fill,
  }
  for (const part of ['front', 'back', 'spine', 'wrap'] as const) {
    const path = text(cover[part])
    if (path) out[part] = path
  }
  if (Number.isFinite(cover.madeForSpineMm)) out.madeForSpineMm = cover.madeForSpineMm
  return out
}

/**
 * A book's cover versions and the active one. A book with only `coverImage` — from
 * before versions — has that as the front of its one version.
 */
export const coversOf = (book: Partial<BookSettings> | null | undefined): { covers: CoverSet[]; activeCover?: string } => {
  const stored = Array.isArray(book?.covers) ? book.covers : []
  const covers = stored.map(cleanCover).filter((c): c is CoverSet => Boolean(c))
  if (!covers.length && typeof book?.coverImage === 'string' && book.coverImage) {
    covers.push({ id: 'cover', name: 'Cover', front: book.coverImage, fit: CoverFit.Fill })
  }
  const active = covers.find((c) => c.id === book?.activeCover) || covers[0]
  return active ? { covers, activeCover: active.id } : { covers }
}

/** The cover a book prints and exports with. */
export const activeCoverOf = (book: Partial<BookSettings> | null | undefined): CoverSet | null => {
  const { covers, activeCover } = coversOf(book)
  return covers.find((c) => c.id === activeCover) || null
}

/** The book's cover versions changed, with `coverImage` following the active front. */
export const withCovers = <B extends Partial<BookSettings>>(book: B, covers: CoverSet[], activeCover?: string): B => {
  const active = covers.find((c) => c.id === activeCover) || covers[0]
  const out: B = { ...book, covers, activeCover: active?.id }
  if (!active) delete out.activeCover
  if (active?.front) out.coverImage = active.front
  else delete out.coverImage
  return out
}

/**
 * A change to a book's cover versions: a new one (empty, and made active), a copy, a
 * new name, one gone, which is active, how its pictures fit.
 */
export const editCovers = <B extends Partial<BookSettings>>(
  book: B,
  { action, id, name, fit, newId }: { action: string; id?: string | null; name?: string | null; fit?: CoverFit | null; newId: string }
): B => {
  const { covers, activeCover } = coversOf(book)
  const target = covers.find((c) => c.id === (id || activeCover))
  const unique = (base: string) => {
    let n = 1
    let candidate = base
    while (covers.some((c) => c.name === candidate)) candidate = `${base} ${++n}`
    return candidate
  }
  switch (action) {
    case 'add': return withCovers(book, [...covers, { id: newId, name: unique(name?.trim() || 'Cover'), fit: CoverFit.Fill }], newId)
    case 'duplicate':
      return target ? withCovers(book, [...covers, { ...target, id: newId, name: unique(`${target.name} Copy`) }], newId) : book
    case 'rename':
      return target && name?.trim() ? withCovers(book, covers.map((c) => (c === target ? { ...c, name: name.trim() } : c)), activeCover) : book
    case 'delete': {
      const rest = covers.filter((c) => c !== target)
      return withCovers(book, rest, activeCover === target?.id ? rest[0]?.id : activeCover)
    }
    case 'activate': return target ? withCovers(book, covers, target.id) : book
    case 'setFit': return target && fit ? withCovers(book, covers.map((c) => (c === target ? { ...c, fit } : c)), activeCover) : book
    default: return book
  }
}

/**
 * The book with one part of its active cover set — a new version, "Cover", when it has
 * none — or cleared, with `path` null. `coverImage` follows the active front.
 */
export const withCoverPart = <B extends Partial<BookSettings>>(
  book: B,
  part: 'front' | 'back' | 'spine' | 'wrap',
  path: string | null,
  setId?: string
): B => {
  const { covers, activeCover } = coversOf(book)
  const id = setId || activeCover
  let target = covers.find((c) => c.id === id)
  if (!target) {
    if (!path) return book
    target = { id: id || 'cover', name: covers.length ? `Cover ${covers.length + 1}` : 'Cover', fit: CoverFit.Fill }
    covers.push(target)
  }
  const next = covers.map((c) => {
    if (c !== target) return c
    const edited: CoverSet = { ...c }
    if (path) edited[part] = path
    else delete edited[part]
    return edited
  })
  const active = next.find((c) => c.id === (activeCover || target.id))
  const out: B = { ...book, covers: next, activeCover: active?.id }
  if (active?.front) out.coverImage = active.front
  else delete out.coverImage
  return out
}
