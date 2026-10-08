/** Which inspector sections are open, by section id (inkblot.inspector.sections). */
import { getPreference, setPreference } from '../lib/preferences'

export const SECTIONS_KEY = 'inkblot.inspector.sections'

export function readSectionStates() {
  try {
    const parsed = JSON.parse(getPreference(SECTIONS_KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function writeSectionState(id, open) {
  const states = readSectionStates()
  states[id] = Boolean(open)
  setPreference(SECTIONS_KEY, JSON.stringify(states))
}
