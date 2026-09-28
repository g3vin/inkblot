/**
 * Turns what the page reports into sittings: time with a document open, time
 * typing, words written and deleted, minute by minute, recorded as
 * `WritingSession`s through the stats store.
 *
 * **What a session is.** One sitting at one document, from the first moment it is
 * in front of the writer to the last. It ends when the writer moves to another
 * document or project, or has been away longer than the idle cutoff, or the window
 * is hidden or closed. The next moment at a document starts a new one.
 *
 * **Open time** accrues on a one-second tick while the writer is present: the
 * window is visible and focused and there has been input within the idle cutoff.
 * **Active time** accrues on edits: the gap between two edits closer together than
 * the active gap is typing; a longer one is thinking, and the edit after it is
 * credited a second.
 *
 * **Words** are the difference between successive counts the page sends, so a
 * count is needed before the first edit to measure it against — the page sends one
 * when a document loads (`userEdit: false`).
 *
 * **Which document.** The page elects the active editor by where the pointer is,
 * so a switch by election is held for `SWITCH_HOLD` before it takes; an *edit* to
 * another document switches at once.
 *
 * Everything it depends on is injected (`env`), so the tests drive it with a clock
 * of their own.
 */
import { newId, utcOffsetMinutes as localOffset } from './day.js'

/** A pointer election has to hold this long (seconds) to move the session. */
export const SWITCH_HOLD = 10
/** A session in progress is recorded this often, so a crash costs at most this. */
export const CHECKPOINT_INTERVAL = 60
/** The most one tick may credit. A late tick has not seen the writer in between. */
export const MAX_TICK = 5
/** What the first edit after a pause is worth. */
export const BURST_CREDIT = 1

const key = (project, docPath) => `${project}\u0000${docPath}`

const sameSession = (a, b) => a != null && b != null && JSON.stringify(a) === JSON.stringify(b)

const writtenBy = (session, countingPastes) => session.wordsAdded + (countingPastes ? session.wordsPasted : 0)

function toRecord(session) {
  const round = Math.round
  return {
    id: session.id,
    project: session.project,
    docPath: session.docPath,
    start: session.start,
    end: session.end,
    utcOffsetMinutes: session.utcOffsetMinutes,
    openSecs: round(session.open),
    activeSecs: round(session.active),
    wordsAdded: session.wordsAdded,
    wordsDeleted: session.wordsDeleted,
    wordsPasted: session.wordsPasted,
    charsAdded: session.charsAdded,
    charsDeleted: session.charsDeleted,
    startWords: session.startWords ?? 0,
    endWords: session.endWords ?? 0,
    minutes: Object.keys(session.minutes).map(Number).sort((a, b) => a - b).map((index) => {
      const minute = session.minutes[index]
      return {
        minute: index,
        openSecs: round(minute.open), activeSecs: round(minute.active),
        wordsAdded: minute.added, wordsDeleted: minute.deleted, wordsPasted: minute.pasted,
      }
    }),
    ...(session.timerRunId ? { timerRunId: session.timerRunId } : {}),
  }
}

function touchMinute(session, at, change) {
  const index = Math.max(0, Math.floor((at - session.start) / 60000))
  const minute = session.minutes[index] ?? { open: 0, active: 0, added: 0, deleted: 0, pasted: 0 }
  change(minute)
  session.minutes[index] = minute
}

export class StatsTracker {
  /**
   * @param {object} config the stats config (idleCutoff, activeGap, countPastedWords, minimumSession)
   * @param {{now?: () => number, isPresent: (cutoffSecs: number) => boolean,
   *          utcOffsetMinutes?: (ms: number) => number, record: (session: object) => void}} env
   */
  constructor(config, env) {
    this.config = config
    this.env = { now: () => Date.now(), utcOffsetMinutes: (ms) => localOffset(new Date(ms)), ...env }
    /** The session in progress. */
    this.session = null
    /** Bumped each time a record reaches the store. */
    this.revision = 0
    this.project = null
    this.docPath = null
    this.timerRunId = null
    /** A break the timer says is not time at the document: open time stops. */
    this.isPaused = false
    /** Words written since launch, as the settings count them — what the timer measures. */
    this.wordsWritten = 0
    this.onRecord = null
    this.onTick = null

    this.wordCounts = new Map()
    this.recorded = null
    this.lastRecordAt = null
    this.lastEditAt = null
    this.lastTickAt = null
    this.awaySince = null
    this.elected = null
  }

  setTimerRun(runId) {
    this.timerRunId = runId
    if (this.session && !this.session.timerRunId) this.session.timerRunId = runId
  }

  /* ---------------- what the page says ---------------- */

  /** The open project changed. Its session is over. */
  follow(project) {
    const next = project ?? null
    if (next === this.project) return
    this.endSession()
    this.project = next
    this.docPath = null
    this.elected = null
  }

  /** The page elected an editor showing `docPath`. An election of nothing is ignored. */
  elect(docPath) {
    if (!docPath) return
    if (docPath === this.docPath) {
      this.elected = null
      return
    }
    if (this.docPath == null) this.switchTo(docPath)
    else if (this.elected?.docPath !== docPath) this.elected = { docPath, since: this.env.now() }
  }

  /** @param {{docPath: string, wordCount: number, userEdit: boolean, paste?: boolean, inserted?: number, deleted?: number}} change */
  edit(change) {
    if (this.project == null) return
    const k = key(this.project, change.docPath)
    const count = change.wordCount

    if (!change.userEdit) {
      // A load: the count the next edit is measured against.
      this.wordCounts.set(k, count)
      if (this.session?.docPath === change.docPath && this.session.startWords == null) {
        this.session.startWords = count
        this.session.endWords = count
      }
      return
    }

    if (change.docPath !== this.docPath) this.switchTo(change.docPath)
    const now = this.env.now()
    this.awaySince = null
    this.begin(now)

    const previous = this.wordCounts.get(k)
    this.wordCounts.set(k, count)
    const paste = Boolean(change.paste)
    const lastEditAt = this.lastEditAt
    this.lastEditAt = now

    const live = this.session
    if (!live) return
    live.end = now
    live.endWords = count
    live.charsAdded += change.inserted ?? 0
    live.charsDeleted += change.deleted ?? 0
    const delta = previous == null ? 0 : count - previous
    let active = BURST_CREDIT
    if (paste) active = 0
    else if (lastEditAt != null && (now - lastEditAt) / 1000 <= this.config.activeGap) active = (now - lastEditAt) / 1000
    live.active += active
    if (delta > 0 && paste) live.wordsPasted += delta
    else if (delta > 0) live.wordsAdded += delta
    else live.wordsDeleted += -delta
    if (delta > 0 && (!paste || this.config.countPastedWords)) this.wordsWritten += delta
    touchMinute(live, now, (minute) => {
      minute.active += active
      if (delta > 0 && paste) minute.pasted += delta
      else if (delta > 0) minute.added += delta
      else minute.deleted += -delta
    })
  }

  /* ---------------- the clock ---------------- */

  /** Once a second: open time, an election that has held, an absence, the checkpoint. */
  tick() {
    const now = this.env.now()
    const elapsed = Math.min(this.lastTickAt == null ? 0 : (now - this.lastTickAt) / 1000, MAX_TICK)
    this.lastTickAt = now

    if (this.elected && (now - this.elected.since) / 1000 >= SWITCH_HOLD) this.switchTo(this.elected.docPath)

    if (this.isPaused) {
      this.awaySince = null
    } else if (this.env.isPresent(this.config.idleCutoff) && this.project != null && this.docPath != null) {
      this.awaySince = null
      this.begin(now)
      if (elapsed > 0 && this.session) {
        this.session.open += elapsed
        this.session.end = now
        touchMinute(this.session, now, (minute) => { minute.open += elapsed })
      }
    } else if (this.session) {
      const since = this.awaySince ?? now
      this.awaySince = since
      if ((now - since) / 1000 >= this.config.idleCutoff) this.endSession()
    }

    const session = this.session
    if (session && !sameSession(session, this.recorded)
        && (now - (this.lastRecordAt ?? session.start)) / 1000 >= CHECKPOINT_INTERVAL) {
      this.record(session, now)
    }
    this.onTick?.()
  }

  /** Record the session in progress, if it is worth keeping, and stop it. */
  endSession() {
    const session = this.session
    if (session && !sameSession(session, this.recorded)) {
      const hasEdits = session.wordsAdded + session.wordsDeleted + session.wordsPasted + session.charsAdded + session.charsDeleted > 0
      if (hasEdits || session.open >= this.config.minimumSession) this.record(session, this.env.now())
    }
    this.session = null
    this.recorded = null
    this.lastEditAt = null
    this.awaySince = null
  }

  /** Something other than a record changed the store — a reset. */
  noteStoreChanged() {
    this.revision += 1
    this.onRecord?.()
  }

  /** The live session's work that is not in the store yet. */
  get pending() {
    const session = this.session
    if (!session) return { written: 0, deleted: 0, open: 0, active: 0, isNewSession: false }
    const base = this.recorded
    const pastes = this.config.countPastedWords
    return {
      written: writtenBy(session, pastes) - (base ? writtenBy(base, pastes) : 0),
      deleted: session.wordsDeleted - (base?.wordsDeleted ?? 0),
      open: session.open - (base?.open ?? 0),
      active: session.active - (base?.active ?? 0),
      isNewSession: base == null,
    }
  }

  /* ---------------- internals ---------------- */

  switchTo(next) {
    this.elected = null
    if (next === this.docPath) return
    this.endSession()
    this.docPath = next
  }

  begin(now) {
    if (this.session || this.project == null || this.docPath == null) return
    const count = this.wordCounts.get(key(this.project, this.docPath))
    this.session = {
      id: newId(), project: this.project, docPath: this.docPath, start: now,
      utcOffsetMinutes: this.env.utcOffsetMinutes(now), end: now,
      open: 0, active: 0, wordsAdded: 0, wordsDeleted: 0, wordsPasted: 0, charsAdded: 0, charsDeleted: 0,
      startWords: count ?? null, endWords: count ?? null, minutes: {}, timerRunId: this.timerRunId,
    }
    this.lastRecordAt = now
    this.lastEditAt = null
  }

  record(session, now) {
    this.env.record(toRecord(session))
    this.recorded = structuredClone(session)
    this.lastRecordAt = now
    this.revision += 1
    this.onRecord?.()
  }
}
