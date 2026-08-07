import { useEffect, useState } from 'react'
import { getVersions } from '../FileSystem'
import SFIcon from '../SFIcon'

export default function HistoryPanel({ versions, editor, setVersions, projectName, docName }) {
  const [localVersions, setLocalVersions] = useState(Array.isArray(versions) ? versions : [])
  const displayedVersions = localVersions.length ? localVersions : (Array.isArray(versions) ? versions : [])

  useEffect(() => {
    if (!projectName || !docName) return

    let cancelled = false

    ;(async () => {
      try {
        const nextVersions = await getVersions(projectName, docName)
        if (!cancelled) {
          setLocalVersions(nextVersions || [])
          setVersions?.(docName, nextVersions || [])
        }
      } catch {
        // ignore
      }
    })()

    return () => {
      cancelled = true
    }
  }, [projectName, docName, setVersions])

  useEffect(() => {
    const handler = (event) => {
      const detail = event?.detail || {}
      if (detail.projectName !== projectName || detail.docName !== docName) return

      ;(async () => {
        try {
          const nextVersions = await getVersions(projectName, docName)
          setLocalVersions(nextVersions || [])
          setVersions?.(docName, nextVersions || [])
        } catch {
          // ignore
        }
      })()
    }

    window.addEventListener('versions:changed', handler)
    return () => {
      window.removeEventListener('versions:changed', handler)
    }
  }, [projectName, docName, setVersions])

  const formatTimestamp = (iso) => {
    if (!iso) return ''
    try {
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return iso
      return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return iso
    }
  }

  const stripHtml = (html) => {
    if (!html) return ''
    return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
  }

  const words = (html) => stripHtml(html).split(/\s+/).filter(Boolean)

  const renderChange = (versionsList, idx) => {
    const cur = words(versionsList[idx]?.contentHtml || '')
    const prev = words(versionsList[idx + 1]?.contentHtml || '')

    let p = 0
    while (p < cur.length && p < prev.length && cur[p] === prev[p]) p++

    let s = 0
    while (
      s < cur.length - p &&
      s < prev.length - p &&
      cur[cur.length - 1 - s] === prev[prev.length - 1 - s]
    ) s++

    const midPrev = prev.slice(p, prev.length - s)
    const midCur = cur.slice(p, cur.length - s)
    const prefixContext = cur.slice(Math.max(0, p - 3), p)
    const suffixContext = cur.slice(cur.length - s, cur.length - s + 3)

    if (!midPrev.length && !midCur.length) {
      return <span className="history-preview-text">{cur.slice(0, 12).join(' ')}</span>
    }

    return (
      <>
        {prefixContext.length ? (
          <span className="history-preview-context">{`${prefixContext.join(' ')} `}</span>
        ) : null}
        {midPrev.length ? (
          <del className="history-preview-removed">{`${midPrev.join(' ')} `}</del>
        ) : null}
        {midCur.length ? (
          <span className="history-preview-added">{`${midCur.join(' ')} `}</span>
        ) : null}
        {suffixContext.length ? (
          <span className="history-preview-context">{suffixContext.join(' ')}</span>
        ) : null}
      </>
    )
  }

  const handleRestore = (version) => {
    if (!editor) return
    const content = version.contentJson || version.contentHtml || '<p></p>'
    editor.commands.setContent(content)
  }

  const handleRevert = async (versionsList, idx) => {
    if (!editor) return

    const curWords = words(versionsList[idx]?.contentHtml || '')
    const prevWords = words(versionsList[idx + 1]?.contentHtml || '')

    let p = 0
    while (p < curWords.length && p < prevWords.length && curWords[p] === prevWords[p]) p++

    let s = 0
    while (
      s < curWords.length - p &&
      s < prevWords.length - p &&
      curWords[curWords.length - 1 - s] === prevWords[prevWords.length - 1 - s]
    ) s++

    const midPrev = prevWords.slice(p, prevWords.length - s)
    const midCur = curWords.slice(p, curWords.length - s)
    if (!midCur.length) return

    const prefixContext = curWords.slice(Math.max(0, p - 3), p)
    const suffixContext = curWords.slice(curWords.length - s, curWords.length - s + 3)
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
      const midStr = midCur.join(' ')
      const fallbackIdx = currentPlain.indexOf(midStr)
      if (fallbackIdx === -1) return
      nextPlain = currentPlain.slice(0, fallbackIdx) + midPrev.join(' ') + currentPlain.slice(fallbackIdx + midStr.length)
    }

    editor.commands.setContent(`<p>${nextPlain.replace(/\n/g, '<br/>')}</p>`)

    try {
      const nextVersions = await getVersions(projectName, docName)
      setLocalVersions(nextVersions || [])
      setVersions?.(docName, nextVersions || [])
    } catch {
      // ignore
    }
  }

  return (
    <div className="sidebar-panel history-panel">
      <div className="panel-header">
        <div className="panel-header-title">
          <SFIcon name="clock" />
          <span className="panel-header-label">History</span>
        </div>
      </div>

      {displayedVersions.length === 0 ? (
        <div className="notes-empty">No versions yet.</div>
      ) : (
        <div className="sidebar-list history-list">
          {displayedVersions.map((version, idx) => (
            <div key={idx} className="tile history-tile">
              <div className="tile-header history-tile-header">
                <span className="history-timestamp" title={version.timestamp}>
                  {formatTimestamp(version.timestamp)}
                </span>
                <div className="history-actions">
                  <button
                    className="panel-action-btn panel-action-btn-small"
                    title="Restore full version"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleRestore(version)
                    }}
                  >
                    Restore
                  </button>
                  <button
                    className="panel-action-btn panel-action-btn-small"
                    title="Revert this change"
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleRevert(displayedVersions, idx)
                    }}
                  >
                    Revert
                  </button>
                </div>
              </div>
              <div className="history-preview">
                {renderChange(displayedVersions, idx)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
