/**
 * sidebarSearch.js — the search engine behind the project search and the find bar.
 *
 * There is one search, at the left sidebar's foot (and centred, ⇧⌘F). It has no
 * scopes: what it finds is sorted into categories — the document you are in, the
 * project's documents, its notes — the way a browser's search sorts tabs, history
 * and bookmarks. This module holds everything about that search which is not React:
 * how a query is turned into a matcher, how the project is walked, and recent
 * searches. The find bar (⌘F) uses the same matcher on the open document.
 *
 * Kept free of React and of the filesystem (callers inject `listProjectTree` /
 * `loadDocument`) so the matching rules can be tested directly.
 */
import { getDocDisplayName, getDocKind } from './docKind'
import { collectCanvasMatches } from './canvasSearch'
import { collectMapMatches } from './map/mapSearch'
import { getPreference, setPreference, removePreference } from './preferences'

export const MAX_RESULTS_PER_DOCUMENT = 24
export const MAX_PROJECT_RESULTS = 120
export const MAX_RECENT_SEARCHES = 6
/** No category runs on past this many rows, so a common word cannot flood the card. */
export const MAX_PER_CATEGORY = 8

const PREVIEW_RADIUS = 34

/** `detail: { query }` — ⌘F: open the inspector's search, finding `query` if there is one. */
export const FIND_EVENT = 'inkblot:find'
export const requestFind = (query = '') => window.dispatchEvent(new CustomEvent(FIND_EVENT, { detail: { query } }))

/** ⌘F on a map: the active map opens its own search (MapSearch.jsx). */
export const MAP_FIND_EVENT = 'inkblot:map-find'
export const requestMapFind = () => window.dispatchEvent(new CustomEvent(MAP_FIND_EVENT))

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

const firstHit = (hits) => hits[0] || null

/**
 * Search the whole project at once, sorted into the card's categories.
 *
 * `documents` has one row per file, a name match ranked above a match in the text
 * only, its preview the first hit in the text. `notes` has a row per matching note.
 * The document being written in (`currentDocName`) is left out of `documents`: its
 * hits are the card's "In this document", which the card reads from the live editor.
 *
 * Open documents are read from their live editors (via `getLiveDoc`) so unsaved
 * edits are searchable; everything else is read from disk.
 */
export const searchEverything = async ({
  matcher,
  projectName,
  currentDocName = '',
  listProjectTree,
  loadDocument,
  getLiveDoc = () => null,
  isCancelled = () => false,
  limit = MAX_PER_CATEGORY,
}) => {
  const empty = { documents: [], notes: [] }
  if (!projectName || !matcher || matcher.isEmpty || !matcher.valid) return empty

  const tree = await listProjectTree(projectName)
  if (isCancelled()) return empty

  const named = []
  const inText = []
  const notes = []

  for (const entry of flattenProjectFiles(tree)) {
    if (named.length >= limit && notes.length >= limit) break

    const kind = getDocKind(entry.path)
    const title = getDocDisplayName(entry.path)
    const nameMatched = matcher.test(title)
    const row = (hit, matchCount) => ({
      id: `doc-${entry.path}`,
      type: 'document',
      kind,
      docName: entry.path,
      title,
      path: entry.path,
      preview: hit?.preview || entry.path,
      from: hit?.from,
      to: hit?.to,
      nodeId: hit?.nodeId,
      matchText: hit?.matchText,
      matchCount,
    })

    // A timeline view holds no text of its own — its events are the project's.
    if (kind === 'timeline') {
      if (nameMatched && entry.path !== currentDocName) named.push(row(null, 0))
      continue
    }

    const data = (kind === 'text' ? getLiveDoc(entry.path) : null) || await loadDocument(projectName, entry.path)
    if (isCancelled()) return empty

    // A canvas or a map has no notes, and its text is addressed by item id rather
    // than by document position.
    let hits = []
    if (data && kind === 'canvas') hits = collectCanvasMatches(data, matcher, entry.path, { limit: MAX_RESULTS_PER_DOCUMENT })
    else if (data && kind === 'map') hits = collectMapMatches(data, matcher, entry.path, { limit: MAX_RESULTS_PER_DOCUMENT })
    else if (data) hits = collectMatchesFromDocJson(data.content, matcher, entry.path)

    if (entry.path !== currentDocName && (nameMatched || hits.length > 0)) {
      ;(nameMatched ? named : inText).push(row(firstHit(hits), hits.length))
    }

    if (kind === 'text' && data && notes.length < limit) {
      const docNotes = Array.isArray(data.notes) ? data.notes : []
      docNotes
        .filter((note) => matcher.test(note.anchor || '') || matcher.test(note.content || ''))
        .forEach((note, index) => {
          notes.push({
            id: `note-${entry.path}-${note.id || index}`,
            type: 'note-match',
            kind: 'note',
            docName: entry.path,
            title: note.anchor || title,
            path: entry.path,
            preview: buildNotePreview(note, matcher),
            note,
          })
        })
    }
  }

  return {
    documents: [...named, ...inText].slice(0, limit),
    notes: notes.slice(0, limit),
  }
}

/* ---- Recents --------------------------------------------------------------- */

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
