/**
 * useEditorDnd — pasting into a pane, and dragging text between panes.
 *
 * Covers the paste handler (images, Pinterest URLs), the drop caret that tracks the
 * pointer through the document, and moving a selection from one pane to another or out
 * to the clipboard panel.
 *
 * **The drag state used to live on `window`.** Four `window.__inkblot_*` variables
 * coordinated one drag across this hook, the clipboard panel, EditorCanvas and
 * Editor — because a drag starts in one React tree and finishes in another, and
 * `dataTransfer` is unreadable during `dragover`, which is exactly when the drop caret
 * needs it. It now goes through `bridge/dragHandoff`, which has the same shape and one
 * owner. See that file for why the drop is *claimed* rather than flagged.
 *
 * Plain functions rather than useCallback, as they were in EditorCanvas: they are
 * re-created each render and only ever called from event handlers, so memoizing
 * them would buy nothing.
 */
import { Fragment } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { dragHandoff, DragPayloadKind } from '../bridge'
import { readAnchor } from '../bridge/anchors'
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

      // A forced-plain-paste branch used to sit here, gated on
      // `window.__inkblot_forcePlainPaste`. Nothing in the app ever set that flag —
      // the "Cmd+Shift+V handler" its comment referred to does not exist — so the
      // branch was unreachable and went out with the rest of the globals. macOS's
      // "Paste and Match Style" is a real thing a native Edit menu will want in
      // Phase 5; it should arrive as a command on the protocol, not as a flag.

      // Nothing special about this paste — let TipTap's default handling preserve
      // formatting, as Cmd+V should.
      return false
    }
  }

  // Resolve the {id, text} being dragged from the clipboard panel, from the
  // dataTransfer payload or the hand-off session. Returns null for drags that
  // originated as editor selections — those move text rather than paste it.
  const getDraggedClipboardPayload = (event) => {
    const transfer = event?.dataTransfer
    const session = dragHandoff.current()
    const sessionEntry = session?.kind === DragPayloadKind.ClipboardEntry ? session : null
    const raw = transfer?.getData('application/x-inkblot-clipboard-entry')
    const plainText = transfer?.getData('text/plain') || ''
    if (!raw && !sessionEntry?.text && !plainText) return null
    if (!raw && !sessionEntry?.text && session?.kind === DragPayloadKind.EditorSelection) return null

    let parsed = null
    if (raw) {
      try { parsed = JSON.parse(raw) } catch (e) {}
    }

    const text = parsed?.text || sessionEntry?.text || plainText
    const id = parsed?.id || sessionEntry?.sourceId || ''
    if (!String(text).trim()) return null
    return { id, text: String(text) }
  }

  const clearDragGlobals = () => { dragHandoff.end() }

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

    // The anchor is what makes this survive an edit the drop target did not see: a
    // drag that ends as a *move* has to delete the source range, and bare positions
    // would have gone stale by then. See bridge/anchors.
    dragHandoff.begin({
      kind: DragPayloadKind.EditorSelection,
      text,
      docPath: docName || null,
      anchor: readAnchor(targetEditor, selection.from, selection.to),
      detail: { source },
    })
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
    // First target to claim it wins; a second drop target seeing the same event gets
    // false and leaves it alone.
    dragHandoff.claim()
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
