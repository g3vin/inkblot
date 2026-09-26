/**
 * TimelinePane.jsx — a timeline view shown in one editor pane.
 *
 * Loads the view document and owns the pane chrome; TimelineSurface owns the view. As
 * with MapPane, the surface mounts once loading finishes and is keyed by path. A file
 * ending in `.timeline` that holds something else is shown as such and never written.
 */
import { useEffect, useState } from 'react'
import { getDocDisplayName } from '../lib/docKind'
import { loadTimelineView } from '../lib/timeline/timelineFileSystem'
import TimelineSurface from './TimelineSurface'
import '../map/Map.css'
import './Timeline.css'

export default function TimelinePane({
  projectName,
  docPath,
  onActivate,
  onOpenDoc,
  showHeader = false,
  onClose,
  isActive = true,
  chromeWhileInactive = false,
}) {
  const [loaded, setLoaded] = useState(null)

  useEffect(() => {
    if (!projectName || !docPath) return undefined
    let cancelled = false
    setLoaded(null)
    loadTimelineView(projectName, docPath).then((result) => {
      if (!cancelled) setLoaded(result)
    })
    return () => {
      cancelled = true
    }
  }, [docPath, projectName])

  return (
    <div className="timeline-pane">
      {showHeader ? (
        <div className="pane-header pane-header-centered">
          <span>{getDocDisplayName(docPath)}</span>
          <button onClick={onClose}>×</button>
        </div>
      ) : null}

      {loaded?.foreign ? (
        <div className="map-foreign" role="status">
          <h2>This isn’t a timeline</h2>
          <p>
            “{getDocDisplayName(docPath)}.timeline” holds a document written before timelines existed. Its
            name ends in <code>.timeline</code>, which is how Inkblot recognises a timeline now. Nothing has
            been changed — rename it to keep editing it as a document.
          </p>
        </div>
      ) : loaded ? (
        <TimelineSurface
          key={docPath}
          projectName={projectName}
          docPath={docPath}
          initialView={loaded.view}
          onActivate={onActivate}
          onOpenDoc={onOpenDoc}
          isActive={isActive}
          chromeWhileInactive={chromeWhileInactive}
        />
      ) : (
        <div className="timeline-surface is-loading" />
      )}
    </div>
  )
}
