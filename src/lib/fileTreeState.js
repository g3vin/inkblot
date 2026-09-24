/**
 * fileTreeState.js — per-project tree order and expansion, persisted locally.
 *
 * Stored in the app's preferences rather than in the project, so it does not travel with a
 * project and is invisible to anything outside this webview. Worth remembering:
 * a native shell cannot read any of this.
 */
import { getPreference, setPreference, renamePreferencePrefix } from './preferences'
const ORDER_PREFIX = 'inkblot-order:'
const EXPANDED_PREFIX = 'inkblot-expanded:'

export const loadOrder = (projectName) => {
  try {
    return JSON.parse(getPreference(`${ORDER_PREFIX}${projectName}`) || '{}')
  } catch {
    return {}
  }
}

export const saveOrder = (projectName, order) => {
  setPreference(`${ORDER_PREFIX}${projectName}`, JSON.stringify(order))
}

export const loadExpanded = (projectName) => {
  try {
    const raw = getPreference(`${EXPANDED_PREFIX}${projectName}`)
    if (!raw) return ['']
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : ['']
  } catch {
    return ['']
  }
}

export const saveExpanded = (projectName, expandedList) => {
  setPreference(`${EXPANDED_PREFIX}${projectName}`, JSON.stringify(expandedList))
}

/** Carry a project's order/expanded preference keys across a project rename. */
export const migrateProjectTreeState = (fromProjectName, toProjectName) => {
  if (!fromProjectName || !toProjectName || fromProjectName === toProjectName) return

  const pairs = [
    [`${ORDER_PREFIX}${fromProjectName}`, `${ORDER_PREFIX}${toProjectName}`],
    [`${EXPANDED_PREFIX}${fromProjectName}`, `${EXPANDED_PREFIX}${toProjectName}`],
  ]

  pairs.forEach(([fromKey, toKey]) => renamePreferencePrefix(fromKey, toKey))
}
