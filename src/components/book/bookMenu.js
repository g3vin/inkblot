/**
 * The Book navigator's menus (BookNavigator.swift): the + menu's pages in the
 * standard order of each side, and a row's context menu. Everything is a command.
 */
import { shellBridge } from '../../bridge'

const send = (type, payload) => shellBridge.send(type, payload)

export const FRONT_MATTER = [
  { label: 'Half Title', generated: 'halfTitle' },
  { label: 'Also By', matter: 'alsoBy' },
  { label: 'Title Page', generated: 'titlePage' },
  { label: 'Copyright', matter: 'copyright' },
  { label: 'Dedication', matter: 'dedication' },
  { label: 'Epigraph', matter: 'epigraph' },
  { label: 'Contents', generated: 'contents' },
  { label: 'Foreword', matter: 'foreword' },
  { label: 'Preface', matter: 'preface' },
  { label: 'Introduction', matter: 'introduction' },
]

export const BACK_MATTER = [
  { label: 'Afterword', matter: 'afterword' },
  { label: 'Acknowledgements', matter: 'acknowledgements' },
  { label: 'About the Author', matter: 'aboutAuthor' },
  { label: 'Also By', matter: 'alsoBy', back: true },
  { label: 'Glossary', matter: 'glossary' },
  { label: 'Excerpt', matter: 'excerpt' },
  { label: 'Reading Group Guide', matter: 'readingGuide' },
  { label: 'Newsletter / Call to Action', matter: 'callToAction' },
]

export const SECTION_TITLES = { front: 'Front matter', body: 'Chapters', back: 'Back matter' }

export const CHAPTER_TYPES = [
  ['chapter', 'Chapter'], ['prologue', 'Prologue'], ['epilogue', 'Epilogue'], ['interlude', 'Interlude'], ['unnumbered', 'Unnumbered'],
]

const addEntry = (entry) => send('addBookItem', {
  ...(entry.matter ? { matter: entry.matter } : {}),
  ...(entry.generated ? { generated: entry.generated } : {}),
  part: false,
  back: Boolean(entry.back),
})

export function addMenu(rows) {
  const has = (entry) => entry.generated && rows.some((row) => row.generated === entry.generated)
  const item = (entry) => ({ text: entry.label, enabled: !has(entry), action: () => addEntry(entry) })
  return [
    { text: 'Front matter', items: FRONT_MATTER.map(item) },
    { text: 'Back matter', items: BACK_MATTER.map(item) },
    { separator: true },
    { text: 'Part divider', action: () => send('addBookItem', { part: true, title: 'Part', back: false }) },
    { text: 'Blank page of the book’s own', action: () => addEntry({ matter: 'custom' }) },
  ]
}

/**
 * @param {{ onRename: (row) => void, onRemove: (row) => void, onWrite: (row) => void, onReveal: (row) => void }} actions
 */
export function rowMenu(row, actions) {
  const items = [
    { text: row.hidden ? 'Show in the Book' : 'Hide from the Book', action: () => send('setBookItemHidden', { id: row.id, hidden: !row.hidden }) },
  ]
  if (row.kind === 'chapter') {
    items.push(
      { text: 'Chapter type', items: CHAPTER_TYPES.map(([type, label]) => ({
        text: label, checked: (row.chapterType ?? 'chapter') === type, action: () => send('editBookItem', { id: row.id, chapterType: type }),
      })) },
      { separator: true },
      { text: 'Open in Write mode', action: () => actions.onWrite(row) },
      { text: 'Reveal in file tree', action: () => actions.onReveal(row) },
    )
  } else {
    items.push(
      { text: 'Rename…', action: () => actions.onRename(row) },
      { text: 'Remove from the Book…', action: () => actions.onRemove(row) },
    )
  }
  items.push({ separator: true }, { text: 'Add a part before', action: () => send('addBookItem', { part: true, before: row.id, title: 'Part', back: false }) })
  return items
}

/**
 * The menu for several rows chosen together (BookNavigator's selection), in the book's
 * order: hide or show them, gather chapters under a new part, remove what can be.
 *
 * @param {object[]} rows
 * @param {{ onGroup: (rows) => void, onRemove: (rows) => void }} actions
 */
export function selectionMenu(rows, actions) {
  const ids = rows.map((row) => row.id)
  const allHidden = rows.every((row) => row.hidden)
  // Chapters are the manuscript's: they can be hidden, never removed.
  const removable = rows.filter((row) => row.kind !== 'chapter')
  const items = [
    {
      text: allHidden ? `Show ${rows.length} in the Book` : `Hide ${rows.length} from the Book`,
      action: () => send('setBookItemHidden', { id: ids[0], ids, hidden: !allHidden }),
    },
  ]
  if (rows.every((row) => row.kind === 'chapter')) items.push({ text: 'Group into a part', action: () => actions.onGroup(rows) })
  items.push(
    { separator: true },
    {
      text: removable.length ? `Remove ${removable.length} from the Book…` : 'Remove from the Book…',
      enabled: removable.length > 0,
      action: () => actions.onRemove(removable),
    },
  )
  return items
}

/**
 * A drop, as "before this entry": the first entry at or after where it landed that is
 * not being moved. `moving` is one id, or the ids of a selection carried together.
 */
export function moveTarget(orderedIds, moving, index) {
  const carried = new Set(Array.isArray(moving) ? moving : [moving])
  const rest = orderedIds.slice(index).filter((id) => !carried.has(id))
  return rest[0] ?? null
}

/** Where a block gathers to stay where its first entry is: before the next entry not in it. */
export function gatherTarget(orderedIds, block) {
  const carried = new Set(block)
  const first = orderedIds.findIndex((id) => carried.has(id))
  return first < 0 ? null : moveTarget(orderedIds, block, first)
}
