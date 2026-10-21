/**
 * StatsPanel — the inspector's Stats tab: how the writing is going, for this
 * document, this project, or everything (StatsPanelView.swift).
 *
 * Every figure comes from the core's session store, plus the part of the live
 * session the store has not been sent yet (`tracker.pending`), so the numbers move
 * while the writer types rather than once a minute. The store is read again when
 * the tracker records, the scope changes, or the chart's range does.
 */
import { useEffect, useState } from 'react'
import { EmptyState, MenuItem, MenuLabel, MenuSeparator, MoreMenu, PanelActions, ScopeMenu, Section, Segmented, SelectMenu } from '../../ui'
import Icon from '../../ui/Icon.jsx'
import { getPreference, setPreference } from '../../lib/preferences'
import { latestBridgeEvent } from '../../bridge'
import { useStats } from '../../stats/useStats.js'
import { rhythmInsights } from '../../stats/goals.js'
import { addDays, dayKey, formatDuration, formatNumber, hourRange, weekdayName } from '../../stats/day.js'
import TimerSection from './TimerSection.jsx'
import { GoalsSection, DeadlinesSection, StreakRow } from './GoalSections.jsx'
import { ActivityChart, HourGrid, StreakHeatmap } from './StatsCharts.jsx'
import {
  activitySeries, averageWrittenPerDay, capitalize, effectiveScope, loadSnapshot, mediumDate, openSettings, pace,
  snapshotToday, storeScope,
} from './statsText.js'
import './Stats.css'

const PAGES = [{ value: 'today', label: 'Today' }, { value: 'history', label: 'History' }, { value: 'insights', label: 'Insights' }]
const SCOPES = [{ value: 'document', label: 'This document' }, { value: 'project', label: 'This project' }, { value: 'all', label: 'Everything' }]
const METRICS = [{ value: 'words', label: 'Words' }, { value: 'typing', label: 'Time typing' }, { value: 'open', label: 'Time open' }]
const RANGES = [{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]
const INSIGHT_DAYS = 90

function usePreference(key, fallback) {
  const [value, setValue] = useState(() => getPreference(key) ?? fallback)
  return [value, (next) => { setValue(next); setPreference(key, next) }]
}

const docName = (path) => (path ?? '').split('/').pop()?.replace(/\.(json|canvas|map)$/, '') ?? ''

/** A labelled figure, hidden while the panel search filters for something it does not mention. */
function Row({ label, value, detail, help, query }) {
  if (query && !label.toLowerCase().includes(query.toLowerCase())) return null
  return (
    <div className="stats-row" title={help}>
      <span className="stats-row-label">{label}</span>
      <span className="stats-row-value">
        <span>{value}</span>
        {detail ? <small>{detail}</small> : null}
      </span>
    </div>
  )
}

function useSnapshot(stats, kind, scope, rangeDays) {
  const [snapshot, setSnapshot] = useState(null)
  const key = JSON.stringify([kind, scope, rangeDays, stats.tracker.revision])
  useEffect(() => {
    let live = true
    loadSnapshot(stats.service, kind, scope, rangeDays).then((next) => { if (live) setSnapshot(next) })
    return () => { live = false }
    // The key is every input, serialised.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return snapshot
}

function useInsights(stats, scope) {
  const [insights, setInsights] = useState(null)
  const key = JSON.stringify([scope, stats.tracker.revision, stats.config.flowMinutes, stats.config.countPastedWords])
  useEffect(() => {
    let live = true
    const now = new Date()
    const today = dayKey(now)
    const from = dayKey(addDays(now, -(INSIGHT_DAYS - 1)))
    Promise.all([stats.service.daily(scope, from, today), stats.service.sessions(scope, from, today)]).then(([days, sessions]) => {
      if (live) setInsights(rhythmInsights(days, sessions, today, stats.config.flowMinutes, stats.config.countPastedWords))
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` names every input
  }, [key])
  return insights
}

export default function StatsPanel({ query = '' }) {
  const stats = useStats()
  const { tracker, config } = stats
  const [page, setPage] = usePreference('inkblot.stats.page', 'today')
  const [chosen, setChosen] = usePreference('inkblot.stats.scope', 'document')
  const [rangeDays, setRangeDays] = usePreference('inkblot.stats.range', 30)
  const [metric, setMetric] = usePreference('inkblot.stats.metric', 'words')
  const kind = effectiveScope(chosen, tracker.project, tracker.docPath)
  const scope = storeScope(kind, tracker.project, tracker.docPath)
  const snapshot = useSnapshot(stats, kind, scope, Number(rangeDays))
  const pastes = config.countPastedWords

  // The live session's unrecorded work, when it falls inside the scope.
  const session = tracker.session
  const inScope = session && (kind === 'all'
    || (kind === 'project' && session.project === tracker.project)
    || (kind === 'document' && session.project === tracker.project && session.docPath === tracker.docPath))
  const pending = inScope ? tracker.pending : { written: 0, deleted: 0, open: 0, active: 0 }

  // The scope menu names what it counts: the document by name, the project by name.
  const scopes = SCOPES.map((option) => ({
    ...option,
    hint: option.value === 'document' ? docName(tracker.docPath) || undefined
      : option.value === 'project' ? tracker.project || undefined : 'All your writing',
  }))

  return (
    <div className="sidebar-panel stats-panel" data-help="stats.panel">
      <PanelActions>
        <ScopeMenu label="Count" value={chosen} onChange={setChosen} options={scopes} />
        <MoreMenu label="More stats options">
          <MenuItem icon="target" onSelect={() => openSettings('goals')}>Goals…</MenuItem>
          <MenuItem icon="timer" onSelect={() => openSettings('timers')}>Timer routines…</MenuItem>
          <MenuItem icon="settings" onSelect={() => openSettings('writing')}>Writing settings…</MenuItem>
        </MoreMenu>
      </PanelActions>
      <div className="stats-view-switch">
        <Segmented value={page} onChange={setPage} options={PAGES} label="Show" stretch />
      </div>
      <div className="stats-body">
        {page === 'today' ? (
          <>
            <Section id="stats.timer" title="Timer"><TimerSection stats={stats} /></Section>
            <GoalsSection stats={stats} />
            <DeadlinesSection stats={stats} project={tracker.project} />
            <Section id="stats.session" title="This session" help="stats.session">
              {session ? (
                <SessionRows stats={stats} query={query} />
              ) : <EmptyState compact title="No session yet." hint="Start typing to begin one." />}
            </Section>
            {snapshot ? <TodaySection snapshot={snapshot} pending={pending} pastes={pastes} query={query} /> : null}
          </>
        ) : null}
        {page === 'history' ? (
          <>
            <StreakSection stats={stats} />
            {snapshot ? (
              <Section id="stats.activity" title="Activity" help="stats.activity">
                <div className="stats-controls">
                  <SelectMenu label="Show" value={metric} onChange={setMetric} options={METRICS} />
                  <SelectMenu label="Range" value={String(rangeDays)} onChange={(value) => setRangeDays(Number(value))} options={RANGES} />
                </div>
                <ActivityChart days={activitySeries(snapshot, pastes)} metric={metric} />
              </Section>
            ) : null}
            {snapshot ? <TotalsSection stats={stats} kind={kind} snapshot={snapshot} pending={pending} query={query} /> : null}
          </>
        ) : null}
        {page === 'insights' ? (
          <>
            <InsightsSections stats={stats} scope={scope} />
            <DeadlinesSection stats={stats} project={kind === 'all' ? null : tracker.project} />
          </>
        ) : null}
      </div>
    </div>
  )
}

function SessionRows({ stats, query }) {
  const session = stats.tracker.session
  const written = session.wordsAdded + (stats.config.countPastedWords ? session.wordsPasted : 0)
  const clock = (secs) => {
    const total = Math.floor(secs)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = String(total % 60).padStart(2, '0')
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
  }
  return (
    <>
      <Row query={query} label="Time open" value={clock(session.open)} />
      <Row query={query} label="Time typing" value={clock(session.active)} help={`Edits less than ${stats.config.activeGap} seconds apart count as typing.`} />
      <Row query={query} label="Words written" value={formatNumber(written)} />
      <Row query={query} label="Words deleted" value={formatNumber(session.wordsDeleted)} />
      {session.wordsPasted > 0 ? <Row query={query} label="Words pasted" value={formatNumber(session.wordsPasted)} /> : null}
      <Row query={query} label="Pace" value={pace(written, session.active)} help="Words written per minute of typing." />
    </>
  )
}

function TodaySection({ snapshot, pending, pastes, query }) {
  const today = snapshotToday(snapshot)
  const written = (today ? today.wordsAdded + (pastes ? today.wordsPasted : 0) : 0) + pending.written
  const average = averageWrittenPerDay(snapshot, pastes)
  return (
    <Section id="stats.today" title="So far today">
      <Row query={query} label="Words written" value={formatNumber(written)} detail={average > 0 ? `${formatNumber(average)} a day on average` : null} />
      <Row query={query} label="Words deleted" value={formatNumber((today?.wordsDeleted ?? 0) + pending.deleted)} />
      <Row query={query} label="Time typing" value={formatDuration((today?.activeSecs ?? 0) + pending.active)} />
      <Row query={query} label="Time open" value={formatDuration((today?.openSecs ?? 0) + pending.open)} />
    </Section>
  )
}

function TotalsSection({ stats, kind, snapshot, pending, query }) {
  const { totals, runs } = snapshot
  const pastes = stats.config.countPastedWords
  const written = totals.wordsAdded + (pastes ? totals.wordsPasted : 0) + pending.written
  const active = totals.activeSecs + pending.active
  // The open document's length as the page last counted it — for one the store has
  // never seen a session of.
  const changed = latestBridgeEvent('docChanged')
  const live = kind === 'document' && changed?.docPath === stats.tracker.docPath ? { words: changed.wordCount, chars: changed.charCount } : null
  const length = live ?? snapshot.length
  const finished = runs.filter((run) => run.completed).length
  const sprints = runs.reduce((sum, run) => sum + (run.sprintsCompleted ?? 0), 0)
  const skipped = runs.reduce((sum, run) => sum + (run.sprintsSkipped ?? 0), 0)
  const runWords = runs.reduce((sum, run) => sum + (run.wordsWritten ?? 0), 0)
  return (
    <Section id="stats.totals" title="All time" help="stats.totals">
      {length ? <Row query={query} label={kind === 'document' ? 'Length' : 'Project length'} value={`${formatNumber(length.words)} words`} detail={`${formatNumber(length.chars)} characters`} /> : null}
      <Row query={query} label="Words written" value={formatNumber(written)} />
      <Row query={query} label="Words deleted" value={formatNumber(totals.wordsDeleted + pending.deleted)} />
      {totals.wordsPasted > 0 ? <Row query={query} label="Words pasted" value={formatNumber(totals.wordsPasted)} /> : null}
      <Row query={query} label="Time typing" value={formatDuration(active)} />
      <Row query={query} label="Time open" value={formatDuration(totals.openSecs + pending.open)} />
      <Row query={query} label="Average pace" value={pace(written, active)} help="Words written per minute of typing, over every session." />
      <Row query={query} label="Sessions" value={formatNumber(totals.sessions)} detail={totals.sessions > 0 ? `${formatDuration(totals.openSecs / totals.sessions)} on average` : null} />
      {totals.longestSessionSecs > 0 ? <Row query={query} label="Longest session" value={formatDuration(totals.longestSessionSecs)} /> : null}
      <Row query={query} label="Days written" value={formatNumber(totals.daysWritten)} />
      {runs.length ? (
        <>
          <Row query={query} label="Timer runs" value={formatNumber(runs.length)} detail={`${formatNumber(finished)} finished`} help={kind === 'document' ? 'Timer runs in this document’s project.' : undefined} />
          <Row query={query} label="Sprints finished" value={formatNumber(sprints)} detail={skipped > 0 ? `${formatNumber(skipped)} skipped` : null} />
          {sprints + skipped > 0 ? <Row query={query} label="Words per sprint" value={formatNumber(Math.floor(runWords / (sprints + skipped)))} /> : null}
        </>
      ) : null}
      {totals.firstSession ? <Row query={query} label="Since" value={mediumDate(new Date(totals.firstSession))} /> : null}
    </Section>
  )
}

const SHADINGS = [{ value: 'words', label: 'Words written' }, { value: 'goals', label: 'Goals met' }]
const WEEKS = [{ value: '13', label: 'The last 3 months' }, { value: '26', label: 'The last 6 months' }, { value: '53', label: 'The last year' }]

function StreakSection({ stats }) {
  const [weeks, setWeeks] = usePreference('inkblot.stats.heatmapWeeks', 26)
  const [shading, setShading] = usePreference('inkblot.stats.heatmapShading', 'words')
  const history = { ...stats.history, [stats.todayKey]: stats.today }
  return (
    <Section
      id="stats.streak"
      title="Streak"
      help="stats.streak"
      accessory={(
        <MoreMenu label="Streak options">
          <MenuLabel>Shade by</MenuLabel>
          {SHADINGS.map((option) => (
            <MenuItem key={option.value} checked={shading === option.value} onSelect={() => setShading(option.value)}>{option.label}</MenuItem>
          ))}
          <MenuSeparator />
          <MenuLabel>Show</MenuLabel>
          {WEEKS.map((option) => (
            <MenuItem key={option.value} checked={String(weeks) === option.value} onSelect={() => setWeeks(Number(option.value))}>{option.label}</MenuItem>
          ))}
        </MoreMenu>
      )}
    >
      <StreakRow streak={stats.streak} />
      <StreakHeatmap history={history} plan={stats.plan} today={stats.todayKey} weeks={Number(weeks)} shading={shading} />
    </Section>
  )
}

function InsightsSections({ stats, scope }) {
  const insights = useInsights(stats, scope)
  if (!insights) return <p className="stats-muted stats-loading">Reading your history…</p>
  const parts = []
  if (insights.thisWeekTypingSecs > 0) parts.push(`${formatDuration(insights.thisWeekTypingSecs)} of typing over the last seven days`)
  if (insights.bestHour != null) parts.push(`your best hour is ${hourRange(insights.bestHour)}`)
  const sentence = parts.length ? `${capitalize(parts.join(', and '))}.` : 'Nothing written in the last seven days yet.'
  return (
    <>
      <Section id="stats.week" title="This week" help="stats.week">
        <div className="stats-week">
          <span className="stats-big">{formatNumber(insights.thisWeekWords)}</span>
          <span className="stats-muted">words</span>
          <span className="stats-grow" />
          {insights.weekChange ? (
            <span className="stats-change" title="Against the seven days before">
              <Icon name={insights.thisWeekWords >= insights.lastWeekWords ? 'arrow-up-right' : 'arrow-down-right'} />{insights.weekChange}
            </span>
          ) : null}
        </div>
        <p className="stats-muted">{sentence}</p>
      </Section>
      <Section id="stats.rhythm" title="When you write" help="stats.rhythm">
        {insights.bestHour != null ? <Row label="Best time" value={hourRange(insights.bestHour)} /> : null}
        {insights.bestWeekday != null ? <Row label="Best day" value={weekdayName(insights.bestWeekday)} /> : null}
        <HourGrid grid={insights.grid} />
      </Section>
      <Section id="stats.habits" title="How you write" help="stats.habits">
        <Row label="Flow sessions" value={formatNumber(insights.flowSessions)} detail={`of ${formatNumber(insights.sessions)} sessions`}
          help={`Sessions with at least ${stats.config.flowMinutes} minutes of typing in a row, each minute mostly typing.`} />
        <Row label="Longest flow" value={insights.longestFlowMinutes ? `${insights.longestFlowMinutes} min` : '—'} />
        {insights.sessions > 0 ? <Row label="Average session" value={formatDuration(insights.averageSessionSecs)} /> : null}
        <Row label="Rewriting" value={insights.editingRatio > 0 ? `${Math.round(insights.editingRatio * 100)} deleted per 100 written` : '—'}
          help="How much of the writing is taking words out again. Drafting runs low; revising runs high." />
        {insights.pastedShare > 0 ? <Row label="Pasted" value={`${Math.round(insights.pastedShare * 100)}%`} /> : null}
      </Section>
    </>
  )
}

