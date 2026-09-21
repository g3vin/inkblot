/**
 * fileTreeMenu.js — project rows, files, folders, and empty space in the tree.
 *
 * Only the file branch pops its own menu. The project, folder and empty-space
 * branches append to the shared item list and fall through to the common actions,
 * which is how the original single callback behaved.
 */
import { deleteEntry, deleteProject, duplicateEntry, getProjectRoot, moveProject } from '../../lib/FileSystem'
import { STORY_FOLDER_PRESETS } from '../../lib/storyStructure'
import { openDocumentWindow } from '../../lib/docWindow'

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
          text: 'Rename Project',
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
          text: 'Move Project…',
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
                await message(reason, { title: 'Move Project', kind: 'error' })
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
          text: 'Delete Project',
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
        text: 'New Project',
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

    // A file's menu is the whole story for that document, so it returns on its
    // own rather than trailing the editor's text actions behind it.
    if (isFile) {
      const fileItems = [
        await MenuItem.new({
          text: 'Open in New Tab',
          action: () => onOpenDocInTab?.(entryPath),
        }),
        await MenuItem.new({
          text: 'Open to the Right',
          action: () => onOpenDocInSplit?.(entryPath, 'columns'),
        }),
        await MenuItem.new({
          text: 'Open Below',
          action: () => onOpenDocInSplit?.(entryPath, 'rows'),
        }),
        await MenuItem.new({
          text: 'Open in New Window',
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
        await PredefinedMenuItem.new({ item: 'Separator' }),

        await buildCopyPathSubmenu(entryPath),
        await PredefinedMenuItem.new({ item: 'Separator' }),

        await MenuItem.new({
          text: 'Open Version History',
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
            const ok = await confirmDelete(`Delete "${entryName}"?`)
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
          text: 'New File in Folder',
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
          text: 'New Folder in Folder',
          action: () => {
            window.dispatchEvent(
              new CustomEvent('filetree:new-entry', {
                detail: { type: 'folder', parent: entryPath },
              })
            )
          },
        })
      )

      items.push(
        await MenuItem.new({
          text: 'Reveal in Finder',
          action: () => revealEntry(entryPath, 'folder'),
        })
      )
    }

    items.push(
      await MenuItem.new({
        text: isFolder ? 'Rename Folder' : 'Rename File',
        action: () => beginRename(entryPath, entryType, entryName, entryParent),
      })
    )

    items.push(
      await MenuItem.new({
        text: isFolder ? 'Delete Folder' : 'Delete File',
        action: async () => {
          const ok = await confirmDelete(`Delete "${entryName}"?`)
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
        text: 'New File',
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
        text: 'New Folder',
        action: async () => {
          window.dispatchEvent(
            new CustomEvent('filetree:new-entry', {
              detail: { type: 'folder', parent: '' },
            })
          )
        },
      })
    )

    for (const preset of STORY_FOLDER_PRESETS) {
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
  }

  if (isFileTreeArea && treeView !== 'projects') {
    items.push(
      await MenuItem.new({
        text: 'Expand All Folders',
        action: () => {
          window.dispatchEvent(
            new CustomEvent('filetree:folders-visibility', {
              detail: { action: 'expand-all' },
            })
          )
        },
      }),
      await MenuItem.new({
        text: 'Collapse All Folders',
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
