/**
 * ConversationTile.js — embeddable fake text-message conversation node.
 *
 * A block node that renders an iMessage-style chat mockup for writing
 * dialogue: named participants (1:1 or group), editable message bubbles
 * with photos and read receipts, per-side colors, and alignment/width
 * controls. All state lives in node attributes (messages/participants
 * serialized as JSON strings), and the node renders a static HTML
 * "snapshot" attribute so saved documents can display the tile without
 * the interactive node view.
 */
import { Node } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { createResizeIconElement } from '../lib/resizeIcon'

import {
  DEFAULT_ATTRS,
  DEFAULT_GROUP_MEMBERS,
  DEFAULT_MESSAGES,
  DEFAULT_PARTICIPANTS,
  DEFAULT_WIDTH,
  MAX_SNAPSHOT_WIDTH,
  MESSAGE_RECEIPTS,
  MESSAGE_RECEIPT_LABELS,
  MIN_WIDTH,
  clamp,
  getInitials,
  makeId,
  measureTextWidth,
  normalizeAlignment,
  normalizeAttrs,
  normalizeParticipants,
  parseNumber,
  safeJsonParse,
} from './conversationModel'
import { buildSnapshot, estimateSnapshotHeight } from './conversationSnapshot'
import { makeButton, makeColorInput, makeTextInput, readImageFile } from './conversationWidgets'
import { createMessageDragController } from './conversationMessageDrag'

const ConversationTile = Node.create({
  name: 'conversationTile',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      width: {
        default: DEFAULT_WIDTH,
        parseHTML: element => parseNumber(element.getAttribute('data-width'), DEFAULT_WIDTH),
        renderHTML: attributes => ({ 'data-width': attributes.width || DEFAULT_WIDTH }),
      },
      align: {
        default: 'left',
        parseHTML: element => normalizeAlignment(element.getAttribute('data-align')),
        renderHTML: attributes => {
          const align = normalizeAlignment(attributes.align)
          return align !== 'left' ? { 'data-align': align } : {}
        },
      },
      saved: {
        default: false,
        parseHTML: element => element.getAttribute('data-saved') === 'true',
        renderHTML: attributes => attributes.saved ? { 'data-saved': 'true' } : {},
      },
      snapshot: {
        default: '',
        parseHTML: element => element.getAttribute('data-snapshot') || '',
        renderHTML: attributes => attributes.snapshot ? { 'data-snapshot': attributes.snapshot } : {},
      },
      snapshotHeight: {
        default: null,
        parseHTML: element => parseNumber(element.getAttribute('data-snapshot-height'), null),
        renderHTML: attributes => attributes.snapshotHeight ? { 'data-snapshot-height': attributes.snapshotHeight } : {},
      },
      groupChat: {
        default: false,
        parseHTML: element => element.getAttribute('data-group-chat') === 'true',
        renderHTML: attributes => attributes.groupChat ? { 'data-group-chat': 'true' } : {},
      },
      showTimestamps: {
        default: true,
        parseHTML: element => element.getAttribute('data-show-timestamps') !== 'false',
        renderHTML: attributes => attributes.showTimestamps === false ? { 'data-show-timestamps': 'false' } : {},
      },
      showReadReceipts: {
        default: false,
        parseHTML: element => element.getAttribute('data-show-read-receipts') === 'true',
        renderHTML: attributes => attributes.showReadReceipts ? { 'data-show-read-receipts': 'true' } : {},
      },
      outgoingColor: {
        default: DEFAULT_ATTRS.outgoingColor,
        parseHTML: element => element.getAttribute('data-outgoing-color') || DEFAULT_ATTRS.outgoingColor,
        renderHTML: attributes => ({ 'data-outgoing-color': attributes.outgoingColor || DEFAULT_ATTRS.outgoingColor }),
      },
      incomingColor: {
        default: DEFAULT_ATTRS.incomingColor,
        parseHTML: element => element.getAttribute('data-incoming-color') || DEFAULT_ATTRS.incomingColor,
        renderHTML: attributes => ({ 'data-incoming-color': attributes.incomingColor || DEFAULT_ATTRS.incomingColor }),
      },
      outgoingTextColor: {
        default: DEFAULT_ATTRS.outgoingTextColor,
        parseHTML: element => element.getAttribute('data-outgoing-text-color') || DEFAULT_ATTRS.outgoingTextColor,
        renderHTML: attributes => ({
          'data-outgoing-text-color': attributes.outgoingTextColor || DEFAULT_ATTRS.outgoingTextColor,
        }),
      },
      incomingTextColor: {
        default: DEFAULT_ATTRS.incomingTextColor,
        parseHTML: element => element.getAttribute('data-incoming-text-color') || DEFAULT_ATTRS.incomingTextColor,
        renderHTML: attributes => ({
          'data-incoming-text-color': attributes.incomingTextColor || DEFAULT_ATTRS.incomingTextColor,
        }),
      },
      participants: {
        default: DEFAULT_PARTICIPANTS,
        parseHTML: element => normalizeParticipants(safeJsonParse(element.getAttribute('data-participants'), DEFAULT_PARTICIPANTS)),
        renderHTML: attributes => ({ 'data-participants': JSON.stringify(normalizeParticipants(attributes.participants)) }),
      },
      groupMembers: {
        default: DEFAULT_GROUP_MEMBERS,
        parseHTML: element => safeJsonParse(element.getAttribute('data-group-members'), DEFAULT_GROUP_MEMBERS),
        renderHTML: attributes => ({ 'data-group-members': JSON.stringify(attributes.groupMembers || DEFAULT_GROUP_MEMBERS) }),
      },
      messages: {
        default: DEFAULT_MESSAGES,
        parseHTML: element => safeJsonParse(element.getAttribute('data-messages'), DEFAULT_MESSAGES),
        renderHTML: attributes => ({ 'data-messages': JSON.stringify(attributes.messages || DEFAULT_MESSAGES) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-conversation-tile]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-conversation-tile': 'true' }]
  },

  addCommands() {
    return {
      insertConversationTile: attrs => ({ commands }) => commands.insertContent({
        type: this.name,
        attrs: normalizeAttrs({
          ...DEFAULT_ATTRS,
          ...(attrs || {}),
          saved: false,
          snapshot: '',
        }),
      }),
    }
  },

  addNodeView() {
    return ({ node, getPos, view }) => {
      let currentNode = node
      let currentAttrs = normalizeAttrs(node.attrs)
      let isSelected = false
      let pendingFocusState = null
      let pointerInsideUntil = 0
      let membersMenuOpen = false
      let previewUntilEdit = !currentAttrs.saved
      const disposers = []

      const container = document.createElement('div')
      container.className = 'conversation-node'
      container.contentEditable = 'false'

      const toolbar = document.createElement('div')
      toolbar.className = 'conversation-toolbar'
      toolbar.contentEditable = 'false'

      const body = document.createElement('div')
      body.className = 'conversation-body'
      body.contentEditable = 'false'

      const preview = document.createElement('div')
      preview.className = 'conversation-saved-preview'
      preview.contentEditable = 'false'

      const composer = document.createElement('div')
      composer.className = 'conversation-composer'
      composer.contentEditable = 'false'

      const messagesEl = document.createElement('div')
      messagesEl.className = 'conversation-messages'
      messagesEl.contentEditable = 'false'

      const resizeHandle = document.createElement('span')
      resizeHandle.className = 'conversation-resize-handle'
      resizeHandle.contentEditable = 'false'
      resizeHandle.appendChild(createResizeIconElement())

      const selectNode = () => {
        const pos = typeof getPos === 'function' ? getPos() : null
        if (pos == null) return
        const { state, dispatch } = view
        dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)))
      }

      const commitAttributes = (attrs, options = {}) => {
        const { focusControlId = '', selectNodeAfter = true } = options
        const pos = typeof getPos === 'function' ? getPos() : null
        if (pos == null) return
        pendingFocusState = focusControlId
          ? { controlId: focusControlId, start: 0, end: 0 }
          : selectNodeAfter ? captureActiveControl() : null
        const nextAttrs = normalizeAttrs({
          ...currentAttrs,
          ...attrs,
        })
        currentAttrs = nextAttrs

        const { state, dispatch } = view
        const tr = state.tr.setNodeMarkup(pos, undefined, nextAttrs)
        if (selectNodeAfter) {
          tr.setSelection(NodeSelection.create(tr.doc, pos))
        }
        dispatch(tr)
      }

      const captureActiveControl = () => {
        const active = document.activeElement
        if (!(active instanceof HTMLElement) || !container.contains(active)) return null
        const controlId = active.dataset?.controlId
        if (!controlId) return null
        const start = typeof active.selectionStart === 'number' ? active.selectionStart : null
        const end = typeof active.selectionEnd === 'number' ? active.selectionEnd : start
        return { controlId, start, end }
      }

      const restoreActiveControl = (focusState) => {
        if (!focusState?.controlId) return
        window.requestAnimationFrame(() => {
          const target = Array.from(container.querySelectorAll('[data-control-id]'))
            .find(element => element.dataset.controlId === focusState.controlId)
          if (!(target instanceof HTMLElement)) return
          window.requestAnimationFrame(() => {
            target.focus({ preventScroll: true })
            if (
              typeof target.setSelectionRange === 'function' &&
              typeof focusState.start === 'number' &&
              typeof focusState.end === 'number'
            ) {
              target.setSelectionRange(focusState.start, focusState.end)
            }
          })
        })
      }

      const updateMessage = (id, patch) => {
        const messages = currentAttrs.messages.map(message => (
          message.id === id ? { ...message, ...patch } : message
        ))
        commitAttributes({ messages, saved: false, snapshot: '' })
      }

      const removeMessage = (id) => {
        if (currentAttrs.messages.length <= 1) return
        commitAttributes({
          messages: currentAttrs.messages.filter(message => message.id !== id),
          saved: false,
          snapshot: '',
        })
      }

      const getIncomingMembers = () => {
        const youName = currentAttrs.participants.you?.trim().toLowerCase()
        const members = currentAttrs.groupMembers
          .filter(member => member.id !== 'you' && member.name?.trim().toLowerCase() !== youName)
        return members.length ? members : [{ id: 'them', name: currentAttrs.participants.them, avatarSrc: '' }]
      }

      const getIncomingNames = () => {
        const names = getIncomingMembers().map(member => member.name?.trim()).filter(Boolean)
        return names.length ? names : [DEFAULT_PARTICIPANTS.them]
      }

      const getMemberForMessage = (message) => currentAttrs.groupMembers.find(member => (
        member.name === message.name ||
        (message.sender === 'you' && member.id === 'you') ||
        (message.sender === 'them' && member.id === 'them' && message.name === currentAttrs.participants.them)
      ))

      const makeAvatar = (message, className) => {
        const member = getMemberForMessage(message)
        const avatar = document.createElement('span')
        avatar.className = className
        avatar.contentEditable = 'false'

        if (member?.avatarSrc) {
          const image = document.createElement('img')
          image.src = member.avatarSrc
          image.alt = ''
          image.draggable = false
          avatar.appendChild(image)
        } else {
          avatar.textContent = getInitials(message.name || currentAttrs.participants[message.sender])
        }

        return avatar
      }

      const updateGroupMember = (id, patch) => {
        const existing = currentAttrs.groupMembers.find(member => member.id === id)
        if (!existing) return

        const nextName = typeof patch.name === 'string' ? patch.name.trim() : existing.name
        const groupMembers = currentAttrs.groupMembers.map(member => (
          member.id === id ? { ...member, ...patch, name: nextName || existing.name } : member
        ))
        const messages = typeof patch.name === 'string' && nextName
          ? currentAttrs.messages.map(message => (
            message.name === existing.name ? { ...message, name: nextName } : message
          ))
          : currentAttrs.messages
        const participants = {
          ...currentAttrs.participants,
          ...(id === 'you' && nextName ? { you: nextName } : {}),
          ...(id === 'them' && nextName ? { them: nextName } : {}),
        }

        commitAttributes({ groupMembers, messages, participants, saved: false, snapshot: '' })
      }

      const addGroupMember = () => {
        const baseName = 'New Person'
        const existingNames = new Set(currentAttrs.groupMembers.map(member => member.name))
        let name = baseName
        let count = 2
        while (existingNames.has(name)) {
          name = `${baseName} ${count}`
          count += 1
        }
        commitAttributes({
          groupMembers: [
            ...currentAttrs.groupMembers,
            { id: makeId(), name, avatarSrc: '' },
          ],
          saved: false,
          snapshot: '',
        })
      }

      const removeGroupMember = (id) => {
        if (id === 'you' || currentAttrs.groupMembers.length <= 2) return
        const removing = currentAttrs.groupMembers.find(member => member.id === id)
        const fallbackName = currentAttrs.participants.them || DEFAULT_PARTICIPANTS.them
        const messages = removing
          ? currentAttrs.messages.map(message => (
            message.name === removing.name ? { ...message, name: fallbackName } : message
          ))
          : currentAttrs.messages

        commitAttributes({
          groupMembers: currentAttrs.groupMembers.filter(member => member.id !== id),
          messages,
          saved: false,
          snapshot: '',
        })
      }

      const makeMessage = (sender = 'them', name = '') => {
        const participants = normalizeParticipants(currentAttrs.participants)
        const now = new Date()
        const timestamp = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        return {
          id: makeId(),
          sender,
          name: name || participants[sender],
          text: '',
          timestamp,
          receiptStatus: sender === 'you' ? 'delivered' : '',
          imageSrc: '',
        }
      }

      const insertMessage = (sender = 'them', index = currentAttrs.messages.length, name = '') => {
        const message = makeMessage(sender, name)
        const insertIndex = clamp(index, 0, currentAttrs.messages.length)
        const messages = [
          ...currentAttrs.messages.slice(0, insertIndex),
          message,
          ...currentAttrs.messages.slice(insertIndex),
        ]
        commitAttributes(
          { messages, saved: false, snapshot: '' },
          { focusControlId: `${message.id}-text` }
        )
      }

      const {
        startManualMessageDrag,
        clearManualMessageDrag,
        onMessageDragMouseMove,
        onMessageDragMouseUp,
      } = createMessageDragController({
        commitAttributes,
        getAttrs: () => currentAttrs,
        messagesEl,
      })


      const getMeasuredSnapshotHeight = () => {
        const measured = Math.ceil(composer.scrollHeight || messagesEl.scrollHeight || 0)
        return clamp(measured || estimateSnapshotHeight(currentAttrs, currentAttrs.width), 110, 2200)
      }

      const saveSnapshot = (options = {}) => {
        const snapshotHeight = getMeasuredSnapshotHeight()
        const snapshot = buildSnapshot(currentAttrs, snapshotHeight)
        previewUntilEdit = false
        commitAttributes({ snapshot, snapshotHeight, saved: true }, options)
      }

      const editConversation = () => {
        previewUntilEdit = false
        currentAttrs = normalizeAttrs({
          ...currentAttrs,
          saved: false,
        })
        syncView()
        commitAttributes({ saved: false })
      }

      const renderToolbar = () => {
        toolbar.textContent = ''

        const groupLabel = document.createElement('label')
        groupLabel.className = 'conversation-toggle-control'
        groupLabel.contentEditable = 'false'
        const groupCheckbox = document.createElement('input')
        groupCheckbox.type = 'checkbox'
        groupCheckbox.checked = currentAttrs.groupChat
        groupCheckbox.addEventListener('change', () => {
          if (!groupCheckbox.checked) membersMenuOpen = false
          commitAttributes({
            groupChat: groupCheckbox.checked,
            saved: false,
            snapshot: '',
          })
        })
        groupLabel.append(groupCheckbox, document.createTextNode('Group'))

        const timeLabel = document.createElement('label')
        timeLabel.className = 'conversation-toggle-control'
        timeLabel.contentEditable = 'false'
        const timeCheckbox = document.createElement('input')
        timeCheckbox.type = 'checkbox'
        timeCheckbox.checked = currentAttrs.showTimestamps
        timeCheckbox.addEventListener('change', () => commitAttributes({
          showTimestamps: timeCheckbox.checked,
          saved: false,
          snapshot: '',
        }))
        timeLabel.append(timeCheckbox, document.createTextNode('Time'))

        const receiptsLabel = document.createElement('label')
        receiptsLabel.className = 'conversation-toggle-control'
        receiptsLabel.contentEditable = 'false'
        const receiptsCheckbox = document.createElement('input')
        receiptsCheckbox.type = 'checkbox'
        receiptsCheckbox.checked = currentAttrs.showReadReceipts
        receiptsCheckbox.addEventListener('change', () => commitAttributes({
          showReadReceipts: receiptsCheckbox.checked,
          saved: false,
          snapshot: '',
        }))
        receiptsLabel.append(receiptsCheckbox, document.createTextNode('Receipts'))

        const outgoingColor = makeColorInput('Outgoing bubble color', currentAttrs.outgoingColor, value => {
          commitAttributes({ outgoingColor: value, saved: false, snapshot: '' })
        })
        const incomingColor = makeColorInput('Incoming bubble color', currentAttrs.incomingColor, value => {
          commitAttributes({ incomingColor: value, saved: false, snapshot: '' })
        })

        const membersControl = document.createElement('div')
        membersControl.className = 'conversation-members-control'
        membersControl.contentEditable = 'false'
        const membersButton = makeButton(
          'Members',
          'Edit group members',
          () => {
            membersMenuOpen = !membersMenuOpen
            syncView()
          },
          membersMenuOpen ? 'active' : ''
        )
        membersControl.appendChild(membersButton)

        if (currentAttrs.groupChat && membersMenuOpen) {
          const membersMenu = document.createElement('div')
          membersMenu.className = 'conversation-members-menu'
          membersMenu.contentEditable = 'false'
          membersMenu.addEventListener('pointerdown', event => event.stopPropagation())

          currentAttrs.groupMembers.forEach((member) => {
            const row = document.createElement('div')
            row.className = 'conversation-member-row'

            const avatar = document.createElement('span')
            avatar.className = 'conversation-member-avatar'
            if (member.avatarSrc) {
              const image = document.createElement('img')
              image.src = member.avatarSrc
              image.alt = ''
              image.draggable = false
              avatar.appendChild(image)
            } else {
              avatar.textContent = getInitials(member.name)
            }

            const name = makeTextInput(member.name, 'Member name', value => {
              updateGroupMember(member.id, { name: value })
            }, `member-${member.id}-name`)

            const photoLabel = document.createElement('label')
            photoLabel.className = 'conversation-member-photo'
            photoLabel.textContent = member.avatarSrc ? 'Change PFP' : 'Add PFP'
            const photoInput = document.createElement('input')
            photoInput.type = 'file'
            photoInput.accept = 'image/*'
            photoInput.setAttribute('aria-label', `Profile picture for ${member.name}`)
            photoInput.addEventListener('change', () => {
              readImageFile(photoInput.files?.[0], avatarSrc => updateGroupMember(member.id, { avatarSrc }))
              photoInput.value = ''
            })
            photoLabel.appendChild(photoInput)

            const removeControl = member.id === 'you' || currentAttrs.groupMembers.length <= 2
              ? document.createElement('span')
              : makeButton('x', `Remove ${member.name}`, () => removeGroupMember(member.id))

            row.append(
              avatar,
              name,
              photoLabel,
              removeControl,
            )
            membersMenu.appendChild(row)
          })

          membersMenu.appendChild(
            makeButton('+ Member', 'Add group member', addGroupMember, 'conversation-add-member-button')
          )
          membersControl.appendChild(membersMenu)
        }

        toolbar.append(
          groupLabel,
          currentAttrs.groupChat ? membersControl : document.createTextNode(''),
          timeLabel,
          receiptsLabel,
          outgoingColor,
          incomingColor,
        )
      }

      const layoutMessageTextarea = (textarea, value = '') => {
        const maxTextWidth = Math.max(72, Math.min(320, currentAttrs.width * 0.78 - 24))
        const computedStyle = window.getComputedStyle(textarea)
        const font = computedStyle.font || '15px sans-serif'
        const measuredWidth = Math.max(
          measureTextWidth('Message', font),
          ...String(value || '').split('\n').map(line => measureTextWidth(line || ' ', font))
        )
        const nextWidth = clamp(Math.ceil(measuredWidth) + 4, 64, maxTextWidth)

        textarea.style.width = `${nextWidth}px`
        textarea.style.height = 'auto'
        textarea.style.height = `${Math.max(20, textarea.scrollHeight)}px`
      }

      const makePersonPicker = (defaultName = '') => {
        const picker = document.createElement('select')
        picker.className = 'conversation-add-person'
        picker.setAttribute('aria-label', 'Person')
        getIncomingNames().forEach((name) => {
          const option = document.createElement('option')
          option.value = name
          option.textContent = name
          picker.appendChild(option)
        })
        picker.value = defaultName || currentAttrs.participants.them
        picker.addEventListener('pointerdown', event => event.stopPropagation())
        return picker
      }

      const makeInsertControl = (sender, insertIndex, defaultName = '') => {
        const row = document.createElement('div')
        row.className = [
          'conversation-insert-row',
          sender === 'you' ? 'is-outgoing' : 'is-incoming',
        ].join(' ')
        row.contentEditable = 'false'

        const picker = currentAttrs.groupChat && sender === 'them'
          ? makePersonPicker(defaultName)
          : null

        const button = makeButton('+', 'Add message here', () => {
          insertMessage(sender, insertIndex, picker?.value || defaultName)
        }, 'conversation-insert-button')

        if (picker) row.appendChild(picker)
        row.appendChild(button)
        return row
      }

      const renderMessageEditor = (message, index, messages) => {
        const row = document.createElement('div')
        const previous = messages[index - 1]
        const next = messages[index + 1]
        const isOutgoing = message.sender === 'you'
        const sameAsPrevious = previous?.sender === message.sender &&
          (!currentAttrs.groupChat || isOutgoing || previous.name === message.name)
        const sameAsNext = next?.sender === message.sender &&
          (!currentAttrs.groupChat || isOutgoing || next.name === message.name)
        const showAvatar = currentAttrs.groupChat && !isOutgoing

        row.className = [
          'conversation-message-row',
          isOutgoing ? 'is-outgoing' : 'is-incoming',
          showAvatar ? 'has-avatar' : '',
          sameAsPrevious ? 'continues-before' : '',
          sameAsNext ? 'continues-after' : '',
        ].filter(Boolean).join(' ')
        row.contentEditable = 'false'
        row.dataset.messageId = message.id
        row.dataset.messageIndex = String(index)
        row.addEventListener('pointerdown', (event) => {
          if (
            event.target instanceof HTMLElement &&
            event.target.closest('input, textarea, select, button, label, .conversation-message-tools, .conversation-insert-row')
          ) {
            return
          }
          event.stopPropagation()
        })
        row.addEventListener('mousedown', event => startManualMessageDrag(event, message, row))
        row.addEventListener('dragstart', (event) => {
          event.preventDefault()
          event.stopPropagation()
        })

        if (currentAttrs.groupChat && !isOutgoing && !sameAsPrevious) {
          const name = makePersonPicker(message.name || currentAttrs.participants[message.sender])
          name.classList.add('conversation-message-name')
          name.dataset.controlId = `${message.id}-name`
          name.addEventListener('change', () => updateMessage(message.id, { name: name.value }))
          row.appendChild(name)
        }

        const messageLine = document.createElement('div')
        messageLine.className = [
          'conversation-message-line',
          showAvatar ? 'has-avatar' : '',
        ].filter(Boolean).join(' ')

        const bubble = document.createElement('div')
        bubble.className = 'conversation-bubble'
        bubble.style.background = isOutgoing ? currentAttrs.outgoingColor : currentAttrs.incomingColor
        bubble.style.color = isOutgoing ? currentAttrs.outgoingTextColor : currentAttrs.incomingTextColor

        if (message.imageSrc) {
          const imageWrap = document.createElement('div')
          imageWrap.className = 'conversation-image-wrap'
          const image = document.createElement('img')
          image.src = message.imageSrc
          image.alt = ''
          image.draggable = false
          const removeImage = makeButton('x', 'Remove image', () => updateMessage(message.id, { imageSrc: '' }))
          imageWrap.append(image, removeImage)
          bubble.appendChild(imageWrap)
        }

        const textarea = document.createElement('textarea')
        textarea.value = message.text
        textarea.placeholder = 'Message'
        textarea.rows = 1
        textarea.wrap = 'soft'
        textarea.setAttribute('aria-label', 'Message text')
        textarea.dataset.controlId = `${message.id}-text`
        const stopTextInteraction = event => event.stopPropagation()
        textarea.addEventListener('pointerdown', stopTextInteraction)
        textarea.addEventListener('mousedown', stopTextInteraction)
        textarea.addEventListener('mouseup', stopTextInteraction)
        textarea.addEventListener('click', stopTextInteraction)
        textarea.addEventListener('focus', () => {
          isSelected = true
          container.classList.add('is-selected')
          toolbar.style.display = 'flex'
          resizeHandle.style.display = 'inline-flex'
        })
        textarea.addEventListener('input', () => {
          layoutMessageTextarea(textarea, textarea.value)
          updateMessage(message.id, { text: textarea.value })
        })
        bubble.appendChild(textarea)

        const imageLabel = document.createElement('label')
        imageLabel.className = 'conversation-attach-image conversation-bubble-attach'
        imageLabel.textContent = 'Attach Image'
        imageLabel.setAttribute('aria-label', 'Attach image')
        imageLabel.addEventListener('pointerdown', event => event.stopPropagation())
        const imageInput = document.createElement('input')
        imageInput.type = 'file'
        imageInput.accept = 'image/*'
        imageInput.setAttribute('aria-label', 'Add image')
        imageInput.addEventListener('change', () => {
          readImageFile(imageInput.files?.[0], imageSrc => updateMessage(message.id, { imageSrc }))
          imageInput.value = ''
        })
        imageLabel.appendChild(imageInput)
        bubble.appendChild(imageLabel)

        bubble.addEventListener('pointerdown', (event) => {
          if (event.target !== bubble) return
          event.preventDefault()
          textarea.focus({ preventScroll: true })
        })

        const dragHandle = document.createElement('span')
        dragHandle.className = 'conversation-drag-handle'
        dragHandle.textContent = '::'
        dragHandle.title = 'Drag to reorder'
        dragHandle.setAttribute('aria-label', 'Drag to reorder')

        const messageActions = document.createElement('div')
        messageActions.className = 'conversation-message-actions'
        messageActions.contentEditable = 'false'
        messageActions.append(
          makeButton('x', 'Delete message', () => removeMessage(message.id), 'conversation-delete-message'),
          dragHandle,
          makeButton(
            '+',
            'Add message here',
            () => insertMessage(message.sender, index + 1, message.name),
            'conversation-inline-insert-button'
          ),
        )

        if (isOutgoing) {
          messageLine.append(bubble, messageActions)
        } else if (showAvatar) {
          messageLine.append(messageActions, makeAvatar(message, 'conversation-avatar'), bubble)
        } else {
          messageLine.append(messageActions, bubble)
        }
        row.appendChild(messageLine)
        window.requestAnimationFrame(() => layoutMessageTextarea(textarea, message.text))

        const meta = document.createElement('div')
        meta.className = 'conversation-message-tools'

        const timeInput = makeTextInput(message.timestamp, 'Time', value => {
          updateMessage(message.id, { timestamp: value })
        }, `${message.id}-time`)

        const receiptSelect = document.createElement('select')
        receiptSelect.className = 'conversation-receipt-select'
        receiptSelect.value = message.receiptStatus || ''
        receiptSelect.setAttribute('aria-label', 'Message receipt')
        MESSAGE_RECEIPTS.forEach(([value, label]) => {
          const option = document.createElement('option')
          option.value = value
          option.textContent = label
          receiptSelect.appendChild(option)
        })
        receiptSelect.addEventListener('change', () => updateMessage(message.id, {
          receiptStatus: receiptSelect.value,
        }))

        const metaControls = [
          currentAttrs.showTimestamps ? timeInput : null,
          currentAttrs.showReadReceipts && isOutgoing ? receiptSelect : null,
        ].filter(Boolean)
        if (metaControls.length) {
          meta.append(...metaControls)
          row.appendChild(meta)
        }
        return row
      }

      const renderColumnAdders = () => {
        const columnAdders = document.createElement('div')
        columnAdders.className = 'conversation-column-adders'

        const incoming = makeInsertControl('them', currentAttrs.messages.length, currentAttrs.participants.them)
        incoming.classList.add('conversation-column-adder')
        const outgoing = makeInsertControl('you', currentAttrs.messages.length, currentAttrs.participants.you)
        outgoing.classList.add('conversation-column-adder')

        columnAdders.append(incoming, outgoing)
        return columnAdders
      }

      const renderComposer = () => {
        messagesEl.textContent = ''
        currentAttrs.messages.forEach((message, index, messages) => {
          messagesEl.appendChild(renderMessageEditor(message, index, messages))
        })
        messagesEl.appendChild(renderColumnAdders())
      }

      const renderSavedPreview = () => {
        preview.textContent = ''
        currentAttrs.messages.forEach((message, index, messages) => {
          const previous = messages[index - 1]
          const next = messages[index + 1]
          const isOutgoing = message.sender === 'you'
          const sameAsPrevious = previous?.sender === message.sender &&
            (!currentAttrs.groupChat || isOutgoing || previous.name === message.name)
          const sameAsNext = next?.sender === message.sender &&
            (!currentAttrs.groupChat || isOutgoing || next.name === message.name)
          const showAvatar = currentAttrs.groupChat && !isOutgoing

          const row = document.createElement('div')
          row.className = [
            'conversation-saved-row',
            isOutgoing ? 'is-outgoing' : 'is-incoming',
            showAvatar ? 'has-avatar' : '',
            sameAsPrevious ? 'continues-before' : '',
            sameAsNext ? 'continues-after' : '',
          ].filter(Boolean).join(' ')

          if (currentAttrs.groupChat && !isOutgoing && !sameAsPrevious) {
            const name = document.createElement('div')
            name.className = 'conversation-saved-name'
            name.textContent = message.name || currentAttrs.participants[message.sender]
            row.appendChild(name)
          }

          const bubble = document.createElement('div')
          bubble.className = 'conversation-saved-bubble'
          bubble.style.background = isOutgoing ? currentAttrs.outgoingColor : currentAttrs.incomingColor
          bubble.style.color = isOutgoing ? currentAttrs.outgoingTextColor : currentAttrs.incomingTextColor

          if (message.imageSrc) {
            const image = document.createElement('img')
            image.src = message.imageSrc
            image.alt = ''
            image.draggable = false
            bubble.appendChild(image)
          }

          if (message.text) {
            const text = document.createElement('div')
            text.textContent = message.text
            bubble.appendChild(text)
          }

          if (showAvatar) {
            const savedLine = document.createElement('div')
            savedLine.className = 'conversation-saved-line has-avatar'
            savedLine.append(makeAvatar(message, 'conversation-saved-avatar'), bubble)
            row.appendChild(savedLine)
          } else {
            row.appendChild(bubble)
          }

          if (currentAttrs.showTimestamps && !sameAsNext && message.timestamp) {
            const time = document.createElement('div')
            time.className = 'conversation-saved-time'
            time.textContent = message.timestamp
            row.appendChild(time)
          }

          if (currentAttrs.showReadReceipts && isOutgoing && message.receiptStatus) {
            const receipt = document.createElement('div')
            receipt.className = [
              'conversation-saved-receipt',
              message.receiptStatus === 'notDelivered' ? 'is-error' : '',
            ].filter(Boolean).join(' ')
            receipt.textContent = MESSAGE_RECEIPT_LABELS[message.receiptStatus]
            row.appendChild(receipt)
          }

          preview.appendChild(row)
        })
      }

      const syncView = () => {
        currentAttrs = normalizeAttrs(currentNode.attrs)
        if (currentAttrs.saved) previewUntilEdit = false
        const isPreviewMode = currentAttrs.saved || previewUntilEdit
        container.className = [
          'conversation-node',
          `conversation-align-${currentAttrs.align}`,
          isPreviewMode ? 'is-saved' : 'is-editing',
          isSelected ? 'is-selected' : '',
        ].filter(Boolean).join(' ')
        container.style.width = `${currentAttrs.width}px`

        toolbar.style.display = isSelected ? 'flex' : 'none'
        resizeHandle.style.display = isSelected ? 'inline-flex' : 'none'
        preview.style.display = isPreviewMode ? 'block' : 'none'
        composer.style.display = isPreviewMode ? 'none' : 'block'

        renderToolbar()
        renderComposer()
        renderSavedPreview()

        if (isPreviewMode) {
          toolbar.textContent = ''
          toolbar.append(
            makeButton('Edit', 'Edit conversation', editConversation),
          )
        }

        if (pendingFocusState) {
          const focusState = pendingFocusState
          pendingFocusState = null
          restoreActiveControl(focusState)
        }
      }

      const onResizePointerDown = (event) => {
        event.preventDefault()
        event.stopPropagation()
        const startX = event.clientX
        const startWidth = container.getBoundingClientRect().width

        const onPointerMove = (moveEvent) => {
          const delta = moveEvent.clientX - startX
          const nextWidth = Math.max(MIN_WIDTH, startWidth + delta)
          commitAttributes({ width: Math.round(nextWidth), saved: currentAttrs.saved })
        }

        const onPointerUp = () => {
          if (currentAttrs.saved) {
            commitAttributes({
              snapshot: buildSnapshot(currentAttrs, currentAttrs.snapshotHeight),
              saved: true,
            })
          }
          window.removeEventListener('pointermove', onPointerMove)
          window.removeEventListener('pointerup', onPointerUp)
        }

        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
      }

      const onBodyPointerDown = (event) => {
        if (
          event.target instanceof HTMLElement &&
          event.target.closest('input, textarea, select, button, .conversation-message-row, .conversation-resize-handle, .conversation-drag-handle, .conversation-attach-image')
        ) {
          return
        }
        selectNode()
      }

      const onContainerPointerDown = () => {
        pointerInsideUntil = Date.now() + 300
      }

      const onContainerFocusOut = () => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            if (
              currentAttrs.saved ||
              Date.now() < pointerInsideUntil ||
              container.contains(document.activeElement)
            ) {
              return
            }
            saveSnapshot({ selectNodeAfter: false })
          })
        })
      }

      resizeHandle.addEventListener('pointerdown', onResizePointerDown)
      body.addEventListener('pointerdown', onBodyPointerDown)
      container.addEventListener('pointerdown', onContainerPointerDown, true)
      container.addEventListener('focusout', onContainerFocusOut)
      window.addEventListener('mousemove', onMessageDragMouseMove)
      window.addEventListener('mouseup', onMessageDragMouseUp)
      window.addEventListener('dragend', clearManualMessageDrag)
      window.addEventListener('blur', clearManualMessageDrag)
      disposers.push(
        () => resizeHandle.removeEventListener('pointerdown', onResizePointerDown),
        () => body.removeEventListener('pointerdown', onBodyPointerDown),
        () => container.removeEventListener('pointerdown', onContainerPointerDown, true),
        () => container.removeEventListener('focusout', onContainerFocusOut),
        () => window.removeEventListener('mousemove', onMessageDragMouseMove),
        () => window.removeEventListener('mouseup', onMessageDragMouseUp),
        () => window.removeEventListener('dragend', clearManualMessageDrag),
        () => window.removeEventListener('blur', clearManualMessageDrag),
        clearManualMessageDrag,
      )

      composer.appendChild(messagesEl)
      body.append(preview, composer)
      container.append(toolbar, body, resizeHandle)
      syncView()

      return {
        dom: container,
        selectNode: () => {
          isSelected = true
          syncView()
        },
        deselectNode: () => {
          isSelected = false
          if (!currentAttrs.saved && !previewUntilEdit) {
            saveSnapshot({ selectNodeAfter: false })
          } else {
            syncView()
          }
        },
        stopEvent: event => (
          toolbar.contains(event.target) ||
          resizeHandle.contains(event.target) ||
          (event.target instanceof HTMLElement && Boolean(event.target.closest(
            '.conversation-node input, .conversation-node textarea, .conversation-node select, .conversation-node button, .conversation-message-row, .conversation-drop-slot, .conversation-drag-handle, .conversation-attach-image'
          )))
        ),
        ignoreMutation: () => true,
        update: (updatedNode) => {
          if (updatedNode.type.name !== currentNode.type.name) return false
          currentNode = updatedNode
          syncView()
          return true
        },
        destroy: () => {
          disposers.forEach(dispose => dispose())
        },
      }
    }
  },
})

export default ConversationTile
