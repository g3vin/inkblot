/**
 * SettingsSheet — Inkblot ▸ Settings… (⌘,): the look of the app, the writing
 * stats — how sittings are measured, goals, the timer's routines and the reminders
 * (InkblotSettingsView.swift, with the page's own View-menu settings beside them) —
 * and the keyboard shortcuts.
 *
 * Every change is saved as it is made.
 */
import { useEffect, useState } from 'react'
import { Button, FormRow, InkPicker, Segmented, Sheet, Toggle } from '../../ui'
import Icon from '../../ui/Icon.jsx'
import { useStats } from '../../stats/useStats.js'
import { OPEN_SETTINGS } from '../../stats/timerMenu.js'
import WritingPane from './WritingPane.jsx'
import GoalsPane from './GoalsPane.jsx'
import TimersPane from './TimersPane.jsx'
import RemindersPane from './RemindersPane.jsx'
import ShortcutsPane from './ShortcutsPane.jsx'
import './Settings.css'

const PANES = [
  { id: 'general', title: 'General', icon: 'settings' },
  { id: 'writing', title: 'Writing', icon: 'chart' },
  { id: 'goals', title: 'Goals', icon: 'target' },
  { id: 'timers', title: 'Timers', icon: 'timer' },
  { id: 'reminders', title: 'Reminders', icon: 'bell' },
  { id: 'shortcuts', title: 'Shortcuts', icon: 'keyboard' },
]

const THEMES = [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]

function GeneralPane({ appearance }) {
  const { theme, onTheme, accent, onAccent, accentPresets, defaultAccent, wordCount, onWordCount } = appearance
  return (
    <>
      <section className="settings-group">
        <h3>Appearance</h3>
        <FormRow label="Theme"><Segmented label="Theme" value={theme} onChange={onTheme} options={THEMES} /></FormRow>
        <FormRow label="Accent colour" stacked>
          <div className="settings-swatches">
            <InkPicker label="Accent colour" value={accent} onChange={onAccent} inks={accentPresets.map((preset) => preset.id)} />
            <Button size="capsule" disabled={accent === defaultAccent} onClick={() => onAccent(defaultAccent)}>Reset</Button>
          </div>
        </FormRow>
        <p className="settings-footer">Tints selections, focus rings and primary buttons. Ink Blue is Inkblot’s own.</p>
      </section>
      <section className="settings-group">
        <FormRow label="Show word count"><Toggle label="Show word count" checked={wordCount} onChange={onWordCount} /></FormRow>
        <p className="settings-footer">The count floats at the foot of each document.</p>
      </section>
    </>
  )
}

export default function SettingsSheet({ appearance }) {
  const stats = useStats()
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState('general')

  useEffect(() => {
    const show = (event) => {
      setPane(PANES.some((p) => p.id === event.detail?.pane) ? event.detail.pane : 'general')
      setOpen(true)
    }
    window.addEventListener(OPEN_SETTINGS, show)
    return () => window.removeEventListener(OPEN_SETTINGS, show)
  }, [])

  if (!open) return null
  return (
    <Sheet title="Settings" onClose={() => setOpen(false)} width={640} className="settings-sheet">
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings">
          {PANES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={pane === item.id ? 'page' : undefined}
              // One stop in the tab order, on the pane showing; ↑/↓ move between them.
              tabIndex={pane === item.id ? 0 : -1}
              onClick={() => setPane(item.id)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                event.preventDefault()
                const nav = event.currentTarget.parentElement
                const at = PANES.findIndex((p) => p.id === pane)
                const next = PANES[(at + (event.key === 'ArrowDown' ? 1 : PANES.length - 1)) % PANES.length]
                setPane(next.id)
                requestAnimationFrame(() => nav?.querySelector('[aria-current="page"]')?.focus())
              }}
            >
              <Icon name={item.icon} />{item.title}
            </button>
          ))}
        </nav>
        <div className="settings-pane" key={pane}>
          {pane === 'general' ? <GeneralPane appearance={appearance} /> : null}
          {pane === 'writing' ? <WritingPane stats={stats} /> : null}
          {pane === 'goals' ? <GoalsPane stats={stats} /> : null}
          {pane === 'timers' ? <TimersPane stats={stats} /> : null}
          {pane === 'reminders' ? <RemindersPane stats={stats} /> : null}
          {pane === 'shortcuts' ? <ShortcutsPane /> : null}
        </div>
      </div>
    </Sheet>
  )
}
