/**
 * projectPaths.ts — resolving a project name to an absolute directory.
 *
 * Split out of FileSystem.js so versionStore.js can resolve paths without
 * importing the document layer, which imports versionStore in turn. Everything
 * here is path arithmetic plus the one lookup in projectLocations.
 *
 * Mirrors: `src-tauri/crates/inkblot-core/src/store/paths.rs`; `npm run parity` asserts they agree.
 */
import { appDataDir } from '@tauri-apps/api/path'
import { getProjectLocation } from './projectLocations'

export const ORDER_FILE = '.inkblot-order.json'
/** Inside a folder: `{ "locked": true }` when the writer has locked it (docLocks.ts). */
export const FOLDER_FILE = '.inkblot-folder.json'

/**
 * A path as a caller hands it over. Absent and empty are both ordinary here —
 * `parentOf` of a root, a document at the top of a project — and every function
 * below coerces rather than throwing, which is what lets call sites stay loose.
 */
export type PathInput = string | null | undefined

/* ---------- path helpers (all filesystem access uses absolute paths) ---------- */

export const stripTrailingSlash = (p: PathInput): string => String(p || '').replace(/[\\/]+$/, '')
export const stripLeadingSlash = (p: PathInput): string => String(p || '').replace(/^[/\\]+/, '')

/** Join absolute/relative parts with exactly one separator between them. */
export const joinPath = (...parts: PathInput[]): string =>
  parts
    .filter((p) => p != null && p !== '')
    .map((p, i) => (i === 0 ? stripTrailingSlash(p) : stripLeadingSlash(stripTrailingSlash(p))))
    .join('/')

export const parentOf = (absPath: PathInput): string =>
  stripTrailingSlash(absPath).split('/').slice(0, -1).join('/')

let appDataRootCache: string | null = null
export async function appDataRoot(): Promise<string> {
  if (!appDataRootCache) appDataRootCache = stripTrailingSlash(await appDataDir())
  return appDataRootCache
}

/** Absolute directory path for a project (custom location or AppData default). */
export async function getProjectRoot(projectName: string): Promise<string> {
  const custom = await getProjectLocation(projectName)
  if (custom) return stripTrailingSlash(custom)
  return joinPath(await appDataRoot(), projectName)
}

/** Tree paths are relative and forward-slashed; callers pass them loosely. */
export const normalizePath = (path: PathInput): string =>
  path?.replace(/\/+/, '/').replace(/^\//, '') || ''
