import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { listProjectTree, loadDocument } from '../FileSystem'
import SFIcon from '../SFIcon'

const SEARCH_SCOPES = [
  { value: 'current-document', label: 'Current Document' },
  { value: 'file-tree', label: 'File Tree' },
  { value: 'notes', label: 'Notes' },
  { value: 'global-documents', label: 'Global Documents' },
]

const MAX_RESULTS_PER_DOCUMENT = 24
const MAX_PROJECT_RESULTS = 120

const getEntryLabel = (path = '') => path.split('/').filter(Boolean).pop() || path

const buildPreview = (text = '', from = 0, to = 0, radius = 34) => {
  const safeText = String(text || '')
  const start = Math.max(0, from - radius)
  const end = Math.min(safeText.length, to + radius)
  return safeText.slice(start, end).trim()
}

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

const collectMatchesFromDocJson = (content, query, docName) => {
  if (!content || !query) return []

  const matches = []
  const root = content?.type === 'doc'
    ? content
    : { type: 'doc', content: Array.isArray(content?.content) ? content.content : [] }

  walkJsonTextNodes(root, (node, pos) => {
    if (matches.length >= MAX_RESULTS_PER_DOCUMENT) return

    const text = String(node.text || '')
    const lower = text.toLowerCase()
    let index = lower.indexOf(query)

    while (index !== -1 && matches.length < MAX_RESULTS_PER_DOCUMENT) {
      const from = pos + index
      const to = from + query.length
      const preview = buildPreview(text, index, index + query.length)
      const matchText = text.slice(index, index + query.length)

      matches.push({
        id: `${docName}-${from}-${matches.length}`,
        type: 'global-document-match',
        docName,
        title: getEntryLabel(docName),
        path: docName,
        from,
        to,
        preview,
        matchText,
      })

      index = lower.indexOf(query, index + query.length)
    }
  }, 0, true)

  return matches
}

const flattenProjectFiles = (node, files = []) => {
  if (!node) return files

  if (node.type === 'file') {
    files.push({
      path: node.path,
      name: node.name,
    })
    return files
  }

  ;(node.children || []).forEach((child) => flattenProjectFiles(child, files))
  return files
}

const buildNotePreview = (note, query) => {
  const anchor = String(note.anchor || '')
  const content = String(note.content || '')
  const combined = [anchor, content].filter(Boolean).join(' — ')
  const lower = combined.toLowerCase()
  const index = lower.indexOf(query)

  if (index === -1) return combined || 'Untitled note'
  return buildPreview(combined, index, index + query.length)
}

export default function SearchPanel({
  activeEditor,
  editor,
  secondaryEditor,
  currentDoc,
  secondaryDoc,
  activeDoc,
  notesByDoc = {},
  projectName,
  onOpenSearchTarget,
}) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('current-document')
  const [replaceValue, setReplaceValue] = useState('')
  const [selectedResultId, setSelectedResultId] = useState(null)
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const [projectSearchState, setProjectSearchState] = useState({
    status: 'idle',
    results: [],
    total: 0,
  })
  const filterMenuRef = useRef(null)
  const filterButtonRef = useRef(null)
  const deferredQuery = useDeferredValue(query)
  const trimmedQuery = deferredQuery.trim()
  const normalizedQuery = trimmedQuery.toLowerCase()

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (
        filterMenuRef.current?.contains(event.target) ||
        filterButtonRef.current?.contains(event.target)
      ) {
        return
      }

      setFilterMenuOpen(false)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  const currentDocumentResults = useMemo(() => {
    if (scope !== 'current-document' || !activeEditor || !normalizedQuery) return []

    const matches = []
    const doc = activeEditor.state.doc

    doc.descendants((node, pos) => {
      if (!node.isText || !node.text || matches.length >= MAX_PROJECT_RESULTS) return

      const text = node.text
      const lower = text.toLowerCase()
      let index = lower.indexOf(normalizedQuery)

      while (index !== -1 && matches.length < MAX_PROJECT_RESULTS) {
        const from = pos + index
        const to = from + normalizedQuery.length
        matches.push({
          id: `${activeDoc || currentDoc || 'current'}-${from}-${matches.length}`,
          type: 'current-document-match',
          docName: activeDoc || currentDoc || '',
          title: getEntryLabel(activeDoc || currentDoc || 'Current document'),
          path: activeDoc || currentDoc || '',
          from,
          to,
          preview: buildPreview(text, index, index + normalizedQuery.length),
          matchText: text.slice(index, index + normalizedQuery.length),
        })

        index = lower.indexOf(normalizedQuery, index + normalizedQuery.length)
      }
    })

    return matches
  }, [activeDoc, activeEditor, currentDoc, normalizedQuery, scope])

  useEffect(() => {
    if (scope === 'current-document' || !projectName || !normalizedQuery) return

    let cancelled = false

    const runSearch = async () => {
      setProjectSearchState((current) => ({
        ...current,
        status: 'loading',
      }))

      const tree = await listProjectTree(projectName)
      if (cancelled) return

      const fileEntries = flattenProjectFiles(tree)
      let nextResults = []

      if (scope === 'file-tree') {
        nextResults = fileEntries
          .filter((entry) => entry.path.toLowerCase().includes(normalizedQuery))
          .map((entry, index) => ({
            id: `file-tree-${entry.path}-${index}`,
            type: 'file-tree-entry',
            docName: entry.path,
            title: entry.name,
            path: entry.path,
            preview: entry.path,
          }))
          .slice(0, MAX_PROJECT_RESULTS)
      } else {
        for (const entry of fileEntries) {
          if (nextResults.length >= MAX_PROJECT_RESULTS) break

          const liveContent = entry.path === currentDoc && editor
            ? {
                content: editor.getJSON(),
                notes: notesByDoc[entry.path] || [],
              }
            : entry.path === secondaryDoc && secondaryEditor
              ? {
                  content: secondaryEditor.getJSON(),
                  notes: notesByDoc[entry.path] || [],
                }
              : null

          const docData = liveContent || await loadDocument(projectName, entry.path)
          if (cancelled) return
          if (!docData) continue

          if (scope === 'notes') {
            const notes = Array.isArray(docData.notes) ? docData.notes : []
            const noteResults = notes
              .filter((note) => {
                const anchor = String(note.anchor || '').toLowerCase()
                const content = String(note.content || '').toLowerCase()
                return anchor.includes(normalizedQuery) || content.includes(normalizedQuery)
              })
              .map((note, index) => ({
                id: `note-${entry.path}-${note.id || index}`,
                type: 'note-match',
                docName: entry.path,
                title: note.anchor || getEntryLabel(entry.path),
                path: entry.path,
                preview: buildNotePreview(note, normalizedQuery),
                note,
              }))

            nextResults.push(...noteResults)
          } else {
            nextResults.push(...collectMatchesFromDocJson(docData.content, normalizedQuery, entry.path))
          }

          if (nextResults.length >= MAX_PROJECT_RESULTS) {
            nextResults = nextResults.slice(0, MAX_PROJECT_RESULTS)
            break
          }
        }
      }

      if (cancelled) return

      setProjectSearchState({
        status: 'ready',
        results: nextResults,
        total: nextResults.length,
      })
    }

    runSearch()

    return () => {
      cancelled = true
    }
  }, [
    currentDoc,
    editor,
    normalizedQuery,
    notesByDoc,
    projectName,
    scope,
    secondaryDoc,
    secondaryEditor,
  ])

  const effectiveSelectedResultId = useMemo(() => {
    if (currentDocumentResults.length === 0) return null
    return currentDocumentResults.some((result) => result.id === selectedResultId)
      ? selectedResultId
      : currentDocumentResults[0].id
  }, [currentDocumentResults, selectedResultId])

  const selectedCurrentResultIndex = useMemo(() => (
    currentDocumentResults.findIndex((result) => result.id === effectiveSelectedResultId)
  ), [currentDocumentResults, effectiveSelectedResultId])

  const jumpToEditorMatch = (match) => {
    if (!activeEditor || !match) return
    activeEditor
      .chain()
      .focus()
      .setTextSelection({ from: match.from, to: match.to })
      .scrollIntoView()
      .run()
  }

  const openResult = (result) => {
    if (!result) return

    if (scope === 'current-document') {
      setSelectedResultId(result.id)
      jumpToEditorMatch(result)
      return
    }

    onOpenSearchTarget?.({
      docName: result.docName,
      from: result.from,
      to: result.to,
      anchor: result.note?.anchor || result.matchText || result.title,
      note: result.note,
      skipJump: result.type === 'file-tree-entry',
    })
  }

  const cycleCurrentResult = (direction = 1) => {
    if (currentDocumentResults.length === 0) return

    const currentIndex = selectedCurrentResultIndex >= 0 ? selectedCurrentResultIndex : 0
    const nextIndex = (currentIndex + direction + currentDocumentResults.length) % currentDocumentResults.length
    const nextResult = currentDocumentResults[nextIndex]
    setSelectedResultId(nextResult.id)
    jumpToEditorMatch(nextResult)
  }

  const handleReplace = () => {
    if (!activeEditor || currentDocumentResults.length === 0) return

    const selectedResult =
      currentDocumentResults[selectedCurrentResultIndex >= 0 ? selectedCurrentResultIndex : 0]

    if (!selectedResult) return

    activeEditor
      .chain()
      .focus()
      .setTextSelection({ from: selectedResult.from, to: selectedResult.to })
      .insertContent(replaceValue)
      .run()
  }

  const handleReplaceAll = () => {
    const view = activeEditor?.editorView
    if (!view || currentDocumentResults.length === 0) return

    let tr = view.state.tr
    const reversedResults = [...currentDocumentResults].sort((a, b) => b.from - a.from)

    reversedResults.forEach((result) => {
      tr = tr.insertText(replaceValue, result.from, result.to)
    })

    view.dispatch(tr.scrollIntoView())
    view.focus()
  }

  const resultCount = scope === 'current-document'
    ? currentDocumentResults.length
    : projectSearchState.results.length

  const activeScope = SEARCH_SCOPES.find((entry) => entry.value === scope)

  return (
    <div className="sidebar-panel search-panel">
      <div className="sidebar-panel-sticky search-panel-sticky">
        <div className="panel-header">
          <div className="panel-header-title">
            <SFIcon name="magnifyingglass" />
            <span className="panel-header-label">Search</span>
          </div>
        </div>

        <div className="search-panel-top">
          <label
            className="sidebar-search-field sidebar-search-field--panel search-panel-field"
            aria-label="Search"
          >
            <span className="search-panel-label">Find</span>
            <input
              className="sidebar-search-input"
              type="search"
              placeholder={
                scope === 'current-document'
                  ? 'Find in document...'
                  : scope === 'file-tree'
                    ? 'Search file names...'
                    : scope === 'notes'
                      ? 'Search notes...'
                      : 'Search all documents...'
              }
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <span className="search-panel-submit" aria-hidden="true">
              <SFIcon name="magnifyingglass" className="sidebar-search-icon" />
            </span>
          </label>

          <button
            ref={filterButtonRef}
            className={`panel-action-btn panel-icon-btn search-filter-btn${scope !== 'current-document' ? ' active' : ''}`}
            onClick={() => setFilterMenuOpen((open) => !open)}
            aria-label="Search filter"
            title={activeScope ? `Searching: ${activeScope.label}` : 'Search filter'}
          >
            <SFIcon name="line.3.horizontal.decrease.circle" />
          </button>
        </div>

        {filterMenuOpen ? (
          <div
            ref={filterMenuRef}
            className="note-floating-menu search-filter-menu"
          >
            <div className="note-floating-title">Search Scope</div>
            <div className="note-filter-options">
              {SEARCH_SCOPES.map((entry) => (
                <button
                  key={entry.value}
                  className={`note-filter-option${scope === entry.value ? ' active' : ''}`}
                  onClick={() => {
                    setScope(entry.value)
                    setFilterMenuOpen(false)
                  }}
                >
                  <span>{entry.label}</span>
                  {scope === entry.value ? <SFIcon name="checkmark" /> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="search-panel-meta">
          <span className="search-panel-meta-copy">
            {trimmedQuery.length === 0
              ? `Searching ${activeScope?.label || 'Current Document'}`
              : `${resultCount} result${resultCount === 1 ? '' : 's'} in ${activeScope?.label || 'Current Document'}`}
          </span>

          {scope === 'current-document' && currentDocumentResults.length > 0 ? (
            <div className="search-panel-nav">
              <button
                className="panel-action-btn panel-icon-btn"
                onClick={() => cycleCurrentResult(-1)}
                aria-label="Previous match"
                title="Previous match"
              >
                <SFIcon name="chevron.left" />
              </button>
              <button
                className="panel-action-btn panel-icon-btn"
                onClick={() => cycleCurrentResult(1)}
                aria-label="Next match"
                title="Next match"
              >
                <SFIcon name="arrow.down.to.dot" />
              </button>
            </div>
          ) : null}
        </div>

        {scope === 'current-document' ? (
          <div className="search-replace-row">
            <label className="sidebar-search-field search-replace-field" aria-label="Replace in document">
              <span className="search-panel-label">Replace</span>
              <input
                className="sidebar-search-input"
                type="text"
                placeholder="Replace with..."
                value={replaceValue}
                onChange={(event) => setReplaceValue(event.target.value)}
              />
            </label>

            <button
              className="panel-action-btn search-replace-btn"
              onClick={handleReplace}
              disabled={currentDocumentResults.length === 0}
            >
              Replace
            </button>
            <button
              className="panel-action-btn search-replace-btn"
              onClick={handleReplaceAll}
              disabled={currentDocumentResults.length === 0}
            >
              All
            </button>
          </div>
        ) : null}
      </div>

      <div className="search-results">
        {trimmedQuery.length === 0 ? (
          <div className="notes-empty">
            {scope === 'current-document'
              ? 'Type to search or replace in the active document.'
              : `Type to search ${activeScope?.label?.toLowerCase() || 'this scope'}.`}
          </div>
        ) : scope !== 'current-document' && projectSearchState.status === 'loading' ? (
          <div className="notes-empty">Searching…</div>
        ) : scope === 'current-document' && currentDocumentResults.length === 0 ? (
          <div className="notes-empty">No matches.</div>
        ) : scope !== 'current-document' && projectSearchState.results.length === 0 ? (
          <div className="notes-empty">No matches.</div>
        ) : (
          (scope === 'current-document' ? currentDocumentResults : projectSearchState.results).map((result) => (
            <div
              key={result.id}
              className={`tile search-result${effectiveSelectedResultId === result.id ? ' selected' : ''}`}
              onClick={() => openResult(result)}
            >
              <div className="search-result-header">
                <span className="search-result-title">{result.title}</span>
                <span className="search-result-path">{result.path}</span>
              </div>
              <div className="search-preview">
                {result.preview ? (
                  <>
                    {result.matchText ? (
                      <>...{result.preview.split(result.matchText).map((part, index, parts) => (
                        index < parts.length - 1 ? (
                          <span key={index}>
                            {part}
                            <strong>{result.matchText}</strong>
                          </span>
                        ) : (
                          <span key={index}>{part}</span>
                        )
                      ))}...</>
                    ) : (
                      result.preview
                    )}
                  </>
                ) : (
                  result.path
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
