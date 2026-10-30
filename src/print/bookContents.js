/**
 * bookContents.js — changing a book's contents: the Book navigator's commands.
 *
 * Every change is made to the reconciled contents (`reconcileBookItems`) and stored whole
 * in the book, so the first change to a book never typeset fixes its order as it was
 * shown. Its legacy matter — text typed into the old Book tab — becomes real documents
 * then too (`materializeMatter`), so nothing it had is lost and from then on every page
 * of front and back matter is a page like any other.
 */
import { loadDocument, saveDocument, deleteEntry } from '../lib/FileSystem'
import { legacyMatterContent } from './bookMatter'
import {
  insertMatterItem,
  isLegacyMatter,
  matterPathFor,
  matterTemplate,
  moveItems,
  newItemId,
  newMatterItem,
  reconcileBookItems,
} from './bookItems'
import { listBookChapters } from './compile'
import { bookAuthor, getBookSettings, setBookSettings } from './printLayoutStore'

/** A book's contents now: stored, or as a book never typeset reads. */
export const currentBookItems = async (projectName, folder) => {
  const book = getBookSettings(projectName, folder)
  return reconcileBookItems(book, await listBookChapters(projectName, folder), folder)
}

/** Legacy matter written out as documents, each in place of its text. */
export const materializeMatter = async (projectName, folder, items) => {
  if (!items.some(isLegacyMatter)) return items
  const book = getBookSettings(projectName, folder)
  const author = bookAuthor(book)
  const out = []
  for (const item of items) {
    if (!isLegacyMatter(item)) {
      out.push(item)
      continue
    }
    // The same id, so what the navigator has selected stays selected.
    const path = matterPathFor(folder, item.matter, newItemId())
    await saveDocument(projectName, path, { content: legacyMatterContent(item.matter, book, author), notes: [] })
    out.push({ ...item, path })
  }
  return out
}

const store = (projectName, folder, items) => (
  setBookSettings(projectName, folder, { ...getBookSettings(projectName, folder), items })
)

const applyEdit = async (projectName, folder, change) => {
  const current = await currentBookItems(projectName, folder)
  const items = await materializeMatter(projectName, folder, current)
  const next = (await change(items)) || (items !== current ? items : null)
  if (!next) return items
  await store(projectName, folder, next)
  return next
}

let editing = Promise.resolve()

/**
 * Change a book's contents with `change`, from what it is now; stores and returns them.
 * One edit at a time: each reads the book across an await, so two at once would both
 * start from the same contents and the later write would undo the earlier (a selection
 * gathered and then given a part, say).
 */
export const editBookItems = (projectName, folder, change) => {
  const edit = editing.then(() => applyEdit(projectName, folder, change))
  editing = edit.catch(() => {})
  return edit
}

/** Move `ids` (or just `id`) together, in the book's order, to before `before`. */
export const moveBookItem = (projectName, folder, id, before, ids) => (
  editBookItems(projectName, folder, (items) => moveItems(items, ids?.length ? ids : [id], before || null))
)

export const setBookItemHidden = (projectName, folder, id, hidden, ids) => {
  const changing = new Set(ids?.length ? ids : [id])
  return editBookItems(projectName, folder, (items) => items.map((it) => (changing.has(it.id) ? { ...it, hidden: Boolean(hidden) } : it)))
}

/**
 * Add an entry: a matter page — its document made from its kind's template — a page
 * the book lays out, or a part. Resolves to the new item.
 */
export const addBookItem = async (projectName, folder, { matter, generated, part, before, title, back } = {}) => {
  let added = null
  await editBookItems(projectName, folder, async (items) => {
    if (part) {
      added = { id: `p:${newItemId()}`, kind: 'part', title: title || 'Part', hidden: false }
      const at = before ? items.findIndex((it) => it.id === before) : -1
      if (at >= 0) return [...items.slice(0, at), added, ...items.slice(at)]
      // With nowhere named, before the first chapter.
      const first = items.findIndex((it) => it.kind === 'chapter')
      return first < 0 ? [...items, added] : [...items.slice(0, first), added, ...items.slice(first)]
    }
    if (!matter && !generated) return null
    // A generated page is one of a kind: adding it again shows the one there is.
    if (generated) {
      const existing = items.find((it) => it.generated === generated)
      if (existing) {
        added = existing
        return existing.hidden ? items.map((it) => (it === existing ? { ...it, hidden: false } : it)) : null
      }
    }
    added = newMatterItem(folder, { matter, generated })
    if (title) added.title = title
    if (matter) {
      const book = getBookSettings(projectName, folder)
      await saveDocument(projectName, added.path, {
        content: matterTemplate(matter, { title: book.title, author: bookAuthor(book) }),
        notes: [],
      })
    }
    return insertMatterItem(items, added, back ? 'back' : undefined)
  })
  return added
}

/**
 * Take matter pages, generated pages or parts out (`ids`, or just `id`); a matter page's
 * document with it. Chapters are skipped: they are the manuscript's, only hidden.
 */
export const removeBookItem = (projectName, folder, id, ids) => {
  const removing = new Set(ids?.length ? ids : [id])
  return editBookItems(projectName, folder, async (items) => {
    const gone = items.filter((it) => removing.has(it.id) && it.kind !== 'chapter')
    if (!gone.length) return null
    for (const item of gone) {
      if (item.kind === 'matter' && item.path) await deleteEntry(projectName, item.path, 'file')
    }
    return items.filter((it) => !gone.includes(it))
  })
}

/** Set an entry's title, chapter type or page options: each one given. */
export const editBookItem = (projectName, folder, { id, title, chapterType, page }) => (
  editBookItems(projectName, folder, (items) => items.map((it) => {
    if (it.id !== id) return it
    const next = { ...it }
    if (title !== undefined && title !== null) {
      if (title.trim()) next.title = title.trim()
      else delete next.title
    }
    if (chapterType) next.chapterType = chapterType === 'chapter' ? undefined : chapterType
    if (!next.chapterType) delete next.chapterType
    if (page) next.page = page
    return next
  }))
)

/** The path a navigator entry opens, making a legacy page a document first. */
export const openablePath = async (projectName, folder, id) => {
  let items = await currentBookItems(projectName, folder)
  if (items.some((it) => it.id === id && isLegacyMatter(it))) items = await editBookItems(projectName, folder, () => null)
  const item = items.find((it) => it.id === id)
  if (!item?.path) return null
  // A matter document that is not there (deleted outside the app) is written again.
  if (item.kind === 'matter' && !(await loadDocument(projectName, item.path))) {
    await saveDocument(projectName, item.path, { content: matterTemplate(item.matter), notes: [] })
  }
  return item.path
}
