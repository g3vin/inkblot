/**
 * Settings ▸ Timers: the routines, and how the timer is heard (TimerSettings.swift).
 *
 * Built-in routines are shown as they are and cannot be changed — Duplicate makes one
 * that can. Every edit is saved as it is made; a routine that is running keeps the
 * shape it started with, and the next run takes the new one.
 */
import { useState } from 'react'
import { Button, FormRow, IconButton, SelectMenu, Stepper, Toggle } from '../../ui'
import Icon from '../../ui/Icon.jsx'
import { allRoutines, findRoutine } from '../../stats/config.js'
import {
  TIMER_SOUNDS, duplicateRoutine, isBuiltIn, kindTitle, restSegment, segmentTitle, soundTitle, writeSegment,
} from '../../stats/routines.js'
import { formatNumber, newId } from '../../stats/day.js'
import { playSound, requestNotificationPermission } from '../../stats/announcer.js'
import { routineOptions, routinePlan } from '../stats/statsText.js'

const REPEATS = [
  { value: '1', label: 'Once' },
  ...Array.from({ length: 9 }, (_, i) => ({ value: String(i + 2), label: `${i + 2} times` })),
  { value: '0', label: 'Until stopped' },
]
const KINDS = [{ value: 'write', label: 'Write' }, { value: 'rest', label: 'Break' }]
const SOUNDS = TIMER_SOUNDS.map((sound) => ({ value: sound, label: soundTitle(sound) }))

const segmentLength = (segment) => (segment.minutes != null ? `${segment.minutes} min`
  : segment.wordGoal != null ? `${formatNumber(segment.wordGoal)} words` : 'Until skipped')

function SegmentRow({ segment, index, count, onChange, onMove, onDelete }) {
  const change = (patch) => onChange({ ...segment, ...patch })
  return (
    <div className="settings-segment">
      <div className="settings-segment-row">
        <SelectMenu label="Kind" value={segment.kind} options={KINDS} onChange={(kind) => change({ kind, wordGoal: kind === 'rest' ? null : segment.wordGoal })} />
        <input className="settings-input settings-grow" aria-label="Label" placeholder={kindTitle(segment.kind)} value={segment.label} onChange={(event) => change({ label: event.target.value })} />
        <IconButton icon="split" label="Move Up" size="capsule" disabled={index === 0} onClick={() => onMove(-1)} />
        <IconButton icon="merge" label="Move Down" size="capsule" disabled={index === count - 1} onClick={() => onMove(1)} />
        <IconButton icon="delete" label="Delete Segment" size="capsule" disabled={count <= 1} onClick={onDelete} />
      </div>
      <div className="settings-segment-row">
        <label className="settings-check">
          <input type="checkbox" checked={segment.minutes != null} onChange={(event) => change({ minutes: event.target.checked ? (segment.minutes ?? 25) : null })} />
          Clock
        </label>
        {segment.minutes != null ? <Stepper label="Minutes" value={segment.minutes} min={1} max={240} unit="min" onChange={(minutes) => change({ minutes })} /> : null}
        {segment.kind === 'write' ? (
          <input
            className="settings-input settings-number"
            inputMode="numeric"
            aria-label="Word goal"
            placeholder="Word goal"
            title={segment.minutes == null ? 'With no clock, the segment ends when you reach this many words.' : 'A target to write toward. The clock still ends the segment.'}
            value={segment.wordGoal ?? ''}
            onChange={(event) => {
              const value = Number(event.target.value.replace(/[^\d]/g, ''))
              change({ wordGoal: value > 0 ? value : null })
            }}
          />
        ) : null}
        <span className="settings-grow" />
        <SelectMenu label="Sound" value={segment.sound} options={SOUNDS} onChange={(sound) => { change({ sound }); playSound(sound) }} />
      </div>
      {segment.minutes == null && segment.wordGoal == null ? <p className="settings-footer">No clock and no goal: this segment runs until you skip it.</p> : null}
    </div>
  )
}

function RoutineEditor({ routine, onChange }) {
  const change = (patch) => onChange({ ...routine, ...patch })
  const setSegments = (segments) => change({ segments })
  const move = (index, offset) => {
    const target = index + offset
    if (target < 0 || target >= routine.segments.length) return
    const next = [...routine.segments]
    ;[next[index], next[target]] = [next[target], next[index]]
    setSegments(next)
  }
  return (
    <>
      <section className="settings-group">
        <h3>Routine</h3>
        <FormRow label="Name"><input className="settings-input" aria-label="Name" value={routine.name} onChange={(event) => change({ name: event.target.value })} /></FormRow>
        <FormRow label="Run"><SelectMenu label="Run" value={String(routine.repeats)} options={REPEATS} onChange={(v) => change({ repeats: Number(v) })} /></FormRow>
        <FormRow label="Start the next segment on its own"><Toggle label="Start the next segment on its own" checked={routine.autoAdvance} onChange={(autoAdvance) => change({ autoAdvance })} /></FormRow>
        <FormRow label="Pause open time during breaks"><Toggle label="Pause open time during breaks" checked={routine.pauseTrackingOnBreaks} onChange={(pauseTrackingOnBreaks) => change({ pauseTrackingOnBreaks })} /></FormRow>
      </section>
      <section className="settings-group">
        <h3>Segments</h3>
        {routine.segments.map((segment, index) => (
          <SegmentRow
            key={segment.id}
            segment={segment}
            index={index}
            count={routine.segments.length}
            onChange={(next) => setSegments(routine.segments.map((s) => (s.id === segment.id ? next : s)))}
            onMove={(offset) => move(index, offset)}
            onDelete={() => setSegments(routine.segments.filter((s) => s.id !== segment.id))}
          />
        ))}
        <div className="settings-actions">
          <Button onClick={() => setSegments([...routine.segments, writeSegment(25)])}><Icon name="edit" />Add Writing</Button>
          <Button onClick={() => setSegments([...routine.segments, restSegment(5)])}><Icon name="break" />Add Break</Button>
        </div>
        <p className="settings-footer">{routinePlan(routine)}</p>
      </section>
    </>
  )
}

export default function TimersPane({ stats }) {
  const config = stats.config
  const [selection, setSelection] = useState(null)
  const selected = findRoutine(config, selection) ?? allRoutines(config)[0]
  const save = (next) => stats.saveConfig(next)
  const add = (routine) => {
    save({ ...config, routines: [...config.routines, routine] })
    setSelection(routine.id)
  }
  return (
    <>
      <section className="settings-group">
        <FormRow label="Notify when a segment ends">
          <Toggle label="Notify when a segment ends" checked={config.timerNotifications} onChange={(v) => { save({ ...config, timerNotifications: v }); if (v) requestNotificationPermission() }} />
        </FormRow>
        <FormRow label="Play each segment’s sound"><Toggle label="Play each segment’s sound" checked={config.timerSounds} onChange={(v) => save({ ...config, timerSounds: v })} /></FormRow>
        <p className="settings-footer">Notifications reach you in other apps, so a break ends where you are.</p>
      </section>
      <section className="settings-group">
        <FormRow label="Sprint mode"><Toggle label="Sprint mode" checked={config.sprintFocus} onChange={(v) => save({ ...config, sprintFocus: v })} /></FormRow>
        <FormRow label="Show the timer and today’s goal in the menu bar"><Toggle label="Show the timer in the menu bar" checked={config.menuBarExtra} onChange={(v) => save({ ...config, menuBarExtra: v })} /></FormRow>
        <p className="settings-footer">In sprint mode a writing segment turns on focus mode, which puts the file tree and the inspector away, and a break brings them back.</p>
      </section>
      <section className="settings-group">
        <h3>Routines</h3>
        <FormRow label="Routine"><SelectMenu label="Routine" value={selected.id} options={routineOptions(config)} onChange={setSelection} /></FormRow>
        <div className="settings-actions">
          <Button onClick={() => add({ id: newId(), name: 'My Routine', segments: [writeSegment(30), restSegment(5)], repeats: 1, autoAdvance: true, pauseTrackingOnBreaks: true })}><Icon name="add" />New Routine</Button>
          <Button onClick={() => add(duplicateRoutine(selected))}><Icon name="copy" />Duplicate</Button>
          <span className="settings-grow" />
          <Button variant="destructive" disabled={isBuiltIn(selected)} onClick={() => {
            save({ ...config, routines: config.routines.filter((r) => r.id !== selected.id), lastRoutineID: config.lastRoutineID === selected.id ? null : config.lastRoutineID })
            setSelection(null)
          }}><Icon name="delete" />Delete</Button>
        </div>
      </section>
      {isBuiltIn(selected) ? (
        <section className="settings-group">
          <h3>{selected.name}</h3>
          {selected.segments.map((segment) => (
            <FormRow key={segment.id} label={<span className="settings-inline"><Icon name={segment.kind === 'write' ? 'edit' : 'break'} />{segmentTitle(segment)}</span>}>
              <span className="settings-value">{segmentLength(segment)}</span>
            </FormRow>
          ))}
          <p className="settings-footer">Built-in routines can’t be changed. Duplicate this one to make your own.</p>
        </section>
      ) : (
        <RoutineEditor routine={selected} onChange={(next) => save({ ...config, routines: config.routines.map((r) => (r.id === next.id ? next : r)) })} />
      )}
    </>
  )
}
