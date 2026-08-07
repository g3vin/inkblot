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

const MIN_WIDTH = 240
const DEFAULT_WIDTH = 360
const MAX_SNAPSHOT_WIDTH = 720
const VALID_ALIGNMENTS = new Set(['left', 'center', 'right'])
const MESSAGE_RECEIPTS = [
  ['', 'No receipt'],
  ['sent', 'Sent'],
  ['delivered', 'Delivered'],
  ['read', 'Read'],
  ['notDelivered', 'Not Delivered'],
]
const MESSAGE_RECEIPT_LABELS = Object.fromEntries(MESSAGE_RECEIPTS)

const DEFAULT_MESSAGES = [
  {
    id: 'msg-1',
    sender: 'you',
    name: 'You',
    text: 'Are you still coming over later?',
    timestamp: '9:41 AM',
    receiptStatus: 'delivered',
    imageSrc: '',
  },
  {
    id: 'msg-2',
    sender: 'them',
    name: 'Sam',
    text: 'Yes. I am bringing coffee.',
    timestamp: '9:42 AM',
    imageSrc: '',
  },
]

const DEFAULT_PARTICIPANTS = {
  you: 'You',
  them: 'Sam',
}

const DEFAULT_GROUP_MEMBERS = [
  { id: 'you', name: DEFAULT_PARTICIPANTS.you, avatarSrc: '' },
  { id: 'them', name: DEFAULT_PARTICIPANTS.them, avatarSrc: '' },
]

const DEFAULT_ATTRS = {
  width: DEFAULT_WIDTH,
  align: 'left',
  snapshotHeight: null,
  saved: false,
  snapshot: '',
  groupChat: false,
  showTimestamps: true,
  showReadReceipts: false,
  outgoingColor: '#007aff',
  incomingColor: '#e9e9eb',
  outgoingTextColor: '#ffffff',
  incomingTextColor: '#111111',
  participants: DEFAULT_PARTICIPANTS,
  groupMembers: DEFAULT_GROUP_MEMBERS,
  messages: DEFAULT_MESSAGES,
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const parseNumber = (value, fallback) => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const safeJsonParse = (value, fallback) => {
  if (!value) return fallback
  try {
    const parsed = JSON.parse(value)
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

const normalizeParticipants = (participants = {}) => ({
  you: typeof participants.you === 'string' && participants.you.trim()
    ? participants.you
    : DEFAULT_PARTICIPANTS.you,
  them: typeof participants.them === 'string' && participants.them.trim()
    ? participants.them
    : DEFAULT_PARTICIPANTS.them,
})

const normalizeAlignment = (value) => (
  VALID_ALIGNMENTS.has(value) ? value : 'left'
)

const normalizeReceiptStatus = (value) => (
  Object.prototype.hasOwnProperty.call(MESSAGE_RECEIPT_LABELS, value) ? value : ''
)

const makeId = () => (
  globalThis.crypto?.randomUUID?.() || `msg-${Date.now()}-${Math.round(Math.random() * 10000)}`
)

const getInitials = (name = '') => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return parts.slice(0, 2).map(part => part[0]?.toUpperCase()).join('')
}

let textMeasureCanvas = null

const measureTextWidth = (text = '', font = '15px sans-serif') => {
  if (!textMeasureCanvas) textMeasureCanvas = document.createElement('canvas')
  const context = textMeasureCanvas.getContext('2d')
  if (!context) return String(text).length * 7.4
  context.font = font
  return context.measureText(text).width
}

const normalizeMessage = (message = {}, participants = DEFAULT_PARTICIPANTS) => {
  const sender = message.sender === 'you' ? 'you' : 'them'
  return {
    id: typeof message.id === 'string' && message.id ? message.id : makeId(),
    sender,
    name: typeof message.name === 'string' && message.name.trim()
      ? message.name
      : participants[sender],
    text: typeof message.text === 'string' ? message.text : '',
    timestamp: typeof message.timestamp === 'string' ? message.timestamp : '',
    receiptStatus: normalizeReceiptStatus(message.receiptStatus),
    imageSrc: typeof message.imageSrc === 'string' ? message.imageSrc : '',
  }
}

const normalizeMessages = (messages, participants) => {
  const source = Array.isArray(messages) && messages.length ? messages : DEFAULT_MESSAGES
  return source.map(message => normalizeMessage(message, participants))
}

const normalizeGroupMembers = (members, participants, messages = []) => {
  const normalized = []
  const seenNames = new Set()
  const seenIds = new Set()

  const pushMember = (member = {}, fallbackId = '') => {
    const memberValue = member && typeof member === 'object' ? member : {}
    const rawName = typeof memberValue.name === 'string' ? memberValue.name.trim() : ''
    const name = rawName || (fallbackId === 'you' ? participants.you : fallbackId === 'them' ? participants.them : '')
    if (!name) return

    let id = typeof memberValue.id === 'string' && memberValue.id ? memberValue.id : fallbackId || makeId()
    while (seenIds.has(id)) id = makeId()

    const nameKey = name.toLowerCase()
    if (seenNames.has(nameKey)) return

    normalized.push({
      id,
      name,
      avatarSrc: typeof memberValue.avatarSrc === 'string' ? memberValue.avatarSrc : '',
    })
    seenIds.add(id)
    seenNames.add(nameKey)
  }

  pushMember(
    Array.isArray(members) ? members.find(member => member?.id === 'you') : null,
    'you'
  )
  pushMember(
    Array.isArray(members) ? members.find(member => member?.id === 'them') : null,
    'them'
  )

  if (Array.isArray(members)) {
    members.forEach((member, index) => pushMember(member, `member-${index + 1}`))
  }

  messages
    .filter(message => message.sender === 'them')
    .forEach((message, index) => pushMember({
      id: `message-member-${index + 1}`,
      name: message.name,
    }))

  return normalized.length ? normalized : DEFAULT_GROUP_MEMBERS
}

const normalizeAttrs = (attrs = {}) => {
  const participants = normalizeParticipants(attrs.participants)
  const messages = normalizeMessages(attrs.messages, participants)
  return {
    width: clamp(parseNumber(attrs.width, DEFAULT_WIDTH), MIN_WIDTH, 1200),
    align: normalizeAlignment(attrs.align),
    snapshotHeight: parseNumber(attrs.snapshotHeight, null),
    saved: attrs.saved === true || attrs.saved === 'true',
    snapshot: typeof attrs.snapshot === 'string' ? attrs.snapshot : '',
    groupChat: attrs.groupChat === true || attrs.groupChat === 'true',
    showTimestamps: attrs.showTimestamps !== false && attrs.showTimestamps !== 'false',
    showReadReceipts: attrs.showReadReceipts === true || attrs.showReadReceipts === 'true',
    outgoingColor: typeof attrs.outgoingColor === 'string' ? attrs.outgoingColor : DEFAULT_ATTRS.outgoingColor,
    incomingColor: typeof attrs.incomingColor === 'string' ? attrs.incomingColor : DEFAULT_ATTRS.incomingColor,
    outgoingTextColor: typeof attrs.outgoingTextColor === 'string'
      ? attrs.outgoingTextColor
      : DEFAULT_ATTRS.outgoingTextColor,
    incomingTextColor: typeof attrs.incomingTextColor === 'string'
      ? attrs.incomingTextColor
      : DEFAULT_ATTRS.incomingTextColor,
    participants,
    groupMembers: normalizeGroupMembers(attrs.groupMembers, participants, messages),
    messages,
  }
}

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const messageRowsHtml = (attrs) => {
  const messages = normalizeMessages(attrs.messages, attrs.participants)
  const groupMembers = normalizeGroupMembers(attrs.groupMembers, attrs.participants, messages)
  const getAvatar = name => groupMembers.find(member => member.name === name)?.avatarSrc || ''

  return messages.map((message, index) => {
    const previous = messages[index - 1]
    const next = messages[index + 1]
    const isOutgoing = message.sender === 'you'
    const sameAsPrevious = previous?.sender === message.sender &&
      (!attrs.groupChat || isOutgoing || previous.name === message.name)
    const sameAsNext = next?.sender === message.sender &&
      (!attrs.groupChat || isOutgoing || next.name === message.name)
    const bubbleColor = isOutgoing ? attrs.outgoingColor : attrs.incomingColor
    const textColor = isOutgoing ? attrs.outgoingTextColor : attrs.incomingTextColor
    const showAvatar = attrs.groupChat && !isOutgoing
    const avatarSrc = showAvatar ? getAvatar(message.name) : ''
    const classes = [
      'conversation-snapshot-row',
      isOutgoing ? 'is-outgoing' : 'is-incoming',
      sameAsPrevious ? 'continues-before' : '',
      sameAsNext ? 'continues-after' : '',
    ].filter(Boolean).join(' ')

    return `
      <div class="${classes}">
        ${attrs.groupChat && !isOutgoing && !sameAsPrevious ? `<div class="conversation-snapshot-name">${escapeHtml(message.name)}</div>` : ''}
        <div class="conversation-snapshot-line ${showAvatar ? 'has-avatar' : ''}">
          ${showAvatar ? `<span class="conversation-snapshot-avatar">${avatarSrc ? `<img src="${escapeHtml(avatarSrc)}" alt="" />` : escapeHtml(getInitials(message.name))}</span>` : ''}
          <div class="conversation-snapshot-bubble" style="background:${escapeHtml(bubbleColor)};color:${escapeHtml(textColor)};">
            ${message.imageSrc ? `<img src="${escapeHtml(message.imageSrc)}" alt="" />` : ''}
            ${message.text ? `<div>${escapeHtml(message.text).replaceAll('\n', '<br />')}</div>` : ''}
          </div>
        </div>
        ${attrs.showTimestamps && !sameAsNext && message.timestamp ? `<div class="conversation-snapshot-time">${escapeHtml(message.timestamp)}</div>` : ''}
        ${attrs.showReadReceipts && isOutgoing && message.receiptStatus ? `<div class="conversation-snapshot-receipt ${message.receiptStatus === 'notDelivered' ? 'is-error' : ''}">${escapeHtml(MESSAGE_RECEIPT_LABELS[message.receiptStatus])}</div>` : ''}
      </div>
    `
  }).join('')
}

// Approximate the rendered height of the conversation (used when no measured
// height is available) so the exported snapshot SVG doesn't clip messages.
const estimateSnapshotHeight = (attrs, width) => {
  const messages = normalizeMessages(attrs.messages, attrs.participants)
  const maxBubbleWidth = Math.max(140, width * 0.78 - 24)
  const averageCharacterWidth = 7.4
  const lineHeight = 19

  return clamp(messages.reduce((total, message, index) => {
    const previous = messages[index - 1]
    const next = messages[index + 1]
    const isOutgoing = message.sender === 'you'
    const sameAsPrevious = previous?.sender === message.sender &&
      (!attrs.groupChat || isOutgoing || previous.name === message.name)
    const sameAsNext = next?.sender === message.sender &&
      (!attrs.groupChat || isOutgoing || next.name === message.name)
    const text = message.text || 'Message'
    const explicitLines = text.split('\n')
    const lineCount = explicitLines.reduce((count, line) => (
      count + Math.max(1, Math.ceil((line.length * averageCharacterWidth) / maxBubbleWidth))
    ), 0)
    const nameHeight = attrs.groupChat && message.sender !== 'you' && !sameAsPrevious ? 19 : 0
    const imageHeight = message.imageSrc ? 150 : 0
    const timestampHeight = attrs.showTimestamps && !sameAsNext && message.timestamp ? 17 : 0
    const receiptHeight = attrs.showReadReceipts && message.sender === 'you' && message.receiptStatus ? 24 : 0

    return total + nameHeight + imageHeight + lineCount * lineHeight + timestampHeight + receiptHeight + 22
  }, 28), 110, 2200)
}

// Render the conversation to a self-contained SVG data URL (via a styled
// foreignObject). This snapshot is what non-interactive renderers — exported
// HTML, version previews — display in place of the live node view.
const buildSnapshot = (attrs, measuredHeight = null) => {
  const width = clamp(parseNumber(attrs.width, DEFAULT_WIDTH), MIN_WIDTH, MAX_SNAPSHOT_WIDTH)
  const height = clamp(
    parseNumber(measuredHeight, null) || parseNumber(attrs.snapshotHeight, null) || estimateSnapshotHeight(attrs, width),
    110,
    2200
  )
  const html = `
    <div xmlns="http://www.w3.org/1999/xhtml">
      <style>
        .conversation-snapshot{box-sizing:border-box;width:${width}px;height:${height}px;padding:14px 0;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;background:transparent;overflow:hidden;}
        .conversation-snapshot-row{box-sizing:border-box;display:flex;flex-direction:column;margin:3px 0;max-width:78%;font-size:15px;line-height:1.28;}
        .conversation-snapshot-row.is-outgoing{align-items:flex-end;margin-left:auto;}
        .conversation-snapshot-row.is-incoming{align-items:flex-start;margin-right:auto;}
        .conversation-snapshot-line{box-sizing:border-box;display:flex;align-items:flex-end;gap:6px;max-width:100%;}
        .conversation-snapshot-line.has-avatar .conversation-snapshot-bubble{max-width:calc(100% - 34px);}
        .conversation-snapshot-avatar{display:inline-flex;align-items:center;justify-content:center;flex:0 0 28px;width:28px;height:28px;border-radius:50%;overflow:hidden;background:#d7dbe0;color:#58606b;font-size:10px;font-weight:750;}
        .conversation-snapshot-avatar img{width:100%;height:100%;object-fit:cover;}
        .conversation-snapshot-bubble{box-sizing:border-box;max-width:100%;padding:8px 12px;border-radius:18px;overflow:hidden;white-space:pre-wrap;word-break:break-word;}
        .conversation-snapshot-row.continues-before .conversation-snapshot-bubble{margin-top:1px;}
        .conversation-snapshot-row.continues-after.is-outgoing .conversation-snapshot-bubble{border-bottom-right-radius:6px;}
        .conversation-snapshot-row.continues-before.is-outgoing .conversation-snapshot-bubble{border-top-right-radius:6px;}
        .conversation-snapshot-row.continues-after.is-incoming .conversation-snapshot-bubble{border-bottom-left-radius:6px;}
        .conversation-snapshot-row.continues-before.is-incoming .conversation-snapshot-bubble{border-top-left-radius:6px;}
        .conversation-snapshot-bubble img{display:block;width:100%;max-height:260px;object-fit:cover;margin:-3px -7px 6px;border-radius:13px;}
        .conversation-snapshot-name{margin:6px 0 2px 12px;color:#7a7f87;font-size:11px;font-weight:650;}
        .conversation-snapshot-time{margin:3px 10px 3px;color:#8d939c;font-size:10px;line-height:1.2;}
        .conversation-snapshot-receipt{margin:5px 10px 9px;color:#8d939c;font-size:10px;line-height:1.2;}
        .conversation-snapshot-receipt.is-error{color:#ff3b30;}
      </style>
      <div class="conversation-snapshot">
        ${messageRowsHtml(attrs)}
      </div>
    </div>
  `
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <foreignObject width="100%" height="100%">${html}</foreignObject>
    </svg>
  `

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const makeAniconSvg = (name, size = 14) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add('conversation-tool-icon', `conversation-tool-icon-${name}`)

  const paths = name === 'plus'
    ? ['M5 12h14', 'M12 5v14']
    : name === 'edit'
      ? [
        'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
        'm15 5 4 4',
      ]
      : ['M18 6 6 18', 'm6 6 12 12']

  paths.forEach((d) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    svg.appendChild(path)
  })

  return svg
}

const makeButton = (label, title, onClick, className = '') => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = ['conversation-tool-button', className].filter(Boolean).join(' ')
  const isPlus = label === '+' || label.startsWith('+ ')
  const isX = label === 'x'
  const isEdit = label === 'Edit'
  if (isPlus || isX || isEdit) {
    button.classList.add('has-anicon')
    button.appendChild(makeAniconSvg(isPlus ? 'plus' : isEdit ? 'edit' : 'x'))
    if (label.startsWith('+ ')) {
      const text = document.createElement('span')
      text.textContent = label.slice(2)
      button.appendChild(text)
    }
  } else {
    button.textContent = label
  }
  button.title = title
  button.setAttribute('aria-label', title)
  button.contentEditable = 'false'
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    event.stopPropagation()
  })
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onClick(event)
  })
  return button
}

const makeColorInput = (label, value, onInput) => {
  const wrapper = document.createElement('label')
  wrapper.className = 'conversation-color-control'
  wrapper.title = label
  wrapper.contentEditable = 'false'

  const swatch = document.createElement('input')
  swatch.type = 'color'
  swatch.value = value
  swatch.setAttribute('aria-label', label)
  swatch.addEventListener('pointerdown', event => event.stopPropagation())
  swatch.addEventListener('input', () => onInput(swatch.value))

  wrapper.appendChild(swatch)
  return wrapper
}

const makeTextInput = (value, label, onInput, controlId = '') => {
  const input = document.createElement('input')
  input.type = 'text'
  input.value = value || ''
  input.placeholder = label
  input.setAttribute('aria-label', label)
  if (controlId) input.dataset.controlId = controlId
  input.addEventListener('input', () => onInput(input.value))
  return input
}

const readImageFile = (file, callback) => {
  if (!file || !file.type?.startsWith('image/')) return
  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result === 'string') callback(reader.result)
  }
  reader.readAsDataURL(file)
}

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
      let manualDragState = null
      let manualDragActive = false
      let messageDropIndex = null
      let messageDropSlot = null
      let messageDragPreview = null
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

      const reorderMessage = (messageId, targetIndex) => {
        const fromIndex = currentAttrs.messages.findIndex(message => message.id === messageId)
        if (fromIndex === -1) return

        const movingMessage = currentAttrs.messages[fromIndex]
        const withoutMovingMessage = currentAttrs.messages.filter(message => message.id !== messageId)
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
        const nextIndex = clamp(index, 0, currentAttrs.messages.length)
        const slot = ensureMessageDropSlot()
        const movingMessage = currentAttrs.messages.find(message => message.id === manualDragState.messageId)
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
          setMessageDropIndex(currentAttrs.messages.length)
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
          setMessageDropIndex(currentAttrs.messages.length)
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
          setMessageDropIndex(currentAttrs.messages.length)
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
          const message = currentAttrs.messages.find(item => item.id === manualDragState.messageId)
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
