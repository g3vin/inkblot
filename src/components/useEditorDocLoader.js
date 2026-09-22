/**
 * useEditorDocLoader — putting a document into a pane, and getting the last one out.
 *
 * Reading is the easy half. The cleanup is the half that matters: a document switch
 * has to flush whatever the outgoing document had pending and stash its editor state
 * before the pane is reused, and both happen in a teardown that React runs after the
 * props have already changed. That is why the outgoing document's name is read from
 * this effect's own closure rather than from a ref.
 *
 * useEditorAutosave is set up before this hook, so React tears it down first and it
 * has usually flushed itself by the time flushPane() runs here. The call stays
 * because this hook is where "leaving a document" is decided, and a flush that has
 * already happened costs nothing — whereas the reverse, teardown order changing
 * under us, would lose the last edit with no error.
 *
 * `cancelled` guards the other direction: loadDocument is async, so a fast switch
 * can resolve after the pane has moved on, and installing that content would put the
 * previous document back under the current one's name — and autosave would then
 * write it there.
 */
import { useEffect } from 'react'

import { loadDocument, getVersions } from '../lib/FileSystem'
import { isEditorReady } from '../lib/editorUtils'
import { isCanvasDoc } from '../lib/docKind'

export function useEditorDocLoader({
  currentDoc,
  docCache,
  editor,
  flushPane,
  onPaneLoaded,
  projectName,
  secondaryDoc,
  secondaryEditor,
  setVersions,
  splitView,
}) {
  const {
    beginPaneLoad,
    endPaneLoad,
    forgetDoc,
    restoreEditorStateForDoc,
    stashEditorState,
  } = docCache

  /* ---------------- Primary ---------------- */

  useEffect(() => {
    if (!isEditorReady(editor) || !currentDoc) return
    // A canvas has no TipTap content — feeding its JSON to createDocument() would
    // throw. CanvasPane loads and saves it instead; this editor stays idle.
    if (isCanvasDoc(currentDoc)) return
    let cancelled = false

    const load = async () => {
      beginPaneLoad('primary')
      forgetDoc(currentDoc, 'primary')

      try {
        const doc = await loadDocument(projectName, currentDoc)
        if (cancelled || !isEditorReady(editor)) return

        restoreEditorStateForDoc(editor, currentDoc, 'primary', doc)
        // Open an empty document ready to write in — caret placed and blinking,
        // no click needed. Asking the editor whether it is empty is the only
        // reliable test: a new document is stored as `content: []`, which is
        // neither missing nor a node with children, so shape checks miss it.
        if (editor.isEmpty) {
          editor.commands.focus('start')
        }
        onPaneLoaded('primary', editor)

        // load versions for the right sidebar
        try {
          const vs = await getVersions(projectName, currentDoc)
          setVersions?.(currentDoc, vs)
        } catch (e) {
          console.error('Failed to load versions:', e)
          setVersions?.(currentDoc, [])
        }
      } finally {
        endPaneLoad('primary')
      }
    }

    load()
    return () => {
      cancelled = true
      flushPane('primary')
      stashEditorState(editor, currentDoc, 'primary')
    }
  }, [
    beginPaneLoad,
    currentDoc,
    editor,
    endPaneLoad,
    flushPane,
    forgetDoc,
    onPaneLoaded,
    projectName,
    restoreEditorStateForDoc,
    setVersions,
    stashEditorState,
  ])

  /* ---------------- Secondary ---------------- */

  useEffect(() => {
    if (!isEditorReady(secondaryEditor) || splitView !== 'editor' || !secondaryDoc) return
    if (isCanvasDoc(secondaryDoc)) return
    let cancelled = false

    const load = async () => {
      beginPaneLoad('secondary')
      forgetDoc(secondaryDoc, 'secondary')

      try {
        const doc = await loadDocument(projectName, secondaryDoc)
        if (cancelled || !isEditorReady(secondaryEditor)) return

        restoreEditorStateForDoc(secondaryEditor, secondaryDoc, 'secondary', doc)
        onPaneLoaded('secondary', secondaryEditor)
      } finally {
        endPaneLoad('secondary')
      }
    }

    load()
    return () => {
      cancelled = true
      flushPane('secondary')
      stashEditorState(secondaryEditor, secondaryDoc, 'secondary')
    }
  }, [
    beginPaneLoad,
    endPaneLoad,
    flushPane,
    forgetDoc,
    onPaneLoaded,
    projectName,
    restoreEditorStateForDoc,
    secondaryDoc,
    secondaryEditor,
    splitView,
    stashEditorState,
  ])
}
