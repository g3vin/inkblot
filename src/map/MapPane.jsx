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
import { getDocDisplayName } from '../lib/docKind'
import { loadMapDocument } from '../lib/map/mapFileSystem'
import MapSurface from './MapSurface'
import './Map.css'

export default function MapPane({
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
    loadMapDocument(projectName, docPath).then((result) => {
      if (!cancelled) setLoaded(result)
    })
    return () => {
      cancelled = true
    }
  }, [docPath, projectName])

  return (
    <div className="map-pane">
      {showHeader ? (
        <div className="pane-header pane-header-centered">
          <span>{getDocDisplayName(docPath)}</span>
          <button onClick={onClose}>×</button>
        </div>
      ) : null}

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
          projectName={projectName}
          docPath={docPath}
          initialMap={loaded.map}
          initialViewport={loaded.viewport}
          onActivate={onActivate}
          onOpenDoc={onOpenDoc}
          isActive={isActive}
          chromeWhileInactive={chromeWhileInactive}
        />
      ) : (
        <div className="map-surface is-loading" />
      )}
    </div>
  )
}
