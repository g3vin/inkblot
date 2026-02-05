export default function HistoryPanel({ versions, editor }) {
  if (!versions || versions.length === 0) {
    return <div style={{ color: '#888', fontSize: '12px' }}>No versions yet.</div>
  }

  const stripHtml = (html) => {
    if (!html) return ''
    return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
  }

  const words = (html) => stripHtml(html).split(/\s+/).filter(Boolean)

  const renderChange = (idx) => {
    const cur = words(versions[idx]?.content || '')
    const prev = words(versions[idx + 1]?.content || '')

    // common prefix
    let p = 0
    while (p < cur.length && p < prev.length && cur[p] === prev[p]) p++

    // common suffix (avoid overlapping prefix)
    let s = 0
    while (
      s < cur.length - p &&
      s < prev.length - p &&
      cur[cur.length - 1 - s] === prev[prev.length - 1 - s]
    )
      s++

    const midPrev = prev.slice(p, prev.length - s)
    const midCur = cur.slice(p, cur.length - s)

    const prefixContext = cur.slice(Math.max(0, p - 3), p)
    const suffixContext = cur.slice(cur.length - s, cur.length - s + 3)

    const parts = []
    if (prefixContext.length) parts.push(<span key="pre" style={{ color: '#999' }}>{prefixContext.join(' ') + ' '}</span>)
    if (midPrev.length) parts.push(<del key="del" style={{ color: '#f88' }}>{midPrev.join(' ') + ' '}</del>)
    if (midCur.length) parts.push(<span key="add" style={{ color: '#8f8' }}>{midCur.join(' ') + ' '}</span>)
    if (suffixContext.length) parts.push(<span key="suf" style={{ color: '#999' }}>{suffixContext.join(' ')}</span>)

    // If no mid changes (rare), show a short equal preview
    if (!midPrev.length && !midCur.length) {
      const preview = cur.slice(0, 12).join(' ')
      return <span style={{ color: '#ccc' }}>{preview}</span>
    }

    return parts
  }

  const handleRestore = (version) => {
    if (!editor) return
    editor.commands.setContent(version.content)
  }

  return (
    <div className="workbench">
      {versions.map((v, idx) => (
        <div
          key={idx}
          className="tile"
          style={{ cursor: 'pointer' }}
          onClick={() => handleRestore(v)}
        >
          <div className="tile-header">
            {v.timestamp}
          </div>
          <div
            style={{
              fontSize: '12px',
              color: '#ccc',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              display: 'block',
            }}
          >
            {renderChange(idx)}
          </div>
        </div>
      ))}
    </div>
  )
}