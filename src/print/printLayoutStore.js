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
import { clampZoom } from './zoom'
import { DEFAULT_SHEETS_PER_SIGNATURE } from './imposition'

const ENABLED_PREFIX = 'inkblot-print-layout:'
const ZOOM_KEY = 'inkblot-print-zoom'
const BOOK_PREFIX = 'inkblot-book:'

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

export const DEFAULT_BINDING = {
  binding: 'signatures',
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

/** Re-render on any change to the store. Returns a version number to read through. */
export const usePrintLayoutStore = () => useSyncExternalStore(subscribe, () => version, () => version)

export const subscribePrintLayoutStore = subscribe
