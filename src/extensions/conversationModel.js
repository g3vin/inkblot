/**
 * conversationModel.js — the shape of a conversation tile, and how it is coerced.
 *
 * A tile's attributes arrive from the document (so from whatever an older version
 * of the app wrote, or from a hand-edited file), and every field is normalized
 * here before anything renders. Pure data: no DOM, no ProseMirror.
 */
export const MIN_WIDTH = 240
export const DEFAULT_WIDTH = 360
export const MAX_SNAPSHOT_WIDTH = 720
export const VALID_ALIGNMENTS = new Set(['left', 'center', 'right'])
export const MESSAGE_RECEIPTS = [
  ['', 'No receipt'],
  ['sent', 'Sent'],
  ['delivered', 'Delivered'],
  ['read', 'Read'],
  ['notDelivered', 'Not Delivered'],
]
export const MESSAGE_RECEIPT_LABELS = Object.fromEntries(MESSAGE_RECEIPTS)

export const DEFAULT_MESSAGES = [
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

export const DEFAULT_PARTICIPANTS = {
  you: 'You',
  them: 'Sam',
}

export const DEFAULT_GROUP_MEMBERS = [
  { id: 'you', name: DEFAULT_PARTICIPANTS.you, avatarSrc: '' },
  { id: 'them', name: DEFAULT_PARTICIPANTS.them, avatarSrc: '' },
]

export const DEFAULT_ATTRS = {
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

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export const parseNumber = (value, fallback) => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const safeJsonParse = (value, fallback) => {
  if (!value) return fallback
  try {
    const parsed = JSON.parse(value)
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

export const normalizeParticipants = (participants = {}) => ({
  you: typeof participants.you === 'string' && participants.you.trim()
    ? participants.you
    : DEFAULT_PARTICIPANTS.you,
  them: typeof participants.them === 'string' && participants.them.trim()
    ? participants.them
    : DEFAULT_PARTICIPANTS.them,
})

export const normalizeAlignment = (value) => (
  VALID_ALIGNMENTS.has(value) ? value : 'left'
)

export const normalizeReceiptStatus = (value) => (
  Object.prototype.hasOwnProperty.call(MESSAGE_RECEIPT_LABELS, value) ? value : ''
)

export const makeId = () => (
  globalThis.crypto?.randomUUID?.() || `msg-${Date.now()}-${Math.round(Math.random() * 10000)}`
)

export const getInitials = (name = '') => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return parts.slice(0, 2).map(part => part[0]?.toUpperCase()).join('')
}

let textMeasureCanvas = null

export const measureTextWidth = (text = '', font = '15px sans-serif') => {
  if (!textMeasureCanvas) textMeasureCanvas = document.createElement('canvas')
  const context = textMeasureCanvas.getContext('2d')
  if (!context) return String(text).length * 7.4
  context.font = font
  return context.measureText(text).width
}

export const normalizeMessage = (message = {}, participants = DEFAULT_PARTICIPANTS) => {
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

export const normalizeMessages = (messages, participants) => {
  const source = Array.isArray(messages) && messages.length ? messages : DEFAULT_MESSAGES
  return source.map(message => normalizeMessage(message, participants))
}

export const normalizeGroupMembers = (members, participants, messages = []) => {
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

export const normalizeAttrs = (attrs = {}) => {
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
