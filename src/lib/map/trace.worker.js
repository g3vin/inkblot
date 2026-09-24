/**
 * trace.worker.js — runs the tracer off the main thread, so tracing a large scan
 * never freezes the map. One message in (`{ id, image, options, scale }`), one out
 * (`{ id, result }` or `{ id, error }`).
 */
import { traceImage } from './trace'

self.onmessage = (event) => {
  const { id, image, options, scale } = event.data || {}
  try {
    const result = traceImage(image, options, scale)
    self.postMessage({ id, result })
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) })
  }
}
