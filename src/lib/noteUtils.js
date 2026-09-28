/**
 * noteUtils.js — note data model.
 *
 * Notes come in two types: 'quote' notes anchored to a text range in a
 * document (from/to/anchor) and 'free' notes with no anchor. Notes can nest
 * via parentNoteId, carry attached images and voice memos, and remember their
 * hover-preview layout/size. Everything entering app state should pass through
 * normalizeNote(s) so downstream code can rely on the shape.
 */
import { normalizeNoteAudio } from './audioNotes'
import { DEFAULT_NOTE_INK, NOTE_INKS, inkColor, inkVar, isInkId } from './palette'

/**
 * A note's colour is an ink id from src/lib/palette.ts ('amber'), or — for notes saved
 * before the ink palette, or given a custom colour — a hex. Draw it with `noteColor`.
 */
export const DEFAULT_NOTE_COLOR = DEFAULT_NOTE_INK

export const NOTE_COLOR_OPTIONS = NOTE_INKS

/** A stored note colour → the CSS colour to draw it with. */
export const noteColor = (value) => inkColor(value, inkVar(DEFAULT_NOTE_INK))

const nowIso = () => new Date().toISOString()

/** Format a note timestamp as a short local time (e.g. "5:32 PM"). */
export const formatNoteTimestamp = (value) => {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed)
}

const normalizeColor = (value) => {
  if (typeof value !== 'string') return DEFAULT_NOTE_COLOR
  const trimmed = value.trim()
  if (isInkId(trimmed)) return trimmed
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed) ? trimmed : DEFAULT_NOTE_COLOR
}

const normalizeDate = (value, fallback) => {
  if (typeof value !== 'string') return fallback
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString()
}

const normalizeRangeValue = (value) => {
  return Number.isFinite(value) ? value : null
}

const normalizeOptionalId = (value) => {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const normalizePreviewLayout = (value) => {
  if (!value || typeof value !== 'object') return { offsetX: 0, offsetY: 0 }

  return {
    offsetX: Number.isFinite(value.offsetX) ? value.offsetX : 0,
    offsetY: Number.isFinite(value.offsetY) ? value.offsetY : 0,
  }
}

const normalizePreviewSize = (value) => {
  if (!value || typeof value !== 'object') {
    return { width: 260, height: 88 }
  }

  return {
    width: Number.isFinite(value.width) ? Math.max(220, value.width) : 260,
    height: Number.isFinite(value.height) ? Math.max(64, value.height) : 88,
  }
}

const normalizeNoteImage = (image = {}) => {
  if (!image || typeof image !== 'object') return null
  if (typeof image.src !== 'string' || !image.src.trim()) return null

  return {
    id: typeof image.id === 'string' && image.id.trim() ? image.id : crypto.randomUUID(),
    src: image.src,
    mimeType: typeof image.mimeType === 'string' ? image.mimeType : 'image/png',
  }
}

const normalizeNoteImages = (images = []) => (
  Array.isArray(images)
    ? images.map(normalizeNoteImage).filter(Boolean)
    : []
)

/** Fill in defaults/coerce every note field; safe to call on untrusted or legacy data. */
export const normalizeNote = (note = {}) => {
  const fallbackDate = nowIso()
  const createdAt = normalizeDate(note.createdAt, normalizeDate(note.updatedAt, fallbackDate))
  const updatedAt = normalizeDate(note.updatedAt, createdAt)

  return {
    ...note,
    id: note.id || crypto.randomUUID(),
    type: note.type === 'quote' ? 'quote' : 'free',
    content: typeof note.content === 'string' ? note.content : '',
    anchor: typeof note.anchor === 'string' ? note.anchor : '',
    from: normalizeRangeValue(note.from),
    to: normalizeRangeValue(note.to),
    color: normalizeColor(note.color),
    pinned: Boolean(note.pinned),
    parentNoteId: normalizeOptionalId(note.parentNoteId),
    collapsedChildren: Boolean(note.collapsedChildren),
    previewLayout: normalizePreviewLayout(note.previewLayout),
    previewSize: normalizePreviewSize(note.previewSize),
    images: normalizeNoteImages(note.images),
    // Voice memos. Unlike images (base64 in the note), these are asset paths — see
    // audioNotes.js for why.
    audio: normalizeNoteAudio(note.audio),
    createdAt,
    updatedAt,
    timestamp: formatNoteTimestamp(updatedAt),
  }
}

export const normalizeNotes = (notes = []) => (
  Array.isArray(notes) ? notes.map(normalizeNote) : []
)

export const createFreeNote = (color = DEFAULT_NOTE_COLOR) => {
  const createdAt = nowIso()
  return normalizeNote({
    id: crypto.randomUUID(),
    type: 'free',
    content: '',
    color,
    pinned: false,
    createdAt,
    updatedAt: createdAt,
  })
}

export const createQuoteNote = ({
  from,
  to,
  anchor,
  color = DEFAULT_NOTE_COLOR,
} = {}) => {
  const createdAt = nowIso()
  return normalizeNote({
    id: crypto.randomUUID(),
    type: 'quote',
    from,
    to,
    anchor,
    content: '',
    color,
    pinned: false,
    createdAt,
    updatedAt: createdAt,
  })
}

/** Apply changes to a note and bump its updatedAt. */
export const touchNote = (note, changes = {}) => (
  normalizeNote({
    ...note,
    ...changes,
    updatedAt: nowIso(),
  })
)

/** Collect a note's id plus all descendant note ids (children via parentNoteId). */
export const collectNoteBranchIds = (notes = [], rootId) => {
  if (!rootId) return []

  const childrenByParent = new Map()
  notes.forEach((note) => {
    if (!note.parentNoteId) return
    if (!childrenByParent.has(note.parentNoteId)) {
      childrenByParent.set(note.parentNoteId, [])
    }
    childrenByParent.get(note.parentNoteId).push(note.id)
  })

  const ids = []
  const stack = [rootId]

  while (stack.length > 0) {
    const nextId = stack.pop()
    if (!nextId || ids.includes(nextId)) continue
    ids.push(nextId)
    const children = childrenByParent.get(nextId) || []
    children.forEach((childId) => stack.push(childId))
  }

  return ids
}

const compareDatesDesc = (a, b) => {
  const aTime = new Date(a || 0).getTime()
  const bTime = new Date(b || 0).getTime()
  return bTime - aTime
}

/** Sort order for the notes panel: pinned first, then anchored notes by position, then free notes by recency. */
export const compareNotes = (a, b) => {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1

  const aIsFree = a.type === 'free'
  const bIsFree = b.type === 'free'

  if (aIsFree !== bIsFree) return aIsFree ? 1 : -1

  if (!aIsFree && !bIsFree) {
    const aFrom = Number.isFinite(a.from) ? a.from : Number.MAX_SAFE_INTEGER
    const bFrom = Number.isFinite(b.from) ? b.from : Number.MAX_SAFE_INTEGER
    if (aFrom !== bFrom) return aFrom - bFrom
    return compareDatesDesc(a.updatedAt, b.updatedAt)
  }

  return compareDatesDesc(a.updatedAt, b.updatedAt)
}
