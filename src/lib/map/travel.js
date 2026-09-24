/**
 * travel.js — how long it takes to cover a line on a map.
 *
 * A line (a route, or the straight way from one place to another) is cut wherever it
 * crosses the edge of a region, and each piece is travelled at the transport's speed
 * times the multiplier of the terrain it runs through. Where regions overlap, the one
 * painted on top wins — so a Road drawn over a Forest speeds the forest up.
 *
 * A terrain multiplier of 0 is impassable. The leg still gets a (very slow) finite
 * time, so a schedule can be drawn, and says so in `impassable`.
 *
 * Mirrored in `inkblot_core::map::travel`.
 */
import { segmentRingCrossings } from './mapGeometry'
import { measuredLine, resolvePin, routeCoords } from './mapSpace'
import { effectiveKmh, resolveTransport } from './transports'
import { interceptDays } from './orbits'

/** An impassable stretch is crossed at this fraction of full speed. */
export const IMPASSABLE_CRAWL = 0.05

/** The multiplier `terrain` applies to `transport`: by id, then by medium, else 1. */
export function terrainMultiplier(terrain, transport) {
  const multipliers = terrain?.multipliers || {}
  if (Number.isFinite(multipliers[transport.id])) return multipliers[transport.id]
  const byMedium = multipliers[`*${transport.medium}`]
  return Number.isFinite(byMedium) ? byMedium : 1
}

/** The terrain at a point: the topmost region there that has one, or null. */
export function terrainAt(map, space, point) {
  const regions = Array.isArray(map?.regions) ? map.regions : []
  const terrains = new Map((map?.terrains || []).map((terrain) => [terrain.id, terrain]))
  for (let index = regions.length - 1; index >= 0; index -= 1) {
    const region = regions[index]
    if (!region.terrain || !terrains.has(region.terrain)) continue
    if (space.contains(region.rings, point)) return terrains.get(region.terrain)
  }
  return null
}

/**
 * A line as travelled by `transport`: pieces of `{ fromKm, toKm, multiplier, hours,
 * terrain }`, and the totals. `line` is a measuredLine (already densified).
 */
export function travelProfile(map, space, line, transport) {
  const kmh = effectiveKmh(transport)
  const rings = (map?.regions || []).filter((region) => region.terrain).flatMap((region) => region.rings)
  const pieces = []
  let impassable = false

  for (let index = 1; index < line.points.length; index += 1) {
    const a = line.points[index - 1]
    const b = line.points[index]
    const segmentKm = line.km[index] - line.km[index - 1]
    if (segmentKm <= 0) continue

    const cuts = [0, ...rings.flatMap((ring) => segmentRingCrossings(a, b, ring)).sort((l, r) => l - r), 1]
    for (let cut = 1; cut < cuts.length; cut += 1) {
      const t0 = cuts[cut - 1]
      const t1 = cuts[cut]
      if (t1 - t0 <= 0) continue
      const mid = space.interpolate(a, b, (t0 + t1) / 2)
      const terrain = terrainAt(map, space, mid)
      const multiplier = terrain ? terrainMultiplier(terrain, transport) : 1
      if (multiplier <= 0) impassable = true
      const km = segmentKm * (t1 - t0)
      const speed = kmh * (multiplier > 0 ? multiplier : IMPASSABLE_CRAWL)
      const fromKm = line.km[index - 1] + segmentKm * t0
      const previous = pieces[pieces.length - 1]
      // Adjacent pieces through the same terrain merge, so a profile reads as stretches.
      if (previous && previous.terrainId === (terrain?.id || null) && previous.multiplier === multiplier) {
        previous.toKm = fromKm + km
        previous.hours += km / speed
      } else {
        pieces.push({ fromKm, toKm: fromKm + km, multiplier, hours: km / speed, terrainId: terrain?.id || null })
      }
    }
  }

  const hours = pieces.reduce((total, piece) => total + piece.hours, 0)
  const hoursPerDay = transport.hoursPerDay > 0 ? transport.hoursPerDay : 24
  return { pieces, km: line.totalKm, hours, days: hours / hoursPerDay, impassable }
}

/** The route a leg follows, oriented from `from` to `to` when its ends say which way. */
function legRouteCoords(map, space, leg, day) {
  const route = (map.routes || []).find((candidate) => candidate.id === leg.route)
  if (!route) return null
  const coords = routeCoords(map, space, route, day)
  const first = route.nodes[0]?.pin
  const last = route.nodes[route.nodes.length - 1]?.pin
  if (leg.from && leg.to && first === leg.to && last === leg.from) coords.reverse()
  return coords
}

/**
 * The line a leg is travelled along on `day`: its route if it has one, else the
 * straight way (a great circle on the Earth) from `from` to `to`.
 */
export function legLine(map, space, leg, day = 0) {
  const byRoute = leg.route ? legRouteCoords(map, space, leg, day) : null
  if (byRoute && byRoute.length >= 2) return measuredLine(space, byRoute)
  const pins = new Map((map.pins || []).map((pin) => [pin.id, pin]))
  const from = resolvePin(map, space, pins.get(leg.from), day)
  const to = resolvePin(map, space, pins.get(leg.to), day)
  if (!from || !to) return measuredLine(space, [])
  return measuredLine(space, [from, to])
}

/**
 * How long a leg takes, leaving on `departDay`. Between two moving bodies of a star
 * system the answer is an intercept — aim where the destination will be.
 */
export function legTravel(map, space, leg, departDay = 0) {
  const transport = resolveTransport(map, leg.transport)
  const pins = new Map((map.pins || []).map((pin) => [pin.id, pin]))
  const fromPin = pins.get(leg.from)
  const toPin = pins.get(leg.to)

  if (space.kind === 'orbital' && !leg.route && fromPin?.body && toPin?.body) {
    const positionOf = (id, day) => space.positionsAt(day).get(id) || [0, 0]
    const intercept = interceptDays(positionOf, fromPin.body, toPin.body, departDay, effectiveKmh(transport), space.kmPerUnit)
    const start = positionOf(fromPin.body, departDay)
    const end = positionOf(toPin.body, intercept.arrival)
    const line = measuredLine(space, [start, end])
    const hours = intercept.days * 24
    return {
      transport,
      line,
      profile: { pieces: [{ fromKm: 0, toKm: line.totalKm, multiplier: 1, hours, terrainId: null }], km: line.totalKm, hours, days: intercept.days, impassable: false },
      approximate: intercept.approximate,
    }
  }

  const line = legLine(map, space, leg, departDay)
  return { transport, line, profile: travelProfile(map, space, line, transport), approximate: false }
}

/**
 * Km travelled after `elapsedDays` of a leg: the time profile inverted, so a
 * traveller slows visibly through a forest rather than moving at an average pace.
 */
export function kmAfter(profile, elapsedDays) {
  if (!profile.pieces.length || profile.days <= 0) return 0
  let hours = Math.min(profile.hours, Math.max(0, (elapsedDays / profile.days) * profile.hours))
  for (const piece of profile.pieces) {
    if (hours <= piece.hours) {
      return piece.fromKm + (piece.hours > 0 ? (hours / piece.hours) * (piece.toKm - piece.fromKm) : 0)
    }
    hours -= piece.hours
  }
  return profile.km
}

/**
 * Straight-line (or along-a-route) distance and travel time between every pair of
 * pins, by one transport. A route that stops at both pins is used between them;
 * `viaRoute` says when it was.
 */
export function distanceMatrix(map, space, pinIds, transportId, day = 0) {
  const transport = resolveTransport(map, transportId)
  const rows = []
  for (const fromId of pinIds) {
    const row = []
    for (const toId of pinIds) {
      if (fromId === toId) {
        row.push({ km: 0, days: 0, viaRoute: null, impassable: false })
        continue
      }
      const route = (map.routes || []).find((candidate) => {
        const stops = candidate.nodes.map((node) => node.pin)
        return stops.includes(fromId) && stops.includes(toId)
      })
      let line
      if (route) {
        const stops = route.nodes.map((node) => node.pin)
        const i = stops.indexOf(fromId)
        const j = stops.indexOf(toId)
        const sub = { ...route, nodes: route.nodes.slice(Math.min(i, j), Math.max(i, j) + 1) }
        const coords = routeCoords(map, space, sub, day)
        line = measuredLine(space, i <= j ? coords : coords.reverse())
      } else {
        line = legLine(map, space, { from: fromId, to: toId, route: null }, day)
      }
      const profile = travelProfile(map, space, line, transport)
      row.push({ km: profile.km, days: profile.days, viaRoute: route?.id || null, impassable: profile.impassable })
    }
    rows.push(row)
  }
  return rows
}
