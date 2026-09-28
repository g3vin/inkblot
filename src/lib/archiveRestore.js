/**
 * Putting an archived item back. Restoring is by kind: a bubble goes back on its
 * sentence (`restoreArchivedBubble`), and only if that sentence is still in the
 * document as it was archived; otherwise it stays in the archive.
 */
import { restoreArchivedBubble } from '../hooks/useBubbleSessions'

/** Put an archived item back into the document in `editor`. Returns whether it went. */
export const restoreArchivedItem = (editor, item) => {
  if (item?.kind === 'bubble') return restoreArchivedBubble(editor, item.bubble)
  return false
}
