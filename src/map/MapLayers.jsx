/**
 * MapLayers.jsx — everything a map draws, in world coordinates.
 *
 * One pure renderer, used by the editor, by a map's thumbnail on a canvas, and by
 * export — so what you see is what you get, and there is one renderer to test.
 * Nothing in here handles a pointer; items carry `data-map-item` / `data-map-kind`
 * and MapSurface hit-tests by delegation. Nothing uses `foreignObject` either, which
 * would taint the canvas a PNG export draws into.
 *
 * Paint order is the order below: the ground (sheet, picture, the Earth, a star
 * system), then regions, routes, labels, pins and, on top, travellers.
 */
import { memo, useEffect, useMemo, useState } from 'react'
import { getDocDisplayName } from '../lib/docKind'
import { pathData, catmullRomSample } from '../lib/map/mapGeometry'
import { measuredLine, resolvePin, routeCoords } from '../lib/map/mapSpace'
import { pinLabel } from '../lib/map/mapModel'
import { orbitPath } from '../lib/map/orbits'
import { runFor } from '../lib/map/nbody'
import { habitableZoneAU, temperatureToColor } from '../lib/map/stars'
import { projectedEarth } from '../lib/map/earthData'
import { hashSeed, INKED_STYLE, ROUGH_STYLE, roughenPath } from '../lib/map/roughen'
import { travelerPositionAt } from '../lib/map/timeline'
import { useAssetUrl } from '../canvas/useAssetUrl'
import { PinGlyph } from './mapGlyphs'
import { initials, labelNeedsFlip, linePath, ringsPath, travelerColor, travelerName } from './mapRender'
import { inkColor } from '../lib/palette'
import { MAP_DEFAULT_COLORS } from '../lib/map/mapColors'

const DASHES = { solid: null, dashed: '10 6', dotted: '1 6', inked: null, rough: null }

/* ---------------- the ground ---------------- */

function PlaneGround({ map, projector, projectName, inlineAssets }) {
  const liveImageUrl = useAssetUrl(projectName, inlineAssets ? null : map.background.image)
  const liveTraceUrl = useAssetUrl(projectName, inlineAssets ? null : map.background.trace)
  // An export has no time for effects: it is handed the pictures already read.
  const imageUrl = inlineAssets ? inlineAssets.image : liveImageUrl
  const traceUrl = inlineAssets ? inlineAssets.trace : liveTraceUrl
  const { width, height } = projector.bounds
  const gridStep = map.mapKind === 'blank' ? Math.max(50, Math.round(Math.min(width, height) / 12 / 50) * 50) : 0
  const grid = []
  if (gridStep) {
    for (let x = gridStep; x < width; x += gridStep) grid.push(<line key={`x${x}`} className="map-grid-line" x1={x} y1={0} x2={x} y2={height} />)
    for (let y = gridStep; y < height; y += gridStep) grid.push(<line key={`y${y}`} className="map-grid-line" x1={0} y1={y} x2={width} y2={y} />)
  }
  return (
    <g className="map-ground">
      <rect className="map-sheet" x={0} y={0} width={width} height={height} />
      {grid}
      {imageUrl && map.background.showImage !== false ? (
        <image href={imageUrl} x={0} y={0} width={width} height={height} opacity={map.background.opacity} preserveAspectRatio="none" />
      ) : null}
      {traceUrl ? <image href={traceUrl} x={0} y={0} width={width} height={height} preserveAspectRatio="none" /> : null}
    </g>
  )
}

const EarthGround = memo(function EarthGround({ map, projector, level, onCountries, staticPaths }) {
  const [livePaths, setPaths] = useState(null)
  const paths = staticPaths || livePaths
  useEffect(() => {
    if (staticPaths) return undefined
    let cancelled = false
    projectedEarth(projector, level).then((result) => {
      if (cancelled) return
      setPaths(result)
      onCountries?.(result.countries)
    })
    return () => {
      cancelled = true
    }
  }, [level, projector, onCountries, staticPaths])

  return (
    <g className="map-ground map-earth">
      <path className="map-earth-sphere" d={paths?.sphere || projector.path({ type: 'Sphere' }) || ''} />
      {map.earth.graticule && paths ? <path className="map-earth-graticule" d={paths.graticule} /> : null}
      {paths ? <path className="map-earth-land" d={paths.land} /> : null}
      {map.earth.borders && paths ? <path className="map-earth-borders" d={paths.borders} /> : null}
      <path className="map-earth-outline" d={paths?.sphere || ''} />
    </g>
  )
})

/** A circle of `radius` AU around `centre`, drawn through the projector. */
function circlePath(projector, centre, radius) {
  const ring = []
  for (let step = 0; step <= 96; step += 1) {
    const angle = (step / 96) * Math.PI * 2
    ring.push(projector.toWorld([centre[0] + Math.cos(angle) * radius, centre[1] + Math.sin(angle) * radius]))
  }
  return pathData(ring, true)
}

/**
 * The rings drawn for one body: around its parent, its orbit or a belt's edges
 * (`around: 'parent'`); around itself, a star's habitable zone (`around: 'self'`).
 */
function bodyRings(body, byId, projector, positions, around) {
  const out = []
  if (around === 'self') {
    if (body.kind !== 'star' || !(body.star?.luminositySun > 0)) return out
    const zone = habitableZoneAU(body.star.luminositySun)
    const at = positions.get(body.id) || [0, 0]
    if (zone) {
      for (const radius of zone) out.push(<path key={`hz-${body.id}-${radius}`} className="map-habitable" d={circlePath(projector, at, radius)} />)
    }
    return out
  }
  const parentAt = body.parent ? positions.get(body.parent) || [0, 0] : [0, 0]
  if (body.kind === 'belt') {
    const belt = body.belt || {}
    const inner = Number(belt.innerAU) || body.orbit?.aAU || 2
    const outer = Number(belt.outerAU) || inner * 1.3
    for (const radius of [inner, (inner + outer) / 2, outer]) {
      out.push(<path key={`${body.id}-${radius}`} className="map-belt" d={circlePath(projector, parentAt, radius)} />)
    }
    return out
  }
  if (body.orbit) {
    const ring = orbitPath(body, byId, 128).map(([x, y]) => projector.toWorld([parentAt[0] + x, parentAt[1] + y]))
    out.push(<path key={`orbit-${body.id}`} className="map-orbit" d={pathData(ring, true)} />)
  }
  return out
}

/** Every ring of every body, split into those whose centre is fixed and those that move. */
function splitRings(bodies, fixed) {
  const still = []
  const moving = []
  for (const body of bodies) {
    const parentFixed = !body.parent || fixed.has(body.parent)
    ;(parentFixed ? still : moving).push([body, 'parent'])
    ;(fixed.has(body.id) ? still : moving).push([body, 'self'])
  }
  return { still, moving }
}

/**
 * Ids of the bodies that never move: no orbit of their own, and nothing above them
 * that orbits. What is drawn around them (orbits, belts, habitable zones) is the same
 * on every day, so it is drawn once rather than on every tick of playback.
 */
function fixedBodies(bodies, byId, dynamics) {
  const fixed = new Set()
  // Where everything pulls on everything, everything moves.
  if (dynamics === 'nbody') return fixed
  const isFixed = (body, depth = 0) => {
    if (!body || body.orbit || depth > bodies.length) return false
    return body.parent ? isFixed(byId.get(body.parent), depth + 1) : true
  }
  for (const body of bodies) if (isFixed(body)) fixed.add(body.id)
  return fixed
}

/**
 * The paths of an N-body system's bodies over the story (day 0 to its horizon),
 * drawn where orbits would be: they have no ellipse to follow, so their path is
 * what they actually do. Computed once per system and frame, not per day.
 */
function nbodyTrails(system, projector) {
  const run = runFor(system)
  const horizon = system.nbody?.horizonDays || 3650
  return run.ids.map((id) => {
    const points = run.trail(id, 0, horizon).map((point) => projector.toWorld(point))
    return <path key={`trail-${id}`} className="map-orbit map-trail" d={pathData(points, false)} />
  })
}

const SystemGround = memo(function SystemGround({ map, projector, positions: livePositions, selection }) {
  const bodies = map.system.bodies
  const byId = useMemo(() => new Map(bodies.map((body) => [body.id, body])), [bodies])
  const positions = livePositions || projector.positions
  const dynamics = map.system.dynamics
  const rings = useMemo(() => splitRings(bodies, fixedBodies(bodies, byId, dynamics)), [bodies, byId, dynamics])
  const trails = useMemo(() => (dynamics === 'nbody' ? nbodyTrails(map.system, projector) : null), [dynamics, map.system, projector])
  // A fixed body is where it is on any day, so the frame's own positions place it.
  const staticRings = useMemo(
    () => rings.still.flatMap(([body, around]) => bodyRings(body, byId, projector, projector.positions, around)),
    [byId, projector, rings]
  )
  const movingRings = rings.moving.flatMap(([body, around]) => bodyRings(body, byId, projector, positions, around))

  const discs = []
  for (const body of bodies) {
    if (body.kind === 'belt' || body.kind === 'barycenter') continue
    const at = projector.toWorld(positions.get(body.id) || [0, 0])
    discs.push(
      <BodyDisc
        key={body.id}
        body={body}
        x={at[0]}
        y={at[1]}
        selected={selection?.kind === 'body' && selection.id === body.id}
      />
    )
  }
  return (
    <g className="map-ground map-system">
      {trails}
      {staticRings}
      {movingRings}
      {discs}
    </g>
  )
})

/** Which of two bodies on top of each other keeps its name: the bigger kind. */
const BODY_RANK = { star: 0, planet: 1, dwarf: 2, moon: 3, station: 4 }
/** Bodies closer than this on screen show one name (a moon tucks behind its planet). */
const NAME_CLEARANCE_PX = 16

/**
 * Over the 3D view (which draws the bodies themselves): each body's name, and a
 * target to click, select and drag, where the camera puts it. A body drawn on top
 * of a bigger one (a moon seen from far off) gives way, unless it is selected.
 */
function SpaceNames({ map, projector, positions, selection }) {
  const placed = []
  for (const body of map.system.bodies) {
    if (body.kind === 'belt' || body.kind === 'barycenter') continue
    const at = projector.toWorld(positions?.get(body.id) || [0, 0, 0])
    if (at) placed.push({ body, at, rank: BODY_RANK[body.kind] ?? 5 })
  }
  placed.sort((a, b) => a.rank - b.rank)
  const shown = []
  for (const entry of placed) {
    const selected = selection?.kind === 'body' && selection.id === entry.body.id
    const crowded = shown.some((other) => Math.hypot(other.at[0] - entry.at[0], other.at[1] - entry.at[1]) < NAME_CLEARANCE_PX)
    if (crowded && !selected) continue
    shown.push({ ...entry, selected })
  }
  return (
    <g className="map-system map-space-names">
      {shown.map(({ body, at, selected }) => (
        <g
          key={body.id}
          className={`map-body map-body-3d${selected ? ' is-selected' : ''}`}
          data-map-item={body.id}
          data-map-kind="body"
          transform={`translate(${at[0]} ${at[1]})`}
        >
          <circle className="map-body-target" r={11} />
          <text className="map-body-name" x={13} y={4}>{body.name}</text>
        </g>
      ))}
    </g>
  )
}

const BodyDisc = memo(function BodyDisc({ body, x, y, selected }) {
  const isStar = body.kind === 'star'
  const color = body.color || (isStar ? temperatureToColor(body.star?.temperatureK ?? 5772) : MAP_DEFAULT_COLORS.body)
  const radius = isStar ? 11 : body.kind === 'moon' ? 3.5 : body.kind === 'station' ? 3 : body.kind === 'dwarf' ? 3.5 : 6
  const blackHole = isStar && body.star?.spectral === 'BH'
  return (
    <g
      className={`map-body${selected ? ' is-selected' : ''}`}
      data-map-item={body.id}
      data-map-kind="body"
      transform={`translate(${x} ${y})`}
    >
      <g className="map-mark">
        {isStar ? <circle r={radius * 2.4} fill={blackHole ? 'none' : color} opacity={0.18} stroke={blackHole ? MAP_DEFAULT_COLORS.blackHoleRim : 'none'} strokeWidth={blackHole ? 3 : 0} /> : null}
        <circle className="map-body-disc" r={radius} fill={blackHole ? MAP_DEFAULT_COLORS.blackHole : color} stroke={blackHole ? MAP_DEFAULT_COLORS.blackHoleRim : 'none'} strokeWidth={blackHole ? 1.5 : 0} />
        <text className="map-body-name" x={radius + 5} y={4}>{body.name}</text>
      </g>
    </g>
  )
})

/* ---------------- items ---------------- */

const RegionLayer = memo(function RegionLayer({ map, projector, selection, idPrefix }) {
  const terrains = useMemo(() => new Map(map.terrains.map((terrain) => [terrain.id, terrain])), [map.terrains])
  return (
    <g className="map-regions">
      {map.regions.map((region) => {
        const terrain = region.terrain ? terrains.get(region.terrain) : null
        const fill = region.fill || terrain?.fill || 'var(--map-region)'
        const hatch = region.hatch !== 'none' ? region.hatch : terrain?.hatch && terrain.hatch !== 'none' ? terrain.hatch : 'none'
        const d = ringsPath(projector, region.rings)
        return (
          <g
            key={region.id}
            className={`map-region${selection?.kind === 'region' && selection.id === region.id ? ' is-selected' : ''}`}
            data-map-item={region.id}
            data-map-kind="region"
          >
            <path className="map-region-shape" d={d} fill={fill} fillOpacity={0.35} stroke={region.stroke || fill} />
            {hatch !== 'none' ? (
              <path d={d} fill={`url(#${idPrefix}-hatch-${hatch})`} style={{ color: region.stroke || fill }} pointerEvents="none" fillRule="evenodd" />
            ) : null}
          </g>
        )
      })}
    </g>
  )
})

const RouteLayer = memo(function RouteLayer({ map, projector, space, day, selection, idPrefix }) {
  return (
    <g className="map-routes">
      {map.routes.map((route) => {
        const coords = routeCoords(map, space, route, day)
        const d = linePath(projector, space, coords)
        const stroke = route.style.stroke || 'var(--map-route)'
        const dash = route.style.dash
        // Rough and inked are a wobble drawn into the line (roughen.js); the hit path
        // keeps the true one.
        const style = dash === 'rough' ? ROUGH_STYLE : dash === 'inked' ? INKED_STYLE : null
        const drawn = style ? roughenPath(d, style, hashSeed(route.id)) : d
        return (
          <g
            key={route.id}
            className={`map-route${selection?.kind === 'route' && selection.id === route.id ? ' is-selected' : ''}`}
            data-map-item={route.id}
            data-map-kind="route"
            style={{ color: stroke }}
          >
            <path id={`${idPrefix}-route-${route.id}`} className="map-route-hit" d={d} />
            <path
              className="map-route-line"
              d={drawn}
              stroke={stroke}
              strokeWidth={route.style.width}
              strokeDasharray={DASHES[dash] || undefined}
              markerEnd={route.style.arrow ? `url(#${idPrefix}-arrow)` : undefined}
            />
          </g>
        )
      })}
    </g>
  )
})

const LabelLayer = memo(function LabelLayer({ map, projector, space, day, zoom, selection, idPrefix }) {
  const routes = useMemo(() => new Map(map.routes.map((route) => [route.id, route])), [map.routes])
  return (
    <g className="map-labels">
      {map.labels.map((label) => {
        if (zoom < label.minZoom || (label.maxZoom && zoom > label.maxZoom)) return null
        const selected = selection?.kind === 'label' && selection.id === label.id
        const common = {
          className: `map-label${selected ? ' is-selected' : ''}`,
          'data-map-item': label.id,
          'data-map-kind': 'label',
          fontSize: label.size,
          style: { fontFamily: label.font === 'sans' ? 'var(--map-ui-font, system-ui)' : label.font === 'serif' ? undefined : label.font },
        }
        let along = null
        if (label.route && routes.has(label.route)) {
          const coords = routeCoords(map, space, routes.get(label.route), day)
          along = projector.kind === 'earth' || projector.kind === 'globe' ? measuredLine(space, coords).points : coords
        } else if (label.path) {
          along = catmullRomSample(label.path, 8)
        }
        if (along) {
          let world = along.map((point) => projector.toWorld(point)).filter(Boolean)
          if (labelNeedsFlip(world)) world = [...world].reverse()
          const pathId = `${idPrefix}-label-${label.id}`
          return (
            <g key={label.id}>
              <path id={pathId} d={pathData(world)} fill="none" stroke="none" />
              <text {...common} dy={-label.size * 0.35}>
                <textPath href={`#${pathId}`} startOffset={`${label.startOffset * 100}%`} textAnchor="middle">
                  {label.text}
                </textPath>
              </text>
            </g>
          )
        }
        const at = projector.toWorld(label.at)
        if (!at) return null
        return (
          <text
            key={label.id}
            {...common}
            x={at[0]}
            y={at[1]}
            textAnchor="middle"
            dominantBaseline="middle"
            transform={label.rotation ? `rotate(${label.rotation} ${at[0]} ${at[1]})` : undefined}
          >
            {label.text}
          </text>
        )
      })}
    </g>
  )
})

const PinLayer = memo(function PinLayer({ map, projector, space, day, selection, missingDocs, hideNames }) {
  return (
    <g className="map-pins">
      {map.pins.map((pin) => {
        const at = projector.toWorld(resolvePin(map, space, pin, day))
        if (!at) return null
        return (
          <PinMark
            key={pin.id}
            pin={pin}
            x={at[0]}
            y={at[1]}
            selected={selection?.kind === 'pin' && selection.id === pin.id}
            missing={Boolean(pin.doc && missingDocs?.has(pin.doc))}
            hideNames={hideNames}
          />
        )
      })}
    </g>
  )
})

/** One pin. Memoized: in playback only the pins riding a body move, and only they redraw. */
const PinMark = memo(function PinMark({ pin, x, y, selected, missing, hideNames }) {
  return (
    <g
      className={`map-pin${selected ? ' is-selected' : ''}${missing ? ' is-missing' : ''}`}
      data-map-item={pin.id}
      data-map-kind="pin"
      transform={`translate(${x} ${y})`}
    >
      <g className="map-mark">
        <PinGlyph icon={pin.icon} color={pin.color} />
        {hideNames ? null : (
          <text className="map-pin-name" y={16} textAnchor="middle">
            {pinLabel(pin, getDocDisplayName)}{missing ? ' (missing)' : ''}
          </text>
        )}
      </g>
    </g>
  )
})

function TravelerLayer({ map, projector, space, day, schedules, selection }) {
  return (
    <g className="map-travelers">
      {map.travelers.map((traveler, index) => {
        const schedule = schedules?.find((candidate) => candidate.travelerId === traveler.id)
        if (!schedule) return null
        const color = travelerColor(traveler, index)
        const selected = selection?.kind === 'traveler' && selection.id === traveler.id
        const plans = selected
          ? schedule.intervals.filter((interval) => interval.kind === 'travel').map((interval) => (
              <path key={interval.legId} className="map-traveler-plan" stroke={color} d={linePath(projector, space, interval.line.points)} />
            ))
          : null
        const position = travelerPositionAt(map, space, schedule, day)
        if (!position) return <g key={traveler.id}>{plans}</g>
        const at = projector.toWorld(position.point)
        if (!at) return <g key={traveler.id}>{plans}</g>
        let trail = null
        if (position.interval.kind === 'travel') {
          // The part of this leg already behind them: every point up to their segment.
          const done = position.interval.line.points.slice(0, position.index + 1)
          trail = <path className="map-traveler-trail" stroke={color} d={linePath(projector, space, [...done, position.point])} />
        }
        return (
          <g key={traveler.id}>
            {plans}
            {trail}
            <g
              className={`map-traveler${selected ? ' is-selected' : ''}`}
              data-map-item={traveler.id}
              data-map-kind="traveler"
              transform={`translate(${at[0]} ${at[1]})`}
            >
              <g className="map-mark">
                <circle className="map-traveler-dot" r={selected ? 11 : 9} fill={color} />
                <text y={4} textAnchor="middle" fontSize={9} fontWeight={700} fill={MAP_DEFAULT_COLORS.travelerLabel} pointerEvents="none">
                  {initials(travelerName(traveler))}
                </text>
                <text className="map-traveler-name" y={-14} textAnchor="middle" fill={color}>
                  {travelerName(traveler)}
                </text>
              </g>
            </g>
          </g>
        )
      })}
    </g>
  )
}

/* ---------------- definitions ---------------- */

export function MapDefs({ idPrefix }) {
  return (
    <defs>
      <marker id={`${idPrefix}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse" markerUnits="strokeWidth">
        <path d="M0 0 L10 5 L0 10 z" fill="context-stroke" stroke="none" />
      </marker>
      <pattern id={`${idPrefix}-hatch-diagonal`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
      </pattern>
      <pattern id={`${idPrefix}-hatch-cross`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <path d="M0 0 V10 M0 0 H10" stroke="currentColor" strokeWidth="1" />
      </pattern>
      <pattern id={`${idPrefix}-hatch-dots`} width="9" height="9" patternUnits="userSpaceOnUse">
        <circle cx="2" cy="2" r="1.2" fill="currentColor" />
        <circle cx="6.5" cy="6.5" r="1.2" fill="currentColor" />
      </pattern>
      <pattern id={`${idPrefix}-hatch-waves`} width="16" height="8" patternUnits="userSpaceOnUse">
        <path d="M0 5 Q4 1 8 5 T16 5" fill="none" stroke="currentColor" strokeWidth="1" />
      </pattern>
      <pattern id={`${idPrefix}-hatch-mountains`} width="22" height="16" patternUnits="userSpaceOnUse">
        <path d="M2 14 L8 5 L14 14 M10 14 L15 8 L20 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </pattern>
    </defs>
  )
}

/**
 * Timeline events happening here and now: each event placed at one of this map's pins
 * whose time covers the map's day, as a flag over the pin. Only the editing surface
 * passes any; a thumbnail or an export draws the map alone.
 */
function TimelineEventLayer({ map, projector, space, day, events }) {
  if (!events?.length) return null
  const pins = new Map(map.pins.map((pin) => [pin.id, pin]))
  const stacked = new Map()
  return (
    <g className="map-timeline-events">
      {events.map((event) => {
        const pin = pins.get(event.pin)
        const at = pin ? projector.toWorld(resolvePin(map, space, pin, day)) : null
        if (!at) return null
        const level = stacked.get(event.pin) || 0
        stacked.set(event.pin, level + 1)
        return (
          <g key={event.id} className="map-timeline-event" data-timeline-event={event.id} transform={`translate(${at[0]} ${at[1]})`} style={event.color ? { '--event': inkColor(event.color) } : undefined}>
            <g className="map-mark">
              <text className="map-timeline-event-text" y={-22 - level * 16} textAnchor="middle">
                ◆ {event.title || 'Event'}
              </text>
            </g>
          </g>
        )
      })}
    </g>
  )
}

/* ---------------- all together ---------------- */

/**
 * Every layer, in paint order. `interactive` false leaves out selection chrome — a
 * thumbnail or an export is the map, not the editor.
 */
/** Memoized: a pan or zoom changes none of its props, so the layers sit it out. */
const MapLayers = memo(function MapLayers({
  map,
  projector,
  space,
  day = 0,
  zoom = 1,
  schedules,
  selection = null,
  missingDocs = null,
  projectName,
  idPrefix,
  earthLevel = '110m',
  onCountries,
  hidePinNames = false,
  inlineAssets = null,
  earthPaths = null,
  timelineEvents = null,
  positions = null,
}) {
  // Only on a star system does anything but a traveller move with the day. Holding
  // the day still for the other layers lets them skip re-rendering during playback.
  const staticDay = projector.kind === 'system' || projector.kind === 'space' ? day : 0
  // On the globe, MapLibre draws the ground, the regions and the routes; this is the
  // overlay of everything else, in screen pixels.
  // A planet's world is drawn the same way (PlanetView paints them on).
  const overGlobe = projector.kind === 'globe' || projector.kind === 'planet'
  return (
    <g className="map-layers">
      {overGlobe ? null : projector.kind === 'earth' ? (
        <EarthGround map={map} projector={projector} level={earthLevel} onCountries={onCountries} staticPaths={earthPaths} />
      ) : projector.kind === 'system' ? (
        <SystemGround map={map} projector={projector} positions={positions} selection={selection} />
      ) : projector.kind === 'space' ? (
        <SpaceNames map={map} projector={projector} positions={positions} selection={selection} />
      ) : (
        <PlaneGround map={map} projector={projector} projectName={projectName} inlineAssets={inlineAssets} />
      )}
      {overGlobe ? null : <RegionLayer map={map} projector={projector} selection={selection} idPrefix={idPrefix} />}
      {overGlobe ? null : <RouteLayer map={map} projector={projector} space={space} day={staticDay} selection={selection} idPrefix={idPrefix} />}
      <LabelLayer map={map} projector={projector} space={space} day={staticDay} zoom={zoom} selection={selection} idPrefix={idPrefix} />
      <PinLayer map={map} projector={projector} space={space} day={staticDay} selection={selection} missingDocs={missingDocs} hideNames={hidePinNames} />
      <TravelerLayer map={map} projector={projector} space={space} day={day} schedules={schedules} selection={selection} />
      <TimelineEventLayer map={map} projector={projector} space={space} day={day} events={timelineEvents} />
    </g>
  )
})

export default MapLayers
