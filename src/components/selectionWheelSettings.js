/**
 * selectionWheelSettings — which tools the selection wheel holds, in which places, and
 * the key held to open it.
 */
import { useSyncExternalStore } from 'react'
import { getPreference, setPreference } from '../lib/preferences'
import { selectionTool } from '../lib/selectionTools'

const SELECTION_WHEEL_KEY = 'inkblot-selection-wheel'

/** More than this and a flick can no longer tell neighbours apart. */
export const WHEEL_MAX_TOOLS = 8

export const HOLD_KEYS = [
  { value: 'Alt', label: 'Option (⌥)' },
  { value: 'Control', label: 'Control (⌃)' },
  { value: 'off', label: 'Off' },
]

// Clockwise from twelve o'clock: the most used where a flick is surest, up and down.
export const DEFAULT_SELECTION_WHEEL = {
  tools: ['highlight', 'bold', 'hide', 'strike', 'bubble', 'italic'],
  holdKey: 'Alt',
}

/** The settings made valid: known tools, each once, at most eight; a known hold key. */
export const normalizeSelectionWheel = (value) => {
  const tools = Array.isArray(value?.tools)
    ? [...new Set(value.tools.filter((id) => typeof id === 'string' && selectionTool(id)))].slice(0, WHEEL_MAX_TOOLS)
    : DEFAULT_SELECTION_WHEEL.tools
  const holdKey = HOLD_KEYS.some((key) => key.value === value?.holdKey) ? value.holdKey : DEFAULT_SELECTION_WHEEL.holdKey
  return { tools, holdKey }
}

let current = null
const listeners = new Set()

export const loadSelectionWheel = () => {
  if (current) return current
  try {
    current = normalizeSelectionWheel(JSON.parse(getPreference(SELECTION_WHEEL_KEY) || '{}'))
  } catch {
    current = DEFAULT_SELECTION_WHEEL
  }
  return current
}

export const saveSelectionWheel = (settings) => {
  current = normalizeSelectionWheel(settings)
  listeners.forEach((listener) => listener())
  try {
    setPreference(SELECTION_WHEEL_KEY, JSON.stringify(current))
  } catch {
    // The wheel still works from the settings in memory.
  }
}

const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The settings, kept current: a change in Settings reaches an open editor at once. */
export const useSelectionWheelSettings = () => useSyncExternalStore(subscribe, loadSelectionWheel)
