/**
 * notes.ts — a book's footnotes: numbered, and set where the book says.
 *
 * A note is written where it belongs, as a `footnote` node at its mark (Footnote.ts),
 * holding its own text. Compiling a book gives each its mark — 1, 2, 3, afresh in each
 * chapter or on through the book, or * † ‡ — and then sets them where the book puts its
 * notes (`BookSettings.notes`):
 *
 *   page      at the foot of the page the mark is on: the marks stay notes, and
 *             pagination keeps room for them at each page's foot (measure.ts, paginate.ts)
 *   chapter   after the chapter, under a heading: the marks become references
 *   book      all together, chapter by chapter, in the book's Notes (its own Notes entry
 *             in the navigator, or a section of their own before the back matter)
 *
 * Pure over compiled sections, so print and every export number the same notes alike.
 */
import { NoteMarks, NoteNumbering, NotePlacement } from '../types'
import type { NotesOptions } from '../types'

type PMNode = { type: string; attrs?: Record<string, unknown>; content?: PMNode[]; text?: string; marks?: unknown[] }

export const DEFAULT_NOTES: NotesOptions = {
  placement: NotePlacement.Page,
  numbering: NoteNumbering.PerChapter,
  marks: NoteMarks.Numbers,
  heading: 'Notes',
}

export const notesOptionsOf = (book: { notes?: Partial<NotesOptions> | null } | null | undefined): NotesOptions => {
  const n = (book?.notes || {}) as Partial<NotesOptions>
  return {
    placement: Object.values(NotePlacement).includes(n.placement as NotePlacement) ? n.placement as NotePlacement : DEFAULT_NOTES.placement,
    numbering: Object.values(NoteNumbering).includes(n.numbering as NoteNumbering) ? n.numbering as NoteNumbering : DEFAULT_NOTES.numbering,
    marks: Object.values(NoteMarks).includes(n.marks as NoteMarks) ? n.marks as NoteMarks : DEFAULT_NOTES.marks,
    heading: typeof n.heading === 'string' && n.heading.trim() ? n.heading.trim() : DEFAULT_NOTES.heading,
  }
}

export const NOTE_SYMBOLS = ['*', '†', '‡', '§', '‖', '¶']

/** The mark of note `n` (from 1): its number, or its symbol — doubled after six. */
export const noteMark = (n: number, marks: NoteMarks | string = NoteMarks.Numbers): string => {
  if (marks !== NoteMarks.Symbols) return String(n)
  const i = Math.max(0, n - 1)
  return NOTE_SYMBOLS[i % NOTE_SYMBOLS.length].repeat(Math.floor(i / NOTE_SYMBOLS.length) + 1)
}

export interface Note {
  id: string
  mark: string
  text: string
}

/** A document's notes in order, with where each is. */
export const footnotesOf = (doc: PMNode): Array<{ id: string; text: string }> => {
  const out: Array<{ id: string; text: string }> = []
  const walk = (node: PMNode) => {
    if (node.type === 'footnote') out.push({ id: String(node.attrs?.id || ''), text: String(node.attrs?.text || '') })
    for (const child of node.content || []) walk(child)
  }
  walk(doc)
  return out
}

/** A copy of `doc` with each note given its mark, from `start`; and the notes, in order. */
export const markNotes = (doc: PMNode, start: number, options: NotesOptions, end: boolean): { doc: PMNode; notes: Note[]; next: number } => {
  let n = start
  const notes: Note[] = []
  const walk = (node: PMNode): PMNode => {
    if (node.type === 'footnote') {
      const mark = noteMark(n, options.marks)
      n += 1
      const id = String(node.attrs?.id || `n${n}`)
      notes.push({ id, mark, text: String(node.attrs?.text || '') })
      return { ...node, attrs: { ...node.attrs, id, mark, ...(end ? { end: true } : {}) } }
    }
    return node.content ? { ...node, content: node.content.map(walk) } : node
  }
  const out = walk(doc)
  return { doc: out, notes, next: n }
}

const text = (value: string): PMNode => ({ type: 'text', text: value })

/** Notes as paragraphs: "1. The text." — for a chapter's end, or the book's. */
export const noteParagraphs = (notes: Note[]): PMNode[] => notes.map((note) => ({
  type: 'paragraph',
  attrs: { styleName: null, noteId: note.id },
  content: [text(`${note.mark}. `), ...(note.text ? [text(note.text)] : [])],
}))

/** The notes after a chapter: a heading, and each note. */
export const withChapterNotes = (doc: PMNode, notes: Note[], heading: string): PMNode => (notes.length ? {
  ...doc,
  content: [
    ...(doc.content || []),
    { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [text(heading)] },
    ...noteParagraphs(notes),
  ],
} : doc)

interface NoteSection {
  item: { id: string; kind: string; generated?: string | null }
  role?: string
  content?: PMNode | null
  name?: string
  notes?: Note[]
}

/**
 * Number a compiled book's notes and set them where the book says. Each chapter's
 * notes are on its section as `notes`, for an export that sets them its own way (an
 * EPUB's pop-up notes, a Word document's footnotes). `titleOf` names a chapter over its
 * notes at the end of the book.
 */
export const setBookNotes = <S extends NoteSection>(
  sections: S[],
  options: NotesOptions,
  titleOf: (section: S) => string = (s) => s.name || '',
): S[] => {
  let next = 1
  const collected: Array<{ title: string; notes: Note[] }> = []
  const out = sections.map((section) => {
    if (section.item.kind !== 'chapter' || !section.content) return section
    if (!footnotesOf(section.content).length) {
      if (options.numbering === NoteNumbering.PerChapter) next = 1
      return section
    }
    if (options.numbering === NoteNumbering.PerChapter) next = 1
    const end = options.placement !== NotePlacement.Page
    const marked = markNotes(section.content, next, options, end)
    next = marked.next
    if (options.placement === NotePlacement.Book) collected.push({ title: titleOf(section), notes: marked.notes })
    const content = options.placement === NotePlacement.Chapter ? withChapterNotes(marked.doc, marked.notes, options.heading) : marked.doc
    return { ...section, content, notes: marked.notes }
  })
  if (options.placement !== NotePlacement.Book || !collected.length) return out
  const content: PMNode = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [text(options.heading)] },
      ...collected.flatMap(({ title, notes }) => [
        ...(title ? [{ type: 'heading', attrs: { level: 3 }, content: [text(title)] }] : []),
        ...noteParagraphs(notes),
      ]),
    ],
  }
  // The book's own Notes entry, where it has one; else a section before the back matter.
  const at = out.findIndex((s) => s.item.kind === 'generated' && s.item.generated === 'notes')
  if (at >= 0) return out.map((s, i) => (i === at ? { ...s, content } : s))
  const notesSection = { item: { id: 'g:notes', kind: 'generated', generated: 'notes' }, role: 'back', name: options.heading, content } as unknown as S
  const backAt = out.findIndex((s) => s.role === 'back')
  return backAt < 0 ? [...out, notesSection] : [...out.slice(0, backAt), notesSection, ...out.slice(backAt)]
}

/** A document's notes numbered and set on their own — printed or exported alone. */
export const setDocumentNotes = (doc: PMNode, options: NotesOptions): { doc: PMNode; notes: Note[] } => {
  const end = options.placement !== NotePlacement.Page
  const marked = markNotes(doc, 1, options, end)
  if (!marked.notes.length) return { doc, notes: [] }
  return { doc: end ? withChapterNotes(marked.doc, marked.notes, options.heading) : marked.doc, notes: marked.notes }
}

/** A live document's notes set at the page's foot, with where each mark is, numbered from `start`. */
export const pageNotesOf = (
  doc: { descendants: (f: (node: { type: { name: string }; attrs: Record<string, unknown> }, pos: number) => boolean | void) => void },
  start = 1,
  marks: NoteMarks | string = NoteMarks.Numbers,
): Array<{ pos: number; mark: string; text: string }> => {
  const out: Array<{ pos: number; mark: string; text: string }> = []
  let n = start
  doc.descendants((node, pos) => {
    if (node.type.name !== 'footnote') return true
    if (!node.attrs.end) out.push({ pos, mark: String(node.attrs.mark || noteMark(n, marks)), text: String(node.attrs.text || '') })
    n += 1
    return false
  })
  return out
}

/** The notes set at each slot's foot: those whose marks fall in the slot. */
export const notesBySlot = <N extends { pos: number }>(notes: N[], slotStarts: Array<number | null>): Map<number, N[]> => {
  const out = new Map<number, N[]>()
  if (!notes.length) return out
  const starts = slotStarts.map((pos, slot) => ({ pos, slot })).filter((s) => s.pos != null) as Array<{ pos: number; slot: number }>
  for (const note of notes) {
    let slot = starts[0]?.slot ?? 0
    for (const s of starts) {
      if (s.pos <= note.pos) slot = s.slot
      else break
    }
    out.set(slot, [...(out.get(slot) || []), note])
  }
  return out
}
