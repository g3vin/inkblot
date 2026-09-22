/**
 * `format_js_number` against JavaScript's own `String(x)`.
 *
 * This is the load-bearing one. Rust and JS pick the same digits but not the same
 * envelope — Rust never goes exponential — so every string the core builds out of a
 * float (the world transform, an SVG path) depends on this agreeing. The corpus
 * deliberately straddles both switchover points, 1e21 and 1e-7.
 */

/** JSON cannot carry NaN, ±Infinity or -0; the Rust side reads these spellings. */
const encode = (value) => {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Infinity) return 'Infinity'
  if (value === -Infinity) return '-Infinity'
  if (Object.is(value, -0)) return '-0'
  return value
}

const VALUES = [
  0, -0, 1, -1, 42, -42, 0.5, -0.5, 0.1, 0.2, 0.1 + 0.2, 1 / 3, 2 / 3,
  Math.PI, Math.E, Math.sqrt(2),
  NaN, Infinity, -Infinity,
  Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER,
  Number.MAX_VALUE, Number.MIN_VALUE, Number.EPSILON,
  // The positional/exponential switchover, from both sides.
  1e20, 1e21, 1e22, 9.999999999999999e20, 1.0000000000000001e21,
  1e-6, 1e-7, 1e-8, 1.5e-7, 9.999999e-7,
  -1e21, -1e-7,
  // Zoom levels and coordinates the canvas actually produces.
  0.1, 0.35, 1.73, 2.4, 4, 1 / 0.35, 1920 / 7, -0.30000000000000004,
]

/** A deterministic spread of doubles: same corpus on every run, no seed file. */
function* generated() {
  let state = 0x2f6e2b1
  const next = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
  for (let i = 0; i < 2000; i++) {
    const magnitude = 10 ** Math.round(next() * 60 - 30)
    const value = (next() * 2 - 1) * magnitude
    yield value
    yield Math.round(value)
    yield 1 / value
  }
}

export default {
  name: 'jsNumber',
  *cases() {
    for (const value of [...VALUES, ...generated()]) {
      yield { fn: 'formatJsNumber', args: [encode(value)], expected: String(value) }
    }
  },
}
