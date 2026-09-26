/**
 * passageJump.js — "go to the passage": open a document at an event's text.
 *
 * The document may not be open yet, so the request waits here until the editor that
 * shows it has loaded and claims it (useEditorTimeline.js) — or is claimed at once
 * by one already showing it, through the window event. Exactly one of the two takes
 * it, because taking it clears the slot.
 */
export const PASSAGE_JUMP_EVENT = 'timeline:jump-to-passage'

let pending = null

export function requestPassageJump({ projectName, docPath, eventId, rangeId = null }) {
  if (!docPath || !eventId) return
  pending = { projectName, docPath, eventId, rangeId }
  window.dispatchEvent(new CustomEvent(PASSAGE_JUMP_EVENT, { detail: pending }))
}

/** The waiting jump for this document, taken — or null. */
export function takePassageJump(projectName, docPath) {
  if (!pending || pending.docPath !== docPath || (pending.projectName && pending.projectName !== projectName)) return null
  const jump = pending
  pending = null
  return jump
}
