/**
 * Today's goal, the streak, and the deadlines (GoalViews.swift): rings per target,
 * the streak row, and a card per deadline with its burndown.
 */
import { Section } from '../../ui'
import SFIcon from '../SFIcon'
import { dayDate, formatNumber } from '../../stats/day.js'
import { GoalRings, Burndown } from './StatsCharts.jsx'
import { capitalize, mediumDate, openSettings, plural } from './statsText.js'

export function StreakRow({ streak }) {
  const parts = [`best ${formatNumber(streak.best)}`]
  if (streak.freezesAllowed > 0) {
    const left = Math.max(0, streak.freezesAllowed - streak.freezesUsed)
    parts.push(`${left} freeze${left === 1 ? '' : 's'} left this month`)
  }
  if (!streak.todayCounts && streak.current > 0) parts.unshift('today not yet')
  return (
    <div className="stats-row" data-lit={streak.todayCounts}>
      <span className="stats-row-label stats-streak-label"><SFIcon name="flame" size={13} />Streak</span>
      <span className="stats-row-value">
        <span>{streak.current === 1 ? '1 day' : `${formatNumber(streak.current)} days`}</span>
        <small>{parts.join(' · ')}</small>
      </span>
    </div>
  )
}

export function GoalsSection({ stats }) {
  const status = stats.status
  const goal = stats.todayGoal
  return (
    <Section
      id="stats.goal"
      title="Today’s Goal"
      accessory={status.met === true ? <span className="stats-met" data-just={stats.metJustNow}><SFIcon name="checkmark.seal" size={12} />Met</span> : null}
    >
      {goal.rest ? (
        <p className="stats-muted stats-inline"><SFIcon name="moon.zzz" size={13} />Rest day. Nothing is asked of today.</p>
      ) : status.targets.length === 0 ? (
        <p className="stats-muted">No goal for today. <button type="button" className="reference-link" onClick={() => openSettings('goals')}>Set Goals…</button></p>
      ) : (
        <>
          <GoalRings status={status} />
          {status.remainingText ? <p className="stats-muted">{capitalize(status.remainingText)}.</p> : null}
        </>
      )}
      <StreakRow streak={stats.streak} />
      <p className="stats-note">{stats.plan.project ? `Counting writing in ${stats.plan.project}.` : 'Counting all your writing.'}</p>
    </Section>
  )
}

function DeadlineBadge({ status }) {
  if (status.isDone) return <span className="stats-badge" data-tone="done"><SFIcon name="checkmark.seal" size={11} />Done</span>
  if (status.isOverdue) return <span className="stats-badge" data-tone="warn"><SFIcon name="exclamationmark.triangle" size={11} />Past due</span>
  if (status.onTrack) return <span className="stats-badge"><SFIcon name="checkmark" size={11} />On track</span>
  return <span className="stats-badge" data-tone="warn"><SFIcon name="chart.line.downtrend.xyaxis" size={11} />Behind</span>
}

function DeadlineCard({ stats, deadline, status }) {
  const netToday = stats.netToday(deadline)
  const due = dayDate(deadline.due)
  return (
    <div className="stats-deadline">
      <div className="stats-deadline-head">
        <strong>{deadline.project}</strong>
        <DeadlineBadge status={status} />
      </div>
      <div className="stats-progress"><span style={{ width: `${Math.min(1, status.currentWords / Math.max(1, deadline.targetWords)) * 100}%` }} /></div>
      <span className="stats-tabular">{formatNumber(status.currentWords)} of {formatNumber(deadline.targetWords)} words</span>
      {due ? <p className="stats-note">Due {mediumDate(due)} · {plural(status.writingDaysLeft, 'writing day')} left</p> : null}
      {deadline.feedsDailyGoal && status.quota != null && !status.isDone ? (
        <div className="stats-row"><span className="stats-row-label">Today’s share</span><span className="stats-row-value"><span>{formatNumber(Math.max(0, netToday))} / {formatNumber(status.quota)} words</span></span></div>
      ) : null}
      <div className="stats-row"><span className="stats-row-label">Pace</span><span className="stats-row-value"><span>{status.pace > 0 ? `${formatNumber(status.pace)} words a writing day` : 'Not enough writing yet'}</span></span></div>
      {status.projectedFinish && !status.isDone ? (
        <div className="stats-row"><span className="stats-row-label">At this pace</span><span className="stats-row-value"><span>done {mediumDate(status.projectedFinish)}</span></span></div>
      ) : null}
      <Burndown points={status.burndown} due={deadline.due} />
    </div>
  )
}

export function DeadlinesSection({ stats, project }) {
  const deadlines = stats.config.deadlines.filter((deadline) => project == null || deadline.project === project)
  if (!deadlines.length) return null
  return (
    <Section id="stats.deadline" title="Deadline">
      {deadlines.map((deadline) => {
        const status = stats.deadlineStatuses[deadline.id]
        return status
          ? <DeadlineCard key={deadline.id} stats={stats} deadline={deadline} status={status} />
          : <p key={deadline.id} className="stats-muted">Measuring {deadline.project}…</p>
      })}
    </Section>
  )
}
