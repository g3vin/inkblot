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
globalThis.window = saved
