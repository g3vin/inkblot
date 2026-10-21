/**
 * typesetHistoryStore.js — every book's typeset history, kept in one file at the
 * project's root, beside its books (bookStore.js):
 *
 *   .inkblot-typeset-history.json   { version: 1, books: { [folder]: TypesetEntry[] } }
 *
 * The project's, so it travels with it — a typeset sent to the printer can be got back
 * wherever the project goes. Read once per project and held in memory; writes queue
 * behind the read, so a change made before it lands never writes the rest away.
 */
import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'

import { getProjectRoot, joinPath } from '../lib/projectPaths'
import { pushEntry } from './typesetHistory'

export const TYPESET_HISTORY_FILE = '.inkblot-typeset-history.json'

const projects = new Map()
const listeners = new Set()

/** Told when any book's history changes: `(projectName, folder)`. */
export const onTypesetHistoryChanged = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const changed = (projectName, folder) => {
  for (const listener of listeners) listener(projectName, folder)
}

const read = async (projectName) => {
  const path = joinPath(await getProjectRoot(projectName), TYPESET_HISTORY_FILE)
  if (!(await exists(path))) return {}
  const data = JSON.parse((await readTextFile(path)) || '{}')
  return data?.books && typeof data.books === 'object' ? data.books : {}
}

const entryFor = (projectName) => {
  let entry = projects.get(projectName)
  if (entry) return entry
  entry = { books: {}, loaded: null, writes: Promise.resolve() }
  projects.set(projectName, entry)
  entry.loaded = read(projectName)
    .then((books) => { entry.books = { ...books, ...entry.books } })
    .catch((error) => console.error('Reading the typeset history failed:', error))
  return entry
}

const write = (projectName, entry) => {
  entry.writes = entry.writes
    .then(() => entry.loaded)
    .then(async () => {
      const path = joinPath(await getProjectRoot(projectName), TYPESET_HISTORY_FILE)
      await writeTextFile(path, `${JSON.stringify({ version: 1, books: entry.books })}\n`)
    })
    .catch((error) => console.error('Saving the typeset history failed:', error))
  return entry.writes
}

/** A book's history, oldest first. */
export const typesetEntries = async (projectName, folder) => {
  const entry = entryFor(projectName)
  await entry.loaded
  return entry.books[folder || ''] || []
}

const edit = async (projectName, folder, change) => {
  const entry = entryFor(projectName)
  await entry.loaded
  const key = folder || ''
  entry.books = { ...entry.books, [key]: change(entry.books[key] || []) }
  changed(projectName, key)
  await write(projectName, entry)
}

export const addTypesetEntry = (projectName, folder, typesetEntry) => (
  edit(projectName, folder, (entries) => pushEntry(entries, typesetEntry))
)

export const renameTypesetEntry = (projectName, folder, id, name) => edit(projectName, folder, (entries) => entries.map((e) => (
  e.id === id ? { ...e, name: name?.trim() || undefined, kind: e.kind === 'auto' && name?.trim() ? 'named' : e.kind } : e
)))

export const deleteTypesetEntry = (projectName, folder, id) => (
  edit(projectName, folder, (entries) => entries.filter((e) => e.id !== id))
)

/** Follow a folder's rename or move, as its book does (bookStore.relocateBooks). */
export const relocateTypesetHistory = async (projectName, fromRel, toRel, { folder = false, copy = false } = {}) => {
  if (!projectName || !fromRel) return
  const entry = entryFor(projectName)
  await entry.loaded
  const moved = (path) => (folder ? path === fromRel || path.startsWith(`${fromRel}/`) : path === fromRel)
  const to = (path) => toRel + path.slice(fromRel.length)
  const remapChapters = (e) => ({
    ...e,
    snapshot: {
      ...e.snapshot,
      chapters: Object.fromEntries(Object.entries(e.snapshot?.chapters || {}).map(([p, c]) => [moved(p) && toRel ? to(p) : p, c])),
    },
  })
  let touched = false
  const books = {}
  for (const [key, entries] of Object.entries(entry.books)) {
    const remapped = copy || !toRel ? entries : entries.map(remapChapters)
    if (remapped !== entries) touched = true
    if (folder && moved(key)) {
      touched = true
      if (copy) books[key] = entries
      if (toRel) books[to(key)] = remapped
      continue
    }
    books[key] = remapped
  }
  if (!touched) return
  entry.books = books
  await write(projectName, entry)
}
