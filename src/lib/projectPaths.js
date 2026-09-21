/**
 * projectPaths.js — resolving a project name to an absolute directory.
 *
 * Split out of FileSystem.js so versionStore.js can resolve paths without
 * importing the document layer, which imports versionStore in turn. Everything
 * here is path arithmetic plus the one lookup in projectLocations.
 */
import { appDataDir } from '@tauri-apps/api/path'
import { CANVAS_SUFFIX } from './docKind'
import { getProjectLocation } from './projectLocations'

export const ORDER_FILE = '.inkblot-order.json'
export const CANVAS_SUFFIX_LENGTH = CANVAS_SUFFIX.length

/* ---------- path helpers (all filesystem access uses absolute paths) ---------- */

export const stripTrailingSlash = (p) => String(p || '').replace(/[\\/]+$/, '')
export const stripLeadingSlash = (p) => String(p || '').replace(/^[/\\]+/, '')

/** Join absolute/relative parts with exactly one separator between them. */
export const joinPath = (...parts) =>
  parts
    .filter((p) => p != null && p !== '')
    .map((p, i) => (i === 0 ? stripTrailingSlash(p) : stripLeadingSlash(stripTrailingSlash(p))))
    .join('/')

export const parentOf = (absPath) => stripTrailingSlash(absPath).split('/').slice(0, -1).join('/')

let appDataRootCache = null
export async function appDataRoot() {
  if (!appDataRootCache) appDataRootCache = stripTrailingSlash(await appDataDir())
  return appDataRootCache
}

/** Absolute directory path for a project (custom location or AppData default). */
export async function getProjectRoot(projectName) {
  const custom = await getProjectLocation(projectName)
  if (custom) return stripTrailingSlash(custom)
  return joinPath(await appDataRoot(), projectName)
}

/** Tree paths are relative and forward-slashed; callers pass them loosely. */
export const normalizePath = (path) => path?.replace(/\/+/, '/').replace(/^\//, '') || ''
