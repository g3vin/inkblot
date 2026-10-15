/**
 * planetSurface.js — a world's surface picture, drawn in a worker and kept.
 *
 * `drawSurface` asks planetTexture.worker.js (or, where a module worker will not
 * start, the main thread) and caches the last few results by what they depend on,
 * so returning to a world, or undoing an edit, is instant. `regionMask` rasterizes
 * the regions a writer drew into the mask the generator reads.
 */
import { planetTexture, planetTextureKey, TERRAIN_MASK, MASK_LAND } from '../../lib/map/planetTexture'
import { MASK_INK } from '../../lib/map/spacePalette'

const CACHE_SIZE = 6
const cache = new Map()
let worker = null
let nextJob = 0
const pending = new Map()

function viaWorker(look, size, mask) {
  try {
    if (!worker) {
      worker = new Worker(new URL('../../lib/map/planetTexture.worker.js', import.meta.url), { type: 'module' })
      worker.onmessage = (event) => {
        const job = pending.get(event.data.id)
        if (!job) return
        pending.delete(event.data.id)
        if (event.data.error) job.reject(new Error(event.data.error))
        else job.resolve(event.data.result)
      }
      worker.onerror = () => {
        for (const job of pending.values()) job.fallback()
        pending.clear()
        worker = null
      }
    }
    const id = (nextJob += 1)
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, fallback: () => resolve(planetTexture(look, { ...size, mask })) })
      worker.postMessage({ id, look, size, mask })
    })
  } catch {
    return Promise.resolve(planetTexture(look, { ...size, mask }))
  }
}

/** The surface for `look` at `size`, with `mask` (keyed by `maskKey`) applied. */
export function drawSurface(look, size, mask = null, maskKey = '') {
  const key = planetTextureKey(look, size, maskKey)
  if (cache.has(key)) {
    const hit = cache.get(key)
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const job = viaWorker(look, size, mask)
  cache.set(key, job)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value)
  job.catch(() => cache.delete(key))
  return job
}

/**
 * The regions a writer drew, as a mask the size of the surface: each region's
 * terrain decides what it paints (land, water, mountains, ice…), drawn in order so
 * a lake drawn on a continent stays a lake. `null` when there is nothing drawn.
 */
export function regionMask(map, size) {
  const terrains = new Map(map.terrains.map((terrain) => [terrain.id, terrain]))
  const drawn = map.regions.filter((region) => region.rings?.some((ring) => ring.length >= 3))
  if (!drawn.length) return { mask: null, key: '' }
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const x = (lon) => ((lon + 180) / 360) * size.width
  const y = (lat) => ((90 - lat) / 180) * size.height
  const trace = (region) => {
    // Three times, a world apart, so a region across the antimeridian wraps.
    for (const shift of [-360, 0, 360]) {
      for (const ring of region.rings) {
        let previous = null
        ring.forEach((point, index) => {
          let lon = point[0]
          if (previous !== null) {
            while (lon - previous > 180) lon -= 360
            while (lon - previous < -180) lon += 360
          }
          previous = lon
          if (index === 0) context.moveTo(x(lon + shift), y(point[1]))
          else context.lineTo(x(lon + shift), y(point[1]))
        })
        context.closePath()
      }
    }
  }
  // Regions in drawing order, a run of the same terrain at a time: each run is
  // filled, and the pixels it covers (more than half) take its code. Codes never
  // blend, so a border between mountains and plains is never a line of water.
  const mask = new Uint8Array(size.width * size.height)
  const codeOf = (region) => TERRAIN_MASK[terrains.get(region.terrain)?.id || region.terrain] ?? MASK_LAND
  let start = 0
  while (start < drawn.length) {
    const code = codeOf(drawn[start])
    let end = start
    while (end < drawn.length && codeOf(drawn[end]) === code) end += 1
    context.clearRect(0, 0, size.width, size.height)
    context.fillStyle = MASK_INK
    context.beginPath()
    for (let index = start; index < end; index += 1) trace(drawn[index])
    context.fill('evenodd')
    const { data } = context.getImageData(0, 0, size.width, size.height)
    for (let index = 0; index < mask.length; index += 1) if (data[index * 4 + 3] > 127) mask[index] = code
    start = end
  }
  const key = JSON.stringify(drawn.map((region) => [region.id, region.terrain, region.rings]))
  return { mask, key }
}
