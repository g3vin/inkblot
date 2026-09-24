/**
 * TravelPanels.jsx — journeys and how they are made: a traveller's itinerary, the
 * story calendar, the conflicts the timeline found, the ways of travelling, the
 * terrains, and the table of distances between places.
 */
import { useMemo, useState } from 'react'
import { getDocDisplayName } from '../../lib/docKind'
import { formatDay, fromParts, normalizeCalendar, toParts } from '../../lib/map/calendar'
import { formatDistance, formatDuration, LIGHT_KMH } from '../../lib/map/mapUnits'
import { distanceMatrix } from '../../lib/map/travel'
import { mapTransports, BUILTIN_TRANSPORTS, lorentzGamma } from '../../lib/map/transports'
import { newId, pinLabel } from '../../lib/map/mapModel'
import { travelerColor, travelerName } from '../mapRender'
import { CheckField, ColorField, DocField, NumberField, Section, SelectField, Stat, TextField } from './fields'
import { describeConflict, unitFor } from '../mapOptions'

/** A day number entered the way the calendar writes dates. */
function DayField({ label, value, calendar, onCommit, allowEmpty = false, placeholder }) {
  const cal = normalizeCalendar(calendar)
  if (value === null || value === undefined) {
    return (
      <div className="map-field">
        <span>{label}</span>
        <button type="button" className="map-button" onClick={() => onCommit(0)}>{placeholder || 'Set a date'}</button>
      </div>
    )
  }
  const parts = toParts(cal, value)
  const set = (patch) => onCommit(fromParts(cal, { ...parts, ...patch }))
  return (
    <div className="map-field">
      <span>{label}</span>
      <span className="map-row" style={{ flexWrap: 'nowrap', gap: 4 }}>
        {cal.mode === 'day' ? (
          <input className="map-input" type="number" value={parts.day} step={1} onChange={(event) => set({ day: Number(event.target.value) || 1 })} aria-label="Day" />
        ) : (
          <>
            <input className="map-input" type="number" style={{ width: 52 }} value={parts.day} min={1} onChange={(event) => set({ day: Number(event.target.value) || 1 })} aria-label="Day" />
            <select className="map-input" value={parts.month} onChange={(event) => set({ month: Number(event.target.value) })} aria-label="Month">
              {(cal.mode === 'gregorian'
                ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
                : cal.custom.months.map((month) => month.name)
              ).map((name, index) => (
                <option key={name} value={index + 1}>{name.slice(0, 3)}</option>
              ))}
            </select>
            <input className="map-input" type="number" style={{ width: 64 }} value={parts.year} onChange={(event) => set({ year: Number(event.target.value) || 0 })} aria-label="Year" />
          </>
        )}
        <input
          className="map-input"
          type="time"
          style={{ width: 84 }}
          value={`${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`}
          onChange={(event) => {
            const [hour, minute] = event.target.value.split(':').map(Number)
            set({ hour: hour || 0, minute: minute || 0 })
          }}
          aria-label="Time"
        />
        {allowEmpty ? <button type="button" className="map-button" title="Leave when the previous leg arrives" onClick={() => onCommit(null)}>×</button> : null}
      </span>
    </div>
  )
}

/* ---------------- one traveller ---------------- */

export function TravelerPanel({ map, traveler, index, schedule, conflicts, docs, calendar, patch, onDelete, onDay, onOpenDoc, renameRequest }) {
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

  return (
    <>
      <Section title="Traveller">
        <DocField
          label="Character"
          value={traveler.doc}
          docs={docs.docs}
          preferred={(doc) => doc.isCharacter}
          preferredLabel="Characters"
          noneLabel="None"
          onChange={(doc) => patch({ doc })}
        />
        <TextField label="Name" value={traveler.name || ''} placeholder={traveler.doc ? getDocDisplayName(traveler.doc) : 'Traveller'} onCommit={(name) => patch({ name: name.trim() || null })} autoFocusKey={renameRequest} />
        <ColorField label="Colour" value={traveler.color} fallback={travelerColor(traveler, index)} onChange={(color) => patch({ color })} />
        {traveler.doc ? <button type="button" className="map-button" onClick={() => onOpenDoc?.(traveler.doc)}>Open “{getDocDisplayName(traveler.doc)}”</button> : null}
      </Section>

      <Section title="Starts">
        <SelectField label="At" value={traveler.startPin || ''} options={[{ value: '', label: 'Choose a place' }, ...pinOptions]} onChange={(startPin) => patch({ startPin: startPin || null })} />
        <DayField label="On" value={traveler.startDay} calendar={calendar} onCommit={(startDay) => patch({ startDay: startDay ?? 0 })} />
      </Section>

      {own.length ? (
        <Section title="Problems">
          {own.map((conflict, conflictIndex) => (
            <p key={conflictIndex} className="map-warning">
              {describeConflict(conflict, map, calendar)}{' '}
              {Number.isFinite(conflict.from) ? <button type="button" className="map-button" onClick={() => onDay(conflict.from)}>Go there</button> : null}
            </p>
          ))}
        </Section>
      ) : null}

      <Section title="Journey" actions={<button type="button" className="map-button" onClick={addLeg} disabled={map.pins.length < 2}>Add leg</button>}>
        {map.pins.length < 2 ? <p className="map-note">Place at least two places on the map to travel between.</p> : null}
        <ol className="map-list">
          {traveler.legs.map((leg, legIndex) => {
            const interval = schedule?.intervals.find((candidate) => candidate.kind === 'travel' && candidate.legId === leg.id)
            const transport = transports.find((candidate) => candidate.id === leg.transport)
            // Routes that stop at both ends first; any route can be followed, though.
            const connects = (route) => {
              const stops = route.nodes.map((node) => node.pin)
              return Boolean(leg.from && leg.to && stops.includes(leg.from) && stops.includes(leg.to))
            }
            const routes = [...map.routes.filter(connects), ...map.routes.filter((route) => !connects(route))]
            return (
              <li key={leg.id} className="map-list-item">
                <div className="map-row" style={{ justifyContent: 'space-between' }}>
                  <strong>Leg {legIndex + 1}</strong>
                  <span className="map-row">
                    <button type="button" className="map-button" disabled={legIndex === 0} title="Move earlier" onClick={() => {
                      const legs = [...traveler.legs]
                      legs.splice(legIndex - 1, 0, legs.splice(legIndex, 1)[0])
                      setLegs(legs)
                    }}>↑</button>
                    <button type="button" className="map-button is-danger" title="Remove this leg" onClick={() => setLegs(traveler.legs.filter((candidate) => candidate.id !== leg.id))}>×</button>
                  </span>
                </div>
                <SelectField label="From" value={leg.from || ''} options={[{ value: '', label: '—' }, ...pinOptions]} onChange={(from) => patchLeg(leg.id, { from: from || null })} />
                <SelectField label="To" value={leg.to || ''} options={[{ value: '', label: '—' }, ...pinOptions]} onChange={(to) => patchLeg(leg.id, { to: to || null })} />
                <SelectField
                  label="By way of"
                  value={leg.route || ''}
                  options={[{ value: '', label: map.mapKind === 'earth' ? 'The shortest way (great circle)' : map.mapKind === 'system' ? 'Direct (intercept)' : 'A straight line' }, ...routes.map((route) => ({ value: route.id, label: `${route.name || 'Unnamed route'}${connects(route) ? '' : ' (not between these)'}` }))]}
                  onChange={(route) => patchLeg(leg.id, { route: route || null })}
                />
                <SelectField
                  label="Travelling by"
                  value={leg.transport}
                  options={[
                    ...(map.transports.length ? [{ group: 'This map’s', options: map.transports.map((option) => ({ value: option.id, label: option.name })) }] : []),
                    { group: 'Standard', options: BUILTIN_TRANSPORTS.filter((option) => !map.transports.some((own) => own.id === option.id)).map((option) => ({ value: option.id, label: option.name })) },
                  ]}
                  onChange={(next) => patchLeg(leg.id, { transport: next })}
                />
                <DayField
                  label="Leaves"
                  value={leg.departDay}
                  calendar={calendar}
                  allowEmpty
                  placeholder="When the last leg arrives"
                  onCommit={(departDay) => patchLeg(leg.id, { departDay })}
                />
                {leg.departDay === null ? (
                  <NumberField label="Rests first" value={leg.restDays} min={0} step={0.25} suffix="days" onCommit={(restDays) => patchLeg(leg.id, { restDays })} />
                ) : null}
                {interval ? (
                  <>
                    <Stat label="Distance">{formatDistance(interval.profile.km, unitFor(map), map)}</Stat>
                    <Stat label="Takes">{interval.profile.impassable ? 'impassable ground' : formatDuration(interval.to - interval.from)}</Stat>
                    {transport?.fractionC ? <Stat label="Aboard, only">{formatDuration(interval.properDays)} (γ {lorentzGamma(transport.fractionC).toFixed(3)})</Stat> : null}
                    {interval.approximate ? <p className="map-note">The target moves faster than this can close on it — the time is for the distance at departure.</p> : null}
                    <Stat label="Arrives">
                      <button type="button" className="map-button" onClick={() => onDay(interval.to)}>{formatDay(calendar, interval.to, { withTime: true })}</button>
                    </Stat>
                  </>
                ) : null}
              </li>
            )
          })}
        </ol>
      </Section>
      <Section title="">
        <button type="button" className="map-button is-danger" onClick={onDelete}>Delete traveller</button>
      </Section>
    </>
  )
}

/* ---------------- journeys: every traveller, the calendar, conflicts ---------------- */

export function JourneysTab({ map, schedules, conflicts, calendar, onCalendar, onSelect, onDay, docs, addTraveler, onCheckAllMaps, crossConflicts }) {
  const [editingCalendar, setEditingCalendar] = useState(false)
  const cal = normalizeCalendar(calendar)
  return (
    <>
      <Section title="Travellers" actions={<button type="button" className="map-button" onClick={addTraveler} disabled={!map.pins.length}>Add</button>}>
        {!map.travelers.length ? (
          <p className="map-note">Drag a character’s document from the file tree onto the map to send them travelling — or add one here.</p>
        ) : null}
        {map.travelers.map((traveler, index) => {
          const schedule = schedules.find((candidate) => candidate.travelerId === traveler.id)
          return (
            <button key={traveler.id} type="button" className="map-list-item map-button" style={{ width: '100%', textAlign: 'left' }} onClick={() => onSelect('traveler', traveler.id)}>
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: travelerColor(traveler, index), marginRight: 8 }} />
              <strong>{travelerName(traveler)}</strong>
              <span className="map-note" style={{ display: 'block', margin: '2px 0 0' }}>
                {traveler.legs.length} leg{traveler.legs.length === 1 ? '' : 's'}
                {schedule && traveler.legs.length ? ` · ${formatDay(cal, schedule.start)} → ${formatDay(cal, schedule.end)}` : ''}
              </span>
            </button>
          )
        })}
        {!docs.docs.some((doc) => doc.isCharacter) ? <p className="map-note">Documents in a Characters folder are offered as travellers.</p> : null}
      </Section>

      <Section title="Problems" actions={<button type="button" className="map-button" onClick={onCheckAllMaps} title="Check this project's other maps too">Check all maps</button>}>
        {!conflicts.length && !crossConflicts?.length ? <p className="map-note">No one is in two places at once.</p> : null}
        {[...conflicts, ...(crossConflicts || [])].map((conflict, index) => (
          <p key={index} className="map-warning">
            {describeConflict(conflict, map, cal)}
            {conflict.maps && conflict.maps[0] !== conflict.maps[1] ? ` (on ${conflict.maps.map((path) => getDocDisplayName(path)).join(' and ')})` : ''}{' '}
            {Number.isFinite(conflict.from) ? <button type="button" className="map-button" onClick={() => onDay(conflict.from)}>Go there</button> : null}
          </p>
        ))}
      </Section>

      <Section title="Calendar" actions={<button type="button" className="map-button" onClick={() => setEditingCalendar((open) => !open)}>{editingCalendar ? 'Done' : 'Edit'}</button>}>
        <p className="map-note">Shared by every map in this project. Day 1 of the story is {formatDay(cal, 0)}.</p>
        {editingCalendar ? (
          <>
            <SelectField
              label="Dates as"
              value={cal.mode}
              options={[{ value: 'day', label: 'Story days (Day 1, Day 2…)' }, { value: 'gregorian', label: 'Real dates' }, { value: 'custom', label: 'My world’s calendar' }]}
              onChange={(mode) => onCalendar({ ...cal, mode })}
            />
            {cal.mode === 'gregorian' ? (
              <TextField label="Story begins" value={cal.gregorianEpoch} placeholder="1850-03-01" onCommit={(gregorianEpoch) => onCalendar({ ...cal, gregorianEpoch })} />
            ) : null}
            {cal.mode === 'custom' ? (
              <>
                <TextField
                  label="Months"
                  multiline
                  value={cal.custom.months.map((month) => `${month.name}:${month.days}`).join(', ')}
                  onCommit={(text) => onCalendar({
                    ...cal,
                    custom: {
                      ...cal.custom,
                      months: text.split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
                        const [name, days] = entry.split(':')
                        return { name: name.trim(), days: Math.max(1, Math.round(Number(days) || 30)) }
                      }),
                    },
                  })}
                />
                <TextField label="Weekdays" value={cal.custom.weekdays.join(', ')} placeholder="optional, comma separated" onCommit={(text) => onCalendar({ ...cal, custom: { ...cal.custom, weekdays: text.split(',').map((name) => name.trim()).filter(Boolean) } })} />
                <NumberField label="First year" value={cal.custom.yearZero} step={1} onCommit={(yearZero) => onCalendar({ ...cal, custom: { ...cal.custom, yearZero: Math.round(yearZero) } })} />
                <TextField label="Era" value={cal.custom.era} placeholder="e.g. AR" onCommit={(era) => onCalendar({ ...cal, custom: { ...cal.custom, era } })} />
                <CheckField label="Leap years" checked={Boolean(cal.custom.leap)} onChange={(on) => onCalendar({ ...cal, custom: { ...cal.custom, leap: on ? { every: 4, days: 1, month: 1 } : null } })} />
                {cal.custom.leap ? (
                  <NumberField label="Every" value={cal.custom.leap.every} min={1} step={1} suffix="years, +1 day" onCommit={(every) => onCalendar({ ...cal, custom: { ...cal.custom, leap: { ...cal.custom.leap, every: Math.round(every) } } })} />
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </Section>
    </>
  )
}

/* ---------------- travel: transports, terrains, the distance table ---------------- */

export function TravelTab({ map, space, day, dispatch }) {
  const [matrixTransport, setMatrixTransport] = useState(map.mapKind === 'system' ? 'light10' : 'horse')
  const [showMatrix, setShowMatrix] = useState(false)
  const pins = map.pins.slice(0, 14)
  const matrix = useMemo(
    () => (showMatrix && pins.length >= 2 ? distanceMatrix(map, space, pins.map((pin) => pin.id), matrixTransport, day) : null),
    [day, map, matrixTransport, pins, showMatrix, space]
  )

  const setTransports = (transports) => dispatch({ type: 'map/patch', patch: { transports } })
  const patchTransport = (id, patch) => setTransports(map.transports.map((transport) => (transport.id === id ? { ...transport, ...patch } : transport)))
  const setTerrains = (terrains) => dispatch({ type: 'map/patch', patch: { terrains } })
  const patchTerrain = (id, patch) => setTerrains(map.terrains.map((terrain) => (terrain.id === id ? { ...terrain, ...patch } : terrain)))

  return (
    <>
      <Section title="Distances" actions={<button type="button" className="map-button" onClick={() => setShowMatrix((open) => !open)}>{showMatrix ? 'Hide' : 'Show'}</button>}>
        {showMatrix ? (
          pins.length < 2 ? <p className="map-note">Place two or more places to compare.</p> : (
            <>
              <SelectField label="Travelling by" value={matrixTransport} options={mapTransports(map).map((transport) => ({ value: transport.id, label: transport.name }))} onChange={setMatrixTransport} />
              <div style={{ overflowX: 'auto' }} data-map-scrolls>
                <table className="map-table">
                  <thead>
                    <tr>
                      <th />
                      {pins.map((pin) => <th key={pin.id} title={pinLabel(pin, getDocDisplayName)}>{pinLabel(pin, getDocDisplayName).slice(0, 10)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {pins.map((pin, row) => (
                      <tr key={pin.id}>
                        <td>{pinLabel(pin, getDocDisplayName)}</td>
                        {matrix?.[row].map((cell, column) => (
                          <td key={column} title={cell.viaRoute ? 'Along a route' : 'Straight'} style={cell.viaRoute ? { fontWeight: 600 } : undefined}>
                            {row === column ? '—' : (
                              <>
                                {formatDistance(cell.km, unitFor(map), map)}
                                <br />
                                <span className="map-note">{cell.impassable ? 'impassable' : formatDuration(cell.days)}</span>
                              </>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="map-note">Bold figures follow a route; the rest are as the crow flies.</p>
            </>
          )
        ) : <p className="map-note">How far every place is from every other, and how long it takes.</p>}
      </Section>

      <Section
        title="Ways of travelling"
        actions={
          <button type="button" className="map-button" onClick={() => setTransports([...map.transports, {
            id: newId(), name: map.mapKind === 'system' ? 'Torch ship' : 'Wyvern', kmh: map.mapKind === 'system' ? 0 : 60,
            hoursPerDay: map.mapKind === 'system' ? 24 : 6, medium: map.mapKind === 'system' ? 'space' : 'air', fractionC: map.mapKind === 'system' ? 0.02 : null,
          }])}>Add</button>
        }
      >
        {map.transports.map((transport) => (
          <div key={transport.id} className="map-list-item">
            <TextField label="Name" value={transport.name} onCommit={(name) => patchTransport(transport.id, { name })} />
            <SelectField
              label="Moves on"
              value={transport.medium}
              options={[{ value: 'land', label: 'Land' }, { value: 'water', label: 'Water' }, { value: 'air', label: 'Air' }, { value: 'space', label: 'Space' }]}
              onChange={(medium) => patchTransport(transport.id, { medium })}
            />
            {transport.medium === 'space' ? (
              <NumberField label="Speed" value={transport.fractionC ? Math.round(transport.fractionC * 1e5) / 1e3 : null} min={0.0001} max={99.9999} step="any" suffix="% of c" allowEmpty onCommit={(percent) => patchTransport(transport.id, { fractionC: percent ? percent / 100 : null, kmh: percent ? 0 : transport.kmh || 40000 })} />
            ) : null}
            {!transport.fractionC ? (
              <NumberField label="Speed" value={transport.kmh} min={0.01} step="any" suffix="km/h" onCommit={(kmh) => patchTransport(transport.id, { kmh })} />
            ) : (
              <Stat label="That is">{`${Math.round(transport.fractionC * LIGHT_KMH).toLocaleString('en-US')} km/h`}</Stat>
            )}
            <NumberField label="Moving for" value={transport.hoursPerDay} min={0.5} max={24} step={0.5} suffix="hours a day" onCommit={(hoursPerDay) => patchTransport(transport.id, { hoursPerDay })} />
            <button type="button" className="map-button is-danger" onClick={() => setTransports(map.transports.filter((candidate) => candidate.id !== transport.id))}>Remove</button>
          </div>
        ))}
        <p className="map-note">
          Standard ways — walking {BUILTIN_TRANSPORTS[0].kmh} km/h for {BUILTIN_TRANSPORTS[0].hoursPerDay} h a day, horseback, carts, ships, trains, cars, aircraft, rockets and fractions of light speed — are always available. Give one of yours the same name to change it on this map.
        </p>
      </Section>

      {map.mapKind !== 'system' ? (
        <Section
          title="Terrain"
          actions={<button type="button" className="map-button" onClick={() => setTerrains([...map.terrains, { id: newId(), name: 'New terrain', multipliers: { '*land': 0.5 }, fill: '#8a9a5b', hatch: 'none' }])}>Add</button>}
        >
          <p className="map-note">Paint a region with a terrain and everything crossing it goes at that fraction of its speed: 1 is normal, 0.5 half, 0 impassable.</p>
          {map.terrains.map((terrain) => (
            <details key={terrain.id} className="map-list-item">
              <summary>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: terrain.fill || '#888', marginRight: 6 }} />
                {terrain.name}
              </summary>
              <TextField label="Name" value={terrain.name} onCommit={(name) => patchTerrain(terrain.id, { name })} />
              {[['*land', 'On foot or wheels'], ['*water', 'Boats'], ['*air', 'Flying'], ['walk', 'Walking'], ['horse', 'Horses'], ['cart', 'Carts'], ['car', 'Cars']].map(([key, label]) => (
                <NumberField
                  key={key}
                  label={label}
                  value={Number.isFinite(terrain.multipliers[key]) ? terrain.multipliers[key] : null}
                  min={0}
                  max={10}
                  step={0.05}
                  suffix="×"
                  allowEmpty
                  onCommit={(value) => {
                    const multipliers = { ...terrain.multipliers }
                    if (value === null) delete multipliers[key]
                    else multipliers[key] = value
                    patchTerrain(terrain.id, { multipliers })
                  }}
                />
              ))}
              <ColorField label="Colour" value={terrain.fill} fallback="#8a9a5b" onChange={(fill) => patchTerrain(terrain.id, { fill })} />
              <button type="button" className="map-button is-danger" onClick={() => setTerrains(map.terrains.filter((candidate) => candidate.id !== terrain.id))}>Remove</button>
            </details>
          ))}
        </Section>
      ) : null}
    </>
  )
}
