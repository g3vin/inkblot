/**
 * inspectorPresence.js — whether the window's inspector is open.
 *
 * A map draws its own floating panel only while the inspector is closed; with the
 * inspector open, the map's panel is the inspector's Map tab instead. The map lives
 * deep inside the editor, so the fact is a tiny store rather than a prop.
 */
import { useSyncExternalStore } from 'react'

let open = false
const listeners = new Set()

export function setInspectorOpen(next) {
  if (open === Boolean(next)) return
  open = Boolean(next)
  for (const listener of [...listeners]) listener()
}

export const isInspectorOpen = () => open

const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useInspectorOpen() {
  return useSyncExternalStore(subscribe, isInspectorOpen, isInspectorOpen)
}
