/**
 * sheetFlight.js — the geometry of a sheet of paper on the landing page growing into
 * the document card (components/landing/SheetFlight.jsx). Pure, so it can be tested.
 *
 * The flight is three layers inside one point at the card's centre:
 *
 *   frame  moves from the sheet's centre to the card's and turns upright
 *   paper  the card's own size, scaled from the sheet's width and height to 1
 *   faces  inside the paper, counter-scaled so the words on them never stretch:
 *          the sheet's face keeps the sheet's layout, the page face the editor's
 *
 * Only transforms change, and every step is computed here and handed to the Web
 * Animations API as linear keyframes, so the whole flight runs on the compositor
 * while the editor mounts underneath. The easing is applied to the values, which is
 * why the keyframes themselves are linear.
 *
 * The flight sets off before the editor exists (mounting it would hold the first
 * frame back), aimed where the card was last time (lib/landingCard.js); once the
 * real card is measured, retargetKeyframes bends the rest of the path onto it.
 */

/** A cubic-bézier easing as a function of time (0…1), solved by Newton's method. */
export function cubicBezier(x1, y1, x2, y2) {
  const ax = 3 * x1 - 3 * x2 + 1
  const bx = 3 * x2 - 6 * x1
  const cx = 3 * x1
  const ay = 3 * y1 - 3 * y2 + 1
  const by = 3 * y2 - 6 * y1
  const cy = 3 * y1
  const x = (t) => ((ax * t + bx) * t + cx) * t
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx
  const y = (t) => ((ay * t + by) * t + cy) * t
  return (time) => {
    if (time <= 0) return 0
    if (time >= 1) return 1
    let t = time
    for (let i = 0; i < 8; i += 1) {
      const error = x(t) - time
      const slope = dx(t)
      if (Math.abs(error) < 1e-6 || Math.abs(slope) < 1e-6) break
      t -= error / slope
    }
    return y(Math.min(1, Math.max(0, t)))
  }
}

/** `cubic-bezier(0.2, 0.7, 0.2, 1)` → an easing function, or null for anything else. */
export function parseCubicBezier(value) {
  const match = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(value || '')
  return match ? cubicBezier(...match.slice(1).map(Number)) : null
}

/** An ease-out, for a flight given no easing of its own (the tests). */
export const easeOut = cubicBezier(0.2, 0.7, 0.2, 1)

const lerp = (a, b, p) => a + (b - a) * p
const round = (value) => Math.round(value * 1000) / 1000
/** 0 → 1 with no corners, for blending one path into another. */
const smooth = (t) => t * t * (3 - 2 * t)

/** Where the paper is at progress `p` from `from` (a sheet, turned) to `to` (the card, upright). */
export function geometryAt(from, to, p) {
  return {
    x: lerp(from.left + from.width / 2, to.left + to.width / 2, p),
    y: lerp(from.top + from.height / 2, to.top + to.height / 2, p),
    width: lerp(from.width, to.width, p),
    height: lerp(from.height, to.height, p),
    rotate: lerp(from.rotate || 0, 0, p),
  }
}

/** The keyframes for a run of paper positions, for layers sized to `to` (the card). */
function keyframesOf(geometries, to, sheet) {
  const toCentre = { x: to.left + to.width / 2, y: to.top + to.height / 2 }
  const frame = []
  const paper = []
  const sheetFace = []
  const pageFace = []
  for (const g of geometries) {
    const kx = g.width / to.width
    const ky = g.height / to.height
    frame.push({ transform: `translate(${round(g.x - toCentre.x)}px, ${round(g.y - toCentre.y)}px) rotate(${round(g.rotate)}deg)` })
    paper.push({ transform: `scale(${round(kx)}, ${round(ky)})` })
    // Each face is scaled uniformly by how wide the paper is against its own width;
    // inside the paper that means dividing out the paper's own (uneven) scale.
    const sheetScale = g.width / sheet.width
    sheetFace.push({ transform: `scale(${round(sheetScale / kx)}, ${round(sheetScale / ky)})` })
    const pageScale = g.width / to.width
    pageFace.push({ transform: `scale(${round(pageScale / kx)}, ${round(pageScale / ky)})` })
  }
  return { frame, paper, sheetFace, pageFace }
}

/**
 * @param {{ from: { left: number, top: number, width: number, height: number, rotate?: number },
 *   to: { left: number, top: number, width: number, height: number },
 *   sheet: { width: number, height: number }, steps?: number, ease?: (t: number) => number }} options
 *   `from` is the sheet as it sits in its pile (its unrotated box, and its turn in
 *   degrees), `to` the card, `sheet` the sheet face's own size.
 */
export function flightKeyframes({ from, to, sheet, steps = 24, ease = easeOut }) {
  const geometries = Array.from({ length: steps + 1 }, (_, i) => geometryAt(from, to, ease(i / steps)))
  return keyframesOf(geometries, to, sheet)
}

/**
 * The rest of a flight that set off for `was` and has learnt, a share `at` of the way
 * through, that the card is at `to`: from where the paper is now it bends onto the
 * new path, so it lands on the card without a jump. For layers sized to `to`.
 */
export function retargetKeyframes({ from, was, to, sheet, at, steps = 16, ease = easeOut }) {
  const geometries = Array.from({ length: steps + 1 }, (_, i) => {
    const t = at + ((1 - at) * i) / steps
    const p = ease(t)
    const a = geometryAt(from, was, p)
    const b = geometryAt(from, to, p)
    const w = smooth(i / steps)
    return Object.fromEntries(Object.keys(a).map((key) => [key, lerp(a[key], b[key], w)]))
  })
  return keyframesOf(geometries, to, sheet)
}

/**
 * Where a point of the paper is on screen at a keyframe — what the tests check the
 * keyframes against (the paper's corners begin on the sheet's and end on the card's).
 */
export function paperPoint({ frame, paper }, to, step, corner) {
  const [, tx, ty, rot] = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) rotate\(([-\d.e]+)deg\)/.exec(frame[step].transform).map(Number)
  const [, kx, ky] = /scale\(([-\d.e]+), ([-\d.e]+)\)/.exec(paper[step].transform).map(Number)
  const local = { x: (corner.x - 0.5) * to.width * kx, y: (corner.y - 0.5) * to.height * ky }
  const angle = (rot * Math.PI) / 180
  return {
    x: to.left + to.width / 2 + tx + local.x * Math.cos(angle) - local.y * Math.sin(angle),
    y: to.top + to.height / 2 + ty + local.x * Math.sin(angle) + local.y * Math.cos(angle),
  }
}

/**
 * The element's box once it has settled: any transition on it (the card's margins
 * glide when a sidebar docks) is switched off for the read, so this is where it is
 * going rather than where it is.
 */
export function measureFinalRect(element) {
  if (!element) return null
  const previous = element.style.transition
  element.style.transition = 'none'
  const rect = element.getBoundingClientRect()
  element.style.transition = previous
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}
