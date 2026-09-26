/**
 * timeline — the story's chronology and everything tied to it.
 *
 * Each assertion is something a writer would notice if it were false: an undated
 * scene that jumps to the end when an event before it is dated, a flashback the
 * manuscript view calls "in order", a passage highlight that drifts onto the wrong
 * words after typing above it, an undo that puts the event back but leaves its
 * journey leg where it was dragged, a renamed character who drops out of every event.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent',
  'MutationObserver', 'getComputedStyle', 'DOMParser'])
const noRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })
for (const proto of [dom.window.Element.prototype, dom.window.Range.prototype, dom.window.Text.prototype]) {
  proto.getClientRects ??= () => []
  proto.getBoundingClientRect ??= noRect
}

const S = '../../src'
const T = await import(`${S}/lib/timeline/timelineModel.js`)
const store = await import(`${S}/lib/timeline/timelineStore.js`)
const cursor = await import(`${S}/lib/timeline/storyCursor.js`)
const { boundViewport, calendarTicks, sequenceTicks } = await import(`${S}/lib/timeline/timelineScale.js`)
const { normalizeRanges } = await import(`${S}/lib/timeline/timelineRanges.js`)
const { buildLanes } = await import(`${S}/timeline/timelineRows.js`)
const { saveDocument, saveDocumentTimeline, loadDocument } = await import(`${S}/lib/FileSystem.js`)
const { getDocKind, isTimelineDoc, withDocSuffix } = await import(`${S}/lib/docKind.js`)
const { Editor } = await import('@tiptap/core')
const { StarterKit } = await import('@tiptap/starter-kit')
const anchors = await import(`${S}/extensions/TimelineAnchors.js`)
const { files } = await import('./stub-fs.mjs')

const titles = (tl) => T.sortedEvents(tl).map((event) => event.title).join(' ')
let counter = 0
const ids = () => `id${counter++}`

/* ---------------- ordering keys ---------------- */

{
  let key = null
  const keys = []
  for (let i = 0; i < 500; i += 1) keys.push((key = T.keyBetween(key, null)))
  ok('appended keys only ever increase', keys.every((k, i) => i === 0 || keys[i - 1] < k))
  ok('500 appends keep keys short', keys.at(-1).length <= 16)
  let low = 'V'
  let high = 'W'
  let dense = true
  for (let i = 0; i < 60; i += 1) {
    const mid = T.keyBetween(low, high)
    if (!(low < mid && mid < high)) dense = false
    high = mid
  }
  ok('there is always a key between two others', dense)
  let threw = false
  try { T.keyBetween('b', 'a') } catch { threw = true }
  ok('a key cannot be asked for between two out of order', threw)
}

/* ---------------- normalizing ---------------- */

{
  const tl = T.normalizeTimeline({
    lanes: [{ id: 'l', name: 'Kira' }],
    tags: [{ id: 't', name: 'clue' }, { name: '  ' }],
    events: [
      { id: 'x', title: 'a', order: 'V', laneId: 'gone', tagIds: ['t', 'missing'], start: 9, end: 3, future: 'kept' },
      { id: 'x', title: 'b', order: 'V' },
      { title: 'c' },
      { title: 'd', start: null, end: 4 },
      { title: 'e', links: [{ kind: 'text', doc: 'One' }, { kind: 'text', doc: 'One' }, { kind: 'nonsense' }] },
    ],
  }, ids)
  const [a, b, c, d, e] = tl.events
  ok('a repeated id is replaced, not merged', a.id === 'x' && b.id !== 'x')
  ok('keys come out unique', new Set(tl.events.map((event) => event.order)).size === tl.events.length)
  ok('a dangling lane goes', a.laneId === null)
  ok('a dangling tag goes, a real one stays', a.tagIds.length === 1 && a.tagIds[0] === 't')
  ok('a nameless tag is dropped', tl.tags.length === 1)
  ok('a window given backwards is turned round', a.start === 3 && a.end === 9)
  ok('an undated event has no end', d.start === null && d.end === null)
  ok('unknown keys survive', a.future === 'kept')
  ok('the same link twice is one link; nonsense is none', e.links.length === 1)
  ok('an event without a key goes after those that had one', c.order > a.order)
}

/* ---------------- dated and undated, in one sequence ---------------- */

{
  let tl = T.createEmptyTimeline()
  const add = (partial, options) => {
    const result = T.addEvent(tl, partial, { ...options, nextId: ids })
    tl = result.timeline
    return result.id
  }
  const war = add({ title: 'war', start: 10 })
  const u1 = add({ title: 'u1' })
  add({ title: 'u2' })
  const peace = add({ title: 'peace', start: 20, end: 25 })

  const layout = T.layoutChronology(tl)
  const at = (id) => layout.find((item) => item.id === id)
  ok('undated events sit between the dated events around them', at(u1).start > 10 && at(u1).start < 20 && !at(u1).dated)
  ok('a window is drawn to its end', at(peace).end === 25)
  ok('in sequence, every event is one step apart', T.layoutChronology(tl, { scale: 'sequence' }).map((item) => item.start).join() === '0,1,2,3')

  tl = T.setEventTime(tl, war, 30)
  ok('dating an event later moves it along in sequence', titles(tl) === 'u1 u2 peace war')
  ok('undated events keep their place', T.sortedEvents(tl)[0].id === u1)

  tl = T.moveEventBetween(tl, war, null, peace)
  const moved = T.eventById(tl, war)
  ok('a dated event dragged before another in sequence is redated to fit', titles(tl) === 'u1 u2 war peace' && moved.start <= 20)

  tl = T.setEventTime(tl, war, null)
  ok('undating keeps the place in sequence', titles(tl) === 'u1 u2 war peace' && T.eventById(tl, war).start === null)

  tl = T.shiftEvent(tl, peace, 5)
  ok('shifting a window moves both ends', T.eventById(tl, peace).start === 25 && T.eventById(tl, peace).end === 30)

  ok('the lens finds a dated event in its window', T.eventsInWindow(tl, { from: 24, to: 26, scale: 'time' }).includes(peace))
  ok('the lens does not guess dates for undated ones', !T.eventsInWindow(tl, { from: -100, to: 100, scale: 'time' }).includes(u1))
  ok('in sequence, the lens counts positions', T.eventsInWindow(tl, { from: -0.5, to: 0.5, scale: 'sequence' })[0] === u1)

  const lens = T.effectiveLens(T.normalizeTimeline({ events: [{ title: 'only undated' }] }), { on: true, from: 0, to: 7, scale: 'time' })
  ok('a lens on dates over a story with none works in sequence', lens.scale === 'sequence')
  const missed = T.effectiveLens(tl, { on: true, from: 5000, to: 5010, scale: 'time' })
  ok('a lens that misses the story is put over it', missed.from < 100)
}

/* ---------------- lanes, tags, eras, filters ---------------- */

{
  let tl = T.createEmptyTimeline()
  const lane = T.addLane(tl, 'Kira', ids)
  tl = lane.timeline
  const tag = T.addTag(tl, 'Clue', ids)
  tl = tag.timeline
  ok('adding a tag that exists returns it', T.addTag(tl, 'clue', ids).id === tag.id)
  const first = T.addEvent(tl, { title: 'found the key', laneId: lane.id, tagIds: [tag.id], participants: ['Characters/Kira'] }, { nextId: ids })
  tl = first.timeline
  tl = T.addEvent(tl, { title: 'lunch' }, { nextId: ids }).timeline
  const event = T.eventById(tl, first.id)
  ok('a lane filter keeps its lane', T.eventMatchesFilter(event, { lanes: [lane.id], tags: [], participants: [], text: '' }))
  ok('a tag filter keeps tagged events', T.eventMatchesFilter(event, { lanes: [], tags: [tag.id], participants: [], text: '' }))
  ok('a text filter reads titles', !T.eventMatchesFilter(T.sortedEvents(tl)[1], { lanes: [], tags: [], participants: [], text: 'key' }))

  const view = T.normalizeTimelineView({ scale: 'time', filter: { participants: ['Characters/Kira'] } })
  const lanes = buildLanes({ timeline: tl, layout: T.layoutChronology(tl), view, journeys: [], toX: (x) => x * 10 })
  ok('a participant filter leaves only their events', lanes.flatMap((item) => item.items).length === 1)

  tl = T.removeLane(tl, lane.id)
  ok('deleting a lane keeps its events, in no lane', T.eventById(tl, first.id).laneId === null)
  tl = T.removeTag(tl, tag.id)
  ok('deleting a tag untags its events', T.eventById(tl, first.id).tagIds.length === 0)
  const era = T.addEra(tl, { name: 'Winter', start: 40, end: 10 }, ids)
  ok('an era given backwards is turned round', era.timeline.eras[0].start === 10 && era.timeline.eras[0].end === 40)
}

/* ---------------- the manuscript against the chronology ---------------- */

{
  let tl = T.createEmptyTimeline()
  const event = {}
  for (const [title, start] of [['birth', 0], ['war', 100], ['meeting', 200], ['wedding', 300], ['end', 400]]) {
    const result = T.addEvent(tl, { title, start }, { nextId: ids })
    tl = result.timeline
    event[title] = result.id
  }
  const read = (names) => T.manuscriptThreads(tl, names.map((name, index) => ({ doc: 'Book/One', id: `p${index}`, eventId: event[name], from: index })))
  const jumps = (names) => read(names).map((thread) => thread.jump || '-').join(' ')

  ok('a story told in order has no jumps', jumps(['birth', 'war', 'meeting']) === '- - -')
  ok('going back before what was just read is a flashback', jumps(['meeting', 'wedding', 'birth']) === '- - back')
  ok('coming back from a flashback is not a jump', jumps(['meeting', 'wedding', 'birth', 'end']) === '- - back -')
  ok('leaping past events told later is a flash-forward', jumps(['birth', 'wedding', 'war', 'meeting']) === '- forward back -')
  ok('skipping events never told is just what was left out', jumps(['birth', 'end']) === '- -')
  ok('a passage whose event is gone is dropped', T.manuscriptThreads(tl, [{ doc: 'x', id: 'p', eventId: 'gone', from: 0 }]).length === 0)
  ok('each passage is placed at when it happens', read(['war'])[0].at === 100)
}

/* ---------------- views and kinds ---------------- */

{
  ok('a .timeline path is a timeline view', getDocKind('Plot/Main.timeline') === 'timeline' && isTimelineDoc('Plot/Main.timeline'))
  ok('a name mentioning it mid-way is a document', getDocKind('Plot/Main.timeline.old') === 'text')
  ok('creating one gives it the suffix', withDocSuffix('Main', 'timeline') === 'Main.timeline')
  const view = T.normalizeTimelineView({ scale: 'manuscript', range: [5, 1], filter: { lanes: ['a', 'a', 7] } })
  ok('the manuscript scale is kept', view.scale === 'manuscript')
  ok('a nonsense range is dropped', view.range === null)
  ok('filters are strings, once', view.filter.lanes.length === 1)
  ok('a view is marked as one', T.isTimelineViewPayload(view) && !T.isTimelineViewPayload({ content: [] }))
}

/* ---------------- following documents ---------------- */

{
  const tl = T.normalizeTimeline({
    events: [{
      title: 'x',
      participants: ['Characters/Kira', 'Characters/Kiran'],
      place: { doc: 'Places/Harbour' },
      links: [{ kind: 'text', doc: 'Book/One' }, { kind: 'canvas', path: 'Board.canvas', node: 'n' }, { kind: 'mapLeg', map: 'World.map', traveler: 't', leg: 'g' }],
    }],
  }, ids)
  const renamed = T.rewriteTimelineDocRefs(tl, 'Characters/Kira', 'Characters/Kira Vale')
  ok('a renamed participant is followed', renamed.events[0].participants[0] === 'Characters/Kira Vale')
  ok('a name that only starts the same is left alone', renamed.events[0].participants[1] === 'Characters/Kiran')
  const moved = T.rewriteTimelineDocRefs(tl, 'Book', 'Manuscript', 'folder')
  ok('a moved folder takes its passages with it', moved.events[0].links[0].doc === 'Manuscript/One')
  ok('nothing named: the same object back', T.rewriteTimelineDocRefs(tl, 'Nope', 'Other') === tl)
  ok('every path the chronology holds is listed', T.timelineDocRefs(tl).includes('World.map') && T.timelineDocRefs(tl).includes('Board.canvas'))
}

/* ---------------- ticks ---------------- */

{
  const custom = { mode: 'custom', custom: { months: [{ name: 'Thaw', days: 40 }, { name: 'Frost', days: 40 }], weekdays: [], yearZero: 1, era: 'AR', leap: null } }
  const ticks = calendarTicks(custom, 0, 200, 4)
  ok('a custom calendar ticks at its own month boundaries', ticks.some((tick) => tick.at === 40 && tick.label === 'Frost'))
  ok('a new year is named with its era', ticks.some((tick) => tick.at === 80 && tick.label.includes('Year 2 AR')))
  ok('a year of two months never ticks every third month', calendarTicks(custom, 0, 2000, 1).every((tick) => tick.label.includes('Year')))
  ok('story days tick in round counts', calendarTicks({ mode: 'day' }, 0, 100, 10).every((tick) => Number.isInteger(tick.at)))
  const zoomedOut = boundViewport({ origin: -500, px: 0.01 }, [0, 100], 500)
  ok('the axis zooms out no further than first event to last', zoomedOut.px === 5 && zoomedOut.origin === 0)
  ok('nor pans before the first event', boundViewport({ origin: -40, px: 10 }, [0, 100], 500).origin === 0)
  ok('nor past the last', boundViewport({ origin: 90, px: 10 }, [0, 100], 500).origin === 50)
  ok('a view inside the span is left be', boundViewport({ origin: 20, px: 10 }, [0, 100], 500).origin === 20)
  ok('sequence ticks are numbered from one', sequenceTicks(0, 3, 100)[0].label === '#1')
}

/* ---------------- the store: preview, commit, undo across files ---------------- */

{
  const P = 'Chronicle'
  store.resetStoryTimeline()
  const loaded = await store.loadStoryTimeline(P)
  ok('a project with no chronology starts empty', loaded.events.length === 0)
  const heard = []
  const unsubscribe = store.subscribeTimeline(P, (_tl, reason) => heard.push(reason))

  let id
  await store.commitStoryTimeline(P, (tl) => {
    const result = T.addEvent(tl, { title: 'siege', start: 5 }, { nextId: ids })
    id = result.id
    return result.timeline
  }, { label: 'Add event' })
  ok('a commit is written to .story/timeline.json', JSON.parse(files.get('/appdata/Chronicle/.story/timeline.json')).events[0].title === 'siege')

  store.previewStoryTimeline(P, (tl) => T.shiftEvent(tl, id, 10))
  ok('a preview is shown', T.eventById(store.peekStoryTimeline(P), id).start === 15)
  ok('a preview is not saved', JSON.parse(files.get('/appdata/Chronicle/.story/timeline.json')).events[0].start === 5)
  store.previewStoryTimeline(P, (tl) => T.shiftEvent(tl, id, 20))
  ok('previews do not add up', T.eventById(store.peekStoryTimeline(P), id).start === 25)
  store.cancelTimelinePreview(P)
  ok('a cancelled preview goes back', T.eventById(store.peekStoryTimeline(P), id).start === 5)

  // A gesture that also moved something in another file (a map's leg).
  const leg = { departDay: 5 }
  await store.commitStoryTimeline(P, (tl) => T.shiftEvent(tl, id, 3), {
    label: 'Move event',
    effects: [{ undo: async () => { leg.departDay = 5 }, redo: async () => { leg.departDay = 8 } }],
  })
  leg.departDay = 8
  await store.undoStoryTimeline(P)
  ok('one undo puts the event back', T.eventById(store.peekStoryTimeline(P), id).start === 5)
  ok('and the other file with it', leg.departDay === 5)
  await store.redoStoryTimeline(P)
  ok('redo does both again', T.eventById(store.peekStoryTimeline(P), id).start === 8 && leg.departDay === 8)

  await store.commitStoryTimeline(P, (tl) => T.updateEvent(tl, id, { participants: ['Characters/Kira'] }))
  await store.rewriteStoryTimeline(P, (tl) => T.rewriteTimelineDocRefs(tl, 'Characters/Kira', 'Characters/Kira Vale'))
  await store.undoStoryTimeline(P)
  const afterUndo = T.eventById(store.peekStoryTimeline(P), id)
  ok('a rename is not an undo step', afterUndo.participants.length === 0)
  await store.redoStoryTimeline(P)
  ok('and undo history follows the rename', T.eventById(store.peekStoryTimeline(P), id).participants[0] === 'Characters/Kira Vale')
  ok('listeners hear previews and commits', heard.includes('preview') && heard.includes('commit') && heard.includes('undo'))
  unsubscribe()
}

/* ---------------- the cursor ---------------- */

{
  const a = cursor.getStoryCursor('Cursor')
  ok('the cursor is the same object until it changes', a === cursor.getStoryCursor('Cursor'))
  const seen = []
  const off = cursor.subscribeStoryCursor('Cursor', (_next, source) => seen.push(source))
  cursor.setStoryDay('Cursor', 12, 'map:World.map')
  cursor.setTimeLens('Cursor', { on: true, from: 9, to: 3 }, 'lens-bar')
  ok('a change says who made it', seen.join() === 'map:World.map,lens-bar')
  ok('a lens window given backwards is put in order', cursor.getStoryCursor('Cursor').lens.from === 3)
  off()
}

/* ---------------- passages in a real editor ---------------- */

{
  const editor = new Editor({
    element: document.getElementById('root').appendChild(document.createElement('div')),
    extensions: [StarterKit, anchors.TimelineAnchors],
    content: '<p>Before. She hesitated at the door. After.</p>',
  })
  const text = editor.state.doc.textContent
  const start = text.indexOf('She') + 1
  const end = start + 'She hesitated at the door.'.length
  anchors.setTimelineRanges(editor, 'Book/One', [{ id: 'r', eventId: 'e', from: start, to: end, anchor: 'She hesitated at the door.' }])
  ok('a document\'s saved passages load into its editor', anchors.getTimelineAnchors(editor).ranges.length === 1)

  editor.commands.insertContentAt(1, 'Long ago. ')
  const moved = anchors.getTimelineAnchors(editor).ranges[0]
  ok('typing above a passage carries it along', moved.anchor === 'She hesitated at the door.')

  editor.commands.insertContentAt(moved.from, 'Then ')
  const atStart = anchors.getTimelineAnchors(editor).ranges[0]
  ok('text typed at a passage\'s start stays outside it', atStart.anchor === 'She hesitated at the door.')

  editor.commands.setTextSelection({ from: atStart.from, to: atStart.from + 3 })
  const added = anchors.addTimelineRange(editor, 'f')
  ok('the selection can be attached to another event', added && anchors.getTimelineAnchors(editor).ranges.length === 2)

  ok('what is saved is only the document\'s own passages', anchors.readEditorTimelineRanges(editor, 'Book/Two') === undefined
    && anchors.readEditorTimelineRanges(editor, 'Book/One').length === 2)

  anchors.setTimelineContext(editor, { lensIds: new Set(['e']), events: new Map([['e', { title: 'The siege', color: '#c0703f' }]]) })
  const lit = editor.view.dom.querySelectorAll('.timeline-range.is-in-lens').length
  const dim = editor.view.dom.querySelectorAll('.timeline-range.is-dimmed').length
  ok('the lens lights passages of events inside it and fades the rest', lit >= 1 && dim >= 1)
  ok('a passage wears its event\'s name', editor.view.dom.textContent.includes('The siege'))
  anchors.setTimelineContext(editor, { editing: true })
  ok('with editing on, each passage has handles at both ends', editor.view.dom.querySelectorAll('.timeline-range-handle').length === 4)

  const range = anchors.getTimelineAnchors(editor).ranges.find((item) => item.eventId === 'e')
  editor.commands.deleteRange({ from: range.from, to: range.to })
  ok('deleting a passage\'s text drops the passage', !anchors.getTimelineAnchors(editor).ranges.some((item) => item.eventId === 'e'))
  editor.destroy()
}

/* ---------------- passages on disk ---------------- */

{
  const P = 'Novel'
  const ranges = normalizeRanges([{ eventId: 'e', from: 5, to: 9, anchor: 'door' }, { eventId: 'e', from: 3, to: 3 }, { from: 1, to: 2 }])
  ok('empty or eventless ranges are not ranges', ranges.length === 1 && ranges[0].id)
  await saveDocument(P, 'Book/One', { content: { type: 'doc', content: [] }, notes: [], timeline: ranges })
  ok('passages are saved with the text', (await loadDocument(P, 'Book/One')).timeline.length === 1)
  await saveDocument(P, 'Book/One', { content: { type: 'doc', content: [] }, notes: [] })
  ok('a save that does not know of them keeps them', (await loadDocument(P, 'Book/One')).timeline.length === 1)
  await saveDocumentTimeline(P, 'Book/One', [])
  const after = await loadDocument(P, 'Book/One')
  ok('detaching every passage removes them, and only them', after.timeline === undefined && Array.isArray(after.notes))
}
