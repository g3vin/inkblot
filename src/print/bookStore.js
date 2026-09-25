/**
 * bookStore.js — every book in a project, kept in one file at the project's root:
 *
 *   .inkblot-books.json   { version: 1, books: { [folder]: BookSettings } }
 *
 * A book's settings — its title, cover, chapters left out, front and back matter —
 * are the project's, so they travel with it: copied to another Mac, synced, or put
 * under version control, the book compiles the same. (Older builds kept them in the
 * app's preferences; a book not in the file yet is read from there, and written to the
 * file the next time it changes.)
 *
 * Read once per project and held in memory, so `getBookSettings` stays synchronous for
 * the components and the bridge that call it on every render. Writes wait for that
 * read, so a change made before it lands never writes the other books away.
 */
import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'

import { getProjectRoot, joinPath } from '../lib/projectPaths'
import { getPreference } from '../lib/preferences'

export const BOOKS_FILE = '.inkblot-books.json'
const LEGACY_PREFIX = 'inkblot-book:'

/** projectName → { books, loaded: Promise, writes: Promise } */
const projects = new Map()
let changed = () => {}

/** Called once a project's file has been read, or a relocation changed it. */
export const onBooksChanged = (listener) => {
  changed = listener
}

const readBooks = async (projectName) => {
  const path = joinPath(await getProjectRoot(projectName), BOOKS_FILE)
  if (!(await exists(path))) return {}
  const data = JSON.parse((await readTextFile(path)) || '{}')
  return data?.books && typeof data.books === 'object' ? data.books : {}
}

const entryFor = (projectName) => {
  let entry = projects.get(projectName)
  if (entry) return entry
  entry = { books: {}, loaded: null, writes: Promise.resolve() }
  projects.set(projectName, entry)
  entry.loaded = (projectName ? readBooks(projectName) : Promise.resolve({}))
    .then((books) => {
      // Anything stored while the file was being read is newer than the file.
      entry.books = { ...books, ...entry.books }
      changed()
    })
    .catch((error) => console.error('Reading the project’s books failed:', error))
  return entry
}

const legacyBook = (projectName, folder) => {
  try {
    return JSON.parse(getPreference(`${LEGACY_PREFIX}${projectName || ''}:${folder || ''}`) || 'null')
  } catch {
    return null
  }
}

/** A folder's stored settings, as saved — or null for a book never set up. */
export const storedBook = (projectName, folder) => {
  const entry = entryFor(projectName)
  return entry.books[folder || ''] || legacyBook(projectName, folder)
}

const writeBooks = async (projectName, entry) => {
  const path = joinPath(await getProjectRoot(projectName), BOOKS_FILE)
  await writeTextFile(path, `${JSON.stringify({ version: 1, books: entry.books }, null, 2)}\n`)
}

const queueWrite = (projectName, entry) => {
  entry.writes = entry.writes
    .then(() => entry.loaded)
    .then(() => writeBooks(projectName, entry))
    .catch((error) => console.error('Saving the project’s books failed:', error))
  return entry.writes
}

/** Store a folder's settings. Resolves when they are on disk. */
export const storeBook = (projectName, folder, settings) => {
  if (!projectName) return Promise.resolve()
  const entry = entryFor(projectName)
  entry.books = { ...entry.books, [folder || '']: settings }
  return queueWrite(projectName, entry)
}

/** Resolves once a project's books have been read (and any writes so far are done). */
export const booksSettled = async (projectName) => {
  const entry = entryFor(projectName)
  await entry.loaded
  await entry.writes
}

/**
 * Follow a rename, move, copy or delete in the tree: a folder's book moves with it,
 * and a chapter left out stays left out under its new path.
 */
export const relocateBooks = async (projectName, fromRel, toRel, { folder = false, copy = false } = {}) => {
  if (!projectName || !fromRel) return
  const entry = entryFor(projectName)
  await entry.loaded
  const moved = (path) => (folder ? path === fromRel || path.startsWith(`${fromRel}/`) : path === fromRel)
  const to = (path) => toRel + path.slice(fromRel.length)
  let touched = false
  const books = {}
  for (const [key, book] of Object.entries(entry.books)) {
    let next = book
    const excluded = Array.isArray(book?.excluded) ? book.excluded : []
    if (excluded.some(moved)) {
      touched = true
      const kept = copy ? excluded : excluded.filter((p) => !moved(p))
      next = { ...book, excluded: toRel ? [...kept, ...excluded.filter(moved).map(to)] : kept }
    }
    if (folder && moved(key)) {
      touched = true
      if (copy) books[key] = next
      if (toRel) books[to(key)] = { ...next, folder: to(key) }
      continue
    }
    books[key] = next
  }
  if (!touched) return
  entry.books = books
  changed()
  await queueWrite(projectName, entry)
}

/** For tests: forget every project read so far. */
export const resetBookStore = () => {
  projects.clear()
}
