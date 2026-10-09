/**
 * mapColors.js — the default colours of things drawn on a map: what a new pin, route,
 * region, body or traveller is painted in until the writer picks another.
 *
 * These are the map's content, stored in the map file, not the app's chrome, so they
 * are literal colours and `npm run lint:design` skips src/lib/map/ (docs/DESIGN.md →
 * Guardrails). The map's look as a whole is its theme (src/map/mapThemes.css).
 */

export const MAP_DEFAULT_COLORS = {
  pin: '#c0392b',
  route: '#b3462f',
  region: '#6d9c5a',
  terrain: '#8a9a5b',
  terrainSwatch: '#888888',
  body: '#9aa7b8',
  blackHole: '#000000',
  blackHoleRim: '#ffb86b',
  travelerLabel: '#ffffff',
}

/** Travellers without a colour of their own take these in turn. */
export const TRAVELER_COLORS = ['#2f7dd1', '#d1532f', '#2f9d6a', '#8a4fd1', '#d19a2f', '#d12f7d', '#2fb3c2']
