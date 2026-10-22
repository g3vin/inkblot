/**
 * docLocks.ts — documents and folders the writer has locked.
 *
 * A locked document is read-only: its text (or its cards, its map, its timeline view)
 * cannot change, while notes, comments and timeline passages still can, because they
 * are about the text rather than part of it. Every kind of document can be locked.
 *
 * The lock is saved where it travels with the project:
 *   - a document's own file holds `locked: true` (FileSystem.setDocumentLockFlag),
 *     and every save keeps it there;
 *   - a locked folder holds a marker file (`.inkblot-folder.json`), so everything
 *     inside it is locked too, wherever the folder is moved.
 *
 * The page keeps one picture of a project's locks in memory, read from disk when the
 * project opens and whenever the file tree is re-read (`refreshLocks`). It comes from
 * the `project_locks` command, a Rust scan that reads only the flag out of each file;
 * without the app (a browser, the test harness) the same scan runs here.
 *
 * Panes freeze their own content: the text editor through the DocumentLock extension,
 * canvases and maps by dropping edits at their reducer, timelines at their commit. An
 * edit refused that way calls `noteLockedEdit`, which the pane's lock badge shows.
 */
import { useSyncExternalStore } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  listProjectTree,
  loadDocument,
  readFolderLockFlag,
  setDocumentLockFlag,
  setFolderLockFlag,
} from './FileSystem'

export interface LockedEntries {
  documents: string[]
  folders: string[]
}

/** Why a path is locked: its own lock, or the folder it sits in. */
export type LockReason = { by: 'document' } | { by: 'folder'; folder: string }

interface LockState {
  project: string | null
  documents: ReadonlySet<string>
  folders: ReadonlySet<string>
}

/** Fired with `detail: { docPath }` when an edit to a locked document was refused. */
export const LOCKED_EDIT_EVENT = 'inkblot:locked-edit'

let state: LockState = { project: null, documents: new Set(), folders: new Set() }
const listeners = new Set<() => void>()

const publish = (next: LockState) => {
  state = next
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const getState = () => state

/** Why `path` is locked in the project the store holds, or null when it is not. */
export function lockReason(path: string | null | undefined, from: LockState = state): LockReason | null {
  if (!path) return null
  if (from.documents.has(path)) return { by: 'document' }
  const segments = path.split('/')
  // The path itself when it is a folder, then each folder above it, nearest first.
  for (let end = segments.length; end > 0; end -= 1) {
    const folder = segments.slice(0, end).join('/')
    if (from.folders.has(folder)) return { by: 'folder', folder }
  }
  return null
}

export const isLocked = (path: string | null | undefined) => lockReason(path) !== null

/** The project's locks, re-rendering when they change. */
export function useLocks(): LockState {
  return useSyncExternalStore(subscribe, getState, getState)
}

/** Why `path` is locked, re-rendering when that changes. */
export function useLockReason(path: string | null | undefined): LockReason | null {
  return lockReason(path, useLocks())
}

/* ---------------- reading ---------------- */

type TreeNode = { type: string; path: string; children?: TreeNode[] }

/** The same scan as `project_locks`, for when there is no app to ask. */
async function scanLocks(projectName: string): Promise<LockedEntries> {
  const found: LockedEntries = { documents: [], folders: [] }
  const visit = async (node: TreeNode) => {
    if (node.type === 'folder') {
      if (node.path && await readFolderLockFlag(projectName, node.path)) found.folders.push(node.path)
      for (const child of node.children ?? []) await visit(child)
    } else if ((await loadDocument(projectName, node.path))?.locked === true) {
      found.documents.push(node.path)
    }
  }
  await visit(await listProjectTree(projectName))
  return found
}

async function readLocks(projectName: string): Promise<LockedEntries> {
  try {
    const found = await invoke<LockedEntries>('project_locks', { projectName })
    if (Array.isArray(found?.documents) && Array.isArray(found?.folders)) return found
  } catch {
    // No app to ask.
  }
  return scanLocks(projectName)
}

let latestRead = 0

/** Re-read a project's locks from disk. */
export async function refreshLocks(projectName: string | null | undefined): Promise<void> {
  const read = ++latestRead
  if (!projectName) {
    publish({ project: null, documents: new Set(), folders: new Set() })
    return
  }
  const found = await readLocks(projectName)
  // A slower read for a project left behind must not land over a newer one.
  if (read !== latestRead) return
  publish({ project: projectName, documents: new Set(found.documents), folders: new Set(found.folders) })
}

/* ---------------- changing ---------------- */

const withEntry = (set: ReadonlySet<string>, path: string, on: boolean) => {
  const next = new Set(set)
  if (on) next.add(path)
  else next.delete(path)
  return next
}

/** Lock or unlock one document. Resolves to whether it changed. */
export async function setDocumentLocked(projectName: string, docPath: string, locked: boolean): Promise<boolean> {
  const changed = await setDocumentLockFlag(projectName, docPath, locked)
  if (changed && state.project === projectName) {
    publish({ ...state, documents: withEntry(state.documents, docPath, locked) })
  }
  return Boolean(changed)
}

/** Lock or unlock a folder and everything in it. Resolves to whether it changed. */
export async function setFolderLocked(projectName: string, folderPath: string, locked: boolean): Promise<boolean> {
  const changed = await setFolderLockFlag(projectName, folderPath, locked)
  if (changed && state.project === projectName) {
    publish({ ...state, folders: withEntry(state.folders, folderPath, locked) })
  }
  return Boolean(changed)
}

/** Lock `docPath` if it is not, unlock it if it is, in the project the store holds. */
export async function toggleDocumentLock(docPath: string | null | undefined): Promise<boolean> {
  if (!state.project || !docPath) return false
  return setDocumentLocked(state.project, docPath, !state.documents.has(docPath))
}

/** Say that an edit to `docPath` was refused because it is locked. */
export function noteLockedEdit(docPath: string | null | undefined) {
  if (!docPath || typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(LOCKED_EDIT_EVENT, { detail: { docPath } }))
}

/** What the lock badge and the menus call the lock on `path`. */
export function describeLock(reason: LockReason | null): string {
  if (!reason) return ''
  if (reason.by === 'document') return 'Locked'
  return `Locked with “${reason.folder.split('/').pop()}”`
}
