/**
 * SidebarSearch.jsx — the right sidebar's one search bar, on every panel.
 *
 * It sits at the foot of the panels, a capsule like the file tree's filter. Collapsed
 * it is a filter box. Focused, it opens upward into the whole search
 * surface: scopes, match options, find-and-replace, results, and — while the query is
 * empty — what you probably want to search from where you are standing.
 *
 * The default scope is `panel`, which filters the panel showing beneath it
 * (clipboard entries, tiles, notes, versions). Picking any
 * other scope switches the bar from filtering to searching: it renders its own
 * results and stops filtering the panel, so the two never fight.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../ui/Icon.jsx'
import { listProjectTree, loadDocument } from '../../lib/FileSystem'
import {
  SEARCH_SCOPES,
  clearRecentSearches,
  collectEditorMatches,
  createMatcher,
  getRecommendedScopes,
  getSearchPlaceholder,
  isFilterScope,
  loadRecentSearches,
  rememberRecentSearch,
  searchProject,
} from '../../lib/sidebarSearch'

const SEARCH_DEBOUNCE_MS = 180

const MATCH_OPTIONS = [
  { key: 'matchCase', label: 'Aa', title: 'Match case' },
  { key: 'wholeWord', label: 'W', title: 'Whole word' },
  { key: 'useRegex', label: '.*', title: 'Regular expression' },
]

export default function SidebarSearch({
  query,
  setQuery,
  scope,
  setScope,
  tab,
  activeEditor,
  editor,
  secondaryEditor,
  currentDoc,
  secondaryDoc,
  activeDoc,
  notesByDoc = {},
  projectName,
  onOpenSearchTarget,
  // 'overlay' is the same search flown to the middle of the screen: always open,
  // and it owns the keyboard, so the inline copy stands down while it is up.
  variant = 'inline',
  active = true,
  onOpenOverlay,
  onCloseOverlay,
}) {
  const isOverlay = variant === 'overlay'
  const [expanded, setExpanded] = useState(isOverlay)
  const [options, setOptions] = useState({ matchCase: false, wholeWord: false, useRegex: false })
  const [replaceValue, setReplaceValue] = useState('')
  const [selectedResultId, setSelectedResultId] = useState(null)
  const [recentSearches, setRecentSearches] = useState(loadRecentSearches)
  const [projectSearch, setProjectSearch] = useState({ status: 'idle', results: [] })

  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const notesByDocRef = useRef(notesByDoc)

  // Searched a moment after the typing stops, not per key.
  const [deferredQuery, setDeferredQuery] = useState(query)
  useEffect(() => {
    if (!query) { setDeferredQuery(''); return undefined }
    const timer = setTimeout(() => setDeferredQuery(query), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])
  const matcher = useMemo(
    () => createMatcher(deferredQuery, options),
    [deferredQuery, options],
  )

  useEffect(() => {
    notesByDocRef.current = notesByDoc
  }, [notesByDoc])

  // The overlay is never collapsed — closing it is the overlay going away.
  const collapse = useCallback(() => {
    if (isOverlay) return
    setExpanded(false)
  }, [isOverlay])

  const expand = useCallback(() => {
    setExpanded(true)
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!isOverlay) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isOverlay])

  // Cmd+F opens the inline bar; Escape closes whichever surface is up. The
  // overlay owns Escape while it is open, so the inline copy sits it out.
  useEffect(() => {
    if (!active && !isOverlay) return undefined

    const onKeyDown = (event) => {
      if (!isOverlay && (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        expand()
        inputRef.current?.select()
        return
      }

      if (event.key !== 'Escape') return

      if (isOverlay) {
        onCloseOverlay?.()
        return
      }

      if (expanded) {
        collapse()
        inputRef.current?.blur()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, collapse, expand, expanded, isOverlay, onCloseOverlay])

  useEffect(() => {
    if (!expanded || isOverlay) return undefined

    const onPointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) return
      collapse()
    }

    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [collapse, expanded, isOverlay])

  /* ---- Results ---- */

  const documentResults = useMemo(() => {
    if (scope !== 'document') return []
    return collectEditorMatches(activeEditor, matcher, activeDoc || currentDoc || '')
  }, [activeDoc, activeEditor, currentDoc, matcher, scope])

  // Cheap fingerprint of every note, so the notes scope re-runs when a note's
  // text changes but not on unrelated re-renders.
  const notesRevision = useMemo(() => {
    if (scope !== 'notes') return ''
    return Object.entries(notesByDoc || {})
      .map(([docName, docNotes]) => {
        const latest = Array.isArray(docNotes)
          ? docNotes.reduce((newest, note) => {
            const stamp = String(note?.updatedAt || note?.createdAt || '')
            return stamp > newest ? stamp : newest
          }, '')
          : ''
        return `${docName}:${Array.isArray(docNotes) ? docNotes.length : 0}:${latest}`
      })
      .join('|')
  }, [notesByDoc, scope])

  useEffect(() => {
    // While the overlay is up the inline bar is behind it showing the same
    // query — running the same walk of every document twice would be pure waste.
    if (!active || scope === 'panel' || scope === 'document' || matcher.isEmpty || !matcher.valid) {
      setProjectSearch({ status: 'idle', results: [] })
      return undefined
    }

    let cancelled = false
    setProjectSearch((current) => ({ ...current, status: 'loading' }))

    const getLiveDoc = (path) => {
      if (path === currentDoc && editor) {
        return { content: editor.getJSON(), notes: notesByDocRef.current?.[path] || [] }
      }
      if (path === secondaryDoc && secondaryEditor) {
        return { content: secondaryEditor.getJSON(), notes: notesByDocRef.current?.[path] || [] }
      }
      return null
    }

    searchProject({
      scope,
      matcher,
      projectName,
      listProjectTree,
      loadDocument,
      getLiveDoc,
      isCancelled: () => cancelled,
    }).then((results) => {
      if (cancelled) return
      setProjectSearch({ status: 'ready', results })
    })

    return () => { cancelled = true }
  }, [
    active,
    currentDoc,
    editor,
    matcher,
    notesRevision,
    projectName,
    scope,
    secondaryDoc,
    secondaryEditor,
  ])

  const results = scope === 'document' ? documentResults : projectSearch.results

  const selectedIndex = useMemo(() => {
    if (documentResults.length === 0) return -1
    const index = documentResults.findIndex((result) => result.id === selectedResultId)
    return index === -1 ? 0 : index
  }, [documentResults, selectedResultId])

  /* ---- Actions ---- */

  const jumpToMatch = useCallback((match) => {
    if (!activeEditor || !match) return
    activeEditor
      .chain()
      .focus()
      .setTextSelection({ from: match.from, to: match.to })
      .scrollIntoView()
      .run()
  }, [activeEditor])

  const openResult = (result) => {
    if (!result) return
    setRecentSearches(rememberRecentSearch(query))

    if (scope === 'document') {
      setSelectedResultId(result.id)
      jumpToMatch(result)
      return
    }

    onOpenSearchTarget?.({
      docName: result.docName,
      from: result.from,
      to: result.to,
      anchor: result.note?.anchor || result.matchText || result.title,
      note: result.note,
      // A canvas hit is a node, not a document position — the layout reveals it
      // rather than trying to place a caret.
      nodeId: result.nodeId,
      skipJump: result.type === 'file-entry',
    })
  }

  const cycleMatch = (direction) => {
    if (documentResults.length === 0) return

    const base = selectedIndex >= 0 ? selectedIndex : 0
    const next = (base + direction + documentResults.length) % documentResults.length
    setSelectedResultId(documentResults[next].id)
    jumpToMatch(documentResults[next])
  }

  const handleReplace = () => {
    const target = documentResults[selectedIndex >= 0 ? selectedIndex : 0]
    if (!activeEditor || !target) return

    activeEditor
      .chain()
      .focus()
      .setTextSelection({ from: target.from, to: target.to })
      .insertContent(replaceValue)
      .run()
  }

  // One transaction, applied back-to-front so that replacing an early match
  // does not shift the positions of the ones after it.
  const handleReplaceAll = () => {
    const view = activeEditor?.editorView
    if (!view || documentResults.length === 0) return

    let tr = view.state.tr
    ;[...documentResults]
      .sort((left, right) => right.from - left.from)
      .forEach((result) => {
        tr = tr.insertText(replaceValue, result.from, result.to)
      })

    view.dispatch(tr.scrollIntoView())
    view.focus()
  }

  const handleInputKeyDown = (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()

    if (scope === 'document') {
      cycleMatch(event.shiftKey ? -1 : 1)
      setRecentSearches(rememberRecentSearch(query))
      return
    }

    if (results.length > 0) openResult(results[0])
  }

  const chooseScope = (nextScope) => {
    setScope(nextScope)
    setSelectedResultId(null)
    inputRef.current?.focus()
  }

  /* ---- Render ---- */

  const activeScope = SEARCH_SCOPES.find((entry) => entry.value === scope) || SEARCH_SCOPES[0]
  const hasQuery = !matcher.isEmpty
  const optionCount = Object.values(options).filter(Boolean).length
  const searching = !isFilterScope(scope)
  const isLoading = searching && scope !== 'document' && projectSearch.status === 'loading'

  const matchCounter = documentResults.length > 0
    ? `${selectedIndex + 1} of ${documentResults.length}`
    : hasQuery ? 'No matches' : ''

  return (
    <div
      ref={rootRef}
      className={`sidebar-search${expanded ? ' is-expanded' : ''}${isOverlay ? ' is-overlay' : ' floating-capsule'}`}
    >
      <label className="sidebar-search-field" aria-label="Search">
        <Icon name="search" className="sidebar-search-icon" />
        <input
          ref={inputRef}
          className="sidebar-search-input"
          type="text"
          placeholder={getSearchPlaceholder(scope, tab)}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={expand}
          onKeyDown={handleInputKeyDown}
        />

        {/* The scope is shown on the bar itself, so it is never a mystery why a
            search is returning what it is returning. */}
        {searching ? (
          <button
            type="button"
            className="sidebar-search-scope-chip"
            onClick={expand}
            title={`Scope: ${activeScope.label}`}
          >
            {activeScope.label}
          </button>
        ) : null}

        {query ? (
          <button
            type="button"
            className="sidebar-search-clear"
            onClick={() => { setQuery(''); inputRef.current?.focus() }}
            aria-label="Clear search"
            title="Clear search"
          >
            <Icon name="close" />
          </button>
        ) : null}

        {isOverlay ? (
          // Not another ✕ — it would sit right beside the one that clears the
          // query and read as the same button.
          <button
            type="button"
            className="sidebar-search-esc"
            onClick={() => onCloseOverlay?.()}
            aria-label="Close search"
            title="Close search"
          >
            Esc
          </button>
        ) : (
          <>
            <button
              type="button"
              className="sidebar-search-center"
              onClick={() => onOpenOverlay?.(rootRef.current?.getBoundingClientRect())}
              aria-label="Search the whole project"
              title="Search the whole project (⇧⌘F)"
            >
              <Icon name="frame" />
            </button>
            <button
              type="button"
              className={`sidebar-search-toggle${expanded ? ' is-open' : ''}${optionCount > 0 ? ' has-options' : ''}`}
              onClick={() => (expanded ? collapse() : expand())}
              aria-expanded={expanded}
              aria-label={expanded ? 'Hide search options' : 'Show search options'}
              title={expanded ? 'Hide search options' : 'Show search options'}
            >
              {/* The drawer opens upward from the foot of the sidebar. */}
              <Icon name="chevron-up" />
            </button>
          </>
        )}
      </label>

      {expanded ? (
        <div className="sidebar-search-drawer">
          <div className="sidebar-search-section">
            <div className="sidebar-search-section-title">Search in</div>
            <div className="sidebar-search-scopes">
              {SEARCH_SCOPES.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  className={`sidebar-search-scope${scope === entry.value ? ' active' : ''}`}
                  onClick={() => chooseScope(entry.value)}
                  title={entry.hint}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <div className="sidebar-search-hint">{activeScope.hint}</div>
          </div>

          <div className="sidebar-search-section">
            <div className="sidebar-search-section-title">Match</div>
            <div className="sidebar-search-options">
              {MATCH_OPTIONS.map(({ key, label, title }) => (
                <button
                  key={key}
                  type="button"
                  className={`sidebar-search-option${options[key] ? ' active' : ''}`}
                  onClick={() => setOptions((current) => ({ ...current, [key]: !current[key] }))}
                  aria-pressed={options[key]}
                  title={title}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {!matcher.valid ? (
            <div className="sidebar-search-error">Invalid pattern: {matcher.error}</div>
          ) : null}

          {scope === 'document' ? (
            <div className="sidebar-search-section">
              <div className="sidebar-search-section-title">
                <span>Replace</span>
                {matchCounter ? <span className="sidebar-search-count">{matchCounter}</span> : null}
              </div>

              <div className="sidebar-search-replace">
                <input
                  className="sidebar-search-replace-input"
                  type="text"
                  placeholder="Replace with…"
                  value={replaceValue}
                  onChange={(event) => setReplaceValue(event.target.value)}
                />
                <button
                  type="button"
                  className="sidebar-search-btn"
                  onClick={handleReplace}
                  disabled={documentResults.length === 0}
                >
                  Replace
                </button>
                <button
                  type="button"
                  className="sidebar-search-btn"
                  onClick={handleReplaceAll}
                  disabled={documentResults.length === 0}
                >
                  All
                </button>
              </div>

              <div className="sidebar-search-nav">
                <button
                  type="button"
                  className="sidebar-search-btn"
                  onClick={() => cycleMatch(-1)}
                  disabled={documentResults.length === 0}
                  title="Previous match (Shift+Enter)"
                  aria-label="Previous match"
                >
                  <Icon name="split" />
                </button>
                <button
                  type="button"
                  className="sidebar-search-btn"
                  onClick={() => cycleMatch(1)}
                  disabled={documentResults.length === 0}
                  title="Next match (Enter)"
                  aria-label="Next match"
                >
                  <Icon name="merge" />
                </button>
              </div>
            </div>
          ) : null}

          {/* Empty query: say what is worth searching from here rather than
              showing a blank panel. */}
          {!hasQuery ? (
            <>
              <div className="sidebar-search-section">
                <div className="sidebar-search-section-title">Recommended</div>
                <div className="sidebar-search-suggestions">
                  {getRecommendedScopes(tab).map((entry) => (
                    <button
                      key={entry.value}
                      type="button"
                      className="sidebar-search-suggestion"
                      onClick={() => chooseScope(entry.value)}
                    >
                      <Icon name="search" />
                      <span className="sidebar-search-suggestion-label">{entry.label}</span>
                      <span className="sidebar-search-suggestion-hint">{entry.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              {recentSearches.length > 0 ? (
                <div className="sidebar-search-section">
                  <div className="sidebar-search-section-title">
                    <span>Recent</span>
                    <button
                      type="button"
                      className="sidebar-search-link"
                      onClick={() => setRecentSearches(clearRecentSearches())}
                    >
                      Clear
                    </button>
                  </div>
                  <div className="sidebar-search-recents">
                    {recentSearches.map((entry) => (
                      <button
                        key={entry}
                        type="button"
                        className="sidebar-search-recent"
                        onClick={() => { setQuery(entry); inputRef.current?.focus() }}
                      >
                        <Icon name="clock" />
                        <span>{entry}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {hasQuery && searching && matcher.valid ? (
            <div className="sidebar-search-section sidebar-search-results-section">
              <div className="sidebar-search-section-title">
                <span>Results</span>
                <span className="sidebar-search-count">
                  {isLoading ? 'Searching…' : `${results.length}`}
                </span>
              </div>

              <div className="search-results sidebar-search-results">
                {!isLoading && results.length === 0 ? (
                  <div className="notes-empty">No matches.</div>
                ) : (
                  results.map((result) => (
                    <div
                      key={result.id}
                      className={`tile search-result${result.id === selectedResultId ? ' selected' : ''}`}
                      onClick={() => openResult(result)}
                    >
                      <div className="search-result-header">
                        <span className="search-result-title">{result.title}</span>
                        <span className="search-result-path">{result.path}</span>
                      </div>
                      <div className="search-preview">
                        {result.preview || result.path}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
