/**
 * docWindow.js — "Open in New Window".
 *
 * A detached window is the same app, booted straight into one document: the URL
 * carries the project and the document, and Editor reads them on mount (see
 * readDetachedTarget). One window per document — asking twice focuses the window
 * that already exists rather than stacking duplicates.
 *
 * A detached window deliberately does NOT persist its session: two windows
 * writing the same session key would each clobber the other's idea of what
 * is open. The main window stays the one that remembers.
 *
 * A tab dragged out of the main window opens its document in one of these where it
 * was let go (`at`). A detached window can be kept on top of the others, and can put
 * its document back: it tells the main window (`DOCK_EVENT`), which opens it in a
 * tab, and closes.
 */
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { getDocDisplayName } from './docKind'

const DETACHED_LABEL_PREFIX = 'doc-'

/** Window labels are restricted to [a-zA-Z0-9-_/:.], so anything else is encoded away. */
const toWindowLabel = (projectName, docPath) => {
  const slug = `${projectName}::${docPath}`.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 60)
  return `${DETACHED_LABEL_PREFIX}${slug}`
}

/** The document a detached window was opened for, or null in the main window. */
export function readDetachedTarget() {
  try {
    const params = new URLSearchParams(window.location.search)
    const projectName = params.get('project') || ''
    const docPath = params.get('doc') || ''
    if (!projectName || !docPath) return null
    return { projectName, docPath }
  } catch {
    return null
  }
}

const MAIN_WINDOW = 'main'

/** Sent to the main window with `{ projectName, docPath }`: open this in a tab again. */
export const DOCK_EVENT = 'inkblot:dock-document'

/** Open a document in a window of its own; `at` puts its corner at that screen point. */
export async function openDocumentWindow(projectName, docPath, { at = null } = {}) {
  if (!projectName || !docPath) return null

  const label = toWindowLabel(projectName, docPath)

  try {
    const existing = await WebviewWindow.getByLabel(label)
    if (existing) {
      await existing.show()
      await existing.setFocus()
      return existing
    }
  } catch {
    // No window by that label — fall through and create one.
  }

  const query = `?project=${encodeURIComponent(projectName)}&doc=${encodeURIComponent(docPath)}`

  const detached = new WebviewWindow(label, {
    url: `index.html${query}`,
    title: getDocDisplayName(docPath) || 'Inkblot',
    width: Math.round((window?.innerWidth ?? 1200) * 0.7),
    height: Math.round((window?.innerHeight ?? 800) * 0.9),
    resizable: true,
    focus: true,
    ...(at && Number.isFinite(at.x) && Number.isFinite(at.y) ? { x: Math.round(at.x), y: Math.round(at.y) } : {}),
  })

  detached.once('tauri://error', (error) => {
    console.warn('Failed to open document window:', error)
  })

  return detached
}

/** From a detached window: give its document back to the main window, and close. */
export async function dockToMainWindow(projectName, docPath) {
  const { emitTo } = await import('@tauri-apps/api/event')
  await emitTo(MAIN_WINDOW, DOCK_EVENT, { projectName, docPath })
  try {
    await (await WebviewWindow.getByLabel(MAIN_WINDOW))?.setFocus()
  } catch {
    // The main window comes forward when it can; the document is in its tabs anyway.
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().close()
}

/** In the main window: call `handler({ projectName, docPath })` for each document given back. */
export async function listenForDocking(handler) {
  const { listen } = await import('@tauri-apps/api/event')
  return listen(DOCK_EVENT, (event) => handler(event.payload || {}))
}

/** Keep this window above the others, or not. */
export async function setKeepOnTop(on) {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().setAlwaysOnTop(Boolean(on))
}
