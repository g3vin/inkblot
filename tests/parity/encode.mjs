/**
 * JSON cannot carry NaN, ±Infinity or -0, and every one of those is a case the canvas
 * math has an opinion about (`Math.min` propagates NaN; Rust's `f64::min` does not).
 * The corpus spells them as strings and the Rust side reads the same spellings.
 */
export const encodeNumber = (value) => {
  if (typeof value !== 'number') return value
  if (Number.isNaN(value)) return 'NaN'
  if (value === Infinity) return 'Infinity'
  if (value === -Infinity) return '-Infinity'
  if (Object.is(value, -0)) return '-0'
  return value
}

/** `encodeNumber` applied to every number in a structure. */
export const encode = (value) => {
  if (typeof value === 'number') return encodeNumber(value)
  if (Array.isArray(value)) return value.map(encode)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, encode(inner)]))
  }
  return value
}
