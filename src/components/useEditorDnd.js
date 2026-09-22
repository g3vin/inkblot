/**
 * useEditorDnd — pasting into a pane, and dragging text between panes.
 *
 * Covers the paste handler (images, Pinterest URLs, forced plain paste), the drop
 * caret that tracks the pointer through the document, and moving a selection from
 * one pane to another or out to the clipboard panel.
 *
 * Plain functions rather than useCallback, as they were in EditorCanvas: they are
 * re-created each render and only ever called from event handlers, so memoizing
 * them would buy nothing.
 */
import { Fragment } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { normalizePinterestBoardUrl } from '../extensions/PinterestBoard'
import { isEditorReady } from '../lib/editorUtils'

export function useEditorDnd({
  getEditor,
  getMountedEditorView,
  getSecondaryEditor,
  onMoveClipboardEntryToEditor,
  primaryPaneRef,
  secondaryPaneRef,
  setDragCaret,
  splitView,
}) {

  const createPasteHandler = () => {
    return (view, event) => {
      const items = event.clipboardData?.items

      const imageItem = items
        ? Array.from(items).find(item => item.type.startsWith('image/'))
        : null

      if (imageItem) {
        const file = imageItem.getAsFile()
        if (!file) return false

        const reader = new FileReader()
        reader.onload = () => {
          const src = reader.result
          if (typeof src !== 'string') return

          const { schema, tr } = view.state
          const imageNode = schema.nodes.image?.create({ src })
          if (!imageNode) return
          view.dispatch(tr.replaceSelectionWith(imageNode))
        }
        reader.readAsDataURL(file)
        return true
      }

      // Pinterest board auto-embed when pasting a board URL.
      const pastedText = event.clipboardData?.getData('text/plain')
      const boardUrl = normalizePinterestBoardUrl(pastedText)
      if (boardUrl) {
        const { schema, tr, selection } = view.state
        const boardNode = schema.nodes.pinterestBoard?.create({ url: boardUrl })
        if (!boardNode) return false

        const paragraph = schema.nodes.paragraph?.create()
        const fragment = paragraph
          ? Fragment.fromArray([boardNode, paragraph])
          : Fragment.fromArray([boardNode])

        view.dispatch(
          tr
            .replaceRange(selection.from, selection.to, fragment)
            .scrollIntoView()
        )
        return true
      }

      // If a plain-paste was explicitly requested elsewhere (e.g. Cmd+Shift+V handler),
      // handle it here by inserting plain text only. Otherwise, let default paste proceed
      // so normal Cmd+V preserves formatting.
      if (window.__inkblot_forcePlainPaste) {
        try { event.preventDefault(); } catch (e) {}

        const plainTextFromClipboard = event.clipboardData?.getData('text/plain') || ''
        const { tr, selection } = view.state
        tr.insertText(plainTextFromClipboard, selection.from, selection.to)
        view.dispatch(tr.scrollIntoView())
        // reset the flag so subsequent pastes behave normally
        try { window.__inkblot_forcePlainPaste = false } catch (e) {}
        return true
      }

      // Not a forced plain paste — return false to allow TipTap's default paste handling
      return false
    }
  }

  // Resolve the {id, text} being dragged from the clipboard panel, from the
  // dataTransfer payload or the window-global fallbacks. Returns null for
  // drags that originated as editor selections.
  const getDraggedClipboardPayload = (event) => {
    const transfer = event?.dataTransfer
    const globalDragged = window.__inkblot_draggedClipboardEntry
    const globalDraggedEditorSelection = window.__inkblot_draggedEditorSelection
    const raw = transfer?.getData('application/x-inkblot-clipboard-entry')
    const plainText = transfer?.getData('text/plain') || ''
    if (!raw && !globalDragged?.text && !plainText) return null
    if (!raw && !globalDragged?.text && globalDraggedEditorSelection) return null

    let parsed = null
    if (raw) {
      try { parsed = JSON.parse(raw) } catch (e) {}
    }

    const text = parsed?.text || globalDragged?.text || plainText
    const id = parsed?.id || globalDragged?.id || ''
    if (!String(text).trim()) return null
    return { id, text: String(text) }
  }

  const clearDragGlobals = () => {
    try { window.__inkblot_draggedClipboardEntry = null } catch (e) {}
    try { window.__inkblot_draggedEditorSelection = null } catch (e) {}
    try { window.__inkblot_dragPoint = null } catch (e) {}
    try { window.__inkblot_dropHandled = false } catch (e) {}
  }

  const isPointInRect = (x, y, rect) => {
    if (!rect) return false
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }

  const getTargetEditorAtPoint = (x, y) => {
    if (x == null || y == null) return null

    const editor = getEditor()
    const primaryRect = primaryPaneRef.current?.getBoundingClientRect?.()
    if (isEditorReady(editor) && isPointInRect(x, y, primaryRect)) return editor

    const secondaryEditor = getSecondaryEditor()
    const secondaryRect = secondaryPaneRef.current?.getBoundingClientRect?.()
    if (splitView === 'editor' && isEditorReady(secondaryEditor) && isPointInRect(x, y, secondaryRect)) {
      return secondaryEditor
    }

    return null
  }

  // Move the target editor's selection under the drag point and position the
  // visual drop caret within the pane.
  const updateDropCaret = (targetEditor, event) => {
    const view = getMountedEditorView(targetEditor)
    if (!view) return
    const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
    if (!coords?.pos) return

    const nextSelection = TextSelection.create(view.state.doc, coords.pos)
    const samePos =
      view.state.selection.from === nextSelection.from &&
      view.state.selection.to === nextSelection.to

    if (!samePos) {
      view.dispatch(view.state.tr.setSelection(nextSelection))
    }

    const isSecondary = targetEditor === getSecondaryEditor()
    const caretCoords = view.coordsAtPos(coords.pos)
    const paneEl = isSecondary ? secondaryPaneRef.current : primaryPaneRef.current
    const paneRect = paneEl?.getBoundingClientRect?.()
    if (!paneRect || !caretCoords) return

    setDragCaret({
      pane: isSecondary ? 'secondary' : 'primary',
      left: Math.max(0, caretCoords.left - paneRect.left),
      top: Math.max(0, caretCoords.top - paneRect.top),
      height: Math.max(18, caretCoords.bottom - caretCoords.top),
    })
  }

  const handlePaneDragStart = (event, targetEditor, source, docName) => {
    if (!isEditorReady(targetEditor)) return
    const { selection, doc } = targetEditor?.state || {}
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

    try { window.__inkblot_draggedEditorSelection = payload } catch (e) {}
    try { window.__inkblot_dropHandled = false } catch (e) {}
    try {
      event.dataTransfer?.setData('application/x-inkblot-editor-selection', JSON.stringify(payload))
      if (!event.dataTransfer?.getData('text/plain')) {
        event.dataTransfer?.setData('text/plain', text)
      }
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
      }
    } catch (e) {}
  }

  const handlePaneDragOver = (event, targetEditor) => {
    const payload = getDraggedClipboardPayload(event)
    if (!payload || !isEditorReady(targetEditor)) return
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
    updateDropCaret(targetEditor, event)
  }

  const handlePaneDrop = (event, targetEditor) => {
    const payload = getDraggedClipboardPayload(event)
    if (!payload || !getMountedEditorView(targetEditor)) return

    event.preventDefault()
    event.stopPropagation()
    insertClipboardPayloadAtPoint(payload, targetEditor, event.clientX, event.clientY)
  }

  // Insert dragged clipboard text at the drop point and consume the entry.
  const insertClipboardPayloadAtPoint = (payload, targetEditor, x, y) => {
    const view = getMountedEditorView(targetEditor)
    if (!payload || !view) return false
    const coords = view.posAtCoords({ left: x, top: y })
    const insertPos = coords?.pos ?? view.state.selection.from
    const tr = view.state.tr.insertText(payload.text, insertPos, insertPos)
    view.dispatch(tr.scrollIntoView())
    view.focus()
    onMoveClipboardEntryToEditor?.(payload.id)
    try { window.__inkblot_dropHandled = true } catch (e) {}
    setDragCaret(null)
    return true
  }


  return {
    createPasteHandler,
    getDraggedClipboardPayload,
    clearDragGlobals,
    getTargetEditorAtPoint,
    updateDropCaret,
    handlePaneDragStart,
    handlePaneDragOver,
    handlePaneDrop,
    insertClipboardPayloadAtPoint,
  }
}
