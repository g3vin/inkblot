/**
 * timelineModel.js — the story's chronology: events, lanes, eras and tags.
 *
 * One chronology per project (`.story/timeline.json`, see timelineStore.js). Timeline
 * documents are only views of it, so every view, every highlighted passage, every map
 * and every canvas card reads the same events, and a change made anywhere is seen
 * everywhere.
 *
 * Time is the map's axis: a day number, a float, day 0 the story's epoch, written
 * through the project calendar (calendar.js). A date is optional. Every event has an
 * `order` — a fractional-index key — and that is what sequence means, dated or not:
 *
 *   - an undated event is placed purely by its key
 *   - a dated event's key is kept consistent with its date (`setEventTime` moves the
 *     key between its dated neighbours when a date changes), so sequence and
 *     chronology never disagree
 *
 * An event is a point (`end` null) or a window (`start`–`end`). Everything else links
 * to an event by id; an event links outward by path (a document, a map's pin or leg, a
 * canvas card, a note), and timelineLinks.js keeps those paths right through renames.
 *
 * Every edit here is pure — a chronology in, a new one out — which is what makes a
 * drag a preview and one undo step (timelineStore.js).
 *
 * JavaScript only, as the map's maths is (see ARCHITECTURE.md, Timeline): the core has
 * the file types (`types::timeline`) and the document kind, not this logic.
 */
import { newId } from '../map/mapModel'

export { newId }

export const TIMELINE_FORMAT_VERSION = 1

export const LINK_KINDS = ['text', 'mapLeg', 'canvas', 'note']

/** Ink ids (src/lib/palette.ts) handed out to new lanes, tags and eras in turn. */
export const LANE_COLORS = ['blue', 'rust', 'green', 'violet', 'amber', 'red', 'teal', 'slate']

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const string = (value, fallback = '') => (typeof value === 'string' ? value : fallback)
const optionalString = (value) => (typeof value === 'string' && value ? value : null)
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const unique = (values) => [...new Set(values)]

/* ---------------- ordering keys ---------------- */

/**
 * Keys are strings over these 62 digits, compared as plain strings (never
 * `localeCompare`), and never end in the lowest digit — so there is always room for a
 * key between two others. The midpoint is Evan Wallace's (rocicorp/fractional-indexing).
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function midpoint(a, b) {
  if (b !== null) {
    let shared = 0
    while ((a[shared] || '0') === b[shared]) shared += 1
    if (shared > 0) return b.slice(0, shared) + midpoint(a.slice(shared), b.slice(shared))
  }
  const low = a ? DIGITS.indexOf(a[0]) : 0
  const high = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length
  if (high - low > 1) return DIGITS[Math.round((low + high) / 2)]
  if (b !== null && b.length > 1) return b.slice(0, 1)
  return DIGITS[low] + midpoint(a.slice(1), null)
}

const validKey = (key) => typeof key === 'string' && key.length > 0 && [...key].every((c) => DIGITS.includes(c)) && !key.endsWith('0')

/** A key strictly between `a` and `b`; either may be null (the start, the end). */
export function keyBetween(a, b) {
  const low = a || ''
  if (b !== null && b !== undefined && low >= b) throw new Error(`keyBetween: ${a} is not before ${b}`)
  // Appending is the common case: step one digit rather than halve, so a key grows by
  // a character every ~60 appends instead of every ~6.
  if ((b === null || b === undefined) && low) return appendKey(low)
  return midpoint(low, b ?? null)
}

function appendKey(a) {
  const digit = DIGITS.indexOf(a[0])
  if (digit < DIGITS.length - 1) return DIGITS[digit + 1]
  // A new place starts at the lowest digit a key may end in, for 61 more appends.
  return a[0] + (a.length > 1 ? appendKey(a.slice(1)) : DIGITS[1])
}

/** `count` keys in order, after `a` and before `b`. */
export function keysBetween(a, b, count) {
  const keys = []
  let previous = a
  for (let index = 0; index < count; index += 1) {
    previous = keyBetween(previous, b)
    keys.push(previous)
  }
  return keys
}

export const compareKeys = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/* ---------------- reading raw JSON ---------------- */

function readLane(raw, nextId) {
  if (!isObject(raw)) return null
  return { ...raw, id: string(raw.id) || nextId(), name: string(raw.name, 'Lane'), color: optionalString(raw.color) }
}

function readTag(raw, nextId) {
  if (!isObject(raw)) return null
  const name = string(raw.name).trim()
  if (!name) return null
  return { ...raw, id: string(raw.id) || nextId(), name, color: optionalString(raw.color) }
}

function readEra(raw, nextId) {
  if (!isObject(raw)) return null
  const a = finite(raw.start)
  const b = finite(raw.end)
  if (a === null || b === null) return null
  return { ...raw, id: string(raw.id) || nextId(), name: string(raw.name, 'Era'), color: optionalString(raw.color), start: Math.min(a, b), end: Math.max(a, b) }
}

/** What on a map an event can be at, besides a place (a pin). */
export const PLACE_ITEM_KINDS = ['region', 'route', 'label', 'body']

/**
 * Where on a map an event's `place` is: `{ map, kind, id }` (kind `pin` for the
 * first form, `{ map, pin }`), or null when it is a document or nowhere.
 */
export function placeTarget(place) {
  if (!place?.map) return null
  if (place.pin) return { map: place.map, kind: 'pin', id: place.pin }
  if (PLACE_ITEM_KINDS.includes(place.kind) && place.item) return { map: place.map, kind: place.kind, id: place.item }
  return null
}

/** The `place` for something on a map: `{ map, pin }` for a pin, else `{ map, kind, item }`. */
export function placeOnMap(map, kind, id) {
  return kind === 'pin' ? { map, pin: id } : { map, kind, item: id }
}

function readPlace(raw) {
  if (!isObject(raw)) return null
  if (typeof raw.map === 'string' && raw.map && typeof raw.pin === 'string' && raw.pin) return { map: raw.map, pin: raw.pin }
  if (typeof raw.map === 'string' && raw.map && PLACE_ITEM_KINDS.includes(raw.kind) && typeof raw.item === 'string' && raw.item) return { map: raw.map, kind: raw.kind, item: raw.item }
  if (typeof raw.doc === 'string' && raw.doc) return { doc: raw.doc }
  return null
}

function readLink(raw) {
  if (!isObject(raw) || !LINK_KINDS.includes(raw.kind)) return null
  switch (raw.kind) {
    case 'text':
      return typeof raw.doc === 'string' && raw.doc ? { kind: 'text', doc: raw.doc } : null
    case 'mapLeg':
      return [raw.map, raw.traveler, raw.leg].every((value) => typeof value === 'string' && value)
        ? { kind: 'mapLeg', map: raw.map, traveler: raw.traveler, leg: raw.leg }
        : null
    case 'canvas':
      return typeof raw.path === 'string' && raw.path && typeof raw.node === 'string' && raw.node
        ? { kind: 'canvas', path: raw.path, node: raw.node }
        : null
    case 'note':
      return typeof raw.doc === 'string' && raw.doc && typeof raw.noteId === 'string' && raw.noteId
        ? { kind: 'note', doc: raw.doc, noteId: raw.noteId }
        : null
    default:
      return null
  }
}

/** A link's identity: two links with the same key are the same link. */
export const linkKey = (link) => {
  switch (link.kind) {
    case 'text': return `text|${link.doc}`
    case 'mapLeg': return `mapLeg|${link.map}|${link.traveler}|${link.leg}`
    case 'canvas': return `canvas|${link.path}|${link.node}`
    case 'note': return `note|${link.doc}|${link.noteId}`
    default: return ''
  }
}

function readEventNote(raw, nextId) {
  if (!isObject(raw)) return null
  return { ...raw, id: string(raw.id) || nextId(), text: string(raw.text), at: finite(raw.at) }
}

function readEvent(raw, nextId, { laneIds, tagIds }) {
  if (!isObject(raw)) return null
  let start = finite(raw.start)
  let end = start === null ? null : finite(raw.end)
  if (end !== null && end < start) [start, end] = [end, start]
  if (end !== null && end === start) end = null
  const seenLinks = new Set()
  const links = []
  for (const link of (Array.isArray(raw.links) ? raw.links : []).map(readLink).filter(Boolean)) {
    const key = linkKey(link)
    if (seenLinks.has(key)) continue
    seenLinks.add(key)
    links.push(link)
  }
  return {
    ...raw,
    id: string(raw.id) || nextId(),
    title: string(raw.title),
    summary: string(raw.summary),
    color: optionalString(raw.color),
    laneId: laneIds.has(raw.laneId) ? raw.laneId : null,
    tagIds: unique((Array.isArray(raw.tagIds) ? raw.tagIds : []).filter((id) => tagIds.has(id))),
    order: validKey(raw.order) ? raw.order : null,
    start,
    end,
    participants: unique((Array.isArray(raw.participants) ? raw.participants : []).filter((path) => typeof path === 'string' && path)),
    place: readPlace(raw.place),
    links,
    notes: (Array.isArray(raw.notes) ? raw.notes : []).map((note) => readEventNote(note, nextId)).filter(Boolean),
  }
}

/** Ids made unique: a repeated one is replaced, never merged. */
function withUniqueIds(items, nextId) {
  const seen = new Set()
  return items.map((item) => {
    if (!seen.has(item.id)) {
      seen.add(item.id)
      return item
    }
    let id = nextId()
    while (seen.has(id)) id = nextId()
    seen.add(id)
    return { ...item, id }
  })
}

/**
 * Anything → a chronology. Unknown keys survive (a newer Inkblot's fields are kept),
 * dangling lane and tag ids are dropped, and every event comes out with a unique key:
 * one missing or repeated is given a fresh key after the ones already in order.
 */
export function normalizeTimeline(raw, nextId = newId) {
  const source = isObject(raw) ? raw : {}
  const lanes = withUniqueIds((Array.isArray(source.lanes) ? source.lanes : []).map((lane) => readLane(lane, nextId)).filter(Boolean), nextId)
  const tags = withUniqueIds((Array.isArray(source.tags) ? source.tags : []).map((tag) => readTag(tag, nextId)).filter(Boolean), nextId)
  const eras = withUniqueIds((Array.isArray(source.eras) ? source.eras : []).map((era) => readEra(era, nextId)).filter(Boolean), nextId)
  const context = { laneIds: new Set(lanes.map((lane) => lane.id)), tagIds: new Set(tags.map((tag) => tag.id)) }
  const read = withUniqueIds((Array.isArray(source.events) ? source.events : []).map((event) => readEvent(event, nextId, context)).filter(Boolean), nextId)

  // Keys: keep the first holder of each valid key; everyone else goes after the last.
  const taken = new Set()
  const keyless = []
  for (const event of read) {
    if (event.order && !taken.has(event.order)) taken.add(event.order)
    else keyless.push(event.id)
  }
  const last = [...taken].sort(compareKeys).pop() ?? null
  const fresh = new Map(keysBetween(last, null, keyless.length).map((key, index) => [keyless[index], key]))
  const events = read.map((event) => (fresh.has(event.id) ? { ...event, order: fresh.get(event.id) } : event))

  return { ...source, version: TIMELINE_FORMAT_VERSION, events, lanes, eras, tags }
}

export const createEmptyTimeline = () => normalizeTimeline({})

/* ---------------- reading the sequence ---------------- */

/** Events in sequence: by key. */
export const sortedEvents = (timeline) => [...timeline.events].sort((a, b) => compareKeys(a.order, b.order))

export const eventById = (timeline, id) => timeline.events.find((event) => event.id === id) || null

export const isDated = (event) => event.start !== null
export const eventEnd = (event) => (event.end ?? event.start)

/**
 * Where every event sits, for drawing: `{ id, index, start, end, dated }` in sequence.
 *
 *   time      a dated event at its dates; an undated one spread evenly between the
 *             dated events before and after it in sequence (a step of one day past
 *             either end), so a draft with a few dates already reads in order
 *   sequence  every event one unit apart by position
 */
export function layoutChronology(timeline, { scale = 'time' } = {}) {
  const events = sortedEvents(timeline)
  if (scale === 'sequence') {
    return events.map((event, index) => ({ id: event.id, index, start: index, end: index, dated: isDated(event) }))
  }
  const out = events.map((event, index) => ({ id: event.id, index, start: event.start, end: eventEnd(event), dated: isDated(event) }))
  let index = 0
  while (index < out.length) {
    if (out[index].dated) {
      index += 1
      continue
    }
    let runEnd = index
    while (runEnd < out.length && !out[runEnd].dated) runEnd += 1
    const before = index > 0 ? out[index - 1] : null
    const after = runEnd < out.length ? out[runEnd] : null
    const count = runEnd - index
    let from
    let step
    if (before && after) {
      from = before.end
      step = (after.start - before.end) / (count + 1)
    } else if (before) {
      from = before.end
      step = 1
    } else if (after) {
      from = after.start - (count + 1)
      step = 1
    } else {
      from = -1
      step = 1
    }
    for (let offset = 0; offset < count; offset += 1) {
      const at = from + step * (offset + 1)
      out[index + offset] = { ...out[index + offset], start: at, end: at }
    }
    index = runEnd
  }
  return out
}

/** The span every placed event covers, padded; `[fallback, fallback + 30]` for none. */
export function chronologyExtent(layout, fallback = 0) {
  if (!layout.length) return [fallback, fallback + 30]
  let min = Infinity
  let max = -Infinity
  for (const item of layout) {
    min = Math.min(min, item.start)
    max = Math.max(max, item.end)
  }
  const pad = Math.max(1, (max - min) * 0.05)
  return [min - pad, max + pad]
}

/**
 * The events a window of the axis touches, as ids. A lens is `{ from, to, scale }` —
 * days, or sequence positions when `scale` is `sequence` — and an event counts when its
 * placed span overlaps the window at all. Undated events count only by sequence: a
 * guessed date is not a date.
 */
export function eventsInWindow(timeline, lens) {
  if (!lens || !Number.isFinite(lens.from) || !Number.isFinite(lens.to)) return []
  const from = Math.min(lens.from, lens.to)
  const to = Math.max(lens.from, lens.to)
  const scale = lens.scale === 'sequence' ? 'sequence' : 'time'
  return layoutChronology(timeline, { scale })
    .filter((item) => (scale === 'sequence' || item.dated) && item.end >= from && item.start <= to)
    .map((item) => item.id)
}

/**
 * The lens as it applies to this chronology. A lens on dates over a story with none
 * works in sequence instead; one whose window misses the story entirely (never placed,
 * or the story moved) is put over its first fifth.
 */
export function effectiveLens(timeline, lens) {
  const anyDated = timeline.events.some(isDated)
  const scale = anyDated && lens.scale !== 'sequence' ? 'time' : 'sequence'
  const layout = layoutChronology(timeline, { scale })
  const [from, to] = scale === 'sequence' ? [-0.5, Math.max(layout.length, 1) - 0.5] : chronologyExtent(layout, 0)
  const fits = lens.scale === scale && Number.isFinite(lens.from) && Number.isFinite(lens.to) && lens.to >= from && lens.from <= to
  if (fits) return { ...lens, scale, extent: [from, to], layout }
  return { ...lens, scale, from, to: from + (to - from) / 5, extent: [from, to], layout }
}

/** Whether a day lies in an event (a point: that same day). */
export const eventCovers = (event, day) => isDated(event) && day >= event.start && day <= (event.end ?? event.start + 1)

/* ---------------- edits ---------------- */

const mapEvent = (timeline, id, fn) => ({
  ...timeline,
  events: timeline.events.map((event) => (event.id === id ? fn(event) : event)),
})

/** A new event, placed at the end of the sequence unless `after` or `before` names one. */
export function addEvent(timeline, partial = {}, { after = null, before = null, nextId = newId } = {}) {
  const sequence = sortedEvents(timeline)
  let low = sequence.length ? sequence[sequence.length - 1].order : null
  let high = null
  const anchorIndex = sequence.findIndex((event) => event.id === (after || before))
  if (anchorIndex >= 0) {
    if (after) {
      low = sequence[anchorIndex].order
      high = sequence[anchorIndex + 1]?.order ?? null
    } else {
      low = sequence[anchorIndex - 1]?.order ?? null
      high = sequence[anchorIndex].order
    }
  }
  const event = normalizeTimeline(
    { ...timeline, events: [{ title: 'New event', ...partial, id: partial.id || nextId(), order: keyBetween(low, high) }] },
    nextId
  ).events[0]
  const next = { ...timeline, events: [...timeline.events, event] }
  return { timeline: isDated(event) ? setEventTime(next, event.id, event.start, event.end) : next, id: event.id }
}

/** A patch of an event's plain fields. Dates go through setEventTime, which keeps order. */
export function updateEvent(timeline, id, patch) {
  // Neither the id nor the key is patched: the key follows sequence moves and dates.
  const rest = { ...patch }
  for (const key of ['id', 'order', 'start', 'end']) delete rest[key]
  const { start, end } = patch
  let next = mapEvent(timeline, id, (event) => ({ ...event, ...rest }))
  if ('start' in patch || 'end' in patch) {
    const current = eventById(next, id)
    next = setEventTime(next, id, 'start' in patch ? start : current.start, 'end' in patch ? end : current.end)
  }
  return normalizeTimeline(next)
}

/**
 * Date an event (or undate it, `start` null). A dated event whose key no longer sits
 * between its dated neighbours is given a key that does — just before the first dated
 * event that comes later, or at the end — so sequence follows the new date. An undated
 * event keeps its key.
 */
export function setEventTime(timeline, id, start, end = null) {
  const target = eventById(timeline, id)
  if (!target) return timeline
  const nextStart = finite(start)
  let nextEnd = nextStart === null ? null : finite(end)
  let from = nextStart
  if (nextEnd !== null && nextEnd < from) [from, nextEnd] = [nextEnd, from]
  if (nextEnd !== null && nextEnd === from) nextEnd = null
  let next = mapEvent(timeline, id, (event) => ({ ...event, start: from, end: nextEnd }))
  if (from === null) return next

  const others = sortedEvents(next).filter((event) => event.id !== id)
  const dated = others.filter(isDated)
  const previous = [...dated].reverse().find((event) => event.start <= from) || null
  const following = dated.find((event) => event.start > from) || null
  const key = target.order
  const fits = (!previous || compareKeys(previous.order, key) < 0) && (!following || compareKeys(key, following.order) < 0)
  if (fits) return next

  let low
  let high
  if (following) {
    const index = others.indexOf(following)
    low = others[index - 1]?.order ?? null
    high = following.order
    // Never jump back over the dated event that must stay before this one.
    if (previous && low !== null && compareKeys(low, previous.order) < 0) low = previous.order
  } else {
    low = others.length ? others[others.length - 1].order : null
    high = null
  }
  next = mapEvent(next, id, (event) => ({ ...event, order: keyBetween(low, high) }))
  return next
}

/** Shift an event in time by `days`, window and all. */
export function shiftEvent(timeline, id, days) {
  const event = eventById(timeline, id)
  if (!event || !isDated(event) || !Number.isFinite(days)) return timeline
  return setEventTime(timeline, id, event.start + days, event.end === null ? null : event.end + days)
}

/**
 * Move an event in the sequence to just after `prevId`, or just before `nextId` when
 * only that is given (both null: to the very start). A dated event moved past a dated
 * neighbour takes a date between its new dated neighbours, since sequence and
 * chronology must agree.
 */
export function moveEventBetween(timeline, id, prevId, nextId = null) {
  const target = eventById(timeline, id)
  if (!target) return timeline
  const others = sortedEvents(timeline).filter((event) => event.id !== id)
  let lowIndex
  if (prevId) lowIndex = others.findIndex((event) => event.id === prevId)
  else if (nextId) lowIndex = others.findIndex((event) => event.id === nextId) - 1
  else lowIndex = -1
  if (prevId && lowIndex < 0) return timeline
  const low = lowIndex >= 0 ? others[lowIndex].order : null
  const high = others[lowIndex + 1]?.order ?? null
  let next = mapEvent(timeline, id, (event) => ({ ...event, order: keyBetween(low, high) }))
  if (!isDated(target)) return next

  // Keep the date inside the dated neighbours now around it.
  const sequence = sortedEvents(next)
  const at = sequence.findIndex((event) => event.id === id)
  const prior = sequence.slice(0, at).reverse().find(isDated) || null
  const later = sequence.slice(at + 1).find(isDated) || null
  const length = target.end === null ? 0 : target.end - target.start
  let start = target.start
  if (prior && start < prior.start) start = later ? (prior.start + later.start) / 2 : prior.start
  if (later && start > later.start) start = prior ? (prior.start + later.start) / 2 : later.start
  if (start !== target.start) {
    next = mapEvent(next, id, (event) => ({ ...event, start, end: event.end === null ? null : start + length }))
  }
  return next
}

export function removeEvent(timeline, id) {
  return { ...timeline, events: timeline.events.filter((event) => event.id !== id) }
}

/** An event's link, added once. */
export function addLink(timeline, id, link) {
  const read = readLink(link)
  if (!read) return timeline
  return mapEvent(timeline, id, (event) =>
    event.links.some((existing) => linkKey(existing) === linkKey(read)) ? event : { ...event, links: [...event.links, read] }
  )
}

export function removeLink(timeline, id, link) {
  const key = linkKey(link)
  return mapEvent(timeline, id, (event) => ({ ...event, links: event.links.filter((existing) => linkKey(existing) !== key) }))
}

export function addEventNote(timeline, id, { text = '', at = null } = {}, nextId = newId) {
  const note = { id: nextId(), text, at: finite(at) }
  return { timeline: mapEvent(timeline, id, (event) => ({ ...event, notes: [...event.notes, note] })), noteId: note.id }
}

export function updateEventNote(timeline, id, noteId, patch) {
  return mapEvent(timeline, id, (event) => ({
    ...event,
    notes: event.notes.map((note) => (note.id === noteId ? { ...note, ...patch, id: note.id, at: 'at' in patch ? finite(patch.at) : note.at } : note)),
  }))
}

export function removeEventNote(timeline, id, noteId) {
  return mapEvent(timeline, id, (event) => ({ ...event, notes: event.notes.filter((note) => note.id !== noteId) }))
}

/* ---------------- lanes, tags, eras ---------------- */

export function addLane(timeline, name = 'New lane', nextId = newId) {
  const lane = { id: nextId(), name, color: LANE_COLORS[timeline.lanes.length % LANE_COLORS.length] }
  return { timeline: { ...timeline, lanes: [...timeline.lanes, lane] }, id: lane.id }
}

export const updateLane = (timeline, id, patch) => ({
  ...timeline,
  lanes: timeline.lanes.map((lane) => (lane.id === id ? { ...lane, ...patch, id } : lane)),
})

/** A lane removed; its events move to no lane rather than going with it. */
export const removeLane = (timeline, id) => ({
  ...timeline,
  lanes: timeline.lanes.filter((lane) => lane.id !== id),
  events: timeline.events.map((event) => (event.laneId === id ? { ...event, laneId: null } : event)),
})

/** Lanes reordered to `ids` (any lane not named keeps its place after them). */
export function reorderLanes(timeline, ids) {
  const byId = new Map(timeline.lanes.map((lane) => [lane.id, lane]))
  const named = ids.map((id) => byId.get(id)).filter(Boolean)
  const rest = timeline.lanes.filter((lane) => !ids.includes(lane.id))
  return { ...timeline, lanes: [...named, ...rest] }
}

export function addTag(timeline, name, nextId = newId) {
  const clean = String(name || '').trim()
  if (!clean) return { timeline, id: null }
  const existing = timeline.tags.find((tag) => tag.name.toLowerCase() === clean.toLowerCase())
  if (existing) return { timeline, id: existing.id }
  const tag = { id: nextId(), name: clean, color: LANE_COLORS[timeline.tags.length % LANE_COLORS.length] }
  return { timeline: { ...timeline, tags: [...timeline.tags, tag] }, id: tag.id }
}

export const updateTag = (timeline, id, patch) => ({
  ...timeline,
  tags: timeline.tags.map((tag) => (tag.id === id ? { ...tag, ...patch, id } : tag)),
})

export const removeTag = (timeline, id) => ({
  ...timeline,
  tags: timeline.tags.filter((tag) => tag.id !== id),
  events: timeline.events.map((event) => ({ ...event, tagIds: event.tagIds.filter((tagId) => tagId !== id) })),
})

export function addEra(timeline, { name = 'New era', start, end, color = null }, nextId = newId) {
  const era = readEra({ id: nextId(), name, start, end, color: color || LANE_COLORS[(timeline.eras.length + 3) % LANE_COLORS.length] }, nextId)
  if (!era) return { timeline, id: null }
  return { timeline: { ...timeline, eras: [...timeline.eras, era] }, id: era.id }
}

export const updateEra = (timeline, id, patch) =>
  normalizeTimeline({ ...timeline, eras: timeline.eras.map((era) => (era.id === id ? { ...era, ...patch, id } : era)) })

export const removeEra = (timeline, id) => ({ ...timeline, eras: timeline.eras.filter((era) => era.id !== id) })

/* ---------------- views ---------------- */

/**
 * A timeline view (`<name>.timeline.json`): how one document shows the chronology.
 * It holds no events — only the scale, the zoom, what is filtered and how lanes sit.
 */
export const TIMELINE_VIEW_TYPE = 'timeline-view'

/**
 * How a view lays the chronology out: along dates, evenly in sequence, or as the
 * manuscript — passages in reading order, each joined to when it happens.
 */
export const TIMELINE_SCALES = ['time', 'sequence', 'manuscript']

export function normalizeTimelineView(raw) {
  const source = isObject(raw) ? raw : {}
  const filter = isObject(source.filter) ? source.filter : {}
  const strings = (value) => unique((Array.isArray(value) ? value : []).filter((item) => typeof item === 'string' && item))
  const range = Array.isArray(source.range) && source.range.length === 2 && source.range.every((value) => finite(value) !== null) && source.range[0] < source.range[1]
    ? [source.range[0], source.range[1]]
    : null
  return {
    ...source,
    type: TIMELINE_VIEW_TYPE,
    version: TIMELINE_FORMAT_VERSION,
    scale: TIMELINE_SCALES.includes(source.scale) ? source.scale : 'time',
    manuscriptFolder: string(source.manuscriptFolder),
    range,
    filter: { lanes: strings(filter.lanes), tags: strings(filter.tags), participants: strings(filter.participants), text: string(filter.text) },
    collapsedLanes: strings(source.collapsedLanes),
    showJourneys: source.showJourneys !== false,
  }
}

export const createEmptyTimelineView = () => normalizeTimelineView({})

/** A view, or nothing there yet — what a view may be written over. */
export const isTimelineViewPayload = (raw) => raw === null || raw === undefined || (isObject(raw) && raw.type === TIMELINE_VIEW_TYPE)

/** Whether an event passes a view's filter (lanes, tags, participants, text). */
export function eventMatchesFilter(event, filter) {
  if (!filter) return true
  if (filter.lanes?.length && !filter.lanes.includes(event.laneId || '')) return false
  if (filter.tags?.length && !event.tagIds.some((id) => filter.tags.includes(id))) return false
  if (filter.participants?.length && !event.participants.some((path) => filter.participants.includes(path))) return false
  const text = (filter.text || '').trim().toLowerCase()
  if (text && !`${event.title}\n${event.summary}\n${event.notes.map((note) => note.text).join('\n')}`.toLowerCase().includes(text)) return false
  return true
}

/* ---------------- the manuscript against the chronology ---------------- */

/**
 * Passages in reading order, each placed in the chronology: `[{ ...passage, rank,
 * at, jump }]`, dropping passages whose event is gone.
 *
 *   rank  the event's place in sequence (0 first) — story order
 *   at    where it sits on the chronology axis (a day, or a position when `scale` is
 *         'sequence' or nothing is dated)
 *   jump  'back' when it happens before the passage read just before it — a
 *         flashback; 'forward' when it leaps past events the manuscript tells only
 *         later — a flash-forward; null when the story continues, or resumes after
 *         a flashback
 *
 * `passages` are `{ doc, id, eventId, from, anchor }`, already in reading order.
 */
export function manuscriptThreads(timeline, passages, { scale = 'time' } = {}) {
  const sequence = sortedEvents(timeline)
  const rankOf = new Map(sequence.map((event, index) => [event.id, index]))
  const anyDated = sequence.some(isDated)
  const axis = scale === 'sequence' || !anyDated ? 'sequence' : 'time'
  const placed = new Map(layoutChronology(timeline, { scale: axis }).map((item) => [item.id, item]))
  // Where in the reading each event is first told.
  const firstTold = new Map()
  passages.forEach((passage, index) => {
    if (rankOf.has(passage.eventId) && !firstTold.has(passage.eventId)) firstTold.set(passage.eventId, index)
  })
  const out = []
  let previous = null
  passages.forEach((passage, index) => {
    if (!rankOf.has(passage.eventId)) return
    const rank = rankOf.get(passage.eventId)
    let jump = null
    if (previous !== null && rank < previous) jump = 'back'
    else if (previous !== null && rank > previous + 1) {
      // Leaping over events the reader is yet to be told is a flash-forward; leaping over
      // ones already told (the end of a flashback) or never told is the story going on.
      const leapt = sequence.slice(previous + 1, rank).some((event) => (firstTold.get(event.id) ?? -1) > index)
      if (leapt) jump = 'forward'
    }
    out.push({ ...passage, rank, at: placed.get(passage.eventId).start, axis, jump })
    previous = rank
  })
  return out
}

/* ---------------- following documents ---------------- */

/** A path moved: `from` itself, or anything under it when it was a folder. */
const movedPath = (path, from, to, type) => {
  if (path === from) return to
  if (type === 'folder' && path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`
  return path
}

/**
 * Every path a chronology holds, rewritten for a document (or folder) moved from
 * `from` to `to`. Returns the same object when nothing named it.
 */
export function rewriteTimelineDocRefs(timeline, from, to, type = 'file') {
  let changed = false
  const move = (path) => {
    const next = movedPath(path, from, to, type)
    if (next !== path) changed = true
    return next
  }
  const events = timeline.events.map((event) => ({
    ...event,
    participants: event.participants.map(move),
    place: event.place?.doc ? { doc: move(event.place.doc) } : event.place?.map ? { ...event.place, map: move(event.place.map) } : event.place,
    links: event.links.map((link) => {
      switch (link.kind) {
        case 'text':
        case 'note':
          return { ...link, doc: move(link.doc) }
        case 'mapLeg':
          return { ...link, map: move(link.map) }
        case 'canvas':
          return { ...link, path: move(link.path) }
        default:
          return link
      }
    }),
  }))
  return changed ? { ...timeline, events } : timeline
}

/** Every document path a chronology refers to — what a rename must follow. */
export function timelineDocRefs(timeline) {
  const paths = new Set()
  for (const event of timeline.events) {
    event.participants.forEach((path) => paths.add(path))
    if (event.place?.doc) paths.add(event.place.doc)
    if (event.place?.map) paths.add(event.place.map)
    for (const link of event.links) paths.add(link.doc || link.map || link.path)
  }
  return [...paths]
}
