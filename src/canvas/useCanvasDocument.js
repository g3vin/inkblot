/**
 * useCanvasDocument.js — the canvas document: reducer, autosave, undo/redo,
 * and version-history checkpoints.
 *
 * Saving is debounced and always flushed on unmount, mirroring how EditorCanvas
 * treats text documents — switching away from a canvas mid-debounce must not
 * lose the edit. Checkpoints ride a much slower debounce, exactly like text
 * documents' history checkpoints, and land in the canvas's `.versions/` sidecar.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { debounce } from 'lodash'
import { saveCanvasDocument } from '../lib/canvasFileSystem'
import { appendCanvasVersion } from '../lib/FileSystem'
import { serializeCanvas } from '../lib/canvasModel'
import { canRedo, canUndo, createHistory, historyReducer } from './canvasReducer'

const SAVE_DEBOUNCE_MS = 800
// Matches HISTORY_CHECKPOINT_DEBOUNCE_MS for text documents in EditorCanvas.
const VERSION_CHECKPOINT_DEBOUNCE_MS = 15000
// A card's text commits as one patch per editing session, but a color drag fires
// continuously; this breaks a long coalesced run into sensible undo steps.
const COALESCE_IDLE_MS = 600

export function useCanvasDocument({ projectName, docPath, initialState, viewportRef }) {
  const [history, dispatch] = useReducer(historyReducer, initialState, createHistory)
  const state = history.present

  /* ---------------- autosave ---------------- */

  // Takes what to save as arguments rather than reading refs, so the debounced
  // closure never has to reach into render-time state.
  const save = useMemo(
    () =>
      debounce((nextState, nextViewport) => {
        void saveCanvasDocument(projectName, docPath, nextState, nextViewport)
      }, SAVE_DEBOUNCE_MS),
    [docPath, projectName]
  )

  // The slow sibling: after the edit burst settles, snapshot the whole canvas
  // into version history. Dedup against the latest entry happens in storage, so
  // a checkpoint that fires without a real change costs one compare, not a copy.
  const checkpoint = useMemo(
    () =>
      debounce((nextState, nextViewport) => {
        void appendCanvasVersion(projectName, docPath, serializeCanvas(nextState, nextViewport))
      }, VERSION_CHECKPOINT_DEBOUNCE_MS),
    [docPath, projectName]
  )

  const isFirstRef = useRef(true)
  useEffect(() => {
    // The first value is what we just loaded from disk — writing it back is noise.
    if (isFirstRef.current) {
      isFirstRef.current = false
      return
    }
    save(state, viewportRef.current)
    checkpoint(state, viewportRef.current)
  }, [checkpoint, save, state, viewportRef])

  useEffect(
    () => () => {
      save.flush()
      save.cancel()
      checkpoint.flush()
      checkpoint.cancel()
    },
    [checkpoint, save]
  )

  /* ---------------- coalescing ---------------- */

  const clearCoalesce = useMemo(
    () => debounce(() => dispatch({ type: 'history/breakCoalesce' }), COALESCE_IDLE_MS),
    []
  )

  const run = useCallback(
    (action) => {
      dispatch(action)
      if (action.meta?.coalesce) clearCoalesce()
    },
    [clearCoalesce]
  )

  useEffect(() => () => clearCoalesce.cancel(), [clearCoalesce])

  /* ---------------- undo / redo ---------------- */

  const undo = useCallback(() => dispatch({ type: 'history/undo' }), [])
  const redo = useCallback(() => dispatch({ type: 'history/redo' }), [])

  return {
    state,
    dispatch: run,
    undo,
    redo,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
  }
}
