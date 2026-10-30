/**
 * SettingsSheet — Inkblot ▸ Settings… (⌘,): the look of the app, the writing
 * stats — how sittings are measured, goals, the timer's routines and the reminders
 * (InkblotSettingsView.swift, with the page's own View-menu settings beside them) —
 * and the keyboard shortcuts.
 *
 * Every change is saved as it is made.
 */
import { useEffect, useState } from 'react'
import { Button, FormRow, InkPicker, Segmented, Toggle } from '../../ui'
import NavSheet from '../../ui/NavSheet.jsx'
import { useStats } from '../../stats/useStats.js'
import { OPEN_SETTINGS } from '../../stats/timerMenu.js'
import WritingPane from './WritingPane.jsx'
import GoalsPane from './GoalsPane.jsx'
import TimersPane from './TimersPane.jsx'
import RemindersPane from './RemindersPane.jsx'
import ShortcutsPane from './ShortcutsPane.jsx'
import StoryPane from './StoryPane.jsx'
import MapsPane from './MapsPane.jsx'
import SelectionWheelPane from './SelectionWheelPane.jsx'
import './Settings.css'

const PANES = [
  { id: 'general', title: 'General', icon: 'settings' },
  { id: 'writing', title: 'Writing', icon: 'chart' },
  { id: 'wheel', title: 'Selection wheel', icon: 'highlight' },
  { id: 'goals', title: 'Goals', icon: 'target' },
  { id: 'timers', title: 'Timers', icon: 'timer' },
  { id: 'reminders', title: 'Reminders', icon: 'bell' },
  { id: 'story', title: 'Story', icon: 'calendar' },
  { id: 'maps', title: 'Maps', icon: 'map' },
  { id: 'shortcuts', title: 'Shortcuts', icon: 'keyboard' },
]

const THEMES = [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'midnight', label: 'Midnight' }, { value: 'system', label: 'System' }]

function GeneralPane({ appearance }) {
  const { theme, onTheme, accent, onAccent, accentPresets, defaultAccent, tray, onTray, trayInks, defaultTray, wordCount, onWordCount } = appearance
  return (
    <>
      <section className="settings-group">
        <h3 className="ib-eyebrow">Appearance</h3>
        <FormRow label="Theme"><Segmented label="Theme" value={theme} onChange={onTheme} options={THEMES} /></FormRow>
        <FormRow label="Accent colour" stacked help="settings.accent">
          <div className="settings-swatches">
            <InkPicker label="Accent colour" value={accent} onChange={onAccent} inks={accentPresets.map((preset) => preset.id)} />
            <Button size="capsule" disabled={accent === defaultAccent} onClick={() => onAccent(defaultAccent)}>Reset</Button>
          </div>
        </FormRow>
        <FormRow label="Window colour" stacked help="settings.window-colour">
          <div className="settings-swatches">
            <InkPicker label="Window colour" value={tray} onChange={onTray} inks={trayInks} />
            <Button size="capsule" disabled={tray === defaultTray} onClick={() => onTray(defaultTray)}>Reset</Button>
          </div>
        </FormRow>
      </section>
      <section className="settings-group">
        <h3 className="ib-eyebrow">Document</h3>
        <FormRow label="Show word count" help="settings.word-count"><Toggle label="Show word count" checked={wordCount} onChange={onWordCount} /></FormRow>
      </section>
    </>
  )
}

export default function SettingsSheet({ appearance }) {
  const stats = useStats()
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState('general')
  // The project a pane is about: the one that asked (a map's "Story calendar…"), else
  // the one being written in.
  const [askedProject, setAskedProject] = useState(null)

  useEffect(() => {
    const show = (event) => {
      setPane(PANES.some((p) => p.id === event.detail?.pane) ? event.detail.pane : 'general')
      setAskedProject(event.detail?.projectName || null)
      setOpen(true)
    }
    window.addEventListener(OPEN_SETTINGS, show)
    return () => window.removeEventListener(OPEN_SETTINGS, show)
  }, [])

  if (!open) return null
  return (
    <NavSheet title="Settings" items={PANES} value={pane} onChange={setPane} onClose={() => setOpen(false)} className="settings-sheet">
      {pane === 'general' ? <GeneralPane appearance={appearance} /> : null}
      {pane === 'writing' ? <WritingPane stats={stats} /> : null}
      {pane === 'wheel' ? <SelectionWheelPane /> : null}
      {pane === 'goals' ? <GoalsPane stats={stats} /> : null}
      {pane === 'timers' ? <TimersPane stats={stats} /> : null}
      {pane === 'reminders' ? <RemindersPane stats={stats} /> : null}
      {pane === 'shortcuts' ? <ShortcutsPane /> : null}
      {pane === 'maps' ? <MapsPane /> : null}
      {pane === 'story' ? <StoryPane projectName={askedProject || stats.tracker?.project || null} /> : null}
    </NavSheet>
  )
}
