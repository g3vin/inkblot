/**
 * Settings ▸ Story: the open project's story calendar — how story days are written
 * as dates. One calendar per project (`.story/calendar.json`), read by every map,
 * timeline and journey in it; maps and the timeline link here rather than editing it
 * themselves. Each change is saved as it is made.
 */
import { useState } from 'react'
import { FormRow, Input, SelectMenu, Stepper, TextArea, Toggle } from '../../ui'
import { formatDay, normalizeCalendar } from '../../lib/map/calendar'
import { useStoryCalendar } from '../../map/useMapProject'

const MODES = [
  { value: 'day', label: 'Story days (Day 1, Day 2…)' },
  { value: 'gregorian', label: 'Real dates' },
  { value: 'custom', label: 'My world’s calendar' },
]

/** A text field committed on Return or blur, never per keystroke. */
function CommitText({ value, onCommit, multiline = false, ...rest }) {
  const [draft, setDraft] = useState(null)
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft)
    setDraft(null)
  }
  const props = {
    value: draft ?? value,
    onChange: (event) => setDraft(event.target.value),
    onBlur: commit,
    onKeyDown: (event) => {
      if (event.key === 'Enter' && !(multiline && event.shiftKey)) {
        event.preventDefault()
        commit()
      }
      if (event.key === 'Escape') setDraft(null)
    },
    ...rest,
  }
  return multiline ? <TextArea rows={3} {...props} /> : <Input {...props} />
}

const monthsText = (cal) => cal.custom.months.map((month) => `${month.name}:${month.days}`).join(', ')
const readMonths = (text) =>
  text.split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const [name, days] = entry.split(':')
    return { name: name.trim(), days: Math.max(1, Math.round(Number(days) || 30)) }
  })

export default function StoryPane({ projectName }) {
  const [calendar, saveCalendar] = useStoryCalendar(projectName)
  if (!projectName) {
    return (
      <section className="settings-group">
        <h3 className="ib-eyebrow">Story calendar</h3>
        <p className="settings-footer">Open a project to set its story calendar.</p>
      </section>
    )
  }
  const cal = normalizeCalendar(calendar)
  const set = (patch) => saveCalendar({ ...cal, ...patch })
  const custom = (patch) => set({ custom: { ...cal.custom, ...patch } })
  return (
    <section className="settings-group">
      <h3 className="ib-eyebrow">Story calendar · {projectName}</h3>
      <FormRow label="Dates as" help="story.calendar">
        <SelectMenu label="Dates as" value={cal.mode} options={MODES} onChange={(mode) => set({ mode })} />
      </FormRow>
      {cal.mode === 'gregorian' ? (
        <FormRow label="Story begins">
          <CommitText aria-label="Story begins" placeholder="1850-03-01" value={cal.gregorianEpoch} onCommit={(gregorianEpoch) => set({ gregorianEpoch })} />
        </FormRow>
      ) : null}
      {cal.mode === 'custom' ? (
        <>
          <FormRow label="Months" stacked>
            <CommitText multiline aria-label="Months" placeholder="Thaw:30, Bloom:31" value={monthsText(cal)} onCommit={(text) => custom({ months: readMonths(text) })} />
          </FormRow>
          <FormRow label="Weekdays" stacked>
            <CommitText aria-label="Weekdays" placeholder="Optional, comma separated" value={cal.custom.weekdays.join(', ')} onCommit={(text) => custom({ weekdays: text.split(',').map((name) => name.trim()).filter(Boolean) })} />
          </FormRow>
          <FormRow label="First year">
            <Stepper label="First year" value={cal.custom.yearZero} step={1} onChange={(yearZero) => custom({ yearZero: Math.round(yearZero) })} />
          </FormRow>
          <FormRow label="Era">
            <CommitText aria-label="Era" placeholder="e.g. AR" value={cal.custom.era} onCommit={(era) => custom({ era })} />
          </FormRow>
          <FormRow label="Leap years">
            <Toggle label="Leap years" checked={Boolean(cal.custom.leap)} onChange={(on) => custom({ leap: on ? { every: 4, days: 1, month: 1 } : null })} />
          </FormRow>
          {cal.custom.leap ? (
            <FormRow label="A leap day every">
              <Stepper label="A leap day every" value={cal.custom.leap.every} min={1} step={1} unit="years" onChange={(every) => custom({ leap: { ...cal.custom.leap, every: Math.round(every) } })} />
            </FormRow>
          ) : null}
        </>
      ) : null}
      <p className="settings-footer ib-meta">Day 1 of the story is {formatDay(cal, 0)}.</p>
    </section>
  )
}
