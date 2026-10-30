/**
 * TimelineSurface.jsx — one timeline view: the chronology drawn three ways.
 *
 *   time        lanes of events along the calendar, eras behind, map journeys below
 *   sequence    the same lanes, every event one step apart — for a story with few or
 *               no dates, where only the order is known
 *   manuscript  the passages in the order a reader meets them, each joined by a line
 *               to when it happens: a line running backwards is a flashback
 *
 * The events are the project's (useStoryTimeline); this document holds only how they
 * are shown (the view: scale, range, filters), saved as the writer changes it. Every
 * edit goes through commitTimelineEdit — one undo step, seen at once in every other
 * view, highlighted passage, map and canvas card. A drag previews the chronology
 * everywhere and commits on release.
 *
 * Its tools are the card's toolbar (the `timeline` context, toolbar/items/timelineItems):
 * the active view publishes what they show (`timelineChromeChanged`), and they come back
 * as `timelineCommand`s by id. A shell that draws its own toolbar reads the same.
 *
 * A locked view (docLocks.ts) still pans, zooms and filters, but saves none of it, and
 * changes no events: commits, undo and redo are refused, and a drag springs back.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { documentSurface } from '../bridge'
import { getDocDisplayName } from '../lib/docKind'
import { loadProjectMaps } from '../lib/timeline/journeys'
import { loadManuscriptPassages } from '../lib/timeline/manuscript'
import { setStoryDay, setTimeLens } from '../lib/timeline/storyCursor'
import { chronologyExtent, eventById, isDated, layoutChronology, manuscriptThreads, addEvent, removeEvent, shiftEvent, sortedEvents, moveEventBetween, normalizeTimelineView } from '../lib/timeline/timelineModel'
import { commitTimelineEdit } from '../lib/timeline/timelineEdits'
import { TIMELINE_DOC_MOVED_EVENT, movedPath } from '../lib/timeline/timelineLinks'
import { saveTimelineView } from '../lib/timeline/timelineFileSystem'
import { TIMELINE_RANGES_CHANGED_EVENT } from '../lib/timeline/timelineRanges'
import { cancelTimelinePreview, redoStoryTimeline, STORY_TIMELINE_CHANGED_EVENT, timelineHistoryState, undoStoryTimeline } from '../lib/timeline/timelineStore'
import { noteLockedEdit } from '../lib/docLocks'
import { boundViewport, MAX_PX_PER_DAY, MIN_PX_PER_DAY, snapUnit } from '../lib/timeline/timelineScale'
import { requestMapReveal } from '../map/mapEvents'
import MapPanelView from '../map/MapPanelView'
import { useProjectDocs, useStoryCalendar } from '../map/useMapProject'
import { openStoryCalendarSettings } from '../lib/map/storyCalendarStore'
import { requestCanvasReveal } from '../canvas/canvasEvents'
import TimelineAxis from './TimelineAxis'
import TimelineLanes from './TimelineLanes'
import TimelineManuscript from './TimelineManuscript'
import { registerTimelineSurface, TIMELINE_COMMAND_EVENT, TIMELINE_REVEAL_EVENT, takePendingTimelineReveal } from './timelineEvents'
import { useTimelinePanel } from './useTimelinePanel'
import { useStoryCursor, useStoryTimeline } from './useStoryTimeline'
import { requestPassageJump } from './passageJump'
import { GUTTER } from './timelineRows'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
/** ⌘-wheel zoom: how much each px of delta zooms, and the most one event may give. */
const WHEEL_ZOOM_SENSITIVITY = 0.01
const MAX_ZOOM_WHEEL_DELTA = 20

/** A window of the axis, fitted to `width` pixels: `{ origin, px }`. */
const fit = (from, to, width) => {
  const span = Math.max(to - from, 1e-6)
  return { origin: from, px: clamp(Math.max(width, 120) / span, MIN_PX_PER_DAY, MAX_PX_PER_DAY) }
}

export default function TimelineSurface({
  projectName,
  docPath,
  initialView,
  onActivate,
  onOpenDoc,
  isActive = true,
  locked = false,
}) {
  const surfaceRef = useRef(null)
  const plotRef = useRef(null)
  const timeline = useStoryTimeline(projectName)
  const cursor = useStoryCursor(projectName)
  const [calendar] = useStoryCalendar(projectName)
  const docs = useProjectDocs(projectName)
  const [view, setView] = useState(() => normalizeTimelineView(initialView))
  const [selection, setSelection] = useState(null)
  const [maps, setMaps] = useState({ journeys: [], places: [] })
  const [manuscript, setManuscript] = useState({ docs: [], passages: [] })
  const [width, setWidth] = useState(800)
  const [viewport, setViewport] = useState(null)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [history, setHistory] = useState(() => timelineHistoryState(projectName))
  // The inspector as last built; commands and callbacks reach it through here.
  const panelRef = useRef(null)

  const scale = view.scale
  // Sequence spacing, and a manuscript of undated events, run on positions, not days.
  const anyDated = Boolean(timeline?.events.some(isDated))
  const axis = scale === 'sequence' || (scale === 'manuscript' && !anyDated) ? 'sequence' : 'time'

  /* ---------------- the view document ---------------- */

  const saveTimer = useRef(null)
  const patchView = useCallback((patch) => {
    setView((current) => {
      const next = normalizeTimelineView({ ...current, ...patch })
      clearTimeout(saveTimer.current)
      if (!locked) saveTimer.current = setTimeout(() => saveTimelineView(projectName, docPath, next), 400)
      return next
    })
  }, [docPath, locked, projectName])
  useEffect(() => () => clearTimeout(saveTimer.current), [])

  // A participant renamed elsewhere: follow it here too, or the next save writes it back.
  useEffect(() => {
    const onMoved = (event) => {
      const { projectName: movedIn, entryPath, nextPath, type } = event.detail || {}
      if (movedIn !== projectName) return
      setView((current) => ({
        ...current,
        filter: { ...current.filter, participants: current.filter.participants.map((path) => movedPath(path, entryPath, nextPath, type)) },
      }))
    }
    window.addEventListener(TIMELINE_DOC_MOVED_EVENT, onMoved)
    return () => window.removeEventListener(TIMELINE_DOC_MOVED_EVENT, onMoved)
  }, [projectName])

  /* ---------------- what else the view reads ---------------- */

  const refreshMaps = useCallback(() => {
    loadProjectMaps(projectName).then(setMaps)
  }, [projectName])
  useEffect(() => {
    refreshMaps()
    window.addEventListener('focus', refreshMaps)
    return () => window.removeEventListener('focus', refreshMaps)
  }, [refreshMaps])

  const refreshManuscript = useCallback(() => {
    if (scale !== 'manuscript') return
    loadManuscriptPassages(projectName, view.manuscriptFolder).then(setManuscript)
  }, [projectName, scale, view.manuscriptFolder])
  useEffect(() => {
    refreshManuscript()
    let timer = null
    const later = (event) => {
      if (event.detail?.projectName && event.detail.projectName !== projectName) return
      clearTimeout(timer)
      timer = setTimeout(refreshManuscript, 250)
    }
    window.addEventListener(TIMELINE_RANGES_CHANGED_EVENT, later)
    window.addEventListener('focus', refreshManuscript)
    return () => {
      clearTimeout(timer)
      window.removeEventListener(TIMELINE_RANGES_CHANGED_EVENT, later)
      window.removeEventListener('focus', refreshManuscript)
    }
  }, [projectName, refreshManuscript])

  useEffect(() => {
    const onChanged = (event) => {
      if (event.detail?.projectName === projectName) setHistory(timelineHistoryState(projectName))
    }
    window.addEventListener(STORY_TIMELINE_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(STORY_TIMELINE_CHANGED_EVENT, onChanged)
  }, [projectName])

  /* ---------------- layout and the viewport ---------------- */

  const layout = useMemo(() => (timeline ? layoutChronology(timeline, { scale: axis }) : []), [axis, timeline])
  const threads = useMemo(
    () => (timeline && scale === 'manuscript' ? manuscriptThreads(timeline, manuscript.passages, { scale: axis }) : []),
    [axis, manuscript.passages, scale, timeline]
  )

  useEffect(() => {
    const element = plotRef.current
    if (!element) return undefined
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const plotWidth = Math.max(120, width - GUTTER)

  // What the axis spans: the first event to the last (and the journeys, when shown).
  const bounds = useMemo(() => {
    const extent = axis === 'sequence' ? [-0.5, Math.max(layout.length, 1) - 0.5] : chronologyExtent(layout, cursor.day ?? 0)
    const journeyEnds = axis === 'time' && view.showJourneys && scale === 'time'
      ? maps.journeys.flatMap((journey) => journey.intervals.flatMap((interval) => [interval.from, interval.to]))
      : []
    return [Math.min(extent[0], ...journeyEnds), Math.max(extent[1], ...journeyEnds)]
  }, [axis, cursor.day, layout, maps.journeys, scale, view.showJourneys])

  const fitAll = useCallback(() => {
    setViewport({ axis, ...fit(bounds[0], bounds[1], plotWidth) })
  }, [axis, bounds, plotWidth])

  // First fit: the saved range for a date axis, else everything — once there is something.
  useEffect(() => {
    if (viewport?.axis === axis || !timeline) return
    if (axis === 'time' && view.range) setViewport({ axis, ...fit(view.range[0], view.range[1], plotWidth) })
    else fitAll()
  }, [axis, fitAll, plotWidth, timeline, view.range, viewport?.axis])

  const maxPx = axis === 'sequence' ? 1200 : MAX_PX_PER_DAY
  const vp = boundViewport(viewport?.axis === axis ? viewport : { axis, origin: 0, px: axis === 'sequence' ? 120 : 20 }, bounds, plotWidth, maxPx)
  const toX = useCallback((unit) => (unit - vp.origin) * vp.px, [vp.origin, vp.px])
  const toUnit = useCallback((x) => vp.origin + x / vp.px, [vp.origin, vp.px])

  const rangeTimer = useRef(null)
  const setViewportAndRemember = useCallback((next) => {
    setViewport(next)
    if (next.axis !== 'time') return
    clearTimeout(rangeTimer.current)
    rangeTimer.current = setTimeout(() => patchView({ range: [next.origin, next.origin + plotWidth / next.px] }), 600)
  }, [patchView, plotWidth])
  useEffect(() => () => clearTimeout(rangeTimer.current), [])

  const zoomAt = useCallback((factor, x = plotWidth / 2) => {
    const at = toUnit(x)
    const px = clamp(vp.px * factor, axis === 'sequence' ? 8 : MIN_PX_PER_DAY, maxPx)
    setViewportAndRemember(boundViewport({ axis, origin: at - x / px, px }, bounds, plotWidth, maxPx))
  }, [axis, bounds, maxPx, plotWidth, setViewportAndRemember, toUnit, vp.px])

  const panBy = useCallback((pixels) => {
    setViewportAndRemember(boundViewport({ axis, origin: vp.origin + pixels / vp.px, px: vp.px }, bounds, plotWidth, maxPx))
  }, [axis, bounds, maxPx, plotWidth, setViewportAndRemember, vp.origin, vp.px])

  // Wheel: ⌘/ctrl (and a pinch) zooms at the pointer; sideways pans; up and down scrolls lanes.
  useEffect(() => {
    const element = plotRef.current
    if (!element) return undefined
    const onWheel = (event) => {
      const rect = element.getBoundingClientRect()
      const x = event.clientX - rect.left - GUTTER
      // Lines and pages (a mouse wheel on some systems) in pixels, as a trackpad sends.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        // Clamped: a mouse notch is ~100px, which would zoom ×2.7 a click; a pinch sends
        // a few px an event and is untouched.
        const delta = clamp(event.deltaY * unit, -MAX_ZOOM_WHEEL_DELTA, MAX_ZOOM_WHEEL_DELTA)
        zoomAt(Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY), x)
      } else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        event.preventDefault()
        panBy((event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit)
      }
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [panBy, zoomAt])

  /* ---------------- editing ---------------- */

  const refuse = useCallback(() => {
    cancelTimelinePreview(projectName)
    noteLockedEdit(docPath)
  }, [docPath, projectName])
  const commit = useCallback((label, edit, effects) => (
    locked ? refuse() : commitTimelineEdit(projectName, label, edit, effects)
  ), [locked, projectName, refuse])

  /** A sensible day for something newly dated: the cursor, or the middle of the view. */
  const suggestDay = useCallback((eventId) => {
    if (eventId && timeline) {
      const placed = layoutChronology(timeline, { scale: 'time' }).find((item) => item.id === eventId)
      if (placed && Number.isFinite(placed.start)) return Math.round(placed.start)
    }
    if (Number.isFinite(cursor.day)) return Math.round(cursor.day)
    return axis === 'time' ? Math.round(toUnit(plotWidth / 2)) : 0
  }, [axis, cursor.day, plotWidth, timeline, toUnit])

  const select = useCallback((id, { reveal = false } = {}) => {
    setSelection(id)
    if (id && reveal) setInspectorOpen(true)
  }, [])

  const addEventAt = useCallback(async ({ unit = null, laneId = null } = {}) => {
    let createdId = null
    await commit('Add event', (tl) => {
      if (axis === 'time' && Number.isFinite(unit)) {
        const { timeline: next, id } = addEvent(tl, { start: unit, laneId })
        createdId = id
        return next
      }
      // In sequence: after whatever sits left of the click, or at the end.
      const before = Number.isFinite(unit) ? layoutChronology(tl, { scale: 'sequence' }).filter((item) => item.start <= unit).pop() : null
      const { timeline: next, id } = addEvent(tl, { laneId }, before ? { after: before.id } : {})
      createdId = id
      return next
    })
    if (createdId) select(createdId, { reveal: true })
    panelRef.current?.focusTitle?.()
  }, [axis, commit, select])

  const deleteSelected = useCallback(() => {
    if (!selection) return
    const id = selection
    setSelection(null)
    commit('Delete event', (tl) => removeEvent(tl, id))
  }, [commit, selection])

  const nudge = useCallback((direction) => {
    if (!selection || !timeline) return
    const event = eventById(timeline, selection)
    if (!event) return
    if (axis === 'time' && isDated(event)) {
      commit('Move event', (tl) => shiftEvent(tl, event.id, direction * snapUnit(calendar, vp.px)))
      return
    }
    const sequence = sortedEvents(timeline)
    const index = sequence.findIndex((item) => item.id === event.id)
    const target = index + direction
    if (target < 0 || target >= sequence.length) return
    commit('Reorder event', (tl) => direction < 0
      ? moveEventBetween(tl, event.id, null, sequence[target].id)
      : moveEventBetween(tl, event.id, sequence[target].id))
  }, [axis, calendar, commit, selection, timeline, vp.px])

  const undo = useCallback(() => (locked ? refuse() : undoStoryTimeline(projectName).then(refreshMaps)), [locked, projectName, refreshMaps, refuse])
  const redo = useCallback(() => (locked ? refuse() : redoStoryTimeline(projectName).then(refreshMaps)), [locked, projectName, refreshMaps, refuse])

  const openLink = useCallback((link) => {
    if (link.kind === 'pin') {
      onOpenDoc?.(link.map)
      requestMapReveal(link.map, link.pin)
    } else if (link.kind === 'mapLeg') {
      onOpenDoc?.(link.map)
      requestMapReveal(link.map, link.traveler)
    } else if (link.kind === 'canvas') {
      onOpenDoc?.(link.path)
      requestCanvasReveal(link.path, link.node)
    } else if (link.kind === 'note') {
      onOpenDoc?.(link.doc)
    } else if (link.doc) onOpenDoc?.(link.doc)
  }, [onOpenDoc])

  const jumpToPassage = useCallback((eventId, doc, rangeId = null) => {
    onOpenDoc?.(doc)
    requestPassageJump({ projectName, docPath: doc, eventId, rangeId })
  }, [onOpenDoc, projectName])

  const panel = useTimelinePanel({
    title: getDocDisplayName(docPath),
    timeline,
    view,
    patchView,
    selection,
    onSelect: (id) => select(id),
    commit,
    calendar,
    onOpenCalendar: () => openStoryCalendarSettings(projectName),
    docs,
    places: maps.places,
    journeys: maps.journeys,
    suggestDay,
    onOpenDoc: (path) => onOpenDoc?.(path),
    onOpenLink: openLink,
    onJumpToPassage: jumpToPassage,
  })
  useEffect(() => {
    panelRef.current = panel
  })

  // A selection whose event went away (deleted, undone) is no selection.
  useEffect(() => {
    if (selection && timeline && !eventById(timeline, selection)) setSelection(null)
  }, [selection, timeline])

  /* ---------------- keyboard ---------------- */

  const onKeyDown = (event) => {
    const target = event.target
    if (target.closest?.('input, textarea, select, [contenteditable="true"]')) return
    const command = event.metaKey || event.ctrlKey
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    } else if (command && event.key === '0') {
      event.preventDefault()
      fitAll()
    } else if (command && (event.key === '=' || event.key === '+')) {
      event.preventDefault()
      zoomAt(1.5)
    } else if (command && event.key === '-') {
      event.preventDefault()
      zoomAt(1 / 1.5)
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      deleteSelected()
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      nudge(event.key === 'ArrowLeft' ? -1 : 1)
    } else if (event.key === 'Escape') {
      setSelection(null)
    } else if (event.key === 'Enter' && selection) {
      event.preventDefault()
      select(selection, { reveal: true })
      panel.focusTitle?.()
    }
  }

  /* ---------------- commands: the shell, the menus, reveals ---------------- */

  const runCommand = useCallback((command, detail = {}) => {
    switch (command) {
      case 'panel-field':
      case 'panel-action': {
        const handler = panelRef.current.handlers.get(detail.id)
        if (!handler) return
        if (command === 'panel-field') handler(detail.value)
        else handler()
        return
      }
      case 'panel-tab': panelRef.current.handlers.get('@tab')?.(detail.id); return
      case 'panel-back': panelRef.current.handlers.get('@back')?.(); return
      case 'add-event': addEventAt({ unit: Number.isFinite(cursor.day) && axis === 'time' ? cursor.day : null }); return
      case 'delete': deleteSelected(); return
      case 'undo': undo(); return
      case 'redo': redo(); return
      case 'zoom-in': zoomAt(1.5); return
      case 'zoom-out': zoomAt(1 / 1.5); return
      case 'fit': fitAll(); return
      case 'scale': patchView({ scale: detail.value }); return
      case 'toggle-inspector': setInspectorOpen((open) => !open); return
      case 'lens': setTimeLens(projectName, { on: !cursor.lens.on, scale: axis }, 'timeline'); return
      default:
    }
  }, [addEventAt, axis, cursor.day, cursor.lens.on, deleteSelected, fitAll, patchView, projectName, redo, undo, zoomAt])
  const runCommandRef = useRef(runCommand)
  useEffect(() => {
    runCommandRef.current = runCommand
  })

  useEffect(() => {
    const surface = surfaceRef.current
    const release = registerTimelineSurface(surface)
    const onCommand = (event) => {
      const { command, ...detail } = event.detail || {}
      runCommandRef.current(command, detail)
    }
    surface?.addEventListener(TIMELINE_COMMAND_EVENT, onCommand)
    return () => {
      surface?.removeEventListener(TIMELINE_COMMAND_EVENT, onCommand)
      release()
    }
  }, [])

  const revealEvent = useCallback((eventId) => {
    if (!timeline || !eventById(timeline, eventId)) return
    select(eventId, { reveal: true })
    const placed = layout.find((item) => item.id === eventId)
    if (placed && scale !== 'manuscript') {
      const x = toX(placed.start)
      if (x < 0 || x > plotWidth) setViewportAndRemember({ axis, origin: placed.start - (plotWidth / 2) / vp.px, px: vp.px })
    }
  }, [axis, layout, plotWidth, scale, select, setViewportAndRemember, timeline, toX, vp.px])

  useEffect(() => {
    if (!timeline) return undefined
    const pending = takePendingTimelineReveal(docPath)
    if (pending) requestAnimationFrame(() => revealEvent(pending))
    const onReveal = (event) => {
      if (event.detail?.docPath && event.detail.docPath !== docPath) return
      takePendingTimelineReveal(docPath)
      revealEvent(event.detail.eventId)
    }
    window.addEventListener(TIMELINE_REVEAL_EVENT, onReveal)
    return () => window.removeEventListener(TIMELINE_REVEAL_EVENT, onReveal)
  }, [docPath, revealEvent, timeline])

  // Published while this view is the active one, and only when something the toolbar
  // or inspector shows changed: a pan re-renders the view and changes none of it.
  const panelKey = JSON.stringify(panel.panel)
  useEffect(() => {
    if (!isActive) return undefined
    return () => documentSurface.publishTimelineChrome({})
  }, [isActive])
  useEffect(() => {
    const surfaceId = surfaceRef.current?.dataset.surfaceId
    if (!isActive || !surfaceId) return
    documentSurface.publishTimelineChrome({
      state: {
        surfaceId,
        docPath,
        scale,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        hasSelection: Boolean(selection),
        lensOn: Boolean(cursor.lens.on),
        panel: panelRef.current.panel,
        revealPanel: 0,
        active: true,
        inspectorOpen,
      },
    })
  }, [cursor.lens.on, docPath, history.canRedo, history.canUndo, inspectorOpen, isActive, panelKey, scale, selection])

  /* ---------------- drawing ---------------- */

  const shared = {
    projectName,
    timeline,
    calendar,
    view,
    axis,
    toX,
    toUnit,
    px: vp.px,
    plotWidth,
    selection,
    onSelect: select,
    onAddAt: addEventAt,
    onRefreshMaps: refreshMaps,
    cursor,
    patchView,
    docs,
  }

  const pageInspector = inspectorOpen

  return (
    <div
      ref={surfaceRef}
      className={`timeline-surface${isActive ? ' is-active' : ''}${pageInspector ? ' has-inspector' : ''}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={() => onActivate?.()}
    >

      <div ref={plotRef} className="timeline-plot">
        {!timeline ? (
          <div className="timeline-empty">Loading…</div>
        ) : (
          <>
            <TimelineAxis
              {...shared}
              onScrub={(day) => setStoryDay(projectName, day, 'timeline')}
              onLens={(patch) => setTimeLens(projectName, { ...patch, scale: axis }, 'timeline')}
            />
            {scale === 'manuscript' ? (
              <TimelineManuscript
                {...shared}
                layout={layout}
                threads={threads}
                manuscriptDocs={manuscript.docs}
                onJumpToPassage={jumpToPassage}
                commit={commit}
              />
            ) : (
              <TimelineLanes
                {...shared}
                layout={layout}
                journeys={axis === 'time' && scale === 'time' ? maps.journeys : []}
                commit={commit}
              />
            )}
            {!timeline.events.length ? (
              <div className="timeline-empty">
                <p>No events yet.</p>
                <p>Double-click anywhere to add one, or select text in a chapter and choose <em>Attach to timeline event</em>.</p>
              </div>
            ) : scale === 'manuscript' && !threads.length ? (
              <div className="timeline-empty">
                <p>No passages are attached to events yet.</p>
                <p>Select text in a chapter and choose <em>Attach to timeline event</em> — each passage then appears here in reading order, joined to when it happens.</p>
              </div>
            ) : null}
          </>
        )}
      </div>

      {pageInspector ? (
        <MapPanelView panel={panel.panel} handlers={panel.handlers} onClose={() => setInspectorOpen(false)} />
      ) : null}
    </div>
  )
}
