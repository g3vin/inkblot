/**
 * fileTreeMenu.js — project rows, files, folders, and empty space in the tree.
 *
 * Only the file branch pops its own menu. The project, folder and empty-space
 * branches append to the shared item list and fall through to the common actions,
 * which is how the original single callback behaved.
 */
import { deleteProject, getProjectRoot, moveProject } from '../../lib/FileSystem'
import { deleteEntry, duplicateEntry } from '../../lib/entryOperations'
import { allFolderPresets, openFolderPresets } from '../../lib/folderPresets'
import { openDocumentWindow } from '../../lib/docWindow'
import { lockReason, setDocumentLocked, setFolderLocked } from '../../lib/docLocks'
import { isEntryEmpty } from '../../lib/emptiness'

export async function fileTreeMenu(ctx) {
  const {
    Menu,
    MenuItem,
    PredefinedMenuItem,
    beginRename,
    buildCopyPathSubmenu,
    buildMoveToSubmenu,
    confirmDelete,
    e,
    fileItem,
    fileTree,
    isFileTreeArea,
    items,
    onOpenDocInSplit,
    onOpenDocInTab,
    openRightSidebarTab,
    projectItem,
    projectName,
    refreshFiles,
    revealEntry,
    setCurrentDoc,
    treeView,
  } = ctx
  if (projectItem && treeView === 'projects') {
    const projectNameToDelete = projectItem.getAttribute('data-project-name')
    if (projectNameToDelete) {
      items.push(
        await MenuItem.new({
          text: 'Rename project',
          action: async () => {
            window.dispatchEvent(
              new CustomEvent('filetree:new-entry', {
                detail: {
                  rename: true,
                  path: projectNameToDelete,
                  type: 'project',
                  name: projectNameToDelete,
                },
              })
            )
          },
        })
      )

      items.push(
        await MenuItem.new({
          text: 'Move project…',
          action: async () => {
            try {
              const { open } = await import('@tauri-apps/plugin-dialog')
              const target = await open({
                directory: true,
                multiple: false,
                title: `Choose a new folder for "${projectNameToDelete}"`,
              })
              if (typeof target !== 'string' || !target) return

              const result = await moveProject(projectNameToDelete, target)
              if (!result?.ok) {
                const { message } = await import('@tauri-apps/plugin-dialog')
                const reason =
                  result?.error === 'target-exists'
                    ? 'A folder with that project name already exists there.'
                    : 'Could not move the project.'
                await message(reason, { title: 'Move project', kind: 'error' })
                return
              }
              window.dispatchEvent(new CustomEvent('filetree:refresh-projects'))
              await refreshFiles?.()
            } catch (err) {
              console.warn('Failed to move project:', err)
            }
          },
        })
      )

      items.push(
        await MenuItem.new({
          text: 'Reveal in Finder',
          action: async () => {
            try {
              const root = await getProjectRoot(projectNameToDelete)
              const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
              await revealItemInDir(root)
            } catch (err) {
              console.warn('Failed to reveal project:', err)
            }
          },
        })
      )

      items.push(
        await MenuItem.new({
          text: 'Delete project',
          action: async () => {
            const ok = await confirmDelete(`Delete project "${projectNameToDelete}"?`)
            if (ok) {
              await deleteProject(projectNameToDelete)
              window.dispatchEvent(new CustomEvent('filetree:refresh-projects'))
              await refreshFiles?.()
            }
          },
        })
      )
    }
  }

  if (fileTree && treeView === 'projects') {
    items.push(
      await MenuItem.new({
        text: 'New project',
        action: async () => {
          window.dispatchEvent(new CustomEvent('filetree:new-project'))
        },
      })
    )
  }
  if (fileItem && fileItem.hasAttribute('data-entry-path')) {
    const entryType = fileItem.getAttribute('data-entry-type') || 'file'
    const entryPath = fileItem.getAttribute('data-entry-path') || ''
    const entryParent = fileItem.getAttribute('data-entry-parent') || ''
    const isFile = entryType === 'file'
    const isFolder = entryType === 'folder'
    const entryName = entryPath.split('/').filter(Boolean).pop()
    // Locked itself, or inside a locked folder, which is unlocked from the folder.
    const lock = lockReason(entryPath)
    const heldByFolder = lock?.by === 'folder' && lock.folder !== entryPath
    const lockItem = () => MenuItem.new(heldByFolder
      ? { text: `Locked with “${lock.folder.split('/').pop()}”`, enabled: false }
      : {
          text: `${lock ? 'Unlock' : 'Lock'}${isFolder ? ' folder' : ''}`,
          action: () => (isFolder ? setFolderLocked : setDocumentLocked)(projectName, entryPath, !lock),
        })

    // A file's menu is the whole story for that document, so it returns on its
    // own rather than trailing the editor's text actions behind it.
    if (isFile) {
      const fileItems = [
        await MenuItem.new({
          text: 'Open in new tab',
          action: () => onOpenDocInTab?.(entryPath),
        }),
        await MenuItem.new({
          text: 'Open to the right',
          action: () => onOpenDocInSplit?.(entryPath, 'columns'),
        }),
        await MenuItem.new({
          text: 'Open below',
          action: () => onOpenDocInSplit?.(entryPath, 'rows'),
        }),
        await MenuItem.new({
          text: 'Open in new window',
          action: () => openDocumentWindow(projectName, entryPath),
        }),
        await PredefinedMenuItem.new({ item: 'Separator' }),

        await MenuItem.new({
          text: 'Duplicate',
          action: async () => {
            const copyPath = await duplicateEntry(projectName, entryPath)
            await refreshFiles?.()
            if (copyPath) onOpenDocInTab?.(copyPath)
          },
        }),
        await buildMoveToSubmenu(entryPath),
        await lockItem(),
        await PredefinedMenuItem.new({ item: 'Separator' }),

        await buildCopyPathSubmenu(entryPath),
        await PredefinedMenuItem.new({ item: 'Separator' }),

        await MenuItem.new({
          text: 'Open version history',
          action: () => {
            setCurrentDoc?.(entryPath)
            openRightSidebarTab?.('history')
          },
        }),
        await PredefinedMenuItem.new({ item: 'Separator' }),

        await MenuItem.new({
          text: 'Reveal in Finder',
          action: () => revealEntry(entryPath, 'file'),
        }),
        await PredefinedMenuItem.new({ item: 'Separator' }),

        await MenuItem.new({
          text: 'Rename',
          action: () => beginRename(entryPath, entryType, entryName, entryParent),
        }),
        await MenuItem.new({
          text: 'Delete',
          action: async () => {
            const ok = await isEntryEmpty(projectName, entryPath, entryType) || await confirmDelete(`Delete "${entryName}"?`)
            if (!ok) return
            await deleteEntry(projectName, entryPath, entryType)
            await refreshFiles?.()
          },
        }),
      ]

      const fileMenu = await Menu.new({ items: fileItems })
      await fileMenu.popup()
      return true
    }

    if (isFolder) {
      items.push(
        await MenuItem.new({
          text: 'New file in folder',
          action: () => {
            window.dispatchEvent(
              new CustomEvent('filetree:new-entry', {
                detail: { type: 'file', parent: entryPath },
              })
            )
          },
        })
      )

      items.push(
        await MenuItem.new({
          text: 'New folder in folder',
          action: () => {
            window.dispatchEvent(
              new CustomEvent('filetree:new-entry', {
                detail: { type: 'folder', parent: entryPath },
              })
            )
          },
        })
      )

      items.push(await lockItem())

      items.push(
        await MenuItem.new({
          text: 'Reveal in Finder',
          action: () => revealEntry(entryPath, 'folder'),
        })
      )
    }

    items.push(
      await MenuItem.new({
        text: isFolder ? 'Rename folder' : 'Rename file',
        action: () => beginRename(entryPath, entryType, entryName, entryParent),
      })
    )

    items.push(
      await MenuItem.new({
        text: isFolder ? 'Delete folder' : 'Delete file',
        action: async () => {
          const ok = await isEntryEmpty(projectName, entryPath, entryType) || await confirmDelete(`Delete "${entryName}"?`)
          if (ok) {
            await deleteEntry(projectName, entryPath, entryType)
            await refreshFiles?.()
          }
        },
      })
    )

    items.push(await PredefinedMenuItem.new({ item: 'Separator' }))
  }

  const isFileListArea = e.target.closest('.file-list')
  const isProjectItem = e.target.closest('.file-item.project')
  if ((isFileTreeArea || isFileListArea) && treeView !== 'projects' && !fileItem && !isProjectItem) {
    items.push(
      await MenuItem.new({
        text: 'New file',
        action: async () => {
          window.dispatchEvent(
            new CustomEvent('filetree:new-entry', {
              detail: { type: 'file', parent: '' },
            })
          )
        },
      })
    )

    items.push(
      await MenuItem.new({
        text: 'New folder',
        action: async () => {
          window.dispatchEvent(
            new CustomEvent('filetree:new-entry', {
              detail: { type: 'folder', parent: '' },
            })
          )
        },
      })
    )

    // The built-in story folders and the writer's own folder types (folderPresets.ts).
    for (const preset of allFolderPresets()) {
      items.push(
        await MenuItem.new({
          text: `New ${preset.menuLabel}`,
          action: async () => {
            window.dispatchEvent(
              new CustomEvent('filetree:new-entry', {
                detail: { type: 'folder', parent: '', presetKey: preset.key },
              })
            )
          },
        })
      )
    }
    items.push(await MenuItem.new({ text: 'Edit folder types…', action: () => openFolderPresets() }))
  }

  if (isFileTreeArea && treeView !== 'projects') {
    items.push(
      await MenuItem.new({
        text: 'Expand all folders',
        action: () => {
          window.dispatchEvent(
            new CustomEvent('filetree:folders-visibility', {
              detail: { action: 'expand-all' },
            })
          )
        },
      }),
      await MenuItem.new({
        text: 'Collapse all folders',
        action: () => {
          window.dispatchEvent(
            new CustomEvent('filetree:folders-visibility', {
              detail: { action: 'collapse-all' },
            })
          )
        },
      }),
      await PredefinedMenuItem.new({ item: 'Separator' })
    )
  }

  return false
}
