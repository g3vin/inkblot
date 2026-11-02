/** Which inspector sections are open, by section id (inkblot.inspector.sections). */
import { getObjectPreference, setPreference } from '../lib/preferences'

export const SECTIONS_KEY = 'inkblot.inspector.sections'

export function readSectionStates() {
  return getObjectPreference(SECTIONS_KEY)
}

export function writeSectionState(id, open) {
  const states = readSectionStates()
  states[id] = Boolean(open)
  setPreference(SECTIONS_KEY, JSON.stringify(states))
}
