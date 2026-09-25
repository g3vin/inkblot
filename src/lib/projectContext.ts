/**
 * projectContext.ts — which project is open, for the code that has no way to be told.
 *
 * Pinterest board caching keys its entries by a per-open id, so that reopening a
 * project re-fetches rather than showing what was on the board last time. The code that
 * needs the id is a TipTap node view — no React above it, no props reaching it — so it
 * is ambient: a module-level value with one setter (`Editor.jsx`, when a project opens
 * or closes), backed by the session store (`inkblot:project-open-id`) that readers
 * fall back to.
 */
import { getSessionValue } from './preferences'

const PROJECT_OPEN_ID_KEY = 'inkblot:project-open-id'

let projectOpenId: string | null = null

/** Called when a project is opened, beside the session-store write. */
export function setOpenProject(nextProjectOpenId: string): void {
  projectOpenId = nextProjectOpenId
}

/** Called when the last project is closed. */
export function clearOpenProject(): void {
  projectOpenId = null
}

/**
 * The current open id, falling back to the session store.
 *
 * The fallback is not defensive padding: the store is what survives a reload, and a
 * node view can mount from restored content before anything has called `setOpenProject`
 * in this process.
 */
export function getProjectOpenId(): string {
  return String(projectOpenId || getSessionValue(PROJECT_OPEN_ID_KEY) || 'default')
}
