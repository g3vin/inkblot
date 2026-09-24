/**
 * MapDraft.jsx — what is being drawn, and the handles on what is selected.
 *
 * A draft is the route, region or measurement under construction: its points so far,
 * a rubber band from the last one to the pointer (moved imperatively by MapSurface,
 * so following the mouse costs no render), and for the measuring tools the running
 * figure. When a route or region is selected, its corners get handles to drag, and
 * the middle of each side a handle that adds a corner there.
 */
import { formatArea, formatDistance } from '../lib/map/mapUnits'
import { lineKm, resolvePin } from '../lib/map/mapSpace'
import { pathData } from '../lib/map/mapGeometry'
import { linePath } from './mapRender'
import { unitFor } from './mapOptions'


function Handle({ at, index, owner, ownerKind, midpoint = false }) {
  if (!at) return null
  return (
    <g transform={`translate(${at[0]} ${at[1]})`}>
      <g className="map-mark">
        <circle
          className={`map-handle${midpoint ? ' is-midpoint' : ''}`}
          r={midpoint ? 4 : 5.5}
          data-map-handle={index}
          data-map-handle-owner={owner}
          data-map-handle-kind={ownerKind}
          {...(midpoint ? { 'data-map-midpoint': '' } : {})}
        />
      </g>
    </g>
  )
}

function Measure({ at, text }) {
  if (!at) return null
  return (
    <g transform={`translate(${at[0]} ${at[1]})`}>
      <g className="map-mark">
        <text className="map-measure-text" x={10} y={-10}>{text}</text>
      </g>
    </g>
  )
}

export default function MapDraft({ map, projector, space, day, draft, selection, selectedItem, rubberRef }) {
  const parts = []

  if (draft && draft.nodes.length) {
    const stored = draft.nodes.map((node) => node.at)
    const closed = draft.tool === 'region' || draft.tool === 'area'
    const world = stored.map((point) => projector.toWorld(point)).filter(Boolean)
    if (closed && world.length >= 3) parts.push(<path key="fill" className="map-draft-fill" d={pathData(world, true)} />)
    parts.push(<path key="line" className="map-draft-line" d={linePath(projector, space, closed && draft.done ? [...stored, stored[0]] : stored)} />)
    for (const [index, point] of world.entries()) {
      parts.push(
        <g key={`p${index}`} transform={`translate(${point[0]} ${point[1]})`}>
          <g className="map-mark"><circle className="map-draft-point" r={3.5} /></g>
        </g>
      )
    }
    const last = world[world.length - 1]
    if (draft.tool === 'ruler' && stored.length >= 2) {
      parts.push(<Measure key="m" at={last} text={formatDistance(lineKm(space, stored), unitFor(map), map)} />)
    }
    if (draft.tool === 'area' && stored.length >= 3) {
      const perimeter = lineKm(space, [...stored, stored[0]])
      parts.push(
        <Measure key="m" at={last} text={`${formatArea(space.areaKm2([stored]), unitFor(map) === 'auto' ? 'km' : unitFor(map), map)} · ${formatDistance(perimeter, unitFor(map), map)} round`} />
      )
    }
  }
  // The rubber band stays mounted so its ref is stable; it is only visible mid-draft.
  parts.push(<path key="rubber" ref={rubberRef} className="map-draft-line" d={draft && !draft.done && draft.nodes.length ? undefined : ''} />)

  if (selection?.kind === 'route' && selectedItem) {
    const pins = new Map(map.pins.map((pin) => [pin.id, pin]))
    const stops = selectedItem.nodes.map((node) => projector.toWorld(node.pin ? resolvePin(map, space, pins.get(node.pin), day) : node.at))
    stops.forEach((at, index) => {
      if (index > 0 && at && stops[index - 1]) {
        const mid = [(at[0] + stops[index - 1][0]) / 2, (at[1] + stops[index - 1][1]) / 2]
        parts.push(<Handle key={`rm${index}`} at={mid} index={index - 1} owner={selectedItem.id} ownerKind="route" midpoint />)
      }
      parts.push(<Handle key={`rh${index}`} at={at} index={index} owner={selectedItem.id} ownerKind="route" />)
    })
  }

  if (selection?.kind === 'region' && selectedItem) {
    const ring = selectedItem.rings[0].map((point) => projector.toWorld(point))
    ring.forEach((at, index) => {
      const next = ring[(index + 1) % ring.length]
      if (at && next) {
        parts.push(<Handle key={`gm${index}`} at={[(at[0] + next[0]) / 2, (at[1] + next[1]) / 2]} index={index} owner={selectedItem.id} ownerKind="region" midpoint />)
      }
      parts.push(<Handle key={`gh${index}`} at={at} index={index} owner={selectedItem.id} ownerKind="region" />)
    })
  }

  return <g className="map-draft">{parts}</g>
}
