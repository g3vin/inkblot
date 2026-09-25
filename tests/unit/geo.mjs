/**
 * Viewport math: screen/world round trips, zooming about the cursor, zoom-to-fit, and
 * rectangle hit tests.
 */
import { screenToWorld, worldToScreen, zoomAt, fitViewport, nodesBounds, panBy, clampZoom, rectFromPoints, rectsIntersect } from '../../src/lib/canvasGeometry.js'
import { ok } from './assert.mjs'
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

// round-trip
let v = { x: 137, y: -42, zoom: 1.73 }
const w = screenToWorld(300, 200, v)
const s = worldToScreen(w.x, w.y, v)
ok('screen->world->screen round-trips', near(s.x, 300) && near(s.y, 200))

// THE zoom invariant: the world point under the cursor must not move.
for (const [zoom, factor, cx, cy] of [[1, 1.2, 400, 300], [0.35, 3.1, 12, 780], [2.4, 0.5, 640, 1], [1, 1.2, 0, 0]]) {
  const before = { x: 20, y: -80, zoom }
  const anchorWorld = screenToWorld(cx, cy, before)
  const after = zoomAt(before, factor, cx, cy)
  const anchorScreen = worldToScreen(anchorWorld.x, anchorWorld.y, after)
  ok(`zoom ${zoom}x${factor} @(${cx},${cy}) pins the cursor`, near(anchorScreen.x, cx, 1e-9) && near(anchorScreen.y, cy, 1e-9))
}

// clamping must not break the invariant (it returns the same viewport when pinned)
const maxed = zoomAt({ x: 0, y: 0, zoom: 4 }, 5, 100, 100)
ok('zoom clamps at max and stays put', maxed.zoom === 4 && maxed.x === 0 && maxed.y === 0)
ok('zoom clamps at min', clampZoom(0.001) === 0.1)

// pan is in screen px, applied in world units
ok('pan divides by zoom', panBy({ x: 0, y: 0, zoom: 2 }, 100, 50).x === 50)

// fit: bounds must land centered
const bounds = nodesBounds([{ x: 0, y: 0, width: 200, height: 100 }, { x: 300, y: 200, width: 100, height: 100 }])
ok('bounds union', bounds.x === 0 && bounds.y === 0 && bounds.width === 400 && bounds.height === 300)
const fit = fitViewport(bounds, 800, 600, { padding: 50 })
const c = worldToScreen(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, fit)
ok('zoom-to-fit centers the content', near(c.x, 400, 1e-6) && near(c.y, 300, 1e-6))
ok('zoom-to-fit never magnifies past maxZoom', fit.zoom <= 1)
const fitEmpty = fitViewport(nodesBounds([]), 800, 600)
ok('zoom-to-fit on empty canvas resets to origin', fitEmpty.x === 0 && fitEmpty.y === 0 && fitEmpty.zoom === 1)

// marquee helpers
const r = rectFromPoints({ x: 300, y: 200 }, { x: 100, y: 50 })
ok('marquee normalizes a backwards drag', r.x === 100 && r.y === 50 && r.width === 200 && r.height === 150)
ok('marquee hit-test', rectsIntersect(r, { x: 250, y: 180, width: 20, height: 20 }) && !rectsIntersect(r, { x: 900, y: 900, width: 5, height: 5 }))
