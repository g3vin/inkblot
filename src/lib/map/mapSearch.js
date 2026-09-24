/**
 * mapSearch.js — finding text on a map.
 *
 * Like a canvas, a map has no document positions: its text is the names of its
 * pins, routes, regions and travelers and the text of its labels, so a hit is
 * addressed by the ITEM's id (`nodeId`, the same field canvas hits use) and
 * revealing it means selecting and centering that item.
 *
 * A pin or traveler with no name of its own shows its linked doc's name, so it is
 * searched by that doc's path.
 *
 * Mirrors `collect_map_matches` in `inkblot_core::search`.
 */

const MATCH_PREVIEW_RADIUS = 34

const preview = (text, index, length) => {
  const start = Math.max(0, index - MATCH_PREVIEW_RADIUS)
  const end = Math.min(text.length, index + length + MATCH_PREVIEW_RADIUS)
  return text.slice(start, end).trim()
}

const titleOf = (text, fallback) => {
  const firstLine = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  if (!firstLine) return fallback
  return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine
}

/** [collection, text key, fallback key, title for a nameless one], in search order. */
const FIELDS = [
  ['pins', 'name', 'doc', 'Place'],
  ['routes', 'name', null, 'Route'],
  ['regions', 'name', null, 'Region'],
  ['labels', 'text', null, 'Label'],
  ['travelers', 'name', 'doc', 'Traveler'],
]

const stringAt = (item, key) => (key && typeof item[key] === 'string' ? item[key] : '')

/** Every match for `matcher` on a map's raw (on-disk) JSON. */
export function collectMapMatches(raw, matcher, docPath, { limit = Infinity } = {}) {
  if (!raw || !matcher || matcher.isEmpty || !matcher.valid) return []
  const matches = []

  for (const [collection, key, fallback, nameless] of FIELDS) {
    for (const item of Array.isArray(raw[collection]) ? raw[collection] : []) {
      if (matches.length >= limit) return matches
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) continue

      const text = stringAt(item, key) || stringAt(item, fallback)
      if (!text) continue
      const title = titleOf(text, nameless)

      matcher.findAll(text, limit - matches.length).forEach((hit) => {
        matches.push({
          id: `${docPath}-${item.id}-${hit.index}`,
          type: 'map-match',
          docName: docPath,
          path: docPath,
          nodeId: item.id,
          title,
          preview: preview(text, hit.index, hit.length),
          matchText: hit.text,
        })
      })
    }
  }

  return matches
}
