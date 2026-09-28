/**
 * Writing stats (src/stats): the tracker, the timer, goals, streaks, deadlines,
 * reminders, rhythm and the config, on clocks of the tests' own.
 */
import { ok } from './assert.mjs'

const { StatsTracker, SWITCH_HOLD, CHECKPOINT_INTERVAL } = await import('../../src/stats/tracker.js')
const { WritingTimer, TIMER_CHECKPOINT_INTERVAL } = await import('../../src/stats/timer.js')
const R = await import('../../src/stats/routines.js')
const G = await import('../../src/stats/goals.js')
const C = await import('../../src/stats/config.js')
const { dayKey } = await import('../../src/stats/day.js')

const near = (a, b) => Math.abs(a - b) < 0.001

/* ============================================================
   The tracker
   ============================================================ */

function trackerRig(overrides = {}) {
  const rig = { now: 1_773_489_600_000, present: true, recorded: [] }
  rig.tracker = new StatsTracker({ ...C.defaultStatsConfig(), ...overrides }, {
    now: () => rig.now,
    isPresent: () => rig.present,
    utcOffsetMinutes: () => 0,
    record: (session) => rig.recorded.push(session),
  })
  rig.advance = (seconds, ticking = true) => {
    if (!ticking) { rig.now += seconds * 1000; return }
    for (let i = 0; i < seconds; i += 1) { rig.now += 1000; rig.tracker.tick() }
  }
  const change = (docPath, words, userEdit, paste = false) =>
    ({ pane: 'primary', docPath, userEdit, wordCount: words, charCount: words * 5, inserted: userEdit ? 5 : 0, deleted: 0, paste })
  rig.load = (doc, words) => rig.tracker.edit(change(doc, words, false))
  rig.type = (doc, words, paste = false) => rig.tracker.edit(change(doc, words, true, paste))
  return rig
}

function opened(doc = 'one', words = 100) {
  const rig = trackerRig()
  rig.tracker.follow('Novel')
  rig.tracker.elect(doc)
  rig.load(doc, words)
  return rig
}

{
  const rig = opened()
  rig.tracker.tick()
  rig.advance(30)
  ok('tracker: open time accrues while the writer is there', rig.tracker.session?.open === 30)
  rig.present = false
  rig.advance(20)
  ok('tracker: …and stops when they are not', rig.tracker.session?.open === 30)
}
{
  const rig = opened()
  rig.type('one', 101)
  rig.advance(5, false)
  rig.type('one', 102)
  rig.advance(40, false)
  rig.type('one', 103)
  ok('tracker: edits close together are typing and a pause is not', rig.tracker.session?.active === 7)
  ok('tracker: words added across the edits', rig.tracker.session?.wordsAdded === 3)
}
{
  const rig = opened('one', 100)
  rig.type('one', 110)
  rig.type('one', 104)
  const s = rig.tracker.session
  ok('tracker: words are measured against the loaded count',
    s.wordsAdded === 10 && s.wordsDeleted === 6 && s.startWords === 100 && s.endWords === 104)
}
{
  const rig = opened('one', 100)
  rig.type('one', 102)
  rig.type('one', 402, true)
  ok('tracker: a paste is counted apart', rig.tracker.session.wordsPasted === 300 && rig.tracker.session.wordsAdded === 2)
  ok('tracker: a paste is not written unless asked', rig.tracker.wordsWritten === 2)
}
{
  const rig = trackerRig()
  rig.tracker.follow('Novel')
  rig.tracker.elect('board.canvas')
  rig.type('board.canvas', 50)
  const first = rig.tracker.session.wordsAdded
  rig.type('board.canvas', 53)
  ok('tracker: an edit with no count yet credits nothing', first === 0 && rig.tracker.session.wordsAdded === 3)
}
{
  const rig = opened()
  rig.type('one', 101)
  const id = rig.tracker.session.id
  rig.tracker.elect('two')
  rig.advance(3)
  rig.tracker.elect('one')
  rig.advance(20)
  ok('tracker: a pointer crossing a split does not end the sitting', rig.tracker.session.id === id && rig.tracker.docPath === 'one')
  rig.tracker.elect('two')
  rig.advance(SWITCH_HOLD + 1)
  ok('tracker: an election held long enough moves it', rig.tracker.docPath === 'two' && rig.recorded.at(-1)?.id === id)
}
{
  const rig = opened()
  rig.load('two', 10)
  rig.type('one', 101)
  rig.type('two', 12)
  ok('tracker: an edit to the other pane switches at once',
    rig.tracker.docPath === 'two' && rig.recorded.length === 1 && rig.tracker.session.wordsAdded === 2)
}
{
  const rig = trackerRig({ idleCutoff: 60 })
  rig.tracker.follow('Novel')
  rig.tracker.elect('one')
  rig.load('one', 0)
  rig.type('one', 5)
  rig.present = false
  rig.advance(59)
  const still = rig.tracker.session != null
  rig.advance(2)
  ok('tracker: away past the cutoff ends the session', still && rig.tracker.session == null && rig.recorded.length === 1)
  rig.present = true
  rig.type('one', 6)
  ok('tracker: …and the next edit is a new sitting', rig.tracker.session.id !== rig.recorded[0].id)
}
{
  const rig = opened()
  rig.tracker.tick()
  rig.advance(10)
  rig.tracker.endSession()
  const glance = rig.recorded.length
  rig.tracker.elect('one')
  rig.advance(45)
  rig.tracker.endSession()
  ok('tracker: a glance is not kept and a sitting is', glance === 0 && rig.recorded.length === 1)
}
{
  const rig = opened()
  rig.tracker.tick()
  rig.type('one', 110)
  rig.advance(CHECKPOINT_INTERVAL)
  const pending = rig.tracker.pending
  ok('tracker: a long session is checkpointed', rig.recorded.length === 1)
  ok('tracker: nothing pending right after a checkpoint', pending.written === 0 && pending.open === 0 && !pending.isNewSession)
  rig.type('one', 115)
  ok('tracker: pending is what the store has not seen', rig.tracker.pending.written === 5)
  rig.tracker.endSession()
  ok('tracker: the same session is recorded again',
    rig.recorded.length === 2 && new Set(rig.recorded.map((r) => r.id)).size === 1 && rig.recorded.at(-1).wordsAdded === 15)
}
{
  const rig = opened()
  rig.tracker.tick()
  rig.type('one', 101)
  rig.advance(90)
  rig.type('one', 103)
  rig.tracker.endSession()
  const minutes = rig.recorded.at(-1).minutes
  ok('tracker: minutes are bucketed from the start',
    JSON.stringify(minutes.map((m) => m.minute)) === '[0,1]'
    && JSON.stringify(minutes.map((m) => m.wordsAdded)) === '[1,2]'
    && JSON.stringify(minutes.map((m) => m.openSecs)) === '[59,31]')
}
{
  const rig = opened()
  rig.tracker.setTimerRun('RUN')
  rig.type('one', 101)
  rig.tracker.endSession()
  ok('tracker: a session inside a timer run carries its id', rig.recorded.at(-1).timerRunId === 'RUN')
}

/* ============================================================
   The timer
   ============================================================ */

function timerRig() {
  const rig = { now: 1_773_489_600_000, words: 0, recorded: [], announced: [], tracking: { runId: null, paused: false } }
  rig.timer = new WritingTimer({
    now: () => rig.now,
    wordsWritten: () => rig.words,
    project: () => 'Novel',
    utcOffsetMinutes: () => 0,
    record: (run) => rig.recorded.push(run),
    announce: (a) => rig.announced.push(a),
    track: (runId, paused) => { rig.tracking = { runId, paused } },
  })
  rig.advance = (seconds) => { rig.now += seconds * 1000; rig.timer.tick() }
  return rig
}

const routine = (segments, repeats = 1, autoAdvance = true) =>
  ({ id: 'TEST', name: 'Test', segments, repeats, autoAdvance, pauseTrackingOnBreaks: true })
const W = R.writeSegment
const B = R.restSegment

{
  const rig = timerRig()
  rig.timer.start(routine([W(10), B(5), W(10)]))
  ok('timer: a start is announced', rig.announced.at(-1)?.kind === 'began')
  ok('timer: the clock is the segment', near(rig.timer.remaining(rig.now), 600))
  rig.words = 250
  rig.advance(600)
  ok('timer: a segment ends on its clock', rig.timer.segment.kind === 'rest')
  ok('timer: …saying what was written', rig.announced.at(-1).body.includes('You wrote 250 words.'))
  ok('timer: a break pauses open time', rig.tracking.paused === true)
  rig.advance(300)
  ok('timer: after the break, writing, and tracking again', rig.timer.segment.kind === 'write' && rig.tracking.paused === false)
  rig.words = 400
  rig.advance(600)
  const run = rig.recorded.at(-1)
  ok('timer: the run finishes', rig.timer.state === 'idle' && rig.tracking.runId == null && rig.announced.at(-1).kind === 'finished')
  ok('timer: the finished run is recorded',
    run.completed && run.wordsWritten === 400 && run.sprintsCompleted === 2 && run.writeSecs === 1200 && run.breakSecs === 300)
  ok('timer: a finished run is kept for the recap', rig.timer.recap?.id === run.id)
}
{
  const rig = timerRig()
  rig.timer.start(routine([W(10), B(5), W(10), B(5)], 0))
  rig.announced.length = 0
  rig.advance(17 * 60)
  ok('timer: a sleep passes through every segment that ended', rig.timer.step === 2 && near(rig.timer.remaining(rig.now), 8 * 60))
  ok('timer: …and announces only the last', rig.announced.length === 1)
}
{
  const rig = timerRig()
  rig.timer.start(routine([W(10)]))
  rig.advance(60)
  rig.timer.pause()
  rig.advance(3600)
  ok('timer: a pause stops the clock', rig.timer.state === 'paused' && near(rig.timer.remaining(rig.now), 540))
  rig.timer.resume()
  rig.advance(539)
  const running = rig.timer.state === 'running'
  rig.advance(1)
  ok('timer: resumed, it ends on the moved deadline', running && rig.timer.state === 'idle' && rig.recorded.at(-1).writeSecs === 600)
}
{
  const rig = timerRig()
  rig.words = 1000
  rig.timer.start(routine([W(null, { goal: 100 }), B(5)]))
  rig.words = 1060
  rig.advance(30)
  ok('timer: a word goal shows as progress', rig.timer.segment.kind === 'write' && near(rig.timer.progress(rig.now), 0.6))
  rig.words = 1101
  rig.advance(1)
  ok('timer: …and ends the segment when met', rig.timer.segment.kind === 'rest')
}
{
  const rig = timerRig()
  rig.timer.start(routine([W(25), B(5)]))
  rig.advance(60)
  rig.timer.skip()
  const onBreak = rig.timer.segment.kind === 'rest'
  rig.timer.stop()
  const run = rig.recorded.at(-1)
  ok('timer: a skipped sprint counts as skipped', onBreak && run.sprintsSkipped === 1 && run.sprintsCompleted === 0 && !run.completed)
}
{
  const rig = timerRig()
  rig.timer.start(routine([W(10), B(5)], 1, false))
  rig.advance(600)
  ok('timer: a waiting routine holds the next segment',
    rig.timer.state === 'waiting' && rig.timer.segment.kind === 'rest' && rig.announced.at(-1).kind === 'waiting')
  rig.advance(3600)
  ok('timer: waiting has no clock', rig.timer.state === 'waiting')
  rig.timer.proceed()
  ok('timer: proceed begins it', rig.timer.state === 'running' && near(rig.timer.remaining(rig.now), 300))
}
{
  const rig = timerRig()
  rig.timer.start(routine([W(30)]))
  rig.words = 120
  rig.advance(300)
  rig.timer.stop()
  const run = rig.recorded.at(-1)
  ok('timer: stopping keeps what was written',
    rig.timer.state === 'idle' && run.wordsWritten === 120 && run.writeSecs === 300 && !run.completed && rig.timer.lastRun.wordsWritten === 120)
}
{
  const rig = timerRig()
  rig.timer.start(routine([W(null)]))
  rig.advance(TIMER_CHECKPOINT_INTERVAL)
  ok('timer: a long run is checkpointed', rig.recorded.length === 1 && rig.recorded[0].completed === false)
}
{
  ok('routines: the ladder is 60 · 10 · 30 · 10 · 20', JSON.stringify(R.LADDER.segments.map((s) => s.minutes)) === '[60,10,30,10,20]')
  ok('routines: a pomodoro is 130 minutes', R.plannedDuration(R.POMODORO) === 130 * 60)
  ok('routines: built-ins are built in', R.BUILT_IN_ROUTINES.every(R.isBuiltIn) && !R.isBuiltIn(R.duplicateRoutine(R.LADDER)))
  const segmentIds = R.BUILT_IN_ROUTINES.flatMap((r) => r.segments.map((s) => s.id))
  ok('routines: built-in segment ids are unique', new Set(segmentIds).size === segmentIds.length)
  ok('routines: the built-in ids are fixed', R.SPRINT.id === '5C0F1E6B-7A0D-4B8E-9E57-2A1C3D4E5F00'
    && R.POMODORO.segments[7].id === '5C0F1E6B-7A0D-4B8E-8A11-000000001007' && R.POMODORO.segments[7].label === 'Long Break')
  ok('routines: a summary', R.routineSummary(R.POMODORO) === '25 · 5 · 25 · 5 · 25 · 5 · 25 · 15')
}

/* ============================================================
   The config
   ============================================================ */

{
  const config = { ...C.defaultStatsConfig(), idleCutoff: 120, routines: [R.duplicateRoutine(R.LADDER, 'Mine')] }
  const back = C.parseStatsConfig(C.serializeStatsConfig(config))
  ok('config: round-trips', JSON.stringify(back) === JSON.stringify(C.normalizeStatsConfig(config)) && back.routines[0].name === 'Mine' && back.idleCutoff === 120)
  const broken = C.parseStatsConfig('{"idleCutoff":120,"routines":[{"nonsense":true}]}')
  ok('config: a broken list does not take the rest with it', broken.idleCutoff === 120 && broken.routines.length === 0)
  ok('config: garbage reads as defaults', C.parseStatsConfig('not json').idleCutoff === 300)
  ok('config: Start runs the last routine, or a sprint',
    C.defaultRoutine(C.defaultStatsConfig()).id === R.SPRINT.id
    && C.defaultRoutine({ ...C.defaultStatsConfig(), lastRoutineID: R.LADDER.id }).id === R.LADDER.id)
  // A file an earlier version wrote: weekdays out of order, a missing value left out.
  const swift = C.parseStatsConfig(JSON.stringify({
    goals: { weekly: Array.from({ length: 7 }, () => ({ targets: [{ id: 'T', metric: 'words', amount: 500 }], requireAll: true, rest: false })), overrides: [] },
    reminders: [{ id: 'R', kind: 'goalNudge', hour: 19, minute: 0, weekdays: [3, 1, 2], message: '', enabled: true }],
  }))
  ok('config: reads an earlier version’s file', swift.goals.weekly[3].targets[0].amount === 500
    && swift.goals.project === null && JSON.stringify(swift.reminders[0].weekdays) === '[1,2,3]')
}

/* ============================================================
   Goals, streaks, deadlines, reminders, rhythm
   ============================================================ */

/** 2026-03-02 is a Monday. */
const day = (n) => `2026-03-${String(n).padStart(2, '0')}`
const words = (n) => ({ ...G.emptyProgress(), words: n, netWords: n })
const everyDay = (goal) => ({ ...G.emptyGoalPlan(), weekly: Array.from({ length: 7 }, () => structuredClone(goal)) })
const target = (metric, amount) => ({ id: `${metric}${amount}`, metric, amount })

{
  const targets = [target('words', 500), target('typingMinutes', 30)]
  const progress = { ...G.emptyProgress(), words: 600, typingSecs: 20 * 60 }
  ok('goals: all needs every target', G.goalStatus({ targets, requireAll: true, rest: false }, progress).met === false)
  ok('goals: any needs one', G.goalStatus({ targets, requireAll: false, rest: false }, progress).met === true)
  const all = G.goalStatus({ targets, requireAll: true, rest: false }, progress)
  ok('goals: what is left', all.remainingText === '10 min to go')
  ok('goals: the least-met fraction', near(all.fraction, 2 / 3))
  ok('goals: no goal is neither met nor missed', G.goalStatus(G.emptyDayGoal(), progress).met === null)
}
{
  const plan = everyDay({ targets: [target('words', 500)], requireAll: true, rest: false })
  plan.overrides = [{ id: 'O', day: day(7), goal: { targets: [], requireAll: true, rest: true } }]
  ok('goals: a day overrides its weekday', G.goalFor(plan, day(7)).rest && G.goalFor(plan, day(8)).targets[0].amount === 500)
}
{
  const history = { [day(2)]: words(10), [day(3)]: words(5), [day(4)]: words(1) }
  const streak = G.summarizeStreak(history, G.emptyGoalPlan(), day(5), 0)
  ok('streak: with no goals it is days written, and today breaks nothing',
    streak.current === 3 && !streak.todayCounts && streak.best === 3)
}
{
  const plan = everyDay({ targets: [target('words', 100)], requireAll: true, rest: false })
  plan.weekly[0].rest = true
  const history = { [day(6)]: words(150), [day(7)]: words(120), [day(9)]: words(100), [day(10)]: words(40), [day(11)]: words(300) }
  const streak = G.summarizeStreak(history, plan, day(11), 0)
  ok('streak: a missed goal breaks it and a rest day does not', streak.current === 1 && streak.best === 3 && streak.todayCounts)
}
{
  const history = { [day(2)]: words(1), [day(4)]: words(1), [day(6)]: words(1), [day(7)]: words(1) }
  const one = G.summarizeStreak(history, G.emptyGoalPlan(), day(7), 1)
  ok('streak: a freeze covers a missed day', one.current === 2 && one.freezesUsed === 1)
  ok('streak: two freezes cover two', G.summarizeStreak(history, G.emptyGoalPlan(), day(7), 2).current === 4)
}
{
  const deadline = { id: 'D', project: 'Novel', targetWords: 10_000, due: day(11), writingDays: [1, 2, 3, 4, 5, 6, 7], created: day(2), feedsDailyGoal: true }
  const status = G.deadlineStatus(deadline, 8_000, { [day(2)]: 500 }, day(2))
  ok('deadline: the quota is measured from where today began',
    status.writingDaysLeft === 10 && status.quota === 250 && status.remaining === 2_000)
}
{
  const deadline = { id: 'D', project: 'Novel', targetWords: 1_000, due: day(31), writingDays: [2, 3, 4, 5, 6], created: day(1), feedsDailyGoal: true }
  const net = {}
  for (let n = 1; n <= 14; n += 1) net[day(n)] = 0
  net[day(10)] = 1_000
  const status = G.deadlineStatus(deadline, 500, net, day(15))
  ok('deadline: pace is over writing days', status.pace === 100)
  ok('deadline: projected from pace on writing days', dayKey(status.projectedFinish) === day(20) && status.onTrack)
  ok('deadline: the burndown', status.burndown[0].remaining === 1_000 - (500 - 1_000) && status.burndown.at(-1).remaining === 500)
}
{
  const today = (met, counts, streak) => ({ day: day(2), goalMet: met, remainingText: '400 words to go', wroteToday: counts, streak })
  const morning = new Date(2026, 2, 2, 8)
  const quiet = G.defaultQuietHours()
  const write = { ...G.newReminder('write'), hour: 9, minute: 30, weekdays: [2, 4] }
  const planned = G.planReminders([write], quiet, G.emptyGoalPlan(), today(null, false, 0), morning)
  ok('reminders: a write reminder falls on its days', planned.length === 2
    && planned.map((p) => new Date(p.at).getDay() + 1).join() === '2,4')

  const goals = everyDay({ targets: [target('words', 1000)], requireAll: true, rest: false })
  const nudge = { ...G.newReminder('goalNudge'), hour: 19 }
  const open = G.planReminders([nudge], quiet, goals, today(false, false, 0), morning)
  ok('reminders: a nudge says how far off the goal is', open.length === G.REMINDER_DAYS_AHEAD
    && open[0].body === '400 words to go for today’s goal.' && open[1].body === `Today’s goal: ${(1000).toLocaleString()} words.`)
  const met = G.planReminders([nudge], quiet, goals, today(true, true, 3), morning)
  ok('reminders: …and is not sent once met', met.length === G.REMINDER_DAYS_AHEAD - 1 && !met.some((p) => p.id.endsWith(day(2))))

  const risk = { ...G.newReminder('streakAtRisk'), hour: 21 }
  const atRisk = G.planReminders([risk], quiet, G.emptyGoalPlan(), today(null, false, 5), morning)
  ok('reminders: a streak at risk', atRisk[0].body.includes('5-day streak'))
  const safe = G.planReminders([risk], quiet, G.emptyGoalPlan(), today(null, true, 5), morning)
  ok('reminders: …only when there is one to lose', !safe.some((p) => p.id.endsWith(day(2))))

  const night = { enabled: true, startHour: 22, endHour: 7 }
  ok('reminders: quiet hours run over midnight', G.isQuiet(night, 23) && G.isQuiet(night, 3) && !G.isQuiet(night, 7) && !G.isQuiet(night, 12))
  ok('reminders: …and silence what falls in them',
    G.planReminders([{ ...G.newReminder('write'), hour: 23 }], night, G.emptyGoalPlan(), today(null, false, 0), morning).length === 0)
}
{
  const minutes = [0, 1, 2, 4, 5, 6, 7].map((minute) => ({ minute, openSecs: 60, activeSecs: 40 }))
    .concat([{ minute: 8, openSecs: 60, activeSecs: 5 }])
  ok('rhythm: flow is the longest run of typing minutes', G.longestRun(minutes) === 4)
  const stat = (d, w) => ({ day: d, openSecs: 0, activeSecs: 600, wordsAdded: w, wordsDeleted: Math.floor(w / 4), wordsPasted: 0, sessions: 1,
    hours: Array.from({ length: 24 }, (_, h) => (h === 21 ? 600 : 0)) })
  const insights = G.rhythmInsights([stat(day(14), 1_200), stat(day(5), 1_000)], [], day(14), 15, false)
  ok('rhythm: this week against the last', insights.thisWeekWords === 1_200 && insights.lastWeekWords === 1_000 && insights.weekChange === '+20%')
  ok('rhythm: the best hour and the editing ratio', insights.bestHour === 21 && near(insights.editingRatio, 0.25))
}
