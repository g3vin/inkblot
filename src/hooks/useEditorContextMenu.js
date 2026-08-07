/**
 * useEditorContextMenu.js — builds the native (Tauri) right-click menu.
 *
 * One handler serves the whole workspace; the items offered depend on where
 * the click landed: a tab in the dock (open, split, close), project entries and
 * files/folders in the file tree (open in new tab/split, rename/delete/new),
 * file-tree empty space (new file/folder/story presets), a canvas surface (add
 * card, group, delete, zoom to fit), and the editor (Focus Mode, highlight,
 * analytic bubble, workbench tiles, notes, Pinterest/web search), plus common
 * copy/paste and split-view document management.
 */
import { useCallback } from 'react'
import {
  deleteEntry,
  deleteProject,
  duplicateEntry,
  getEntryFilePath,
  getProjectRoot,
  listProjectTree,
  moveEntry,
  moveProject,
} from '../lib/FileSystem'
import { confirm } from '@tauri-apps/plugin-dialog'
import { createQuoteNote } from '../lib/noteUtils'
import { getDocDisplayName } from '../lib/docKind'
import { openDocumentWindow } from '../lib/docWindow'
import { STORY_FOLDER_PRESETS } from '../lib/storyStructure'
import { dispatchCanvasCommand } from '../canvas/canvasEvents'

/* ------------------------------------------------------------
   Helper: Remove highlight only within selection (native behavior)
------------------------------------------------------------ */
function removePartialHighlight(editor) {
  editor.chain().focus().unsetHighlight().run()
}

/* ------------------------------------------------------------
   Helper: Detect if selection touches any highlight mark
------------------------------------------------------------ */
function selectionTouchesHighlight(editor) {
  const { state } = editor
  const { doc, selection } = state
  const { from, to } = selection
  const highlightMark = state.schema.marks.highlight
  if (!highlightMark) return false

  let found = false
  doc.nodesBetween(from, to, (node) => {
    if (node.marks?.some((m) => m.type === highlightMark)) {
      found = true
      return false // stop scanning
    }
  })
  return found
}

/* ------------------------------------------------------------
   Main Hook: Context Menu
------------------------------------------------------------ */
export function useEditorContextMenu({
  editor,
  setTiles,
  setNotes,
  openRightSidebarTab,
  setSplitView,
  setSecondaryDoc,
  setCurrentDoc,
  splitView,
  currentDoc,
  secondaryDoc,
  activeDoc,
  projectName,
  refreshFiles,
  setBubbleSentence,
  onEnterFocusMode,
  onOpenDocInTab,
  onOpenDocInSplit,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToTheRight,
  onCloseAllTabs,
  onCloseSplit,
  onKeepTab,
  onSelectTab,
}) {
  return useCallback(
    async (e) => {
      e.preventDefault()

      const confirmDelete = async (message) => {
        try {
          return await confirm(message)
        } catch {
          return false
        }
      }

      const { Menu, MenuItem, PredefinedMenuItem, Submenu } = await import('@tauri-apps/api/menu')
      const items = []

      /* ---------- shared document actions ---------- */

      const copyText = async (text) => {
        if (!text) return
        try {
          await navigator.clipboard.writeText(text)
        } catch (err) {
          console.warn('Failed to copy to clipboard:', err)
        }
      }

      const revealEntry = async (entryPath, type = 'file') => {
        try {
          const absolute = await getEntryFilePath(projectName, entryPath, type)
          const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
          await revealItemInDir(absolute)
        } catch (err) {
          console.warn('Failed to reveal entry:', err)
        }
      }

      const beginRename = (entryPath, entryType, entryName, entryParent) => {
        // FileTree owns renaming — it renames in place, in the tree.
        window.dispatchEvent(
          new CustomEvent('filetree:new-entry', {
            detail: {
              rename: true,
              path: entryPath,
              type: entryType,
              name: entryName,
              parent: entryParent || '',
            },
          })
        )
      }

      const buildCopyPathSubmenu = async (docPath) => Submenu.new({
        text: 'Copy Path',
        items: [
          await MenuItem.new({
            text: 'Copy Name',
            action: () => copyText(getDocDisplayName(docPath)),
          }),
          await MenuItem.new({
            text: 'Copy Project Path',
            action: () => copyText(docPath),
          }),
          await MenuItem.new({
            text: 'Copy Absolute Path',
            action: async () => copyText(await getEntryFilePath(projectName, docPath, 'file')),
          }),
        ],
      })

      /** "Move File to…" lists the project's folders — the destinations that exist. */
      const buildMoveToSubmenu = async (docPath) => {
        const currentParent = docPath.split('/').slice(0, -1).join('/')

        const folders = []
        const walk = (node) => {
          if (!node) return
          if (node.type === 'folder') {
            folders.push(node.path || '')
            ;(node.children || []).forEach(walk)
          }
        }

        try {
          walk(await listProjectTree(projectName))
        } catch (err) {
          console.warn('Failed to list folders for move:', err)
        }

        const destinations = folders.filter(folderPath => folderPath !== currentParent)

        const moveItems = destinations.length
          ? await Promise.all(destinations.map(folderPath => MenuItem.new({
            text: folderPath || 'Project Root',
            action: async () => {
              await moveEntry(projectName, docPath, folderPath, 'file')
              await refreshFiles?.()
            },
          })))
          : [await MenuItem.new({ text: 'No other folders', enabled: false })]

        return Submenu.new({ text: 'Move File to…', items: moveItems })
      }

      /* ---------- 0️⃣ TAB DOCK CONTEXT ---------- */
      // Returns on its own: a dot is a document, not a place in the document, so
      // none of the text/canvas actions below have anything to act on.
      const tabDot = e.target.closest('.tab-dot')
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
        return
      }

      /* ---------- 1️⃣ FILE-TREE CONTEXT ---------- */
      const fileTree = e.target.closest('.file-tree')
      const leftSidebar = e.target.closest('.left-sidebar')
      const fileTreeEl = fileTree || leftSidebar?.querySelector('.file-tree')
      const treeView = fileTreeEl?.getAttribute('data-view')
      const fileItem = e.target.closest('.file-item')
      const projectItem = e.target.closest('.file-item.project')
      const isFileTreeArea = fileTree || leftSidebar

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
          return
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

      /* ---------- 2️⃣ FILE TREE EMPTY SPACE ---------- */
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

      /* ---------- 3️⃣ CANVAS CONTEXT ---------- */
      // Must come before the editor branch and return on its own: a canvas pane has
      // no live editor (the TipTap instances sit idle), so the branch below would
      // either skip it entirely or offer text commands that have nothing to act on.
      const canvasSurface = !fileItem && e.target.closest('.canvas-surface')
      if (canvasSurface) {
        const onNode = !!e.target.closest('.canvas-node')
        const run = (command) =>
          dispatchCanvasCommand(canvasSurface, command, {
            clientX: e.clientX,
            clientY: e.clientY,
          })

        items.push(
          await MenuItem.new({ text: 'Add Card', action: () => run('add-card') }),
          await MenuItem.new({ text: 'Add Image…', action: () => run('add-image') }),
          await MenuItem.new({ text: 'Record Voice Memo', action: () => run('record-memo') }),
          await MenuItem.new({ text: 'Group Selection', action: () => run('group') }),
          await MenuItem.new({ text: 'Ungroup', action: () => run('ungroup') })
        )

        if (onNode) {
          items.push(
            await PredefinedMenuItem.new({ item: 'Separator' }),
            await MenuItem.new({ text: 'Delete', action: () => run('delete') })
          )
        }

        items.push(
          await PredefinedMenuItem.new({ item: 'Separator' }),
          await MenuItem.new({ text: 'Zoom to Fit', action: () => run('zoom-to-fit') }),
          await MenuItem.new({ text: 'Toggle Read Mode', action: () => run('toggle-lock') })
        )

        const canvasMenu = await Menu.new({ items })
        await canvasMenu.popup()
        return
      }

      /* ---------- 4️⃣ EDITOR CONTEXT ---------- */
      if (!fileItem && editor) {
        const isEditorArea = e.target.closest('.editor, .pane')
        if (isEditorArea) {
          items.push(
            await MenuItem.new({
              text: 'Focus Mode',
              action: () => {
                onEnterFocusMode?.()
              },
            }),
            await PredefinedMenuItem.new({ item: 'Separator' })
          )
        }

        const { from, to } = editor.state.selection
        const text = editor.state.doc.textBetween(from, to, ' ')
        if (text.trim()) {
          const touchesHighlight = selectionTouchesHighlight(editor)

          // Highlight action
          items.push(
            await MenuItem.new({
              text: 'Highlight',
              action: () => {
                try {
                  const highlightColor =
                    editor.storage.lastHighlightColor || '#ffff00'
                  editor.chain().focus().setHighlight({ color: highlightColor }).run()
                } catch (err) {
                  console.warn('Failed to apply highlight:', err)
                }
              },
            })
          )

          // Remove Highlight (show even if selection only overlaps)
          if (touchesHighlight) {
            items.push(
              await MenuItem.new({
                text: 'Remove Highlight',
                action: () => {
                  removePartialHighlight(editor)
                },
              })
            )
          }

          items.push(await PredefinedMenuItem.new({ item: 'Separator' }))

          // Open Analytic Bubble (modal)
          items.push(
            await MenuItem.new({
              text: 'Open Analytic Bubble',
              action: () => {
                try {
                  setBubbleSentence?.(text)
                } catch (err) {
                  console.warn('Failed to open analytic bubble:', err)
                }
              },
            })
          )

          const addWorkbenchTile = (type) => {
            setTiles((p) => [
              {
                id: Date.now(),
                type,
                text,
                from,
                to,
                anchor: text,
                doc: activeDoc || currentDoc,
              },
              ...p,
            ])
            openRightSidebarTab?.('workbench')
          }

          // ---- Existing text actions ----
          items.push(
            await MenuItem.new({
              text: 'Analyze POS',
              action: () => addWorkbenchTile('pos'),
            })
          )

          if (text.split(/\s+/).length === 1) {
            items.push(
              await MenuItem.new({
                text: 'Define Word',
                action: () => addWorkbenchTile('definition'),
              })
            )
          }

          if (text.split(/\s+/).length <= 2) {
            items.push(
              await MenuItem.new({
                text: 'Find Synonyms',
                action: () => addWorkbenchTile('synonym'),
              })
            )
          }

          if (text.split(/\s+/).length === 1) {
            items.push(
              await MenuItem.new({
                text: 'Find Rhymes',
                action: () => addWorkbenchTile('rhyme'),
              })
            )
          }

          items.push(await PredefinedMenuItem.new({ item: 'Separator' }))

          items.push(
            await MenuItem.new({
              text: 'Add to Notes',
              action: () => {
                const { from, to } = editor.state.selection

                setNotes(p => [
                  createQuoteNote({
                    from,
                    to,
                    anchor: editor.state.doc.textBetween(from, to),
                  }),
                  ...p,
                ])

                openRightSidebarTab?.('notes')
              },
            })
          )


          items.push(
            await MenuItem.new({
              text: 'Search Pinterest',
              action: async () => {
                try {
                  const mod = await import('../lib/openPinterest')
                  if (mod && typeof mod.openPinterest === 'function') {
                    mod.openPinterest(text)
                  }
                } catch (err) {
                  console.warn('Failed to open Pinterest window:', err)
                }
              },
            })
          )

          items.push(
            await MenuItem.new({
              text: 'Search Web',
              action: async () => {
                const query = String(text || '').trim()
                if (!query) return

                const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`

                try {
                  const { openUrl } = await import('@tauri-apps/plugin-opener')
                  await openUrl(url)
                } catch (err) {
                  console.warn('Failed to open browser search:', err)
                }
              },
            })
          )

          items.push(await PredefinedMenuItem.new({ item: 'Separator' }))
        }
      }

      /* ---------- 4️⃣ COMMON ACTIONS ---------- */
      items.push(
        await PredefinedMenuItem.new({ item: 'Copy' }),
        await PredefinedMenuItem.new({ item: 'Paste' })
      )

      if (splitView) {
        const inPrimaryPane = !!e.target.closest('.primary-pane')
        const inSecondaryPane = !!e.target.closest('.secondary-pane')

        let docToClose = null
        if (fileItem) {
          docToClose = fileItem.getAttribute('data-filename')
        } else if (inSecondaryPane) {
          docToClose = secondaryDoc
        } else if (inPrimaryPane) {
          docToClose = currentDoc
        }

        items.push(
          await PredefinedMenuItem.new({ item: 'Separator' }),
          await MenuItem.new({
            text: 'Close Document',
            action: () => {
              if (docToClose && docToClose === secondaryDoc) {
                setSecondaryDoc?.(null)
                setSplitView?.(null)
                return
              }

              if (docToClose && docToClose === currentDoc) {
                if (secondaryDoc) {
                  setCurrentDoc?.(secondaryDoc)
                }
                setSecondaryDoc?.(null)
                setSplitView?.(null)
              }
            },
          })
        )
      }

      const menu = await Menu.new({ items })
      await menu.popup()
    },
    [
      editor,
      setTiles,
      setNotes,
      openRightSidebarTab,
      setSplitView,
      setSecondaryDoc,
      setCurrentDoc,
      splitView,
      currentDoc,
      secondaryDoc,
      activeDoc,
      projectName,
      refreshFiles,
      setBubbleSentence,
      onEnterFocusMode,
      onOpenDocInTab,
      onOpenDocInSplit,
      onCloseTab,
      onCloseOtherTabs,
      onCloseTabsToTheRight,
      onCloseAllTabs,
      onCloseSplit,
      onKeepTab,
      onSelectTab,
    ]
  )
}
