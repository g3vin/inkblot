/**
 * travelSections.js — journeys and how they are made: a traveller's itinerary, the
 * story calendar, the conflicts the timeline found, the ways of travelling, the
 * terrains, and the table of distances between places.
 */
import { getDocDisplayName } from '../../lib/docKind'
import { formatDay, fromParts, normalizeCalendar, toParts } from '../../lib/map/calendar'
import { formatDistance, formatDuration, LIGHT_KMH } from '../../lib/map/mapUnits'
import { distanceMatrix } from '../../lib/map/travel'
import { mapTransports, BUILTIN_TRANSPORTS, lorentzGamma } from '../../lib/map/transports'
import { newId, pinLabel } from '../../lib/map/mapModel'
import { travelerColor, travelerName } from '../mapRender'
import { describeConflict, unitFor } from '../mapOptions'
import { docChoices } from './itemSections'
import { MAP_DEFAULT_COLORS } from '../../lib/map/mapColors'

const GREGORIAN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/* ---------------- dates, taken apart for a date field ---------------- */

/** What a date field needs to know about the calendar: its mode and its months. */
export function calendarShape(calendar) {
  const cal = normalizeCalendar(calendar)
  const months = cal.mode === 'gregorian' ? GREGORIAN_MONTHS : cal.mode === 'custom' ? cal.custom.months.map((month) => month.name) : []
  return { mode: cal.mode, months }
}

/** A day number as `MapDateParts`, or null. Story days have no year or month: 0. */
export function dayToParts(calendar, day) {
  if (day === null || day === undefined) return null
  const parts = toParts(normalizeCalendar(calendar), day)
  return { year: parts.year ?? 0, month: parts.month ?? 1, day: parts.day, hour: parts.hour, minute: parts.minute }
}

/** `MapDateParts` back to a day number; null stays null. */
export function partsToDay(calendar, parts) {
  if (!parts) return null
  const clean = {
    year: Number(parts.year) || 0,
    month: Math.max(1, Math.round(Number(parts.month) || 1)),
    day: Math.round(Number(parts.day) || 1),
    hour: Math.max(0, Math.min(23, Math.round(Number(parts.hour) || 0))),
    minute: Math.max(0, Math.min(59, Math.round(Number(parts.minute) || 0))),
  }
  return fromParts(normalizeCalendar(calendar), clean)
}

/** A date field over a day number. */
const dayField = (ui, id, label, value, calendar, onCommit, options = {}) =>
  ui.date(id, label, dayToParts(calendar, value), calendarShape(calendar), (parts) => onCommit(partsToDay(calendar, parts)), options)

/* ---------------- one traveller ---------------- */

export function travelerSections(ui, { map, traveler, index, schedule, conflicts, docs, calendar, patch, onDelete, onDay, onOpenDoc, renameRequest }) {
  const pinOptions = map.pins.map((pin) => ({ value: pin.id, label: pinLabel(pin, getDocDisplayName) }))
  const transports = mapTransports(map)
  const setLegs = (legs) => patch({ legs })
  const patchLeg = (legId, next) => setLegs(traveler.legs.map((leg) => (leg.id === legId ? { ...leg, ...next } : leg)))
  const addLeg = () => {
    const last = traveler.legs[traveler.legs.length - 1]
    const from = last?.to || traveler.startPin || map.pins[0]?.id || null
    const to = map.pins.find((pin) => pin.id !== from)?.id || null
    setLegs([...traveler.legs, { id: newId(), route: null, from, to, transport: last?.transport || (map.mapKind === 'system' ? 'light10' : 'walk'), departDay: null, restDays: 0 }])
  }
  const own = conflicts.filter((conflict) => conflict.travelerId === traveler.id || conflict.travelers?.includes(traveler.id))

  const legGroup = (leg, legIndex) => {
    const interval = schedule?.intervals.find((candidate) => candidate.kind === 'travel' && candidate.legId === leg.id)
    const transport = transports.find((candidate) => candidate.id === leg.transport)
    // Routes that stop at both ends first; any route can be followed, though.
    const connects = (route) => {
      const stops = route.nodes.map((node) => node.pin)
      return Boolean(leg.from && leg.to && stops.includes(leg.from) && stops.includes(leg.to))
    }
    const routes = [...map.routes.filter(connects), ...map.routes.filter((route) => !connects(route))]
    const prefix = `leg.${leg.id}`
    return ui.group(prefix, `Leg ${legIndex + 1}`, [
      ui.choice(`${prefix}.from`, 'From', leg.from || '', [{ value: '', label: '—' }, ...pinOptions], (from) => patchLeg(leg.id, { from: from || null })),
      ui.choice(`${prefix}.to`, 'To', leg.to || '', [{ value: '', label: '—' }, ...pinOptions], (to) => patchLeg(leg.id, { to: to || null })),
      ui.choice(
        `${prefix}.route`,
        'By way of',
        leg.route || '',
        [
          { value: '', label: map.mapKind === 'earth' ? 'The shortest way (great circle)' : map.mapKind === 'system' ? 'Direct (intercept)' : 'A straight line' },
          ...routes.map((route) => ({ value: route.id, label: `${route.name || 'Unnamed route'}${connects(route) ? '' : ' (not between these)'}` })),
        ],
        (route) => patchLeg(leg.id, { route: route || null })
      ),
      ui.choice(
        `${prefix}.transport`,
        'Travelling by',
        leg.transport,
        [
          ...map.transports.map((option) => ({ value: option.id, label: option.name, group: 'This map’s' })),
          ...BUILTIN_TRANSPORTS.filter((option) => !map.transports.some((mine) => mine.id === option.id)).map((option) => ({ value: option.id, label: option.name, group: 'Standard' })),
        ],
        (next) => patchLeg(leg.id, { transport: next })
      ),
      dayField(ui, `${prefix}.depart`, 'Leaves', leg.departDay, calendar, (departDay) => patchLeg(leg.id, { departDay }), {
        allowEmpty: true,
        placeholder: 'When the last leg arrives',
      }),
      leg.departDay === null
        ? ui.number(`${prefix}.rest`, 'Rests first', leg.restDays, (restDays) => patchLeg(leg.id, { restDays }), { min: 0, step: 0.25, suffix: 'days' })
        : null,
      ...(interval
        ? [
            ui.stat('Distance', formatDistance(interval.profile.km, unitFor(map), map)),
            ui.stat('Takes', interval.profile.impassable ? 'impassable ground' : formatDuration(interval.to - interval.from)),
            transport?.fractionC ? ui.stat('Aboard, only', `${formatDuration(interval.properDays)} (γ ${lorentzGamma(transport.fractionC).toFixed(3)})`) : null,
            interval.approximate ? ui.note('The target moves faster than this can close on it — the time is for the distance at departure.') : null,
            ui.stat('Arrives', formatDay(calendar, interval.to, { withTime: true }), ui.button(`${prefix}.arrives`, formatDay(calendar, interval.to, { withTime: true }), () => onDay(interval.to))),
          ]
        : []),
    ], {
      actions: [
        ui.button(`${prefix}.earlier`, '↑', () => {
          const legs = [...traveler.legs]
          legs.splice(legIndex - 1, 0, legs.splice(legIndex, 1)[0])
          setLegs(legs)
        }, { disabled: legIndex === 0, icon: 'arrow-up', help: 'Move earlier' }),
        ui.button(`${prefix}.remove`, '×', () => setLegs(traveler.legs.filter((candidate) => candidate.id !== leg.id)), {
          role: 'destructive',
          icon: 'close',
          help: 'Remove this leg',
        }),
      ],
    })
  }

  return [
    ui.section('traveler', 'Traveller', [
      ui.choice('traveler.doc', 'Character', traveler.doc || '', docChoices(docs.docs, traveler.doc, (doc) => doc.isCharacter, 'Characters', 'None'), (doc) => patch({ doc: doc || null })),
      ui.text('traveler.name', 'Name', traveler.name || '', (name) => patch({ name: name.trim() || null }), {
        placeholder: traveler.doc ? getDocDisplayName(traveler.doc) : 'Traveller',
        focusKey: renameRequest,
      }),
      ui.color('traveler.color', 'Colour', traveler.color, travelerColor(traveler, index), (color) => patch({ color })),
      traveler.doc ? ui.buttonField('traveler.open', `Open “${getDocDisplayName(traveler.doc)}”`, () => onOpenDoc?.(traveler.doc)) : null,
    ]),
    ui.section('starts', 'Starts', [
      ui.choice('traveler.startPin', 'At', traveler.startPin || '', [{ value: '', label: 'Choose a place' }, ...pinOptions], (startPin) => patch({ startPin: startPin || null })),
      dayField(ui, 'traveler.startDay', 'On', traveler.startDay, calendar, (startDay) => patch({ startDay: startDay ?? 0 })),
    ]),
    own.length
      ? ui.section('traveler.problems', 'Problems', own.map((conflict, conflictIndex) =>
          ui.warning(describeConflict(conflict, map, calendar), {
            action: Number.isFinite(conflict.from) ? ui.button(`traveler.problem.${conflictIndex}`, 'Go there', () => onDay(conflict.from)) : undefined,
          })
        ))
      : null,
    ui.section('journey', 'Journey', [
      map.pins.length < 2 ? ui.note('Place at least two places on the map to travel between.') : null,
      ...traveler.legs.map(legGroup),
    ], [ui.button('journey.addLeg', 'Add leg', addLeg, { disabled: map.pins.length < 2 })]),
    ui.section('traveler.delete', '', [ui.buttonField('traveler.delete', 'Delete traveller', onDelete, { role: 'destructive' })]),
  ].filter(Boolean)
}

/* ---------------- journeys: every traveller, the calendar, conflicts ---------------- */

export function journeysSections(ui, { map, schedules, conflicts, calendar, onCalendar, onSelect, onDay, docs, addTraveler, onCheckAllMaps, crossConflicts, editingCalendar, setEditingCalendar }) {
  const cal = normalizeCalendar(calendar)
  const problems = [...conflicts, ...(crossConflicts || [])]
  return [
    ui.section('travelers', 'Travellers', [
      !map.travelers.length ? ui.note('Drag a character’s document from the file tree onto the map to send them travelling — or add one here.') : null,
      ...map.travelers.map((traveler, index) => {
        const schedule = schedules.find((candidate) => candidate.travelerId === traveler.id)
        const legs = `${traveler.legs.length} leg${traveler.legs.length === 1 ? '' : 's'}`
        return ui.listRow(`travelers.${traveler.id}`, travelerName(traveler), () => onSelect('traveler', traveler.id), {
          subtitle: schedule && traveler.legs.length ? `${legs} · ${formatDay(cal, schedule.start)} → ${formatDay(cal, schedule.end)}` : legs,
          swatch: travelerColor(traveler, index),
        })
      }),
      !docs.docs.some((doc) => doc.isCharacter) ? ui.note('Documents in a Characters folder are offered as travellers.') : null,
    ], [ui.button('travelers.add', 'Add', addTraveler, { disabled: !map.pins.length })]),

    ui.section('problems', 'Problems', [
      !problems.length ? ui.note('No one is in two places at once.') : null,
      ...problems.map((conflict, index) => {
        const where = conflict.maps && conflict.maps[0] !== conflict.maps[1] ? ` (on ${conflict.maps.map((path) => getDocDisplayName(path)).join(' and ')})` : ''
        return ui.warning(`${describeConflict(conflict, map, cal)}${where}`, {
          action: Number.isFinite(conflict.from) ? ui.button(`problems.${index}`, 'Go there', () => onDay(conflict.from)) : undefined,
        })
      }),
    ], [ui.button('problems.checkAll', 'Check all maps', onCheckAllMaps, { help: 'Check this project’s other maps too' })]),

    ui.section('calendar', 'Calendar', [
      ui.note(`Shared by every map in this project. Day 1 of the story is ${formatDay(cal, 0)}.`),
      ...(editingCalendar ? calendarFields(ui, cal, onCalendar) : []),
    ], [ui.button('calendar.edit', editingCalendar ? 'Done' : 'Edit', () => setEditingCalendar(!editingCalendar))]),
  ]
}

export function calendarFields(ui, cal, onCalendar) {
  const custom = (patch) => onCalendar({ ...cal, custom: { ...cal.custom, ...patch } })
  return [
    ui.choice(
      'calendar.mode',
      'Dates as',
      cal.mode,
      [{ value: 'day', label: 'Story days (Day 1, Day 2…)' }, { value: 'gregorian', label: 'Real dates' }, { value: 'custom', label: 'My world’s calendar' }],
      (mode) => onCalendar({ ...cal, mode })
    ),
    cal.mode === 'gregorian'
      ? ui.text('calendar.epoch', 'Story begins', cal.gregorianEpoch, (gregorianEpoch) => onCalendar({ ...cal, gregorianEpoch }), { placeholder: '1850-03-01' })
      : null,
    ...(cal.mode === 'custom'
      ? [
          ui.text(
            'calendar.months',
            'Months',
            cal.custom.months.map((month) => `${month.name}:${month.days}`).join(', '),
            (text) => custom({
              months: text.split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
                const [name, days] = entry.split(':')
                return { name: name.trim(), days: Math.max(1, Math.round(Number(days) || 30)) }
              }),
            }),
            { multiline: true }
          ),
          ui.text('calendar.weekdays', 'Weekdays', cal.custom.weekdays.join(', '), (text) => custom({ weekdays: text.split(',').map((name) => name.trim()).filter(Boolean) }), {
            placeholder: 'optional, comma separated',
          }),
          ui.number('calendar.yearZero', 'First year', cal.custom.yearZero, (yearZero) => custom({ yearZero: Math.round(yearZero) }), { step: 1 }),
          ui.text('calendar.era', 'Era', cal.custom.era, (era) => custom({ era }), { placeholder: 'e.g. AR' }),
          ui.toggle('calendar.leap', 'Leap years', Boolean(cal.custom.leap), (on) => custom({ leap: on ? { every: 4, days: 1, month: 1 } : null })),
          cal.custom.leap
            ? ui.number('calendar.leapEvery', 'Every', cal.custom.leap.every, (every) => custom({ leap: { ...cal.custom.leap, every: Math.round(every) } }), {
                min: 1,
                step: 1,
                suffix: 'years, +1 day',
              })
            : null,
        ]
      : []),
  ]
}

/* ---------------- travel: transports, terrains, the distance table ---------------- */

const TERRAIN_KEYS = [['*land', 'On foot or wheels'], ['*water', 'Boats'], ['*air', 'Flying'], ['walk', 'Walking'], ['horse', 'Horses'], ['cart', 'Carts'], ['car', 'Cars']]

export function travelSections(ui, { map, space, day, dispatch, matrix: matrixState, setMatrix }) {
  const { show, transport: matrixTransport } = matrixState
  const pins = map.pins.slice(0, 14)
  const setTransports = (transports) => dispatch({ type: 'map/patch', patch: { transports } })
  const patchTransport = (id, patch) => setTransports(map.transports.map((transport) => (transport.id === id ? { ...transport, ...patch } : transport)))
  const setTerrains = (terrains) => dispatch({ type: 'map/patch', patch: { terrains } })
  const patchTerrain = (id, patch) => setTerrains(map.terrains.map((terrain) => (terrain.id === id ? { ...terrain, ...patch } : terrain)))

  let distances
  if (!show) distances = [ui.note('How far every place is from every other, and how long it takes.')]
  else if (pins.length < 2) distances = [ui.note('Place two or more places to compare.')]
  else {
    const matrix = distanceMatrix(map, space, pins.map((pin) => pin.id), matrixTransport, day)
    const names = pins.map((pin) => pinLabel(pin, getDocDisplayName))
    distances = [
      ui.choice('distances.transport', 'Travelling by', matrixTransport, mapTransports(map).map((transport) => ({ value: transport.id, label: transport.name })), (next) => setMatrix({ ...matrixState, transport: next })),
      ui.table(
        names.map((name) => name.slice(0, 10)),
        pins.map((pin, row) => ({
          label: names[row],
          cells: matrix[row].map((cell, column) =>
            row === column
              ? { text: '—', strong: false }
              : { text: formatDistance(cell.km, unitFor(map), map), detail: cell.impassable ? 'impassable' : formatDuration(cell.days), strong: Boolean(cell.viaRoute) }
          ),
        }))
      ),
      ui.note('Bold figures follow a route; the rest are as the crow flies.'),
    ]
  }

  const sections = [
    ui.section('distances', 'Distances', distances, [ui.button('distances.toggle', show ? 'Hide' : 'Show', () => setMatrix({ ...matrixState, show: !show }))]),
    ui.section('transports', 'Ways of travelling', [
      ...map.transports.map((transport) => {
        const prefix = `transport.${transport.id}`
        return ui.group(prefix, transport.name, [
          ui.text(`${prefix}.name`, 'Name', transport.name, (name) => patchTransport(transport.id, { name })),
          ui.choice(`${prefix}.medium`, 'Moves on', transport.medium, [{ value: 'land', label: 'Land' }, { value: 'water', label: 'Water' }, { value: 'air', label: 'Air' }, { value: 'space', label: 'Space' }], (medium) => patchTransport(transport.id, { medium })),
          transport.medium === 'space'
            ? ui.number(`${prefix}.fractionC`, 'Speed', transport.fractionC ? Math.round(transport.fractionC * 1e5) / 1e3 : null, (percent) => patchTransport(transport.id, { fractionC: percent ? percent / 100 : null, kmh: percent ? 0 : transport.kmh || 40000 }), {
                min: 0.0001,
                max: 99.9999,
                suffix: '% of c',
                allowEmpty: true,
              })
            : null,
          !transport.fractionC
            ? ui.number(`${prefix}.kmh`, 'Speed', transport.kmh, (kmh) => patchTransport(transport.id, { kmh }), { min: 0.01, suffix: 'km/h' })
            : ui.stat('That is', `${Math.round(transport.fractionC * LIGHT_KMH).toLocaleString('en-US')} km/h`),
          ui.number(`${prefix}.hours`, 'Moving for', transport.hoursPerDay, (hoursPerDay) => patchTransport(transport.id, { hoursPerDay }), { min: 0.5, max: 24, step: 0.5, suffix: 'hours a day' }),
          ui.buttonField(`${prefix}.remove`, 'Remove', () => setTransports(map.transports.filter((candidate) => candidate.id !== transport.id)), { role: 'destructive' }),
        ])
      }),
      ui.note(`Standard ways — walking ${BUILTIN_TRANSPORTS[0].kmh} km/h for ${BUILTIN_TRANSPORTS[0].hoursPerDay} h a day, horseback, carts, ships, trains, cars, aircraft, rockets and fractions of light speed — are always available. Give one of yours the same name to change it on this map.`),
    ], [
      ui.button('transports.add', 'Add', () => setTransports([...map.transports, {
        id: newId(),
        name: map.mapKind === 'system' ? 'Torch ship' : 'Wyvern',
        kmh: map.mapKind === 'system' ? 0 : 60,
        hoursPerDay: map.mapKind === 'system' ? 24 : 6,
        medium: map.mapKind === 'system' ? 'space' : 'air',
        fractionC: map.mapKind === 'system' ? 0.02 : null,
      }])),
    ]),
  ]

  if (map.mapKind !== 'system') {
    sections.push(ui.section('terrain', 'Terrain', [
      ui.note('Paint a region with a terrain and everything crossing it goes at that fraction of its speed: 1 is normal, 0.5 half, 0 impassable.'),
      ...map.terrains.map((terrain) => {
        const prefix = `terrain.${terrain.id}`
        return ui.group(prefix, terrain.name, [
          ui.text(`${prefix}.name`, 'Name', terrain.name, (name) => patchTerrain(terrain.id, { name })),
          ...TERRAIN_KEYS.map(([key, label]) =>
            ui.number(`${prefix}.${key}`, label, Number.isFinite(terrain.multipliers[key]) ? terrain.multipliers[key] : null, (value) => {
              const multipliers = { ...terrain.multipliers }
              if (value === null) delete multipliers[key]
              else multipliers[key] = value
              patchTerrain(terrain.id, { multipliers })
            }, { min: 0, max: 10, step: 0.05, suffix: '×', allowEmpty: true })
          ),
          ui.color(`${prefix}.fill`, 'Colour', terrain.fill, MAP_DEFAULT_COLORS.terrain, (fill) => patchTerrain(terrain.id, { fill })),
          ui.buttonField(`${prefix}.remove`, 'Remove', () => setTerrains(map.terrains.filter((candidate) => candidate.id !== terrain.id)), { role: 'destructive' }),
        ], { swatch: terrain.fill || MAP_DEFAULT_COLORS.terrainSwatch, collapsible: true })
      }),
    ], [
      ui.button('terrain.add', 'Add', () => setTerrains([...map.terrains, { id: newId(), name: 'New terrain', multipliers: { '*land': 0.5 }, fill: MAP_DEFAULT_COLORS.terrain, hatch: 'none' }])),
    ]))
  }
  return sections
}
