/**
 * useDocumentArchive — a document's archive, for the shell's History panel.
 *
 * The archive is in the document's file (`lib/archiveStore.js`), which the page owns.
 * Under the Swift shell this sends the archive of the document the writer is in
 * (`archiveChanged`) whenever that document changes or its archive does, and performs
 * the panel's restore and delete (`archiveAction`). The page's own History panel reads
 * the store itself.
 *
 * Restoring is by kind. A bubble goes back on its sentence (`restoreArchivedBubble`),
 * and only if that sentence is still in the document as it was archived; otherwise it
 * stays in the archive.
 */
import { useEffect, useRef } from 'react'
import { documentSurface } from '../bridge'
import { nativeOwns } from '../lib/host'
import { ARCHIVE_CHANGED_EVENT, getArchive, removeArchivedItem } from '../lib/archiveStore'
import { restoreArchivedBubble } from './useBubbleSessions'

/** Put an archived item back into the document in `editor`. Returns whether it went. */
export const restoreArchivedItem = (editor, item) => {
  if (item?.kind === 'bubble') return restoreArchivedBubble(editor, item.bubble)
  return false
}

export function useDocumentArchive({ projectName, docPath, editorFor }) {
  const native = nativeOwns('rightSidebar')
  const editorForRef = useRef(editorFor)
  useEffect(() => { editorForRef.current = editorFor })

  useEffect(() => {
    if (!native || !projectName || !docPath) return undefined
    let live = true
    const publish = async () => {
      const items = await getArchive(projectName, docPath)
      if (live) documentSurface.publishArchiveChanged({ docPath, items })
    }
    const onChanged = (event) => {
      const { projectName: project, docName } = event?.detail || {}
      if (project === projectName && docName === docPath) publish()
    }
    window.addEventListener(ARCHIVE_CHANGED_EVENT, onChanged)
    publish()
    return () => {
      live = false
      window.removeEventListener(ARCHIVE_CHANGED_EVENT, onChanged)
    }
  }, [native, projectName, docPath])

  useEffect(() => {
    if (!native || !projectName) return undefined
    return documentSurface.onCommand('archiveAction', async ({ docPath: path, itemId, action }) => {
      if (action === 'delete') {
        await removeArchivedItem(projectName, path, itemId)
        return
      }
      const item = (await getArchive(projectName, path)).find((candidate) => candidate.id === itemId)
      const editor = editorForRef.current?.(path)
      if (item && editor && restoreArchivedItem(editor, item)) await removeArchivedItem(projectName, path, itemId)
    })
  }, [native, projectName])
}
