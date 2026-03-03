import { useCallback } from 'react'
import { renameEntry, deleteEntry, deleteProject } from '../FileSystem'
import { confirm } from '@tauri-apps/plugin-dialog'

const updateOrder = (projectName, updater) => {
  const key = `inkblot-order:${projectName}`
  const current = JSON.parse(localStorage.getItem(key) || '{}')
  const next = updater({ ...current })
  localStorage.setItem(key, JSON.stringify(next))
}

const remapOrderForFolder = (orderState, fromPath, toPath) => {
  const next = {}
  Object.entries(orderState).forEach(([key, list]) => {
    const newKey = key === fromPath || key.startsWith(`${fromPath}/`)
      ? key.replace(fromPath, toPath)
      : key

    const newList = list.map(id => {
      if (id.startsWith(`file:${fromPath}/`) || id === `file:${fromPath}`) {
        return id.replace(`file:${fromPath}`, `file:${toPath}`)
      }
      if (id.startsWith(`folder:${fromPath}/`) || id === `folder:${fromPath}`) {
        return id.replace(`folder:${fromPath}`, `folder:${toPath}`)
      }
      return id
    })

    next[newKey] = newList
  })
  return next
}

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
  setSidebarTab,
  setSplitView,
  setSecondaryDoc,
  setCurrentDoc,
  splitView,
  currentDoc,
  secondaryDoc,
  activeDoc,
  projectName,
  refreshFiles,
  onSelectDoc,
  setBubbleSentence,
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

      const { Menu, MenuItem, PredefinedMenuItem } = await import('@tauri-apps/api/menu')
      const items = []

      /* ---------- 1️⃣ FILE-TREE CONTEXT ---------- */
      const fileTree = e.target.closest('.file-tree')
      const leftSidebar = e.target.closest('.left-sidebar')
      const fileTreeEl = fileTree || leftSidebar?.querySelector('.file-tree')
      const treeView = fileTreeEl?.getAttribute('data-view')
      const fileItem = e.target.closest('.file-item')
      const projectItem = e.target.closest('.file-item.project')

      if (projectItem && treeView === 'projects') {
        const projectNameToDelete = projectItem.getAttribute('data-project-name')
        if (projectNameToDelete) {
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

        if (isFile) {
          items.push(
            await MenuItem.new({
              text: 'Open in Split View',
              action: () => {
                setSplitView('editor')
                setSecondaryDoc(entryPath)
              },
            })
          )
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
        }

        items.push(
          await MenuItem.new({
            text: isFolder ? 'Rename Folder' : 'Rename File',
            action: async () => {
              // Trigger inline rename in FileTree
              window.dispatchEvent(
                new CustomEvent('filetree:new-entry', {
                  detail: {
                    rename: true,
                    path: entryPath,
                    type: entryType,
                    name: entryName,
                    parent: entryParent || ''
                  }
                })
              )
            },
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
      const isFileTreeArea = e.target.closest('.file-tree') || e.target.closest('.left-sidebar')
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
      }

      /* ---------- 3️⃣ EDITOR CONTEXT ---------- */
      if (!fileItem && editor) {
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

          // ---- Existing text actions ----
          items.push(
            await MenuItem.new({
              text: 'Analyze POS',
              action: () =>
                setTiles((p) => [
                  {
                    id: Date.now(),
                    type: 'pos',
                    text,
                    from,
                    to,
                    anchor: text,
                    doc: activeDoc || currentDoc,
                  },
                  ...p,
                ]),
            })
          )

          if (text.split(/\s+/).length === 1) {
            items.push(
              await MenuItem.new({
                text: 'Define Word',
                action: () =>
                  setTiles((p) => [
                    {
                      id: Date.now(),
                      type: 'definition',
                      text,
                      from,
                      to,
                      anchor: text,
                      doc: activeDoc || currentDoc,
                    },
                    ...p,
                  ]),
              })
            )
          }

          if (text.split(/\s+/).length <= 2) {
            items.push(
              await MenuItem.new({
                text: 'Find Synonyms',
                action: () =>
                  setTiles((p) => [
                    {
                      id: Date.now(),
                      type: 'synonym',
                      text,
                      from,
                      to,
                      anchor: text,
                      doc: activeDoc || currentDoc,
                    },
                    ...p,
                  ]),
              })
            )
          }

          if (text.split(/\s+/).length === 1) {
            items.push(
              await MenuItem.new({
                text: 'Find Rhymes',
                action: () =>
                  setTiles((p) => [
                    {
                      id: Date.now(),
                      type: 'rhyme',
                      text,
                      from,
                      to,
                      anchor: text,
                      doc: activeDoc || currentDoc,
                    },
                    ...p,
                  ]),
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
                  {
                    id: crypto.randomUUID(),
                    type: 'quote',
                    from,
                    to,
                    anchor: editor.state.doc.textBetween(from, to),
                    content: '',
                    timestamp: new Date().toLocaleTimeString(),
                  },
                  ...p,
                ])

                setSidebarTab('notes')
              },
            })
          )


          items.push(
            await MenuItem.new({
              text: 'Search Pinterest',
              action: async () => {
                try {
                  const mod = await import('../openPinterest')
                  if (mod && typeof mod.openPinterest === 'function') {
                    mod.openPinterest(text)
                  }
                } catch (err) {
                  console.warn('Failed to open Pinterest window:', err)
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
      setSidebarTab,
      setSplitView,
      setSecondaryDoc,
      setCurrentDoc,
      splitView,
      currentDoc,
      secondaryDoc,
      activeDoc,
      projectName,
      refreshFiles,
      onSelectDoc,
      setBubbleSentence,
    ]
  )
}