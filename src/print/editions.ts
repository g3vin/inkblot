/**
 * editions.ts — one book, in several forms: a paperback, a hardcover, large print, an
 * e-book.
 *
 * What makes a book the same book is shared: its contents, their order, how chapters
 * open, its styles. What an edition changes is its page — trim, margins, type — and its
 * cover. So an edition holds only those (`Edition.pageSetup`, `coverSetId`), and the
 * book shown and printed is the book with the active edition's put over it
 * (`effectiveBook`). An edit made while an edition is active is the edition's
 * (`routeToEdition`): changing the large print's type size leaves the paperback's alone.
 */
import { EditionKind, LineSpacing, PrintAlignment } from '../types'
import type { BookSettings, Edition, PageSetup } from '../types'
import { normalizePageSetup } from './pageSetup'
import { BOOK_TYPOGRAPHY } from './typography'

type Book = Partial<BookSettings> & Record<string, unknown>

export const EDITION_NAMES: Record<EditionKind, string> = {
  [EditionKind.Paperback]: 'Paperback',
  [EditionKind.Hardcover]: 'Hardcover',
  [EditionKind.LargePrint]: 'Large Print',
  [EditionKind.Ebook]: 'eBook',
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

/**
 * An edition's page from its kind, over the book's: a hardcover's wider inside margin
 * for its stiffer binding; large print's 16 pt type, loosely leaded, ragged, unhyphenated
 * (as the large-print guidelines ask); an e-book's none — a reader sets its own page.
 */
export const presetPageSetup = (kind: EditionKind, base: PageSetup | null | undefined): PageSetup | undefined => {
  if (kind === EditionKind.Ebook) return undefined
  const setup = normalizePageSetup(clone(base || {})) as PageSetup
  if (kind === EditionKind.Hardcover) {
    setup.margins = { ...setup.margins, insideMm: setup.margins.insideMm + 3.175 }
  }
  if (kind === EditionKind.LargePrint) {
    const t = setup.typography || BOOK_TYPOGRAPHY
    setup.typography = {
      ...t,
      fontSizePt: 16,
      lineSpacing: LineSpacing.Multiple,
      lineValue: 1.3,
      alignment: PrintAlignment.Left,
      hyphenate: false,
      firstLineIndentMm: Math.max(t.firstLineIndentMm, 8),
    }
  }
  return setup
}

const uniqueName = (name: string, editions: Edition[]) => {
  let out = name
  for (let n = 2; editions.some((e) => e.name === out); n += 1) out = `${name} ${n}`
  return out
}

/** The active edition, if the book has one. */
export const activeEditionOf = (book: Book | null | undefined): Edition | null => {
  const editions = Array.isArray(book?.editions) ? book!.editions as Edition[] : []
  return editions.find((e) => e.id === book?.activeEdition) || null
}

/** The book as an edition sets it: its page and cover over the book's. */
export const bookForEdition = <B extends Book>(book: B, edition: Edition | null): B => {
  if (!edition) return book
  const out = { ...book } as B & Record<string, unknown>
  if (edition.pageSetup) out.pageSetup = edition.pageSetup
  if (edition.coverSetId && Array.isArray(book.covers) && (book.covers as Array<{ id: string }>).some((c) => c.id === edition.coverSetId)) {
    out.activeCover = edition.coverSetId
  }
  return out
}

/** The book as it is shown and printed now: with the active edition's page and cover. */
export const effectiveBook = <B extends Book>(book: B): B => bookForEdition(book, activeEditionOf(book))

/**
 * An edit of the shown book, stored: while an edition is active, its page and cover
 * are the edition's, and the book's own are kept as they were.
 */
export const routeToEdition = <B extends Book>(stored: Book, next: B): B => {
  const activeId = stored.activeEdition
  if (!activeId || next.activeEdition !== activeId) return next
  const editions = (Array.isArray(next.editions) ? next.editions : stored.editions || []) as Edition[]
  const edition = editions.find((e) => e.id === activeId)
  if (!edition) return next
  // What changed from the edition as it was shown: only that becomes the edition's.
  const shownPage = edition.pageSetup || stored.pageSetup || null
  const pageChanged = JSON.stringify(next.pageSetup ?? null) !== JSON.stringify(shownPage)
  const coverChanged = next.activeCover !== (edition.coverSetId || stored.activeCover)
  const updated: Edition = {
    ...edition,
    ...(pageChanged && next.pageSetup ? { pageSetup: next.pageSetup as PageSetup } : {}),
    ...(coverChanged && next.activeCover ? { coverSetId: next.activeCover as string } : {}),
  }
  const out = {
    ...next,
    editions: editions.map((e) => (e.id === activeId ? updated : e)),
  } as B & Record<string, unknown>
  // The book's own page and cover stay the book's.
  if ('pageSetup' in stored) out.pageSetup = stored.pageSetup
  else delete out.pageSetup
  if (stored.activeCover) out.activeCover = stored.activeCover
  return out
}

export interface EditionEdit {
  action: 'add' | 'duplicate' | 'rename' | 'delete' | 'activate' | 'setCover' | 'fromTypesetVersion'
  id?: string | null
  name?: string | null
  kind?: EditionKind | null
  coverSetId?: string | null
  /** The id a new edition takes. */
  newId: string
  /** For `fromTypesetVersion`: that version's book. */
  versionBook?: Book | null
}

/** A book's editions edited, as stored (not as shown). Unchanged when the edit is of nothing. */
export const editEditions = <B extends Book>(book: B, edit: EditionEdit): B => {
  const editions = (Array.isArray(book.editions) ? book.editions : []) as Edition[]
  const find = (id?: string | null) => editions.find((e) => e.id === id)
  const withEditions = (list: Edition[], active: string | null | undefined): B => {
    const out = { ...book, editions: list } as B & Record<string, unknown>
    if (active) out.activeEdition = active
    else delete out.activeEdition
    return out
  }
  switch (edit.action) {
    case 'add': {
      const kind = edit.kind || EditionKind.Paperback
      // Its page from the book's own, as shown for it now.
      const base = (effectiveBook(book).pageSetup || book.pageSetup) as PageSetup | undefined
      const setup = presetPageSetup(kind, base)
      const edition: Edition = { id: edit.newId, name: uniqueName(edit.name || EDITION_NAMES[kind], editions), kind, ...(setup ? { pageSetup: setup } : {}) }
      return withEditions([...editions, edition], edition.id)
    }
    case 'duplicate': {
      const from = find(edit.id)
      if (!from) return book
      const copy: Edition = { ...clone(from), id: edit.newId, name: uniqueName(`${from.name} Copy`, editions) }
      return withEditions([...editions, copy], copy.id)
    }
    case 'rename': {
      const name = (edit.name || '').trim()
      if (!find(edit.id) || !name) return book
      return withEditions(editions.map((e) => (e.id === edit.id ? { ...e, name } : e)), book.activeEdition as string)
    }
    case 'delete': {
      if (!find(edit.id)) return book
      return withEditions(editions.filter((e) => e.id !== edit.id), book.activeEdition === edit.id ? null : book.activeEdition as string)
    }
    case 'activate':
      if (edit.id && !find(edit.id)) return book
      return withEditions(editions, edit.id || null)
    case 'setCover':
      if (!find(edit.id)) return book
      return withEditions(editions.map((e) => {
        if (e.id !== edit.id) return e
        const { coverSetId: _old, ...rest } = e
        return edit.coverSetId ? { ...rest, coverSetId: edit.coverSetId } : rest
      }), book.activeEdition as string)
    case 'fromTypesetVersion': {
      const version = edit.versionBook
      if (!version) return book
      const edition: Edition = {
        id: edit.newId,
        name: uniqueName(edit.name || 'From a Typeset Version', editions),
        kind: EditionKind.Paperback,
        ...(version.pageSetup ? { pageSetup: clone(version.pageSetup) as PageSetup } : {}),
        ...(typeof version.activeCover === 'string' ? { coverSetId: version.activeCover } : {}),
      }
      return withEditions([...editions, edition], edition.id)
    }
    default:
      return book
  }
}

/** Whether an edition is an e-book: exported as an EPUB, not printed. */
export const isEbookEdition = (edition: Edition | null | undefined): boolean => edition?.kind === EditionKind.Ebook
