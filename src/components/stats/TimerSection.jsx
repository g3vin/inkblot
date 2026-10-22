/**
 * The writing timer as the Stats tab shows it (TimerViews.swift): a routine to
 * start, or the segment running — its clock, its progress, its words — and the
 * controls for it.
 */
import { Button, SelectMenu } from '../../ui'
import Icon from '../../ui/Icon.jsx'
import { segmentTitle } from '../../stats/routines.js'
import { formatDuration, formatNumber } from '../../stats/day.js'
import { routineOptions, routinePlan, timerClock, timerWords } from './statsText.js'

export function RunningTimer({ stats }) {
  const timer = stats.timer
  const segment = timer.segment
  if (!segment) return null
  const progress = timer.state === 'waiting' ? null : timer.progress()
  let line
  if (timer.state === 'waiting') line = `${segmentTitle(segment)} is next. Start it when you’re ready.`
  else if (timer.state === 'paused') line = 'Paused.'
  else if (segment.kind === 'write') line = timerWords(timer.segmentWords, segment.wordGoal)
  else line = timer.routine?.pauseTrackingOnBreaks ? 'Open time is paused for the break.' : 'On a break.'
  return (
    <div className="stats-timer-running" data-state={timer.state} data-kind={segment.kind}>
      <div className="stats-timer-head">
        <span className="stats-timer-title"><Icon name={segment.kind === 'write' ? 'edit' : 'break'} />{segmentTitle(segment)}</span>
        <span className="stats-muted">{timer.position}</span>
      </div>
      <div className="stats-timer-clock">{timerClock(timer, stats.now())}</div>
      {progress != null ? <div className="stats-progress"><span style={{ width: `${progress * 100}%` }} /></div> : null}
      <p className="stats-muted">{line}</p>
    </div>
  )
}

export function TimerControls({ stats }) {
  const timer = stats.timer
  const segment = timer.segment
  return (
    <div className="stats-timer-controls">
      {timer.state === 'waiting' ? (
        <Button variant="filled" onClick={() => timer.proceed()}><Icon name="play" />Start {segment ? segmentTitle(segment) : ''}</Button>
      ) : timer.state === 'paused' ? (
        <Button variant="filled" onClick={() => timer.resume()}><Icon name="play" />Resume</Button>
      ) : (
        <Button onClick={() => timer.pause()}><Icon name="pause" />Pause</Button>
      )}
      {timer.state !== 'waiting' ? (
        <Button onClick={() => timer.skip()} title="End this segment now and go on to the next"><Icon name="skip" />Skip</Button>
      ) : null}
      <span className="stats-grow" />
      <Button variant="destructive" onClick={() => timer.stop()} title="Stop the routine. What you wrote still counts."><Icon name="stop" />Stop</Button>
    </div>
  )
}

function RoutineStarter({ stats }) {
  const routine = stats.defaultRoutine
  const last = stats.timer.lastRun
  return (
    <>
      <div className="ui-form-row">
        <span className="ui-form-row-label">Routine</span>
        <div className="ui-form-row-control">
          <SelectMenu
            label="Routine"
            value={routine.id}
            options={routineOptions(stats.config)}
            onChange={(id) => { if (id !== stats.config.lastRoutineID) stats.saveConfig({ ...stats.config, lastRoutineID: id }) }}
          />
        </div>
      </div>
      <div className="stats-timer-start">
        <span className="stats-muted">{routinePlan(routine)}</span>
        <Button variant="filled" onClick={() => stats.startTimer(routine)}><Icon name="play" />Start</Button>
      </div>
      {last && stats.now() - last.end < 3_600_000 ? (
        <p className="stats-note">Last run: {last.routine.name}, {formatNumber(last.wordsWritten)} words in {formatDuration(last.writeSecs)}.</p>
      ) : null}
    </>
  )
}

export default function TimerSection({ stats }) {
  return stats.timer.isActive && stats.timer.segment
    ? <><RunningTimer stats={stats} /><TimerControls stats={stats} /></>
    : <RoutineStarter stats={stats} />
}
