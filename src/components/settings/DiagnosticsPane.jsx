/**
 * Settings ▸ Bug reports: how many bug and crash reports are saved, where, and a way
 * to delete them. Reports are always kept, on this computer only (src/lib/diagnostics),
 * so there is nothing to switch on or off.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, FormRow } from '../../ui'
import { useCommandList } from '../../lib/commands'
import { deleteAllReports, reportCounts, revealReport } from '../../lib/diagnostics'

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`

export default function DiagnosticsPane() {
  const [counts, setCounts] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const reportBug = useCommandList().find((command) => command.id === 'app.report-bug')

  const refresh = useCallback(() => { reportCounts().then(setCounts) }, [])
  useEffect(refresh, [refresh])

  const total = counts ? counts.reports + counts.crashes : 0
  const summary = counts
    ? `${plural(counts.reports, 'bug report', 'bug reports')}, ${plural(counts.crashes, 'crash report', 'crash reports')}`
    : 'Saved only in the app'

  return (
    <>
      <section className="settings-group">
        <h3 className="ib-eyebrow">Bug reports</h3>
        <FormRow label="Saved on this Mac" help="diagnostics.reports">
          <span className="ib-meta">{summary}</span>
        </FormRow>
        <div className="settings-actions">
          {reportBug ? <Button variant="tinted" onClick={() => reportBug.run()}>Report a bug…</Button> : null}
          <Button disabled={!counts} onClick={() => revealReport()}>Show in Finder</Button>
        </div>
      </section>
      <section className="settings-group">
        {confirming ? (
          <div className="settings-confirm" role="alertdialog" aria-label="Delete all bug reports?">
            <strong>Delete all bug reports?</strong>
            <p className="ib-hint">Every bug report and crash report on this Mac is removed. This cannot be undone.</p>
            <div className="settings-actions">
              <Button onClick={() => setConfirming(false)}>Cancel</Button>
              <Button variant="destructive" onClick={async () => { await deleteAllReports(); setConfirming(false); refresh() }}>Delete all</Button>
            </div>
          </div>
        ) : (
          <Button variant="destructive" disabled={!total} onClick={() => setConfirming(true)}>Delete all reports…</Button>
        )}
      </section>
    </>
  )
}
