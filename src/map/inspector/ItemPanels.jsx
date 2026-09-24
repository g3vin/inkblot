/**
 * ItemPanels.jsx — the inspector for one selected thing: a place, a route, a region,
 * a label or a body of a star system. (Travellers have their own, TravelerPanel.)
 */
import { useMemo } from 'react'
import { getDocDisplayName } from '../../lib/docKind'
import { lineKm, resolvePin, routeCoords } from '../../lib/map/mapSpace'
import { formatArea, formatDistance, formatDuration } from '../../lib/map/mapUnits'
import { legTravel } from '../../lib/map/travel'
import { mapTransports } from '../../lib/map/transports'
import { HATCHES, LINE_DASHES } from '../../lib/map/mapModel'
import { STAR_PRESETS, massToLuminosity, starPreset, temperatureToColor } from '../../lib/map/stars'
import { bodyMass, orbitPeriod } from '../../lib/map/orbits'
import { newBody } from '../../lib/map/systemPresets'
import { PinGlyph } from '../mapGlyphs'
import { PIN_ICONS, unitFor } from '../mapOptions'
import { CheckField, ColorField, DocField, NumberField, Section, SelectField, Stat, TextField } from './fields'

const HATCH_LABELS = { none: 'None', diagonal: 'Diagonal lines', cross: 'Cross-hatch', dots: 'Dots', waves: 'Waves', mountains: 'Mountains' }
const DASH_LABELS = { solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted', inked: 'Inked (hand-drawn)', rough: 'Rough (sketchy)' }

function DeleteButton({ onDelete, label = 'Delete' }) {
  return (
    <Section title="">
      <button type="button" className="map-button is-danger" onClick={onDelete}>{label}</button>
    </Section>
  )
}

/* ---------------- places ---------------- */

export function PinPanel({ map, pin, space, day, docs, missing, patch, onOpenDoc, onDelete, renameRequest }) {
  const at = resolvePin(map, space, pin, day)
  const coordinates = at
    ? map.mapKind === 'earth'
      ? `${Math.abs(at[1]).toFixed(3)}° ${at[1] >= 0 ? 'N' : 'S'}, ${Math.abs(at[0]).toFixed(3)}° ${at[0] >= 0 ? 'E' : 'W'}`
      : map.mapKind === 'system'
        ? `${Math.hypot(at[0], at[1]).toFixed(3)} AU from the centre`
        : `${Math.round(at[0])}, ${Math.round(at[1])}`
    : '—'
  return (
    <>
      <Section title="Place">
        <TextField
          label="Name"
          value={pin.name || ''}
          placeholder={pin.doc ? getDocDisplayName(pin.doc) : 'Untitled place'}
          onCommit={(name) => patch({ name: name.trim() || null })}
          autoFocusKey={renameRequest}
        />
        <DocField
          label="Document"
          value={pin.doc}
          docs={docs.docs}
          preferred={(doc) => doc.isLocation}
          preferredLabel="Locations"
          noneLabel="None — just a place on the map"
          onChange={(doc) => patch({ doc })}
        />
        {missing ? <p className="map-warning">The linked document has been deleted or moved. Choose it again above.</p> : null}
        {pin.doc && !missing ? (
          <button type="button" className="map-button" onClick={() => onOpenDoc?.(pin.doc)}>Open “{getDocDisplayName(pin.doc)}”</button>
        ) : null}
        {!docs.docs.some((doc) => doc.isLocation) ? (
          <p className="map-note">Tip: documents in a folder named Settings, Locations or Places are offered first here — and can be dragged straight onto the map.</p>
        ) : null}
      </Section>
      <Section title="Marker">
        <div className="map-row" role="radiogroup" aria-label="Marker">
          {PIN_ICONS.map((icon) => (
            <button
              key={icon.id}
              type="button"
              title={icon.label}
              aria-label={icon.label}
              aria-checked={pin.icon === icon.id}
              role="radio"
              className={`map-tool${pin.icon === icon.id ? ' is-active' : ''}`}
              style={{ width: 34, height: 40 }}
              onClick={() => patch({ icon: icon.id })}
            >
              <svg width="30" height="36" viewBox="-15 -31 30 36" style={{ overflow: 'visible' }}>
                <PinGlyph icon={icon.id} color={pin.color} />
              </svg>
            </button>
          ))}
        </div>
        <ColorField label="Colour" value={pin.color} onChange={(color) => patch({ color })} />
        {map.mapKind === 'system' ? (
          <SelectField
            label="Rides on"
            value={pin.body || ''}
            options={[{ value: '', label: 'Nothing — fixed in space' }, ...map.system.bodies.filter((body) => body.kind !== 'barycenter').map((body) => ({ value: body.id, label: body.name }))]}
            onChange={(body) => patch(body ? { body, at: null } : { body: null, at: at || [0, 0] })}
          />
        ) : null}
        <p className="map-note">{coordinates}</p>
      </Section>
      <DeleteButton onDelete={onDelete} />
    </>
  )
}

/* ---------------- routes ---------------- */

/** Transports worth showing a time for on this kind of map. */
const transportsFor = (map) => {
  const all = mapTransports(map)
  if (map.mapKind === 'system') return all.filter((transport) => transport.medium === 'space')
  return all.filter((transport) => transport.medium !== 'space')
}

export function RoutePanel({ map, route, space, day, patch, onDelete, onAddLabel, renameRequest }) {
  const coords = routeCoords(map, space, route, day)
  const km = lineKm(space, coords)
  const first = route.nodes[0]?.pin
  const last = route.nodes[route.nodes.length - 1]?.pin
  const times = useMemo(
    () =>
      transportsFor(map).map((transport) => ({
        transport,
        travel: legTravel(map, space, { route: route.id, from: first || null, to: last || null, transport: transport.id }, day),
      })),
    [day, first, last, map, route.id, space]
  )
  return (
    <>
      <Section title="Route">
        <TextField label="Name" value={route.name || ''} placeholder="Unnamed route" onCommit={(name) => patch({ name: name.trim() || null })} autoFocusKey={renameRequest} />
        <Stat label="Length">{formatDistance(km, unitFor(map), map)}</Stat>
        <Stat label="Stops">{route.nodes.length}</Stat>
        <CheckField label="Smooth curve" checked={route.smooth === 'catmullRom'} onChange={(on) => patch({ smooth: on ? 'catmullRom' : 'linear' })} />
        <p className="map-note">Drag a stop to move it (onto a place to route through it); drag a faint midpoint to add one; double-click the line to add a stop there.</p>
      </Section>
      <Section title="Line">
        <ColorField label="Colour" value={route.style.stroke} fallback="#b3462f" onChange={(stroke) => patch({ style: { ...route.style, stroke } })} />
        <NumberField label="Width" value={route.style.width} min={0.5} max={20} step={0.5} suffix="px" onCommit={(width) => patch({ style: { ...route.style, width } })} />
        <SelectField label="Style" value={route.style.dash} options={LINE_DASHES.map((dash) => ({ value: dash, label: DASH_LABELS[dash] }))} onChange={(dash) => patch({ style: { ...route.style, dash } })} />
        <CheckField label="Arrow at end" checked={route.style.arrow} onChange={(arrow) => patch({ style: { ...route.style, arrow } })} />
        <button type="button" className="map-button" onClick={onAddLabel}>Write its name along it</button>
      </Section>
      <Section title="How long it takes">
        <table className="map-table">
          <tbody>
            {times.map(({ transport, travel }) => (
              <tr key={transport.id}>
                <td>{transport.name}</td>
                <td>{travel.profile.impassable ? 'impassable' : formatDuration(travel.profile.days)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="map-note">Terrain the route crosses is counted: regions with a terrain slow or speed each way of travelling. Times assume each transport’s usual hours on the move per day.</p>
      </Section>
      <DeleteButton onDelete={onDelete} />
    </>
  )
}

/* ---------------- regions ---------------- */

export function RegionPanel({ map, region, space, patch, onDelete, onAddLabel, renameRequest }) {
  const terrain = map.terrains.find((candidate) => candidate.id === region.terrain)
  return (
    <>
      <Section title="Region">
        <TextField label="Name" value={region.name || ''} placeholder="Unnamed region" onCommit={(name) => patch({ name: name.trim() || null })} autoFocusKey={renameRequest} />
        <Stat label="Area">{formatArea(space.areaKm2(region.rings), unitFor(map) === 'auto' ? 'km' : unitFor(map), map)}</Stat>
        <SelectField
          label="Terrain"
          value={region.terrain || ''}
          options={[{ value: '', label: 'None — just a territory' }, ...map.terrains.map((candidate) => ({ value: candidate.id, label: candidate.name }))]}
          onChange={(next) => patch({ terrain: next || null })}
        />
        {terrain ? <p className="map-note">Travel across it is slowed or sped by the {terrain.name.toLowerCase()} terrain (edit terrains under Travel).</p> : null}
      </Section>
      <Section title="Look">
        <ColorField label="Fill" value={region.fill} fallback={terrain?.fill || '#6d9c5a'} onChange={(fill) => patch({ fill })} />
        <ColorField label="Edge" value={region.stroke} fallback={region.fill || terrain?.fill || '#6d9c5a'} onChange={(stroke) => patch({ stroke })} />
        <SelectField label="Hatching" value={region.hatch} options={HATCHES.map((hatch) => ({ value: hatch, label: HATCH_LABELS[hatch] }))} onChange={(hatch) => patch({ hatch })} />
        <button type="button" className="map-button" onClick={onAddLabel}>Label it</button>
      </Section>
      <DeleteButton onDelete={onDelete} />
    </>
  )
}

/* ---------------- labels ---------------- */

export function LabelPanel({ map, label, patch, onDelete, renameRequest }) {
  return (
    <>
      <Section title="Label">
        <TextField label="Text" value={label.text} onCommit={(text) => patch({ text })} autoFocusKey={renameRequest} />
        <NumberField label="Size" value={Math.round(label.size * 100) / 100} min={0.001} step="any" onCommit={(size) => patch({ size })} title="In map units — the label grows and shrinks with the map." />
        <SelectField
          label="Typeface"
          value={label.font}
          options={[
            { value: 'serif', label: 'Map serif' },
            { value: 'sans', label: 'Plain sans' },
            { value: "'Snell Roundhand', 'Apple Chancery', cursive", label: 'Calligraphic' },
            { value: "'Trajan Pro', 'Cinzel', 'Copperplate', serif", label: 'Engraved capitals' },
          ]}
          onChange={(font) => patch({ font })}
        />
        <SelectField
          label="Follows"
          value={label.route || ''}
          options={[{ value: '', label: label.path ? 'Its own curve' : 'Nothing — straight text' }, ...map.routes.map((route) => ({ value: route.id, label: route.name || 'Unnamed route' }))]}
          onChange={(route) => patch(route ? { route } : { route: null, at: label.at || label.path?.[0] || null })}
        />
        {label.route || label.path ? (
          <NumberField label="Along" value={Math.round(label.startOffset * 100)} min={0} max={100} step={1} suffix="%" onCommit={(value) => patch({ startOffset: value / 100 })} />
        ) : (
          <NumberField label="Rotation" value={label.rotation} min={-180} max={180} step={1} suffix="°" onCommit={(rotation) => patch({ rotation })} />
        )}
        <NumberField label="Show from" value={label.minZoom} min={0} step="any" suffix="× zoom" allowEmpty onCommit={(minZoom) => patch({ minZoom: minZoom ?? 0 })} title="Hide the label when zoomed out further than this." />
        <NumberField label="Hide past" value={label.maxZoom} min={0} step="any" suffix="× zoom" allowEmpty onCommit={(maxZoom) => patch({ maxZoom })} title="Hide the label when zoomed in closer than this." />
      </Section>
      <DeleteButton onDelete={onDelete} />
    </>
  )
}

/* ---------------- star-system bodies ---------------- */

const BODY_KIND_LABELS = { star: 'Star', planet: 'Planet', dwarf: 'Dwarf planet', moon: 'Moon', belt: 'Belt', station: 'Station', barycenter: 'Barycentre' }

export function BodyPanel({ map, body, patchBody, addBody, onDelete, focused, onFocus, renameRequest }) {
  const bodies = useMemo(() => new Map(map.system.bodies.map((candidate) => [candidate.id, candidate])), [map.system.bodies])
  const period = body.orbit ? orbitPeriod(body, bodies) : null
  const orbit = body.orbit
  const patchOrbit = (next) => patchBody({ orbit: { ...(orbit || { aAU: 1, e: 0, periapsisDeg: 0, meanAnomalyDeg: 0, periodDays: null, retrograde: false }), ...next } })
  const setPreset = (id) => {
    const preset = starPreset(id)
    patchBody({ massSun: preset.massSun, radiusKm: preset.radiusSun * 695700, star: { spectral: preset.id, temperatureK: preset.temperatureK, luminositySun: preset.luminositySun } })
  }
  return (
    <>
      <Section title={BODY_KIND_LABELS[body.kind] || 'Body'}>
        <TextField label="Name" value={body.name} onCommit={(name) => patchBody({ name })} autoFocusKey={renameRequest} />
        <SelectField
          label="Orbits"
          value={body.parent || ''}
          options={[{ value: '', label: 'Nothing — the centre' }, ...map.system.bodies.filter((candidate) => candidate.id !== body.id).map((candidate) => ({ value: candidate.id, label: candidate.name || BODY_KIND_LABELS[candidate.kind] }))]}
          onChange={(parent) => patchBody({ parent: parent || null })}
        />
        {body.kind !== 'star' && body.kind !== 'barycenter' && body.kind !== 'belt' ? (
          <ColorField label="Colour" value={body.color} fallback="#9aa7b8" onChange={(color) => patchBody({ color })} />
        ) : null}
        <button type="button" className="map-button" onClick={onFocus}>{focused ? 'Stop following' : 'Centre the view on it'}</button>
      </Section>

      {body.kind === 'star' ? (
        <Section title="Star">
          <SelectField label="Type" value={body.star?.spectral || 'G2V'} options={STAR_PRESETS.map((preset) => ({ value: preset.id, label: preset.name }))} onChange={setPreset} />
          <NumberField label="Temperature" value={body.star?.temperatureK ?? 5772} min={0} step={100} suffix="K" onCommit={(temperatureK) => patchBody({ star: { ...body.star, temperatureK }, color: null })} />
          <NumberField label="Mass" value={body.massSun ?? 1} min={0.001} step="any" suffix="M☉" onCommit={(massSun) => patchBody({ massSun })} />
          <NumberField label="Brightness" value={body.star?.luminositySun ?? 1} min={0} step="any" suffix="L☉" onCommit={(luminositySun) => patchBody({ star: { ...body.star, luminositySun } })} />
          <button type="button" className="map-button" onClick={() => patchBody({ star: { ...body.star, luminositySun: Math.round(massToLuminosity(body.massSun ?? 1) * 1e4) / 1e4 } })}>
            Brightness from mass (main sequence)
          </button>
          <p className="map-note">
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: temperatureToColor(body.star?.temperatureK ?? 5772), marginRight: 6 }} />
            The green rings mark where liquid water could last on a planet’s surface.
          </p>
        </Section>
      ) : null}

      {body.kind === 'belt' ? (
        <Section title="Belt">
          <NumberField label="Inner edge" value={body.belt?.innerAU ?? 2} min={0.0001} step="any" suffix="AU" onCommit={(innerAU) => patchBody({ belt: { ...body.belt, innerAU } })} />
          <NumberField label="Outer edge" value={body.belt?.outerAU ?? 3} min={0.0001} step="any" suffix="AU" onCommit={(outerAU) => patchBody({ belt: { ...body.belt, outerAU } })} />
        </Section>
      ) : null}

      {body.kind !== 'belt' && body.parent ? (
        <Section title="Orbit">
          <NumberField label="Distance" value={orbit?.aAU ?? 1} min={0.00001} step="any" suffix="AU" title="The orbit's semi-major axis." onCommit={(aAU) => patchOrbit({ aAU })} />
          <NumberField label="Eccentricity" value={orbit?.e ?? 0} min={0} max={0.99} step={0.01} title="0 is a circle; toward 1, a long ellipse." onCommit={(e) => patchOrbit({ e })} />
          <NumberField label="Periapsis at" value={orbit?.periapsisDeg ?? 0} min={-360} max={360} step={1} suffix="°" onCommit={(periapsisDeg) => patchOrbit({ periapsisDeg })} />
          <NumberField label="Start angle" value={orbit?.meanAnomalyDeg ?? 0} min={-360} max={360} step={1} suffix="°" title="Where it is on day 0." onCommit={(meanAnomalyDeg) => patchOrbit({ meanAnomalyDeg })} />
          <NumberField label="Year length" value={orbit?.periodDays ?? null} min={0.001} step="any" suffix="days" allowEmpty title="Leave empty to work it out from the masses (Kepler's third law)." onCommit={(periodDays) => patchOrbit({ periodDays })} />
          {period ? <Stat label="Its year">{`${period >= 700 ? `${(period / 365.25).toFixed(2)} Earth years` : `${period.toFixed(period < 10 ? 2 : 1)} days`}`}</Stat> : null}
          <CheckField label="Retrograde" checked={orbit?.retrograde} onChange={(retrograde) => patchOrbit({ retrograde })} />
          {body.kind !== 'star' ? (
            <NumberField label="Mass" value={body.massSun ? Math.round(body.massSun * 332946 * 1e4) / 1e4 : null} min={0} step="any" suffix="Earths" allowEmpty onCommit={(earths) => patchBody({ massSun: earths ? earths / 332946 : null })} />
          ) : null}
          <p className="map-note">Weight of what it orbits: {bodyMass(bodies.get(body.parent), bodies).toPrecision(3)} M☉</p>
        </Section>
      ) : null}

      <Section title="Add">
        <div className="map-row">
          {body.kind === 'star' || body.kind === 'barycenter' ? (
            <>
              <button type="button" className="map-button" onClick={() => addBody(newBody('planet', body.id, 1))}>Planet</button>
              <button type="button" className="map-button" onClick={() => addBody(newBody('dwarf', body.id, 40))}>Dwarf planet</button>
              <button type="button" className="map-button" onClick={() => addBody(newBody('belt', body.id, 2.5))}>Belt</button>
              <button type="button" className="map-button" onClick={() => addBody(newBody('star', body.id, 40))}>Companion star</button>
            </>
          ) : null}
          {body.kind === 'planet' || body.kind === 'dwarf' ? (
            <>
              <button type="button" className="map-button" onClick={() => addBody(newBody('moon', body.id, 0.003))}>Moon</button>
              <button type="button" className="map-button" onClick={() => addBody(newBody('station', body.id, 0.0003))}>Station</button>
            </>
          ) : null}
        </div>
      </Section>
      <DeleteButton onDelete={onDelete} label="Delete (and what orbits it directly)" />
    </>
  )
}
