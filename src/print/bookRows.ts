/**
 * bookRows.ts — a book's contents as the Book navigator lists them: each entry with its
 * number, its label and where it falls. Pure; the page publishes these in
 * `PageLayoutState.bookItems`.
 */
import { BookItemKind, BookRowSection, ChapterNumberStyle } from '../types'
import type { BookItem, BookRow, ChapterNumbering } from '../types'
import { chapterLabel } from './bookMatter'
import { chapterNumbers, isLegacyMatter, itemTitle, pageOptionsOf, partNumbers, sectionsOf } from './bookItems'

const TYPE_LABELS: Record<string, string> = { prologue: 'Prologue', epilogue: 'Epilogue', interlude: 'Interlude' }

export const bookRows = (items: BookItem[], numbering?: Partial<ChapterNumbering> | null): BookRow[] => {
  const chapters = chapterNumbers(items, numbering?.startAt ?? 1)
  const parts = partNumbers(items)
  const { front, back } = sectionsOf(items)
  const frontIds = new Set(front.map((it) => it.id))
  const backIds = new Set(back.map((it) => it.id))
  const style = numbering?.style && numbering.style !== ChapterNumberStyle.None ? numbering.style : null
  const partStyle = { style: style || ChapterNumberStyle.Words, prefix: 'Part', includeTitle: true } as ChapterNumbering
  let part: string | undefined
  return items.map((item) => {
    const section = frontIds.has(item.id) ? BookRowSection.Front : backIds.has(item.id) ? BookRowSection.Back : BookRowSection.Body
    if (item.kind === BookItemKind.Part) part = item.id
    if (section !== BookRowSection.Body) part = undefined
    const number = item.kind === BookItemKind.Part ? parts.get(item.id) : chapters.get(item.id)
    let label: string | undefined
    if (item.kind === BookItemKind.Part && number) label = chapterLabel(number, partStyle) || undefined
    // As compiling writes it: in words until the book chooses how to number.
    else if (number != null) {
      label = chapterLabel(number, { ...numbering, style: style || ChapterNumberStyle.Words, prefix: numbering?.prefix ?? 'Chapter' } as ChapterNumbering) || undefined
    }
    else if (item.chapterType && TYPE_LABELS[item.chapterType]) label = TYPE_LABELS[item.chapterType]
    const row: BookRow = {
      id: item.id,
      kind: item.kind,
      title: itemTitle(item),
      hidden: Boolean(item.hidden),
      section,
      page: pageOptionsOf(item),
      legacy: isLegacyMatter(item),
    }
    if (item.path) row.path = item.path
    if (item.matter) row.matter = item.matter
    if (item.generated) row.generated = item.generated
    if (item.chapterType) row.chapterType = item.chapterType
    if (number != null) row.number = number
    if (label) row.label = label
    if (part && item.kind !== BookItemKind.Part && section === BookRowSection.Body) row.part = part
    return row
  })
}
