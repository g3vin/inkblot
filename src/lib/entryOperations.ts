/**
 * entryOperations.ts — renaming, moving, deleting and duplicating tree entries, safely.
 *
 * The disk half of each lives in FileSystem.js. What it cannot do is the other half:
 * the page may be *holding* the path it is about to change — the open document, the
 * split pane, a tab, notes and versions keyed by path — and when a pane lets go of a
 * document its autosave flushes to the path it had. Rename the file first and that
 * flush lands on the old name and quietly recreates it.
 *
 * `useEntryOperations` therefore closes whatever an entry touches (with `flushSync`,
 * so the flushes run now), waits for those writes on the document locks, performs the
 * disk operation, and reopens at the new paths with tabs, notes and versions carried
 * across. The `entries` suite covers renaming and deleting the open document.
 *
 * So there is one implementation that knows about the page's state
 * (`useEntryOperations`, registered by Editor.jsx), and every caller goes through the
 * functions exported here — the React tree, the context menus, the tab menu, a drag in
 * the tree, and the entry commands. Until something registers, they fall
 * through to FileSystem.js, which is what the harness and a page with no project want.
 *
 * `remapPath` is the pure part, and the part with the rules worth testing.
 */
import {
  deleteEntry as deleteOnDisk,
  duplicateEntry as duplicateOnDisk,
  moveEntry as moveOnDisk,
  renameEntry as renameOnDisk,
} from './FileSystem'

export type EntryType = 'file' | 'folder'

export interface EntryOperations {
  /** Resolves to the entry's new tree path, or null if nothing was renamed. */
  renameEntry(projectName: string, entryPath: string, newName: string, type?: EntryType): Promise<string | null | undefined>
  moveEntry(projectName: string, entryPath: string, targetFolder: string, type?: EntryType): Promise<string | null | undefined>
  deleteEntry(projectName: string, entryPath: string, type?: EntryType): Promise<void>
  /** Resolves to the copy's tree path. */
  duplicateEntry(projectName: string, entryPath: string): Promise<string | null | undefined>
}

const onDisk: EntryOperations = {
  renameEntry: (projectName, entryPath, newName, type = 'file') =>
    renameOnDisk(projectName, entryPath, newName, type),
  moveEntry: (projectName, entryPath, targetFolder, type = 'file') =>
    moveOnDisk(projectName, entryPath, targetFolder, type),
  deleteEntry: (projectName, entryPath, type = 'file') =>
    deleteOnDisk(projectName, entryPath, type),
  duplicateEntry: (projectName, entryPath) => duplicateOnDisk(projectName, entryPath),
}

let registered: EntryOperations | null = null

/** Install the state-aware implementation. Returns the uninstaller. */
export function setEntryOperations(operations: EntryOperations): () => void {
  registered = operations
  return () => {
    if (registered === operations) registered = null
  }
}

const current = (): EntryOperations => registered ?? onDisk

/**
 * Told around a rename or a move, for what keeps history by path outside the page's
 * state — the writing stats. `willChange` comes first, so a session about the old
 * path ends before the path goes.
 */
export interface EntryObserver {
  willChange(projectName: string): void
  renamed(projectName: string, entryPath: string, nextPath: string, type: EntryType): void
  moved(projectName: string, entryPath: string, targetFolder: string, type: EntryType): void
  /** After a delete: what remembers documents by path (the landing page's piles) forgets them. */
  deleted?(projectName: string, entryPath: string, type: EntryType): void
}

const observers = new Set<EntryObserver>()

export function observeEntries(observer: EntryObserver): () => void {
  observers.add(observer)
  return () => { observers.delete(observer) }
}

export const renameEntry: EntryOperations['renameEntry'] = async (projectName, entryPath, newName, type = 'file') => {
  for (const observer of observers) observer.willChange(projectName)
  const nextPath = await current().renameEntry(projectName, entryPath, newName, type)
  if (nextPath && nextPath !== entryPath) {
    for (const observer of observers) observer.renamed(projectName, entryPath, nextPath, type)
  }
  return nextPath
}
export const moveEntry: EntryOperations['moveEntry'] = async (projectName, entryPath, targetFolder, type = 'file') => {
  for (const observer of observers) observer.willChange(projectName)
  const nextPath = await current().moveEntry(projectName, entryPath, targetFolder, type)
  if (nextPath && nextPath !== entryPath) {
    for (const observer of observers) observer.moved(projectName, entryPath, targetFolder, type)
  }
  return nextPath
}
export const deleteEntry: EntryOperations['deleteEntry'] = async (projectName, entryPath, type = 'file') => {
  await current().deleteEntry(projectName, entryPath, type)
  for (const observer of observers) observer.deleted?.(projectName, entryPath, type)
}
export const duplicateEntry: EntryOperations['duplicateEntry'] = (...args) => current().duplicateEntry(...args)

export interface EntryRef { path: string; type: EntryType }

/** The entries without any that a folder also in the list already carries. */
export function topmostEntries<T extends EntryRef>(entries: T[]): T[] {
  const folders = entries.filter((entry) => entry.type === 'folder').map((entry) => entry.path)
  const seen = new Set<string>()
  return entries.filter((entry) => {
    const key = `${entry.type}:${entry.path}`
    if (seen.has(key)) return false
    seen.add(key)
    return !folders.some((folder) => folder !== entry.path && entry.path.startsWith(`${folder}/`))
  })
}

/** Can `entry` go into `targetFolder`? Not where it is already, nor a folder into itself. */
export function canMoveInto(entry: EntryRef, targetFolder: string): boolean {
  const parent = entry.path.split('/').slice(0, -1).join('/')
  if (parent === targetFolder) return false
  return !(entry.type === 'folder' && (targetFolder === entry.path || targetFolder.startsWith(`${entry.path}/`)))
}

/**
 * Delete several entries, one after another: each goes through the page's own delete
 * (which lets go of an open document first), and they must not race for its panes.
 */
export async function deleteEntries(projectName: string, entries: EntryRef[]): Promise<void> {
  for (const entry of topmostEntries(entries)) await deleteEntry(projectName, entry.path, entry.type)
}

/**
 * Move several entries into `targetFolder`, one after another, leaving out any already
 * there or that would go into itself. Resolves to each moved entry's new path.
 */
export async function moveEntries(projectName: string, entries: EntryRef[], targetFolder: string): Promise<Array<EntryRef & { nextPath: string }>> {
  const moved: Array<EntryRef & { nextPath: string }> = []
  for (const entry of topmostEntries(entries)) {
    if (!canMoveInto(entry, targetFolder)) continue
    const nextPath = await moveEntry(projectName, entry.path, targetFolder, entry.type)
    if (nextPath) moved.push({ ...entry, nextPath })
  }
  return moved
}

/** The disk operations alone, for the implementation that wraps them. */
export const entryOperationsOnDisk = onDisk

/** Does changing `entryPath` touch the document at `docPath`? */
export function touches(docPath: string | null | undefined, entryPath: string, type: EntryType): boolean {
  if (!docPath || !entryPath) return false
  return type === 'folder' ? docPath.startsWith(`${entryPath}/`) : docPath === entryPath
}

/**
 * Where `docPath` is after `entryPath` became `nextPath`.
 *
 *  - `undefined`: the operation did not touch it.
 *  - `null`: it is gone (the entry was deleted, or the operation failed after the
 *    document was let go of — the caller decides whether that means reopen as-is).
 *  - a string: its new path. A folder carries everything under it, so
 *    `Part One/Chapter 1` under a renamed `Part One` becomes `Act I/Chapter 1`.
 */
export function remapPath(
  docPath: string | null | undefined,
  entryPath: string,
  nextPath: string | null,
  type: EntryType,
): string | null | undefined {
  if (!touches(docPath, entryPath, type)) return undefined
  if (nextPath == null) return null
  return type === 'folder' ? `${nextPath}${(docPath as string).slice(entryPath.length)}` : nextPath
}

/** A map keyed by document path, with the touched keys moved (or dropped). */
export function remapKeys<T>(
  byPath: Record<string, T>,
  entryPath: string,
  nextPath: string | null,
  type: EntryType,
): Record<string, T> {
  let changed = false
  const next: Record<string, T> = {}
  for (const [key, value] of Object.entries(byPath)) {
    const mapped = remapPath(key, entryPath, nextPath, type)
    if (mapped === undefined) {
      next[key] = value
      continue
    }
    changed = true
    if (mapped !== null) next[mapped] = value
  }
  return changed ? next : byPath
}
