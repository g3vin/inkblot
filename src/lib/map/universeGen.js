/**
 * universeGen.js — a group of galaxies, drawn from a seed: "Fill with galaxies…".
 *
 * Galaxies are not scattered evenly: they gather in clusters, strung together by
 * filaments, with voids between (the cosmic web). This draws a few cluster nodes,
 * joins each to its nearest neighbours, and places galaxies along those filaments
 * and thickest in the clusters — ellipticals and lenticulars mostly in the
 * clusters, spirals and irregulars mostly out in the filaments, as observed.
 *
 * Each galaxy is a pin with a `galaxy` look `{ type, seed, radiusLy }` and a name;
 * opening one makes a galaxy map with that type and seed, so the dot and the map
 * are the same galaxy.
 */
import { gaussian, random } from './seeded'

const CLUSTER_TYPES = ['E0', 'E3', 'E5', 'E7', 'S0', 'S0', 'E0', 'Sa', 'SBa', 'dwarf']
const FIELD_TYPES = ['Sa', 'Sb', 'Sb', 'Sc', 'Sc', 'Sd', 'SBb', 'SBc', 'SBd', 'irregular', 'ring', 'peculiar', 'dwarf', 'S0', 'E3']

const ONSETS = ['', 'b', 'c', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'th', 'sh', 'qu', 'z']
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'ae', 'io', 'ea', 'y']
const CODAS = ['', '', 'n', 'r', 's', 'l', 'x', 'th', 'm']

/** A pronounceable name, from a generator. */
export function galaxyName(rand) {
  const syllables = 2 + Math.floor(rand() * 2)
  let name = ''
  for (let index = 0; index < syllables; index += 1) {
    name += ONSETS[Math.floor(rand() * ONSETS.length)] + VOWELS[Math.floor(rand() * VOWELS.length)]
    if (index === syllables - 1) name += CODAS[Math.floor(rand() * CODAS.length)]
  }
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * `count` galaxies in a box `extentMpc` across (centred on the origin), as pins.
 * `idFor(index)` names each pin's id (so tests can use fixed ids).
 */
export function fillUniverse({ seed = 1, count = 120, extentMpc = 50, idFor = (index) => `g${seed}-${index}` } = {}) {
  const rand = random(seed)
  const half = extentMpc / 2
  const nodes = Array.from({ length: Math.max(3, Math.round(count / 25)) }, () => ({
    at: [(rand() * 2 - 1) * half * 0.85, (rand() * 2 - 1) * half * 0.85, (rand() * 2 - 1) * half * 0.5],
    weight: 0.4 + rand(),
  }))
  // Each node joined to its two nearest: the filaments.
  const filaments = []
  nodes.forEach((node, index) => {
    const nearest = nodes
      .map((other, at) => ({ at, d: Math.hypot(other.at[0] - node.at[0], other.at[1] - node.at[1], other.at[2] - node.at[2]) }))
      .filter((other) => other.at !== index)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2)
    for (const other of nearest) if (!filaments.some(([a, b]) => (a === other.at && b === index))) filaments.push([index, other.at])
  })
  const pins = []
  const weights = nodes.reduce((sum, node) => sum + node.weight, 0)
  for (let index = 0; index < count; index += 1) {
    const inCluster = rand() < 0.45
    let at
    if (inCluster) {
      // A cluster: a tight ball round a node, the heavier nodes the busier.
      let pick = rand() * weights
      let node = nodes[0]
      for (const candidate of nodes) {
        pick -= candidate.weight
        if (pick <= 0) {
          node = candidate
          break
        }
      }
      const spread = extentMpc * 0.025 * node.weight
      at = node.at.map((value) => value + gaussian(rand) * spread)
    } else {
      const [a, b] = filaments[Math.floor(rand() * filaments.length)]
      const t = rand()
      const spread = extentMpc * 0.018
      at = [0, 1, 2].map((axis) => nodes[a].at[axis] + (nodes[b].at[axis] - nodes[a].at[axis]) * t + gaussian(rand) * spread)
    }
    const types = inCluster ? CLUSTER_TYPES : FIELD_TYPES
    const type = types[Math.floor(rand() * types.length)]
    const radiusLy = type === 'dwarf' ? 3000 + rand() * 6000 : /^E/.test(type) ? 30000 + rand() * 120000 : 20000 + rand() * 60000
    pins.push({
      id: idFor(index),
      name: galaxyName(rand),
      at: at.map((value) => Math.round(Math.max(-half, Math.min(half, value)) * 1000) / 1000),
      icon: 'galaxy',
      galaxy: { type, seed: 1 + Math.floor(rand() * 999999), radiusLy: Math.round(radiusLy) },
    })
  }
  return pins
}
