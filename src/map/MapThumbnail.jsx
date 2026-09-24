/**
 * MapThumbnail.jsx — a whole map, small, drawn by the same MapLayers as the editor.
 *
 * What a map card on a canvas shows. It reads the map from disk when it mounts (like
 * every other preview on a canvas) and draws it framed to fit, on the day the map was
 * left at. Double-clicking the card opens the map.
 */
import { useEffect, useId, useMemo, useState } from 'react'
import { loadMapDocument } from '../lib/map/mapFileSystem'
import { createProjector } from '../lib/map/mapProjection'
import { createSpace } from '../lib/map/mapSpace'
import { buildSchedules } from '../lib/map/timeline'
import MapLayers, { MapDefs } from './MapLayers'
import './Map.css'

export default function MapThumbnail({ projectName, docPath }) {
  const idPrefix = `thumb${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const [state, setState] = useState({ status: 'loading', map: null })

  useEffect(() => {
    let cancelled = false
    loadMapDocument(projectName, docPath).then((loaded) => {
      if (cancelled) return
      if (loaded.foreign || !loaded.map) setState({ status: 'missing', map: null })
      else setState({ status: 'ready', map: loaded.map })
    })
    return () => {
      cancelled = true
    }
  }, [docPath, projectName])

  const drawn = useMemo(() => {
    if (!state.map) return null
    const day = state.map.timeline?.day || 0
    const projector = createProjector(state.map, { day })
    const space = createSpace(state.map)
    return { projector, space, day, schedules: buildSchedules(state.map, space) }
  }, [state.map])

  if (state.status !== 'ready' || !drawn) {
    return <div className="canvas-doc-body canvas-doc-empty">{state.status === 'missing' ? 'Map not found' : ''}</div>
  }

  const { bounds } = drawn.projector
  // Marks keep their pixel size at the thumbnail's scale, which is roughly this.
  const approxZoom = 300 / Math.max(bounds.width, bounds.height)
  return (
    <div className="map-surface map-thumbnail" data-map-theme={state.map.style.theme} style={{ '--map-inv-zoom': 1 / approxZoom, height: '100%', pointerEvents: 'none' }}>
      <svg className="map-svg" viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <MapDefs idPrefix={idPrefix} />
        <MapLayers
          map={state.map}
          projector={drawn.projector}
          space={drawn.space}
          day={drawn.day}
          zoom={approxZoom}
          schedules={drawn.schedules}
          projectName={projectName}
          idPrefix={idPrefix}
          hidePinNames={state.map.pins.length > 12}
        />
      </svg>
    </div>
  )
}
