/**
 * useDocumentFieldCommands.js — the Details tab's fields in ⌘K: the document's point of
 * view, and another name for a story entry (lib/documentFields.ts).
 */
import { useCommands } from '../lib/commands'
import { useStoryEntries } from '../lib/storyEntries'

export function useDocumentFieldCommands({ docPath, openRightSidebarTab }) {
  const entries = useStoryEntries()
  const isEntry = Boolean(docPath) && entries.some((entry) => entry.path === docPath)
  useCommands(() => [
    {
      id: 'details.point-of-view',
      section: 'Document',
      title: 'Set point of view…',
      icon: 'characters',
      keywords: ['pov', 'narrator', 'character', 'details'],
      when: () => Boolean(docPath),
      run: () => openRightSidebarTab('details'),
    },
    {
      id: 'details.aliases',
      section: 'Document',
      title: 'Add another name…',
      icon: 'characters',
      keywords: ['alias', 'nickname', 'also called', 'name tags', 'details'],
      when: () => isEntry,
      run: () => openRightSidebarTab('details'),
    },
  ], [docPath, isEntry, openRightSidebarTab])
}
