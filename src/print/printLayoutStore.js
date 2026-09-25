/**
 * printLayoutStore.js — Print Layout's view state, outside any one component.
 *
 * What a *view* of a document is, as opposed to what the document is: whether a
 * document is shown as pages, the zoom, the display's density for "Actual size",
 * and each book's settings. The page setup is none of these — it belongs to the
 * document and lives on its doc node (DocPageSetup.js).
 *
 * A store rather than React state because it is read and written from places that
 * do not share a parent: the panes, the View menu in App.jsx, and bridge commands
 * from the native inspector. Persisted through preferences, so a document reopens
 * the way it was left.
 */
import { useSyncExternalStore } from 'react'

import { getPreference, setPreference } from '../lib/preferences'
import { bookFolderFor } from './compile'
import { clampZoom } from './zoom'
import { DEFAULT_SHEETS_PER_SIGNATURE } from './imposition'

const ENABLED_PREFIX = 'inkblot-print-layout:'
const ZOOM_KEY = 'inkblot-print-zoom'
const BOOK_PREFIX = 'inkblot-book:'
const SCOPE_PREFIX = 'inkblot-print-scope:'

const listeners = new Set()
let version = 0
let displayPointsPerInch = null

const emit = () => {
  version += 1
  for (const listener of listeners) listener()
}

const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const docKey = (projectName, docPath) => `${ENABLED_PREFIX}${projectName || ''}/${docPath || ''}`

export const isPrintLayoutEnabled = (projectName, docPath) => (
  Boolean(projectName && docPath) && getPreference(docKey(projectName, docPath)) === 'true'
)

export const setPrintLayoutEnabled = (projectName, docPath, enabled) => {
  if (!projectName || !docPath) return
  setPreference(docKey(projectName, docPath), enabled ? 'true' : 'false')
  emit()
}

export const getPrintZoom = () => {
  const stored = Number.parseFloat(getPreference(ZOOM_KEY) || '')
  return Number.isFinite(stored) ? clampZoom(stored) : 1
}

export const setPrintZoom = (zoom) => {
  setPreference(ZOOM_KEY, String(clampZoom(zoom)))
  emit()
}

export const getDisplayPointsPerInch = () => displayPointsPerInch

export const setDisplayPointsPerInch = (ppi) => {
  displayPointsPerInch = Number.isFinite(ppi) && ppi > 0 ? ppi : null
  emit()
}

/**
 * No binding unless the author asks for it: most writers print pages to read, not
 * sheets to fold, and hand-binding's settings are noise until then. A book that was
 * set to bind keeps its stored setting.
 */
export const DEFAULT_BINDING = {
  binding: 'none',
  sheetsPerSignature: DEFAULT_SHEETS_PER_SIGNATURE,
  sheetPresetId: 'letter',
  sheetFit: 'actualSize',
  duplex: 'automatic',
  paperThicknessMm: 0.1,
  cropMarks: true,
  includeGuide: true,
}

const bookKey = (projectName, folder) => `${BOOK_PREFIX}${projectName || ''}:${folder || ''}`

/** A folder's book settings, with defaults filled in: the folder's name as the title. */
export const getBookSettings = (projectName, folder) => {
  let stored = null
  try {
    stored = JSON.parse(getPreference(bookKey(projectName, folder)) || 'null')
  } catch {
    stored = null
  }
  const name = (folder || projectName || 'Untitled').split('/').filter(Boolean).pop() || 'Untitled'
  return {
    folder: folder || '',
    title: name,
    author: '',
    language: (typeof navigator !== 'undefined' && navigator.language) || 'en-US',
    ...(stored && typeof stored === 'object' ? stored : {}),
    binding: { ...DEFAULT_BINDING, ...(stored?.binding || {}) },
  }
}

export const setBookSettings = (projectName, folder, settings) => {
  setPreference(bookKey(projectName, folder), JSON.stringify({ ...settings, folder: folder || '' }))
  emit()
}

/* ---------------- scope ---------------- */

const SCOPES = ['document', 'folder', 'project']

/**
 * What Print and Export cover, per project: the active document, its folder as a book,
 * or the whole project as one. Also which book the Finishing tabs show — the folder's
 * for `document` and `folder`, the project's for `project`.
 */
export const getPrintScope = (projectName) => {
  const stored = projectName ? getPreference(`${SCOPE_PREFIX}${projectName}`) : null
  return SCOPES.includes(stored) ? stored : 'document'
}

export const setPrintScope = (projectName, scope) => {
  if (!projectName || !SCOPES.includes(scope)) return
  setPreference(`${SCOPE_PREFIX}${projectName}`, scope)
  emit()
}

/** The folder of the book a document belongs to under the project's scope. */
export const bookFolderForScope = (projectName, docPath) => (
  bookFolderFor(docPath, getPrintScope(projectName) === 'project' ? 'project' : 'folder')
)

/** The book a document belongs to under the project's scope. */
export const getBookForDoc = (projectName, docPath) => (
  getBookSettings(projectName, bookFolderForScope(projectName, docPath))
)

/* ---------------- the page in view ---------------- */

// Not persisted, and apart from the store's own listeners: it changes as the author
// scrolls, and only the inspector's "Page 3 of 212" cares.
const currentPages = new Map()
const pageListeners = new Set()

export const getCurrentPrintPage = (docPath) => currentPages.get(docPath || '') || 1

export const setCurrentPrintPage = (docPath, page) => {
  const key = docPath || ''
  if (currentPages.get(key) === page) return
  currentPages.set(key, page)
  for (const listener of pageListeners) listener()
}

export const subscribeCurrentPrintPage = (listener) => {
  pageListeners.add(listener)
  return () => pageListeners.delete(listener)
}

/** Re-render on any change to the store. Returns a version number to read through. */
export const usePrintLayoutStore = () => useSyncExternalStore(subscribe, () => version, () => version)

export const subscribePrintLayoutStore = subscribe
