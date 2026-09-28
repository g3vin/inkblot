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

export const SECTION_TITLES = { front: 'Front Matter', body: 'Chapters', back: 'Back Matter' }

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
    { text: 'Front Matter', items: FRONT_MATTER.map(item) },
    { text: 'Back Matter', items: BACK_MATTER.map(item) },
    { separator: true },
    { text: 'Part Divider', action: () => send('addBookItem', { part: true, title: 'Part', back: false }) },
    { text: 'Blank Page of the Book’s Own', action: () => addEntry({ matter: 'custom' }) },
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
      { text: 'Chapter Type', items: CHAPTER_TYPES.map(([type, label]) => ({
        text: label, checked: (row.chapterType ?? 'chapter') === type, action: () => send('editBookItem', { id: row.id, chapterType: type }),
      })) },
      { separator: true },
      { text: 'Open in Write Mode', action: () => actions.onWrite(row) },
      { text: 'Reveal in File Tree', action: () => actions.onReveal(row) },
    )
  } else {
    items.push(
      { text: 'Rename…', action: () => actions.onRename(row) },
      { text: 'Remove from the Book…', action: () => actions.onRemove(row) },
    )
  }
  items.push({ separator: true }, { text: 'Add a Part Before', action: () => send('addBookItem', { part: true, before: row.id, title: 'Part', back: false }) })
  return items
}

/** A drop, as "before this entry": the first entry at or after where it landed, not itself. */
export function moveTarget(orderedIds, movingId, index) {
  const rest = orderedIds.slice(index).filter((id) => id !== movingId)
  return rest[0] ?? null
}
