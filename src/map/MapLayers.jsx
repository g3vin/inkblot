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
import { habitableZoneAU, temperatureToColor } from '../lib/map/stars'
import { projectedEarth } from '../lib/map/earthData'
import { travelerPositionAt } from '../lib/map/timeline'
import { useAssetUrl } from '../canvas/useAssetUrl'
import { PinGlyph } from './mapGlyphs'
import { initials, labelNeedsFlip, linePath, ringsPath, travelerColor, travelerName } from './mapRender'

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

function SystemGround({ map, projector, selection }) {
  const bodies = map.system.bodies
  const byId = useMemo(() => new Map(bodies.map((body) => [body.id, body])), [bodies])
  const { positions } = projector

  const orbits = []
  const discs = []
  for (const body of bodies) {
    const parentAt = body.parent ? positions.get(body.parent) || [0, 0] : [0, 0]
    if (body.kind === 'belt') {
      const belt = body.belt || {}
      const inner = Number(belt.innerAU) || body.orbit?.aAU || 2
      const outer = Number(belt.outerAU) || inner * 1.3
      for (const radius of [inner, (inner + outer) / 2, outer]) {
        const ring = []
        for (let step = 0; step <= 96; step += 1) {
          const angle = (step / 96) * Math.PI * 2
          ring.push(projector.toWorld([parentAt[0] + Math.cos(angle) * radius, parentAt[1] + Math.sin(angle) * radius]))
        }
        orbits.push(<path key={`${body.id}-${radius}`} className="map-belt" d={pathData(ring, true)} />)
      }
      continue
    }
    if (body.orbit) {
      const ring = orbitPath(body, byId, 128).map(([x, y]) => projector.toWorld([parentAt[0] + x, parentAt[1] + y]))
      orbits.push(<path key={`orbit-${body.id}`} className="map-orbit" d={pathData(ring, true)} />)
    }
    if (body.kind === 'star' && body.star?.luminositySun > 0) {
      const zone = habitableZoneAU(body.star.luminositySun)
      const at = positions.get(body.id) || [0, 0]
      if (zone) {
        for (const radius of zone) {
          const ring = []
          for (let step = 0; step <= 96; step += 1) {
            const angle = (step / 96) * Math.PI * 2
            ring.push(projector.toWorld([at[0] + Math.cos(angle) * radius, at[1] + Math.sin(angle) * radius]))
          }
          orbits.push(<path key={`hz-${body.id}-${radius}`} className="map-habitable" d={pathData(ring, true)} />)
        }
      }
    }
    if (body.kind === 'barycenter') continue
    const at = projector.toWorld(positions.get(body.id) || [0, 0])
    const isStar = body.kind === 'star'
    const color = body.color || (isStar ? temperatureToColor(body.star?.temperatureK ?? 5772) : '#9aa7b8')
    const radius = isStar ? 11 : body.kind === 'moon' ? 3.5 : body.kind === 'station' ? 3 : body.kind === 'dwarf' ? 3.5 : 6
    const blackHole = isStar && body.star?.spectral === 'BH'
    discs.push(
      <g
        key={body.id}
        className={`map-body${selection?.kind === 'body' && selection.id === body.id ? ' is-selected' : ''}`}
        data-map-item={body.id}
        data-map-kind="body"
        transform={`translate(${at[0]} ${at[1]})`}
      >
        <g className="map-mark">
          {isStar ? <circle r={radius * 2.4} fill={blackHole ? 'none' : color} opacity={0.18} stroke={blackHole ? '#ffb86b' : 'none'} strokeWidth={blackHole ? 3 : 0} /> : null}
          <circle className="map-body-disc" r={radius} fill={blackHole ? '#000' : color} stroke={blackHole ? '#ffb86b' : 'none'} strokeWidth={blackHole ? 1.5 : 0} />
          <text className="map-body-name" x={radius + 5} y={4}>{body.name}</text>
        </g>
      </g>
    )
  }
  return (
    <g className="map-ground map-system">
      {orbits}
      {discs}
    </g>
  )
}

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
        const filter = dash === 'rough' ? `url(#${idPrefix}-rough)` : dash === 'inked' ? `url(#${idPrefix}-inked)` : undefined
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
              d={d}
              stroke={stroke}
              strokeWidth={route.style.width}
              strokeDasharray={DASHES[dash] || undefined}
              filter={filter}
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
          along = projector.kind === 'earth' ? measuredLine(space, coords).points : coords
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
        const missing = Boolean(pin.doc && missingDocs?.has(pin.doc))
        const selected = selection?.kind === 'pin' && selection.id === pin.id
        return (
          <g
            key={pin.id}
            className={`map-pin${selected ? ' is-selected' : ''}${missing ? ' is-missing' : ''}`}
            data-map-item={pin.id}
            data-map-kind="pin"
            transform={`translate(${at[0]} ${at[1]})`}
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
      })}
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
                <text y={4} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff" pointerEvents="none">
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
      <filter id={`${idPrefix}-rough`} x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="2" seed="3" />
        <feDisplacementMap in="SourceGraphic" scale="3" />
      </filter>
      <filter id={`${idPrefix}-inked`} x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="1" seed="9" result="grain" />
        <feDisplacementMap in="SourceGraphic" in2="grain" scale="1.2" />
      </filter>
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

/* ---------------- all together ---------------- */

/**
 * Every layer, in paint order. `interactive` false leaves out selection chrome — a
 * thumbnail or an export is the map, not the editor.
 */
export default function MapLayers({
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
}) {
  // Only on a star system does anything but a traveller move with the day. Holding
  // the day still for the other layers lets them skip re-rendering during playback.
  const staticDay = projector.kind === 'system' ? day : 0
  return (
    <g className="map-layers">
      {projector.kind === 'earth' ? (
        <EarthGround map={map} projector={projector} level={earthLevel} onCountries={onCountries} staticPaths={earthPaths} />
      ) : projector.kind === 'system' ? (
        <SystemGround map={map} projector={projector} selection={selection} />
      ) : (
        <PlaneGround map={map} projector={projector} projectName={projectName} inlineAssets={inlineAssets} />
      )}
      <RegionLayer map={map} projector={projector} selection={selection} idPrefix={idPrefix} />
      <RouteLayer map={map} projector={projector} space={space} day={staticDay} selection={selection} idPrefix={idPrefix} />
      <LabelLayer map={map} projector={projector} space={space} day={staticDay} zoom={zoom} selection={selection} idPrefix={idPrefix} />
      <PinLayer map={map} projector={projector} space={space} day={staticDay} selection={selection} missingDocs={missingDocs} hideNames={hidePinNames} />
      <TravelerLayer map={map} projector={projector} space={space} day={day} schedules={schedules} selection={selection} />
    </g>
  )
}
