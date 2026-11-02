/**
 * focusModeSettings — what focus mode shows, and how large, as the writer last left it.
 */
import { getPreference, setPreference } from '../lib/preferences'

const FOCUS_MODE_SETTINGS_KEY = 'inkblot-focus-mode-settings'

export const FOCUS_MODE_LIMITS = {
  before: { min: 0, max: 6 },
  after: { min: 0, max: 6 },
  fontSize: { min: 28, max: 72 },
  contextFontSize: { min: 18, max: 56 },
}

export const DEFAULT_FOCUS_MODE_SETTINGS = {
  before: 0,
  after: 0,
  fontSize: 42,
  contextFontSize: 28,
  paragraphContext: false,
  showPosition: false,
}

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value))

/** One setting made valid: a number within its limits, or a boolean. */
export const normalizeFocusModeSetting = (key, value) => {
  if (key === 'paragraphContext' || key === 'showPosition') return Boolean(value)
  const limits = FOCUS_MODE_LIMITS[key]
  const number = Number(value)
  return clampNumber(Number.isFinite(number) ? number : DEFAULT_FOCUS_MODE_SETTINGS[key], limits.min, limits.max)
}

/** The saved settings, each clamped to its range; the defaults for anything unreadable. */
export const loadFocusModeSettings = () => {
  try {
    const parsed = JSON.parse(getPreference(FOCUS_MODE_SETTINGS_KEY) || '{}')
    return Object.fromEntries(Object.keys(DEFAULT_FOCUS_MODE_SETTINGS).map((key) => [
      key,
      key in parsed ? normalizeFocusModeSetting(key, parsed[key]) : DEFAULT_FOCUS_MODE_SETTINGS[key],
    ]))
  } catch {
    return DEFAULT_FOCUS_MODE_SETTINGS
  }
}

export const saveFocusModeSettings = (settings) => {
  try {
    setPreference(FOCUS_MODE_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Focus mode still works from the settings in memory.
  }
}
