/**
 * Settings ▸ Writing: how sittings are measured. Each change is saved as it is
 * made; the tracker reads the config live, so it applies to the session in progress.
 */
import { useState } from 'react'
import { Button, FormRow, SelectMenu, Toggle } from '../../ui'

const minutes = (seconds) => (seconds === 60 ? '1 minute' : `${seconds / 60} minutes`)
const short = (seconds) => (seconds < 60 ? `${seconds} seconds` : minutes(seconds))

const CUTOFFS = [60, 120, 300, 600, 900, 1800].map((s) => ({ value: String(s), label: minutes(s) }))
const GAPS = [5, 10, 15, 30, 60, 120].map((s) => ({ value: String(s), label: short(s) }))
const MINIMUMS = [0, 15, 30, 60, 120].map((s) => ({ value: String(s), label: s === 0 ? 'Keep every session' : short(s) }))

export default function WritingPane({ stats }) {
  const config = stats.config
  const set = (key, value) => stats.saveConfig({ ...config, [key]: value })
  const [confirming, setConfirming] = useState(false)
  const project = stats.tracker.project
  return (
    <>
      <section className="settings-group">
        <h3>Sessions</h3>
        <FormRow label="End a session after"><SelectMenu label="End a session after" value={String(config.idleCutoff)} options={CUTOFFS} onChange={(v) => set('idleCutoff', Number(v))} /></FormRow>
        <FormRow label="Count pauses as typing up to"><SelectMenu label="Count pauses as typing up to" value={String(config.activeGap)} options={GAPS} onChange={(v) => set('activeGap', Number(v))} /></FormRow>
        <FormRow label="Keep sessions shorter than that only with writing"><SelectMenu label="Minimum session" value={String(config.minimumSession)} options={MINIMUMS} onChange={(v) => set('minimumSession', Number(v))} /></FormRow>
        <p className="settings-footer">A session ends when you move to another document, or have been away longer than this. Time between edits counts as typing when the gap is shorter than the pause setting.</p>
      </section>
      <section className="settings-group">
        <FormRow label="Count pasted words as written"><Toggle label="Count pasted words as written" checked={config.countPastedWords} onChange={(v) => set('countPastedWords', v)} /></FormRow>
        <p className="settings-footer">Pasted and dropped words are always kept, and shown apart. This decides whether they count toward words written.</p>
      </section>
      <section className="settings-group">
        {confirming ? (
          <div className="settings-confirm" role="alertdialog" aria-label="Reset all writing stats?">
            <strong>Reset writing stats?</strong>
            <p className="settings-footer">Every session, and the totals made from them, is removed. This cannot be undone.</p>
            <div className="settings-actions">
              <Button onClick={() => setConfirming(false)}>Cancel</Button>
              {project ? <Button variant="destructive" onClick={() => { stats.resetStats({ project }); setConfirming(false) }}>Reset {project} Only</Button> : null}
              <Button variant="destructive" onClick={() => { stats.resetStats({}); setConfirming(false) }}>Reset everything</Button>
            </div>
          </div>
        ) : (
          <Button variant="destructive" onClick={() => setConfirming(true)}>Reset writing stats…</Button>
        )}
        <p className="settings-footer">Stats are kept on this computer, not in your projects.</p>
      </section>
    </>
  )
}
