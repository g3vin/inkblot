/**
 * Where a note's hover card goes (lib/notePreviewGeometry.ts).
 */
import { ok } from './assert.mjs'

const saved = globalThis.window
globalThis.window = { innerWidth: 1000, innerHeight: 800 }
const G = await import('../../src/lib/notePreviewGeometry.ts')
const anchor = (left, top) => ({ left, top, right: left + 8, bottom: top + 16, width: 8, height: 16 })

{
  const at = G.getInitialTilePosition(anchor(100, 300))
  ok('note card: right of its anchor when there is room', at.x === 108 + 22 && Math.abs(at.y - (300 - 88 * 0.3)) < 0.001)
  const left = G.getInitialTilePosition(anchor(900, 300))
  ok('note card: left of it when there is not', left.x + G.TILE_WIDTH <= 900)
  const far = G.clampPosition({ x: 5000, y: -5000 })
  ok('note card: never leaves the viewport',
    far.x + G.TILE_WIDTH <= 1000 - G.VIEWPORT_PADDING && far.y >= G.VIEWPORT_PADDING)
  const top = G.getInitialTilePosition(anchor(100, 0))
  ok('note card: kept below the top edge', top.y === G.VIEWPORT_PADDING)
}
{
  const one = G.getDefaultChildOffset(0, 1)
  ok('reply: a lone reply hangs straight below', one.offsetX === 0 && one.offsetY === G.CHILD_OFFSET_Y)
  const a = G.getDefaultChildOffset(0, 2)
  const b = G.getDefaultChildOffset(1, 2)
  ok('reply: two replies are spread either side of their parent', a.offsetX === -b.offsetX && a.offsetX < 0)
}
{
  const center = G.getCardCenter({ x: 100, y: 100 }, { width: 200, height: 100 })
  ok('note card: its centre', center.x === 200 && center.y === 150)
  const dot = G.getDotPoint(anchor(10, 20))
  ok('marker: its dot is the anchor’s middle', dot.x === 14 && dot.y === 28)
}
{
  const rect = { left: 100, top: 100, right: 360, bottom: 300, width: 260, height: 200 }
  ok('grip: the top band moves the card', G.getCardGrip(200, 115, rect) === 'move')
  ok('grip: the middle is the note', G.getCardGrip(200, 200, rect) === null)
  ok('grip: each edge resizes', G.getCardGrip(102, 200, rect) === 'w' && G.getCardGrip(358, 200, rect) === 'e' && G.getCardGrip(200, 298, rect) === 's' && G.getCardGrip(200, 101, rect) === 'n')
  ok('grip: corners resize both ways', G.getCardGrip(358, 298, rect) === 'se' && G.getCardGrip(101, 101, rect) === 'nw')
  const view = { width: 1000, height: 800 }
  const box = { x: 100, y: 100, width: 260, height: 200 }
  const se = G.resizeCardBox(box, 'se', 40, 30, view)
  ok('resize: the far corner follows the pointer', se.x === 100 && se.width === 300 && se.height === 230)
  const w = G.resizeCardBox(box, 'w', -50, 0, view)
  ok('resize: the left edge moves, the right stays', w.x === 50 && w.width === 310)
  const tiny = G.resizeCardBox(box, 'nw', 500, 500, view)
  ok('resize: never below the minimum', tiny.width === G.TILE_MIN_RESIZE_WIDTH && tiny.height === G.TILE_MIN_RESIZE_HEIGHT && tiny.x + tiny.width === 360)
}
{
  const card = { left: 100, top: 100, right: 200, bottom: 200 }
  ok('distance: 0 inside, straight-line outside', G.distanceToRect(150, 150, card) === 0 && G.distanceToRect(203, 204, card) === 5)
  const dot = { left: 0, top: 0, right: 10, bottom: 10 }
  const nearest = []
  G.hoverIntent(20, 20, [dot, card], nearest)
  ok('hover intent: heading for a card keeps it', G.hoverIntent(40, 40, [dot, card], nearest) === 'approaching')
  ok('hover intent: a small wobble is not leaving', G.hoverIntent(37, 37, [dot, card], nearest) !== 'away')
  ok('hover intent: moving off from every card is', G.hoverIntent(60, -40, [dot, card], nearest) === 'away')
}
{
  const parent = { x: 0, y: 0, width: 200, height: 100 }
  const child = { x: 0, y: 300, width: 200, height: 100 }
  const { start, end } = G.getStringPath({ x: 100, y: 50 }, { x: 100, y: 350 }, parent, child)
  const near = (a, b) => Math.abs(a - b) < 0.5
  ok('string: starts at the edge of the parent', near(start.y, 100))
  ok('string: ends at the edge of the child', near(end.y, 300))
  const { length } = G.getStringPath({ x: 100, y: 50 }, { x: 100, y: 350 }, parent, child)
  ok('string: its length is the gap between the cards', near(length, 200))
  const dot = G.getStringPath({ x: -50, y: 10 }, { x: 100, y: 350 }, null, child)
  ok('string: from the dot, starts at the dot', dot.start.x === -50 && dot.start.y === 10)
}
{
  const size = { width: 260, height: 100 }
  const corner = G.clampPosition({ x: 5000, y: 5000 }, size)
  ok('note card: held in from the right and bottom by the gap', corner.x === 1000 - 260 - G.VIEWPORT_PADDING && corner.y === 800 - 100 - G.VIEWPORT_PADDING)
  const lights = { x: 0, y: 0, width: 80, height: 44 }
  const pushed = G.clampPosition({ x: 20, y: 10 }, size, [lights])
  ok('note card: pushed out of the traffic lights, the shorter way', pushed.y === 44 && pushed.x === 20)
  const clear = G.clampPosition({ x: 300, y: 10 }, size, [lights])
  ok('note card: left alone beside them', clear.x === 300 && clear.y === 10)
}
{
  const parent = { x: 300, y: 100, width: 200, height: 100 }
  const size = { width: 200, height: 100 }
  const first = G.findOpenSpot(parent, size, [parent])
  ok('new note: below its parent when there is room', first.x === 300 && first.y === 100 + 100 + G.OPEN_SPOT_GAP)
  const taken = { x: first.x, y: first.y, width: 200, height: 100 }
  const second = G.findOpenSpot(parent, size, [parent, taken])
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + 200 > b.x && a.y < b.y + b.height && a.y + 100 > b.y
  ok('new note: somewhere else when that is taken', !overlaps(second, taken) && !overlaps(second, parent))
}
globalThis.window = saved
