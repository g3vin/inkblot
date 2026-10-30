/**
 * notePanelCard.js — where a note sits in the notes panel, for the dot in the text
 * to string to (NotePanelTether) and the hover note to step aside for (NoteHoverPreview).
 */

/**
 * The panel card a note's dot strings to: its branch's root. None when the panel
 * isn't showing it (another document's note, or filtered out by a search), and then
 * the hover note opens as usual.
 */
export const panelCardFor = (note, notes = []) => {
  if (!note?.id || typeof document === 'undefined') return null
  const byId = new Map(notes.map((entry) => [entry.id, entry]))
  let root = byId.get(note.id) || note
  const seen = new Set()
  while (root.parentNoteId && byId.has(root.parentNoteId) && !seen.has(root.id)) {
    seen.add(root.id)
    root = byId.get(root.parentNoteId)
  }
  return document.querySelector(`.notes-panel .note-branch[data-note-id="${CSS.escape(String(root.id))}"] > .note-tile`)
}
