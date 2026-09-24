/**
 * MapInspector.jsx — the panel down the right of a map.
 *
 * With something selected it edits that thing. With nothing selected it is the map's
 * own settings, in four tabs: the Map (its kind, scale, places), Journeys (travellers,
 * the calendar, conflicts), Travel (transports, terrain, the distance table) and
 * Style (theme, compass, scale bar, title).
 */
import { useState } from 'react'
import SFIcon from '../components/SFIcon'
import { getDocDisplayName } from '../lib/docKind'
import { loadDocument } from '../lib/FileSystem'
import { EARTH_PROJECTIONS, MAP_THEMES, normalizeMap, pinLabel, newId } from '../lib/map/mapModel'
import { calibrationKmPerUnit, createSpace } from '../lib/map/mapSpace'
import { formatDistance, mapUnits, toKm } from '../lib/map/mapUnits'
import { buildSchedules, crossScheduleConflicts } from '../lib/map/timeline'
import { PROJECTION_NAMES } from '../lib/map/mapProjection'
import { COMPASS_STYLES, newRouteLabel } from './mapOptions'
import { CheckField, NumberField, Section, SelectField, Stat, TextField } from './inspector/fields'
import { BodyPanel, LabelPanel, PinPanel, RegionPanel, RoutePanel } from './inspector/ItemPanels'
import { JourneysTab, TravelTab, TravelerPanel } from './inspector/TravelPanels'
import MapExportPanel from './MapExportPanel'
import MapTracePanel from './MapTracePanel'

const THEME_LABELS = { clean: 'Clean', parchment: 'Parchment', ink: 'Pen and ink', night: 'Night' }
const KIND_TITLES = { pin: 'Place', route: 'Route', region: 'Region', label: 'Label', traveler: 'Traveller', body: 'Body' }
const TABS = [
  { id: 'map', label: 'Map' },
  { id: 'journeys', label: 'Journeys' },
  { id: 'travel', label: 'Travel' },
  { id: 'style', label: 'Style' },
]

/* ---------------- calibration ---------------- */

function CalibratePanel({ map, calibration, dispatch, onDone }) {
  const [distance, setDistance] = useState('')
  const [unit, setUnit] = useState(map.scale.displayUnit || 'km')
  const apply = () => {
    const value = Number(distance)
    if (!(value > 0)) return
    const kmPerUnit = calibrationKmPerUnit(calibration.a, calibration.b, toKm(value, unit, map))
    if (!kmPerUnit) return
    dispatch({
      type: 'section/patch',
      section: 'scale',
      patch: { kmPerUnit, displayUnit: unit, calibration: { a: calibration.a, b: calibration.b, distance: value, unit } },
    })
    onDone()
  }
  return (
    <Section title="Set the scale">
      <p className="map-note">How far apart are the two points you clicked?</p>
      <div className="map-row" style={{ flexWrap: 'nowrap' }}>
        <input className="map-input" type="number" min="0" step="any" autoFocus value={distance} onChange={(event) => setDistance(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && apply()} aria-label="Distance" />
        <select className="map-input" value={unit} onChange={(event) => setUnit(event.target.value)} aria-label="Unit">
          {mapUnits(map).filter((option) => option.id !== 'AU' && option.id !== 'ly' && option.id !== 'pc').map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
      </div>
      <div className="map-row" style={{ marginTop: 8 }}>
        <button type="button" className="map-button is-primary" onClick={apply} disabled={!(Number(distance) > 0)}>Set scale</button>
        <button type="button" className="map-button" onClick={onDone}>Cancel</button>
      </div>
    </Section>
  )
}

/* ---------------- the map tab ---------------- */

function MapTab({ map, dispatch, space, onTool, onReveal, onSelect, focusBody, onFocusBody, projectName, docPath, surfaceRef, projector, day, idPrefix, viewport }) {
  const patchScale = (patch) => dispatch({ type: 'section/patch', section: 'scale', patch })
  const patchEarth = (patch) => dispatch({ type: 'section/patch', section: 'earth', patch })
  const patchBackground = (patch) => dispatch({ type: 'section/patch', section: 'background', patch })
  const plane = map.mapKind === 'blank' || map.mapKind === 'image'
  const [newUnit, setNewUnit] = useState({ name: '', km: '' })

  return (
    <>
      {plane ? (
        <Section title="Scale">
          <Stat label="The sheet spans">{formatDistance(map.background.width * space.kmPerUnit, map.scale.displayUnit, map)}</Stat>
          <SelectField label="Measure in" value={map.scale.displayUnit} options={mapUnits(map).map((unit) => ({ value: unit.id, label: unit.name }))} onChange={(displayUnit) => patchScale({ displayUnit })} />
          <NumberField label="One pixel is" value={Number((space.kmPerUnit * 1000).toPrecision(4))} min={0.000001} step="any" suffix="m" onCommit={(metres) => patchScale({ kmPerUnit: metres / 1000, calibration: null })} />
          <button type="button" className="map-button" onClick={() => onTool('calibrate')}>
            <SFIcon name="map.calibrate" size={12} /> Set from two points…
          </button>
          {map.scale.calibration ? (
            <p className="map-note">Set from two points {map.scale.calibration.distance} {map.scale.calibration.unit} apart.</p>
          ) : null}
          <details>
            <summary className="map-note">Units of your world</summary>
            {map.scale.customUnits.map((unit) => (
              <Stat key={unit.id} label={unit.name}>{`${unit.km} km`}</Stat>
            ))}
            <div className="map-row" style={{ flexWrap: 'nowrap' }}>
              <input className="map-input" placeholder="Name, e.g. league" value={newUnit.name} onChange={(event) => setNewUnit({ ...newUnit, name: event.target.value })} />
              <input className="map-input" placeholder="km" type="number" min="0" step="any" value={newUnit.km} onChange={(event) => setNewUnit({ ...newUnit, km: event.target.value })} />
              <button
                type="button"
                className="map-button"
                disabled={!newUnit.name.trim() || !(Number(newUnit.km) > 0)}
                onClick={() => {
                  patchScale({ customUnits: [...map.scale.customUnits, { id: newUnit.name.trim(), name: newUnit.name.trim(), km: Number(newUnit.km) }] })
                  setNewUnit({ name: '', km: '' })
                }}
              >Add</button>
            </div>
          </details>
        </Section>
      ) : null}

      {map.mapKind === 'image' ? (
        <Section title="Picture">
          <NumberField label="Opacity" value={Math.round(map.background.opacity * 100)} min={0} max={100} step={5} suffix="%" onCommit={(value) => patchBackground({ opacity: value / 100 })} />
          <CheckField label="Show picture" checked={map.background.showImage} onChange={(showImage) => patchBackground({ showImage })} />
          <MapTracePanel map={map} dispatch={dispatch} projectName={projectName} />
        </Section>
      ) : null}

      {map.mapKind === 'earth' ? (
        <Section title="The Earth">
          <SelectField label="Projection" value={map.earth.projection} options={EARTH_PROJECTIONS.map((projection) => ({ value: projection, label: PROJECTION_NAMES[projection] }))} onChange={(projection) => patchEarth({ projection })} />
          <NumberField label="Centre longitude" value={-map.earth.rotate[0]} min={-180} max={180} step={1} suffix="°" onCommit={(lon) => patchEarth({ rotate: [-lon, map.earth.rotate[1]] })} />
          {map.earth.projection === 'orthographic' ? (
            <NumberField label="Centre latitude" value={-map.earth.rotate[1]} min={-90} max={90} step={1} suffix="°" onCommit={(lat) => patchEarth({ rotate: [map.earth.rotate[0], -lat] })} />
          ) : null}
          <CheckField label="Graticule" checked={map.earth.graticule} onChange={(graticule) => patchEarth({ graticule })} />
          <CheckField label="Borders" checked={map.earth.borders} onChange={(borders) => patchEarth({ borders })} />
          <p className="map-note">Coastlines and borders: Natural Earth, public domain. Distances follow great circles.</p>
        </Section>
      ) : null}

      {map.mapKind === 'system' ? (
        <Section title="Star system">
          <SelectField
            label="Distances drawn"
            value={map.system.display.radial}
            options={[{ value: 'log', label: 'Squeezed, so everything fits' }, { value: 'linear', label: 'To scale' }]}
            onChange={(radial) => dispatch({ type: 'section/patch', section: 'system', patch: { display: { ...map.system.display, radial } } })}
          />
          <p className="map-note">Measurements and travel times always use true distances. Double-click a body to follow it.</p>
          {focusBody ? <button type="button" className="map-button" onClick={() => onFocusBody(null)}>Stop following</button> : null}
          <ul className="map-list">
            {map.system.bodies.map((body) => (
              <li key={body.id}>
                <button type="button" className="map-button" style={{ width: '100%', textAlign: 'left', margin: '2px 0', paddingLeft: body.parent ? 22 : 10 }} onClick={() => onSelect('body', body.id)}>
                  {body.name || body.kind}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Places">
        {!map.pins.length ? <p className="map-note">Use the place tool, or drag documents from a Settings or Locations folder onto the map.</p> : null}
        <ul className="map-list">
          {map.pins.map((pin) => (
            <li key={pin.id}>
              <button type="button" className="map-button" style={{ width: '100%', textAlign: 'left', margin: '2px 0' }} onClick={() => onReveal(pin.id)}>
                {pinLabel(pin, getDocDisplayName)}
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <MapExportPanel map={map} projectName={projectName} docPath={docPath} surfaceRef={surfaceRef} projector={projector} space={space} day={day} idPrefix={idPrefix} viewport={viewport} />
    </>
  )
}

/* ---------------- the style tab ---------------- */

function StyleTab({ map, dispatch }) {
  const patchStyle = (patch) => dispatch({ type: 'section/patch', section: 'style', patch })
  const { style } = map
  return (
    <>
      <Section title="Look">
        <div className="map-row">
          {MAP_THEMES.map((theme) => (
            <button key={theme} type="button" className={`map-button${style.theme === theme ? ' is-primary' : ''}`} onClick={() => patchStyle({ theme })}>
              {THEME_LABELS[theme]}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Title">
        <CheckField label="Show title" checked={style.cartouche.show} onChange={(show) => patchStyle({ cartouche: { ...style.cartouche, show } })} />
        <TextField label="Title" value={style.cartouche.title || ''} placeholder="The Western Reach" onCommit={(title) => patchStyle({ cartouche: { ...style.cartouche, title: title || null, show: Boolean(title) || style.cartouche.show } })} />
        <TextField label="Subtitle" value={style.cartouche.subtitle || ''} placeholder="as it was in the Third Age" onCommit={(subtitle) => patchStyle({ cartouche: { ...style.cartouche, subtitle: subtitle || null } })} />
      </Section>
      <Section title="Compass">
        <CheckField label="Show compass" checked={style.compass.show} onChange={(show) => patchStyle({ compass: { ...style.compass, show } })} />
        <SelectField label="Style" value={style.compass.style} options={COMPASS_STYLES.map((option) => ({ value: option.id, label: option.label }))} onChange={(next) => patchStyle({ compass: { ...style.compass, style: next } })} />
        <NumberField label="Size" value={style.compass.size} min={32} max={240} step={4} suffix="px" onCommit={(size) => patchStyle({ compass: { ...style.compass, size } })} />
      </Section>
      <Section title="Scale bar">
        <CheckField label="Show scale bar" checked={style.scaleBar.show} onChange={(show) => patchStyle({ scaleBar: { ...style.scaleBar, show } })} />
      </Section>
    </>
  )
}

/* ---------------- the panel ---------------- */

export default function MapInspector(props) {
  const {
    open, onClose, map, dispatch, space, day, onDay, schedules, conflicts, selection, selectedItem, onSelect,
    docs, missingDocs, calendar, onCalendar, onOpenDoc, renameRequest, calibration, onCalibrationDone,
    focusBody, onFocusBody, projectName, docPath,
  } = props
  const [tab, setTab] = useState('map')
  const [crossConflicts, setCrossConflicts] = useState(null)

  if (!open) return null

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
    }
    // Only conflicts that cross maps: this map's own are already listed.
    setCrossConflicts(crossScheduleConflicts(entries).filter((conflict) => conflict.maps[0] !== conflict.maps[1]))
  }

  let body
  if (calibration) {
    body = <CalibratePanel map={map} calibration={calibration} dispatch={dispatch} onDone={onCalibrationDone} />
  } else if (selection && selectedItem) {
    const common = { map, space, day, renameRequest }
    if (selection.kind === 'pin') body = <PinPanel {...common} pin={selectedItem} docs={docs} missing={Boolean(selectedItem.doc && missingDocs?.has(selectedItem.doc))} patch={patch} onOpenDoc={onOpenDoc} onDelete={remove} />
    else if (selection.kind === 'route') body = <RoutePanel {...common} route={selectedItem} patch={patch} onDelete={remove} onAddLabel={() => addLabel(newRouteLabel(selectedItem))} />
    else if (selection.kind === 'region') {
      body = (
        <RegionPanel
          {...common}
          region={selectedItem}
          patch={patch}
          onDelete={remove}
          onAddLabel={() => {
            const ring = selectedItem.rings[0]
            const at = [ring.reduce((sum, point) => sum + point[0], 0) / ring.length, ring.reduce((sum, point) => sum + point[1], 0) / ring.length]
            addLabel({ id: newId(), text: selectedItem.name || 'Region', at, route: null, path: null, startOffset: 0.5, size: 24 / (props.viewport?.zoom || 1), rotation: 0, font: 'serif', minZoom: 0, maxZoom: null })
          }}
        />
      )
    } else if (selection.kind === 'label') body = <LabelPanel {...common} label={selectedItem} patch={patch} onDelete={remove} />
    else if (selection.kind === 'traveler') {
      body = (
        <TravelerPanel
          {...common}
          traveler={selectedItem}
          index={map.travelers.findIndex((traveler) => traveler.id === selectedItem.id)}
          schedule={schedules.find((schedule) => schedule.travelerId === selectedItem.id)}
          conflicts={conflicts}
          docs={docs}
          calendar={calendar}
          patch={patch}
          onDelete={remove}
          onDay={onDay}
          onOpenDoc={onOpenDoc}
        />
      )
    } else if (selection.kind === 'body') {
      body = <BodyPanel map={map} body={selectedItem} patchBody={patchBody} addBody={addBody} onDelete={removeBody} focused={focusBody === selectedItem.id} onFocus={() => onFocusBody(focusBody === selectedItem.id ? null : selectedItem.id)} renameRequest={renameRequest} />
    }
  } else if (tab === 'journeys') {
    body = <JourneysTab map={map} schedules={schedules} conflicts={conflicts} calendar={calendar} onCalendar={onCalendar} onSelect={onSelect} onDay={onDay} docs={docs} addTraveler={addTraveler} onCheckAllMaps={checkAllMaps} crossConflicts={crossConflicts} />
  } else if (tab === 'travel') {
    body = <TravelTab map={map} space={space} day={day} dispatch={dispatch} />
  } else if (tab === 'style') {
    body = <StyleTab map={map} dispatch={dispatch} />
  } else {
    body = <MapTab {...props} />
  }

  const title = calibration ? 'Scale' : selection && selectedItem ? KIND_TITLES[selection.kind] : getDocDisplayName(docPath)

  return (
    <aside className="map-floating map-inspector" data-map-scrolls aria-label="Map inspector">
      <div className="map-inspector-header">
        {selection && selectedItem && !calibration ? (
          <button type="button" className="map-tool" style={{ marginLeft: 0 }} title="Back to the map" aria-label="Back to the map" onClick={() => onSelect(null)}>
            <SFIcon name="chevron.left" size={14} />
          </button>
        ) : null}
        <span>{title}</span>
        {conflicts.length ? (
          <span title={`${conflicts.length} problem${conflicts.length === 1 ? '' : 's'} in the journeys`} style={{ color: 'var(--status-warning)' }}>
            <SFIcon name="exclamationmark.triangle" size={14} />
          </span>
        ) : null}
        <button type="button" className="map-tool" title="Hide the inspector" aria-label="Hide the inspector" onClick={onClose}>
          <SFIcon name="xmark" size={14} />
        </button>
      </div>
      {!selection && !calibration ? (
        <div className="map-row" role="tablist" style={{ padding: '8px 12px 0', gap: 4 }}>
          {TABS.map((option) => (
            <button key={option.id} type="button" role="tab" aria-selected={tab === option.id} className={`map-button${tab === option.id ? ' is-primary' : ''}`} onClick={() => setTab(option.id)}>
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="map-inspector-body">{body}</div>
    </aside>
  )
}

