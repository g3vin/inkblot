import { useCallback } from 'react'
import { renameFile, deleteFile, saveDocument } from '../FileSystem'

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
  splitView,
  projectName,
  refreshFiles,
  onSelectDoc,
}) {
  return useCallback(
    async (e) => {
      e.preventDefault()

      const { Menu, MenuItem, PredefinedMenuItem } = await import('@tauri-apps/api/menu')
      const items = []

      /* ---------- 1️⃣ FILE-TREE CONTEXT ---------- */
      const fileItem = e.target.closest('.file-item')
      if (fileItem) {
        const fileName = fileItem.getAttribute('data-filename')

        items.push(
          await MenuItem.new({
            text: 'Open in Split View',
            action: () => {
              setSplitView(true)
              setSecondaryDoc(fileName)
            },
          })
        )

        items.push(
          await MenuItem.new({
            text: 'Rename File',
            action: async () => {
              const newName = prompt(`Rename "${fileName}" to:`)
              if (newName && newName.trim()) {
                await renameFile(projectName, fileName, newName)
                await refreshFiles()
                onSelectDoc(newName)
              }
            },
          })
        )

        items.push(
          await MenuItem.new({
            text: 'Delete File',
            action: async () => {
              const confirm = window.confirm(`Delete "${fileName}"?`)
              if (confirm) {
                await deleteFile(projectName, fileName)
                await refreshFiles()
              }
            },
          })
        )

        items.push(await PredefinedMenuItem.new({ item: 'Separator' }))
      }

      /* ---------- 2️⃣ FILE TREE EMPTY SPACE ---------- */
      const isFileTreeArea = e.target.closest('.file-tree')
      if (isFileTreeArea && !fileItem) {
        items.push(
          await MenuItem.new({
            text: 'New File',
            action: async () => {
              const newName = prompt('New file name:')
              if (newName && newName.trim()) {
                await saveDocument(projectName, newName, { type: 'doc', content: [] })
                await refreshFiles()
                onSelectDoc(newName)
              }
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

          // ---- Existing text actions ----
          items.push(
            await MenuItem.new({
              text: 'Analyze POS',
              action: () =>
                setTiles((p) => [{ id: Date.now(), type: 'pos', text }, ...p]),
            })
          )

          if (text.split(/\s+/).length === 1) {
            items.push(
              await MenuItem.new({
                text: 'Define Word',
                action: () =>
                  setTiles((p) => [
                    { id: Date.now(), type: 'definition', text },
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
                    { id: Date.now(), type: 'synonym', text },
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
                    { id: Date.now(), type: 'rhyme', text },
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
        items.push(
          await PredefinedMenuItem.new({ item: 'Separator' }),
          await MenuItem.new({
            text: 'Close Split Screen',
            action: () => setSplitView(null),
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
      splitView,
      projectName,
      refreshFiles,
      onSelectDoc,
    ]
  )
}