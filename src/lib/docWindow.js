/**
 * docWindow.js — "Open in New Window".
 *
 * A detached window is the same app, booted straight into one document: the URL
 * carries the project and the document, and Editor reads them on mount (see
 * readDetachedTarget). One window per document — asking twice focuses the window
 * that already exists rather than stacking duplicates.
 *
 * A detached window deliberately does NOT persist its session: two windows
 * writing the same localStorage key would each clobber the other's idea of what
 * is open. The main window stays the one that remembers.
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

export const isDetachedWindow = () => Boolean(readDetachedTarget())

export async function openDocumentWindow(projectName, docPath) {
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
  })

  detached.once('tauri://error', (error) => {
    console.warn('Failed to open document window:', error)
  })

  return detached
}
