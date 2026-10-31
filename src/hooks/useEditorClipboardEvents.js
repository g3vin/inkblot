/**
 * useEditorClipboardEvents — the window listeners that tie the editors to the clipboard
 * panel and the system clipboard, each a hook so Editor calls them in the order their
 * listeners must register:
 *
 *   useClipboardDropBridge    a selection drag that ended over the panel becomes an entry
 *   useSelectionDragTracking  a drag from an editor selection, followed to its dragend:
 *                             back into a pane (a move) or onto the panel (kept there)
 *   useCopyToHistory          every copy, text and images, recorded in the history
 *   usePlainPasteShortcut     ⌘⇧V pastes the clipboard as plain text
 *
 * All four listen in the capture phase or on window, because native drag and clipboard
 * events cross React's boundaries.
 */
import { useEffect } from 'react'
import { dragHandoff, DragPayloadKind, editorRegistry } from '../bridge'
import { EDITOR_DRAGEND_DROP_TO_CLIPBOARD, EDITOR_SELECTION_DRAGEND } from '../lib/appEvents'

/** Return a TipTap editor's live ProseMirror view, or null if unmounted/destroyed. */
const getMountedEditorView = (instance) => {
  if (!instance || instance.isDestroyed) return null
  const view = instance.editorView
  if (!view || view.isDestroyed) return null
  return view
}

export function useClipboardDropBridge(handleDropToClipboard) {
  // Bridge: EditorCanvas fires this event when a selection drag ends over the clipboard panel.
  useEffect(() => {
    const onEditorDragEndDropToClipboard = (event) => {
      const detail = event?.detail || {}
      handleDropToClipboard({
        text: detail.text || '',
        fromEditorSelection: true,
        selection: detail.selection || null,
      })
    }

    window.addEventListener(EDITOR_DRAGEND_DROP_TO_CLIPBOARD, onEditorDragEndDropToClipboard)
    return () => {
      window.removeEventListener(EDITOR_DRAGEND_DROP_TO_CLIPBOARD, onEditorDragEndDropToClipboard)
    }
  }, [handleDropToClipboard])
}

export function useSelectionDragTracking({ editor, secondaryEditor, currentDoc, secondaryDoc, draggedSelectionRef, getClipboardDropZoneRect, isPointInAnyEditorPane }) {
  // Track drags that start from an editor selection so we can tell, on dragend,
  // whether the text was dropped back into an editor pane (reorder) or onto the
  // clipboard panel (move to clipboard). State is mirrored on window globals
  // because native drag events cross React boundaries.
  useEffect(() => {
    const onDragStart = (event) => {
      const targetNode = event?.target
      const targetElement =
        targetNode instanceof Element ? targetNode :
          targetNode instanceof Node ? targetNode.parentElement : null
      if (!targetElement) return

      const paneEl = targetElement.closest('.primary-pane, .secondary-pane')
      if (!paneEl) return

      const isSecondary = paneEl.classList.contains('secondary-pane')
      const sourceEditor = isSecondary ? secondaryEditor : editor
      const sourceDocName = isSecondary ? secondaryDoc : currentDoc
      if (!sourceEditor?.state?.selection) return

      const { from, to, empty } = sourceEditor.state.selection
      if (empty) return

      const selectedText = sourceEditor.state.doc.textBetween(from, to, '\n')
      if (!selectedText.trim()) return

      const payload = {
        from,
        to,
        text: selectedText,
        source: isSecondary ? 'secondary' : 'primary',
        docName: sourceDocName || '',
      }

      draggedSelectionRef.current = payload
      dragHandoff.begin({
        kind: DragPayloadKind.EditorSelection,
        text: selectedText,
        docPath: sourceDocName || null,
        anchor: { from, to, text: selectedText },
        detail: { source: payload.source },
      })

      try {
        event.dataTransfer?.setData('application/x-inkblot-editor-selection', JSON.stringify(payload))
        if (!event.dataTransfer?.getData('text/plain')) {
          event.dataTransfer?.setData('text/plain', selectedText)
        }
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move'
        }
      } catch (e) {}
    }

    const onDragEnd = (event) => {
      const session = dragHandoff.current()
      const draggedSelection = draggedSelectionRef.current
        || (session?.kind === DragPayloadKind.EditorSelection
          ? {
              text: session.text,
              from: session.anchor?.from,
              to: session.anchor?.to,
              source: session.detail?.source,
              docName: session.docPath || '',
            }
          : null)
      if (!draggedSelection) return

      const held = dragHandoff.point()
      const point = {
        x: event?.clientX ?? held?.x ?? null,
        y: event?.clientY ?? held?.y ?? null,
      }

      // The timeout is load-bearing: a drop handler on another target runs after this
      // dragend, and clearing the hand-off synchronously would take the payload out
      // from under it.
      const finish = () => window.setTimeout(() => {
        draggedSelectionRef.current = null
        dragHandoff.end({ x: point.x, y: point.y })
      }, 0)

      const endedInEditorPane = isPointInAnyEditorPane(point.x, point.y)
      if (endedInEditorPane) {
        finish()
        return
      }

      try {
        window.dispatchEvent(new CustomEvent(EDITOR_SELECTION_DRAGEND, {
          detail: {
            selection: draggedSelection,
            x: point.x,
            y: point.y,
          },
        }))
      } catch (e) {}

      const rect = getClipboardDropZoneRect()
      const endedOverClipboard = Boolean(
        draggedSelection?.text &&
        rect &&
        point.x != null &&
        point.y != null &&
        point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top &&
        point.y <= rect.bottom
      )

      if (endedOverClipboard && dragHandoff.claim()) {
        try {
          window.dispatchEvent(new CustomEvent(EDITOR_DRAGEND_DROP_TO_CLIPBOARD, {
            detail: {
              text: draggedSelection.text,
              selection: draggedSelection,
              x: point.x,
              y: point.y,
            },
          }))
        } catch (e) {}
      }

      finish()
    }

    window.addEventListener('dragstart', onDragStart, true)
    window.addEventListener('dragend', onDragEnd, true)

    return () => {
      window.removeEventListener('dragstart', onDragStart, true)
      window.removeEventListener('dragend', onDragEnd, true)
    }
  }, [currentDoc, draggedSelectionRef, editor, getClipboardDropZoneRect, isPointInAnyEditorPane, secondaryDoc, secondaryEditor])
}

export function useCopyToHistory({ addClipboardEntry, addClipboardImage }) {
  // Record every copy (from the editor or any input) into the clipboard history.
  useEffect(() => {
    const getSelectedText = (target) => {
      const selectedInWindow = window.getSelection?.()?.toString?.()
      if (selectedInWindow) return selectedInWindow

      if (target && typeof target.value === 'string') {
        const start = target.selectionStart
        const end = target.selectionEnd
        if (typeof start === 'number' && typeof end === 'number' && end > start) {
          return target.value.slice(start, end)
        }
      }

      return ''
    }

    // The images in what is being copied. In a page that is the editor's selection,
    // which sees a selected picture (its DOM selection need not hold the img);
    // anywhere else, the images inside the window's selection.
    const getSelectedImages = (target) => {
      const live = editorRegistry.active()?.editor
      if (live?.view?.dom?.contains?.(target)) {
        const { from, to } = live.state.selection
        const sources = []
        live.state.doc.nodesBetween(from, to, (node) => {
          if (node.type.name === 'image' && node.attrs.src) sources.push(node.attrs.src)
        })
        return sources
      }

      const selection = window.getSelection?.()
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return []
      const fragment = selection.getRangeAt(0).cloneContents()
      return Array.from(fragment.querySelectorAll('img'), (img) => img.getAttribute('src')).filter(Boolean)
    }

    const onCopy = (event) => {
      const text = getSelectedText(event?.target)
      addClipboardEntry(text)
      // Oldest first, so the first image in the selection ends up on top.
      getSelectedImages(event?.target).reverse().forEach(addClipboardImage)
    }

    window.addEventListener('copy', onCopy, true)

    return () => {
      window.removeEventListener('copy', onCopy, true)
    }
  }, [addClipboardEntry, addClipboardImage])
}

export function usePlainPasteShortcut({ activeEditor, editor, secondaryEditor }) {
  // Cmd+Shift+V: paste clipboard contents as plain text (HTML/styles stripped).
  useEffect(() => {
    const handlePastePlain = async (event) => {
      if (!(event.metaKey && event.shiftKey && event.key?.toLowerCase() === 'v')) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()

      try {
        const clipboardText = await navigator.clipboard.readText()
        const doc = new DOMParser().parseFromString(clipboardText, 'text/html')
        const plainText = doc.body.textContent || ''

        // Prefer the focused TipTap editor, then its raw ProseMirror view,
        // then whatever editable element currently has focus.
        const targetEditor = activeEditor || editor || secondaryEditor
        if (typeof targetEditor?.chain === 'function') {
          targetEditor.chain().focus().insertContent(plainText).run()
          return
        }

        const view = getMountedEditorView(targetEditor)
        if (view?.state && view.dispatch) {
          view.dispatch(view.state.tr.insertText(plainText).scrollIntoView())
          view.dom?.focus?.()
          return
        }

        const activeEl = document.activeElement
        if (activeEl && (activeEl.isContentEditable || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT')) {
          if (typeof activeEl.setRangeText === 'function') {
            try {
              activeEl.setRangeText(plainText)
            } catch {
              activeEl.value = (activeEl.value || '') + plainText
            }
          } else if (typeof document.execCommand === 'function') {
            document.execCommand('insertText', false, plainText)
          } else {
            activeEl.textContent = (activeEl.textContent || '') + plainText
          }
          try { activeEl.focus() } catch {}
          return
        }

        console.error('No suitable editor target to paste into.')
      } catch (error) {
        console.error('Failed to read clipboard content:', error)
      }
    }

    // Capture phase so this runs before TipTap's own paste handling.
    window.addEventListener('keydown', handlePastePlain, { capture: true })
    return () => window.removeEventListener('keydown', handlePastePlain, { capture: true })
  }, [activeEditor, editor, secondaryEditor])
}
