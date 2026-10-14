/**
 * GlobeView.jsx — the Earth as a globe you can spin and zoom down to a street,
 * drawn by MapLibre. Loaded only when an Earth map is shown as a globe.
 *
 * It draws the ground (sea, land, borders, and online — when the writer has turned it
 * on — satellite photographs, streets and terrain) and the writer's regions and
 * routes. Places, labels, travellers and every handle are the surface's own overlay,
 * drawn through the globe's projector (useGlobeView.js), so they look and behave as on
 * any other map.
 *
 * The style is rebuilt only when what it shows changes (the theme, the imagery, the
 * terrain); regions and routes are new data for their sources, not a new style.
 */
import { useEffect, useMemo, useRef } from 'react'
import { AttributionControl, Map as GLMap, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { loadEarth } from '../lib/map/earthData'
import { buildGlobeStyle, themeColors } from '../lib/map/globeStyle'
import { regionFeatures, routeFeatures } from '../lib/map/globeFeatures'
import { isItemShown } from '../lib/map/mapVisibility'
import { ONLINE_MAPS_CHANGED, readOnlineMaps, satelliteSource } from '../lib/map/onlineMaps'

setWorkerUrl(workerUrl)

const asFeature = (geometry) => (geometry?.type === 'Feature' || geometry?.type === 'FeatureCollection' ? geometry : { type: 'Feature', properties: {}, geometry })

export default function GlobeView({ view, map, space, day, selection, surfaceRef, onError }) {
  const containerRef = useRef(null)
  const glRef = useRef(null)
  const earthRef = useRef(null)

  // Which regions and routes the day shows, as a key: playback changes the features
  // only on the days something appears or goes, not on every tick.
  const shownKey = [...map.regions, ...map.routes].filter((item) => isItemShown(map, item, day)).map((item) => item.id).join(',')
  const regions = useMemo(
    () => regionFeatures(map, selection, day),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map.regions, map.terrains, map.layers, selection, shownKey]
  )
  const routes = useMemo(
    () => routeFeatures(map, space, day, selection),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map.routes, map.pins, map.layers, space, selection, shownKey]
  )
  const itemsRef = useRef({ regions, routes })
  const pushItemsRef = useRef(() => {})
  useEffect(() => {
    itemsRef.current = { regions, routes }
    pushItemsRef.current = () => {
      const gl = glRef.current
      if (!gl) return
      gl.getSource('ib-regions')?.setData(itemsRef.current.regions)
      gl.getSource('ib-routes')?.setData(itemsRef.current.routes)
    }
    pushItemsRef.current()
  }, [regions, routes])

  /* ---------------- the style: what the ground shows ---------------- */

  const styleInputs = `${map.style.theme}|${map.earth.imagery}|${map.earth.terrain3d}|${map.earth.graticule}|${map.earth.borders}|${map.earth.streets !== false}`

  useEffect(() => {
    let cancelled = false
    const apply = async () => {
      const online = readOnlineMaps()
      const [earth, satellite] = await Promise.all([
        earthRef.current || loadEarth('110m'),
        online.enabled && map.earth.imagery !== 'map' ? satelliteSource(online).catch(() => null) : null,
      ])
      if (cancelled) return
      earthRef.current = earth
      const style = buildGlobeStyle({
        earth: map.earth,
        colors: themeColors(surfaceRef.current),
        online: online.enabled,
        satellite,
        land: earth.land,
        borders: asFeature(earth.borders),
        ...itemsRef.current,
      })
      const gl = glRef.current
      if (!gl) return
      gl.setStyle(style, { diff: gl.isStyleLoaded() })
      const terrain = online.enabled && map.earth.terrain3d
      // The writer's items travel in the style itself; terrain waits for its source.
      const whenReady = () => {
        if (cancelled || glRef.current !== gl) return
        if (!gl.getSource('ib-regions')) {
          gl.once('styledata', whenReady)
          return
        }
        gl.setTerrain(terrain && gl.getSource('ib-dem') ? { source: 'ib-dem', exaggeration: 1.4 } : null)
      }
      whenReady()
    }
    void apply()
    const onOnline = () => void apply()
    window.addEventListener(ONLINE_MAPS_CHANGED, onOnline)
    // The clean theme follows the app's light and dark.
    const observer = new MutationObserver(() => void apply())
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      cancelled = true
      window.removeEventListener(ONLINE_MAPS_CHANGED, onOnline)
      observer.disconnect()
    }
    // The style depends on exactly these inputs (styleInputs names them).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleInputs])

  /* ---------------- the globe itself ---------------- */

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined
    const camera = view.cameraRef.current
    let gl
    try {
      gl = new GLMap({
        container,
        style: { version: 8, projection: { type: 'globe' }, sources: {}, layers: [{ id: 'ib-blank', type: 'background', paint: { 'background-color': themeColors(surfaceRef.current).water } }] },
        center: camera.center,
        zoom: camera.zoom,
        bearing: camera.bearing,
        pitch: camera.pitch,
        maxPitch: 75,
        attributionControl: false,
        // The surface's own double-click (open a place, add a route stop) comes first.
        doubleClickZoom: false,
        // Rotating with the right button would fight the surface's context menu.
        dragRotate: true,
        pitchWithRotate: true,
        fadeDuration: 150,
        maxTileCacheZoomLevels: 6,
        cancelPendingTileRequestsWhileZooming: true,
      })
    } catch (error) {
      console.error('[map] the globe could not start:', error)
      onError?.(error)
      return undefined
    }
    gl.addControl(new AttributionControl({ compact: true }), 'bottom-left')
    glRef.current = gl
    const detach = view.attach(gl)
    gl.on('error', (event) => console.warn('[map] globe:', event?.error?.message || event))
    gl.on('webglcontextlost', () => onError?.(new Error('The graphics context was lost.')))
    // The finer coastline, once the globe has drawn: arriving close to a coast is a cache hit.
    gl.once('idle', () => {
      void loadEarth('50m').then((fine) => {
        if (glRef.current !== gl) return
        earthRef.current = fine
        gl.getSource('ib-land')?.setData(fine.land)
        gl.getSource('ib-borders')?.setData(asFeature(fine.borders))
      })
    })
    return () => {
      detach?.()
      view.attach(null)
      glRef.current = null
      gl.remove()
    }
    // One MapLibre per mounted globe; the camera and the attach are read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={containerRef} className="map-globe" aria-hidden="true" />
}
