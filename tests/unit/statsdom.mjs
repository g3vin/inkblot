/**
 * The writing stats, running in the page: the runtime fed by the real bridge
 * (projectChanged, activeEditorChanged, docChanged), recording through the Tauri
 * commands, the Stats tab and the timer capsule drawn from it, the settings sheet
 * saving the config, and a rename taking a document's history with it.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'DOMParser',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { setInvokeHandler } = await import('./stub-core.mjs')
const { documentSurface } = await import('../../src/bridge/index.ts')
const { getStatsRuntime } = await import('../../src/stats/useStats.js')
const { parseStatsConfig } = await import('../../src/stats/config.js')
const { dayKey } = await import('../../src/stats/day.js')
const { renameEntry, setEntryOperations } = await import('../../src/lib/entryOperations.ts')
const { default: StatsPanel } = await import('../../src/components/stats/StatsPanel.jsx')
const { default: TimerCapsule } = await import('../../src/components/stats/TimerCapsule.jsx')
const { default: SettingsSheet } = await import('../../src/components/settings/SettingsSheet.jsx')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* ---------------- a store behind the commands ---------------- */

const sessions = new Map()
const calls = []
let savedConfig = null
const today = dayKey(new Date())
const sum = (key) => [...sessions.values()].reduce((total, s) => total + (s[key] ?? 0), 0)
setInvokeHandler(async (command, args) => {
  calls.push({ command, args })
  switch (command) {
    case 'stats_config': return savedConfig
    case 'stats_set_config': savedConfig = args.json; return null
    case 'stats_record_session': sessions.set(args.session.id, args.session); return null
    case 'stats_daily': return sessions.size ? [{
      day: today, openSecs: sum('openSecs'), activeSecs: sum('activeSecs'), wordsAdded: sum('wordsAdded'),
      wordsDeleted: sum('wordsDeleted'), wordsPasted: sum('wordsPasted'), sessions: sessions.size, hours: new Array(24).fill(0),
    }] : []
    case 'stats_totals': return {
      sessions: sessions.size, openSecs: sum('openSecs'), activeSecs: sum('activeSecs'), wordsAdded: sum('wordsAdded'),
      wordsDeleted: sum('wordsDeleted'), wordsPasted: sum('wordsPasted'), longestSessionSecs: 0, daysWritten: sessions.size ? 1 : 0,
    }
    case 'stats_sessions': return [...sessions.values()]
    case 'stats_timer_runs': return []
    case 'project_word_counts': return [{ docPath: 'Chapter 1', words: 120, chars: 600 }]
    default: return null
  }
})

const stats = getStatsRuntime()
stats.tracker.env.isPresent = () => true
stats.start()
await act(async () => { await wait(20) })

/* ---------------- the tracker hears the page ---------------- */

documentSurface.publishProjectChanged({ projectName: 'Novel' })
documentSurface.publishActiveEditor({ docPath: 'Chapter 1' })
documentSurface.publishDocChanged({ pane: 'primary', docPath: 'Chapter 1', userEdit: false, wordCount: 100, charCount: 500 })
documentSurface.publishDocChanged({ pane: 'primary', docPath: 'Chapter 1', userEdit: true, wordCount: 112, charCount: 560, inserted: 60, deleted: 0 })
ok('the project and document follow the page', stats.tracker.project === 'Novel' && stats.tracker.docPath === 'Chapter 1')
ok('an edit through the bridge is counted', stats.tracker.session?.wordsAdded === 12 && stats.tracker.wordsWritten === 12)

/* ---------------- the panel ---------------- */

const root = createRoot(document.getElementById('root'))
await act(async () => {
  root.render(React.createElement(React.Fragment, null,
    React.createElement(StatsPanel, { query: '' }),
    React.createElement(TimerCapsule),
    React.createElement(SettingsSheet, { appearance: { theme: 'system', onTheme() {}, accentColor: '#7aaef7', onAccent() {}, accentPresets: [], defaultAccent: '#7aaef7', systemAccent: true, wordCount: true, onWordCount() {} } })))
})
await act(async () => { await wait(30) })

const text = () => document.body.textContent
ok('the panel shows the live session', text().includes('This Session') && /Words written\s*12/.test(text()))
ok('the panel names the scope', text().includes('This document: Chapter 1'))
ok('no goal yet offers to set one', text().includes('No goal for today.'))

// The session reaches the store; the panel reads it and the pending part goes to zero.
await act(async () => { stats.tracker.endSession(); await wait(30) })
ok('an ended session is recorded through the command', sessions.size === 1 && [...sessions.values()][0].wordsAdded === 12)
ok('…and the Today section reads it back', /Today.*Words written\s*12/s.test(text()))

/* ---------------- the timer ---------------- */

const startButton = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Start')
await act(async () => { startButton.click(); await wait(10) })
ok('Start runs the default routine', stats.timer.state === 'running' && stats.timer.routine.name === 'Sprint')
ok('the capsule shows the clock', document.querySelector('.timer-capsule')?.textContent.includes('24:5') || document.querySelector('.timer-capsule')?.textContent.includes('25:00'))
ok('the started routine is remembered', parseStatsConfig(savedConfig).lastRoutineID === stats.timer.routine.id)
await act(async () => { document.querySelector('.timer-capsule [aria-label="Pause"]').click() })
ok('the capsule pauses', stats.timer.state === 'paused')
await act(async () => { document.querySelector('.timer-capsule [aria-label="Stop"]').click(); await wait(10) })
ok('the capsule stops, and the run is recorded', stats.timer.state === 'idle' && calls.some((c) => c.command === 'stats_record_timer_run'))

/* ---------------- settings ---------------- */

await act(async () => { window.dispatchEvent(new CustomEvent('inkblot:open-settings', { detail: { pane: 'writing' } })); await wait(10) })
ok('the settings sheet opens on a pane', text().includes('End a session after'))
const cutoff = document.querySelector('select[aria-label="End a session after"]')
await act(async () => {
  cutoff.value = '600'
  cutoff.dispatchEvent(new window.Event('change', { bubbles: true }))
  await wait(10)
})
ok('a setting is saved as it is made', parseStatsConfig(savedConfig).idleCutoff === 600 && stats.tracker.config.idleCutoff === 600)
const goalsTab = [...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent.includes('Goals'))
await act(async () => { goalsTab.click(); await wait(10) })
ok('the goals pane lists the week', text().includes('Each Week') && text().includes('Particular Days'))

/* ---------------- a rename takes the history ---------------- */

setEntryOperations({
  renameEntry: async () => 'Chapter One',
  moveEntry: async () => null,
  deleteEntry: async () => {},
  duplicateEntry: async () => null,
})
await act(async () => { documentSurface.publishDocChanged({ pane: 'primary', docPath: 'Chapter 1', userEdit: true, wordCount: 115, charCount: 575, inserted: 15 }) })
await act(async () => { await renameEntry('Novel', 'Chapter 1', 'Chapter One', 'file'); await wait(10) })
const rename = calls.find((c) => c.command === 'stats_rename_entry')
ok('a rename ends the session first', sessions.size === 2)
ok('…and re-keys the history', rename?.args.path === 'Chapter 1' && rename.args.newPath === 'Chapter One' && rename.args.isFolder === false)

/* ---------------- sprint mode ---------------- */

const sent = []
const unsubscribe = documentSurface.onCommand('setFocusMode', (payload) => sent.push(payload))
await act(async () => { stats.saveConfig({ ...stats.config, sprintFocus: true }) })
await act(async () => { stats.startTimer(); await wait(10) })
ok('sprint mode turns focus mode on for a writing segment', sent.at(-1)?.open === true)
await act(async () => { stats.timer.stop(); await wait(10) })
unsubscribe?.()

await act(async () => { root.unmount() })
stats.stop()
