/**
 * bookItems.ts — a book's contents, in its own order: front matter, parts, chapters
 * and back matter.
 *
 * The chapters are the book folder's documents, and the file tree is never changed by
 * anything done to the book: the book keeps its own order of them (`BookSettings.items`),
 * reconciled against the tree each time it is read —
 *
 *   - a chapter whose document has gone drops out;
 *   - a document new to the folder goes in where the tree has it: after the chapter
 *     before it in tree order, as the writer would expect it;
 *   - front and back matter, and parts, stay where they were put.
 *
 * A book that has never been typeset has no items. It reads as the tree's documents in
 * tree order (less the ones left out), a part for each subfolder, and the front and back
 * matter it had as text — kept as "legacy" items, printed from that text, until Typeset
 * makes them real documents (`materializeMatter`).
 *
 * Front and back matter are real documents, kept in the book folder's `.book/`, which the
 * file tree does not list: a dedication or About the Author is a page like any other,
 * with pictures if the writer wants them, its own history, and editable in Typeset.
 * Some pages are laid out from the book's data instead (`GeneratedKind`): the half title,
 * the title page, the contents.
 */
import { BookItemKind, ChapterType, GeneratedKind, MatterKind, PagePosition, PageStart } from '../types'
import type { BackMatter, BookItem, BookSettings, FrontMatter, PageOptions } from '../types'

type Kind = MatterKind | GeneratedKind

/** The standard order of the pages before the first chapter. */
export const FRONT_ORDER: Kind[] = [
  GeneratedKind.HalfTitle, MatterKind.HalfTitle, MatterKind.AlsoBy, GeneratedKind.TitlePage, MatterKind.TitlePage,
  MatterKind.Copyright, MatterKind.Dedication, MatterKind.Epigraph, GeneratedKind.Contents,
  MatterKind.Foreword, MatterKind.Preface, MatterKind.Introduction,
]

/** The standard order of the pages after the last. */
export const BACK_ORDER: Kind[] = [
  MatterKind.Afterword, MatterKind.Acknowledgements, MatterKind.AboutAuthor, MatterKind.AlsoBy,
  GeneratedKind.Notes, GeneratedKind.Bibliography, MatterKind.Glossary, MatterKind.Excerpt,
  MatterKind.ReadingGuide, MatterKind.CallToAction,
]

/** What a kind of page is called: in the navigator, and as a page's heading. */
export const KIND_LABELS: Record<string, string> = {
  [GeneratedKind.HalfTitle]: 'Half Title',
  [GeneratedKind.TitlePage]: 'Title Page',
  [GeneratedKind.Contents]: 'Contents',
  [GeneratedKind.Notes]: 'Notes',
  [GeneratedKind.Bibliography]: 'Bibliography',
  [MatterKind.AlsoBy]: 'Also By',
  [MatterKind.Copyright]: 'Copyright',
  [MatterKind.Dedication]: 'Dedication',
  [MatterKind.Epigraph]: 'Epigraph',
  [MatterKind.Foreword]: 'Foreword',
  [MatterKind.Preface]: 'Preface',
  [MatterKind.Introduction]: 'Introduction',
  [MatterKind.Afterword]: 'Afterword',
  [MatterKind.Acknowledgements]: 'Acknowledgements',
  [MatterKind.AboutAuthor]: 'About the Author',
  [MatterKind.Glossary]: 'Glossary',
  [MatterKind.Excerpt]: 'Excerpt',
  [MatterKind.ReadingGuide]: 'Reading Group Guide',
  [MatterKind.CallToAction]: 'Newsletter',
  // A half title or title page made a page of its own has the same name: its kind's
  // value is the generated one's.
  [MatterKind.Custom]: 'Page',
}

/** Which side a kind belongs on, when it is added: front, or back. */
export const sideOf = (kind: Kind, preferBack = false): 'front' | 'back' => {
  const front = FRONT_ORDER.includes(kind)
  const back = BACK_ORDER.includes(kind)
  if (front && back) return preferBack ? 'back' : 'front'
  return back ? 'back' : 'front'
}

/** How each kind of page sits, unless the author changes it. */
export const defaultPageOptions = (item: Pick<BookItem, 'kind' | 'matter' | 'generated'>): PageOptions => {
  const quiet = { runningHeads: false, folio: false, heading: false }
  switch (item.matter ?? item.generated) {
    case MatterKind.Copyright:
      return { ...quiet, start: PageStart.Verso, position: PagePosition.Bottom }
    case MatterKind.Dedication:
    case MatterKind.Epigraph:
      return { ...quiet, start: PageStart.Recto, position: PagePosition.Sunk }
    case MatterKind.HalfTitle:
    case MatterKind.TitlePage:
    case GeneratedKind.HalfTitle:
    case GeneratedKind.TitlePage:
      return { ...quiet, start: PageStart.Recto, position: PagePosition.Top }
    case MatterKind.AlsoBy:
      return { ...quiet, start: PageStart.Any, position: PagePosition.Top }
    default:
      break
  }
  if (item.kind === BookItemKind.Part) return { ...quiet, start: PageStart.Recto, position: PagePosition.Sunk, heading: true }
  return { start: PageStart.Recto, position: PagePosition.Top, runningHeads: true, folio: true, heading: true }
}

/** An item's page options: its own over its kind's. */
export const pageOptionsOf = (item: BookItem): PageOptions => ({ ...defaultPageOptions(item), ...(item.page || {}) })

let counter = 0
/** A new item id: unique within a book, short enough to read in a file name. */
export const newItemId = (): string => {
  counter = (counter + 1) % 1296
  return `${Date.now().toString(36).slice(-5)}${counter.toString(36).padStart(2, '0')}`
}

/** Where a matter document is kept: the book folder's `.book/`. */
export const matterPathFor = (folder: string, kind: MatterKind, id: string): string => (
  `${folder ? `${folder}/` : ''}.book/${kind}-${id}`
)

const chapterId = (path: string) => `c:${path}`
const partId = (path: string) => `p:${path}`

/** The top subfolder of the book folder a chapter is in, or null for one directly in it. */
export const partFolderOf = (path: string, folder: string): string | null => {
  const rest = folder ? path.slice(folder.length + 1) : path
  const parts = rest.split('/')
  if (parts.length < 2) return null
  return folder ? `${folder}/${parts[0]}` : parts[0]
}

const baseName = (path: string) => path.split('/').filter(Boolean).pop() || path

/** Text front and back matter, from before it was pages of their own. */
type LegacyBook = Pick<Partial<BookSettings>, 'excluded' | 'frontMatter' | 'backMatter'>

const LEGACY_FRONT: [MatterKind, 'copyright' | 'dedication' | 'epigraph'][] = [
  [MatterKind.Copyright, 'copyright'],
  [MatterKind.Dedication, 'dedication'],
  [MatterKind.Epigraph, 'epigraph'],
]
const LEGACY_BACK: [MatterKind, 'acknowledgements' | 'aboutTheAuthor' | 'alsoBy'][] = [
  [MatterKind.Acknowledgements, 'acknowledgements'],
  [MatterKind.AboutAuthor, 'aboutTheAuthor'],
  [MatterKind.AlsoBy, 'alsoBy'],
]

/** A legacy matter item: one printed from the book's old text, with no document yet. */
export const isLegacyMatter = (item: BookItem): boolean => item.kind === BookItemKind.Matter && !item.path && item.id.startsWith('legacy:')

/** The contents of a book never typeset: the tree's, and its text matter. */
const initialItems = (book: LegacyBook, chapters: string[], folder: string): BookItem[] => {
  const excluded = new Set(book.excluded || [])
  const front: Partial<FrontMatter> = book.frontMatter || {}
  const back: Partial<BackMatter> = book.backMatter || {}
  const items: BookItem[] = []
  const matter = (kind: MatterKind): BookItem => ({ id: `legacy:${kind}`, kind: BookItemKind.Matter, hidden: false, matter: kind })
  const generated = (kind: GeneratedKind): BookItem => ({ id: `g:${kind}`, kind: BookItemKind.Generated, hidden: false, generated: kind })
  if (front.halfTitle) items.push(generated(GeneratedKind.HalfTitle))
  for (const [kind, key] of LEGACY_FRONT) if (front[key]?.trim()) items.push(matter(kind))
  if (front.contents) items.push(generated(GeneratedKind.Contents))
  let part: string | null = null
  for (const path of chapters) {
    const folderOf = partFolderOf(path, folder)
    if (folderOf && folderOf !== part) {
      items.push({ id: partId(folderOf), kind: BookItemKind.Part, path: folderOf, title: baseName(folderOf), hidden: false })
    }
    part = folderOf
    items.push({ id: chapterId(path), kind: BookItemKind.Chapter, path, hidden: excluded.has(path) })
  }
  for (const [kind, key] of LEGACY_BACK) if (back[key]?.trim()) items.push(matter(kind))
  return items
}

const isBody = (item: BookItem) => item.kind === BookItemKind.Chapter || item.kind === BookItemKind.Part

/**
 * The book's contents in book order, reconciled with the folder's documents in tree
 * order (`chapters`, as `listBookChapters` gives them).
 */
export const reconcileBookItems = (
  book: LegacyBook & { items?: BookItem[] | null },
  chapters: string[],
  folder: string
): BookItem[] => {
  const stored = Array.isArray(book.items) ? book.items : []
  if (!stored.length) return initialItems(book, chapters, folder)
  const present = new Set(chapters)
  const seen = new Set<string>()
  const items = stored.filter((item) => {
    if (item.kind === BookItemKind.Chapter) {
      if (!item.path || !present.has(item.path) || seen.has(item.path)) return false
      seen.add(item.path)
      return true
    }
    // A part made from a folder goes with the folder.
    if (item.kind === BookItemKind.Part && item.path) return chapters.some((path) => path.startsWith(`${item.path}/`))
    return true
  })
  chapters.forEach((path, index) => {
    if (seen.has(path)) return
    const item: BookItem = { id: chapterId(path), kind: BookItemKind.Chapter, path, hidden: false }
    // After the nearest chapter before it in the tree that the book has…
    for (let i = index - 1; i >= 0; i -= 1) {
      const at = items.findIndex((it) => it.kind === BookItemKind.Chapter && it.path === chapters[i])
      if (at >= 0) {
        items.splice(at + 1, 0, item)
        seen.add(path)
        return
      }
    }
    // …or, the first in the tree, before the book's first chapter or part.
    const firstBody = items.findIndex(isBody)
    const lastFront = firstBody >= 0 ? firstBody : items.findIndex((it) => sectionOfKind(it) === 'back')
    items.splice(lastFront >= 0 ? lastFront : items.length, 0, item)
    seen.add(path)
  })
  return items
}

const sectionOfKind = (item: BookItem): 'front' | 'back' | null => {
  const kind = item.matter ?? item.generated
  return kind ? sideOf(kind) : null
}

/** The front matter, the body (from the first chapter or part), and the back matter. */
export const sectionsOf = <T extends BookItem>(items: T[]): { front: T[]; body: T[]; back: T[] } => {
  const first = items.findIndex(isBody)
  if (first < 0) {
    // No chapters: what is there sorts by kind.
    return {
      front: items.filter((it) => sectionOfKind(it) !== 'back'),
      body: [],
      back: items.filter((it) => sectionOfKind(it) === 'back'),
    }
  }
  let last = items.length - 1
  while (last > first && !isBody(items[last])) last -= 1
  return { front: items.slice(0, first), body: items.slice(first, last + 1), back: items.slice(last + 1) }
}

/** Whether a chapter item is numbered: a Chapter is; a Prologue, an Interlude are not. */
export const isNumbered = (item: BookItem): boolean => (
  item.kind === BookItemKind.Chapter && (item.chapterType ?? ChapterType.Chapter) === ChapterType.Chapter
)

/** Each visible numbered chapter's number, by id, counting from `startAt`. */
export const chapterNumbers = (items: BookItem[], startAt = 1): Map<string, number> => {
  const numbers = new Map<string, number>()
  let n = startAt === 0 ? 0 : 1
  for (const item of items) {
    if (item.hidden || !isNumbered(item)) continue
    numbers.set(item.id, n)
    n += 1
  }
  return numbers
}

/** Each visible part's number, by id, from one. */
export const partNumbers = (items: BookItem[]): Map<string, number> => {
  const numbers = new Map<string, number>()
  let n = 1
  for (const item of items) {
    if (item.hidden || item.kind !== BookItemKind.Part) continue
    numbers.set(item.id, n)
    n += 1
  }
  return numbers
}

/** What an item is called in the navigator. */
export const itemTitle = (item: BookItem): string => {
  if (item.title) return item.title
  if (item.kind === BookItemKind.Chapter && item.path) return baseName(item.path)
  const kind = item.matter ?? item.generated
  return (kind && KIND_LABELS[kind]) || 'Untitled'
}

/**
 * Put a new front or back matter item where the standard order has it: after the last
 * item on its side whose kind comes before it.
 */
export const insertMatterItem = (items: BookItem[], item: BookItem, side?: 'front' | 'back'): BookItem[] => {
  const kind = (item.matter ?? item.generated) as Kind
  const where = side || sideOf(kind)
  const order = where === 'front' ? FRONT_ORDER : BACK_ORDER
  const rank = (it: BookItem) => {
    const k = (it.matter ?? it.generated) as Kind | undefined
    return k ? order.indexOf(k) : -1
  }
  const mine = order.indexOf(kind)
  const { front, body, back } = sectionsOf(items)
  const list = where === 'front' ? front : back
  // Before the first that the standard order puts after it; a custom page goes last.
  const later = mine < 0 ? -1 : list.findIndex((it) => rank(it) > mine)
  const at = later < 0 ? list.length : later
  const placed = [...list.slice(0, at), item, ...list.slice(at)]
  return where === 'front' ? [...placed, ...body, ...back] : [...front, ...body, ...placed]
}

/**
 * A new front or back matter item — a document for a matter kind, a page laid out from
 * the book for a generated one — ready to insert.
 */
export const newMatterItem = (
  folder: string,
  kind: { matter?: MatterKind; generated?: GeneratedKind },
  id = newItemId()
): BookItem => (kind.generated
  ? { id: `g:${kind.generated}-${id}`, kind: BookItemKind.Generated, generated: kind.generated, hidden: false }
  : { id, kind: BookItemKind.Matter, matter: kind.matter, path: matterPathFor(folder, kind.matter as MatterKind, id), hidden: false })

/** Move the item `id` to before the item `before` (or last), in a new list. */
export const moveItem = (items: BookItem[], id: string, before: string | null): BookItem[] => {
  const item = items.find((it) => it.id === id)
  if (!item || id === before) return items
  const rest = items.filter((it) => it.id !== id)
  const at = before ? rest.findIndex((it) => it.id === before) : -1
  return at < 0 ? [...rest, item] : [...rest.slice(0, at), item, ...rest.slice(at)]
}

/* ---------------- templates ---------------- */

interface PMNode { type: string; attrs?: Record<string, unknown>; content?: PMNode[]; text?: string; marks?: { type: string }[] }

const p = (text = '', attrs: Record<string, unknown> = {}): PMNode => (
  { type: 'paragraph', attrs, ...(text ? { content: [{ type: 'text', text }] } : {}) }
)
const h1 = (text: string): PMNode => ({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text }] })
const centered = (text = '') => p(text, { textAlign: 'center' })

/**
 * What a new page of front or back matter starts with: the usual wording, for the
 * author to change. A heading where the page has one, so it reads as that page.
 */
export const matterTemplate = (
  kind: MatterKind,
  { title = '', author = '', year = new Date().getFullYear() }: { title?: string; author?: string; year?: number } = {}
): { type: 'doc'; content: PMNode[] } => {
  const by = author || 'the Author'
  const doc = (...content: PMNode[]) => ({ type: 'doc' as const, content })
  switch (kind) {
    case MatterKind.Copyright:
      return doc(
        p(title || 'Untitled'),
        p(`Copyright © ${year} ${by}`),
        p('All rights reserved. No part of this book may be reproduced in any form without written permission from the author, except for brief quotations in a review.'),
        p('This is a work of fiction. Names, characters, places and incidents are the product of the author’s imagination or are used fictitiously.'),
        p('ISBN: '),
        p('First edition'),
      )
    case MatterKind.Dedication:
      return doc(centered('For …'))
    case MatterKind.Epigraph:
      return doc(centered('The quotation.'), centered('— Who said it'))
    case MatterKind.AlsoBy:
      return doc(h1(`Also by ${by}`), centered('A Title'), centered('Another Title'))
    case MatterKind.AboutAuthor:
      return doc(h1('About the Author'), p(`${by} lives and writes in …`))
    case MatterKind.CallToAction:
      return doc(h1('Thank You for Reading'), p('If you enjoyed this book, …'))
    case MatterKind.HalfTitle:
      return doc(centered(title || 'Untitled'))
    case MatterKind.TitlePage:
      return doc(centered(title || 'Untitled'), centered(author ? `by ${author}` : ''))
    case MatterKind.Excerpt:
      return doc(h1('An Excerpt'), p())
    case MatterKind.Custom:
      return doc(p())
    default:
      return doc(h1(KIND_LABELS[kind] || 'Untitled'), p())
  }
}
