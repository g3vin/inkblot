/**
 * printJobStatus.js — where a print or export has got to, for whoever shows it.
 *
 * Every status goes out as a `printJobStatus` event — the Print & Export tab shows it —
 * and as an `inkblot:print-job` window event, for the Page Setup sheet. A job's statuses share its id; the last is `done`,
 * `failed` or `cancelled`, and a failure says what went wrong rather than only
 * reaching the console.
 */
import { documentSurface } from '../bridge'

export const newJobId = () => `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

/** A message fit to show: an Error's, a string, or a generic line. */
export const describeError = (error) => {
  if (!error) return 'Something went wrong.'
  if (typeof error === 'string') return error
  return error.message || String(error)
}

/**
 * Report one step of a job. `status` is a `PrintJobStatus`: `{ jobId, kind, phase }`
 * and, as they apply, `format`, `done`/`total`, `message` and `path`.
 */
export const reportJob = (status) => {
  const payload = Object.fromEntries(Object.entries(status).filter(([, value]) => value !== undefined && value !== null))
  try {
    documentSurface.publishPrintJobStatus(payload)
  } catch (error) {
    console.error('[print] could not report job status:', error)
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('inkblot:print-job', { detail: payload }))
  }
}
