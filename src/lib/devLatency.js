/**
 * devLatency.js — slow disk on demand, in development only, to see how loading looks
 * on a project kept on a synced or network drive. Network throttling does nothing
 * here: every read is a local IPC call.
 *
 *   ?latency=300 in the URL, or localStorage['inkblot:dev-latency'] = '300'
 *
 * In a build, and under the unit tests, `slowed` hands back the function untouched.
 */
const readSetting = () => {
  try {
    const fromUrl = new URLSearchParams(globalThis.location?.search || '').get('latency')
    return Number(fromUrl ?? globalThis.localStorage?.getItem('inkblot:dev-latency')) || 0
  } catch {
    return 0
  }
}

const latency = import.meta.env?.DEV ? readSetting() : 0

/** `read`, made to take `latency` ms longer per call when the setting is on. */
export const slowed = (read) => (latency > 0
  ? async (...args) => {
    await new Promise((resolve) => setTimeout(resolve, latency))
    return read(...args)
  }
  : read)
