/**
 * Settings ▸ Goals: what each day asks for, the days that differ, how a streak is
 * kept, and the projects' deadlines (GoalSettings.swift).
 */
import { useState } from 'react'
import { Button, FormRow, IconButton, SelectMenu, Stepper, Toggle } from '../../ui'
import Icon from '../../ui/Icon.jsx'
import { GOAL_METRICS, METRIC_INFO, goalFor, goalSummary, goalTarget, newDeadline } from '../../stats/goals.js'
import { dayDate, dayKey, formatNumber, newId, orderedWeekdays, weekdayName } from '../../stats/day.js'
import useProjects from './useProjects.js'
import WeekdayToggles from './WeekdayToggles.jsx'

const METRIC_OPTIONS = GOAL_METRICS.map((metric) => ({ value: metric, label: METRIC_INFO[metric].title }))
const NEEDS = [{ value: 'all', label: 'All of them' }, { value: 'any', label: 'Any one' }]

/** One day's goal: its targets, all or any, or a rest day. */
export function DayGoalEditor({ goal, onChange }) {
  const change = (patch) => onChange({ ...goal, ...patch })
  const setTarget = (id, patch) => change({ targets: goal.targets.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
  return (
    <div className="settings-day-goal">
      <FormRow label="Rest day"><Toggle label="Rest day" checked={goal.rest} onChange={(rest) => change({ rest })} /></FormRow>
      {goal.rest ? null : (
        <>
          {goal.targets.map((target) => (
            <div key={target.id} className="settings-target">
              <SelectMenu label="Measure" value={target.metric} options={METRIC_OPTIONS} onChange={(metric) => setTarget(target.id, { metric })} />
              <Stepper label="Amount" value={target.amount} min={1} max={100000} step={target.metric === 'words' || target.metric === 'netWords' ? 50 : 1} unit={METRIC_INFO[target.metric].unit}
                onChange={(amount) => setTarget(target.id, { amount })} />
              <IconButton icon="minus" label="Remove target" size="capsule" onClick={() => change({ targets: goal.targets.filter((t) => t.id !== target.id) })} />
            </div>
          ))}
          <div className="settings-actions">
            <SelectMenu
              label="Add target"
              value=""
              options={[{ value: '', label: 'Add target…', disabled: true }, ...METRIC_OPTIONS]}
              onChange={(metric) => metric && change({ targets: [...goal.targets, goalTarget(metric)] })}
            />
            {goal.targets.length > 1 ? (
              <SelectMenu label="Needs" value={goal.requireAll ? 'all' : 'any'} options={NEEDS} onChange={(v) => change({ requireAll: v === 'all' })} />
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

function Disclosure({ title, value, open, onToggle, children }) {
  return (
    <div className="settings-disclosure" data-open={open}>
      <button type="button" className="settings-disclosure-head" aria-expanded={open} onClick={onToggle}>
        <Icon name="chevron-right" className="settings-chevron" />
        <span className="settings-disclosure-title">{title}</span>
        <span className="settings-disclosure-value">{value}</span>
      </button>
      {open ? <div className="settings-disclosure-body">{children}</div> : null}
    </div>
  )
}

export default function GoalsPane({ stats }) {
  const config = stats.config
  const plan = config.goals
  const projects = useProjects()
  const [editing, setEditing] = useState(null)
  const [newDay, setNewDay] = useState(() => dayKey(new Date()))
  const save = (next) => stats.saveConfig(next)
  const setPlan = (patch) => save({ ...config, goals: { ...plan, ...patch } })
  const setWeekday = (weekday, goal) => setPlan({ weekly: plan.weekly.map((g, i) => (i === weekday - 1 ? goal : g)) })
  const copyToEveryDay = (weekday) => {
    const goal = plan.weekly[weekday - 1]
    setPlan({ weekly: plan.weekly.map(() => ({ ...goal, targets: goal.targets.map((t) => ({ ...t, id: newId() })) })) })
  }
  const projectOptions = [{ value: '', label: 'All projects' }, ...[...new Set([...projects, ...(plan.project ? [plan.project] : [])])].map((p) => ({ value: p, label: p }))]
  const overrides = [...plan.overrides].sort((a, b) => a.day.localeCompare(b.day))
  const setDeadline = (id, patch) => save({ ...config, deadlines: config.deadlines.map((d) => (d.id === id ? { ...d, ...patch } : d)) })

  return (
    <>
      <section className="settings-group">
        <FormRow label="Count writing in"><SelectMenu label="Count writing in" value={plan.project ?? ''} options={projectOptions} onChange={(v) => setPlan({ project: v || null })} /></FormRow>
        <p className="settings-footer">Goals, the streak and the heatmap count the writing in this scope.</p>
      </section>

      <section className="settings-group">
        <h3>Each week</h3>
        {orderedWeekdays().map((weekday) => (
          <Disclosure key={weekday} title={weekdayName(weekday)} value={goalSummary(plan.weekly[weekday - 1])}
            open={editing === `w${weekday}`} onToggle={() => setEditing(editing === `w${weekday}` ? null : `w${weekday}`)}>
            <DayGoalEditor goal={plan.weekly[weekday - 1]} onChange={(goal) => setWeekday(weekday, goal)} />
            <Button size="capsule" onClick={() => copyToEveryDay(weekday)}>Apply to every day</Button>
          </Disclosure>
        ))}
        <p className="settings-footer">A day can ask for several things — all of them, or any one. A rest day neither counts toward a streak nor breaks it.</p>
      </section>

      <section className="settings-group">
        <h3>Particular days</h3>
        {overrides.map((override) => (
          <Disclosure key={override.id} title={dayDate(override.day)?.toLocaleDateString(undefined, { dateStyle: 'full' }) ?? override.day}
            value={goalSummary(override.goal)} open={editing === override.id} onToggle={() => setEditing(editing === override.id ? null : override.id)}>
            <DayGoalEditor goal={override.goal} onChange={(goal) => setPlan({ overrides: plan.overrides.map((o) => (o.id === override.id ? { ...o, goal } : o)) })} />
            <Button variant="destructive" onClick={() => setPlan({ overrides: plan.overrides.filter((o) => o.id !== override.id) })}>Remove this day</Button>
          </Disclosure>
        ))}
        <div className="settings-actions">
          <input type="date" className="settings-input" aria-label="Day" value={newDay} onChange={(event) => setNewDay(event.target.value)} />
          <Button onClick={() => {
            if (!newDay || plan.overrides.some((o) => o.day === newDay)) return
            setPlan({ overrides: [...plan.overrides, { id: newId(), day: newDay, goal: structuredClone(goalFor(plan, newDay)) }] })
          }}>Add day</Button>
        </div>
        <p className="settings-footer">A day here asks for its own goal instead of its weekday’s — a holiday off, a push before a deadline.</p>
      </section>

      <section className="settings-group">
        <h3>Streaks and flow</h3>
        <FormRow label="Freezes a month"><Stepper label="Freezes a month" value={config.streakFreezesPerMonth} min={0} max={10} onChange={(v) => save({ ...config, streakFreezesPerMonth: v })} /></FormRow>
        <FormRow label="Celebrate when the day’s goal is met"><Toggle label="Celebrate when the day’s goal is met" checked={config.celebrateGoals} onChange={(v) => save({ ...config, celebrateGoals: v })} /></FormRow>
        <FormRow label="Flow is typing for"><Stepper label="Flow minutes" value={config.flowMinutes} min={5} max={90} step={5} unit="min" onChange={(v) => save({ ...config, flowMinutes: v })} /></FormRow>
        <p className="settings-footer">A freeze covers a missed day so the streak goes on. Freezes are used as days are missed, and renew each month.</p>
      </section>

      <section className="settings-group">
        <h3>Deadlines</h3>
        {config.deadlines.map((deadline) => (
          <Disclosure key={deadline.id} title={deadline.project || 'No project'}
            value={`${formatNumber(deadline.targetWords)} words by ${dayDate(deadline.due)?.toLocaleDateString(undefined, { dateStyle: 'medium' }) ?? deadline.due}`}
            open={editing === deadline.id} onToggle={() => setEditing(editing === deadline.id ? null : deadline.id)}>
            <FormRow label="Project">
              <SelectMenu label="Project" value={deadline.project} options={[...new Set([...projects, deadline.project])].filter(Boolean).sort().map((p) => ({ value: p, label: p }))} onChange={(project) => setDeadline(deadline.id, { project })} />
            </FormRow>
            <FormRow label="Words"><Stepper label="Words" value={deadline.targetWords} min={1} max={2000000} step={1000} onChange={(targetWords) => setDeadline(deadline.id, { targetWords })} /></FormRow>
            <FormRow label="Due"><input type="date" className="settings-input" aria-label="Due" value={deadline.due} onChange={(event) => event.target.value && setDeadline(deadline.id, { due: event.target.value })} /></FormRow>
            <FormRow label="Writing days"><WeekdayToggles value={deadline.writingDays} onChange={(writingDays) => setDeadline(deadline.id, { writingDays })} /></FormRow>
            <FormRow label="Show the day’s share on the Today page"><Toggle label="Show the day’s share" checked={deadline.feedsDailyGoal} onChange={(feedsDailyGoal) => setDeadline(deadline.id, { feedsDailyGoal })} /></FormRow>
            <Button variant="destructive" onClick={() => save({ ...config, deadlines: config.deadlines.filter((d) => d.id !== deadline.id) })}>Remove deadline</Button>
          </Disclosure>
        ))}
        <div className="settings-actions">
          <Button disabled={!projects.length && !stats.tracker.project} onClick={() => {
            const deadline = newDeadline(stats.tracker.project ?? projects[0] ?? '', dayKey(new Date()))
            save({ ...config, deadlines: [...config.deadlines, deadline] })
            setEditing(deadline.id)
          }}><Icon name="calendar" />Add deadline</Button>
        </div>
        <p className="settings-footer">Inkblot works out each writing day’s share from the words left and the days left, and when you’ll finish at your recent pace.</p>
      </section>
    </>
  )
}
