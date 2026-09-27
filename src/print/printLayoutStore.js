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
 * the way it was left — except the books, which are the project's and are kept in a
 * file in it (bookStore.js).
 */
import { useSyncExternalStore } from 'react'

import { getPreference, setPreference } from '../lib/preferences'
import { onBooksChanged, storedBook, storeBook } from './bookStore'
import { coversOf, designFor, digitalOf } from './chapterDesign'
import { bookFolderFor } from './compile'
import { clampZoom } from './zoom'
import { DEFAULT_SHEETS_PER_SIGNATURE } from './imposition'

const ZOOM_KEY = 'inkblot-print-zoom'
const SCOPE_PREFIX = 'inkblot-print-scope:'
const AUTHOR_KEY = 'inkblot-author-profile'

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

const zoomKey = (projectName, docPath) => `${ZOOM_KEY}:${projectName}/${docPath}`

/* ---------------- the window's mode ---------------- */

const MODE_PREFIX = 'inkblot-editor-mode:'
export const EDITOR_MODES = ['write', 'typeset']

/**
 * Write or Typeset, per project: the mode it was left in. Typeset shows every text
 * pane as its pages and locks the chapters' prose; Write is the continuous editor. It
 * replaced a per-document Print Layout switch, whose old preferences are not read.
 */
export const getEditorMode = (projectName) => (
  projectName && getPreference(`${MODE_PREFIX}${projectName}`) === 'typeset' ? 'typeset' : 'write'
)

export const setEditorMode = (projectName, mode) => {
  if (!projectName || !EDITOR_MODES.includes(mode) || getEditorMode(projectName) === mode) return
  setPreference(`${MODE_PREFIX}${projectName}`, mode)
  emit()
}

/** Whether a document shows as pages: every one does, in Typeset. */
export const isPrintLayoutEnabled = (projectName, docPath) => (
  Boolean(projectName && docPath) && getEditorMode(projectName) === 'typeset'
)

/** Pages on or off — which, now, is the mode. Kept for the menus and keys that ask. */
export const setPrintLayoutEnabled = (projectName, _docPath, enabled) => {
  setEditorMode(projectName, enabled ? 'typeset' : 'write')
}

const VIEW_PREFIX = 'inkblot-typeset-view:'
export const TYPESET_VIEWS = ['print', 'digital']

/**
 * Typeset's view, per project: the printed pages, or the e-book as a reader shows it
 * (`DigitalPreview.jsx`). Write has no views; the one Typeset was left in comes back.
 */
export const getTypesetView = (projectName) => (
  projectName && getPreference(`${VIEW_PREFIX}${projectName}`) === 'digital' ? 'digital' : 'print'
)

export const setTypesetView = (projectName, view) => {
  if (!projectName || !TYPESET_VIEWS.includes(view) || getTypesetView(projectName) === view) return
  setPreference(`${VIEW_PREFIX}${projectName}`, view)
  emit()
}

// The e-book's checks, as the Digital view last found them: the Publishing section's
// preflight lists them beside the print's. Null until the e-book has been read.
let ebookIssues = null

export const getEbookIssues = () => ebookIssues

export const setEbookIssues = (issues) => {
  const next = Array.isArray(issues) ? issues : null
  if (JSON.stringify(next) === JSON.stringify(ebookIssues)) return
  ebookIssues = next
  emit()
}

// Where "Edit Text" left Typeset from, so "Back to Typeset" can return to it. Not kept
// across launches: it is a round trip, not a setting.
let typesetReturn = null

/** `{ docPath, pos }` while a Typeset → Write round trip is open, else null. */
export const getTypesetReturn = () => typesetReturn

export const setTypesetReturn = (value) => {
  typesetReturn = value && value.docPath ? { docPath: value.docPath, pos: value.pos ?? null } : null
  emit()
}

/**
 * A document's zoom. Each document keeps its own, so zooming one side of a split leaves
 * the other as it was. One never zoomed shows the zoom set for no document in
 * particular (and from before zoom was a document's), which zooming a document never
 * changes — or it would move every such document with it.
 */
export const getPrintZoom = (projectName, docPath) => {
  const own = projectName && docPath ? getPreference(zoomKey(projectName, docPath)) : null
  const stored = Number.parseFloat(own || getPreference(ZOOM_KEY) || '')
  return Number.isFinite(stored) ? clampZoom(stored) : 1
}

export const setPrintZoom = (zoom, projectName, docPath) => {
  const value = String(clampZoom(zoom))
  setPreference(projectName && docPath ? zoomKey(projectName, docPath) : ZOOM_KEY, value)
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

export const DEFAULT_CHAPTER_NUMBERING = { style: 'none', prefix: 'Chapter', includeTitle: true, startAt: 1, showInTree: false }

export const DEFAULT_FRONT_MATTER = {
  halfTitle: false,
  copyright: '',
  dedication: '',
  epigraph: '',
  epigraphSource: '',
  contents: false,
}

export const DEFAULT_BACK_MATTER = { acknowledgements: '', aboutTheAuthor: '', alsoBy: '' }

const objectOr = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {})

// The book file is read in the background; when it lands, everything showing a book
// shows the one it holds.
onBooksChanged(() => emit())

/** A folder's book settings, with defaults filled in: the folder's name as the title. */
export const getBookSettings = (projectName, folder) => {
  const stored = objectOr(storedBook(projectName, folder))
  const name = (folder || projectName || 'Untitled').split('/').filter(Boolean).pop() || 'Untitled'
  const chapterNumbering = { ...DEFAULT_CHAPTER_NUMBERING, ...objectOr(stored.chapterNumbering) }
  chapterNumbering.startAt = chapterNumbering.startAt === 0 ? 0 : 1
  const { covers, activeCover } = coversOf(stored)
  const cover = covers.find((c) => c.id === activeCover)
  const book = {
    folder: folder || '',
    title: name,
    author: '',
    language: (typeof navigator !== 'undefined' && navigator.language) || 'en-US',
    ...stored,
    binding: { ...DEFAULT_BINDING, ...objectOr(stored.binding) },
    excluded: Array.isArray(stored.excluded) ? stored.excluded.filter((p) => typeof p === 'string') : [],
    chapterNumbering,
    frontMatter: { ...DEFAULT_FRONT_MATTER, ...objectOr(stored.frontMatter) },
    backMatter: { ...DEFAULT_BACK_MATTER, ...objectOr(stored.backMatter) },
    chapterDesign: designFor({ chapterDesign: stored.chapterDesign, chapterNumbering }, stored.pageSetup),
    items: Array.isArray(stored.items) ? stored.items.filter((item) => item && typeof item.id === 'string' && item.kind) : [],
    continuous: stored.continuous === true,
    covers,
    digital: digitalOf(stored),
  }
  if (stored.partDesign) book.partDesign = designFor({ chapterDesign: stored.partDesign })
  // The active cover's front is the book's cover wherever one image is wanted.
  if (activeCover) book.activeCover = activeCover
  if (cover?.front) book.coverImage = cover.front
  else delete book.coverImage
  return book
}

/** Store a folder's book settings. Resolves when they are saved in the project. */
export const setBookSettings = (projectName, folder, settings) => {
  const saved = storeBook(projectName, folder, { ...settings, folder: folder || '' })
  emit()
  return saved
}

/* ---------------- the writer ---------------- */

const PROFILE_FIELDS = ['byline', 'legalName', 'address', 'email', 'phone', 'agent']

/** The writer's byline and contact details, for every project: title pages, heads. */
export const getAuthorProfile = () => {
  let stored = null
  try {
    stored = JSON.parse(getPreference(AUTHOR_KEY) || 'null')
  } catch {
    stored = null
  }
  return Object.fromEntries(PROFILE_FIELDS.map((key) => [key, typeof stored?.[key] === 'string' ? stored[key] : '']))
}

export const setAuthorProfile = (profile) => {
  const clean = Object.fromEntries(PROFILE_FIELDS.map((key) => [key, typeof profile?.[key] === 'string' ? profile[key] : '']))
  setPreference(AUTHOR_KEY, JSON.stringify(clean))
  emit()
}

/** The name a book is by: its own author, or the writer's byline. */
export const bookAuthor = (book) => book?.author || getAuthorProfile().byline

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

/* ---------------- the Book navigator's selection ---------------- */

// Which entry of the book the navigator has selected, by project: for a page the book
// lays out (a title page, the contents) there is no document to be "the active one".
// Not kept across launches.
const selectedItems = new Map()

export const getSelectedBookItem = (projectName) => selectedItems.get(projectName || '') || null

export const setSelectedBookItem = (projectName, id) => {
  if (getSelectedBookItem(projectName) === (id || null)) return
  if (id) selectedItems.set(projectName || '', id)
  else selectedItems.delete(projectName || '')
  emit()
}

/* ---------------- the cover, in view ---------------- */

// Whether the Typeset view shows the book's cover (chosen in the Book navigator) in
// place of its pages. Not kept across launches.
let showingCover = false

export const isShowingCover = () => showingCover

export const setShowingCover = (showing) => {
  if (showingCover === Boolean(showing)) return
  showingCover = Boolean(showing)
  emit()
}

/* ---------------- a typeset version, previewed ---------------- */

// `{ id, compare, snapshot }` while the Typeset view shows a typeset version's pages;
// null otherwise. Not kept across launches.
let typesetPreview = null

export const getTypesetPreview = () => typesetPreview

export const setTypesetPreview = (preview) => {
  typesetPreview = preview && preview.snapshot ? preview : null
  emit()
}

/* ---------------- the last export ---------------- */

const LAST_EXPORT_PREFIX = 'inkblot-last-export:'

/** The project's last export — format, scope and file — for Export Again, or null. */
export const getLastExport = (projectName) => {
  if (!projectName) return null
  try {
    const stored = JSON.parse(getPreference(`${LAST_EXPORT_PREFIX}${projectName}`) || 'null')
    return stored?.format && stored?.path && SCOPES.includes(stored.scope) ? stored : null
  } catch {
    return null
  }
}

export const setLastExport = (projectName, lastExport) => {
  if (!projectName) return
  setPreference(`${LAST_EXPORT_PREFIX}${projectName}`, JSON.stringify(lastExport))
  emit()
}

/* ---------------- measurements ---------------- */

// The last count of a scope's pages and words, by laying it out (Measure). Not kept
// across launches: an old count of a book still being written would mislead.
const measurements = new Map()

const measureKey = (projectName, scope, docPath) => `${projectName}|${scope}|${scope === 'document' ? docPath : bookFolderFor(docPath, scope)}`

export const getMeasurement = (projectName, scope, docPath) => measurements.get(measureKey(projectName, scope, docPath)) || null

export const setMeasurement = (projectName, scope, docPath, measurement) => {
  measurements.set(measureKey(projectName, scope, docPath), measurement)
  emit()
}

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
