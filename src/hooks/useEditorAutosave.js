/**
 * useEditorAutosave — getting the user's writing onto disk, and into history.
 *
 * Two clocks on the same keystroke: a fast debounce that rewrites the document, and
 * a slow one that appends a version-history checkpoint. Notes ride the fast clock
 * too, so a note survives a crash even if the prose around it has not settled yet.
 *
 * The guards are the whole point of this file. A save fires from a debounce, which
 * means it can land after the pane has moved on, so every handler re-checks that the
 * editor is alive, that the pane is not mid-load, and that this document was ever
 * actually installed into this pane — an autosave from an editor still holding the
 * previous document (or nothing at all) writes an empty file over real work.
 *
 * Every teardown flushes rather than cancels, and that is deliberate: switching
 * documents, closing a split and unmounting all run through here, and each one is a
 * moment where the last edit would otherwise be silently dropped. flushPane() is how
 * the loader reaches them on the way out.
 */
import { useCallback, useEffect, useRef } from 'react'
import { debounce } from 'lodash'

import { saveDocument, getVersions } from '../lib/FileSystem'
import { isEditorReady } from '../lib/editorUtils'
import { isTextDoc } from '../lib/docKind'
import { TYPESET_META } from '../print/TypesetLock'
import { readEditorTimelineRanges } from '../extensions/TimelineAnchors'
import { excerptOfNode, noteExcerpt } from '../lib/docExcerpts'

const AUTOSAVE_DEBOUNCE_MS = 800
const HISTORY_CHECKPOINT_DEBOUNCE_MS = 15000

/**
 * `detail: { editor, name }` — save a named checkpoint of that editor's document now,
 * before whatever the sender is about to do to it. The content is read synchronously
 * on receipt, so an edit dispatched right after the event is not in it. Resolving a
 * bubble session sends it: history is the only way back to a resolved session.
 */
export const VERSION_CHECKPOINT_EVENT = 'inkblot:version-checkpoint'

export function useEditorAutosave({
  activeDoc,
  activeDocNotes,
  currentDoc,
  docCache,
  editor,
  getNotesForDoc,
  projectName,
  secondaryDoc,
  secondaryEditor,
  setVersions,
  splitView,
}) {
  const { isDocLoaded, isPaneLoading } = docCache

  const primaryAutosaveRef = useRef(null)
  const secondaryAutosaveRef = useRef(null)
  const primaryVersionCheckpointRef = useRef(null)

  // The primary pane flushes its checkpoint alongside its autosave: the two are
  // driven by the same keystroke, so a teardown that took only one of them would
  // save the text and lose the history entry describing it.
  const flushPane = useCallback((paneId) => {
    const handlerRefs = paneId === 'secondary'
      ? [secondaryAutosaveRef]
      : [primaryAutosaveRef, primaryVersionCheckpointRef]

    for (const handlerRef of handlerRefs) {
      const handler = handlerRef.current
      if (handler && typeof handler.flush === 'function') {
        handler.flush()
      }
    }
  }, [])

  const saveVersionCheckpoint = useCallback(async (targetEditor, docName, paneId, name = null) => {
    if (!isEditorReady(targetEditor) || !docName) return
    // Canvas checkpoints are written by useCanvasDocument, not this TipTap path.
    if (!isTextDoc(docName)) return
    if (!isDocLoaded(docName, paneId)) return
    if (isPaneLoading(paneId)) return

    const contentJson = targetEditor.getJSON()
    const contentHtml = targetEditor.getHTML()

    await saveDocument(projectName, docName, {
      content: contentJson,
      notes: getNotesForDoc(docName),
      timeline: readEditorTimelineRanges(targetEditor, docName),
      _appendVersion: true,
      _version: {
        contentHtml,
        contentJson,
        ...(name ? { name, auto: false } : {}),
      },
    })

    try {
      const vs = await getVersions(projectName, docName)
      setVersions?.(docName, vs)
    } catch (e) {
      console.error('Failed to refresh versions:', e)
    }
  }, [getNotesForDoc, isDocLoaded, isPaneLoading, projectName, setVersions])

  /* ---------------- Primary: text + checkpoints ---------------- */

  useEffect(() => {
    if (!isEditorReady(editor) || !currentDoc) return
    if (!isTextDoc(currentDoc)) return

    const handler = debounce(async () => {
      if (!isEditorReady(editor)) return
      if (isPaneLoading('primary')) return
      if (!isDocLoaded(currentDoc, 'primary')) return

      const contentJson = editor.getJSON()

      await saveDocument(projectName, currentDoc, {
        content: contentJson,
        notes: getNotesForDoc(currentDoc),
        timeline: readEditorTimelineRanges(editor, currentDoc),
      })
      // What the landing page's pile shows of it (lib/docExcerpts.js).
      noteExcerpt(projectName, currentDoc, excerptOfNode(editor.state.doc))

    }, AUTOSAVE_DEBOUNCE_MS)

    const checkpointHandler = debounce(() => {
      void saveVersionCheckpoint(editor, currentDoc, 'primary')
    }, HISTORY_CHECKPOINT_DEBOUNCE_MS)

    // Typesetting — a paragraph's style, a picture's width — is saved like any edit, but
    // is the typeset history's, not the text's: only writing moves the text history on.
    const handleUpdate = ({ transaction } = {}) => {
      handler()
      if (!transaction?.getMeta(TYPESET_META)) checkpointHandler()
    }

    const handleCheckpointRequest = (event) => {
      if (event?.detail?.editor !== editor) return
      void saveVersionCheckpoint(editor, currentDoc, 'primary', event.detail.name || null)
    }

    primaryAutosaveRef.current = handler
    primaryVersionCheckpointRef.current = checkpointHandler
    editor.on('update', handleUpdate)
    window.addEventListener(VERSION_CHECKPOINT_EVENT, handleCheckpointRequest)

    return () => {
      window.removeEventListener(VERSION_CHECKPOINT_EVENT, handleCheckpointRequest)
      if (!editor.isDestroyed) editor.off('update', handleUpdate)
      handler.flush()
      handler.cancel()
      checkpointHandler.flush()
      checkpointHandler.cancel()
      if (primaryAutosaveRef.current === handler) {
        primaryAutosaveRef.current = null
      }
      if (primaryVersionCheckpointRef.current === checkpointHandler) {
        primaryVersionCheckpointRef.current = null
      }
    }
  }, [currentDoc, editor, getNotesForDoc, isDocLoaded, isPaneLoading, projectName, saveVersionCheckpoint])

  /* ---------------- Secondary: text only ---------------- */

  // The split pane gets no checkpoints of its own. History follows the document the
  // writer is working in, and that is whichever pane is active — which the notes
  // autosave below covers for both panes.
  useEffect(() => {
    if (!isEditorReady(secondaryEditor) || splitView !== 'editor' || !secondaryDoc) return
    if (!isTextDoc(secondaryDoc)) return

    const handler = debounce(async () => {
      if (!isEditorReady(secondaryEditor)) return
      if (isPaneLoading('secondary')) return
      if (!isDocLoaded(secondaryDoc, 'secondary')) return

      await saveDocument(projectName, secondaryDoc, {
        content: secondaryEditor.getJSON(),
        notes: getNotesForDoc(secondaryDoc),
        timeline: readEditorTimelineRanges(secondaryEditor, secondaryDoc),
      })
      noteExcerpt(projectName, secondaryDoc, excerptOfNode(secondaryEditor.state.doc))
    }, AUTOSAVE_DEBOUNCE_MS)

    const handleUpdate = () => {
      handler()
    }

    secondaryAutosaveRef.current = handler
    secondaryEditor.on('update', handleUpdate)

    return () => {
      if (!secondaryEditor.isDestroyed) secondaryEditor.off('update', handleUpdate)
      handler.flush()
      handler.cancel()
      if (secondaryAutosaveRef.current === handler) {
        secondaryAutosaveRef.current = null
      }
    }
  }, [getNotesForDoc, isDocLoaded, isPaneLoading, projectName, secondaryDoc, secondaryEditor, splitView])

  /* ---------------- Notes ---------------- */

  // Notes change without the document changing — adding one fires no editor update —
  // so they get their own pass, keyed on the note array rather than on a keystroke.
  useEffect(() => {
    if (!activeDoc) return
    const activePaneId = activeDoc === secondaryDoc && activeDoc !== currentDoc ? 'secondary' : 'primary'
    if (!isDocLoaded(activeDoc, activePaneId)) return

    const getEditorForDoc = (docName) => {
      if (docName === currentDoc) return editor
      if (docName === secondaryDoc) return secondaryEditor
      return null
    }

    const targetEditor = getEditorForDoc(activeDoc)
    if (!isEditorReady(targetEditor)) return

    const handler = debounce(async () => {
      if (!isEditorReady(targetEditor)) return
      if (
        (activeDoc === currentDoc && isPaneLoading('primary')) ||
        (activeDoc === secondaryDoc && isPaneLoading('secondary'))
      ) {
        return
      }

      const contentJson = targetEditor.getJSON()
      await saveDocument(projectName, activeDoc, {
        content: contentJson,
        notes: activeDocNotes,
        timeline: readEditorTimelineRanges(targetEditor, activeDoc),
      })
    }, AUTOSAVE_DEBOUNCE_MS)

    const checkpointHandler = debounce(() => {
      void saveVersionCheckpoint(targetEditor, activeDoc, activePaneId)
    }, HISTORY_CHECKPOINT_DEBOUNCE_MS)

    // Persist notes promptly; create a history snapshot only after a slower idle checkpoint.
    try { handler() } catch (e) {}
    try { checkpointHandler() } catch (e) {}

    return () => {
      handler.cancel()
      checkpointHandler.cancel()
    }
  }, [
    activeDoc,
    activeDocNotes,
    currentDoc,
    editor,
    isDocLoaded,
    isPaneLoading,
    projectName,
    saveVersionCheckpoint,
    secondaryDoc,
    secondaryEditor,
  ])

  return { flushPane }
}
