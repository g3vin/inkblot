/**
 * How a text pane keeps its document open while the file is renamed or moved.
 *
 * Closing the pane is the safe way to let go (hooks/useEntryOperations.js): its
 * teardown flushes the last edit to the old path before the file moves. A text pane
 * can let go in place instead: flush, stop saving, and once the file has moved, file
 * its editor state under the new path and take it straight back. The page never
 * empties and nothing is read again. EditorCanvas registers the handoff while its
 * editors are mounted.
 *
 *   hold(paneId, docPath)  flush and stop saving; false when the pane cannot hold it
 *   carry(paneId, from, to)  the held state goes to the new path, which reopens it
 *   release(paneId)  nothing moved: save again where it was
 */
let current = null

export function setPaneHandoff(handoff) {
  current = handoff
  return () => {
    if (current === handoff) current = null
  }
}

/** The mounted editor's handoff, or null when no text pane is mounted. */
export function paneHandoff() {
  return current
}
