/**
 * TimelinePane.jsx — a timeline view shown in one editor pane.
 *
 * Loads the view document and owns the pane chrome; TimelineSurface owns the view. As
 * with MapPane, the surface mounts once loading finishes and is keyed by path. A file
 * ending in `.timeline` that holds something else is shown as such and never written.
 */
import { useEffect, useState } from 'react'
import { useReveal } from '../ui/revealState.js'
import { PaneSurfaceReveal, TimelineSkeleton } from '../canvas/PaneSkeletons'
import { getDocDisplayName } from '../lib/docKind'
import { useLockReason } from '../lib/docLocks'
import DocLockBadge from '../components/DocLockBadge'
import { loadTimelineView } from '../lib/timeline/timelineFileSystem'
import TimelineSurface from './TimelineSurface'
import '../map/Map.css'
import './Timeline.css'

export default function TimelinePane({
  projectName,
  docPath,
  onActivate,
  onOpenDoc,
  isActive = true,
  onLoaded,
}) {
  const locked = useLockReason(docPath) !== null
  const [result, setResult] = useState(null)
  // What was loaded, only for the path it was loaded from, as in MapPane.
  const loaded = result?.docPath === docPath ? result.loaded : null

  useEffect(() => {
    if (!projectName || !docPath) return undefined
    let cancelled = false
    loadTimelineView(projectName, docPath).then((next) => {
      if (!cancelled) setResult({ docPath, loaded: next })
    })
    return () => {
      cancelled = true
    }
  }, [docPath, projectName])

  useEffect(() => {
    if (loaded) onLoaded?.(docPath)
  }, [loaded, docPath, onLoaded])
  const reveal = useReveal(Boolean(loaded))

  return (
    <div className="timeline-pane">
      <PaneSurfaceReveal reveal={reveal} loaded={Boolean(loaded)} backdrop={<div className="timeline-surface is-loading" />} skeleton={<TimelineSkeleton />} label="Opening timeline">
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
          locked={locked}
          projectName={projectName}
          docPath={docPath}
          initialView={loaded.view}
          onActivate={onActivate}
          onOpenDoc={onOpenDoc}
          isActive={isActive}
        />
      ) : null}
      {loaded ? <DocLockBadge className="is-floating" projectName={projectName} docPath={docPath} /> : null}
      </PaneSurfaceReveal>
    </div>
  )
}
