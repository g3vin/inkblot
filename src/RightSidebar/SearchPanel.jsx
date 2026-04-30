import { useMemo, useState } from 'react'
import SFIcon from '../SFIcon'

export default function SearchPanel({ editor }) {
  const [query, setQuery] = useState('')

  const results = useMemo(() => {
    if (!editor) return []
    const q = query.trim().toLowerCase()
    if (!q) return []

    const doc = editor.state.doc
    const matches = []
    const maxPos = doc.content.size

    doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return
      const text = node.text
      const lower = text.toLowerCase()
      let idx = lower.indexOf(q)
      while (idx !== -1) {
        const from = pos + idx
        const to = from + q.length
        const previewStart = Math.max(0, from - 30)
        const previewEnd = Math.min(maxPos, to + 30)
        const preview = doc.textBetween(previewStart, previewEnd, ' ')
        const matchText = doc.textBetween(from, to, ' ')
        matches.push({ from, to, preview, matchText })
        idx = lower.indexOf(q, idx + q.length)
      }
    })

    return matches
  }, [editor, query])

  const jumpTo = (from, to) => {
    if (!editor) return
    editor
      .chain()
      .focus()
      .setTextSelection({ from, to })
      .scrollIntoView()
      .run()
  }

  return (
    <div className="sidebar-panel search-panel">
      <div className="panel-header">
        <div className="panel-header-title">
          <SFIcon name="magnifyingglass.circle" />
          <span className="panel-header-label">Search</span>
        </div>
      </div>

      <input
        className="notes-search"
        type="search"
        placeholder="Search in document..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="search-results">
        {query.trim().length === 0 ? (
          <div className="notes-empty">Type to search.</div>
        ) : results.length === 0 ? (
          <div className="notes-empty">No matches.</div>
        ) : (
          results.map((match, idx) => (
            <div
              key={`${match.from}-${idx}`}
              className="tile search-result"
              onClick={() => jumpTo(match.from, match.to)}
            >
              <div className="search-preview">
                ...{match.preview.split(match.matchText).map((part, i, arr) => (
                  i < arr.length - 1 ? (
                    <span key={i}>
                      {part}
                      <strong>{match.matchText}</strong>
                    </span>
                  ) : (
                    <span key={i}>{part}</span>
                  )
                ))}...
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
