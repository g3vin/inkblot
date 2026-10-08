/** A button per weekday, on or off; one always stays on (GoalSettings.swift). */
import { orderedWeekdays, weekdayName } from '../../stats/day.js'

export default function WeekdayToggles({ value, onChange }) {
  const selected = new Set(value)
  return (
    <span className="settings-weekdays" role="group" aria-label="Days">
      {orderedWeekdays().map((weekday) => {
        const on = selected.has(weekday)
        return (
          <button
            key={weekday}
            type="button"
            aria-pressed={on}
            aria-label={weekdayName(weekday)}
            title={weekdayName(weekday)}
            onClick={() => {
              const next = new Set(selected)
              if (on && next.size > 1) next.delete(weekday)
              else next.add(weekday)
              onChange([...next].sort())
            }}
          >
            {weekdayName(weekday, 'narrow')}
          </button>
        )
      })}
    </span>
  )
}
