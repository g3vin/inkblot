/**
 * runReport.js — Script Production ▸ Reports ▸ … as a spreadsheet: asks where, writes
 * the CSV, and reports the job as an export does (printJobStatus.js), so the Publish
 * tab says where it went. Printing a report is a print job (printJob.js).
 */
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'

import { readDocPageSetup } from '../print/DocPageSetup'
import { printedPageAt } from '../print/printJob'
import { describeError, newJobId, reportJob } from '../print/printJobStatus'
import { breakdown, REPORT_TITLES, reportCsv } from './reports'

export async function saveScriptReport({ editor, docPath, report }) {
  if (!editor || !docPath || !REPORT_TITLES[report]) return null
  const jobId = newJobId()
  const status = (phase, extra = {}) => reportJob({ jobId, kind: 'export', format: 'csv', phase, ...extra })
  const name = docPath.split('/').pop() || 'Script'
  try {
    const path = await save({
      title: `Save ${REPORT_TITLES[report]}`,
      defaultPath: `${name} – ${REPORT_TITLES[report]}.csv`.replace(/[/\\:*?"<>|]+/g, '-'),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (!path) return null
    status('preparing')
    const data = breakdown(editor.state.doc, printedPageAt(editor, readDocPageSetup(editor.state.doc)) || undefined)
    await writeTextFile(path, reportCsv(report, data))
    status('done', { path })
    return path
  } catch (error) {
    status('failed', { message: describeError(error) })
    throw error
  }
}
