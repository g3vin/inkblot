/**
 * toastStore.js — the toast showing, if any (Toast.jsx draws it). Apart from the
 * component so any module can show one without importing React.
 */
let current = null
let nextId = 1
const listeners = new Set()
const emit = () => listeners.forEach((listener) => listener())

/**
 * Show a toast. `icon` is a semantic icon name; `action` is `{ label, run }`.
 * A new toast replaces the one showing. Returns a function that dismisses it.
 */
export function showToast({ message, icon, action }) {
  const id = nextId++
  current = { id, message, icon, action }
  emit()
  return () => dismissToast(id)
}

/** Dismiss the toast with this id, or whichever is showing. */
export function dismissToast(id) {
  if (!current || (id !== undefined && current.id !== id)) return
  current = null
  emit()
}

export const currentToast = () => current

export function subscribeToasts(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
