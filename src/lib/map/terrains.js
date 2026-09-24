/**
 * terrains.js — the terrains a new map starts with.
 *
 * A terrain is a name and speed multipliers (see travel.js); a region painted with
 * it slows or speeds whatever crosses it. These are a starting set a writer can edit
 * or add to on any map. Each also suggests how a region of it is drawn.
 */
export const DEFAULT_TERRAINS = [
  { id: 'road', name: 'Road', multipliers: { '*land': 1.25, cart: 1.5 }, fill: '#c9a66b', hatch: 'none' },
  { id: 'plains', name: 'Plains', multipliers: {}, fill: '#b9d58a', hatch: 'none' },
  { id: 'forest', name: 'Forest', multipliers: { walk: 0.7, horse: 0.5, gallop: 0.4, cart: 0.3, car: 0.25, '*land': 0.6 }, fill: '#4f8a4b', hatch: 'dots' },
  { id: 'hills', name: 'Hills', multipliers: { '*land': 0.7, cart: 0.5 }, fill: '#a8b86a', hatch: 'waves' },
  { id: 'mountains', name: 'Mountains', multipliers: { walk: 0.4, horse: 0.25, gallop: 0.2, cart: 0, car: 0.15, train: 0.5, '*land': 0.35 }, fill: '#9a8f86', hatch: 'mountains' },
  { id: 'swamp', name: 'Swamp', multipliers: { walk: 0.4, horse: 0.25, gallop: 0.2, cart: 0, car: 0, '*land': 0.3 }, fill: '#6f7d4a', hatch: 'waves' },
  { id: 'desert', name: 'Desert', multipliers: { walk: 0.7, horse: 0.6, '*land': 0.7 }, fill: '#e3c98a', hatch: 'dots' },
  { id: 'ice', name: 'Ice and snow', multipliers: { '*land': 0.5, car: 0.3 }, fill: '#e6eef5', hatch: 'cross' },
  { id: 'water', name: 'Water', multipliers: { '*land': 0, '*water': 1 }, fill: '#7fb2d6', hatch: 'none' },
  { id: 'rough-sea', name: 'Rough sea', multipliers: { '*water': 0.6, rowboat: 0 }, fill: '#4f7fa8', hatch: 'waves' },
]

/** The terrain entries a map stores (fill and hatch are suggestions, kept alongside). */
export const defaultTerrainEntries = () =>
  DEFAULT_TERRAINS.map(({ id, name, multipliers, fill, hatch }) => ({ id, name, multipliers: { ...multipliers }, fill, hatch }))
