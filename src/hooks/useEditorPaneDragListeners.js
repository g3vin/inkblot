/**
 * useEditorPaneDragListeners — the drag and drop listeners around EditorCanvas's two
 * panes, registered once both editors exist:
 *
 *   - a drag from an editor's selection is tagged with its payload, so the clipboard
 *     panel and the other pane know what is moving
 *   - each pane's own dragstart, dragover and drop (the secondary only in an editor split)
 *   - window drag, dragover, drop and dragend, which draw and clear the drop caret for a
 *     clipboard piece carried over either pane
 *   - the panes registered as where a piece dragged from the clipboard panel lands
 *     (lib/clipboardDropTarget)
 *
 * `dnd` is what useEditorDnd returns, plus `setDragCaret`. Its
 * handlers are read at event time, which is why the effects don't list them.
 */
import { useEffect } from 'react'
import { dragHandoff, DragPayloadKind } from '../bridge'
import { readAnchor } from '../bridge/anchors'
import { setClipboardDropTarget } from '../lib/clipboardDropTarget'
import { getMountedEditorView, isEditorReady } from '../lib/editorUtils'

export function useEditorPaneDragListeners({ editor, secondaryEditor, currentDoc, secondaryDoc, splitView, primaryPaneRef, secondaryPaneRef, dnd }) {
  const {
    setDragCaret,
    handlePaneDragStart,
    handlePaneDragOver,
    handlePaneDrop,
    getDraggedClipboardPayload,
    getTargetEditorAtPoint,
    updateDropCaret,
    hoverClipboardAt,
    previewClipboardAt,
    clearClipboardDrag,
    dropClipboardAt,
  } = dnd

  // Tag drags that start inside an editor's DOM with the selection payload so
  // other drop targets (clipboard panel, opposite pane) know what is moving.
  useEffect(() => {
    const attachDragMeta = (instance, source, docName) => {
      const dom = getMountedEditorView(instance)?.dom
      if (!dom || !instance?.state) return () => {}

      const onDragStart = (event) => {
        const { selection, doc } = instance.state
        if (!selection || selection.empty) return

        const text = doc.textBetween(selection.from, selection.to, '\n')
        if (!text.trim()) return

        const payload = {
          from: selection.from,
          to: selection.to,
          text,
          source,
          docName: docName || '',
        }

        dragHandoff.begin({
          kind: DragPayloadKind.EditorSelection,
          text,
          docPath: docName || null,
          anchor: readAnchor(instance, selection.from, selection.to),
          detail: { source },
        })
        try {
          event.dataTransfer?.setData('application/x-inkblot-editor-selection', JSON.stringify(payload))
          event.dataTransfer?.setData('text/plain', text)
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move'
          }
        } catch (e) {}
      }

      dom.addEventListener('dragstart', onDragStart, true)
      return () => {
        dom.removeEventListener('dragstart', onDragStart, true)
      }
    }

    const offPrimary = attachDragMeta(editor, 'primary', currentDoc)
    const offSecondary = attachDragMeta(secondaryEditor, 'secondary', secondaryDoc)
    return () => {
      offPrimary()
      offSecondary()
    }
  }, [editor, secondaryEditor, currentDoc, secondaryDoc])

  useEffect(() => {
    const pane = primaryPaneRef.current
    if (!pane || !isEditorReady(editor)) return

    const onDragStart = (event) => handlePaneDragStart(event, editor, 'primary', currentDoc)
    const onDragOver = (event) => handlePaneDragOver(event, editor)
    const onDrop = (event) => handlePaneDrop(event, editor)

    pane.addEventListener('dragstart', onDragStart, true)
    pane.addEventListener('dragover', onDragOver, true)
    pane.addEventListener('drop', onDrop, true)

    return () => {
      pane.removeEventListener('dragstart', onDragStart, true)
      pane.removeEventListener('dragover', onDragOver, true)
      pane.removeEventListener('drop', onDrop, true)
    }
  // DnD helpers intentionally read the current editor globals at event time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, currentDoc])

  useEffect(() => {
    const pane = secondaryPaneRef.current
    if (!pane || !isEditorReady(secondaryEditor) || splitView !== 'editor') return

    const onDragStart = (event) => handlePaneDragStart(event, secondaryEditor, 'secondary', secondaryDoc)
    const onDragOver = (event) => handlePaneDragOver(event, secondaryEditor)
    const onDrop = (event) => handlePaneDrop(event, secondaryEditor)

    pane.addEventListener('dragstart', onDragStart, true)
    pane.addEventListener('dragover', onDragOver, true)
    pane.addEventListener('drop', onDrop, true)

    return () => {
      pane.removeEventListener('dragstart', onDragStart, true)
      pane.removeEventListener('dragover', onDragOver, true)
      pane.removeEventListener('drop', onDrop, true)
    }
  // DnD helpers intentionally read the current editor globals at event time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondaryEditor, secondaryDoc, splitView])

  useEffect(() => {
    const onWindowDragOver = (event) => {
      dragHandoff.moveTo(event.clientX, event.clientY)
      const payload = getDraggedClipboardPayload(event)
      if (!payload) {
        setDragCaret(null)
        return
      }

      const targetEditor = getTargetEditorAtPoint(event.clientX, event.clientY)
      if (!targetEditor) {
        setDragCaret(null)
        return
      }

      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
      updateDropCaret(targetEditor, event)
    }

    const onWindowDrag = (event) => {
      dragHandoff.moveTo(event.clientX, event.clientY)
      const session = dragHandoff.current()
      const payload = session?.kind === DragPayloadKind.ClipboardEntry ? session : null
      if (!payload?.text) {
        setDragCaret(null)
        return
      }

      const targetEditor = getTargetEditorAtPoint(event.clientX, event.clientY)
      if (!targetEditor) {
        setDragCaret(null)
        return
      }

      updateDropCaret(targetEditor, event)
    }

    const onWindowDrop = (event) => {
      const payload = getDraggedClipboardPayload(event)
      if (!payload) return

      const targetEditor = getTargetEditorAtPoint(event.clientX, event.clientY)
      if (!targetEditor) return

      handlePaneDrop(event, targetEditor)
    }

    const onWindowDragEnd = (event) => {
      if (!dragHandoff.point() && (event?.clientX || event?.clientY)) {
        dragHandoff.moveTo(event.clientX, event.clientY)
      }
      setDragCaret(null)
    }

    window.addEventListener('drag', onWindowDrag, true)
    window.addEventListener('dragover', onWindowDragOver, true)
    window.addEventListener('drop', onWindowDrop, true)
    window.addEventListener('dragend', onWindowDragEnd, true)

    return () => {
      window.removeEventListener('drag', onWindowDrag, true)
      window.removeEventListener('dragover', onWindowDragOver, true)
      window.removeEventListener('drop', onWindowDrop, true)
      window.removeEventListener('dragend', onWindowDragEnd, true)
    }
  // Window DnD listeners depend on stable DOM globals and active editor refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, secondaryEditor, splitView])

  // The panes are where a clipboard piece dragged from the panel lands
  // (lib/clipboardDropTarget). The handlers read the live editors at event time.
  useEffect(() => setClipboardDropTarget({
    hover: hoverClipboardAt,
    preview: previewClipboardAt,
    clear: clearClipboardDrag,
    drop: dropClipboardAt,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [editor, secondaryEditor, splitView])
}
