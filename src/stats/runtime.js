/**
 * The writing stats, running: the tracker fed by what the page publishes, the
 * writing timer, and today against the goals — one per window, started by
 * `useStatsRuntime`. The web twin of what the Swift app's `AppModel` and
 * `GoalsModel` did.
 *
 * **Presence.** The tracker asks whether the writer is at Inkblot: the window is
 * visible and focused, and there has been input within the idle cutoff. Input is
 * any key, pointer or wheel event in the window.
 *
 * **Goals.** The store is read for the goal plan's scope over the last 400 days,
 * at start and again whenever something is recorded or the day changes. Today is
 * that record plus the live session's unrecorded part, so a ring moves as the
 * writer types. Every tick checks whether today's goal has just been met, and every
 * half minute which reminders are due.
 *
 * Views subscribe with `subscribe` and read `version`; it changes on every tick
 * and every record, so a `useSyncExternalStore` over it re-renders once a second.
 */
import { statsService as defaultService } from './service'
import { StatsTracker } from './tracker.js'
import { WritingTimer } from './timer.js'
import { defaultRoutine, defaultStatsConfig, parseStatsConfig, serializeStatsConfig } from './config.js'
import {
  addProgress, deadlineStatus, emptyProgress, goalFor, goalStatus, goalSummary, planReminders,
  progressFromDay, summarizeStreak,
} from './goals.js'
import { addDays, dayKey } from './day.js'
import * as defaultAnnouncer from './announcer.js'
import { observeEntries } from '../lib/entryOperations'

/** How far back the streak and the heatmap look. */
export const HISTORY_DAYS = 400
const CELEBRATED_KEY = 'inkblot.goals.celebrated'
const REMINDER_CHECK_MS = 30_000

const readStorage = (key) => { try { return localStorage.getItem(key) } catch { return null } }
const writeStorage = (key, value) => { try { localStorage.setItem(key, value) } catch { /* private window */ } }

export class StatsRuntime {
  /**
   * @param {{bridge: object, surface: object, service?: object, announcer?: object, now?: () => number,
   *          isPresent?: (cutoffSecs: number) => boolean}} deps
   */
  constructor({ bridge, surface, service = defaultService, announcer = defaultAnnouncer, now = () => Date.now(), isPresent, focusModeOpen = () => false }) {
    this.bridge = bridge
    this.focusModeOpen = focusModeOpen
    this.surface = surface
    this.service = service
    this.announcer = announcer
    this.now = now
    this.version = 0
    this.listeners = new Set()
    this.config = defaultStatsConfig()
    this.configLoaded = false
    this.lastInputAt = now()

    this.tracker = new StatsTracker(this.config, {
      now,
      isPresent: isPresent ?? ((cutoff) => this.isPresent(cutoff)),
      record: (session) => { this.service.recordSession(session) },
    })
    this.timer = new WritingTimer({
      now,
      wordsWritten: () => this.tracker.wordsWritten,
      project: () => this.tracker.project,
      record: (run) => {
        this.service.recordTimerRun(run)
        this.refreshGoals()
      },
      announce: (announcement) => this.announcer.announceTimer(announcement, {
        notify: this.config.timerNotifications, sound: this.config.timerSounds,
      }),
      track: (runId, paused) => {
        this.tracker.setTimerRun(runId)
        this.tracker.isPaused = paused
      },
    })
    this.timer.onSegmentChanged = (segment) => this.sprintSegmentChanged(segment)
    this.timer.subscribe(() => this.changed())
    this.tracker.onRecord = () => this.refreshGoals()
    this.tracker.onTick = () => this.checkGoals()

    // Goals.
    this.todayKey = dayKey(new Date(now()))
    this.history = {}
    this.deadlineStatuses = {}
    this.deadlineNet = {}
    this.goalsLoaded = false
    this.metJustNow = false
    this.loadingDay = null
    this.loadSerial = 0
    this.lastReminderCheck = 0
    this.remindersFired = new Set()
    this.reminderCursor = null

    /** What sprint mode put away, to put back. */
    this.sprintRestore = null
    this.sprinting = false
  }

  /* ---------------- running ---------------- */

  start() {
    if (this.running) return
    this.running = true
    const offs = []
    offs.push(this.bridge.on('projectChanged', ({ projectName }) => this.tracker.follow(projectName ?? null)))
    offs.push(this.bridge.on('activeEditorChanged', ({ docPath }) => this.tracker.elect(docPath ?? null)))
    offs.push(this.bridge.on('docChanged', (change) => this.tracker.edit(change)))

    const input = () => { this.lastInputAt = this.now() }
    const end = () => {
      this.tracker.endSession()
      if (this.timer.isActive) this.timer.stop()
    }
    for (const type of ['keydown', 'pointerdown', 'pointermove', 'wheel']) {
      window.addEventListener(type, input, { capture: true, passive: true })
      offs.push(() => window.removeEventListener(type, input, { capture: true }))
    }
    // A rename or a move takes the entry's history with it; the session in progress
    // is about the old path, so it ends first.
    offs.push(observeEntries({
      willChange: () => this.tracker.endSession(),
      renamed: (project, path, nextPath, type) => this.service.renameEntry(project, path, nextPath, type === 'folder'),
      moved: (project, path, folder, type) => this.service.moveEntry(project, path, folder, type === 'folder'),
    }))
    window.addEventListener('pagehide', end)
    offs.push(() => window.removeEventListener('pagehide', end))

    const ticker = setInterval(() => this.tick(), 1000)
    offs.push(() => clearInterval(ticker))
    this.offs = offs

    this.service.loadConfig().then((json) => {
      this.applyConfig(parseStatsConfig(json))
      this.configLoaded = true
      this.refreshGoals()
    })
  }

  stop() {
    if (!this.running) return
    this.running = false
    this.tracker.endSession()
    for (const off of this.offs ?? []) off()
    this.offs = null
  }

  tick() {
    this.tracker.tick()
    this.timer.tick()
    this.changed()
  }

  isPresent(cutoffSecs) {
    if (typeof document === 'undefined') return false
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return false
    return this.now() - this.lastInputAt < cutoffSecs * 1000
  }

  subscribe = (listener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion = () => this.version

  changed() {
    this.version += 1
    for (const listener of [...this.listeners]) listener()
  }

  /* ---------------- settings ---------------- */

  applyConfig(config) {
    this.config = config
    this.tracker.config = config
  }

  /** Keep the stats settings, and let what depends on them see the change. */
  saveConfig(next) {
    this.applyConfig(next)
    this.service.saveConfig(serializeStatsConfig(next))
    this.refreshGoals()
    this.changed()
  }

  updateConfig(change) {
    this.saveConfig(change(structuredClone(this.config)))
  }

  /* ---------------- the timer ---------------- */

  get defaultRoutine() { return defaultRoutine(this.config) }

  /** Run a routine, and remember it as the one Start runs next time. */
  startTimer(routine = this.defaultRoutine) {
    if (this.config.timerNotifications) this.announcer.requestNotificationPermission?.()
    this.saveConfig({ ...this.config, lastRoutineID: routine.id })
    this.timer.start(routine)
  }

  /**
   * Sprint mode: a writing segment clears the screen — focus mode, the sidebars
   * away — and the end of it puts back what was there.
   */
  sprintSegmentChanged(segment) {
    const writing = segment?.kind === 'write'
    const focusOpen = () => Boolean(this.focusModeOpen())
    if (writing && this.config.sprintFocus && !this.sprintRestore) {
      this.sprintRestore = { focusMode: focusOpen() }
      if (!focusOpen()) this.bridge.send('setFocusMode', { open: true })
      this.sprinting = true
    } else if (!writing && this.sprintRestore) {
      const restore = this.sprintRestore
      this.sprintRestore = null
      if (!restore.focusMode && focusOpen()) this.bridge.send('setFocusMode', { open: false })
      this.sprinting = false
    }
    this.changed()
  }

  /** The Stats tab, from the Timer menu or a notification. */
  showStats() {
    this.surface.publishShowSidebarTab?.({ tab: 'stats' })
  }

  /* ---------------- goals ---------------- */

  get plan() { return this.config.goals }

  get todayGoal() { return goalFor(this.plan, this.todayKey) }

  live(project) {
    const session = this.tracker.session
    if (!session || (project != null && session.project !== project)) return emptyProgress()
    const pending = this.tracker.pending
    return {
      words: pending.written, netWords: pending.written - pending.deleted,
      typingSecs: pending.active, openSecs: pending.open, sessions: pending.isNewSession ? 1 : 0, sprints: 0,
    }
  }

  /** Today: the store's record and the live session's unrecorded work. */
  get today() {
    return addProgress(this.history[this.todayKey] ?? emptyProgress(), this.live(this.plan.project))
  }

  get status() { return goalStatus(this.todayGoal, this.today) }

  get streak() {
    const days = { ...this.history, [this.todayKey]: this.today }
    return summarizeStreak(days, this.plan, this.todayKey, this.config.streakFreezesPerMonth)
  }

  /** Net words today in a deadline's project, stored and live. */
  netToday(deadline) {
    return (this.deadlineNet[deadline.id]?.[this.todayKey] ?? 0) + this.live(deadline.project).netWords
  }

  refreshGoals() {
    const serial = ++this.loadSerial
    this.loadGoals(serial)
  }

  async loadGoals(serial) {
    const now = new Date(this.now())
    const today = dayKey(now)
    const from = dayKey(addDays(now, -HISTORY_DAYS))
    const plan = this.plan
    const countPastes = this.config.countPastedWords
    const scope = { project: plan.project }
    const [days, runs] = await Promise.all([
      this.service.daily(scope, from, today),
      this.service.timerRuns(plan.project, from, today),
    ])
    if (serial !== this.loadSerial) return

    const sprints = {}
    for (const run of runs) {
      const day = dayKey(new Date(run.start))
      sprints[day] = (sprints[day] ?? 0) + (run.sprintsCompleted ?? 0)
    }
    const history = {}
    for (const day of days) history[day.day] = progressFromDay(day, sprints[day.day] ?? 0, countPastes)
    for (const [day, count] of Object.entries(sprints)) history[day] ??= { ...emptyProgress(), sprints: count }

    const statuses = {}
    const nets = {}
    for (const deadline of this.config.deadlines) {
      const recent = dayKey(addDays(now, -15))
      const start = deadline.created < recent ? deadline.created : recent
      const deadlineDays = await this.service.daily({ project: deadline.project }, start, today)
      const net = Object.fromEntries(deadlineDays.map((d) => [d.day, d.wordsAdded + d.wordsPasted - d.wordsDeleted]))
      const counts = await this.service.projectWordCounts(deadline.project)
      const length = counts.reduce((sum, count) => sum + count.words, 0)
      nets[deadline.id] = net
      statuses[deadline.id] = deadlineStatus(deadline, length, net, today)
    }
    if (serial !== this.loadSerial) return

    this.todayKey = today
    this.loadingDay = null
    this.history = history
    this.deadlineStatuses = statuses
    this.deadlineNet = nets
    this.goalsLoaded = true
    this.lastReminderCheck = 0
    this.checkGoals()
    this.changed()
  }

  /** Every second: a new day, today's goal just met, and the reminders due. */
  checkGoals() {
    const now = new Date(this.now())
    const day = dayKey(now)
    if (day !== this.todayKey) {
      if (this.loadingDay !== day) {
        this.loadingDay = day
        this.metJustNow = false
        this.refreshGoals()
      }
      return
    }
    if (!this.goalsLoaded || !this.configLoaded) return

    const status = this.status
    if (status.met === true && readStorage(CELEBRATED_KEY) !== this.todayKey) {
      writeStorage(CELEBRATED_KEY, this.todayKey)
      this.metJustNow = true
      if (this.config.celebrateGoals) {
        this.announcer.celebrate(goalSummary(this.todayGoal), this.streak.current, { sound: this.config.timerSounds })
      }
    }

    // Reminders: a page cannot leave notifications with the system to fire later,
    // so the ones that came due since the last look are posted while Inkblot is open.
    const at = now.getTime()
    if (at - this.lastReminderCheck < REMINDER_CHECK_MS) return
    this.lastReminderCheck = at
    const since = this.reminderCursor ?? at
    this.reminderCursor = at
    if (since === at) return
    const streak = this.streak
    const planned = planReminders(this.config.reminders, this.config.quietHours, this.plan, {
      day: this.todayKey, goalMet: status.met, remainingText: status.remainingText,
      wroteToday: streak.todayCounts, streak: streak.current,
    }, new Date(since))
    for (const reminder of planned) {
      if (reminder.at > at || this.remindersFired.has(reminder.id)) continue
      this.remindersFired.add(reminder.id)
      this.announcer.notify(reminder.title, reminder.body)
    }
  }

  /* ---------------- the store ---------------- */

  async resetStats(scope) {
    this.tracker.endSession()
    await this.service.reset(scope)
    this.tracker.noteStoreChanged()
    this.changed()
  }
}
