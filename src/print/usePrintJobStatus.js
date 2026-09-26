/**
 * usePrintJobStatus.js — the latest print or export's status, as a line to show.
 *
 * For the page's own chrome (the Tauri Page Setup sheet); the Swift Finishing tabs get
 * the same statuses over the bridge. A finished job's line stays a few seconds and
 * then goes; a failure stays until the next job, so it is read.
 */
import { useEffect, useState } from 'react'

const FORMAT_LABELS = { pdf: 'PDF', epub: 'EPUB', markdown: 'Markdown', html: 'HTML', docx: 'Word', plainText: 'Plain Text', fountain: 'Fountain', fdx: 'Final Draft', csv: 'Report', coverPdf: 'Cover PDF' }
const DONE_LINGER_MS = 6000

const fileName = (path) => (path || '').split(/[/\\]/).pop()

/** The line for a status. Exported for the tests. */
export const describeJob = (status) => {
  const what = status.kind === 'export' ? `Exporting ${FORMAT_LABELS[status.format] || ''}`.trim() : 'Printing'
  switch (status.phase) {
    case 'preparing': return `${what}…`
    case 'laying': return status.total > 1 ? `${what}: laying out chapter ${Math.min(status.done + 1, status.total)} of ${status.total}…` : `${what}…`
    case 'writing': return `${what}…`
    case 'done': return status.path ? `Saved ${fileName(status.path)}` : 'Sent to the printer'
    case 'cancelled': return ''
    case 'failed': return `Could not ${status.kind === 'export' ? 'export' : 'print'}: ${status.message || 'something went wrong.'}`
    default: return ''
  }
}

export function usePrintJobStatus() {
  const [job, setJob] = useState(null)

  useEffect(() => {
    let timer = null
    const onStatus = (event) => {
      const status = event.detail
      clearTimeout(timer)
      const text = describeJob(status)
      setJob(text ? { ...status, text } : null)
      if (status.phase === 'done') timer = setTimeout(() => setJob(null), DONE_LINGER_MS)
    }
    window.addEventListener('inkblot:print-job', onStatus)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('inkblot:print-job', onStatus)
    }
  }, [])

  return job
}
