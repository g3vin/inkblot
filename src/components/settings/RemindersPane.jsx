/**
 * Settings ▸ Reminders: when Inkblot reminds the writer to write, and when it keeps
 * quiet (ReminderSettings.swift). Reminders are posted while Inkblot is open.
 */
import { FormRow, IconButton, SelectMenu, Toggle } from '../../ui'
import { REMINDER_KINDS, newReminder } from '../../stats/goals.js'
import { requestNotificationPermission } from '../../stats/announcer.js'
import WeekdayToggles from './WeekdayToggles.jsx'

const hourLabel = (hour) => new Date(2023, 0, 1, hour).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
const HOURS = Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: hourLabel(hour) }))
const ADD = [
  { value: '', label: 'Add reminder…', disabled: true },
  { value: 'write', label: 'Time to write' },
  { value: 'goalNudge', label: 'Goal not met yet' },
  { value: 'streakAtRisk', label: 'Streak at risk' },
]
const pad = (n) => String(n).padStart(2, '0')

function ReminderRow({ reminder, onChange, onDelete }) {
  const change = (patch) => onChange({ ...reminder, ...patch })
  return (
    <div className="settings-reminder" data-enabled={reminder.enabled}>
      <div className="settings-segment-row">
        <Toggle label={`${REMINDER_KINDS[reminder.kind]} on`} checked={reminder.enabled} onChange={(enabled) => change({ enabled })} />
        <strong className="settings-grow">{REMINDER_KINDS[reminder.kind]}</strong>
        <input
          type="time"
          className="settings-input"
          aria-label="Time"
          value={`${pad(reminder.hour)}:${pad(reminder.minute)}`}
          onChange={(event) => {
            const [hour, minute] = event.target.value.split(':').map(Number)
            if (Number.isFinite(hour) && Number.isFinite(minute)) change({ hour, minute })
          }}
        />
        <IconButton icon="delete" label="Delete reminder" size="capsule" onClick={onDelete} />
      </div>
      <WeekdayToggles value={reminder.weekdays} onChange={(weekdays) => change({ weekdays })} />
      <input className="settings-input" aria-label="Message" placeholder="Inkblot’s own words" value={reminder.message} onChange={(event) => change({ message: event.target.value })} />
    </div>
  )
}

export default function RemindersPane({ stats }) {
  const config = stats.config
  const save = (next) => stats.saveConfig(next)
  const setQuiet = (patch) => save({ ...config, quietHours: { ...config.quietHours, ...patch } })
  return (
    <>
      <section className="settings-group">
        <h3>Reminders</h3>
        {config.reminders.map((reminder) => (
          <ReminderRow
            key={reminder.id}
            reminder={reminder}
            onChange={(next) => save({ ...config, reminders: config.reminders.map((r) => (r.id === next.id ? next : r)) })}
            onDelete={() => save({ ...config, reminders: config.reminders.filter((r) => r.id !== reminder.id) })}
          />
        ))}
        <div className="settings-actions">
          <SelectMenu label="Add reminder" value="" options={ADD} onChange={(kind) => {
            if (!kind) return
            save({ ...config, reminders: [...config.reminders, newReminder(kind)] })
            requestNotificationPermission()
          }} />
        </div>
        <p className="settings-footer">“Goal not met yet” says how far off today’s goal is, and is withdrawn once it’s met. “Streak at risk” comes only on a day that doesn’t count yet. Reminders are sent while Inkblot is open.</p>
      </section>
      <section className="settings-group">
        <FormRow label="Quiet hours"><Toggle label="Quiet hours" checked={config.quietHours.enabled} onChange={(enabled) => setQuiet({ enabled })} /></FormRow>
        {config.quietHours.enabled ? (
          <>
            <FormRow label="From"><SelectMenu label="From" value={String(config.quietHours.startHour)} options={HOURS} onChange={(v) => setQuiet({ startHour: Number(v) })} /></FormRow>
            <FormRow label="Until"><SelectMenu label="Until" value={String(config.quietHours.endHour)} options={HOURS} onChange={(v) => setQuiet({ endHour: Number(v) })} /></FormRow>
          </>
        ) : null}
        <p className="settings-footer">No reminder is sent in quiet hours.</p>
      </section>
    </>
  )
}
