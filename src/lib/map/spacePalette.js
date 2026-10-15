/**
 * spacePalette.js — the colours the 3D views draw space in.
 *
 * Map content, like the globe's style and the map themes: the colour of a black
 * hole's disc or a pulsar's beam is part of the picture, not the app's chrome, so
 * these are raw values (and `npm run lint:design` skips src/lib/map/).
 */

/** The Cinematic look: a dark sky and soft, cool lines. */
export const CINEMATIC = {
  background: '#03050b',
  orbit: '#8ea6cc',
  grid: '#6c82a8',
  habitable: '#3fbf7f',
  belt: '#a49c90',
  trail: '#a7bbe0',
}

/** What stars and their surroundings are drawn in (starMeshes.js). */
export const STAR_PARTS = {
  holeHot: '#fff3d6',
  holeCool: '#ff5a1f',
  photonRing: '#ffd9a8',
  dustHot: '#ffcf8a',
  dustCool: '#5a3524',
  jet: '#9fc4ff',
  pulsarBeam: '#cfe0ff',
  fieldLine: '#b89cff',
  stream: '#ffcf9a',
  glowStops: [
    [0, 'rgba(255,255,255,1)'],
    [0.08, 'rgba(255,255,255,0.85)'],
    [0.25, 'rgba(255,255,255,0.28)'],
    [0.55, 'rgba(255,255,255,0.07)'],
    [1, 'rgba(255,255,255,0)'],
  ],
}

/** What worlds are drawn in (planetMeshes.js). */
export const WORLD_PARTS = {
  sea: '#1d3f6e',
  ice: '#eef3f7',
  atmosphere: '#8fc2ff',
  rings: '#d8c7a0',
}

/** The ink region masks are rasterized with (planetSurface.js): only its coverage counts. */
export const MASK_INK = '#fff'

/** What galaxies are drawn in (galaxyScene.js). */
export const GALAXY_PARTS = {
  dust: '#1c130d',
  core: '#ffe2bd',
  coreStops: [
    [0, 'rgba(255,255,255,0.95)'],
    [0.15, 'rgba(255,255,255,0.5)'],
    [0.45, 'rgba(255,255,255,0.12)'],
    [1, 'rgba(255,255,255,0)'],
  ],
}
