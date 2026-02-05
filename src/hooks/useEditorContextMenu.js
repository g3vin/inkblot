import { useCallback } from 'react'
import { emit } from '@tauri-apps/api/event'

export function useEditorContextMenu({
  editor,
  setTiles,
  setNotes,
  setSidebarTab,
  setSplitView,    // New
  setSecondaryDoc, // New
  splitView,
}) {
  return useCallback(
    async e => {
      e.preventDefault()
      
      const { Menu, MenuItem, PredefinedMenuItem } = await import('@tauri-apps/api/menu')
      const items = []

      // --- 1. DETECT FILE TREE CONTEXT ---
      const fileItem = e.target.closest('.file-item')
      if (fileItem) {
        const fileName = fileItem.getAttribute('data-filename')
        


      items.push(
        await MenuItem.new({
          text: 'Search Pinterest',
          action: () => {
            emit('search-pinterest', { text })
          },
        })
      )

        // Add separator if it's the current doc or for visual clarity
        items.push(await PredefinedMenuItem.new({ item: 'Separator' }))
      }

      // --- 2. DETECT EDITOR CONTEXT (Only if we didn't click a file or if editor exists) ---
      if (editor) {
        const { from, to } = editor.state.selection
        const text = editor.state.doc.textBetween(from, to, ' ')

        if (text.trim()) {
          items.push(
            await MenuItem.new({
              text: 'Analyze POS',
              action: () => setTiles(p => [{ id: Date.now(), type: 'pos', text }, ...p]),
            })
          )

          if (text.split(/\s+/).length === 1) {
            items.push(
              await MenuItem.new({
                text: 'Define Word',
                action: () => setTiles(p => [{ id: Date.now(), type: 'definition', text }, ...p]),
              })
            )
          }

          if (text.split(/\s+/).length <= 2) {
            items.push(
              await MenuItem.new({
                text: 'Find Synonyms',
                action: () => setTiles(p => [{ id: Date.now(), type: 'synonym', text }, ...p]),
              })
            )
          }

          items.push(await PredefinedMenuItem.new({ item: 'Separator' }))

          items.push(
            await MenuItem.new({
              text: 'Add to Notes',
              action: () => {
                setNotes(p => [
                  {
                    id: Date.now(),
                    anchor: text,
                    content: '',
                    timestamp: new Date().toLocaleTimeString(),
                  },
                  ...p,
                ])
                setSidebarTab('notes')
              },
            })
          )
          // Search Pinterest for the selected text (opens/focuses Pinterest window)
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

      // --- 3. COMMON ACTIONS ---
      items.push(
        await PredefinedMenuItem.new({ item: 'Copy' }),
        await PredefinedMenuItem.new({ item: 'Paste' })
      )

        if (splitView) {
          items.push(
              await PredefinedMenuItem.new({ item: 'Separator' }),
              await MenuItem.new({
                  text: 'Close Split Screen',
                  action: () => setSplitView(null)
              })
          )
      }

      const menu = await Menu.new({ items })
      await menu.popup()
    },
    [editor, setTiles, setNotes, setSidebarTab, setSplitView, setSecondaryDoc, splitView]
  )
}