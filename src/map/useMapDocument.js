/**
 * useMapDocument.js — the map document: reducer, autosave, undo/redo and
 * version-history checkpoints. The timings are useCanvasDocument's, for the same
 * reasons: a quick debounced save that is always flushed on unmount, and a slow
 * checkpoint into the `.versions/` sidecar once an edit burst settles.
 *
 * Two things are saved without being edits: the viewport, and the story day the
 * timeline was left on. Neither enters undo history — undoing a pin move must not
 * yank the timeline back — so both live in refs and are folded in at save time.
 *
 * A locked map (docLocks.ts) takes no edits: they are dropped here, before the
 * reducer. Its view and day still save, as they are not edits.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { debounce } from 'lodash'
import { appendMapVersion, saveMapDocument } from '../lib/map/mapFileSystem'
import { serializeMap } from '../lib/map/mapModel'
import { canRedo, canUndo, createHistory, historyReducer } from './mapReducer'
import { noteLockedEdit } from '../lib/docLocks'

const SAVE_DEBOUNCE_MS = 800
const VERSION_CHECKPOINT_DEBOUNCE_MS = 15000
const COALESCE_IDLE_MS = 600

const withDay = (map, day) =>
  Number.isFinite(day) && day !== map.timeline?.day ? { ...map, timeline: { ...map.timeline, day } } : map

export function useMapDocument({ projectName, docPath, initialMap, viewportRef, dayRef, locked = false }) {
  const [history, dispatch] = useReducer(historyReducer, initialMap, createHistory)
  const map = history.present
  const lockedRef = useRef(locked)
  useEffect(() => {
    lockedRef.current = locked
  }, [locked])
  const mapRef = useRef(map)
  useEffect(() => {
    mapRef.current = map
  }, [map])

  // The savers take what to save as arguments, so nothing reads a ref while
  // they are built — callers pass the current map, day and viewport.
  const save = useMemo(
    () =>
      debounce((nextMap, day, viewport) => {
        void saveMapDocument(projectName, docPath, withDay(nextMap, day), viewport)
      }, SAVE_DEBOUNCE_MS),
    [docPath, projectName]
  )

  const checkpoint = useMemo(
    () =>
      debounce((nextMap, day, viewport) => {
        void appendMapVersion(projectName, docPath, serializeMap(withDay(nextMap, day), viewport))
      }, VERSION_CHECKPOINT_DEBOUNCE_MS),
    [docPath, projectName]
  )

  const isFirstRef = useRef(true)
  useEffect(() => {
    // The first value is what was just loaded — writing it back is noise.
    if (isFirstRef.current) {
      isFirstRef.current = false
      return
    }
    save(map, dayRef?.current, viewportRef.current)
    checkpoint(map, dayRef?.current, viewportRef.current)
  }, [checkpoint, dayRef, map, save, viewportRef])

  useEffect(
    () => () => {
      save.flush()
      save.cancel()
      checkpoint.flush()
      checkpoint.cancel()
    },
    [checkpoint, save]
  )

  /** Persist where the view is and what day it shows — not an edit, but kept. */
  const saveView = useCallback(
    () => save(mapRef.current, dayRef?.current, viewportRef.current),
    [dayRef, save, viewportRef]
  )

  const clearCoalesce = useMemo(
    () => debounce(() => dispatch({ type: 'history/breakCoalesce' }), COALESCE_IDLE_MS),
    []
  )
  useEffect(() => () => clearCoalesce.cancel(), [clearCoalesce])

  const run = useCallback(
    (action) => {
      if (lockedRef.current && !action.meta?.upkeep) {
        noteLockedEdit(docPath)
        return
      }
      dispatch(action)
      if (action.meta?.coalesce) clearCoalesce()
    },
    [clearCoalesce, docPath]
  )

  const undo = useCallback(() => run({ type: 'history/undo' }), [run])
  const redo = useCallback(() => run({ type: 'history/redo' }), [run])

  return {
    map,
    mapRef,
    dispatch: run,
    undo,
    redo,
    saveView,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
  }
}
