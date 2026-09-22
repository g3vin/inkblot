/**
 * sidebarSearch.js — the search engine behind the right sidebar's search bar.
 *
 * The sidebar has one search bar, shared by every panel, that expands into a
 * full search surface. This module holds everything about that search which is
 * not React: how a query is turned into a matcher (literal / case / whole-word /
 * regex), how the four scopes are searched, and what the bar recommends when the
 * query is empty.
 *
 * Kept free of React and of the filesystem (callers inject `listProjectTree` /
 * `loadDocument`) so the matching rules can be tested directly.
 */
import { isCanvasDoc } from './docKind'
import { collectCanvasMatches } from './canvasSearch'
import { getPreference, setPreference, removePreference } from './preferences'

export const MAX_RESULTS_PER_DOCUMENT = 24
export const MAX_PROJECT_RESULTS = 120
export const MAX_RECENT_SEARCHES = 6

const PREVIEW_RADIUS = 34

/**
 * Scopes, in the order they appear in the bar.
 *
 * `panel` is the default and is what the bar did before it could search: it
 * filters whatever panel is showing (clipboard entries, tiles, notes, versions).
 * Every other scope searches content and shows its own results, so the panel
 * underneath is left unfiltered.
 */
export const SEARCH_SCOPES = [
  { value: 'panel', label: 'This panel', hint: 'Filter what is on screen' },
  { value: 'document', label: 'Document', hint: 'Find and replace in the open document' },
  { value: 'notes', label: 'Notes', hint: 'Every note in the project' },
  { value: 'files', label: 'Files', hint: 'File and folder names' },
  { value: 'project', label: 'All documents', hint: 'Full text of every document' },
]

export const isFilterScope = (scope) => scope === 'panel'

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Compile a query into a matcher.
 *
 * Everything downstream — document, notes, files, canvases — matches through
 * this one object, so the case / whole-word / regex switches behave identically
 * in every scope.
 *
 * An invalid regex is reported (`valid: false`) rather than thrown: the user is
 * typing, and a half-written pattern like `foo(` is a normal intermediate state,
 * not an error worth breaking the panel over.
 */
export const createMatcher = (query, { matchCase = false, wholeWord = false, useRegex = false } = {}) => {
  const raw = String(query ?? '')

  if (!raw.trim()) {
    return { isEmpty: true, valid: true, error: '', findAll: () => [], test: () => false }
  }

  let source = useRegex ? raw : escapeRegExp(raw)
  if (wholeWord) source = `\\b(?:${source})\\b`

  let regex
  try {
    regex = new RegExp(source, matchCase ? 'g' : 'gi')
  } catch (error) {
    return {
      isEmpty: false,
      valid: false,
      error: error?.message || 'Invalid pattern',
      findAll: () => [],
      test: () => false,
    }
  }

  const findAll = (value, limit = Infinity) => {
    const text = String(value ?? '')
    if (!text) return []

    const found = []
    regex.lastIndex = 0

    let match = regex.exec(text)
    while (match && found.length < limit) {
      // A pattern that can match nothing (`a*`, `^`) would never advance
      // lastIndex on its own and would spin here forever.
      if (match[0].length === 0) {
        regex.lastIndex += 1
      } else {
        found.push({ index: match.index, length: match[0].length, text: match[0] })
      }
      match = regex.exec(text)
    }

    regex.lastIndex = 0
    return found
  }

  return {
    isEmpty: false,
    valid: true,
    error: '',
    findAll,
    test: (value) => findAll(value, 1).length > 0,
  }
}

export const buildPreview = (text = '', from = 0, to = 0, radius = PREVIEW_RADIUS) => {
  const safeText = String(text || '')
  const start = Math.max(0, from - radius)
  const end = Math.min(safeText.length, to + radius)
  return safeText.slice(start, end).trim()
}

export const getEntryLabel = (path = '') => path.split('/').filter(Boolean).pop() || path

/* ---- Saved-document matching ------------------------------------------------
   These mirror ProseMirror's position math over raw document JSON, so a document
   that is saved but not open can be searched without instantiating an editor:
   a text node counts its length, any other node adds 2 for its open/close tokens. */

const getJsonNodeSize = (node, isRoot = false) => {
  if (!node) return 0
  if (node.type === 'text') return String(node.text || '').length

  const children = Array.isArray(node.content) ? node.content : []
  const childSize = children.reduce((total, child) => total + getJsonNodeSize(child), 0)

  if (children.length === 0) return 1
  return isRoot ? childSize : childSize + 2
}

const walkJsonTextNodes = (node, visitor, pos = 0, isRoot = false) => {
  if (!node) return

  if (node.type === 'text' && typeof node.text === 'string') {
    visitor(node, pos)
    return
  }

  const children = Array.isArray(node.content) ? node.content : []
  let childPos = isRoot ? pos : pos + 1

  children.forEach((child) => {
    walkJsonTextNodes(child, visitor, childPos, false)
    childPos += getJsonNodeSize(child, false)
  })
}

/** Matches in a saved document's JSON, with document positions and previews. */
export const collectMatchesFromDocJson = (content, matcher, docName) => {
  if (!content || !matcher || matcher.isEmpty || !matcher.valid) return []

  const matches = []
  const root = content?.type === 'doc'
    ? content
    : { type: 'doc', content: Array.isArray(content?.content) ? content.content : [] }

  walkJsonTextNodes(root, (node, pos) => {
    if (matches.length >= MAX_RESULTS_PER_DOCUMENT) return

    const text = String(node.text || '')
    const remaining = MAX_RESULTS_PER_DOCUMENT - matches.length

    matcher.findAll(text, remaining).forEach((hit) => {
      matches.push({
        id: `${docName}-${pos + hit.index}-${matches.length}`,
        type: 'project-match',
        docName,
        title: getEntryLabel(docName),
        path: docName,
        from: pos + hit.index,
        to: pos + hit.index + hit.length,
        preview: buildPreview(text, hit.index, hit.index + hit.length),
        matchText: hit.text,
      })
    })
  }, 0, true)

  return matches
}

/** Matches in the live editor's document. */
export const collectEditorMatches = (editor, matcher, docName = '') => {
  if (!editor || !matcher || matcher.isEmpty || !matcher.valid) return []

  const matches = []

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text || matches.length >= MAX_PROJECT_RESULTS) return

    const text = node.text
    const remaining = MAX_PROJECT_RESULTS - matches.length

    matcher.findAll(text, remaining).forEach((hit) => {
      matches.push({
        id: `${docName || 'current'}-${pos + hit.index}-${matches.length}`,
        type: 'document-match',
        docName,
        title: getEntryLabel(docName || 'Current document'),
        path: docName,
        from: pos + hit.index,
        to: pos + hit.index + hit.length,
        preview: buildPreview(text, hit.index, hit.index + hit.length),
        matchText: hit.text,
      })
    })
  })

  return matches
}

const flattenProjectFiles = (node, files = []) => {
  if (!node) return files

  if (node.type === 'file') {
    files.push({ path: node.path, name: node.name })
    return files
  }

  ;(node.children || []).forEach((child) => flattenProjectFiles(child, files))
  return files
}

const buildNotePreview = (note, matcher) => {
  const combined = [String(note.anchor || ''), String(note.content || '')]
    .filter(Boolean)
    .join(' — ')

  const [hit] = matcher.findAll(combined, 1)
  if (!hit) return combined || 'Untitled note'
  return buildPreview(combined, hit.index, hit.index + hit.length)
}

/**
 * Search the project for the `notes`, `files`, and `project` scopes.
 *
 * Open documents are read from their live editors (via `getLiveDoc`) so unsaved
 * edits are searchable; everything else is read from disk.
 */
export const searchProject = async ({
  scope,
  matcher,
  projectName,
  listProjectTree,
  loadDocument,
  getLiveDoc = () => null,
  isCancelled = () => false,
}) => {
  if (!projectName || !matcher || matcher.isEmpty || !matcher.valid) return []

  const tree = await listProjectTree(projectName)
  if (isCancelled()) return []

  const fileEntries = flattenProjectFiles(tree)

  if (scope === 'files') {
    return fileEntries
      .filter((entry) => matcher.test(entry.path))
      .map((entry, index) => ({
        id: `file-${entry.path}-${index}`,
        type: 'file-entry',
        docName: entry.path,
        title: entry.name,
        path: entry.path,
        preview: entry.path,
      }))
      .slice(0, MAX_PROJECT_RESULTS)
  }

  let results = []

  for (const entry of fileEntries) {
    if (results.length >= MAX_PROJECT_RESULTS) break

    // A canvas has no live editor to read and no notes — its text lives in
    // cards, addressed by node id rather than by document position. Without this
    // branch collectMatchesFromDocJson would coerce it to an empty doc and it
    // would silently never match.
    if (isCanvasDoc(entry.path)) {
      if (scope === 'notes') continue

      const canvasData = await loadDocument(projectName, entry.path)
      if (isCancelled()) return []
      if (!canvasData) continue

      results.push(...collectCanvasMatches(canvasData, matcher, entry.path, {
        limit: MAX_RESULTS_PER_DOCUMENT,
      }))

      if (results.length >= MAX_PROJECT_RESULTS) break
      continue
    }

    const docData = getLiveDoc(entry.path) || await loadDocument(projectName, entry.path)
    if (isCancelled()) return []
    if (!docData) continue

    if (scope === 'notes') {
      const notes = Array.isArray(docData.notes) ? docData.notes : []

      results.push(...notes
        .filter((note) => matcher.test(note.anchor || '') || matcher.test(note.content || ''))
        .map((note, index) => ({
          id: `note-${entry.path}-${note.id || index}`,
          type: 'note-match',
          docName: entry.path,
          title: note.anchor || getEntryLabel(entry.path),
          path: entry.path,
          preview: buildNotePreview(note, matcher),
          note,
        })))
    } else {
      results.push(...collectMatchesFromDocJson(docData.content, matcher, entry.path))
    }

    if (results.length >= MAX_PROJECT_RESULTS) break
  }

  return results.slice(0, MAX_PROJECT_RESULTS)
}

/* ---- Recommendations & recents --------------------------------------------- */

/** What each panel's own filter is actually filtering, for the bar's placeholder. */
const PANEL_NOUNS = {
  clipboard: 'clipboard entries',
  workbench: 'tiles',
  notes: 'notes on this document',
  history: 'versions',
}

export const getPanelNoun = (tab) => PANEL_NOUNS[tab] || 'this panel'

export const getSearchPlaceholder = (scope, tab) => {
  if (isFilterScope(scope)) return `Filter ${getPanelNoun(tab)}`
  const active = SEARCH_SCOPES.find((entry) => entry.value === scope)
  return `Search ${(active?.label || '').toLowerCase()}`
}

/**
 * Scope suggestions shown while the query is empty, with the one most relevant
 * to the panel you are on promoted to the top (Notes while on the Notes panel).
 */
export const getRecommendedScopes = (tab) => {
  const promoted = tab === 'notes' ? ['notes'] : []

  const order = [
    ...promoted,
    'document',
    'project',
    'notes',
    'files',
  ].filter((value, index, all) => all.indexOf(value) === index)

  return order
    .map((value) => SEARCH_SCOPES.find((entry) => entry.value === value))
    .filter(Boolean)
}

const RECENT_STORAGE_KEY = 'inkblot.search.recent'

export const loadRecentSearches = () => {
  try {
    const parsed = JSON.parse(getPreference(RECENT_STORAGE_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry) => typeof entry === 'string' && entry.trim()).slice(0, MAX_RECENT_SEARCHES)
  } catch {
    return []
  }
}

/** Move `query` to the front of the recent list, returning the new list. */
export const rememberRecentSearch = (query) => {
  const trimmed = String(query || '').trim()
  if (!trimmed) return loadRecentSearches()

  const next = [trimmed, ...loadRecentSearches().filter((entry) => entry !== trimmed)]
    .slice(0, MAX_RECENT_SEARCHES)

  try {
    setPreference(RECENT_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // A failed write must not take the search bar down.
  }

  return next
}

export const clearRecentSearches = () => {
  try {
    removePreference(RECENT_STORAGE_KEY)
  } catch {
    // Nothing to do — the list is best-effort.
  }
  return []
}
