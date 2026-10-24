/**
 * useEditorDocCache — what each pane is holding, and whether it is mid-swap.
 *
 * Three pieces of bookkeeping that only mean anything together:
 *
 *  - the per-(project, pane, document) EditorState cache, which is what makes
 *    revisiting a document instant: scroll, selection and undo history come back
 *    without re-parsing content, and an edit made since the last save is still there
 *  - which of those keys has actually been installed into a pane, because autosave
 *    must never write a document it has not loaded — that is the path by which an
 *    idle, empty editor overwrites a real file
 *  - whether a pane is mid-load, because loading dispatches transactions of its own
 *    and every listener downstream (autosave, version checkpoints, note anchor
 *    remapping) has to sit those out rather than treat them as the user typing
 */
import { useCallback, useRef } from 'react'
import { createDocument } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import { isEditorReady } from '../lib/editorUtils'
import { setTimelineRanges } from '../extensions/TimelineAnchors'

const EMPTY_DOC_CONTENT = '<p></p>'

/** Build a fresh ProseMirror EditorState from stored document content. */
const createEditorStateFromContent = (targetEditor, content) => {
  const doc = createDocument(
    content || EMPTY_DOC_CONTENT,
    targetEditor.schema,
    {},
    { errorOnInvalidContent: targetEditor.options.enableContentCheck }
  )

  return EditorState.create({
    doc,
    schema: targetEditor.schema,
    plugins: targetEditor.state.plugins,
  })
}

const installEditorState = (targetEditor, nextState) => {
  targetEditor.view.updateState(nextState)
  targetEditor.createNodeViews?.()
}

export function useEditorDocCache({ hasNotesForDoc, projectName, setNotesForDoc }) {
  const loadedDocsRef = useRef(new Set())
  const docStateCacheRef = useRef(new Map())
  const loadingPanesRef = useRef({ primary: false, secondary: false })

  const getDocCacheKey = useCallback((docName, paneId) => (
    projectName && docName && paneId ? `${projectName}::${paneId}::${docName}` : ''
  ), [projectName])

  const isDocLoaded = useCallback((docName, paneId) => (
    loadedDocsRef.current.has(getDocCacheKey(docName, paneId))
  ), [getDocCacheKey])

  const forgetDoc = useCallback((docName, paneId) => {
    loadedDocsRef.current.delete(getDocCacheKey(docName, paneId))
  }, [getDocCacheKey])

  const beginPaneLoad = useCallback((paneId) => {
    loadingPanesRef.current[paneId] = true
  }, [])

  const endPaneLoad = useCallback((paneId) => {
    loadingPanesRef.current[paneId] = false
  }, [])

  const isPaneLoading = useCallback((paneId) => (
    Boolean(loadingPanesRef.current[paneId])
  ), [])

  // Save the pane's current editor state into the doc cache before switching away.
  const stashEditorState = useCallback((targetEditor, docName, paneId) => {
    if (!isEditorReady(targetEditor)) return
    const cacheKey = getDocCacheKey(docName, paneId)
    if (!cacheKey || !loadedDocsRef.current.has(cacheKey)) return
    docStateCacheRef.current.set(cacheKey, targetEditor.state)
  }, [getDocCacheKey])

  // Whether a pane can take this doc back without reading it: its state is stashed,
  // and its notes, the other thing a read seeds, are already held.
  const canRestoreFromCache = useCallback((docName, paneId) => {
    const cacheKey = getDocCacheKey(docName, paneId)
    return Boolean(cacheKey && docStateCacheRef.current.has(cacheKey) && hasNotesForDoc(docName))
  }, [getDocCacheKey, hasNotesForDoc])

  // Install a doc into a pane: prefer the cached state, else build one from
  // the loaded content; also seed the doc's notes on first open.
  const restoreEditorStateForDoc = useCallback((targetEditor, docName, paneId, loadedDoc) => {
    const cacheKey = getDocCacheKey(docName, paneId)
    const cachedState = cacheKey ? docStateCacheRef.current.get(cacheKey) : null
    const nextState = cachedState || createEditorStateFromContent(targetEditor, loadedDoc?.content)

    installEditorState(targetEditor, nextState)
    // A cached state carries its timeline passages already, mapped to the text it holds.
    if (!cachedState) setTimelineRanges(targetEditor, docName, loadedDoc?.timeline)
    if (cacheKey) {
      loadedDocsRef.current.add(cacheKey)
    }

    if (!hasNotesForDoc(docName)) {
      setNotesForDoc(docName, loadedDoc?.notes || [])
    }

    return Boolean(cachedState)
  }, [getDocCacheKey, hasNotesForDoc, setNotesForDoc])

  return {
    beginPaneLoad,
    canRestoreFromCache,
    endPaneLoad,
    forgetDoc,
    isDocLoaded,
    isPaneLoading,
    restoreEditorStateForDoc,
    stashEditorState,
  }
}
