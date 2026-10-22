/**
 * conversationModel.ts — the shape of a conversation tile, and how it is coerced.
 *
 * A tile's attributes arrive from the document (so from whatever an older version
 * of the app wrote, or from a hand-edited file), and every field is normalized
 * here before anything renders. Pure data: no DOM, no ProseMirror.
 *
 * Which is why the input of every function here is `Loose<T>` and its output is `T`:
 * the normalizers are the boundary, and past them the rest of the tile may rely on
 * the shape.
 */
import {
  CONVERSATION_STYLES,
  DEFAULT_CONVERSATION_STYLE,
  LEGACY_CONVERSATION_STYLE,
  normalizeConversationStyle,
  type ConversationStyleId,
} from './conversationStyles'
import type { Loose } from '../types'

export const MIN_WIDTH = 240
export const DEFAULT_WIDTH = 360
export const MAX_SNAPSHOT_WIDTH = 720
export const VALID_ALIGNMENTS = new Set(['left', 'center', 'right'])

/** How the tile sits in the paragraph flow. */
export type Alignment = 'left' | 'center' | 'right'

/** The tick under a sent message. `''` is "no receipt", which is a choice, not absence. */
export type ReceiptStatus = '' | 'sent' | 'delivered' | 'read' | 'notDelivered'

export const MESSAGE_RECEIPTS: [ReceiptStatus, string][] = [
  ['', 'No receipt'],
  ['sent', 'Sent'],
  ['delivered', 'Delivered'],
  ['read', 'Read'],
  ['notDelivered', 'Not Delivered'],
]
export const MESSAGE_RECEIPT_LABELS = Object.fromEntries(MESSAGE_RECEIPTS)

/** Who sent a message. The two sides are the model — a group chat names them instead. */
export type Sender = 'you' | 'them'

export interface Message {
  id: string
  sender: Sender
  name: string
  text: string
  timestamp: string
  receiptStatus: ReceiptStatus
  imageSrc: string
}

/** A message as it sits in the document, before `normalizeMessage` fills it in. */
export type StoredMessage = Loose<Message>

export interface Participants {
  you: string
  them: string
}

export interface GroupMember {
  id: string
  name: string
  avatarSrc: string
}

export const DEFAULT_MESSAGES: StoredMessage[] = [
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

export const DEFAULT_PARTICIPANTS: Participants = {
  you: 'You',
  them: 'Sam',
}

export const DEFAULT_GROUP_MEMBERS: GroupMember[] = [
  { id: 'you', name: DEFAULT_PARTICIPANTS.you, avatarSrc: '' },
  { id: 'them', name: DEFAULT_PARTICIPANTS.them, avatarSrc: '' },
]

/** Every attribute of a conversation tile, after normalization. */
export interface ConversationAttrs {
  width: number
  align: Alignment
  /** Measured once the tile has rendered; null until then. */
  snapshotHeight: number | null
  saved: boolean
  /** The rendered SVG of a saved tile. */
  snapshot: string
  /** Brand, iMessage or Generic (conversationStyles.ts). */
  style: ConversationStyleId
  groupChat: boolean
  showTimestamps: boolean
  showReadReceipts: boolean
  outgoingColor: string
  incomingColor: string
  outgoingTextColor: string
  incomingTextColor: string
  participants: Participants
  groupMembers: GroupMember[]
  messages: Message[]
}

/**
 * The node's defaults. `messages` is the one field that is not already normalized:
 * the sample conversation is written the way a user's would be, and `normalizeAttrs`
 * fills the rest in.
 */
export const DEFAULT_ATTRS: Omit<ConversationAttrs, 'messages'> & { messages: StoredMessage[] } = {
  width: DEFAULT_WIDTH,
  align: 'left',
  snapshotHeight: null,
  saved: false,
  snapshot: '',
  style: DEFAULT_CONVERSATION_STYLE,
  groupChat: false,
  showTimestamps: true,
  showReadReceipts: false,
  outgoingColor: CONVERSATION_STYLES.imessage.outgoing,
  incomingColor: CONVERSATION_STYLES.imessage.incoming,
  outgoingTextColor: CONVERSATION_STYLES.imessage.outgoingText,
  incomingTextColor: CONVERSATION_STYLES.imessage.incomingText,
  participants: DEFAULT_PARTICIPANTS,
  groupMembers: DEFAULT_GROUP_MEMBERS,
  messages: DEFAULT_MESSAGES,
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * A DOM attribute or a stored value as a number, or `fallback` when it is not one.
 *
 * `fallback` is generic because two call sites want `null` back rather than a number:
 * an unmeasured `snapshotHeight` is not a height of zero.
 */
export const parseNumber = <T,>(value: unknown, fallback: T): number | T => {
  // parseFloat stringifies whatever it is given, which is the coercion this relies on.
  const parsed = Number.parseFloat(value as string)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * The cast is an assertion about what the attribute held, not a check — every caller
 * passes the result straight to the normalizer that does check it.
 */
export const safeJsonParse = <T,>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback
  try {
    const parsed = JSON.parse(value)
    return (parsed ?? fallback) as T
  } catch {
    return fallback
  }
}

export const normalizeParticipants = (participants: Loose<Participants> = {}): Participants => ({
  you: typeof participants.you === 'string' && participants.you.trim()
    ? participants.you
    : DEFAULT_PARTICIPANTS.you,
  them: typeof participants.them === 'string' && participants.them.trim()
    ? participants.them
    : DEFAULT_PARTICIPANTS.them,
})

export const normalizeAlignment = (value: unknown): Alignment => (
  VALID_ALIGNMENTS.has(value as string) ? value as Alignment : 'left'
)

export const normalizeReceiptStatus = (value: unknown): ReceiptStatus => (
  Object.prototype.hasOwnProperty.call(MESSAGE_RECEIPT_LABELS, value as string)
    ? value as ReceiptStatus
    : ''
)

export const makeId = (): string => (
  globalThis.crypto?.randomUUID?.() || `msg-${Date.now()}-${Math.round(Math.random() * 10000)}`
)

export const getInitials = (name: unknown = ''): string => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return parts.slice(0, 2).map(part => part[0]?.toUpperCase()).join('')
}

let textMeasureCanvas: HTMLCanvasElement | null = null

export const measureTextWidth = (text: string = '', font: string = '15px sans-serif'): number => {
  if (!textMeasureCanvas) textMeasureCanvas = document.createElement('canvas')
  const context = textMeasureCanvas.getContext('2d')
  if (!context) return String(text).length * 7.4
  context.font = font
  return context.measureText(text).width
}

export const normalizeMessage = (
  message: StoredMessage = {},
  participants: Participants = DEFAULT_PARTICIPANTS,
): Message => {
  const sender: Sender = message.sender === 'you' ? 'you' : 'them'
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

export const normalizeMessages = (messages: unknown, participants?: Participants): Message[] => {
  const source = Array.isArray(messages) && messages.length ? messages : DEFAULT_MESSAGES
  return source.map(message => normalizeMessage(message, participants))
}

export const normalizeGroupMembers = (
  members: unknown,
  participants: Participants,
  messages: Message[] = [],
): GroupMember[] => {
  const normalized: GroupMember[] = []
  const seenNames = new Set<string>()
  const seenIds = new Set<string>()

  const pushMember = (member: Loose<GroupMember> | null | undefined = {}, fallbackId: string = '') => {
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

export const normalizeAttrs = (attrs: Loose<ConversationAttrs> = {}): ConversationAttrs => {
  const participants = normalizeParticipants(attrs.participants as Loose<Participants>)
  const messages = normalizeMessages(attrs.messages, participants)
  return {
    width: clamp(parseNumber(attrs.width, DEFAULT_WIDTH), MIN_WIDTH, 1200),
    align: normalizeAlignment(attrs.align),
    snapshotHeight: parseNumber(attrs.snapshotHeight, null),
    saved: attrs.saved === true || attrs.saved === 'true',
    snapshot: typeof attrs.snapshot === 'string' ? attrs.snapshot : '',
    // A tile saved before styles existed has none, and keeps the iMessage look it had.
    style: normalizeConversationStyle(attrs.style, LEGACY_CONVERSATION_STYLE),
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
