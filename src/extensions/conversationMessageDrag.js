/**
 * conversationMessageDrag.js — dragging a message to reorder it within a tile.
 *
 * Hand-rolled pointer dragging with a floating preview row and an insertion slot,
 * because the rows live inside a ProseMirror node view where HTML5 drag would
 * fight the editor's own drag handling.
 *
 * The controller owns the drag state, which is why this is a factory rather than a
 * set of functions: the state is reassigned throughout a drag, and reassigning a
 * destructured parameter would not propagate back to the node view.
 *
 * `getAttrs` is an accessor, not a value: the node view replaces its attribute
 * object on every commit, so a snapshot taken at construction would go stale.
 */
import { clamp, parseNumber } from './conversationModel'

export function createMessageDragController({ commitAttributes, getAttrs, messagesEl }) {
  let manualDragState = null
  let manualDragActive = false
  let messageDropIndex = null
  let messageDropSlot = null
  let messageDragPreview = null

  const reorderMessage = (messageId, targetIndex) => {
    const fromIndex = getAttrs().messages.findIndex(message => message.id === messageId)
    if (fromIndex === -1) return

    const movingMessage = getAttrs().messages[fromIndex]
    const withoutMovingMessage = getAttrs().messages.filter(message => message.id !== messageId)
    const adjustedTargetIndex = clamp(
      targetIndex > fromIndex ? targetIndex - 1 : targetIndex,
      0,
      withoutMovingMessage.length
    )

    const messages = [
      ...withoutMovingMessage.slice(0, adjustedTargetIndex),
      movingMessage,
      ...withoutMovingMessage.slice(adjustedTargetIndex),
    ]

    commitAttributes({ messages, saved: false, snapshot: '' })
  }

  const removeMessageDropSlot = () => {
    messageDropIndex = null
    messageDropSlot?.remove()
    messageDropSlot = null
  }

  const ensureMessageDropSlot = () => {
    if (messageDropSlot) return messageDropSlot
    const slot = document.createElement('div')
    slot.className = 'conversation-drop-slot'
    slot.contentEditable = 'false'
    const inner = document.createElement('div')
    inner.className = 'conversation-drop-slot-inner'
    slot.appendChild(inner)
    messageDropSlot = slot
    return slot
  }

  const setMessageDropIndex = (index) => {
    if (!manualDragState) return
    const nextIndex = clamp(index, 0, getAttrs().messages.length)
    const slot = ensureMessageDropSlot()
    const movingMessage = getAttrs().messages.find(message => message.id === manualDragState.messageId)
    slot.className = [
      'conversation-drop-slot',
      movingMessage?.sender === 'you' ? 'is-outgoing' : 'is-incoming',
    ].join(' ')

    if (messageDropIndex === nextIndex && slot.parentElement === messagesEl) return
    messageDropIndex = nextIndex

    const rows = Array.from(messagesEl.querySelectorAll(':scope > .conversation-message-row'))
    const beforeRow = rows[nextIndex] || null
    messagesEl.insertBefore(slot, beforeRow)
  }

  const updateManualMessageDrag = (clientX, clientY) => {
    const bounds = messagesEl.getBoundingClientRect()
    if (clientY <= bounds.top) {
      setMessageDropIndex(0)
      return
    }
    if (clientY >= bounds.bottom) {
      setMessageDropIndex(getAttrs().messages.length)
      return
    }

    const messageRows = Array.from(messagesEl.querySelectorAll(':scope > .conversation-message-row'))
    const targetRow = messageRows.find((candidate) => {
      const rect = candidate.getBoundingClientRect()
      return clientY >= rect.top && clientY <= rect.bottom
    })
    if (targetRow) {
      const index = parseNumber(targetRow.dataset.messageIndex, -1)
      if (index >= 0) {
        const rect = targetRow.getBoundingClientRect()
        setMessageDropIndex(clientY > rect.top + rect.height / 2 ? index + 1 : index)
        return
      }
    }

    const firstAfterPointer = messageRows.find((candidate) => {
      const rect = candidate.getBoundingClientRect()
      return clientY < rect.top + rect.height / 2
    })
    if (firstAfterPointer) {
      const index = parseNumber(firstAfterPointer.dataset.messageIndex, -1)
      if (index >= 0) {
        setMessageDropIndex(index)
        return
      }
    }
    if (messageRows.length) {
      setMessageDropIndex(getAttrs().messages.length)
      return
    }

    const element = document.elementsFromPoint(clientX, clientY)
      .find(candidate => (
        candidate instanceof HTMLElement &&
        !messageDragPreview?.contains(candidate) &&
        !manualDragState?.row?.contains(candidate)
      ))
    if (!element) return

    const row = element.closest?.('.conversation-message-row')
    if (row && messagesEl.contains(row)) {
      const index = parseNumber(row.dataset.messageIndex, -1)
      if (index >= 0) {
        const rect = row.getBoundingClientRect()
        const insertIndex = clientY > rect.top + rect.height / 2 ? index + 1 : index
        setMessageDropIndex(insertIndex)
        return
      }
    }

    if (element.closest?.('.conversation-column-adders')) {
      setMessageDropIndex(getAttrs().messages.length)
      return
    }
  }

  const updateMessageDragPreview = (clientX, clientY) => {
    if (!messageDragPreview) return
    const offsetX = manualDragState?.offsetX ?? 0
    const offsetY = manualDragState?.offsetY ?? 0
    messageDragPreview.style.transform = `translate(${clientX - offsetX}px, ${clientY - offsetY}px)`
  }

  const createMessageDragPreview = (row, clientX, clientY) => {
    const rect = row.getBoundingClientRect()
    const previewEl = row.cloneNode(true)
    previewEl.classList.add('conversation-drag-preview')
    previewEl.classList.remove('is-dragging')
    previewEl.querySelectorAll('.conversation-message-tools, .conversation-insert-row').forEach(element => {
      element.remove()
    })
    const originalLine = row.querySelector('.conversation-message-line')
    const previewLine = previewEl.querySelector('.conversation-message-line')
    if (originalLine instanceof HTMLElement && previewLine instanceof HTMLElement) {
      const lineRect = originalLine.getBoundingClientRect()
      previewLine.style.width = `${lineRect.width}px`
      previewLine.style.height = `${lineRect.height}px`
    }
    const originalBubble = row.querySelector('.conversation-bubble')
    const previewBubble = previewEl.querySelector('.conversation-bubble')
    if (originalBubble instanceof HTMLElement && previewBubble instanceof HTMLElement) {
      const bubbleRect = originalBubble.getBoundingClientRect()
      previewBubble.style.width = `${bubbleRect.width}px`
      previewBubble.style.height = `${bubbleRect.height}px`
      previewBubble.style.maxWidth = 'none'
    }
    const originalTextareas = Array.from(row.querySelectorAll('textarea'))
    const previewTextareas = Array.from(previewEl.querySelectorAll('textarea'))
    previewTextareas.forEach((textarea, index) => {
      const originalRect = originalTextareas[index]?.getBoundingClientRect()
      textarea.value = originalTextareas[index]?.value || ''
      textarea.readOnly = true
      textarea.tabIndex = -1
      if (originalRect) {
        textarea.style.width = `${originalRect.width}px`
        textarea.style.height = `${originalRect.height}px`
      }
    })
    previewEl.style.width = `${rect.width}px`
    previewEl.style.height = `${rect.height}px`
    previewEl.style.maxWidth = 'none'
    previewEl.style.margin = '0'
    // The preview leaves the tile for the body, so it takes the tile's look along.
    const tile = row.closest('.conversation-node')
    if (tile instanceof HTMLElement) {
      Array.from(tile.style).filter(name => name.startsWith('--conv-'))
        .forEach(name => previewEl.style.setProperty(name, tile.style.getPropertyValue(name)))
    }
    document.body.appendChild(previewEl)
    messageDragPreview = previewEl
    updateMessageDragPreview(clientX, clientY)
  }

  const startManualMessageDrag = (event, message, row) => {
    if (event.button !== 0) return
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('input, textarea, select, button, label, .conversation-message-tools, .conversation-insert-row')
    ) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    manualDragState = {
      messageId: message.id,
      row,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - row.getBoundingClientRect().left,
      offsetY: event.clientY - row.getBoundingClientRect().top,
    }
    manualDragActive = false
  }

  const clearManualMessageDrag = () => {
    manualDragState?.row?.classList.remove('is-dragging')
    manualDragState = null
    manualDragActive = false
    messagesEl.classList.remove('is-reordering')
    removeMessageDropSlot()
    messageDragPreview?.remove()
    messageDragPreview = null
    document.body.classList.remove('conversation-is-dragging-message')
  }

  const onMessageDragMouseMove = (event) => {
    if (!manualDragState) return

    const dx = Math.abs(event.clientX - manualDragState.startX)
    const dy = Math.abs(event.clientY - manualDragState.startY)
    if (!manualDragActive) {
      if (dx + dy < 5) return
      const message = getAttrs().messages.find(item => item.id === manualDragState.messageId)
      if (!message) {
        clearManualMessageDrag()
        return
      }
      manualDragActive = true
      manualDragState.row.classList.add('is-dragging')
      messagesEl.classList.add('is-reordering')
      document.body.classList.add('conversation-is-dragging-message')
      createMessageDragPreview(manualDragState.row, event.clientX, event.clientY)
      window.getSelection?.()?.removeAllRanges?.()
      if (document.activeElement instanceof HTMLElement && manualDragState.row.contains(document.activeElement)) {
        document.activeElement.blur()
      }
    }

    event.preventDefault()
    updateMessageDragPreview(event.clientX, event.clientY)
    updateManualMessageDrag(event.clientX, event.clientY)
  }

  const onMessageDragMouseUp = () => {
    if (!manualDragState) return
    const messageId = manualDragState.messageId
    const targetIndex = messageDropIndex
    const didDrag = manualDragActive
    clearManualMessageDrag()
    if (didDrag && targetIndex != null) {
      reorderMessage(messageId, targetIndex)
    }
  }

  return {
    startManualMessageDrag,
    clearManualMessageDrag,
    onMessageDragMouseMove,
    onMessageDragMouseUp,
  }
}
