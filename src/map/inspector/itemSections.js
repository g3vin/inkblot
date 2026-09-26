/**
 * itemSections.js — the inspector for one selected thing: a place, a route, a region,
 * a label or a body of a star system. (Travellers have their own, travelSections.js.)
 *
 * Each function takes the panel builder (`ui`) and returns the thing's sections.
 */
import { getDocDisplayName } from '../../lib/docKind'
import { lineKm, resolvePin, routeCoords } from '../../lib/map/mapSpace'
import { formatArea, formatDistance, formatDuration } from '../../lib/map/mapUnits'
import { legTravel } from '../../lib/map/travel'
import { mapTransports } from '../../lib/map/transports'
import { HATCHES, LINE_DASHES } from '../../lib/map/mapModel'
import { STAR_PRESETS, massToLuminosity, starPreset, temperatureToColor } from '../../lib/map/stars'
import { bodyMass, orbitPeriod } from '../../lib/map/orbits'
import { newBody } from '../../lib/map/systemPresets'
import { PIN_ICONS, unitFor } from '../mapOptions'

const HATCH_LABELS = { none: 'None', diagonal: 'Diagonal lines', cross: 'Cross-hatch', dots: 'Dots', waves: 'Waves', mountains: 'Mountains' }
const DASH_LABELS = { solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted', inked: 'Inked (hand-drawn)', rough: 'Rough (sketchy)' }
export const BODY_KIND_LABELS = { star: 'Star', planet: 'Planet', dwarf: 'Dwarf planet', moon: 'Moon', belt: 'Belt', station: 'Station', barycenter: 'Barycentre' }

/** The options of a document picker: `preferred` first, then everything else. */
export function docChoices(docs, value, preferred, preferredLabel, noneLabel = 'None') {
  const own = docs.filter((doc) => preferred(doc))
  const rest = docs.filter((doc) => !preferred(doc) && doc.kind === 'text')
  const others = docs.filter((doc) => !preferred(doc) && doc.kind !== 'text')
  const known = docs.some((doc) => doc.path === value)
  return [
    { value: '', label: noneLabel },
    ...(value && !known ? [{ value, label: `${value} (missing)` }] : []),
    ...own.map((doc) => ({ value: doc.path, label: doc.path, group: preferredLabel })),
    ...rest.map((doc) => ({ value: doc.path, label: doc.path, group: 'Other documents' })),
    ...others.map((doc) => ({ value: doc.path, label: doc.path, group: 'Maps and canvases' })),
  ]
}

const deleteSection = (ui, id, onDelete, label = 'Delete') =>
  ui.section(`${id}.delete`, '', [ui.buttonField(`${id}.delete`, label, onDelete, { role: 'destructive' })])

/* ---------------- places ---------------- */

export function pinSections(ui, { map, pin, space, day, docs, missing, patch, onOpenDoc, onDelete, renameRequest }) {
  const at = resolvePin(map, space, pin, day)
  const coordinates = at
    ? map.mapKind === 'earth'
      ? `${Math.abs(at[1]).toFixed(3)}° ${at[1] >= 0 ? 'N' : 'S'}, ${Math.abs(at[0]).toFixed(3)}° ${at[0] >= 0 ? 'E' : 'W'}`
      : map.mapKind === 'system'
        ? `${Math.hypot(at[0], at[1]).toFixed(3)} AU from the centre`
        : `${Math.round(at[0])}, ${Math.round(at[1])}`
    : '—'
  return [
    ui.section('place', 'Place', [
      ui.text('pin.name', 'Name', pin.name || '', (name) => patch({ name: name.trim() || null }), {
        placeholder: pin.doc ? getDocDisplayName(pin.doc) : 'Untitled place',
        focusKey: renameRequest,
      }),
      ui.choice(
        'pin.doc',
        'Document',
        pin.doc || '',
        docChoices(docs.docs, pin.doc, (doc) => doc.isLocation, 'Locations', 'None — just a place on the map'),
        (doc) => patch({ doc: doc || null })
      ),
      missing ? ui.warning('The linked document has been deleted or moved. Choose it again above.') : null,
      pin.doc && !missing ? ui.buttonField('pin.open', `Open “${getDocDisplayName(pin.doc)}”`, () => onOpenDoc?.(pin.doc)) : null,
      !docs.docs.some((doc) => doc.isLocation)
        ? ui.note('Tip: documents in a folder named Settings, Locations or Places are offered first here — and can be dragged straight onto the map.')
        : null,
    ]),
    ui.section('marker', 'Marker', [
      ui.markers('pin.icon', pin.icon, pin.color, PIN_ICONS.map((icon) => ({ value: icon.id, label: icon.label })), (icon) => patch({ icon })),
      ui.color('pin.color', 'Colour', pin.color, '#c0392b', (color) => patch({ color })),
      map.mapKind === 'system'
        ? ui.choice(
            'pin.body',
            'Rides on',
            pin.body || '',
            [
              { value: '', label: 'Nothing — fixed in space' },
              ...map.system.bodies.filter((body) => body.kind !== 'barycenter').map((body) => ({ value: body.id, label: body.name })),
            ],
            (body) => patch(body ? { body, at: null } : { body: null, at: at || [0, 0] })
          )
        : null,
      ui.note(coordinates),
    ]),
    deleteSection(ui, 'pin', onDelete),
  ]
}

/* ---------------- routes ---------------- */

/** Transports worth showing a time for on this kind of map. */
const transportsFor = (map) => {
  const all = mapTransports(map)
  if (map.mapKind === 'system') return all.filter((transport) => transport.medium === 'space')
  return all.filter((transport) => transport.medium !== 'space')
}

export function routeSections(ui, { map, route, space, day, patch, onDelete, onAddLabel, renameRequest }) {
  const km = lineKm(space, routeCoords(map, space, route, day))
  const first = route.nodes[0]?.pin
  const last = route.nodes[route.nodes.length - 1]?.pin
  const times = transportsFor(map).map((transport) => ({
    transport,
    travel: legTravel(map, space, { route: route.id, from: first || null, to: last || null, transport: transport.id }, day),
  }))
  return [
    ui.section('route', 'Route', [
      ui.text('route.name', 'Name', route.name || '', (name) => patch({ name: name.trim() || null }), {
        placeholder: 'Unnamed route',
        focusKey: renameRequest,
      }),
      ui.stat('Length', formatDistance(km, unitFor(map), map)),
      ui.stat('Stops', route.nodes.length),
      ui.toggle('route.smooth', 'Smooth curve', route.smooth === 'catmullRom', (on) => patch({ smooth: on ? 'catmullRom' : 'linear' })),
      ui.note('Drag a stop to move it (onto a place to route through it); drag a faint midpoint to add one; double-click the line to add a stop there.'),
    ]),
    ui.section('line', 'Line', [
      ui.color('route.stroke', 'Colour', route.style.stroke, '#b3462f', (stroke) => patch({ style: { ...route.style, stroke } })),
      ui.number('route.width', 'Width', route.style.width, (width) => patch({ style: { ...route.style, width } }), { min: 0.5, max: 20, step: 0.5, suffix: 'px' }),
      ui.choice('route.dash', 'Style', route.style.dash, LINE_DASHES.map((dash) => ({ value: dash, label: DASH_LABELS[dash] })), (dash) => patch({ style: { ...route.style, dash } })),
      ui.toggle('route.arrow', 'Arrow at end', route.style.arrow, (arrow) => patch({ style: { ...route.style, arrow } })),
      ui.buttonField('route.label', 'Write its name along it', onAddLabel),
    ]),
    ui.section('route.times', 'How long it takes', [
      ...times.map(({ transport, travel }) =>
        ui.stat(transport.name, travel.profile.impassable ? 'impassable' : formatDuration(travel.profile.days))
      ),
      ui.note('Terrain the route crosses is counted: regions with a terrain slow or speed each way of travelling. Times assume each transport’s usual hours on the move per day.'),
    ]),
    deleteSection(ui, 'route', onDelete),
  ]
}

/* ---------------- regions ---------------- */

export function regionSections(ui, { map, region, space, patch, onDelete, onAddLabel, renameRequest }) {
  const terrain = map.terrains.find((candidate) => candidate.id === region.terrain)
  return [
    ui.section('region', 'Region', [
      ui.text('region.name', 'Name', region.name || '', (name) => patch({ name: name.trim() || null }), {
        placeholder: 'Unnamed region',
        focusKey: renameRequest,
      }),
      ui.stat('Area', formatArea(space.areaKm2(region.rings), unitFor(map) === 'auto' ? 'km' : unitFor(map), map)),
      ui.choice(
        'region.terrain',
        'Terrain',
        region.terrain || '',
        [{ value: '', label: 'None — just a territory' }, ...map.terrains.map((candidate) => ({ value: candidate.id, label: candidate.name }))],
        (next) => patch({ terrain: next || null })
      ),
      terrain ? ui.note(`Travel across it is slowed or sped by the ${terrain.name.toLowerCase()} terrain (edit terrains under Travel).`) : null,
    ]),
    ui.section('look', 'Look', [
      ui.color('region.fill', 'Fill', region.fill, terrain?.fill || '#6d9c5a', (fill) => patch({ fill })),
      ui.color('region.stroke', 'Edge', region.stroke, region.fill || terrain?.fill || '#6d9c5a', (stroke) => patch({ stroke })),
      ui.choice('region.hatch', 'Hatching', region.hatch, HATCHES.map((hatch) => ({ value: hatch, label: HATCH_LABELS[hatch] })), (hatch) => patch({ hatch })),
      ui.buttonField('region.label', 'Label it', onAddLabel),
    ]),
    deleteSection(ui, 'region', onDelete),
  ]
}

/* ---------------- labels ---------------- */

const LABEL_FONTS = [
  { value: 'serif', label: 'Map serif' },
  { value: 'sans', label: 'Plain sans' },
  { value: "'Snell Roundhand', 'Apple Chancery', cursive", label: 'Calligraphic' },
  { value: "'Trajan Pro', 'Cinzel', 'Copperplate', serif", label: 'Engraved capitals' },
]

export function labelSections(ui, { map, label, patch, onDelete, renameRequest }) {
  return [
    ui.section('label', 'Label', [
      ui.text('label.text', 'Text', label.text, (text) => patch({ text }), { focusKey: renameRequest }),
      ui.number('label.size', 'Size', Math.round(label.size * 100) / 100, (size) => patch({ size }), {
        min: 0.001,
        help: 'In map units — the label grows and shrinks with the map.',
      }),
      ui.choice('label.font', 'Typeface', label.font, LABEL_FONTS, (font) => patch({ font })),
      ui.choice(
        'label.route',
        'Follows',
        label.route || '',
        [
          { value: '', label: label.path ? 'Its own curve' : 'Nothing — straight text' },
          ...map.routes.map((route) => ({ value: route.id, label: route.name || 'Unnamed route' })),
        ],
        (route) => patch(route ? { route } : { route: null, at: label.at || label.path?.[0] || null })
      ),
      label.route || label.path
        ? ui.number('label.along', 'Along', Math.round(label.startOffset * 100), (value) => patch({ startOffset: value / 100 }), { min: 0, max: 100, step: 1, suffix: '%' })
        : ui.number('label.rotation', 'Rotation', label.rotation, (rotation) => patch({ rotation }), { min: -180, max: 180, step: 1, suffix: '°' }),
      ui.number('label.minZoom', 'Show from', label.minZoom, (minZoom) => patch({ minZoom: minZoom ?? 0 }), {
        min: 0,
        suffix: '× zoom',
        allowEmpty: true,
        help: 'Hide the label when zoomed out further than this.',
      }),
      ui.number('label.maxZoom', 'Hide past', label.maxZoom, (maxZoom) => patch({ maxZoom }), {
        min: 0,
        suffix: '× zoom',
        allowEmpty: true,
        help: 'Hide the label when zoomed in closer than this.',
      }),
    ]),
    deleteSection(ui, 'label', onDelete),
  ]
}

/* ---------------- star-system bodies ---------------- */

export function bodySections(ui, { map, body, patchBody, addBody, onDelete, focused, onFocus, renameRequest }) {
  const bodies = new Map(map.system.bodies.map((candidate) => [candidate.id, candidate]))
  const period = body.orbit ? orbitPeriod(body, bodies) : null
  const orbit = body.orbit
  const patchOrbit = (next) =>
    patchBody({ orbit: { ...(orbit || { aAU: 1, e: 0, periapsisDeg: 0, meanAnomalyDeg: 0, periodDays: null, retrograde: false }), ...next } })
  const setPreset = (id) => {
    const preset = starPreset(id)
    patchBody({ massSun: preset.massSun, radiusKm: preset.radiusSun * 695700, star: { spectral: preset.id, temperatureK: preset.temperatureK, luminositySun: preset.luminositySun } })
  }
  const add = (kind, distance, label) => ui.button(`body.add.${kind}`, label, () => addBody(newBody(kind, body.id, distance)))

  const sections = [
    ui.section('body', BODY_KIND_LABELS[body.kind] || 'Body', [
      ui.text('body.name', 'Name', body.name, (name) => patchBody({ name }), { focusKey: renameRequest }),
      ui.choice(
        'body.parent',
        'Orbits',
        body.parent || '',
        [
          { value: '', label: 'Nothing — the centre' },
          ...map.system.bodies.filter((candidate) => candidate.id !== body.id).map((candidate) => ({ value: candidate.id, label: candidate.name || BODY_KIND_LABELS[candidate.kind] })),
        ],
        (parent) => patchBody({ parent: parent || null })
      ),
      body.kind !== 'star' && body.kind !== 'barycenter' && body.kind !== 'belt'
        ? ui.color('body.color', 'Colour', body.color, '#9aa7b8', (color) => patchBody({ color }))
        : null,
      ui.buttonField('body.focus', focused ? 'Stop following' : 'Centre the view on it', onFocus),
    ]),
  ]

  if (body.kind === 'star') {
    sections.push(ui.section('star', 'Star', [
      ui.choice('star.type', 'Type', body.star?.spectral || 'G2V', STAR_PRESETS.map((preset) => ({ value: preset.id, label: preset.name })), setPreset),
      ui.number('star.temperature', 'Temperature', body.star?.temperatureK ?? 5772, (temperatureK) => patchBody({ star: { ...body.star, temperatureK }, color: null }), { min: 0, step: 100, suffix: 'K' }),
      ui.number('star.mass', 'Mass', body.massSun ?? 1, (massSun) => patchBody({ massSun }), { min: 0.001, suffix: 'M☉' }),
      ui.number('star.brightness', 'Brightness', body.star?.luminositySun ?? 1, (luminositySun) => patchBody({ star: { ...body.star, luminositySun } }), { min: 0, suffix: 'L☉' }),
      ui.buttonField('star.brightnessFromMass', 'Brightness from mass (main sequence)', () =>
        patchBody({ star: { ...body.star, luminositySun: Math.round(massToLuminosity(body.massSun ?? 1) * 1e4) / 1e4 } })
      ),
      ui.note('The green rings mark where liquid water could last on a planet’s surface.', { swatch: temperatureToColor(body.star?.temperatureK ?? 5772) }),
    ]))
  }

  if (body.kind === 'belt') {
    sections.push(ui.section('belt', 'Belt', [
      ui.number('belt.inner', 'Inner edge', body.belt?.innerAU ?? 2, (innerAU) => patchBody({ belt: { ...body.belt, innerAU } }), { min: 0.0001, suffix: 'AU' }),
      ui.number('belt.outer', 'Outer edge', body.belt?.outerAU ?? 3, (outerAU) => patchBody({ belt: { ...body.belt, outerAU } }), { min: 0.0001, suffix: 'AU' }),
    ]))
  }

  if (body.kind !== 'belt' && body.parent) {
    sections.push(ui.section('orbit', 'Orbit', [
      ui.number('orbit.distance', 'Distance', orbit?.aAU ?? 1, (aAU) => patchOrbit({ aAU }), { min: 0.00001, suffix: 'AU', help: 'The orbit’s semi-major axis.' }),
      ui.number('orbit.e', 'Eccentricity', orbit?.e ?? 0, (e) => patchOrbit({ e }), { min: 0, max: 0.99, step: 0.01, help: '0 is a circle; toward 1, a long ellipse.' }),
      ui.number('orbit.periapsis', 'Periapsis at', orbit?.periapsisDeg ?? 0, (periapsisDeg) => patchOrbit({ periapsisDeg }), { min: -360, max: 360, step: 1, suffix: '°' }),
      ui.number('orbit.start', 'Start angle', orbit?.meanAnomalyDeg ?? 0, (meanAnomalyDeg) => patchOrbit({ meanAnomalyDeg }), { min: -360, max: 360, step: 1, suffix: '°', help: 'Where it is on day 0.' }),
      ui.number('orbit.period', 'Year length', orbit?.periodDays ?? null, (periodDays) => patchOrbit({ periodDays }), {
        min: 0.001,
        suffix: 'days',
        allowEmpty: true,
        help: 'Leave empty to work it out from the masses (Kepler’s third law).',
      }),
      period
        ? ui.stat('Its year', period >= 700 ? `${(period / 365.25).toFixed(2)} Earth years` : `${period.toFixed(period < 10 ? 2 : 1)} days`)
        : null,
      ui.toggle('orbit.retrograde', 'Retrograde', orbit?.retrograde, (retrograde) => patchOrbit({ retrograde })),
      body.kind !== 'star'
        ? ui.number('orbit.mass', 'Mass', body.massSun ? Math.round(body.massSun * 332946 * 1e4) / 1e4 : null, (earths) => patchBody({ massSun: earths ? earths / 332946 : null }), {
            min: 0,
            suffix: 'Earths',
            allowEmpty: true,
          })
        : null,
      ui.note(`Weight of what it orbits: ${bodyMass(bodies.get(body.parent), bodies).toPrecision(3)} M☉`),
    ]))
  }

  const adds = body.kind === 'star' || body.kind === 'barycenter'
    ? [add('planet', 1, 'Planet'), add('dwarf', 40, 'Dwarf planet'), add('belt', 2.5, 'Belt'), add('star', 40, 'Companion star')]
    : body.kind === 'planet' || body.kind === 'dwarf'
      ? [add('moon', 0.003, 'Moon'), add('station', 0.0003, 'Station')]
      : []
  if (adds.length) sections.push(ui.section('body.add', 'Add', [ui.buttons(adds)]))
  sections.push(deleteSection(ui, 'body', onDelete, 'Delete (and what orbits it directly)'))
  return sections
}
