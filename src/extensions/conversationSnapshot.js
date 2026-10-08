/**
 * conversationSnapshot.js — rendering a tile to a static image.
 *
 * A saved tile is drawn as HTML inside an SVG foreignObject and embedded as a data
 * URL, so a document that is merely being previewed does not need the tile's
 * interactive node view. The CSS below is duplicated in spirit by the
 * .conversation-* rules in extensions/ConversationTile.css; they must be kept in
 * step until one is generated from the other.
 */
import {
  DEFAULT_WIDTH,
  MAX_SNAPSHOT_WIDTH,
  MESSAGE_RECEIPT_LABELS,
  MIN_WIDTH,
  clamp,
  getInitials,
  normalizeGroupMembers,
  normalizeMessages,
  parseNumber,
} from './conversationModel'
import { conversationLook } from './conversationStyles'

export const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

export const messageRowsHtml = (attrs) => {
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
          <div class="conversation-snapshot-bubble">
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
export const estimateSnapshotHeight = (attrs, width) => {
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
export const buildSnapshot = (attrs, measuredHeight = null) => {
  const width = clamp(parseNumber(attrs.width, DEFAULT_WIDTH), MIN_WIDTH, MAX_SNAPSHOT_WIDTH)
  const height = clamp(
    parseNumber(measuredHeight, null) || parseNumber(attrs.snapshotHeight, null) || estimateSnapshotHeight(attrs, width),
    110,
    2200
  )
  // The image is its own document, so the look is written in as values, not variables.
  const look = conversationLook(attrs)
  const html = `
    <div xmlns="http://www.w3.org/1999/xhtml">
      <style>
        .conversation-snapshot{box-sizing:border-box;width:${width}px;height:${height}px;padding:14px 0;font-family:${look.font};background:transparent;overflow:hidden;}
        .conversation-snapshot-row{box-sizing:border-box;display:flex;flex-direction:column;margin:3px 0;max-width:78%;font-size:15px;line-height:1.28;}
        .conversation-snapshot-row.is-outgoing{align-items:flex-end;margin-left:auto;}
        .conversation-snapshot-row.is-incoming{align-items:flex-start;margin-right:auto;}
        .conversation-snapshot-line{box-sizing:border-box;display:flex;align-items:flex-end;gap:6px;max-width:100%;}
        .conversation-snapshot-line.has-avatar .conversation-snapshot-bubble{max-width:calc(100% - 34px);}
        .conversation-snapshot-avatar{display:inline-flex;align-items:center;justify-content:center;flex:0 0 28px;width:28px;height:28px;border-radius:50%;overflow:hidden;background:${look.avatar};color:${look.avatarText};font-size:10px;font-weight:750;}
        .conversation-snapshot-avatar img{width:100%;height:100%;object-fit:cover;}
        .conversation-snapshot-bubble{box-sizing:border-box;max-width:100%;padding:8px 12px;border-radius:${look.radius}px;overflow:hidden;white-space:pre-wrap;word-break:break-word;}
        .conversation-snapshot-row.is-outgoing .conversation-snapshot-bubble{background:${look.outgoing};color:${look.outgoingText};}
        .conversation-snapshot-row.is-incoming .conversation-snapshot-bubble{background:${look.incoming};color:${look.incomingText};}
        .conversation-snapshot-row.continues-before .conversation-snapshot-bubble{margin-top:1px;}
        .conversation-snapshot-row.continues-after.is-outgoing .conversation-snapshot-bubble{border-bottom-right-radius:${look.tail}px;}
        .conversation-snapshot-row.continues-before.is-outgoing .conversation-snapshot-bubble{border-top-right-radius:${look.tail}px;}
        .conversation-snapshot-row.continues-after.is-incoming .conversation-snapshot-bubble{border-bottom-left-radius:${look.tail}px;}
        .conversation-snapshot-row.continues-before.is-incoming .conversation-snapshot-bubble{border-top-left-radius:${look.tail}px;}
        .conversation-snapshot-bubble img{display:block;width:100%;max-height:260px;object-fit:cover;margin:-3px -7px 6px;border-radius:${Math.max(0, look.radius - 5)}px;}
        .conversation-snapshot-name{margin:6px 0 2px 12px;color:${look.meta};font-size:11px;font-weight:650;}
        .conversation-snapshot-time{margin:3px 10px 3px;color:${look.meta};font-size:10px;line-height:1.2;}
        .conversation-snapshot-receipt{margin:5px 10px 9px;color:${look.meta};font-size:10px;line-height:1.2;}
        .conversation-snapshot-receipt.is-error{color:${look.error};}
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

