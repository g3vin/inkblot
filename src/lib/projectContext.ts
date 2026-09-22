/**
 * projectContext.ts — which project is open, for the code that has no way to be told.
 *
 * Pinterest board caching keys its entries by a per-open id, so that reopening a
 * project re-fetches rather than showing what was on the board last time. The code that
 * needs the id is a TipTap node view — no React above it, no props reaching it — so the
 * id was written to `window.__inkblotProjectOpenId` and read back from there.
 *
 * That cannot survive a process boundary, and it did not need a global in the first
 * place: the same two values are already written to the session store on disk
 * (`inkblot:project-open-id`), which is what every reader here already falls back to.
 * This module is the in-memory half of that pair — a module-level value with one
 * setter, rather than a property anything at all can assign.
 */
import { getSessionValue } from './preferences'

const PROJECT_OPEN_ID_KEY = 'inkblot:project-open-id'
const PROJECT_NAME_KEY = 'inkblot:project-name'

let projectOpenId: string | null = null
let projectName: string | null = null

/** Called when a project is opened, beside the session-store write. */
export function setOpenProject(next: { projectName: string; projectOpenId: string }): void {
  projectName = next.projectName
  projectOpenId = next.projectOpenId
}

/** Called when the last project is closed. */
export function clearOpenProject(): void {
  projectName = null
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

export function getProjectName(): string | null {
  const name = projectName || getSessionValue(PROJECT_NAME_KEY)
  return name ? String(name) : null
}
