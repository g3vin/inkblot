/**
 * useMapInput.js — how pointer and keyboard turn into edits on a map (MapSurface).
 *
 * A press decides, there and then, what a drag will do: pan, move a pin or label, or
 * pull a route's or region's handle. Without a drag it is a click, which does what the
 * tool does. Drags write once per frame, coalesced into one undo step per gesture.
 * Space held, the middle button, or the pan tool always pans.
 *
 * MapSurface owns the state; this reads it and calls back. It returns the handlers the
 * surface element takes, and the rubber band's ref (the line from a drawing's last
 * point to the pointer, moved without a render).
 */
import { useCallback, useEffect, useRef } from 'react'
import { makePin, newId } from '../lib/map/mapModel'
import { resolvePin } from '../lib/map/mapSpace'
import { isItemLocked } from '../lib/map/mapVisibility'
import { arrowDays, startStateOf } from '../lib/map/nbody'
import { panMapBy } from '../lib/map/mapViewport'
import { nearestOnPolyline } from '../lib/map/mapGeometry'

/** Screen pixels a press may wander before it becomes a drag. */
const DRAG_THRESHOLD = 4
/** Two clicks this close in time and space finish a drawing. */
const DOUBLE_CLICK_MS = 320

export const DRAWING_TOOLS = new Set(['route', 'region', 'ruler', 'area', 'calibrate'])

export function useMapInput({
  tool,
  setTool,
  view,
  map,
  mapRef,
  dispatch,
  space,
  day,
  docs,
  projector,
  selection,
  select,
  setSelection,
  draft,
  setDraft,
  hover,
  setHover,
  setIsPanning,
  setDraggedFrom,
  setFocusBody,
  setRenameRequest,
  storedAt,
  pinNear,
  addItem,
  patchItem,
  removeSelection,
  addDraftPoint,
  finishDraft,
  labelSizeNow,
  showInspector,
  fitAll,
  undo,
  redo,
  onActivate,
  onOpenDoc,
}) {
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
          } else if (dragTarget.ownerKind === 'body-start' || dragTarget.ownerKind === 'body-velocity') {
            // Where a body starts, or how fast (the arrow's tip, `days` of motion on).
            const system = current.system
            const start = startStateOf(system, dragTarget.owner)
            if (!start) return
            dragTarget.days ??= arrowDays(system)
            const state = dragTarget.ownerKind === 'body-start'
              ? { pos: [at[0], at[1], start.pos[2] || 0], vel: start.vel.slice(0, 3) }
              : { pos: start.pos.slice(0, 3), vel: [(at[0] - start.pos[0]) / dragTarget.days, (at[1] - start.pos[1]) / dragTarget.days, start.vel[2] || 0] }
            dispatch({
              type: 'section/patch',
              section: 'system',
              patch: { bodies: system.bodies.map((body) => (body.id === dragTarget.owner ? { ...body, state } : body)), template: null },
              meta: { coalesce: `start-${dragTarget.owner}` },
            })
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
    [addDraftPoint, addItem, dispatch, finishDraft, labelSizeNow, map, mapRef, onActivate, patchItem, pinNear, select, setDraggedFrom, setIsPanning, setRenameRequest, setSelection, showInspector, storedAt, tool, view]
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
    [day, docs.paths, map, onOpenDoc, patchItem, setFocusBody, setRenameRequest, showInspector, space, storedAt, tool, view]
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
    [draft, hover, projector, setHover, view]
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
    [draft, finishDraft, fitAll, redo, removeSelection, selection, setDraft, setSelection, setTool, undo]
  )

  const onKeyUp = useCallback((event) => {
    if (event.key === ' ') spaceHeldRef.current = false
  }, [])

  return { onPointerDown, onDoubleClick, onPointerMove, onKeyDown, onKeyUp, rubberRef }
}
