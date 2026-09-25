/**
 * maptrace — the image tracer on pictures drawn in code, where the right answer is
 * known: a disc's area, a ring's hole, a pen line's length, specks that should go.
 */
import { otsuThreshold, traceImage, traceToSvg, luminance } from '../../src/lib/map/trace.js'
import { polylineLength } from '../../src/lib/map/mapGeometry.js'

const ok = (label, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`)
  if (!condition) process.exitCode = 1
}

/** A white image with `ink(x, y)` pixels black. */
function picture(width, height, ink) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const value = ink(x + 0.5, y + 0.5) ? 20 : 235
      data[offset] = value
      data[offset + 1] = value
      data[offset + 2] = value
      data[offset + 3] = 255
    }
  }
  return { data, width, height }
}

{
  const r = 40
  const disc = picture(120, 120, (x, y) => Math.hypot(x - 60, y - 60) <= r)
  const result = traceImage(disc, { mode: 'outline', smoothing: 1 })
  ok('a disc traces to one outline', result.shapes.length === 1)
  const area = result.shapes[0]?.area || 0
  ok(`its area is within 3% of πr² (${Math.round(area)} vs ${Math.round(Math.PI * r * r)})`, Math.abs(area - Math.PI * r * r) / (Math.PI * r * r) < 0.03)
  const svg = traceToSvg(result, 120, 120)
  ok('the SVG is a standalone document at the picture’s size', svg.startsWith('<svg') && svg.includes('viewBox="0 0 120 120"') && svg.includes('evenodd'))
}

{
  const ring = picture(140, 140, (x, y) => {
    const d = Math.hypot(x - 70, y - 70)
    return d <= 55 && d >= 30
  })
  const result = traceImage(ring, { mode: 'outline' })
  ok(`a ring keeps its hole: two outlines (got ${result.shapes.length})`, result.shapes.length === 2)
}

{
  // A pen stroke 3 px wide and 100 px long, lying across the picture.
  const line = picture(140, 40, (x, y) => x >= 20 && x <= 120 && Math.abs(y - 20) <= 1.5)
  const result = traceImage(line, { mode: 'lines', minArea: 4 })
  const longest = Math.max(...result.shapes.map((shape) => polylineLength(shape.points)))
  ok(`a pen line traces to one centre line (${result.shapes.length})`, result.shapes.length === 1)
  ok(`of about the right length (${Math.round(longest)} vs 100)`, Math.abs(longest - 100) / 100 < 0.08)
}

{
  const specks = picture(100, 100, (x, y) => (Math.hypot(x - 50, y - 50) <= 25) || ((Math.floor(x) * 7 + Math.floor(y) * 13) % 97 === 0))
  const result = traceImage(specks, { mode: 'outline', minArea: 30 })
  ok(`specks below the minimum area are dropped (${result.shapes.length} shape)`, result.shapes.length === 1)
}

{
  const half = picture(64, 64, (x) => x < 32)
  const threshold = otsuThreshold(luminance(half))
  ok(`Otsu splits ink from paper (${threshold})`, threshold >= 20 && threshold < 235)
  const inverted = traceImage(picture(80, 80, (x, y) => !(Math.hypot(x - 40, y - 40) <= 20)), { invert: true })
  ok('inverting traces light shapes on a dark ground', inverted.shapes.length === 1 && Math.abs(inverted.shapes[0].area - Math.PI * 400) / (Math.PI * 400) < 0.05)
  const scaled = traceImage(picture(60, 60, (x, y) => Math.hypot(x - 30, y - 30) <= 20), {}, 4)
  ok('a scaled trace lands in the original picture’s pixels', Math.abs(scaled.shapes[0].area - Math.PI * 80 * 80) / (Math.PI * 80 * 80) < 0.05)
}
