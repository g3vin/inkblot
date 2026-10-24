/**
 * MapPane.jsx — the map document shown in one editor pane.
 *
 * Loads the map and owns the pane chrome; MapSurface owns the map. As with
 * CanvasPane, the surface mounts only once loading finishes and is keyed by path,
 * so it takes the loaded map and viewport as initial values.
 *
 * A file whose name ends in `.map` but which holds something else — a document
 * named before maps existed — is shown as such and never written to (see
 * mapFileSystem.js).
 */
import { useEffect, useState } from 'react'
import { useReveal } from '../ui/revealState.js'
import { MapSkeleton, PaneSurfaceReveal } from '../canvas/PaneSkeletons'
import { getDocDisplayName } from '../lib/docKind'
import { useLockReason } from '../lib/docLocks'
import DocLockBadge from '../components/DocLockBadge'
import { loadMapDocument } from '../lib/map/mapFileSystem'
import MapSurface from './MapSurface'
import './Map.css'
import './mapThemes.css'

export default function MapPane({
  projectName,
  docPath,
  onActivate,
  onOpenDoc,
  isActive = true,
  chromeWhileInactive = false,
  onLoaded,
}) {
  const locked = useLockReason(docPath) !== null
  const [result, setResult] = useState(null)
  // What was loaded, only for the path it was loaded from: when the pane is switched to
  // another map, the render before the new load must not mount the new path's surface
  // on the old map (whose first autosave would then write it over the new file).
  const loaded = result?.docPath === docPath ? result : null

  useEffect(() => {
    if (!projectName || !docPath) return undefined
    let cancelled = false
    loadMapDocument(projectName, docPath).then((next) => {
      if (!cancelled) setResult({ ...next, docPath })
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
    <div className="map-pane">
      <PaneSurfaceReveal reveal={reveal} loaded={Boolean(loaded)} backdrop={<div className="map-surface is-loading" />} skeleton={<MapSkeleton />} label="Opening map">
      {loaded?.foreign ? (
        <div className="map-foreign" role="status">
          <h2>This isn’t a map</h2>
          <p>
            “{getDocDisplayName(docPath)}.map” holds a document written before maps existed. Its
            name ends in <code>.map</code>, which is how Inkblot recognises a map now. Nothing has
            been changed — rename it to keep editing it as a document.
          </p>
        </div>
      ) : loaded ? (
        <MapSurface
          key={docPath}
          locked={locked}
          projectName={projectName}
          docPath={docPath}
          initialMap={loaded.map}
          initialViewport={loaded.viewport}
          onActivate={onActivate}
          onOpenDoc={onOpenDoc}
          isActive={isActive}
          chromeWhileInactive={chromeWhileInactive}
        />
      ) : null}
      {loaded ? <DocLockBadge className="is-floating" projectName={projectName} docPath={docPath} /> : null}
      </PaneSurfaceReveal>
    </div>
  )
}
