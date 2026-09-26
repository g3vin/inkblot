/**
 * useEditorContextMenu.js — builds the native (Tauri) right-click menu.
 *
 * One handler serves the whole workspace; the items offered depend on where the
 * click landed. This file is only the dispatch: each surface lives in its own
 * module under ./contextMenu.
 *
 * Order is behaviour, not style. File rows, canvases and maps each pop their
 * own menu and stop; everything else accumulates into one shared item list that is
 * popped at the end, so the editor actions and the common copy/paste land in the
 * same menu.
 */
import { useCallback } from 'react'
import { createMenuContext } from './contextMenu/menuContext'
import { fileTreeMenu } from './contextMenu/fileTreeMenu'
import { canvasMenu } from './contextMenu/canvasMenu'
import { mapMenu } from './contextMenu/mapMenu'
import { editorMenu } from './contextMenu/editorMenu'
import { timelineMenu } from './contextMenu/timelineMenu'
import { commonMenu } from './contextMenu/commonMenu'

export function useEditorContextMenu(props) {
  const {
    editor, setTiles, setNotes, openRightSidebarTab, setSplitView, setSecondaryDoc,
    setCurrentDoc, splitView, currentDoc, secondaryDoc, activeDoc, projectName,
    refreshFiles, bubbles, onEnterFocusMode, onOpenDocInTab,
    onOpenDocInSplit, onCloseSplit,
  } = props

  return useCallback(
    async (e) => {
      e.preventDefault()

      const ctx = await createMenuContext(e, {
        editor, setTiles, setNotes, openRightSidebarTab, setSplitView, setSecondaryDoc,
        setCurrentDoc, splitView, currentDoc, secondaryDoc, activeDoc, projectName,
        refreshFiles, bubbles, onEnterFocusMode, onOpenDocInTab,
        onOpenDocInSplit, onCloseSplit,
      })

      // Each of these pops its own menu and returns true when it owns the click.
      if (await fileTreeMenu(ctx)) return
      if (await canvasMenu(ctx)) return
      if (await mapMenu(ctx)) return

      await editorMenu(ctx)
      await timelineMenu(ctx)
      await commonMenu(ctx)

      const menu = await ctx.Menu.new({ items: ctx.items })
      await menu.popup()
    },
    [
      editor, setTiles, setNotes, openRightSidebarTab, setSplitView, setSecondaryDoc,
      setCurrentDoc, splitView, currentDoc, secondaryDoc, activeDoc, projectName,
      refreshFiles, bubbles, onEnterFocusMode, onOpenDocInTab,
      onOpenDocInSplit, onCloseSplit,
    ]
  )
}
