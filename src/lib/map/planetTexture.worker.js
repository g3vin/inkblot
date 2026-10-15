/**
 * planetTexture.worker.js — draws a world's surface off the main thread, so a new
 * seed or palette never freezes the map. One message in (`{ id, look, size, mask }`),
 * one out (`{ id, result }` or `{ id, error }`), the picture's buffers transferred.
 */
import { planetTexture } from './planetTexture'

self.onmessage = (event) => {
  const { id, look, size, mask } = event.data || {}
  try {
    const result = planetTexture(look, { ...size, mask })
    self.postMessage({ id, result }, [result.color.buffer, result.relief.buffer])
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) })
  }
}
