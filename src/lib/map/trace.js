/**
 * trace.js — turning a picture of a map into vector outlines.
 *
 * A photographed or scanned map is dark ink on light paper. The pipeline:
 *
 *   1. luminance, lightly blurred to calm paper grain and JPEG noise
 *   2. a threshold — Otsu's, which finds the split between ink and paper on its
 *      own, unless the writer sets one — giving a mask of ink
 *   3. an opening (erode then dilate) and removal of specks smaller than `minArea`
 *   4. then one of two readings of the mask:
 *        outline  every inked shape's edge as a closed ring — for filled land masses,
 *                 silhouettes, anything drawn as areas. Holes come out as rings too,
 *                 and an even-odd fill keeps them holes.
 *        lines    the ink's centre line (Zhang–Suen thinning, then walked into
 *                 polylines, short spurs pruned) — for a pen drawing, where tracing
 *                 the outline would give every stroke two edges
 *   5. Douglas–Peucker to drop the pixel staircase, Chaikin to round what is left
 *
 * Every stage is a plain function of `{ data, width, height }` (RGBA, as ImageData
 * holds it), so the tests run it on synthetic images and the app runs it in a worker.
 */
import { chaikin, ringArea, simplifyDP } from './mapGeometry'

export const DEFAULT_TRACE_OPTIONS = {
  mode: 'outline',
  threshold: null,
  invert: false,
  minArea: 24,
  detail: 1.2,
  smoothing: 2,
  pruneLength: 8,
}

/* ---------- 1. luminance and blur ---------- */

export function luminance({ data, width, height }) {
  const out = new Float32Array(width * height)
  for (let index = 0; index < out.length; index += 1) {
    const offset = index * 4
    const alpha = data[offset + 3] / 255
    // Transparent pixels read as paper.
    const value = 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]
    out[index] = value * alpha + 255 * (1 - alpha)
  }
  return out
}

/** A 3×3 Gaussian (1-2-1) blur, edges clamped. */
export function blur3(gray, width, height) {
  const out = new Float32Array(gray.length)
  const at = (x, y) => gray[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      out[y * width + x] = (
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) +
        2 * at(x - 1, y) + 4 * at(x, y) + 2 * at(x + 1, y) +
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)
      ) / 16
    }
  }
  return out
}

/* ---------- 2. threshold ---------- */

/** Otsu's threshold: the grey level that best separates the histogram's two modes. */
export function otsuThreshold(gray) {
  const histogram = new Float64Array(256)
  for (const value of gray) histogram[Math.min(255, Math.max(0, Math.round(value)))] += 1
  const total = gray.length
  let sumAll = 0
  for (let level = 0; level < 256; level += 1) sumAll += level * histogram[level]
  let sumBelow = 0
  let weightBelow = 0
  let best = 0
  let bestVariance = -1
  for (let level = 0; level < 256; level += 1) {
    weightBelow += histogram[level]
    if (!weightBelow) continue
    const weightAbove = total - weightBelow
    if (!weightAbove) break
    sumBelow += level * histogram[level]
    const meanBelow = sumBelow / weightBelow
    const meanAbove = (sumAll - sumBelow) / weightAbove
    const variance = weightBelow * weightAbove * (meanBelow - meanAbove) ** 2
    if (variance > bestVariance) {
      bestVariance = variance
      best = level
    }
  }
  return best
}

/** Ink mask: 1 where darker than the threshold (lighter, when inverted). */
export function binarize(gray, threshold, invert = false) {
  const mask = new Uint8Array(gray.length)
  for (let index = 0; index < gray.length; index += 1) {
    const dark = gray[index] <= threshold
    mask[index] = dark !== invert ? 1 : 0
  }
  return mask
}

/* ---------- 3. clean-up ---------- */

function morph(mask, width, height, keep) {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let count = 0
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx
          const ny = y + dy
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && mask[ny * width + nx]) count += 1
        }
      }
      out[y * width + x] = keep(count, mask[y * width + x]) ? 1 : 0
    }
  }
  return out
}

/** Erode then dilate: whiskers and single stray pixels go, shapes keep their size. */
export const openMask = (mask, width, height) =>
  morph(morph(mask, width, height, (count, self) => self && count >= 7), width, height, (count) => count >= 1)

/** Drop 4-connected components smaller than `minArea` pixels. */
export function removeSmall(mask, width, height, minArea) {
  const out = mask.slice()
  const seen = new Uint8Array(mask.length)
  const stack = []
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue
    const component = []
    stack.push(start)
    seen[start] = 1
    while (stack.length) {
      const index = stack.pop()
      component.push(index)
      const x = index % width
      const y = (index - x) / width
      for (const next of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y > 0 ? index - width : -1, y < height - 1 ? index + width : -1]) {
        if (next >= 0 && mask[next] && !seen[next]) {
          seen[next] = 1
          stack.push(next)
        }
      }
    }
    if (component.length < minArea) for (const index of component) out[index] = 0
  }
  return out
}

/* ---------- 4a. outlines ---------- */

/**
 * Every boundary between ink and paper as closed rings of pixel-corner points, ink on
 * the left. Built from the cracks between pixels: each inked pixel contributes the
 * sides it shares with paper (or the image edge), and the cracks are chained end to
 * end. Where two rings touch at a single corner, the walk turns left, keeping them
 * apart.
 */
export function traceOutlines(mask, width, height) {
  const inked = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1
  // Directed edges keyed by their start corner.
  const edges = new Map()
  const key = (x, y) => y * (width + 1) + x
  const add = (x0, y0, x1, y1) => {
    const k = key(x0, y0)
    if (!edges.has(k)) edges.set(k, [])
    edges.get(k).push([x1, y1])
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!inked(x, y)) continue
      // Ink on the left of each directed crack: walk the pixel's boundary anticlockwise (y down).
      if (!inked(x, y - 1)) add(x + 1, y, x, y)
      if (!inked(x - 1, y)) add(x, y, x, y + 1)
      if (!inked(x, y + 1)) add(x, y + 1, x + 1, y + 1)
      if (!inked(x + 1, y)) add(x + 1, y + 1, x + 1, y)
    }
  }

  const rings = []
  for (const [startKey, list] of edges) {
    while (list.length) {
      const sx = startKey % (width + 1)
      const sy = (startKey - sx) / (width + 1)
      const ring = [[sx, sy]]
      let [cx, cy] = list.pop()
      let px = sx
      let py = sy
      let guard = 0
      while ((cx !== sx || cy !== sy) && guard < 4 * mask.length + 8) {
        guard += 1
        ring.push([cx, cy])
        const outgoing = edges.get(key(cx, cy))
        if (!outgoing || !outgoing.length) break
        let pick = 0
        if (outgoing.length > 1) {
          // Prefer the left-most turn relative to the direction we came from.
          const dx = cx - px
          const dy = cy - py
          let bestScore = -Infinity
          outgoing.forEach(([nx, ny], index) => {
            const ox = nx - cx
            const oy = ny - cy
            const cross = dx * oy - dy * ox
            const dot = dx * ox + dy * oy
            const score = Math.atan2(-cross, dot)
            if (score > bestScore) {
              bestScore = score
              pick = index
            }
          })
        }
        const [nx, ny] = outgoing.splice(pick, 1)[0]
        px = cx
        py = cy
        cx = nx
        cy = ny
      }
      if (ring.length >= 4) rings.push(ring)
    }
  }
  return rings
}

/* ---------- 4b. centre lines ---------- */

/** Zhang–Suen thinning: the mask worn down to a one-pixel skeleton. */
export function thin(mask, width, height) {
  const out = mask.slice()
  const at = (x, y) => (x >= 0 && y >= 0 && x < width && y < height ? out[y * width + x] : 0)
  let changed = true
  const doomed = []
  while (changed) {
    changed = false
    for (const pass of [0, 1]) {
      doomed.length = 0
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (!out[y * width + x]) continue
          const p = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)]
          const neighbours = p.reduce((sum, value) => sum + value, 0)
          if (neighbours < 2 || neighbours > 6) continue
          let transitions = 0
          for (let index = 0; index < 8; index += 1) if (!p[index] && p[(index + 1) % 8]) transitions += 1
          if (transitions !== 1) continue
          if (pass === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue
          doomed.push(y * width + x)
        }
      }
      for (const index of doomed) out[index] = 0
      if (doomed.length) changed = true
    }
  }
  return out
}

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]

/**
 * A skeleton walked into polylines: from every end and junction to the next, then
 * whatever is left (closed loops). Branches shorter than `pruneLength` that end in
 * nothing — the spurs thinning leaves on a thick stroke — are dropped.
 */
export function skeletonLines(skeleton, width, height, pruneLength = 8) {
  const on = (x, y) => x >= 0 && y >= 0 && x < width && y < height && skeleton[y * width + x] === 1
  const neighbours = (x, y) => NEIGHBOURS.map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) => on(nx, ny))
  const degree = (x, y) => neighbours(x, y).length
  const used = new Set()
  const edgeKey = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`)
  const index = (x, y) => y * width + x
  const lines = []

  const walk = (x0, y0, x1, y1) => {
    const line = [[x0, y0]]
    let px = x0
    let py = y0
    let cx = x1
    let cy = y1
    used.add(edgeKey(index(px, py), index(cx, cy)))
    for (;;) {
      line.push([cx, cy])
      if (degree(cx, cy) !== 2) break
      const next = neighbours(cx, cy).find(([nx, ny]) => !(nx === px && ny === py) && !used.has(edgeKey(index(cx, cy), index(nx, ny))))
      if (!next) break
      used.add(edgeKey(index(cx, cy), index(next[0], next[1])))
      px = cx
      py = cy
      ;[cx, cy] = next
    }
    return line
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!on(x, y) || degree(x, y) === 2) continue
      for (const [nx, ny] of neighbours(x, y)) {
        if (used.has(edgeKey(index(x, y), index(nx, ny)))) continue
        const line = walk(x, y, nx, ny)
        const [ex, ey] = line[line.length - 1]
        const deadEnd = degree(x, y) === 1 || degree(ex, ey) === 1
        const junctioned = degree(x, y) > 2 || degree(ex, ey) > 2
        if (deadEnd && junctioned && line.length < pruneLength) continue
        lines.push(line)
      }
    }
  }
  // Closed loops have no end or junction to start from.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!on(x, y)) continue
      const free = neighbours(x, y).find(([nx, ny]) => !used.has(edgeKey(index(x, y), index(nx, ny))))
      if (free) lines.push(walk(x, y, free[0], free[1]))
    }
  }
  return lines.filter((line) => line.length >= 2)
}

/* ---------- the whole pipeline ---------- */

/**
 * Trace an image. `scale` maps the traced image's pixels back onto the original's
 * (a picture is traced at no more than 2048 px across). Returns `{ mode, threshold,
 * shapes }`, each shape `{ points, closed, area }` in original pixels.
 */
export function traceImage(image, options = {}, scale = 1) {
  const settings = { ...DEFAULT_TRACE_OPTIONS, ...options }
  const { width, height } = image
  const gray = blur3(luminance(image), width, height)
  const threshold = Number.isFinite(settings.threshold) ? settings.threshold : otsuThreshold(gray)
  let mask = binarize(gray, threshold, settings.invert)
  mask = openMask(mask, width, height)
  mask = removeSmall(mask, width, height, Math.max(1, Math.round(settings.minArea / (scale * scale))))

  const epsilon = Math.max(0.2, settings.detail)
  const shapes = []
  if (settings.mode === 'lines') {
    for (const line of skeletonLines(thin(mask, width, height), width, height, settings.pruneLength)) {
      const centred = line.map(([x, y]) => [x + 0.5, y + 0.5])
      const points = chaikin(simplifyDP(centred, epsilon), settings.smoothing, false)
      shapes.push({ points: points.map(([x, y]) => [x * scale, y * scale]), closed: false, area: 0 })
    }
  } else {
    for (const ring of traceOutlines(mask, width, height)) {
      const simplified = simplifyDP([...ring, ring[0]], epsilon).slice(0, -1)
      if (simplified.length < 3) continue
      const points = chaikin(simplified, settings.smoothing, true)
      shapes.push({ points: points.map(([x, y]) => [x * scale, y * scale]), closed: true, area: ringArea(points) * scale * scale })
    }
  }
  return { mode: settings.mode, threshold, shapes }
}

const fmt = (value) => Math.round(value * 10) / 10

/** The traced shapes as a standalone SVG the size of the original picture. */
export function traceToSvg(result, width, height, color = '#1b1f27') {
  const path = (shape) => {
    let d = `M${fmt(shape.points[0][0])} ${fmt(shape.points[0][1])}`
    for (let index = 1; index < shape.points.length; index += 1) d += `L${fmt(shape.points[index][0])} ${fmt(shape.points[index][1])}`
    return shape.closed ? `${d}Z` : d
  }
  const body = result.mode === 'lines'
    ? `<path d="${result.shapes.map(path).join('')}" fill="none" stroke="${color}" stroke-width="${Math.max(1, width / 1200)}" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="${result.shapes.map(path).join('')}" fill="${color}" fill-opacity="0.18" fill-rule="evenodd" stroke="${color}" stroke-width="${Math.max(1, width / 1500)}" stroke-linejoin="round"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${body}</svg>`
}
