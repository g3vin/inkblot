/**
 * TimerCapsule — the running timer, floating over the page: the segment's clock and
 * progress, with pause, skip and stop. It is what the writer sees of the timer in
 * focus mode and sprint mode, where the toolbar is away. When a routine runs to its
 * end, the recap takes its place (TimerRecapView in MenuBarAndRecap.swift).
 */
import { Button, FloatingCapsule, IconButton, Sheet } from '../../ui'
import Icon from '../../ui/Icon.jsx'
import { useStats } from '../../stats/useStats.js'
import { segmentTitle } from '../../stats/routines.js'
import { formatDuration, formatNumber } from '../../stats/day.js'
import { capitalize, timerClock } from './statsText.js'
import './Stats.css'

function Recap({ stats, run }) {
  const pace = run.writeSecs >= 30 ? formatNumber(run.wordsWritten / (run.writeSecs / 60)) : '—'
  const status = stats.status
  const streak = stats.streak
  const close = () => stats.timer.dismissRecap()
  return (
    <Sheet title={`${run.routine.name} complete`} onClose={close} width={380} className="stats-recap"
      footer={(
        <>
          <Button onClick={() => { close(); stats.startTimer(run.routine) }}>Run again</Button>
          <Button variant="filled" onClick={close}>Done</Button>
        </>
      )}
    >
      <div className="stats-recap-body">
        <span className="stats-recap-seal"><Icon name="verified" size={20} /></span>
        <p className="stats-muted">{formatDuration(run.writeSecs)} of writing, {formatDuration(run.breakSecs)} of breaks</p>
        <div className="stats-recap-figures">
          <span><strong>{formatNumber(run.wordsWritten)}</strong><small>words</small></span>
          <span><strong>{pace}</strong><small>words a minute</small></span>
          <span><strong>{run.sprintsCompleted}</strong><small>{run.sprintsCompleted === 1 ? 'sprint' : 'sprints'}</small></span>
        </div>
        {status.met != null ? (
          <p className="stats-muted stats-inline">
            <Icon name={status.met ? 'check' : 'target'} />
            {status.met ? 'Today’s goal is met.' : status.remainingText ? `${capitalize(status.remainingText)} today.` : ''}
          </p>
        ) : null}
        {streak.current > 0 ? <p className="stats-muted stats-inline"><Icon name="streak" />{streak.current}-day streak</p> : null}
      </div>
    </Sheet>
  )
}

export default function TimerCapsule() {
  const stats = useStats()
  const timer = stats.timer
  if (timer.recap) return <Recap stats={stats} run={timer.recap} />
  const segment = timer.segment
  if (!timer.isActive || !segment) return null
  const progress = timer.state === 'waiting' ? null : timer.progress(stats.now())
  return (
    <FloatingCapsule className="timer-capsule" data-state={timer.state} data-kind={segment.kind} role="timer" aria-label={`${segmentTitle(segment)}, ${timerClock(timer, stats.now())}`}>
      <button type="button" className="timer-capsule-face" onClick={() => stats.showStats()} title="Show in stats">
        <Icon name={segment.kind === 'write' ? 'edit' : 'break'} />
        <span className="timer-capsule-title">{segmentTitle(segment)}</span>
        <span className="timer-capsule-clock">{timerClock(timer, stats.now())}</span>
      </button>
      {timer.state === 'waiting' ? (
        <IconButton icon="play" label={`Start ${segmentTitle(segment)}`} size="capsule" onClick={() => timer.proceed()} />
      ) : (
        <>
          <IconButton icon={timer.state === 'paused' ? 'play' : 'pause'} label={timer.state === 'paused' ? 'Resume' : 'Pause'} size="capsule" onClick={() => timer.toggle()} />
          <IconButton icon="skip" label="Skip to next segment" size="capsule" onClick={() => timer.skip()} />
        </>
      )}
      <IconButton icon="stop" label="Stop" size="capsule" onClick={() => timer.stop()} />
      {progress != null ? <span className="timer-capsule-progress" style={{ transform: `scaleX(${progress})` }} /> : null}
    </FloatingCapsule>
  )
}
