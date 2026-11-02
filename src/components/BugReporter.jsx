/**
 * BugReporter — Help ▸ Report a bug… (⌥⌘B), and the note after a crash.
 *
 * The report is taken the moment the command runs, before the dialog draws, so it
 * shows the app as the bug left it rather than with a dialog open. The writer can
 * add a note and save, or skip the dialog with "Save a bug snapshot" (⌥⇧⌘B). Either
 * way the report goes to this computer's log folder and never holds their writing
 * (src/lib/diagnostics).
 *
 * On launch it mentions, once, any crash report saved since the last launch.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Dialog, Field, Section, TextArea, showToast } from '../ui'
import { useCommands } from '../lib/commands'
import { REPORT_BUG, SHOW_BUG_REPORTS } from '../lib/appEvents'
import { buildReport, describeReport, revealReport, saveBugReport, saveReport, takeNotices } from '../lib/diagnostics'
import './BugReporter.css'

function announceSaved(path) {
  if (!path) {
    showToast({ icon: 'warning', message: 'Couldn’t save the bug report. Try again.' })
    return
  }
  showToast({ icon: 'bug', message: 'Bug report saved', action: { label: 'Show in Finder', run: () => revealReport(path) } })
}

export default function BugReporter() {
  const [open, setOpen] = useState(false)
  const [lines, setLines] = useState(null)
  const [note, setNote] = useState('')
  const pending = useRef(null)

  const start = useCallback(() => {
    const report = buildReport({ kind: 'bug' })
    pending.current = report
    setLines(null)
    setNote('')
    setOpen(true)
    report.then((built) => { if (pending.current === report) setLines(describeReport(built)) })
  }, [])

  const close = useCallback(() => {
    pending.current = null
    setOpen(false)
  }, [])

  const save = async () => {
    const report = pending.current
    close()
    if (report) announceSaved(await saveReport(await report, note))
  }

  const snapshot = useCallback(async () => announceSaved(await saveBugReport()), [])
  const showReports = useCallback(() => revealReport(), [])

  useCommands(() => [
    { id: 'app.report-bug', section: 'App', title: 'Report a bug…', icon: 'bug', keys: 'Mod+Alt+B', keywords: ['problem', 'issue', 'feedback', 'crash'], run: start },
    { id: 'app.bug-snapshot', section: 'App', title: 'Save a bug snapshot', icon: 'bug', keys: 'Mod+Alt+Shift+B', keywords: ['problem', 'issue', 'report', 'quick'], run: snapshot },
    { id: 'app.show-bug-reports', section: 'App', title: 'Show bug reports in Finder', icon: 'folder-open', keywords: ['crash', 'logs', 'diagnostics'], run: showReports },
  ], [start, snapshot, showReports])

  useEffect(() => {
    window.addEventListener(REPORT_BUG, start)
    window.addEventListener(SHOW_BUG_REPORTS, showReports)
    return () => {
      window.removeEventListener(REPORT_BUG, start)
      window.removeEventListener(SHOW_BUG_REPORTS, showReports)
    }
  }, [start, showReports])

  useEffect(() => {
    let live = true
    takeNotices().then((paths) => {
      if (!live || !paths?.length) return
      showToast({
        icon: 'warning',
        message: 'Inkblot ran into a problem last time and saved a report',
        action: { label: 'Show in Finder', run: () => revealReport(paths[paths.length - 1]) },
      })
    })
    return () => { live = false }
  }, [])

  return (
    <Dialog
      open={open}
      onClose={close}
      size="small"
      eyebrow="Help"
      title="Report a bug"
      description="Saved on this Mac. Never includes your writing."
      footer={<><Button onClick={close}>Cancel</Button><Button variant="filled" onClick={save}>Save report</Button></>}
    >
      <Field label="What happened?" hint="Optional. Any of your writing is taken out." htmlFor="bug-report-note">
        <TextArea
          id="bug-report-note"
          rows={4}
          value={note}
          placeholder="What you did, and what you expected"
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              save()
            }
          }}
        />
      </Field>
      <Section id="bug-report-included" title="What’s included" defaultOpen={false}>
        {lines ? (
          <ul className="bug-report-included">
            {lines.map((line) => <li key={line} className="ib-hint">{line}</li>)}
          </ul>
        ) : <p className="ib-hint">Gathering…</p>}
      </Section>
    </Dialog>
  )
}
