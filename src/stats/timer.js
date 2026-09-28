/**
 * Runs a writing routine: write for this long, break for that long, and so on to
 * the end — or until the writer stops.
 *
 * **Wall-clock deadlines, not a countdown.** A segment with a clock ends at a
 * time, and every question — how long is left, has it ended — is asked of the
 * clock. A tick that comes late (a throttled background tab, a sleeping laptop)
 * loses nothing: the next one sees the deadline passed and moves on, through as
 * many segments as ended meanwhile, and announces only where it landed.
 *
 * **Words** are the stats tracker's running count, read at the start of a segment
 * and again at its end, so a segment's words are what the Stats tab counts.
 *
 * Observers subscribe with `subscribe`; the timer calls them after every change.
 */
import { formatDuration, formatNumber, newId, utcOffsetMinutes as localOffset } from './day.js'
import { segmentDuration, segmentTitle } from './routines.js'

export const TIMER_CHECKPOINT_INTERVAL = 60

export class WritingTimer {
  /**
   * @param {{now?: () => number, wordsWritten: () => number, project: () => string|null,
   *          utcOffsetMinutes?: (ms: number) => number, record: (run: object) => void,
   *          announce: (announcement: object) => void, track: (runId: string|null, paused: boolean) => void}} env
   */
  constructor(env) {
    this.env = { now: () => Date.now(), utcOffsetMinutes: (ms) => localOffset(new Date(ms)), ...env }
    /** 'idle' | 'running' | 'paused' | 'waiting' */
    this.state = 'idle'
    this.run = null
    this.step = 0
    this.cycle = 0
    this.segmentStart = null
    this.deadline = null
    this.pausedAt = null
    this.lastRun = null
    /** A run that has just finished, for the recap until it is dismissed. */
    this.recap = null
    /** Told the segment running now, or null between segments and after the run. */
    this.onSegmentChanged = null
    this.pausedTotal = 0
    this.segmentWordsBase = 0
    this.lastRecordAt = null
    this.listeners = new Set()
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  changed() {
    for (const listener of this.listeners) listener()
  }

  get routine() { return this.run?.routine ?? null }

  get segment() { return this.routine?.segments[this.step] ?? null }

  get isActive() { return this.state !== 'idle' }

  /* ---------------- what a view asks ---------------- */

  /** Seconds left on the segment's clock, or null for a segment without one. */
  remaining(now = this.env.now()) {
    if (this.deadline == null) return null
    return Math.max(0, (this.deadline - (this.pausedAt ?? now)) / 1000)
  }

  /** Seconds in the segment so far, pauses left out. */
  elapsed(now = this.env.now()) {
    if (this.segmentStart == null) return 0
    return Math.max(0, ((this.pausedAt ?? now) - this.segmentStart - this.pausedTotal) / 1000)
  }

  /** Words written in this segment. */
  get segmentWords() {
    return this.state === 'running' || this.state === 'paused'
      ? Math.max(0, this.env.wordsWritten() - this.segmentWordsBase)
      : 0
  }

  /** How far through the segment: by its clock, or by its word goal. */
  progress(now = this.env.now()) {
    const segment = this.segment
    if (!segment) return null
    const duration = segmentDuration(segment)
    if (duration != null && duration > 0) return Math.min(1, this.elapsed(now) / duration)
    if (segment.wordGoal > 0) return Math.min(1, this.segmentWords / segment.wordGoal)
    return null
  }

  /** "2 of 8", and "round 2 of 3" when it repeats. */
  get position() {
    const routine = this.routine
    if (!routine) return ''
    const place = `${this.step + 1} of ${routine.segments.length}`
    if (routine.repeats === 1) return place
    if (routine.repeats === 0) return `${place}, round ${this.cycle + 1}`
    return `${place}, round ${this.cycle + 1} of ${routine.repeats}`
  }

  /* ---------------- what the writer does ---------------- */

  start(routine) {
    if (!routine?.segments?.length) return
    if (this.isActive) this.stop()
    const now = this.env.now()
    this.run = {
      id: newId(), routine, project: this.env.project() ?? null, start: now,
      utcOffsetMinutes: this.env.utcOffsetMinutes(now), end: now,
      writeSecs: 0, breakSecs: 0, wordsWritten: 0, sprintsCompleted: 0, sprintsSkipped: 0, completed: false,
    }
    this.step = 0
    this.cycle = 0
    this.lastRecordAt = now
    this.begin(now)
    if (this.segment) this.env.announce(this.announcement('began', this.segment, null))
    this.changed()
  }

  pause() {
    if (this.state !== 'running') return
    this.pausedAt = this.env.now()
    this.state = 'paused'
    this.changed()
  }

  resume() {
    if (this.state !== 'paused' || this.pausedAt == null) return
    const gap = this.env.now() - this.pausedAt
    this.pausedTotal += gap
    if (this.deadline != null) this.deadline += gap
    this.pausedAt = null
    this.state = 'running'
    this.changed()
  }

  toggle() {
    if (this.state === 'running') this.pause()
    else if (this.state === 'paused') this.resume()
    else if (this.state === 'waiting') this.proceed()
  }

  /** End the segment now and go on. A writing segment ended this way is skipped. */
  skip() {
    if (this.state === 'running' || this.state === 'paused') {
      if (this.state === 'paused') this.resume()
      const announcement = this.finishSegment(this.env.now(), false)
      if (announcement) this.env.announce(announcement)
      this.changed()
    } else if (this.state === 'waiting') {
      this.proceed()
    }
  }

  /** Begin the segment a waiting routine is holding. */
  proceed() {
    if (this.state !== 'waiting') return
    this.begin(this.env.now())
    if (this.segment) this.env.announce(this.announcement('began', this.segment, null))
    this.changed()
  }

  /** Stop the run where it is. What was written counts; nothing is finished. */
  stop() {
    const run = this.run
    if (!run || !this.isActive) return
    const now = this.env.now()
    const segment = this.segment
    if ((this.state === 'running' || this.state === 'paused') && segment) {
      const spent = this.elapsed(now)
      if (segment.kind === 'write') {
        run.writeSecs += spent
        run.wordsWritten += this.segmentWords
      } else {
        run.breakSecs += spent
      }
    }
    run.end = this.pausedAt ?? now
    this.env.record(recordOf(run))
    this.lastRun = run
    this.reset()
    this.changed()
  }

  dismissRecap() {
    this.recap = null
    this.changed()
  }

  /* ---------------- the clock ---------------- */

  tick() {
    if (this.state !== 'running' || !this.run) return
    const now = this.env.now()
    let announcement = null
    let moved = false
    // Every segment that has ended since the last tick, in order; only the last is announced.
    while (this.state === 'running' && this.segment) {
      const segment = this.segment
      if (this.deadline != null && this.deadline <= now) {
        announcement = this.finishSegment(this.deadline, true) ?? announcement
      } else if (segment.kind === 'write' && segment.minutes == null && segment.wordGoal != null
                 && this.segmentWords >= segment.wordGoal) {
        announcement = this.finishSegment(now, true) ?? announcement
      } else {
        break
      }
      moved = true
    }
    if (announcement) this.env.announce(announcement)

    if (this.run && this.isActive && (now - (this.lastRecordAt ?? this.run.start)) / 1000 >= TIMER_CHECKPOINT_INTERVAL) {
      this.env.record(recordOf({ ...this.run, end: now }))
      this.lastRecordAt = now
    }
    if (moved) this.changed()
  }

  /* ---------------- internals ---------------- */

  begin(at) {
    const segment = this.segment
    const run = this.run
    if (!segment || !run) return
    this.segmentStart = at
    const duration = segmentDuration(segment)
    this.deadline = duration == null ? null : at + duration * 1000
    this.pausedAt = null
    this.pausedTotal = 0
    this.segmentWordsBase = this.env.wordsWritten()
    this.state = 'running'
    this.env.track(run.id, segment.kind === 'rest' && run.routine.pauseTrackingOnBreaks)
    this.onSegmentChanged?.(segment)
  }

  /** Account for the segment ending at `end` and move on. Returns what to announce. */
  finishSegment(end, finished) {
    const run = this.run
    const routine = this.routine
    const segment = this.segment
    if (!run || !routine || !segment || this.segmentStart == null) return null
    const spent = Math.max(0, (end - this.segmentStart - this.pausedTotal) / 1000)
    const words = this.segmentWords
    if (segment.kind === 'write') {
      run.writeSecs += spent
      run.wordsWritten += words
      if (finished) run.sprintsCompleted += 1
      else run.sprintsSkipped += 1
    } else {
      run.breakSecs += spent
    }
    run.end = end

    let nextStep = this.step + 1
    let nextCycle = this.cycle
    if (nextStep >= routine.segments.length) {
      nextStep = 0
      nextCycle += 1
    }
    if (routine.repeats > 0 && nextCycle >= routine.repeats) {
      run.completed = true
      this.env.record(recordOf(run))
      this.lastRun = run
      this.recap = run
      this.reset()
      return {
        kind: 'finished', title: `${routine.name} complete`,
        body: `${formatNumber(run.wordsWritten)} words in ${formatDuration(run.writeSecs)} of writing.`,
        sound: 'hero',
      }
    }

    this.step = nextStep
    this.cycle = nextCycle
    const wrote = segment.kind === 'write' ? words : null
    if (!routine.autoAdvance) {
      this.state = 'waiting'
      this.segmentStart = null
      this.deadline = null
      this.env.track(run.id, false)
      this.onSegmentChanged?.(null)
      const next = routine.segments[this.step]
      return {
        kind: 'waiting', title: `${segmentTitle(segment)} is over`,
        body: [wroteLine(wrote), `${segmentTitle(next)} is next — start it when you’re ready.`].filter(Boolean).join(' '),
        sound: next.sound,
      }
    }
    this.begin(end)
    return this.announcement('began', routine.segments[this.step], wrote)
  }

  announcement(kind, segment, wrote) {
    const length = segment.minutes != null
      ? `${segment.minutes} minute${segment.minutes === 1 ? '' : 's'}`
      : segment.wordGoal != null ? `${formatNumber(segment.wordGoal)} words` : null
    const title = segment.kind === 'write' ? 'Time to write' : 'Time for a break'
    const body = [wroteLine(wrote), [segmentTitle(segment), length].filter(Boolean).join(' — ')].filter(Boolean).join(' ')
    return { kind, title, body, sound: segment.sound }
  }

  reset() {
    this.state = 'idle'
    this.run = null
    this.step = 0
    this.cycle = 0
    this.segmentStart = null
    this.deadline = null
    this.pausedAt = null
    this.pausedTotal = 0
    this.env.track(null, false)
    this.onSegmentChanged?.(null)
  }
}

function wroteLine(words) {
  return words == null ? null : `You wrote ${formatNumber(words)} word${words === 1 ? '' : 's'}.`
}

function recordOf(run) {
  return {
    id: run.id, routineName: run.routine.name,
    ...(run.project ? { project: run.project } : {}),
    start: run.start, end: run.end, utcOffsetMinutes: run.utcOffsetMinutes,
    writeSecs: Math.round(run.writeSecs), breakSecs: Math.round(run.breakSecs),
    wordsWritten: Math.max(0, run.wordsWritten),
    sprintsCompleted: run.sprintsCompleted, sprintsSkipped: run.sprintsSkipped,
    completed: run.completed,
  }
}
