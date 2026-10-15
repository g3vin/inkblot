/**
 * useMapPanel.js — the map inspector, built as a form (see panelBuilder.js).
 *
 * With something selected it edits that thing. With nothing selected it is the map's
 * own settings, in three tabs: the Map (its kind, scale, places), Travel (travellers,
 * conflicts, the ways of travelling, terrain, the distance table) and Style (theme,
 * compass, scale bar, title). Export is a dialog of its own (ExportMapDialog), and the
 * story calendar lives in Settings ▸ Story, which Travel links to.
 *
 * Built in a memo over what it reads: a pan re-renders the map ten times a second and
 * changes nothing here.
 *
 * The inspector's own state — which tab, what is half-entered — lives here, in the
 * page, whichever app draws the panel. Returns `{ panel, handlers }`: the form, and
 * the edits its ids stand for.
 */
import { useMemo, useState } from 'react'
import { getDocDisplayName } from '../../lib/docKind'
import { loadDocument } from '../../lib/FileSystem'
import { EARTH_PROJECTIONS, MAP_THEMES, normalizeMap, pinLabel, newId } from '../../lib/map/mapModel'
import { calibrationKmPerUnit, createSpace } from '../../lib/map/mapSpace'
import { ASTRONOMICAL_UNITS, formatDistance, mapUnits, toKm } from '../../lib/map/mapUnits'
import { buildSchedules, crossScheduleConflicts } from '../../lib/map/timeline'
import { PROJECTION_NAMES } from '../../lib/map/mapProjection'
import { COMPASS_STYLES, newRouteLabel } from '../mapOptions'
import { createPanelBuilder } from './panelBuilder'
import { bodySections, labelSections, pinSections, regionSections, routeSections } from './itemSections'
import { journeysSections, travelSections, travelerSections } from './travelSections'
import { traceSection, useMapTrace } from './traceSection'
import { systemSections } from './systemSections'
import { worldSections } from './worldSections'
import { galaxySections } from './galaxySections'
import { modelSections } from './modelSections'
import { whenSections } from './whenSections'
import { layersSections } from './layersSections'

const THEME_LABELS = { clean: 'Clean', parchment: 'Parchment', ink: 'Pen and ink', night: 'Night' }
const KIND_TITLES = { pin: 'Place', route: 'Route', region: 'Region', label: 'Label', traveler: 'Traveller', body: 'Body' }
const TABS = [
  { id: 'map', label: 'Map' },
  { id: 'travel', label: 'Travel' },
  { id: 'layers', label: 'Layers' },
  { id: 'style', label: 'Style' },
]

/* ---------------- calibration ---------------- */

function calibrateSections(ui, { map, calibration, dispatch, onDone, form, setForm }) {
  const { distance, unit } = form
  const apply = () => {
    if (!(distance > 0)) return
    const kmPerUnit = calibrationKmPerUnit(calibration.a, calibration.b, toKm(distance, unit, map))
    if (!kmPerUnit) return
    dispatch({
      type: 'section/patch',
      section: 'scale',
      patch: { kmPerUnit, displayUnit: unit, calibration: { a: calibration.a, b: calibration.b, distance, unit } },
    })
    setForm({ ...form, distance: null })
    onDone()
  }
  return [
    ui.section('calibrate', 'Set the scale', [
      ui.note('How far apart are the two points you clicked?'),
      ui.number('calibrate.distance', 'Distance', distance, (next) => setForm({ ...form, distance: next }), { min: 0, allowEmpty: true }),
      ui.choice(
        'calibrate.unit',
        'Unit',
        unit,
        mapUnits(map).filter((option) => !ASTRONOMICAL_UNITS.has(option.id)).map((option) => ({ value: option.id, label: option.name })),
        (next) => setForm({ ...form, unit: next })
      ),
      ui.buttons([
        ui.button('calibrate.apply', 'Set scale', apply, { role: 'primary', disabled: !(distance > 0) }),
        ui.button('calibrate.cancel', 'Cancel', onDone),
      ]),
    ]),
  ]
}

/* ---------------- the map tab ---------------- */

function mapTabSections(ui, props, { newUnit, setNewUnit, trace }) {
  const { map, dispatch, space, onTool, onReveal } = props
  const patchScale = (patch) => dispatch({ type: 'section/patch', section: 'scale', patch })
  const patchEarth = (patch) => dispatch({ type: 'section/patch', section: 'earth', patch })
  const patchBackground = (patch) => dispatch({ type: 'section/patch', section: 'background', patch })
  const plane = map.mapKind === 'blank' || map.mapKind === 'image'
  const sections = []

  if (plane) {
    const addUnit = () => {
      const name = newUnit.name.trim()
      if (!name || !(newUnit.km > 0)) return
      patchScale({ customUnits: [...map.scale.customUnits, { id: name, name, km: newUnit.km }] })
      setNewUnit({ name: '', km: null })
    }
    sections.push(ui.section('scale', 'Scale', [
      ui.stat('The sheet spans', formatDistance(map.background.width * space.kmPerUnit, map.scale.displayUnit, map)),
      ui.choice('scale.unit', 'Measure in', map.scale.displayUnit, mapUnits(map).map((unit) => ({ value: unit.id, label: unit.name })), (displayUnit) => patchScale({ displayUnit })),
      ui.number('scale.pixel', 'One pixel is', Number((space.kmPerUnit * 1000).toPrecision(4)), (metres) => patchScale({ kmPerUnit: metres / 1000, calibration: null }), { min: 0.000001, suffix: 'm' }),
      ui.buttonField('scale.calibrate', 'Set from two points…', () => onTool('calibrate'), { icon: 'ruler' }),
      map.scale.calibration ? ui.note(`Set from two points ${map.scale.calibration.distance} ${map.scale.calibration.unit} apart.`) : null,
      ui.group('scale.units', 'Units of your world', [
        ...map.scale.customUnits.map((unit) => ui.stat(unit.name, `${unit.km} km`)),
        ui.text('scale.newUnit.name', 'Name', newUnit.name, (name) => setNewUnit({ ...newUnit, name }), { placeholder: 'e.g. league' }),
        ui.number('scale.newUnit.km', 'Length', newUnit.km, (km) => setNewUnit({ ...newUnit, km }), { min: 0, suffix: 'km', allowEmpty: true }),
        ui.buttonField('scale.newUnit.add', 'Add', addUnit, { disabled: !newUnit.name.trim() || !(newUnit.km > 0) }),
      ], { collapsible: true }),
    ]))
  }

  if (map.mapKind === 'image') {
    sections.push(ui.section('picture', 'Picture', [
      ui.number('picture.opacity', 'Opacity', Math.round(map.background.opacity * 100), (value) => patchBackground({ opacity: value / 100 }), { min: 0, max: 100, step: 5, suffix: '%' }),
      ui.toggle('picture.show', 'Show picture', map.background.showImage, (showImage) => patchBackground({ showImage })),
    ]))
    sections.push(traceSection(ui, { map, dispatch, trace }))
  }

  if (map.mapKind === 'earth') {
    const { viewMenu = [], onViewOption } = props
    const option = (id) => viewMenu.find((entry) => entry.id === id)
    const globe = Boolean(option('earth.view.globe')?.checked)
    const toggle = (id, label) => {
      const entry = option(id)
      return entry ? ui.toggle(id, label, entry.checked, () => onViewOption(id)) : null
    }
    sections.push(ui.section('earth', 'The Earth', [
      ui.choice('earth.view', 'Shown as', globe ? 'globe' : 'flat', [
        { value: 'globe', label: 'A globe' },
        { value: 'flat', label: 'A flat map' },
      ], (value) => onViewOption(`earth.view.${value}`), { help: 'map.earth-view' }),
      globe
        ? ui.choice('earth.imagery', 'Pictures', map.earth.imagery, [
            { value: 'map', label: 'Map' },
            { value: 'satellite', label: 'Satellite' },
            { value: 'hybrid', label: 'Satellite with labels' },
          ], (imagery) => onViewOption(`earth.imagery.${imagery}`), { help: 'map.online' })
        : ui.choice('earth.projection', 'Projection', map.earth.projection === 'orthographic' ? 'equalEarth' : map.earth.projection,
            EARTH_PROJECTIONS.filter((projection) => projection !== 'orthographic').map((projection) => ({ value: projection, label: PROJECTION_NAMES[projection] })),
            (projection) => onViewOption(`earth.projection.${projection}`), { help: 'map.earth-view' }),
      globe ? toggle('earth.streets', 'Street detail') : null,
      globe ? toggle('earth.terrain', 'Terrain in 3D') : null,
      toggle('earth.graticule', 'Graticule'),
      toggle('earth.borders', 'Borders'),
      globe
        ? ui.note('Drag to turn the globe, scroll to zoom, and drag with two fingers or ⌃ to tilt.')
        : ui.group('earth.position', 'Position', [
            ui.number('earth.lon', 'Centre longitude', -map.earth.rotate[0], (lon) => patchEarth({ rotate: [-lon, map.earth.rotate[1]] }), { min: -180, max: 180, step: 1, suffix: '°' }),
          ], { collapsible: true }),
      ui.note('Coastlines and borders: Natural Earth, public domain. Distances follow great circles.'),
    ]))
  }

  if (map.mapKind === 'system') sections.push(...systemSections(ui, props))
  if (map.mapKind === 'planet') sections.push(...worldSections(ui, { map, dispatch, onChoosePicture: props.onChoosePlanetPicture }))
  if (map.mapKind === 'model') sections.push(...modelSections(ui, { map, dispatch, onChooseModel: props.onChooseModel }))
  if (map.mapKind === 'galaxy' || map.mapKind === 'universe') {
    sections.push(...galaxySections(ui, { map, dispatch, addPins: (items) => dispatch({ type: 'items/add', collection: 'pins', items }) }))
  }

  sections.push(ui.section('places', 'Places', [
    !map.pins.length ? ui.note('Use the place tool, or drag documents from a Settings or Locations folder onto the map.') : null,
    ...map.pins.map((pin) => ui.listRow(`places.${pin.id}`, pinLabel(pin, getDocDisplayName), () => onReveal(pin.id))),
  ]))

  return sections
}

/* ---------------- the style tab ---------------- */

function styleTabSections(ui, { map, dispatch }) {
  const patchStyle = (patch) => dispatch({ type: 'section/patch', section: 'style', patch })
  const { style } = map
  return [
    ui.section('look', 'Look', [
      ui.buttons(MAP_THEMES.map((theme) =>
        ui.button(`theme.${theme}`, THEME_LABELS[theme], () => patchStyle({ theme }), { role: style.theme === theme ? 'primary' : 'normal' })
      )),
    ]),
    ui.section('title', 'Title', [
      ui.toggle('title.show', 'Show title', style.cartouche.show, (show) => patchStyle({ cartouche: { ...style.cartouche, show } })),
      ui.text('title.title', 'Title', style.cartouche.title || '', (title) => patchStyle({ cartouche: { ...style.cartouche, title: title || null, show: Boolean(title) || style.cartouche.show } }), {
        placeholder: 'The Western Reach',
      }),
      ui.text('title.subtitle', 'Subtitle', style.cartouche.subtitle || '', (subtitle) => patchStyle({ cartouche: { ...style.cartouche, subtitle: subtitle || null } }), {
        placeholder: 'as it was in the Third Age',
      }),
    ]),
    ui.section('compass', 'Compass', [
      ui.toggle('compass.show', 'Show compass', style.compass.show, (show) => patchStyle({ compass: { ...style.compass, show } })),
      ui.choice('compass.style', 'Style', style.compass.style, COMPASS_STYLES.map((option) => ({ value: option.id, label: option.label })), (next) => patchStyle({ compass: { ...style.compass, style: next } })),
      ui.number('compass.size', 'Size', style.compass.size, (size) => patchStyle({ compass: { ...style.compass, size } }), { min: 32, max: 240, step: 4, suffix: 'px' }),
    ]),
    ui.section('scaleBar', 'Scale bar', [
      ui.toggle('scaleBar.show', 'Show scale bar', style.scaleBar.show, (show) => patchStyle({ scaleBar: { ...style.scaleBar, show } })),
    ]),
  ]
}

/* ---------------- the panel ---------------- */

export function useMapPanel(props) {
  const {
    map, dispatch, space, day, onDay, schedules, conflicts, selection, selectedItem, onSelect,
    docs, missingDocs, calendar, onOpenCalendar, onOpenDoc, renameRequest, calibration, onCalibrationDone,
    focusBody, onFocusBody, projectName, docPath, zoomNow, onTool, onReveal, viewMenu, onViewOption,
    onOpenSurface, onChoosePlanetPicture, onOpenPinMap, onChooseModel, storyEvents, onSaveView, onShowView,
  } = props
  const [tab, setTab] = useState('map')
  const [crossConflicts, setCrossConflicts] = useState(null)
  const [calibrationForm, setCalibrationForm] = useState(() => ({ distance: null, unit: map.scale.displayUnit || 'km' }))
  const [newUnit, setNewUnit] = useState({ name: '', km: null })
  const [matrix, setMatrix] = useState(() => ({ show: false, transport: map.mapKind === 'system' ? 'light10' : 'horse' }))
  const trace = useMapTrace({ map, dispatch, projectName })

  return useMemo(() => {
    const ui = createPanelBuilder()

    const collection = selection ? (selection.kind === 'body' ? null : `${selection.kind}s`) : null
    const patch = (next) => dispatch({ type: 'items/patch', collection, patches: { [selection.id]: next } })
    const remove = () => {
      dispatch({ type: 'items/remove', collection, ids: [selection.id] })
      onSelect(null)
    }
    const addLabel = (label) => {
      dispatch({ type: 'items/add', collection: 'labels', items: [label] })
      onSelect('label', label.id)
    }
    const patchBody = (next) =>
      dispatch({ type: 'section/patch', section: 'system', patch: { bodies: map.system.bodies.map((body) => (body.id === selection.id ? { ...body, ...next } : body)) } })
    const addBody = (body) => {
      dispatch({ type: 'section/patch', section: 'system', patch: { bodies: [...map.system.bodies, body] } })
      onSelect('body', body.id)
    }
    const removeBody = () => {
      dispatch({ type: 'section/patch', section: 'system', patch: { bodies: map.system.bodies.filter((body) => body.id !== selection.id && body.parent !== selection.id) } })
      onSelect(null)
    }
    const addTraveler = () => {
      const character = docs.docs.find((doc) => doc.isCharacter && !map.travelers.some((traveler) => traveler.doc === doc.path))
      const traveler = { id: newId(), doc: character?.path || null, name: character ? null : 'Traveller', color: null, startPin: map.pins[0]?.id || null, startDay: Math.floor(day), legs: [] }
      dispatch({ type: 'items/add', collection: 'travelers', items: [traveler] })
      onSelect('traveler', traveler.id)
    }
    const checkAllMaps = async () => {
      const entries = []
      for (const doc of docs.docs.filter((candidate) => candidate.kind === 'map')) {
        const raw = doc.path === docPath ? map : await loadDocument(projectName, doc.path)
        if (!raw || raw.type !== 'map') continue
        const other = doc.path === docPath ? map : normalizeMap(raw)
        const otherSpace = doc.path === docPath ? space : createSpace(other)
        const pinDocs = new Map(other.pins.filter((pin) => pin.doc).map((pin) => [pin.id, pin.doc]))
        for (const schedule of buildSchedules(other, otherSpace)) entries.push({ mapPath: doc.path, schedule, pinDocs })
        // A slice at a time, so a project of many maps never holds the page still.
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      // Only conflicts that cross maps: this map's own are already listed.
      setCrossConflicts(crossScheduleConflicts(entries).filter((conflict) => conflict.maps[0] !== conflict.maps[1]))
    }

    const editing = Boolean(selection && selectedItem && !calibration)
    let sections
    if (calibration) {
      sections = calibrateSections(ui, { map, calibration, dispatch, onDone: onCalibrationDone, form: calibrationForm, setForm: setCalibrationForm })
    } else if (editing) {
      const common = { map, space, day, renameRequest }
      if (selection.kind === 'pin') {
        sections = pinSections(ui, { ...common, pin: selectedItem, docs, missing: Boolean(selectedItem.doc && missingDocs?.has(selectedItem.doc)), patch, onOpenDoc, onOpenPinMap: onOpenPinMap ? () => onOpenPinMap(selectedItem) : null, onDelete: remove })
      } else if (selection.kind === 'route') {
        sections = routeSections(ui, { ...common, route: selectedItem, patch, onDelete: remove, onAddLabel: () => addLabel(newRouteLabel(selectedItem)) })
      } else if (selection.kind === 'region') {
        sections = regionSections(ui, {
          ...common,
          region: selectedItem,
          patch,
          onDelete: remove,
          onAddLabel: () => {
            const ring = selectedItem.rings[0]
            const at = [ring.reduce((sum, point) => sum + point[0], 0) / ring.length, ring.reduce((sum, point) => sum + point[1], 0) / ring.length]
            addLabel({ id: newId(), text: selectedItem.name || 'Region', at, route: null, path: null, startOffset: 0.5, size: 24 / (zoomNow?.() || 1), rotation: 0, font: 'serif', minZoom: 0, maxZoom: null })
          },
        })
      } else if (selection.kind === 'label') {
        sections = labelSections(ui, { ...common, label: selectedItem, patch, onDelete: remove })
      }
      if (['pin', 'route', 'region', 'label'].includes(selection.kind)) {
        // Before the last section, which ends in Delete.
        sections.splice(Math.max(0, sections.length - 1), 0, ...whenSections(ui, { map, item: selectedItem, calendar, events: storyEvents, patch, onDay }))
      } else if (selection.kind === 'traveler') {
        sections = travelerSections(ui, {
          ...common,
          traveler: selectedItem,
          index: map.travelers.findIndex((traveler) => traveler.id === selectedItem.id),
          schedule: schedules.find((schedule) => schedule.travelerId === selectedItem.id),
          conflicts,
          docs,
          calendar,
          patch,
          onDelete: remove,
          onDay,
          onOpenDoc,
        })
      } else {
        sections = bodySections(ui, {
          map,
          body: selectedItem,
          patchBody,
          addBody,
          onDelete: removeBody,
          focused: focusBody === selectedItem.id,
          onFocus: () => onFocusBody(focusBody === selectedItem.id ? null : selectedItem.id),
          onOpenSurface: onOpenSurface ? () => onOpenSurface(selectedItem) : null,
          renameRequest,
        })
      }
    } else if (tab === 'travel') {
      sections = [
        ...journeysSections(ui, { map, schedules, conflicts, calendar, onOpenCalendar, onSelect, onDay, docs, addTraveler, onCheckAllMaps: checkAllMaps, crossConflicts }),
        ...travelSections(ui, { map, space, day, dispatch, matrix, setMatrix }),
      ]
    } else if (tab === 'layers') {
      sections = layersSections(ui, { map, dispatch, calendar, onSaveView, onShowView })
    } else if (tab === 'style') {
      sections = styleTabSections(ui, { map, dispatch })
    } else {
      sections = mapTabSections(ui, { map, dispatch, space, calendar, onDay, onTool, onReveal, onSelect, focusBody, onFocusBody, viewMenu, onViewOption, onChoosePlanetPicture, onChooseModel }, { newUnit, setNewUnit, trace })
    }

    const showTabs = !selection && !calibration
    const panel = {
      title: calibration ? 'Scale' : editing ? KIND_TITLES[selection.kind] : getDocDisplayName(docPath),
      canGoBack: editing,
      problems: conflicts.length,
      tabs: showTabs ? TABS : [],
      tab: showTabs ? tab : undefined,
      sections,
    }

    const { handlers } = ui
    handlers.set('@tab', (id) => setTab(TABS.some((candidate) => candidate.id === id) ? id : 'map'))
    handlers.set('@back', () => onSelect(null))
    return { panel, handlers }
  }, [
    calendar, calibration, calibrationForm, conflicts, crossConflicts, day, dispatch, docPath, docs, focusBody, map, matrix,
    missingDocs, newUnit, onCalibrationDone, onDay, onFocusBody, onOpenCalendar, onOpenDoc, onReveal, onSelect, onTool,
    projectName, renameRequest, schedules, selectedItem, selection, space, tab, trace, viewMenu, onViewOption, zoomNow,
    onOpenSurface, onChoosePlanetPicture, onOpenPinMap, onChooseModel, storyEvents, onSaveView, onShowView,
  ])
}
