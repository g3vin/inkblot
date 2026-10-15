/**
 * MapSurface.jsx — one open map: the drawing, the tools, the panels.
 *
 * Owns the document (useMapDocument), the view (useMapViewport), what is selected,
 * the tool in hand, the drawing in progress and the story day. Everything drawn is
 * MapLayers; this file is how pointer and keyboard turn into edits.
 *
 * Pointer model, the one every map app has taught people: dragging the map moves it,
 * clicking does what the tool does. A press on an item selects it, and dragging a
 * pin or a label moves that instead. So there is no separate hand tool to reach for —
 * though `pan` exists for a trackpad-less mouse and for the space bar.
 */
import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { documentSurface } from '../bridge'
import { getDocDisplayName, isMapDoc, MAP_SUFFIX } from '../lib/docKind'
import { isCharacterDoc } from '../lib/storyStructure'
import { createProjector } from '../lib/map/mapProjection'
import { projectedEarth } from '../lib/map/earthData'
import { createSpace, resolvePin } from '../lib/map/mapSpace'
import { buildSchedules, mapConflicts, timelineExtent } from '../lib/map/timeline'
import { createEmptyMap, makePin, mapDocRefs, newId, normalizeMap, pinLabel, rewriteMapDocRefs } from '../lib/map/mapModel'
import { isItemLocked } from '../lib/map/mapVisibility'
import { eventDay } from './inspector/whenSections'
import { geoJSONToItems, IMPORT_KINDS, readGeoFile } from '../lib/map/geoInterchange'
import { MAP_FIND_EVENT } from '../lib/sidebarSearch'
import MapSearch from './MapSearch'
import { forgetAncestry, loadAncestry, trailFor } from '../lib/map/mapAncestry'
import Breadcrumb from '../ui/Breadcrumb.jsx'
import { saveMapDocument } from '../lib/map/mapFileSystem'
import { surfaceForBody } from '../lib/map/planetPresets'
import { presetSystem } from '../lib/map/systemPresets'
import { starFields, starPreset } from '../lib/map/stars'
import { random, seedOf } from '../lib/map/seeded'
import { defaultTerrainEntries } from '../lib/map/terrains'
import { IMAGE_EXTENSIONS_LIST, MODEL_EXTENSIONS_LIST, importAssetFromPath } from '../lib/assets'
import { announceProjectFiles } from '../lib/projectFiles'
import { MAP_DOC_MOVED_EVENT } from '../lib/map/mapLinks'
import { panMapBy, pointsBounds } from '../lib/map/mapViewport'
import { nearestOnPolyline } from '../lib/map/mapGeometry'
import MapLayers, { MapDefs } from './MapLayers'
import { earthLevelFor } from './mapRender'
import { MAP_TOOLS, TOOL_HINTS, formatZoom } from './mapOptions'
import MapPanelView from './MapPanelView'
import Icon from '../ui/Icon.jsx'
import { useInspectorOpen } from '../lib/inspectorPresence'
import { useMapPanel } from './inspector/useMapPanel'
import { runPanelCommand } from './inspector/panelBuilder'
import MapTimeline from './MapTimeline'
import MapSetup from './MapSetup'
import MapChrome from './MapChrome'
import { useVisibleBox } from './useVisibleBox'
import MapHoverCard from './MapHoverCard'
import MapDraft from './MapDraft'
import { useMapDocument } from './useMapDocument'
import { useMapViewport } from './useMapViewport'
import { useGlobeView } from './useGlobeView'
import { useSpaceView } from './useSpaceView'
import { useProjectDocs, useStoryCalendar } from './useMapProject'
import { useStoryTimeline } from '../timeline/useStoryTimeline'
import { eventCovers, setEventTime } from '../lib/timeline/timelineModel'
import { getStoryCursor, setStoryDay, subscribeStoryCursor } from '../lib/timeline/storyCursor'
import { peekStoryTimeline, replaceStoryTimeline } from '../lib/timeline/timelineStore'
import { MAP_SET_LEG_EVENT } from '../lib/timeline/journeys'
import { openStoryCalendarSettings } from '../lib/map/storyCalendarStore'
import ExportMapDialog from './ExportMapDialog'
import OnlineMapsDialog from './OnlineMapsDialog'
import { choosesOnline, viewMenuFor, viewOptionEdit } from './mapViewMenu'
import { readOnlineMaps, saveOnlineMaps } from '../lib/map/onlineMaps'
import { useMapCommands } from './useMapCommands'
import {
  MAP_COMMAND_EVENT,
  MAP_DROP_DOC_EVENT,
  MAP_RESTORE_EVENT,
  MAP_REVEAL_EVENT,
  registerMapSurface,
  takePendingMapReveal,
} from './mapEvents'

/** Screen pixels a press may wander before it becomes a drag. */
const DRAG_THRESHOLD = 4
/** Two clicks this close in time and space finish a drawing. */
const DOUBLE_CLICK_MS = 320
/** How near (screen px) a click must be to a pin to snap a route stop to it. */
const SNAP_PX = 14

// MapLibre and the globe: loaded the first time a map is shown as a globe.
/** The breadcrumb's glyph for each kind of map. */
const MAP_KIND_ICONS = { earth: 'globe', planet: 'world', system: 'orbit', galaxy: 'galaxy', universe: 'universe', model: 'model' }

const GlobeView = lazy(() => import('./GlobeView'))
const SpaceView = lazy(() => import('./space/SpaceView'))
const PlanetView = lazy(() => import('./space/PlanetView'))

const DRAWING_TOOLS = new Set(['route', 'region', 'ruler', 'area', 'calibrate'])

const TOOL_IDS = new Set([...MAP_TOOLS.map((option) => option.id), 'pan', 'calibrate'])

const round = (value) => Math.round(value * 1e6) / 1e6
const roundPoint = (point) => (point ? [round(point[0]), round(point[1])] : null)

export default function MapSurface({
  projectName,
  docPath,
  initialMap,
  initialViewport,
  onActivate,
  onOpenDoc,
  isActive = true,
  chromeWhileInactive = false,
  locked = false,
}) {
  const idPrefix = `map${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const [day, setDay] = useState(() => initialMap.timeline?.day || 0)
  const dayRef = useRef(day)
  const [tool, setTool] = useState('select')
  const [selection, setSelection] = useState(null)
  const [draft, setDraft] = useState(null)
  const [hover, setHover] = useState(null)
  const [focusBody, setFocusBody] = useState(null)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  // Under a shell that draws the inspector, asking for it is a count it watches.
  const [revealPanel, setRevealPanel] = useState(0)
  const showInspector = useCallback(() => {
    setInspectorOpen(true)
    setRevealPanel((count) => count + 1)
  }, [])
  const [renameRequest, setRenameRequest] = useState(0)
  const [isPanning, setIsPanning] = useState(false)
  const [calibration, setCalibration] = useState(null)
  const endCalibration = useCallback(() => setCalibration(null), [])
  const [exportOpen, setExportOpen] = useState(false)
  // A View choice that fetches online, waiting for the writer to allow online maps.
  const [onlineAsk, setOnlineAsk] = useState(null)
  // Walking about inside a model (SpaceView), and anything the view needs to say.
  const [lookAround, setLookAround] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [notice, setNotice] = useState(null)

  // The Earth as a globe is drawn by MapLibre, and moved by it; a star system in 3D
  // by three.js; every other map (and either laid flat) by the SVG view. All three
  // answer to the same calls. A map has one camera, the globe's or the scene's.
  const [globeFailed, setGlobeFailed] = useState(false)
  const [spaceFailed, setSpaceFailed] = useState(false)
  const wantsGlobe = initialMap.mapKind === 'earth'
  const wantsSpace = ['system', 'planet', 'galaxy', 'universe', 'model'].includes(initialMap.mapKind)
  const flatView = useMapViewport({ initialViewport, onViewportChange: () => saveViewRef.current?.(), enabled: true })
  const cameraRef = useRef(initialMap.camera || null)
  const onCameraChange = (camera) => {
    cameraRef.current = camera
    saveViewRef.current?.()
  }
  const globeView = useGlobeView({
    surfaceRef: flatView.surfaceRef,
    initialCamera: wantsGlobe ? initialMap.camera : null,
    onCameraChange,
    enabled: wantsGlobe,
  })
  const fitAllRef = useRef(null)
  const spaceView = useSpaceView({
    surfaceRef: flatView.surfaceRef,
    initialCamera: wantsSpace ? initialMap.camera : null,
    onCameraChange,
    onReady: () => fitAllRef.current?.(),
    enabled: wantsSpace,
  })
  const { map, mapRef, dispatch, undo, redo, saveView, saveNow, canUndo, canRedo } = useMapDocument({
    projectName,
    docPath,
    initialMap,
    viewportRef: flatView.viewportRef,
    dayRef,
    cameraRef,
    locked,
  })
  const isGlobe = map.mapKind === 'earth' && map.earth.view === 'globe' && !globeFailed
  const isPlanet = map.mapKind === 'planet' && !spaceFailed
  const isDeepSpace = (map.mapKind === 'galaxy' || map.mapKind === 'universe' || map.mapKind === 'model') && !spaceFailed
  const isSpace = (map.mapKind === 'system' && map.system.display.view === '3d' && !spaceFailed) || isPlanet || isDeepSpace
  const view = isGlobe ? globeView : isSpace ? spaceView : flatView
  const viewKind = isGlobe ? 'globe' : isPlanet ? 'planet' : isSpace ? 'space' : 'flat'
  const box = useVisibleBox(view.surfaceRef)
  const saveViewRef = useRef(saveView)
  useEffect(() => {
    saveViewRef.current = saveView
  }, [saveView])

  const docs = useProjectDocs(projectName)
  const [calendar] = useStoryCalendar(projectName)
  const openCalendar = useCallback(() => openStoryCalendarSettings(projectName), [projectName])

  /* ---------------- derived ---------------- */

  const isSystem = map.mapKind === 'system'
  // The frame (where AU land on the page) moves with the day only while it follows a
  // body. Otherwise it holds still through playback, and so does every layer drawn in
  // it: only the bodies, and what rides on them, move.
  const frameDay = isSystem && focusBody ? day : 0
  const flatProjector = useMemo(
    () => createProjector(map, { day: frameDay, focusBody }),
    // The projector depends only on the parts of the map that decide the drawing's frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map.mapKind, map.earth, map.system, map.background.width, map.background.height, frameDay, focusBody]
  )
  // A planet's projector says so: its regions and routes are painted on the world.
  const planetProjector = useMemo(() => ({ ...spaceView.projector, kind: 'planet' }), [spaceView.projector])
  const projector = isGlobe ? globeView.projector : isPlanet ? planetProjector : isSpace ? spaceView.projector : flatProjector
  // A space reads only its kind, its scale and its bodies: an edit to a pin keeps it,
  // and with it the orbital positions it has cached.
  const space = useMemo(
    () => createSpace(map),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map.mapKind, map.scale, map.system]
  )
  const positions = useMemo(() => (isSystem ? space.positionsAt(day) : null), [day, isSystem, space])
  // While a pin or a handle is dragged the map changes every frame; journeys and their
  // conflicts are worked out again when it is let go, not sixty times a second.
  const [draggedFrom, setDraggedFrom] = useState(null)
  const scheduleMap = draggedFrom || map
  const schedules = useMemo(() => buildSchedules(scheduleMap, space), [scheduleMap, space])
  const conflicts = useMemo(() => mapConflicts(scheduleMap, space, docPath), [scheduleMap, space, docPath])
  const extent = useMemo(() => timelineExtent(schedules, day), [schedules, day])
  const missingDocs = useMemo(() => {
    if (!docs.loaded) return null
    const missing = new Set()
    for (const item of [...map.pins, ...map.travelers]) {
      if (item.doc && !docs.paths.has(item.doc)) missing.add(item.doc)
    }
    return missing
  }, [docs.loaded, docs.paths, map.pins, map.travelers])
  const earthLevel = map.mapKind === 'earth' && !isGlobe ? earthLevelFor(map.earth, view.settledZoom) : '110m'
  // Drawing the 50m Earth is one long task. Headed that way, do it while the map is
  // idle, so arriving at the zoom that shows it is a cache hit, not a stall.
  const warmFineEarth = map.mapKind === 'earth' && earthLevel === '110m' && earthLevelFor(map.earth, 2.5) === '50m' && view.settledZoom >= 1.6
  useEffect(() => {
    if (!warmFineEarth) return undefined
    const timer = window.setTimeout(() => { projectedEarth(projector, '50m') }, 300)
    return () => window.clearTimeout(timer)
  }, [projector, warmFineEarth])
  const selectedItem = useMemo(() => {
    if (!selection) return null
    const list = selection.kind === 'body' ? map.system.bodies : map[`${selection.kind}s`]
    return Array.isArray(list) ? list.find((item) => item.id === selection.id) || null : null
  }, [map, selection])

  useEffect(() => {
    dayRef.current = day
  }, [day])

  // A selection whose item was deleted (or undone away) lets go.
  useEffect(() => {
    if (selection && !selectedItem) setSelection(null)
  }, [selection, selectedItem])

  /* ---------------- coordinates ---------------- */

  const storedAt = useCallback(
    (clientX, clientY) => {
      const world = view.screenToWorldAt(clientX, clientY)
      return roundPoint(projector.fromWorld([world.x, world.y]))
    },
    [projector, view]
  )

  const screenOf = useCallback(
    (stored) => {
      const world = projector.toWorld(stored)
      if (!world) return null
      const v = view.viewportRef.current
      return { x: (world[0] - v.x) * v.zoom, y: (world[1] - v.y) * v.zoom }
    },
    [projector, view.viewportRef]
  )

  /** The pin within SNAP_PX of a client point, for snapping route stops. */
  const pinNear = useCallback(
    (clientX, clientY) => {
      const local = view.toSurfacePoint(clientX, clientY)
      let best = null
      for (const pin of map.pins) {
        const at = screenOf(resolvePin(map, space, pin, day))
        if (!at) continue
        const distance = Math.hypot(at.x - local.x, at.y - local.y)
        if (distance <= SNAP_PX && (!best || distance < best.distance)) best = { pin, distance }
      }
      return best?.pin || null
    },
    [day, map, screenOf, space, view]
  )

  /* ---------------- how the map is shown (the View menu) ---------------- */

  const viewMenu = useMemo(() => viewMenuFor(map, { globeAvailable: !globeFailed, spaceAvailable: !spaceFailed, lookAround }), [globeFailed, lookAround, map, spaceFailed])
  const applyViewOption = useCallback(
    (id, { allowed = false } = {}) => {
      if (id === 'model.look') {
        setLookAround((on) => !on)
        return
      }
      const current = mapRef.current
      const edit = viewOptionEdit(current, id)
      if (!edit) return
      if (!allowed && choosesOnline(current, id) && !readOnlineMaps().enabled) {
        setOnlineAsk(id)
        return
      }
      dispatch({ type: 'section/patch', section: edit.section, patch: edit.patch })
    },
    [dispatch, mapRef]
  )
  const allowOnline = useCallback(() => {
    saveOnlineMaps({ enabled: true })
    const id = onlineAsk
    setOnlineAsk(null)
    if (id) applyViewOption(id, { allowed: true })
  }, [applyViewOption, onlineAsk])

  /* ---------------- fitting ---------------- */

  const fitAll = useCallback(() => {
    if (view.fitStored) {
      const stored = map.pins.map((pin) => resolvePin(map, space, pin, day))
      for (const region of map.regions) for (const ring of region.rings) stored.push(...ring)
      view.fitStored(stored)
      return
    }
    const points = []
    for (const pin of map.pins) points.push(projector.toWorld(resolvePin(map, space, pin, day)))
    for (const region of map.regions) for (const ring of region.rings) for (const point of ring) points.push(projector.toWorld(point))
    const content = pointsBounds(points)
    const frame = projector.bounds
    // The whole sheet or world when there is little on it; the content when there is.
    const useContent = content && content.width > frame.width * 0.05 && map.mapKind !== 'blank' && map.mapKind !== 'image'
    view.fitTo(useContent ? content : frame, 40)
  }, [day, map, projector, space, view])

  useEffect(() => {
    fitAllRef.current = fitAll
  }, [fitAll])

  const didInitialFit = useRef(false)
  useEffect(() => {
    if (didInitialFit.current) return
    didInitialFit.current = true
    const v = initialViewport
    // A map never viewed before opens framed rather than at the world's corner.
    if (!v || (v.x === 0 && v.y === 0 && v.zoom === 1)) requestAnimationFrame(() => fitAll())
  }, [fitAll, initialViewport])

  // Laid flat from the globe or the 3D view, the map is framed afresh: the flat
  // view's last framing belongs to a projection it may no longer have.
  const lastViewKind = useRef(viewKind)
  useEffect(() => {
    if (lastViewKind.current === viewKind) return
    lastViewKind.current = viewKind
    if (viewKind === 'flat') requestAnimationFrame(() => fitAll())
  }, [fitAll, viewKind])

  /* ---------------- editing helpers ---------------- */

  const select = useCallback((kind, id) => setSelection(kind && id ? { kind, id } : null), [])

  const addItem = useCallback(
    (collection, item, kind) => {
      dispatch({ type: 'items/add', collection, items: [item] })
      if (kind) select(kind, item.id)
      return item
    },
    [dispatch, select]
  )

  const patchItem = useCallback(
    (collection, id, patch, coalesce) => {
      dispatch({ type: 'items/patch', collection, patches: { [id]: patch }, meta: coalesce ? { coalesce } : undefined })
    },
    [dispatch]
  )

  const removeSelection = useCallback(() => {
    if (!selection) return
    if (selection.kind === 'body') {
      const bodies = map.system.bodies.filter((body) => body.id !== selection.id && body.parent !== selection.id)
      dispatch({ type: 'section/patch', section: 'system', patch: { bodies } })
    } else {
      dispatch({ type: 'items/remove', collection: `${selection.kind}s`, ids: [selection.id] })
    }
    setSelection(null)
  }, [dispatch, map.system.bodies, selection])

  const zoomNow = useCallback(() => view.viewportRef.current.zoom, [view.viewportRef])
  const labelSizeNow = useCallback(() => Math.round((18 / view.viewportRef.current.zoom) * 100) / 100, [view.viewportRef])

  /* ---------------- drafts (drawing with the route, region and measuring tools) ---------------- */

  const finishDraft = useCallback(() => {
    setDraft((current) => {
      if (!current) return null
      if (current.tool === 'route' && current.nodes.length >= 2) {
        const route = {
          id: newId(),
          name: null,
          nodes: current.nodes,
          smooth: 'catmullRom',
          style: { stroke: null, width: 2.5, dash: 'solid', arrow: false },
        }
        dispatch({ type: 'items/add', collection: 'routes', items: [route] })
        setSelection({ kind: 'route', id: route.id })
        return null
      }
      if (current.tool === 'region' && current.nodes.length >= 3) {
        const region = {
          id: newId(),
          name: null,
          rings: [current.nodes.map((node) => node.at)],
          terrain: null,
          fill: null,
          hatch: 'none',
          stroke: null,
        }
        dispatch({ type: 'items/add', collection: 'regions', items: [region] })
        setSelection({ kind: 'region', id: region.id })
        return null
      }
      if (current.tool === 'ruler' || current.tool === 'area') return { ...current, done: true }
      return null
    })
  }, [dispatch])

  const addDraftPoint = useCallback(
    (clientX, clientY) => {
      const snapped = tool === 'route' ? pinNear(clientX, clientY) : null
      const node = snapped ? { pin: snapped.id } : { at: storedAt(clientX, clientY) }
      const at = snapped ? resolvePin(map, space, snapped, day) : node.at
      if (!at) return
      setDraft((current) => {
        // A finished measurement is replaced by a new one on the next click.
        const base = current && current.tool === tool && !current.done ? current : { tool, nodes: [] }
        const nodes = [...base.nodes, { ...node, at }]
        if (tool === 'calibrate' && nodes.length === 2) {
          setCalibration({ a: nodes[0].at, b: nodes[1].at })
          return null
        }
        return { ...base, nodes }
      })
    },
    [day, map, pinNear, space, storedAt, tool]
  )

  useEffect(() => {
    setDraft(null)
  }, [tool])

  /* ---------------- pointer ---------------- */

  const lastClickRef = useRef({ time: 0, x: 0, y: 0 })
  const spaceHeldRef = useRef(false)

  // Ends a drag still in progress if the surface goes away mid-drag (the pane closed,
  // the document switched): its window listeners would otherwise outlive it, holding
  // the old map, until the next pointerup anywhere.
  const endDragRef = useRef(null)
  useEffect(() => () => endDragRef.current?.(), [])

  const onPointerDown = useCallback(
    (event) => {
      if (event.target.closest('.map-floating, .map-setup, button, input, select, textarea')) return
      onActivate?.()
      event.currentTarget.focus({ preventScroll: true })
      if (event.button !== 0 && event.button !== 1) return

      const startX = event.clientX
      const startY = event.clientY
      const itemEl = event.target.closest('[data-map-item]')
      const handleEl = event.target.closest('[data-map-handle]')
      const forcePan = event.button === 1 || tool === 'pan' || spaceHeldRef.current
      // On the globe, regions and routes are drawn by MapLibre: asked for, not found in the DOM.
      const picked = itemEl
        ? { id: itemEl.getAttribute('data-map-item'), kind: itemEl.getAttribute('data-map-kind') }
        : !handleEl && view.pick ? view.pick(startX, startY) : null
      // What is on a locked layer stays put: a press there pans, as on empty ground.
      const item = picked && !isItemLocked(map, picked.kind, picked.id) ? picked : null

      // What a drag will do, decided at the press.
      let dragKind = 'pan'
      let dragTarget = null
      if (!forcePan && handleEl) {
        dragKind = 'handle'
        dragTarget = {
          owner: handleEl.getAttribute('data-map-handle-owner'),
          ownerKind: handleEl.getAttribute('data-map-handle-kind'),
          index: Number(handleEl.getAttribute('data-map-handle')),
          midpoint: handleEl.hasAttribute('data-map-midpoint'),
        }
      } else if (!forcePan && item && !DRAWING_TOOLS.has(tool)) {
        if (item.kind === 'pin' || item.kind === 'label' || item.kind === 'traveler' || item.kind === 'body') select(item.kind, item.id)
        else if (item.kind === 'route' || item.kind === 'region') select(item.kind, item.id)
        const pin = item.kind === 'pin' ? map.pins.find((candidate) => candidate.id === item.id) : null
        const label = item.kind === 'label' ? map.labels.find((candidate) => candidate.id === item.id) : null
        if ((pin && pin.at && !pin.body) || (label && label.at)) {
          dragKind = 'move'
          dragTarget = item
        }
      }

      let moved = false
      let lastX = startX
      let lastY = startY
      let frame = 0
      let pending = null
      let inserted = false

      const flush = () => {
        frame = 0
        if (!pending) return
        const { clientX, clientY } = pending
        pending = null
        const at = storedAt(clientX, clientY)
        if (!at) return
        if (dragKind === 'move') {
          const collection = dragTarget.kind === 'pin' ? 'pins' : 'labels'
          patchItem(collection, dragTarget.id, { at }, `move-${dragTarget.id}`)
        } else if (dragKind === 'handle') {
          const current = mapRef.current
          if (dragTarget.ownerKind === 'route') {
            const route = current.routes.find((candidate) => candidate.id === dragTarget.owner)
            if (!route) return
            const nodes = [...route.nodes]
            if (dragTarget.midpoint && !inserted) {
              nodes.splice(dragTarget.index + 1, 0, { at })
              inserted = true
              dragTarget = { ...dragTarget, index: dragTarget.index + 1, midpoint: false }
            } else {
              const snapped = pinNear(clientX, clientY)
              nodes[dragTarget.index] = snapped ? { pin: snapped.id } : { at }
            }
            patchItem('routes', route.id, { nodes }, `handle-${route.id}`)
          } else if (dragTarget.ownerKind === 'region') {
            const region = current.regions.find((candidate) => candidate.id === dragTarget.owner)
            if (!region) return
            const ring = [...region.rings[0]]
            if (dragTarget.midpoint && !inserted) {
              ring.splice(dragTarget.index + 1, 0, at)
              inserted = true
              dragTarget = { ...dragTarget, index: dragTarget.index + 1, midpoint: false }
            } else {
              ring[dragTarget.index] = at
            }
            patchItem('regions', region.id, { rings: [ring, ...region.rings.slice(1)] }, `handle-${region.id}`)
          }
        }
      }

      const onMove = (moveEvent) => {
        if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD) return
        if (!moved) {
          moved = true
          if (dragKind === 'pan') setIsPanning(true)
          else setDraggedFrom(mapRef.current)
        }
        if (dragKind === 'pan') {
          // The globe pans itself.
          if (!view.native) view.applyViewport(panMapBy(view.viewportRef.current, moveEvent.clientX - lastX, moveEvent.clientY - lastY))
          lastX = moveEvent.clientX
          lastY = moveEvent.clientY
          return
        }
        pending = { clientX: moveEvent.clientX, clientY: moveEvent.clientY }
        if (!frame) frame = requestAnimationFrame(flush)
      }

      const onUp = (upEvent) => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        endDragRef.current = null
        if (frame) cancelAnimationFrame(frame)
        if (moved) {
          if (pending) flush()
          setIsPanning(false)
          setDraggedFrom(null)
          return
        }
        if (forcePan || handleEl) return

        const now = performance.now()
        const last = lastClickRef.current
        const isDouble = now - last.time < DOUBLE_CLICK_MS && Math.hypot(upEvent.clientX - last.x, upEvent.clientY - last.y) < 6
        lastClickRef.current = { time: now, x: upEvent.clientX, y: upEvent.clientY }

        if (DRAWING_TOOLS.has(tool)) {
          if (isDouble) finishDraft()
          else addDraftPoint(upEvent.clientX, upEvent.clientY)
          return
        }
        if (item) return
        if (tool === 'pin') {
          const at = storedAt(upEvent.clientX, upEvent.clientY)
          if (at) addItem('pins', makePin({ at }), 'pin')
          return
        }
        if (tool === 'label') {
          const at = storedAt(upEvent.clientX, upEvent.clientY)
          if (!at) return
          addItem('labels', {
            id: newId(), text: 'New label', at, route: null, path: null, startOffset: 0.5,
            size: labelSizeNow(), rotation: 0, font: 'serif', minZoom: 0, maxZoom: null,
          }, 'label')
          showInspector()
          setRenameRequest((count) => count + 1)
          return
        }
        setSelection(null)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      endDragRef.current = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        if (frame) cancelAnimationFrame(frame)
        setDraggedFrom(null)
        endDragRef.current = null
      }
    },
    [addDraftPoint, addItem, finishDraft, labelSizeNow, map, mapRef, onActivate, patchItem, pinNear, select, showInspector, storedAt, tool, view]
  )

  const onDoubleClick = useCallback(
    (event) => {
      if (DRAWING_TOOLS.has(tool)) return
      const itemEl = event.target.closest('[data-map-item]')
      const picked = itemEl ? { kind: itemEl.getAttribute('data-map-kind'), id: itemEl.getAttribute('data-map-item') } : view.pick?.(event.clientX, event.clientY)
      if (!picked) return
      const { kind, id } = picked
      if (kind === 'pin') {
        const pin = map.pins.find((candidate) => candidate.id === id)
        if (pin?.doc && docs.paths.has(pin.doc)) onOpenDoc?.(pin.doc)
        else {
          showInspector()
          setRenameRequest((count) => count + 1)
        }
      } else if (kind === 'traveler') {
        const traveler = map.travelers.find((candidate) => candidate.id === id)
        if (traveler?.doc && docs.paths.has(traveler.doc)) onOpenDoc?.(traveler.doc)
      } else if (kind === 'body') {
        setFocusBody((current) => (current === id ? null : id))
      } else if (kind === 'route' && tool === 'select') {
        // Double-clicking a route adds a stop there.
        const route = map.routes.find((candidate) => candidate.id === id)
        if (!route) return
        const at = storedAt(event.clientX, event.clientY)
        const stops = route.nodes.map((node) => (node.pin ? resolvePin(map, space, map.pins.find((pin) => pin.id === node.pin), day) : node.at))
        const nearest = nearestOnPolyline(stops, at)
        if (!nearest) return
        const nodes = [...route.nodes]
        nodes.splice(nearest.index + 1, 0, { at })
        patchItem('routes', route.id, { nodes })
      } else {
        showInspector()
        setRenameRequest((count) => count + 1)
      }
    },
    [day, docs.paths, map, onOpenDoc, patchItem, showInspector, space, storedAt, tool, view]
  )

  /* ---------------- hover ---------------- */

  const rubberRef = useRef(null)
  const onPointerMove = useCallback(
    (event) => {
      if (draft && !draft.done && rubberRef.current) {
        const world = view.screenToWorldAt(event.clientX, event.clientY)
        const last = draft.nodes[draft.nodes.length - 1]
        const lastWorld = last ? projector.toWorld(last.at) : null
        if (lastWorld) rubberRef.current.setAttribute('d', `M${lastWorld[0]} ${lastWorld[1]}L${world.x} ${world.y}`)
      }
      const itemEl = event.target.closest?.('[data-map-item]')
      const kind = itemEl?.getAttribute('data-map-kind')
      if ((kind === 'pin' || kind === 'traveler') && event.buttons === 0) {
        const id = itemEl.getAttribute('data-map-item')
        const local = view.toSurfacePoint(event.clientX, event.clientY)
        setHover((current) => (current?.id === id ? current : { id, kind, x: local.x, y: local.y }))
      } else if (hover) {
        setHover(null)
      }
    },
    [draft, hover, projector, view]
  )

  /* ---------------- keyboard ---------------- */

  const onKeyDown = useCallback(
    (event) => {
      if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (mod && event.key === '0') {
        event.preventDefault()
        fitAll()
        return
      }
      if (mod) return
      if (event.key === ' ') {
        spaceHeldRef.current = true
        return
      }
      if (event.key === 'Escape') {
        if (draft) setDraft(null)
        else if (selection) setSelection(null)
        else setTool('select')
        return
      }
      if (event.key === 'Enter' && draft) {
        event.preventDefault()
        finishDraft()
        return
      }
      if ((event.key === 'Backspace' || event.key === 'Delete')) {
        event.preventDefault()
        if (draft && !draft.done) setDraft({ ...draft, nodes: draft.nodes.slice(0, -1) })
        else removeSelection()
        return
      }
      const shortcuts = { v: 'select', h: 'pan', p: 'pin', r: 'route', g: 'region', t: 'label', m: 'ruler', a: 'area' }
      const next = shortcuts[event.key.toLowerCase()]
      if (next) setTool(next)
    },
    [draft, finishDraft, fitAll, redo, removeSelection, selection, undo]
  )

  const onKeyUp = useCallback((event) => {
    if (event.key === ' ') spaceHeldRef.current = false
  }, [])

  /* ---------------- events from the rest of the app ---------------- */

  useEffect(() => registerMapSurface(view.surfaceRef.current), [view.surfaceRef])

  const reveal = useCallback(
    (itemId) => {
      const current = mapRef.current
      for (const [kind, list] of [['pin', current.pins], ['route', current.routes], ['region', current.regions], ['label', current.labels], ['traveler', current.travelers]]) {
        const item = list.find((candidate) => candidate.id === itemId)
        if (!item) continue
        setSelection({ kind, id: itemId })
        showInspector()
        let point = null
        if (kind === 'pin') point = resolvePin(current, space, item, day)
        else if (kind === 'label') point = item.at || item.path?.[0] || null
        else if (kind === 'region') point = item.rings[0]?.[0] || null
        else if (kind === 'route') {
          const node = item.nodes[Math.floor(item.nodes.length / 2)]
          point = node?.pin ? resolvePin(current, space, current.pins.find((pin) => pin.id === node.pin), day) : node?.at
        }
        if (point && view.centerOnStored) {
          view.centerOnStored(point)
          return
        }
        const world = point ? projector.toWorld(point) : null
        if (world) view.centerOn(world[0], world[1])
        return
      }
    },
    [day, mapRef, projector, showInspector, space, view]
  )

  useEffect(() => {
    const pending = takePendingMapReveal(docPath)
    if (pending) requestAnimationFrame(() => reveal(pending))
    const onReveal = (event) => {
      if (event.detail?.docPath !== docPath) return
      takePendingMapReveal(docPath)
      reveal(event.detail.itemId)
    }
    const onRestore = (event) => {
      if (event.detail?.docPath !== docPath) return
      dispatch({ type: 'doc/replace', map: normalizeMap(event.detail.map) })
    }
    window.addEventListener(MAP_REVEAL_EVENT, onReveal)
    window.addEventListener(MAP_RESTORE_EVENT, onRestore)
    return () => {
      window.removeEventListener(MAP_REVEAL_EVENT, onReveal)
      window.removeEventListener(MAP_RESTORE_EVENT, onRestore)
    }
  }, [dispatch, docPath, reveal])

  // A linked document renamed or moved elsewhere: follow it here too, or this map's
  // next save would write the old path back over the one mapLinks just fixed.
  useEffect(() => {
    const onMoved = (event) => {
      const { projectName: movedIn, entryPath, nextPath, type } = event.detail || {}
      if (movedIn !== projectName) return
      const { map: next, changed } = rewriteMapDocRefs(mapRef.current, entryPath, nextPath, type)
      if (changed) dispatch({ type: 'doc/replace', map: next, meta: { upkeep: true } })
      void docs.refresh()
    }
    window.addEventListener(MAP_DOC_MOVED_EVENT, onMoved)
    return () => window.removeEventListener(MAP_DOC_MOVED_EVENT, onMoved)
  }, [dispatch, docs, mapRef, projectName])

  /** A document dropped from the file tree: a traveller if it is a character, else a pin. */
  const dropDoc = useCallback(
    ({ path, clientX, clientY }) => {
      if (!path || path === docPath) return
      const at = storedAt(clientX, clientY)
      if (!at) return
      onActivate?.()
      const current = mapRef.current
      if (isCharacterDoc(path)) {
        let start = pinNear(clientX, clientY)
        const newPins = []
        if (!start) {
          start = makePin({ at, name: null })
          start.name = `${getDocDisplayName(path)}’s start`
          newPins.push(start)
        }
        if (newPins.length) dispatch({ type: 'items/add', collection: 'pins', items: newPins })
        const traveler = { id: newId(), doc: path, name: null, color: null, startPin: start.id, startDay: Math.floor(day), legs: [] }
        dispatch({ type: 'items/add', collection: 'travelers', items: [traveler] })
        setSelection({ kind: 'traveler', id: traveler.id })
        showInspector()
        return
      }
      // A second drop of the same place moves nothing; it selects the pin already there.
      const existing = current.pins.find((pin) => pin.doc === path)
      if (existing && !isMapDoc(path)) {
        setSelection({ kind: 'pin', id: existing.id })
        return
      }
      const pin = makePin({ at, doc: path, icon: isMapDoc(path) ? 'star' : 'pin' })
      if (current.mapKind === 'system') {
        // On a star system a place is usually somewhere: stick it to the nearest body.
        const world = view.screenToWorldAt(clientX, clientY)
        let best = null
        for (const [id, position] of space.positionsAt(day)) {
          const drawn = projector.toWorld(position)
          const distance = Math.hypot(drawn[0] - world.x, drawn[1] - world.y) * view.viewportRef.current.zoom
          if (distance < 30 && (!best || distance < best.distance)) best = { id, distance }
        }
        if (best) {
          pin.body = best.id
          pin.at = null
        }
      }
      addItem('pins', pin, 'pin')
    },
    [addItem, day, dispatch, docPath, mapRef, onActivate, pinNear, projector, showInspector, space, storedAt, view]
  )

  useEffect(() => {
    const surface = view.surfaceRef.current
    if (!surface) return undefined
    const onDrop = (event) => dropDoc(event.detail || {})
    const onCommand = (event) => {
      const detail = event.detail || {}
      const { command, clientX, clientY, itemId, itemKind } = detail
      if (command === 'zoom-to-fit') fitAll()
      else if (command === 'export') setExportOpen(true)
      else if (command === 'view-option') applyViewOption(String(detail.id || ''))
      /* The window toolbar and the inspector, when the shell draws them (`mapChrome`). */
      else if (command === 'tool') {
        if (TOOL_IDS.has(detail.tool)) setTool(detail.tool)
      } else if (command === 'undo') undo()
      else if (command === 'redo') redo()
      else if (command === 'zoom-in') view.zoomIn()
      else if (command === 'zoom-out') view.zoomOut()
      else if (command === 'delete' && !itemId) removeSelection()
      else if (command === 'panel-tab') panelRef.current.handlers.get('@tab')?.(detail.id)
      else if (command === 'panel-back') panelRef.current.handlers.get('@back')?.()
      else if (command === 'panel-field' || command === 'panel-action') runPanelCommand(panelRef.current.handlers, command, detail)
      else if (command === 'add-pin') {
        const at = storedAt(clientX, clientY)
        if (at) addItem('pins', makePin({ at }), 'pin')
      } else if (command === 'add-label') {
        const at = storedAt(clientX, clientY)
        if (at) addItem('labels', { id: newId(), text: 'New label', at, route: null, path: null, startOffset: 0.5, size: labelSizeNow(), rotation: 0, font: 'serif', minZoom: 0, maxZoom: null }, 'label')
      } else if (itemId && itemKind) {
        setSelection({ kind: itemKind, id: itemId })
        if (command === 'delete') {
          if (itemKind === 'body') {
            const bodies = mapRef.current.system.bodies.filter((body) => body.id !== itemId && body.parent !== itemId)
            dispatch({ type: 'section/patch', section: 'system', patch: { bodies } })
          } else dispatch({ type: 'items/remove', collection: `${itemKind}s`, ids: [itemId] })
        } else if (command === 'open-item') {
          const pin = mapRef.current.pins.find((candidate) => candidate.id === itemId)
          if (pin?.doc) onOpenDoc?.(pin.doc)
        } else {
          showInspector()
          setRenameRequest((count) => count + 1)
        }
      }
    }
    surface.addEventListener(MAP_DROP_DOC_EVENT, onDrop)
    surface.addEventListener(MAP_COMMAND_EVENT, onCommand)
    return () => {
      surface.removeEventListener(MAP_DROP_DOC_EVENT, onDrop)
      surface.removeEventListener(MAP_COMMAND_EVENT, onCommand)
    }
  }, [addItem, applyViewOption, dispatch, dropDoc, fitAll, labelSizeNow, mapRef, onOpenDoc, redo, removeSelection, showInspector, storedAt, undo, view])

  /* ---------------- the day ---------------- */

  // The day is the project's "now" (storyCursor.js): scrubbing here moves every timeline
  // view and every other map, and they move this one.
  const cursorSource = `map:${docPath}`
  const changeDay = useCallback(
    (next) => {
      setDay(next)
      dayRef.current = next
      saveViewRef.current?.()
      setStoryDay(projectName, next, cursorSource)
    },
    [cursorSource, projectName]
  )
  useEffect(() => {
    const follow = (cursor, source) => {
      if (source === cursorSource || !Number.isFinite(cursor.day) || cursor.day === dayRef.current) return
      setDay(cursor.day)
      dayRef.current = cursor.day
    }
    follow(getStoryCursor(projectName), null)
    return subscribeStoryCursor(projectName, follow)
  }, [cursorSource, projectName])

  /* ---------------- the chronology ---------------- */

  // Timeline events placed at this map's pins, drawn while the day is inside them.
  const timeline = useStoryTimeline(projectName)
  const timelineEvents = useMemo(() => {
    if (!timeline) return []
    const laneColor = new Map(timeline.lanes.map((lane) => [lane.id, lane.color]))
    return timeline.events
      .filter((event) => event.place?.map === docPath && eventCovers(event, day))
      .map((event) => ({ id: event.id, title: event.title, pin: event.place.pin, color: event.color || laneColor.get(event.laneId) || null }))
  }, [day, docPath, timeline])

  // A leg moved from a timeline view: this map owns its document, so it makes the edit.
  useEffect(() => {
    const onSetLeg = (event) => {
      const { projectName: from, docPath: target, travelerId, legId, departDay } = event.detail || {}
      if (from !== projectName || target !== docPath) return
      const traveler = mapRef.current.travelers.find((item) => item.id === travelerId)
      if (!traveler?.legs.some((leg) => leg.id === legId)) return
      event.detail.claimed = true
      dispatch({
        type: 'items/patch',
        collection: 'travelers',
        patches: { [travelerId]: { legs: traveler.legs.map((leg) => (leg.id === legId ? { ...leg, departDay } : leg)) } },
      })
    }
    window.addEventListener(MAP_SET_LEG_EVENT, onSetLeg)
    return () => window.removeEventListener(MAP_SET_LEG_EVENT, onSetLeg)
  }, [dispatch, docPath, mapRef, projectName])

  // Places that come and go with an event: when the event moves, so do they.
  useEffect(() => {
    if (!timeline) return
    const events = new Map(timeline.events.map((event) => [event.id, event]))
    for (const collection of ['pins', 'routes', 'regions', 'labels']) {
      const patches = {}
      for (const item of map[collection]) {
        const patch = {}
        for (const [edge, key] of [['from', 'fromEvent'], ['until', 'untilEvent']]) {
          if (!item[key]) continue
          const next = eventDay(events.get(item[key]), edge)
          if (next !== null && next !== item[edge]) patch[edge] = next
        }
        if (Object.keys(patch).length) patches[item.id] = patch
      }
      if (Object.keys(patches).length) dispatch({ type: 'items/patch', collection, patches, meta: { upkeep: true, coalesce: 'follow-events' } })
    }
  }, [dispatch, map, timeline])

  // A leg moved here: events linked to it leave when it now leaves.
  useEffect(() => {
    const current = peekStoryTimeline(projectName)
    if (!current) return
    const departures = new Map()
    for (const schedule of schedules) {
      for (const interval of schedule.intervals) {
        if (interval.kind === 'travel') departures.set(`${schedule.travelerId}|${interval.legId}`, interval.from)
      }
    }
    const moves = []
    for (const event of current.events) {
      for (const link of event.links) {
        if (link.kind !== 'mapLeg' || link.map !== docPath) continue
        const depart = departures.get(`${link.traveler}|${link.leg}`)
        if (Number.isFinite(depart) && depart !== event.start) moves.push({ id: event.id, depart, length: event.end === null ? null : event.end - event.start })
      }
    }
    if (!moves.length) return
    void replaceStoryTimeline(projectName, (tl) =>
      moves.reduce((acc, move) => setEventTime(acc, move.id, move.depart, move.length === null ? null : move.depart + move.length), tl))
  }, [docPath, projectName, schedules])

  /* ---------------- the inspector ---------------- */

  /*
   * A map of its own for something on this one — a body's surface, a galaxy in a
   * group, a star system in a galaxy: written beside this map, named after the
   * thing, linked from it (`link` patches this map with the new path), saved so the
   * new map finds this one above it, and opened.
   */
  const openLinkedMap = useCallback(async (name, created, link) => {
    const folder = docPath.includes('/') ? docPath.slice(0, docPath.lastIndexOf('/') + 1) : ''
    const base = (name || 'Untitled').replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Untitled'
    let path = `${folder}${base}${MAP_SUFFIX}`
    for (let copy = 2; docs.paths.has(path); copy += 1) path = `${folder}${base} ${copy}${MAP_SUFFIX}`
    if (!(await saveMapDocument(projectName, path, created))) return
    const linked = link(mapRef.current, path)
    dispatch({ type: 'map/patch', patch: linked })
    await saveNow(linked)
    forgetAncestry()
    announceProjectFiles()
    onOpenDoc?.(path)
  }, [dispatch, docPath, docs.paths, mapRef, onOpenDoc, projectName, saveNow])

  /** A body's surface: its planet map, made the first time to look like the body. */
  const openSurface = useCallback(async (body) => {
    if (!body) return
    if (body.surface && docs.paths.has(body.surface)) {
      onOpenDoc?.(body.surface)
      return
    }
    const bodies = new Map(mapRef.current.system.bodies.map((candidate) => [candidate.id, candidate]))
    const world = createEmptyMap('planet', {
      surface: surfaceForBody(body, bodies),
      scale: { kmPerUnit: 1, displayUnit: 'km', calibration: null, customUnits: [] },
      terrains: defaultTerrainEntries(),
      style: { theme: 'night' },
    })
    await openLinkedMap(body.name || 'World', world, (current, path) => ({
      ...current,
      system: { ...current.system, bodies: current.system.bodies.map((candidate) => (candidate.id === body.id ? { ...candidate, surface: path } : candidate)) },
    }))
  }, [docs.paths, mapRef, onOpenDoc, openLinkedMap])

  /**
   * A place in space as a map of its own: a galaxy in a group opens as that galaxy
   * (its type and seed, so it looks as its dot did); a place in a galaxy becomes a
   * star system, its star from the stars of that part of the galaxy.
   */
  const openPinMap = useCallback(async (pin) => {
    const current = mapRef.current
    let created
    if (current.mapKind === 'universe') {
      const look = pin.galaxy || { type: 'Sb', seed: seedOf(pin.id), radiusLy: 50000 }
      created = createEmptyMap('galaxy', {
        galaxy: { type: look.type, seed: look.seed, radiusLy: look.radiusLy || 50000, thicknessLy: 1000 },
        scale: { kmPerUnit: 1, displayUnit: 'ly', calibration: null, customUnits: [] },
        style: { theme: 'night' },
      })
    } else {
      const radius = current.galaxy.radiusLy || 50000
      const out = Math.hypot(pin.at?.[0] || 0, pin.at?.[1] || 0) / radius
      const rand = random(seedOf(pin.id))
      // Near the bulge the stars are old and red; out in the arms, younger and bluer.
      const spectral = out < 0.15 ? ['K5V', 'M2V', 'K3III'][Math.floor(rand() * 3)] : ['G2V', 'K5V', 'M2V', 'F5V', 'M5V'][Math.floor(rand() * 5)]
      const system = presetSystem('lone')
      const preset = starPreset(spectral)
      system.bodies = system.bodies.map((body) => (body.kind === 'star' ? { ...body, name: pin.name || 'Star', massSun: preset.massSun, radiusKm: preset.radiusSun * 695700, star: starFields(preset) } : body))
      created = createEmptyMap('system', {
        system,
        scale: { kmPerUnit: 1, displayUnit: 'AU', calibration: null, customUnits: [] },
        style: { theme: 'night' },
      })
    }
    await openLinkedMap(pin.name || (current.mapKind === 'universe' ? 'Galaxy' : 'Star system'), created, (map, path) => ({
      ...map,
      pins: map.pins.map((candidate) => (candidate.id === pin.id ? { ...candidate, doc: path } : candidate)),
    }))
  }, [mapRef, openLinkedMap])

  const choosePlanetPicture = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({ multiple: false, filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS_LIST }] })
      if (!selected) return
      const texture = await importAssetFromPath(projectName, Array.isArray(selected) ? selected[0] : selected)
      dispatch({ type: 'section/patch', section: 'surface', patch: { look: { ...mapRef.current.surface.look, kind: 'texture', texture } } })
    } catch (error) {
      console.error('[map] could not import the picture:', error)
    }
  }, [dispatch, mapRef, projectName])

  /** Swap a model map's model for another; its places stay where they are. */
  const chooseModel = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({ multiple: false, filters: [{ name: '3D models', extensions: MODEL_EXTENSIONS_LIST }] })
      if (!selected) return
      const asset = await importAssetFromPath(projectName, Array.isArray(selected) ? selected[0] : selected)
      dispatch({ type: 'section/patch', section: 'model', patch: { asset } })
    } catch (error) {
      console.error('[map] could not import the model:', error)
      setNotice(error?.forWriter ? error.message : 'That model could not be imported.')
    }
  }, [dispatch, projectName])

  /** The way the map is being looked at, and the day: what a saved view keeps. */
  const captureView = useCallback(() => {
    const camera = viewKind === 'flat'
      ? { view: 'flat', viewport: { ...flatView.viewportRef.current } }
      : { view: viewKind, ...(viewKind === 'globe' ? globeView.cameraRef.current || globeView.camera : spaceView.cameraRef.current || spaceView.camera) }
    return { camera, day: dayRef.current }
  }, [flatView.viewportRef, globeView, spaceView, viewKind])

  /** Back to a saved view: its day, and its camera when it was taken from this kind of view. */
  const showView = useCallback((saved) => {
    if (Number.isFinite(saved.day)) changeDay(saved.day)
    const camera = saved.camera || {}
    if (camera.view !== viewKind) {
      setNotice('That view was saved from another way of showing this map. Switch back to see it as it was.')
      return
    }
    if (viewKind === 'flat') {
      if (camera.viewport) {
        flatView.applyViewport(camera.viewport)
        saveViewRef.current?.()
      }
    } else view.goTo?.(camera)
  }, [changeDay, flatView, view, viewKind])

  /*
   * Where this map sits: the maps that contain it, outermost first (a galaxy, its
   * system, this world), read from the links between the project's maps.
   */
  const [trail, setTrail] = useState([])
  const mapPathsKey = useMemo(() => docs.docs.map((doc) => doc.path).filter((path) => isMapDoc(path)).sort().join('\n'), [docs.docs])
  const linksKey = useMemo(() => mapDocRefs(map).join('\n'), [map])
  const lastLinksKey = useRef(linksKey)
  useEffect(() => {
    if (!docs.loaded || !mapPathsKey) return undefined
    if (lastLinksKey.current !== linksKey) {
      lastLinksKey.current = linksKey
      forgetAncestry()
    }
    let cancelled = false
    void loadAncestry(projectName, mapPathsKey.split('\n')).then((index) => {
      if (!cancelled) setTrail(trailFor(docPath, index))
    })
    return () => {
      cancelled = true
    }
  }, [docPath, docs.loaded, linksKey, mapPathsKey, projectName])
  const breadcrumb = useMemo(() => trail.map((step) => ({
    id: step.path,
    label: getDocDisplayName(step.path),
    icon: MAP_KIND_ICONS[step.kind] || 'map',
  })), [trail])

  const mapPanel = useMapPanel({
    projectName,
    docPath,
    map,
    dispatch,
    space,
    projector,
    day,
    onDay: changeDay,
    schedules,
    conflicts,
    selection,
    selectedItem,
    onSelect: select,
    docs,
    missingDocs,
    calendar,
    onOpenCalendar: openCalendar,
    onOpenDoc,
    renameRequest,
    onTool: setTool,
    calibration,
    onCalibrationDone: endCalibration,
    focusBody,
    onFocusBody: setFocusBody,
    onReveal: reveal,
    zoomNow,
    viewMenu,
    onViewOption: applyViewOption,
    onOpenSurface: isSystem ? openSurface : null,
    onChoosePlanetPicture: choosePlanetPicture,
    onChooseModel: map.mapKind === 'model' ? chooseModel : null,
    storyEvents: timeline?.events,
    onSaveView: captureView,
    extent,
    onShowView: showView,
    onOpenPinMap: map.mapKind === 'galaxy' || map.mapKind === 'universe' ? openPinMap : null,
  })
  const openExport = useCallback(() => setExportOpen(true), [])

  /* ---------------- find on this map ---------------- */

  useEffect(() => {
    if (!isActive) return undefined
    const open = () => setSearchOpen(true)
    window.addEventListener(MAP_FIND_EVENT, open)
    return () => window.removeEventListener(MAP_FIND_EVENT, open)
  }, [isActive])
  const pickFound = useCallback((hit) => {
    select(hit.kind, hit.id)
    if (view.centerOnStored) view.centerOnStored(hit.at)
    else {
      const world = projector.toWorld(hit.at)
      if (world) view.centerOn(world[0], world[1])
    }
    setSearchOpen(false)
  }, [projector, select, view])
  const goWorld = useCallback((place) => {
    if (view.fitStored) view.fitStored([place.at])
    else {
      const world = projector.toWorld(place.at)
      if (world) view.centerOn(world[0], world[1])
    }
  }, [projector, view])
  const addWorld = useCallback((place) => {
    addItem('pins', makePin({ name: place.name, at: place.at }), 'pin')
  }, [addItem])

  /** Places, routes and regions from a GeoJSON or KML file, added in one step. */
  const importGeo = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({ multiple: false, filters: [{ name: 'GeoJSON or KML', extensions: ['geojson', 'json', 'kml'] }] })
      if (!selected) return
      const path = Array.isArray(selected) ? selected[0] : selected
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      const items = geoJSONToItems(readGeoFile(await readTextFile(path), path), mapRef.current)
      const counts = [[items.pins, 'place'], [items.routes, 'route'], [items.regions, 'region'], [items.labels, 'label']]
        .filter(([list]) => list.length)
        .map(([list, noun]) => `${list.length} ${noun}${list.length === 1 ? '' : 's'}`)
      for (const collection of ['pins', 'routes', 'regions', 'labels']) {
        if (items[collection].length) dispatch({ type: 'items/add', collection, items: items[collection], meta: { coalesce: `import-${path}` } })
      }
      const list = counts.length > 1 ? `${counts.slice(0, -1).join(', ')} and ${counts[counts.length - 1]}` : counts[0]
      setNotice(list ? `Imported ${list}.${items.skipped ? ` ${items.skipped} could not be read.` : ''}` : 'Nothing in that file could be placed on this map.')
      if (list) window.requestAnimationFrame(() => fitAllRef.current?.())
    } catch (error) {
      console.error('[map] could not import:', error)
      setNotice(error?.message || 'That file could not be imported.')
    }
  }, [dispatch, mapRef])

  useMapCommands({
    active: isActive,
    mapKind: map.mapKind,
    setTool,
    zoomIn: view.zoomIn,
    zoomOut: view.zoomOut,
    fitAll,
    hasSelection: Boolean(selection),
    removeSelection,
    openExport,
    importGeo: IMPORT_KINDS.has(map.mapKind) ? importGeo : null,
    openSearch: () => setSearchOpen(true),
    showInspector,
    viewMenu,
    onViewOption: applyViewOption,
    upOneLevel: trail.length > 1 ? () => onOpenDoc?.(trail[trail.length - 2].path) : null,
    openSurface: isSystem && selection?.kind === 'body' && selectedItem ? () => void openSurface(selectedItem) : null,
  })

  // Commands arrive through a listener set up once; they reach the panel as last built.
  const panelRef = useRef(mapPanel)
  useEffect(() => {
    panelRef.current = mapPanel
  })

  /*
   * Under a shell that draws the map's toolbar and inspector (`mapChrome`), the active
   * map publishes them instead of rendering them, and the shell sends every click back
   * as a map command. A map beside a document goes on publishing while the document is
   * worked in (`chromeWhileInactive`), marked not active: the inspector keeps its panel,
   * the toolbar goes back to the document's. Withdrawn when this map stops being the
   * one — the other pane's map became active — or goes away. Only a change is sent:
   * panning re-renders the map on every frame and changes nothing the chrome shows.
   */
  // Always published: the web toolbar draws the map's tools from it too.
  const publishing = isActive || chromeWhileInactive
  useEffect(() => {
    if (!publishing) return undefined
    return () => documentSurface.publishMapChrome({})
  }, [publishing])
  // Runs only when something the chrome shows changed: the panel is memoized, so a
  // pan (which re-renders the map) publishes nothing.
  // On the globe, how far in from the whole Earth (MapLibre zoom levels are doublings).
  const chromeZoom = isGlobe ? 2 ** ((globeView.camera.zoom || 0) - 1.4) : isSpace ? 16 / Math.max(1e-6, spaceView.camera.distance || 16) : view.viewport.zoom
  useEffect(() => {
    if (!publishing) return
    const surfaceId = view.surfaceRef.current?.dataset.surfaceId
    if (!surfaceId) return
    documentSurface.publishMapChrome({
      state: {
        surfaceId,
        docPath,
        tool,
        zoom: chromeZoom,
        zoomLabel: formatZoom(chromeZoom),
        canUndo,
        canRedo,
        hasSelection: Boolean(selection),
        panel: mapPanel.panel,
        revealPanel,
        active: isActive,
        mapKind: map.mapKind,
        viewMenu,
      },
    })
  }, [canRedo, canUndo, chromeZoom, docPath, isActive, map.mapKind, mapPanel.panel, publishing, revealPanel, selection, tool, view.surfaceRef, viewMenu])

  /* ---------------- setup ---------------- */

  const completeSetup = useCallback(
    (patch) => {
      const next = normalizeMap({ ...mapRef.current, ...patch, setupPending: undefined })
      delete next.setupPending
      dispatch({ type: 'doc/replace', map: next, meta: { silent: true } })
      requestAnimationFrame(() => requestAnimationFrame(() => fitAll()))
    },
    [dispatch, fitAll, mapRef]
  )

  // Fit once the setup's new frame has been drawn (fitAll closes over the new projector).
  const lastKindRef = useRef(map.mapKind)
  useEffect(() => {
    if (lastKindRef.current === map.mapKind) return
    lastKindRef.current = map.mapKind
    fitAll()
  }, [fitAll, map.mapKind])

  const hoverItem = hover
    ? hover.kind === 'pin'
      ? map.pins.find((pin) => pin.id === hover.id)
      : map.travelers.find((traveler) => traveler.id === hover.id)
    : null

  const showTimeline = map.travelers.length > 0 || isSystem
  const hint = TOOL_HINTS[tool]
    ? draft?.tool === tool && draft.nodes.length ? TOOL_HINTS[`${tool}-drawing`] || TOOL_HINTS[tool] : TOOL_HINTS[tool]
    : null
  // The map's own floating panel: only while the window's inspector is shut. With it
  // open the panel is the inspector's Map tab (MapInspectorPanel), from what is published.
  const windowInspector = useInspectorOpen()
  const pageInspector = !windowInspector && inspectorOpen

  return (
    <div
      ref={view.surfaceRef}
      className={`map-surface${isPanning ? ' is-panning' : ''}${isActive ? ' is-active' : ''}${isGlobe ? ' is-globe' : ''}${isSpace ? ' is-space' : ''}`}
      data-map-theme={map.style.theme}
      data-tool={tool}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    >
      {isGlobe ? (
        <Suspense fallback={<div className="map-globe is-loading" />}>
          <GlobeView
            view={globeView}
            map={map}
            space={space}
            day={day}
            selection={selection}
            surfaceRef={view.surfaceRef}
            onError={() => setGlobeFailed(true)}
          />
        </Suspense>
      ) : null}
      {isPlanet ? (
        <Suspense fallback={<div className="map-space is-loading" />}>
          <PlanetView
            view={spaceView}
            map={map}
            space={space}
            day={day}
            selection={selection}
            projectName={projectName}
            skySeed={docPath}
            surfaceRef={view.surfaceRef}
            onError={() => setSpaceFailed(true)}
          />
        </Suspense>
      ) : isSpace ? (
        <Suspense fallback={<div className="map-space is-loading" />}>
          <SpaceView
            view={spaceView}
            map={map}
            space={space}
            day={day}
            focusBody={focusBody}
            skySeed={docPath}
            projectName={projectName}
            lookAround={lookAround && map.mapKind === 'model'}
            onError={() => setSpaceFailed(true)}
            onProblem={setNotice}
          />
        </Suspense>
      ) : null}
      {notice ? (
        <div className="map-floating map-notice" role="status">
          <span>{notice}</span>
          <button type="button" className="map-button" onClick={() => setNotice(null)}>OK</button>
        </div>
      ) : null}
      {searchOpen ? (
        <MapSearch
          map={map}
          space={space}
          day={day}
          online={map.mapKind === 'earth' && readOnlineMaps().enabled}
          near={isGlobe ? globeView.camera.center : null}
          onPick={pickFound}
          onGoWorld={goWorld}
          onAddWorld={addWorld}
          onClose={() => {
            setSearchOpen(false)
            view.surfaceRef.current?.focus({ preventScroll: true })
          }}
        />
      ) : null}
      {lookAround && map.mapKind === 'model' ? (
        <div className="map-floating map-notice" role="status">
          <span>Drag to look. W A S D to move, Q and E to go down and up, ⇧ to hurry.</span>
          <button type="button" className="map-button" onClick={() => setLookAround(false)}>Done</button>
        </div>
      ) : null}

      <svg className="map-svg" xmlns="http://www.w3.org/2000/svg">
        <MapDefs idPrefix={idPrefix} />
        {/* A new group when the view changes: the flat view's transform must not stay on the globe's overlay. */}
        <g ref={view.worldRef} key={viewKind}>
          <MapLayers
            map={map}
            projector={projector}
            space={space}
            day={day}
            zoom={view.settledZoom}
            schedules={schedules}
            selection={selection}
            missingDocs={missingDocs}
            projectName={projectName}
            idPrefix={idPrefix}
            earthLevel={earthLevel}
            timelineEvents={timelineEvents}
            positions={positions}
          />
          <MapDraft
            map={map}
            projector={projector}
            space={space}
            day={day}
            draft={draft}
            selection={selection}
            selectedItem={selectedItem}
            rubberRef={rubberRef}
          />
        </g>
      </svg>

      {breadcrumb.length > 1 ? (
        <div className="map-floating map-breadcrumb" style={{ left: `${box.left + 12}px`, top: `${box.top + 12}px` }}>
          <Breadcrumb label="Where this map is" items={breadcrumb} onSelect={(path) => onOpenDoc?.(path)} />
        </div>
      ) : null}

      <MapChrome map={map} projector={projector} space={space} viewport={view.viewport} box={box} bearing={isGlobe ? globeView.camera.bearing : 0} day={day} />

      {!windowInspector && !inspectorOpen ? (
        <button
          type="button"
          className="map-floating map-inspector-toggle"
          title="Show the inspector"
          aria-label="Show the inspector"
          onClick={() => setInspectorOpen(true)}
        >
          <Icon name="sidebar" />
        </button>
      ) : null}

      {hint ? (
        <div
          className="map-floating map-hint"
        >
          {hint}
        </div>
      ) : null}

      {pageInspector ? (
        <MapPanelView panel={mapPanel.panel} handlers={mapPanel.handlers} onClose={() => setInspectorOpen(false)} />
      ) : null}

      {showTimeline ? (
        <MapTimeline
          day={day}
          onDay={changeDay}
          extent={extent}
          calendar={calendar}
          conflicts={conflicts}
          isSystem={isSystem}
          inspectorOpen={pageInspector}
          box={box}
        />
      ) : null}

      {hoverItem && hoverItem.doc && !draft ? (
        <MapHoverCard
          projectName={projectName}
          docPath={hoverItem.doc}
          title={hover.kind === 'pin' ? pinLabel(hoverItem, getDocDisplayName) : hoverItem.name || getDocDisplayName(hoverItem.doc)}
          missing={Boolean(missingDocs?.has(hoverItem.doc))}
          x={hover.x}
          y={hover.y}
        />
      ) : null}

      {exportOpen ? (
        <ExportMapDialog
          open
          onClose={() => setExportOpen(false)}
          map={map}
          projector={projector}
          space={space}
          day={day}
          projectName={projectName}
          docPath={docPath}
          surfaceRef={view.surfaceRef}
          viewportRef={view.viewportRef}
          picture={view.native ? view.picture : null}
        />
      ) : null}

      <OnlineMapsDialog open={Boolean(onlineAsk)} onAllow={allowOnline} onCancel={() => setOnlineAsk(null)} />

      {map.setupPending ? (
        <MapSetup projectName={projectName} docPath={docPath} onDone={completeSetup} />
      ) : null}
    </div>
  )
}
