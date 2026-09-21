/**
 * tabMenu.js — right-clicking a dot in the tab dock.
 *
 * Pops its own menu and reports handled: a dot is a document, not a place in a
 * document, so none of the text or canvas actions apply.
 */
import { deleteEntry } from '../../lib/FileSystem'
import { getDocDisplayName } from '../../lib/docKind'
import { openDocumentWindow } from '../../lib/docWindow'

export async function tabMenu(ctx) {
  const {
    Menu,
    MenuItem,
    PredefinedMenuItem,
    beginRename,
    buildCopyPathSubmenu,
    confirmDelete,
    items,
    onCloseAllTabs,
    onCloseOtherTabs,
    onCloseSplit,
    onCloseTab,
    onCloseTabsToTheRight,
    onKeepTab,
    onOpenDocInSplit,
    onSelectTab,
    openRightSidebarTab,
    projectName,
    refreshFiles,
    revealEntry,
    secondaryDoc,
    splitView,
    tabDot,
  } = ctx
  if (tabDot) {
    const tabId = tabDot.getAttribute('data-tab-id') || ''
    const tabDoc = tabDot.getAttribute('data-tab-doc') || ''
    const tabIsEphemeral = tabDot.classList.contains('is-ephemeral')
    const tabName = tabDoc ? getDocDisplayName(tabDoc) : 'this tab'

    if (tabDoc) {
      items.push(
        await MenuItem.new({
          text: 'Open',
          action: () => onSelectTab?.(tabId),
        }),
        await MenuItem.new({
          text: 'Split Right',
          action: () => onOpenDocInSplit?.(tabDoc, 'columns'),
        }),
        await MenuItem.new({
          text: 'Split Down',
          action: () => onOpenDocInSplit?.(tabDoc, 'rows'),
        }),
        await MenuItem.new({
          text: 'Open in New Window',
          action: () => openDocumentWindow(projectName, tabDoc),
        }),
        await PredefinedMenuItem.new({ item: 'Separator' })
      )

      // An ephemeral tab is one the dock opened on its own for a document
      // picked in the file tree; the next one replaces it unless it is kept.
      if (tabIsEphemeral) {
        items.push(
          await MenuItem.new({
            text: 'Keep Tab Open',
            action: () => onKeepTab?.(tabId),
          }),
          await PredefinedMenuItem.new({ item: 'Separator' })
        )
      }
    }

    items.push(
      await MenuItem.new({
        text: 'Close',
        action: () => onCloseTab?.(tabId),
      }),
      await MenuItem.new({
        text: 'Close Others',
        action: () => onCloseOtherTabs?.(tabId),
      }),
      await MenuItem.new({
        text: 'Close Tabs to the Right',
        action: () => onCloseTabsToTheRight?.(tabId),
      }),
      await MenuItem.new({
        text: 'Close All',
        action: () => onCloseAllTabs?.(),
      })
    )

    if (splitView === 'editor' && secondaryDoc) {
      items.push(
        await MenuItem.new({
          text: 'Close Split',
          action: () => onCloseSplit?.(),
        })
      )
    }

    if (tabDoc) {
      items.push(
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await buildCopyPathSubmenu(tabDoc),
        await MenuItem.new({
          text: 'Open Version History',
          action: () => {
            onSelectTab?.(tabId)
            openRightSidebarTab?.('history')
          },
        }),
        await MenuItem.new({
          text: 'Reveal in Finder',
          action: () => revealEntry(tabDoc, 'file'),
        }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await MenuItem.new({
          text: 'Rename',
          action: () => beginRename(
            tabDoc,
            'file',
            tabDoc.split('/').filter(Boolean).pop(),
            tabDoc.split('/').slice(0, -1).join('/')
          ),
        }),
        await MenuItem.new({
          text: 'Delete',
          action: async () => {
            const ok = await confirmDelete(`Delete "${tabName}"?`)
            if (!ok) return
            await deleteEntry(projectName, tabDoc, 'file')
            onCloseTab?.(tabId)
            await refreshFiles?.()
          },
        })
      )
    }

    const tabMenu = await Menu.new({ items })
    await tabMenu.popup()
    return true
  }

  return false
}
