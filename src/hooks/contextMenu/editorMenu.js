/**
 * editorMenu.js — right-clicking inside a document.
 *
 * Appends to the shared item list rather than popping, so the common copy/paste
 * and split-view actions land underneath it.
 */
import { createQuoteNote } from '../../lib/noteUtils'

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

export async function editorMenu(ctx) {
  const {
    MenuItem,
    PredefinedMenuItem,
    activeDoc,
    currentDoc,
    e,
    editor,
    fileItem,
    items,
    onEnterFocusMode,
    openRightSidebarTab,
    setBubbleSentence,
    setNotes,
    setTiles,
  } = ctx
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
              const mod = await import('../../lib/openPinterest')
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

  return undefined
}
