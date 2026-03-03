import { useEffect, useState } from 'react'
import { getVersions } from '../FileSystem'

export default function HistoryPanel({ versions, editor, setVersions, projectName, docName }) {
  const [localVersions, setLocalVersions] = useState(Array.isArray(versions) ? versions : [])

  try {
    console.debug('[HistoryPanel] render', { docName, versionsLength: Array.isArray(localVersions) ? localVersions.length : 0 })
  } catch (e) {}

  useEffect(() => {
    try {
      console.debug('[HistoryPanel] prop versions changed', { docName, count: Array.isArray(versions) ? versions.length : 0 })
      if (Array.isArray(versions) && versions.length) setLocalVersions(versions)
    } catch (e) {}
  }, [versions, docName])

  const formatTimestamp = (iso) => {
    if (!iso) return ''
    try {
      const d = new Date(iso)
      if (isNaN(d)) return iso
      return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch (e) {
      return iso
    }
  }
  useEffect(() => {
    if (!projectName || !docName) return

    let cancelled = false
    ;(async () => {
      try {
        console.debug('[HistoryPanel] fetching versions for', { projectName, docName })
        const vs = await getVersions(projectName, docName)
        console.debug('[HistoryPanel] received versions', { projectName, docName, count: Array.isArray(vs) ? vs.length : 0 })
        if (!cancelled) {
          setLocalVersions(vs || [])
          // also notify parent mapping if available
          try { setVersions?.(docName, vs) } catch (e) {}
        }
      } catch (e) {
        // noop
      }
    })()

    return () => { cancelled = true }
  }, [projectName, docName, setVersions])

  useEffect(() => {
    const handler = (e) => {
      try {
        const detail = e?.detail || {}
        if (detail.projectName === projectName && detail.docName === docName) {
          (async () => {
            console.debug('[HistoryPanel] versions:changed received, refetching', { projectName, docName })
            const vs = await getVersions(projectName, docName)
            setLocalVersions(vs || [])
            try { setVersions?.(docName, vs) } catch (e) {}
          })()
        }
      } catch (err) {}
    }

    try { window.addEventListener('versions:changed', handler) } catch (e) {}
    return () => { try { window.removeEventListener('versions:changed', handler) } catch (e) {} }
  }, [projectName, docName, setVersions])

  if (!versions || versions.length === 0) {
    return <div style={{ color: '#888', fontSize: '12px' }}>No versions yet.</div>
  }

  const stripHtml = (html) => {
    if (!html) return ''
    return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
  }

  const words = (html) => stripHtml(html).split(/\s+/).filter(Boolean)

  const renderChange = (idx) => {
    const cur = words(versions[idx]?.contentHtml || '')
    const prev = words(versions[idx + 1]?.contentHtml || '')

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
    // if we have a json snapshot prefer it, otherwise use html
    const content = version.contentJson || version.contentHtml || '<p></p>'
    editor.commands.setContent(content)
  }

  const handleRevert = async (idx) => {
    if (!editor) return

    // Determine the changed word ranges between this version and the next
    const curWords = words(versions[idx]?.contentHtml || '')
    const prevWords = words(versions[idx + 1]?.contentHtml || '')

    let p = 0
    while (p < curWords.length && p < prevWords.length && curWords[p] === prevWords[p]) p++

    let s = 0
    while (
      s < curWords.length - p &&
      s < prevWords.length - p &&
      curWords[curWords.length - 1 - s] === prevWords[prevWords.length - 1 - s]
    )
      s++

    const midPrev = prevWords.slice(p, prevWords.length - s)
    const midCur = curWords.slice(p, curWords.length - s)

    if (!midCur.length) {
      // nothing to revert
      return
    }

    const prefixContext = curWords.slice(Math.max(0, p - 3), p)
    const suffixContext = curWords.slice(curWords.length - s, curWords.length - s + 3)

    // Work on the current editor plain text, perform a safe replace of the changed region
    const currentHtml = editor.getHTML()
    const currentPlain = stripHtml(currentHtml)

    const buildMatch = (pre, mid, suf) => ([pre, mid, suf].filter(Boolean).join(' ').trim())

    const matchStr = buildMatch(prefixContext.join(' '), midCur.join(' '), suffixContext.join(' '))
    const replaceWith = buildMatch(prefixContext.join(' '), midPrev.join(' '), suffixContext.join(' '))

    let nextPlain
    const idxFound = matchStr ? currentPlain.indexOf(matchStr) : -1
    if (idxFound !== -1) {
      nextPlain = currentPlain.slice(0, idxFound) + replaceWith + currentPlain.slice(idxFound + matchStr.length)
    } else {
      // fallback: replace first occurrence of midCur sequence
      const midStr = midCur.join(' ')
      const i2 = currentPlain.indexOf(midStr)
      if (i2 === -1) return
      nextPlain = currentPlain.slice(0, i2) + midPrev.join(' ') + currentPlain.slice(i2 + midStr.length)
    }

    // Apply the reverted plain text to the editor (this will replace content but only change the target region)
    editor.commands.setContent(`<p>${nextPlain.replace(/\n/g, '<br/>')}</p>`)

    // refresh versions list if possible
      try {
      console.debug('[HistoryPanel] revert: refreshing versions for', { projectName, docName })
      const vs = await getVersions(projectName, docName)
      console.debug('[HistoryPanel] revert: got versions count', { projectName, docName, count: vs?.length })
      setVersions?.(docName, vs)
    } catch (e) {
      // noop
    }
  }

  return (
    <div className="workbench">
      {versions.map((v, idx) => (
        <div
          key={idx}
          className="tile"
          style={{ cursor: 'default', display: 'flex', flexDirection: 'column' }}
        >
          <div className="tile-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px' }} title={v.timestamp}>{formatTimestamp(v.timestamp)}</span>
            <span>
              <button title="Restore full version" onClick={(e) => { e.stopPropagation(); handleRestore(v) }} style={{ marginRight: 6 }}>Restore</button>
              <button title="Revert this change" onClick={(e) => { e.stopPropagation(); handleRevert(idx) }}>Revert</button>
            </span>
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