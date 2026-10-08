/**
 * conversationStyles.ts — how a conversation tile's chat looks: Brand, iMessage or
 * Generic, chosen per tile (the node's `style` attribute).
 *
 * A conversation is part of the writer's document (its saved form is an image of the
 * chat), so these are the document's colours and type, not the app's chrome: they
 * stay the same in light and dark, and `npm run lint:design` skips this file
 * (docs/DESIGN.md → Guardrails). The live tile reads them as --conv-* custom
 * properties; the snapshot writes them into its own stylesheet.
 */

export type ConversationStyleId = 'brand' | 'imessage' | 'generic'

export interface ConversationLook {
  label: string
  outgoing: string
  outgoingText: string
  incoming: string
  incomingText: string
  /** Names, times and receipts. */
  meta: string
  avatar: string
  avatarText: string
  error: string
  font: string
  /** A bubble's corners, and the tighter corner where a run of bubbles meets. */
  radius: number
  tail: number
}

export const CONVERSATION_STYLES: Readonly<Record<ConversationStyleId, ConversationLook>> = {
  // Inkblot's own: Ink Blue for the writer's side, paper for theirs, set in Inter.
  brand: {
    label: 'Inkblot',
    outgoing: '#2f4a8a',
    outgoingText: '#ffffff',
    incoming: '#f3f0ea',
    incomingText: '#1f1c18',
    meta: '#6b645a',
    avatar: '#ebe7df',
    avatarText: '#48423a',
    error: '#a23b32',
    font: "'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    radius: 12,
    tail: 4,
  },
  imessage: {
    label: 'iMessage',
    outgoing: '#007aff',
    outgoingText: '#ffffff',
    incoming: '#e9e9eb',
    incomingText: '#111111',
    meta: '#8d939c',
    avatar: '#d7dbe0',
    avatarText: '#58606b',
    error: '#ff3b30',
    font: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif",
    radius: 18,
    tail: 6,
  },
  // Any messaging app: neutral greys, the system face, square-ish corners.
  generic: {
    label: 'Generic',
    outgoing: '#4b5563',
    outgoingText: '#ffffff',
    incoming: '#e5e7eb',
    incomingText: '#111827',
    meta: '#6b7280',
    avatar: '#d1d5db',
    avatarText: '#374151',
    error: '#b91c1c',
    font: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    radius: 8,
    tail: 8,
  },
}

export const CONVERSATION_STYLE_IDS = Object.keys(CONVERSATION_STYLES) as ConversationStyleId[]

/** A new tile's style. */
export const DEFAULT_CONVERSATION_STYLE: ConversationStyleId = 'brand'

/** A tile saved before styles existed looked like iMessage, and still does. */
export const LEGACY_CONVERSATION_STYLE: ConversationStyleId = 'imessage'

export const normalizeConversationStyle = (value: unknown, fallback: ConversationStyleId = DEFAULT_CONVERSATION_STYLE): ConversationStyleId =>
  (CONVERSATION_STYLE_IDS as string[]).includes(value as string) ? value as ConversationStyleId : fallback

/**
 * The look a tile is drawn in. An iMessage tile keeps the bubble colours stored on it,
 * so a tile coloured by hand before styles existed looks as it did.
 */
export const conversationLook = (attrs: {
  style?: unknown
  outgoingColor?: string
  incomingColor?: string
  outgoingTextColor?: string
  incomingTextColor?: string
}): ConversationLook => {
  const style = normalizeConversationStyle(attrs.style)
  const look = CONVERSATION_STYLES[style]
  if (style !== 'imessage') return look
  return {
    ...look,
    outgoing: attrs.outgoingColor || look.outgoing,
    incoming: attrs.incomingColor || look.incoming,
    outgoingText: attrs.outgoingTextColor || look.outgoingText,
    incomingText: attrs.incomingTextColor || look.incomingText,
  }
}

/** The look as the --conv-* custom properties ConversationTile.css reads. */
export const conversationVars = (look: ConversationLook): Record<string, string> => ({
  '--conv-outgoing': look.outgoing,
  '--conv-outgoing-text': look.outgoingText,
  '--conv-incoming': look.incoming,
  '--conv-incoming-text': look.incomingText,
  '--conv-meta': look.meta,
  '--conv-avatar': look.avatar,
  '--conv-avatar-text': look.avatarText,
  '--conv-error': look.error,
  '--conv-font': look.font,
  '--conv-radius': `${look.radius}px`,
  '--conv-tail': `${look.tail}px`,
})
