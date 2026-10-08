/**
 * Everything the writing stats say out loud: the timer's segments, a goal met, and
 * the reminders to write.
 *
 * Notifications go through tauri-plugin-notification in the app, and the browser's
 * `Notification` in a plain page. Permission is asked the first time something
 * wants to notify, not at launch: a writer who never uses the timer is never asked.
 *
 * The sounds are named after macOS's (Glass, Ping, Hero …) and made with Web Audio
 * rather than shipped as files — short chimes, one per name, so a routine saved with
 * a sound keeps a sound of its own.
 */
import { isTauri } from '@tauri-apps/api/core'

let permission = null

async function ensurePermission() {
  if (permission != null) return permission
  try {
    if (isTauri()) {
      const plugin = await import('@tauri-apps/plugin-notification')
      permission = (await plugin.isPermissionGranted()) || (await plugin.requestPermission()) === 'granted'
    } else if (typeof Notification !== 'undefined') {
      permission = Notification.permission === 'granted' || (await Notification.requestPermission()) === 'granted'
    } else {
      permission = false
    }
  } catch {
    permission = false
  }
  return permission
}

export async function requestNotificationPermission() {
  permission = null
  return ensurePermission()
}

/** Post a notification, if the writer has allowed them. `onClick` only works in a plain page. */
export async function notify(title, body, { onClick } = {}) {
  if (!(await ensurePermission())) return
  try {
    if (isTauri()) {
      const plugin = await import('@tauri-apps/plugin-notification')
      plugin.sendNotification({ title, body })
    } else {
      const notification = new Notification(title, { body, tag: 'inkblot' })
      if (onClick) notification.onclick = () => { window.focus(); onClick() }
    }
  } catch (error) {
    console.warn('[stats] notification failed', error)
  }
}

/* ---------------- sounds ---------------- */

/** Partials (frequency multiples), base pitch, decay (s), and a second strike. */
const VOICES = {
  glass: { base: 1318, partials: [1, 2.76, 5.4], decay: 1.1 },
  ping: { base: 1760, partials: [1, 3], decay: 0.6 },
  hero: { base: 523, partials: [1, 2, 3], decay: 1.4, strikes: [0, 0.12, 0.24], steps: [1, 1.26, 1.5] },
  submarine: { base: 220, partials: [1, 2], decay: 1.2, wave: 'triangle' },
  purr: { base: 180, partials: [1, 1.5], decay: 0.5, wave: 'triangle', strikes: [0, 0.08] },
  tink: { base: 2637, partials: [1], decay: 0.18 },
  blow: { base: 392, partials: [1, 2], decay: 0.7, wave: 'sawtooth', soft: true },
  bottle: { base: 330, partials: [1, 2.02], decay: 0.5, wave: 'sine' },
  funk: { base: 294, partials: [1, 1.5, 2], decay: 0.35, wave: 'square', soft: true },
  pop: { base: 880, partials: [1], decay: 0.08, sweep: 0.5 },
}

let audio = null

export function playSound(name) {
  const voice = VOICES[name]
  const Context = typeof window === 'undefined' ? null : window.AudioContext || window.webkitAudioContext
  if (!voice || !Context) return
  try {
    audio ??= new Context()
    if (audio.state === 'suspended') audio.resume()
    const start = audio.currentTime + 0.01
    const strikes = voice.strikes ?? [0]
    strikes.forEach((offset, index) => {
      const pitch = voice.base * (voice.steps?.[index] ?? 1)
      const out = audio.createGain()
      const at = start + offset
      const peak = voice.soft ? 0.08 : 0.18
      out.gain.setValueAtTime(0.0001, at)
      out.gain.exponentialRampToValueAtTime(peak, at + 0.008)
      out.gain.exponentialRampToValueAtTime(0.0001, at + voice.decay)
      out.connect(audio.destination)
      voice.partials.forEach((multiple, partial) => {
        const osc = audio.createOscillator()
        const level = audio.createGain()
        osc.type = voice.wave ?? 'sine'
        osc.frequency.setValueAtTime(pitch * multiple, at)
        if (voice.sweep) osc.frequency.exponentialRampToValueAtTime(pitch * voice.sweep, at + voice.decay)
        level.gain.value = 1 / (partial + 1) ** 1.5
        osc.connect(level).connect(out)
        osc.start(at)
        osc.stop(at + voice.decay + 0.05)
      })
    })
  } catch (error) {
    console.warn('[stats] sound failed', error)
  }
}

/* ---------------- what the stats announce ---------------- */

export function announceTimer(announcement, { notify: shouldNotify, sound }) {
  if (sound && announcement.sound) playSound(announcement.sound)
  if (shouldNotify) notify(announcement.title, announcement.body)
}

export function celebrate(summary, streak, { sound }) {
  if (sound) playSound('hero')
  notify('Today’s goal is met', streak > 1 ? `${summary}. That’s ${streak} days in a row.` : `${summary}. Well written.`)
}
