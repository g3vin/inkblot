/**
 * useTimelinePanel.js — the timeline inspector, built as a form (map/inspector/panelBuilder.js).
 *
 * The same form the map's inspector is: sections of typed fields named by id, drawn
 * by the page (MapPanelView.jsx) under Tauri and natively by the Swift app, every edit
 * coming back by id. With an event selected it edits that event — its dates in the
 * project calendar, lane, tags, who is in it, where, what it links to, and its notes.
 * With nothing selected it is the view and the chronology: what is shown, lanes, eras,
 * tags and the calendar.
 *
 * Edits to the chronology go through `commit(label, edit)` — one undo step each, and
 * seen by every view, document, map and canvas at once.
 */
import { useState } from 'react'
import { getDocDisplayName } from '../lib/docKind'
import { formatDay, normalizeCalendar } from '../lib/map/calendar'
import {
  addEra, addEventNote, addLane, addLink, addTag, eventById, setEventTime, isDated, removeEra, removeEvent, removeEventNote, removeLane, removeLink,
  removeTag, reorderLanes, updateEra, updateEvent, updateEventNote, updateLane, updateTag, sortedEvents, placeOnMap, placeTarget,
} from '../lib/timeline/timelineModel'
import { createPanelBuilder } from '../map/inspector/panelBuilder'
import { calendarShape, dayToParts, partsToDay } from '../map/inspector/travelSections'

const TABS = [
  { id: 'view', label: 'View' },
  { id: 'lanes', label: 'Lanes' },
  { id: 'eras', label: 'Eras' },
  { id: 'tags', label: 'Tags' },
  { id: 'calendar', label: 'Calendar' },
]

const dayField = (ui, id, label, value, calendar, onCommit, options = {}) =>
  ui.date(id, label, dayToParts(calendar, value), calendarShape(calendar), (parts) => onCommit(partsToDay(calendar, parts)), options)

export const describeWhen = (event, calendar) => {
  if (!isDated(event)) return 'Undated'
  const start = formatDay(calendar, event.start)
  return event.end === null ? start : `${start} – ${formatDay(calendar, event.end)}`
}

const PLACE_KIND_NAMES = { region: 'region', route: 'route', label: 'label', body: 'body' }

const LINK_LABELS = { text: 'Passage in', mapLeg: 'Journey on', canvas: 'Card on', note: 'Note in' }

/* ---------------- one event ---------------- */

function eventSections(ui, props, form, setForm) {
  const { timeline, event, calendar, commit, docs, places, journeys = [], onOpenDoc, onOpenLink, onJumpToPassage, onSelect, missing } = props
  const id = event.id
  const patch = (label, fields) => commit(label, (tl) => updateEvent(tl, id, fields))
  const lanes = [{ value: '', label: 'No lane' }, ...timeline.lanes.map((lane) => ({ value: lane.id, label: lane.name }))]
  const characters = docs.docs.filter((doc) => doc.isCharacter && !event.participants.includes(doc.path))
  const others = docs.docs.filter((doc) => doc.kind === 'text' && !doc.isCharacter && !event.participants.includes(doc.path))
  const target = placeTarget(event.place)
  const placeKey = target ? `item|${target.map}|${target.kind}|${target.id}` : event.place?.doc ? `doc|${event.place.doc}` : ''
  const placeOptions = [
    { value: '', label: 'Nowhere in particular' },
    ...places.map((place) => ({ value: `item|${place.map}|${place.kind}|${place.id}`, label: place.kind === 'pin' ? place.name : `${place.name} (${PLACE_KIND_NAMES[place.kind]})`, group: `On ${place.mapName}` })),
    ...docs.docs.filter((doc) => doc.isLocation).map((doc) => ({ value: `doc|${doc.path}`, label: doc.name, group: 'Locations' })),
  ]
  const setPlace = (value) => {
    const [kind, a, b, c] = value.split('|')
    patch('Set place', { place: kind === 'item' ? placeOnMap(a, b, c) : kind === 'doc' ? { doc: a } : null })
  }
  const sequence = sortedEvents(timeline)
  const position = sequence.findIndex((item) => item.id === id)

  return [
    ui.section('event', '', [
      ui.text('event.title', 'Title', event.title, (title) => patch('Rename event', { title }), { placeholder: 'What happens', focusKey: form.focusTitle }),
      ui.text('event.summary', 'Summary', event.summary, (summary) => patch('Edit summary', { summary }), { multiline: true, placeholder: 'A line or two' }),
      ui.choice('event.lane', 'Lane', event.laneId || '', lanes, (laneId) => patch('Move to lane', { laneId: laneId || null })),
      ui.color('event.color', 'Colour', event.color, timeline.lanes.find((lane) => lane.id === event.laneId)?.color || 'blue', (color) => patch('Colour event', { color })),
      ui.stat('In sequence', `${position + 1} of ${sequence.length}`),
    ]),

    ui.section('when', 'When', [
      ui.toggle('when.dated', 'Has a date', isDated(event), (on) => {
        if (!on) return patch('Remove date', { start: null, end: null })
        return patch('Date event', { start: props.suggestDay(event.id), end: null })
      }),
      isDated(event) ? dayField(ui, 'when.start', event.end === null ? 'On' : 'From', event.start, calendar, (start) => {
        if (start === null) return
        const length = event.end === null ? null : event.end - event.start
        patch('Change date', { start, end: length === null ? null : start + length })
      }) : ui.note('Undated events keep their place in the sequence. Drag one to reorder it; hold ⌥ while dropping to give it a date.'),
      isDated(event) ? ui.toggle('when.window', 'Lasts a while', event.end !== null, (on) => patch(on ? 'Make a window' : 'Make a moment', { end: on ? event.start + 1 : null })) : null,
      isDated(event) && event.end !== null ? dayField(ui, 'when.end', 'Until', event.end, calendar, (end) => end !== null && patch('Change end', { end })) : null,
      isDated(event) ? ui.stat('Reads', describeWhen(event, calendar)) : null,
    ]),

    ui.section('who', 'Who', [
      ...event.participants.map((path) =>
        ui.listRow(`who.${path}`, getDocDisplayName(path), () => onOpenDoc(path), {
          subtitle: missing(path) ? 'Missing — renamed or deleted?' : undefined,
        })
      ),
      ui.choice('who.add', 'Add', '', [
        { value: '', label: 'Choose…' },
        ...characters.map((doc) => ({ value: doc.path, label: doc.name, group: 'Characters' })),
        ...others.map((doc) => ({ value: doc.path, label: doc.name, group: 'Other documents' })),
      ], (path) => path && patch('Add participant', { participants: [...event.participants, path] })),
      event.participants.length
        ? ui.choice('who.remove', 'Remove', '', [{ value: '', label: 'Choose…' }, ...event.participants.map((path) => ({ value: path, label: getDocDisplayName(path) }))],
          (path) => path && patch('Remove participant', { participants: event.participants.filter((item) => item !== path) }))
        : null,
    ]),

    ui.section('where', 'Where', [
      ui.choice('where.place', 'Place', placeKey, placeOptions, setPlace),
      target ? ui.buttonField('where.show', 'Show on map', () => onOpenLink({ kind: 'pin', map: target.map, pin: target.id })) : null,
    ]),

    ui.section('links', 'Linked', [
      !event.links.length ? ui.note('Select text in a document and choose “Attach to timeline event” to link a passage. Canvas cards and notes can be attached from their own menus.') : null,
      journeys.some((journey) => journey.intervals.some((interval) => interval.kind === 'travel'))
        ? ui.choice('links.leg', 'Leaves with', '', [
          { value: '', label: 'Choose a journey leg…' },
          ...journeys.flatMap((journey) => journey.intervals
            .filter((interval) => interval.kind === 'travel')
            .map((interval) => ({
              value: `${journey.mapPath}|${journey.travelerId}|${interval.legId}|${interval.from}`,
              label: `${interval.label} (${formatDay(calendar, interval.from)})`,
              group: `${journey.name} · ${journey.mapName}`,
            }))),
        ], (value) => {
          if (!value) return
          const [map, traveler, leg, depart] = value.split('|')
          const start = Number(depart)
          // Linked, the event takes the leg's departure; from then on they move together.
          commit('Link journey leg', (tl) => {
            const linked = addLink(tl, id, { kind: 'mapLeg', map, traveler, leg })
            const current = eventById(linked, id)
            return setEventTime(linked, id, start, current.end === null ? null : start + (current.end - (current.start ?? start)))
          })
        })
        : null,
      ...event.links.map((link, index) =>
        ui.group(`links.${index}`, `${LINK_LABELS[link.kind]} ${getDocDisplayName(link.doc || link.map || link.path)}`, [
          ui.buttons([
            ui.button(`links.${index}.open`, link.kind === 'text' ? 'Go to passage' : 'Open', () => (link.kind === 'text' ? onJumpToPassage(id, link.doc) : onOpenLink(link))),
            ui.button(`links.${index}.remove`, 'Unlink', () => commit('Unlink', (tl) => removeLink(tl, id, link)), { role: 'destructive' }),
          ]),
        ])
      ),
    ]),

    ui.section('notes', 'Notes', [
      !event.notes.length ? ui.note('Notes on this event, or on one moment in it.') : null,
      ...event.notes.map((note, index) =>
        ui.group(`notes.${note.id}`, `Note ${index + 1}${note.at !== null ? ` · ${formatDay(calendar, note.at, { withTime: true })}` : ''}`, [
          ui.text(`notes.${note.id}.text`, 'Note', note.text, (text) => commit('Edit note', (tl) => updateEventNote(tl, id, note.id, { text })), { multiline: true }),
          isDated(event)
            ? dayField(ui, `notes.${note.id}.at`, 'At', note.at, calendar, (at) => commit('Move note', (tl) => updateEventNote(tl, id, note.id, { at })), { allowEmpty: true, placeholder: 'The whole event' })
            : null,
          ui.buttonField(`notes.${note.id}.remove`, 'Delete note', () => commit('Delete note', (tl) => removeEventNote(tl, id, note.id)), { role: 'destructive' }),
        ])
      ),
    ], [ui.button('notes.add', 'Add', () => commit('Add note', (tl) => addEventNote(tl, id, { text: '' }).timeline))]),

    ui.section('delete', '', [
      ui.buttons([
        ui.button('event.back', 'Done', () => onSelect(null)),
        ui.button('event.delete', 'Delete event', () => {
          setForm({ ...form })
          onSelect(null)
          commit('Delete event', (tl) => removeEvent(tl, id))
        }, { role: 'destructive' }),
      ]),
    ]),
  ]
}

/* ---------------- the view and the chronology ---------------- */

function viewSections(ui, { timeline, view, patchView, docs, calendar }) {
  const toggleIn = (key, value) => (on) => {
    const list = view.filter[key]
    patchView({ filter: { ...view.filter, [key]: on ? [...list, value] : list.filter((item) => item !== value) } })
  }
  const dated = timeline.events.filter(isDated)
  const spanned = dated.length
    ? `${formatDay(calendar, Math.min(...dated.map((event) => event.start)))} – ${formatDay(calendar, Math.max(...dated.map((event) => event.end ?? event.start)))}`
    : '—'
  const characters = docs.docs.filter((doc) => doc.isCharacter)
  const folders = [...new Set(docs.docs.map((doc) => doc.path.split('/').slice(0, -1).join('/')).filter(Boolean))].sort()
  return [
    ui.section('view', 'Show', [
      ui.choice('view.scale', 'Show as', view.scale, [
        { value: 'time', label: 'Chronology, by date' },
        { value: 'sequence', label: 'Chronology, in order' },
        { value: 'manuscript', label: 'Manuscript order' },
      ], (scale) => patchView({ scale })),
      view.scale === 'manuscript'
        ? ui.note('Passages in the order a reader meets them, each joined to when it happens. Lines that run backwards are flashbacks.')
        : null,
      view.scale === 'manuscript'
        ? ui.choice('view.manuscript', 'Manuscript', view.manuscriptFolder, [
          { value: '', label: 'The whole project' },
          ...folders.map((folder) => ({ value: folder, label: folder })),
        ], (manuscriptFolder) => patchView({ manuscriptFolder }))
        : null,
      view.scale === 'time' ? ui.toggle('view.journeys', 'Map journeys', view.showJourneys, (showJourneys) => patchView({ showJourneys })) : null,
      ui.text('view.search', 'Find', view.filter.text, (text) => patchView({ filter: { ...view.filter, text } }), { placeholder: 'Titles, summaries, notes' }),
    ]),
    ui.section('stats', 'Chronology', [
      ui.stat('Events', String(timeline.events.length)),
      ui.stat('Dated', `${dated.length} of ${timeline.events.length}`),
      ui.stat('Spans', spanned),
    ]),
    timeline.lanes.length ? ui.section('filter.lanes', 'Only these lanes', [
      ...timeline.lanes.map((lane) => ui.toggle(`filter.lane.${lane.id}`, lane.name, view.filter.lanes.includes(lane.id), toggleIn('lanes', lane.id))),
    ]) : null,
    timeline.tags.length ? ui.section('filter.tags', 'Only these tags', [
      ...timeline.tags.map((tag) => ui.toggle(`filter.tag.${tag.id}`, tag.name, view.filter.tags.includes(tag.id), toggleIn('tags', tag.id))),
    ]) : null,
    characters.length ? ui.section('filter.who', 'Only events with', [
      ...characters.map((doc) => ui.toggle(`filter.who.${doc.path}`, doc.name, view.filter.participants.includes(doc.path), toggleIn('participants', doc.path))),
    ]) : null,
    view.filter.lanes.length || view.filter.tags.length || view.filter.participants.length || view.filter.text
      ? ui.section('filter.clear', '', [ui.buttonField('filter.clear', 'Show everything', () => patchView({ filter: { lanes: [], tags: [], participants: [], text: '' } }))])
      : null,
  ].filter(Boolean)
}

function laneSections(ui, { timeline, commit }) {
  const ids = timeline.lanes.map((lane) => lane.id)
  const move = (index, by) => {
    const next = [...ids]
    const [id] = next.splice(index, 1)
    next.splice(index + by, 0, id)
    commit('Reorder lanes', (tl) => reorderLanes(tl, next))
  }
  return [
    ui.section('lanes', 'Lanes', [
      !timeline.lanes.length ? ui.note('Lanes keep plotlines or points of view apart. Events with no lane sit together.') : null,
      ...timeline.lanes.map((lane, index) =>
        ui.group(`lanes.${lane.id}`, lane.name, [
          ui.text(`lanes.${lane.id}.name`, 'Name', lane.name, (name) => commit('Rename lane', (tl) => updateLane(tl, lane.id, { name }))),
          ui.color(`lanes.${lane.id}.color`, 'Colour', lane.color, 'blue', (color) => commit('Colour lane', (tl) => updateLane(tl, lane.id, { color }))),
          ui.stat('Events', String(timeline.events.filter((event) => event.laneId === lane.id).length)),
          ui.buttons([
            ui.button(`lanes.${lane.id}.up`, 'Up', () => move(index, -1), { disabled: index === 0 }),
            ui.button(`lanes.${lane.id}.down`, 'Down', () => move(index, 1), { disabled: index === timeline.lanes.length - 1 }),
            ui.button(`lanes.${lane.id}.delete`, 'Delete', () => commit('Delete lane', (tl) => removeLane(tl, lane.id)), { role: 'destructive', help: 'Its events stay, in no lane' }),
          ]),
        ], { swatch: lane.color || undefined, collapsible: true })
      ),
    ], [ui.button('lanes.add', 'Add', () => commit('Add lane', (tl) => addLane(tl, `Lane ${tl.lanes.length + 1}`).timeline))]),
  ]
}

function eraSections(ui, { timeline, commit, calendar, suggestDay }) {
  return [
    ui.section('eras', 'Eras', [
      !timeline.eras.length ? ui.note('Eras are spans drawn behind everything: a war, a reign, a winter.') : null,
      ...timeline.eras.map((era) =>
        ui.group(`eras.${era.id}`, era.name, [
          ui.text(`eras.${era.id}.name`, 'Name', era.name, (name) => commit('Rename era', (tl) => updateEra(tl, era.id, { name }))),
          dayField(ui, `eras.${era.id}.start`, 'From', era.start, calendar, (start) => start !== null && commit('Change era', (tl) => updateEra(tl, era.id, { start }))),
          dayField(ui, `eras.${era.id}.end`, 'Until', era.end, calendar, (end) => end !== null && commit('Change era', (tl) => updateEra(tl, era.id, { end }))),
          ui.color(`eras.${era.id}.color`, 'Colour', era.color, 'amber', (color) => commit('Colour era', (tl) => updateEra(tl, era.id, { color }))),
          ui.buttonField(`eras.${era.id}.delete`, 'Delete era', () => commit('Delete era', (tl) => removeEra(tl, era.id)), { role: 'destructive' }),
        ], { swatch: era.color || undefined, collapsible: true })
      ),
    ], [ui.button('eras.add', 'Add', () => {
      const start = suggestDay(null)
      commit('Add era', (tl) => addEra(tl, { name: 'New era', start, end: start + 30 }).timeline)
    })]),
  ]
}

function tagSections(ui, { timeline, commit }, form, setForm) {
  return [
    ui.section('tags', 'Tags', [
      !timeline.tags.length ? ui.note('Tags cut across lanes — “clue”, “red herring”, “flashback”. Filter a view by them.') : null,
      ...timeline.tags.map((tag) =>
        ui.group(`tags.${tag.id}`, tag.name, [
          ui.text(`tags.${tag.id}.name`, 'Name', tag.name, (name) => name.trim() && commit('Rename tag', (tl) => updateTag(tl, tag.id, { name: name.trim() }))),
          ui.color(`tags.${tag.id}.color`, 'Colour', tag.color, 'slate', (color) => commit('Colour tag', (tl) => updateTag(tl, tag.id, { color }))),
          ui.stat('Events', String(timeline.events.filter((event) => event.tagIds.includes(tag.id)).length)),
          ui.buttonField(`tags.${tag.id}.delete`, 'Delete tag', () => commit('Delete tag', (tl) => removeTag(tl, tag.id)), { role: 'destructive' }),
        ], { swatch: tag.color || undefined, collapsible: true })
      ),
      ui.text('tags.new', 'New tag', form.newTag, (newTag) => setForm({ ...form, newTag }), { placeholder: 'Name' }),
      ui.buttonField('tags.add', 'Add tag', () => {
        commit('Add tag', (tl) => addTag(tl, form.newTag).timeline)
        setForm({ ...form, newTag: '' })
      }, { disabled: !form.newTag.trim() }),
    ]),
  ]
}

function eventTagSection(ui, { timeline, event, commit }, form, setForm) {
  const toggle = (tagId) => (on) =>
    commit(on ? 'Tag event' : 'Untag event', (tl) => updateEvent(tl, event.id, { tagIds: on ? [...event.tagIds, tagId] : event.tagIds.filter((id) => id !== tagId) }))
  const addNew = () => {
    commit('Tag event', (tl) => {
      const { timeline: next, id } = addTag(tl, form.newTag)
      return id ? updateEvent(next, event.id, { tagIds: [...eventById(next, event.id).tagIds, id] }) : next
    })
    setForm({ ...form, newTag: '' })
  }
  return ui.section('event.tags', 'Tags', [
    ...timeline.tags.map((tag) => ui.toggle(`event.tag.${tag.id}`, tag.name, event.tagIds.includes(tag.id), toggle(tag.id))),
    ui.text('event.tags.new', 'New tag', form.newTag, (newTag) => setForm({ ...form, newTag }), { placeholder: 'Name' }),
    ui.buttonField('event.tags.add', 'Add tag', addNew, { disabled: !form.newTag.trim() }),
  ])
}

/**
 * `{ panel, handlers }` for the inspector. `props`: `timeline`, `view`, `patchView`,
 * `selection` (an event id or null), `onSelect`, `commit(label, edit)`, `calendar`,
 * `onOpenCalendar`, `docs` (useProjectDocs), `places`, `suggestDay(eventId)`,
 * `journeys`, `onOpenDoc(path)`, `onOpenLink(link)`, `onJumpToPassage(eventId, doc)`, `title`.
 */
export function useTimelinePanel(props) {
  const [tab, setTab] = useState('view')
  const [form, setForm] = useState({ newTag: '', focusTitle: 0 })
  const ui = createPanelBuilder()
  const calendar = normalizeCalendar(props.calendar)
  const missing = (path) => props.docs.loaded && !props.docs.paths.has(path)
  const event = props.selection && props.timeline ? eventById(props.timeline, props.selection) : null

  if (!props.timeline) {
    return { panel: { title: props.title, canGoBack: false, problems: 0, tabs: [], sections: [ui.section('loading', '', [ui.note('Loading the chronology…')])] }, handlers: ui.handlers }
  }

  let sections
  let tabs = TABS
  let title = props.title
  if (event) {
    tabs = []
    title = event.title || 'Event'
    const eventProps = { ...props, event, calendar, missing }
    sections = eventSections(ui, eventProps, form, setForm)
    sections.splice(2, 0, eventTagSection(ui, eventProps, form, setForm))
  } else {
    const common = { ...props, calendar }
    switch (tab) {
      case 'lanes': sections = laneSections(ui, common); break
      case 'eras': sections = eraSections(ui, common); break
      case 'tags': sections = tagSections(ui, common, form, setForm); break
      case 'calendar':
        sections = [ui.section('calendar', 'Calendar', [
          ui.note(`Shared by every timeline and map in this project. Day 1 of the story is ${formatDay(calendar, 0)}.`),
          ui.buttonField('calendar.open', 'Story calendar…', props.onOpenCalendar, { icon: 'calendar' }),
        ])]
        break
      default: sections = viewSections(ui, common)
    }
  }

  // The tab bar and the back button, as the map's panel names them.
  ui.handlers.set('@tab', (next) => setTab(String(next)))
  ui.handlers.set('@back', () => props.onSelect(null))
  return {
    panel: { title, canGoBack: Boolean(event), problems: 0, tabs, tab: event ? undefined : tab, sections },
    handlers: ui.handlers,
    focusTitle: () => setForm((current) => ({ ...current, focusTitle: current.focusTitle + 1 })),
  }
}
