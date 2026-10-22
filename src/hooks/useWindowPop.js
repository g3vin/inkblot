/**
 * useWindowPop — documents moving between the main window and windows of their own
 * (docWindow.js).
 *
 * In the main window it takes a document a detached window gives back and opens it in
 * a tab (switching to its project first, if another is open).
 *
 * In a detached window it is the way back and the window's place: `dock` lets go of
 * the document — so its pending saves are written — waits for them, gives it to the
 * main window and closes; `keepOnTop` keeps the window above the others, for a
 * reference kept in view while writing elsewhere. Both are commands too.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useCommands } from '../lib/commands'
import { withDocLock } from '../lib/docLock'
import { dockToMainWindow, listenForDocking, setKeepOnTop } from '../lib/docWindow'

export function useWindowPop({ detached, projectName, currentDoc, setCurrentDoc, openDocInTab, openProject }) {
  const latest = useRef({ projectName, openDocInTab, openProject })
  useEffect(() => { latest.current = { projectName, openDocInTab, openProject } })

  // The main window: a document given back opens in a tab.
  useEffect(() => {
    if (detached) return undefined
    let unlisten = null
    let live = true
    listenForDocking(({ projectName: from, docPath }) => {
      if (!from || !docPath) return
      const { projectName: open, openDocInTab: openTab, openProject: switchTo } = latest.current
      if (from !== open) {
        switchTo(from)
        // The project's tabs are restored first; the document joins them.
        setTimeout(() => latest.current.openDocInTab(docPath), 0)
      } else {
        openTab(docPath)
      }
    }).then((stop) => {
      if (live) unlisten = stop
      else stop()
    }).catch(() => {})
    return () => {
      live = false
      unlisten?.()
    }
  }, [detached])

  const [onTop, setOnTop] = useState(false)
  const keepOnTop = useCallback((on) => {
    setOnTop(on)
    return setKeepOnTop(on).catch(() => setOnTop(!on))
  }, [])

  const dock = useCallback(async () => {
    if (!detached || !projectName || !currentDoc) return
    const docPath = currentDoc
    // Let go of the document now: the pane's cleanup flushes its autosave…
    flushSync(() => setCurrentDoc(''))
    // …which may still be on its way into the document's write queue.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await withDocLock(projectName, docPath, () => {})
    await dockToMainWindow(projectName, docPath)
  }, [currentDoc, detached, projectName, setCurrentDoc])

  useCommands(() => (detached ? [
    { id: 'window.dock', section: 'Window', title: 'Move back to the main window', icon: 'pop-in', keywords: ['pop in', 'dock', 'tab', 'attach'], run: dock },
    { id: 'window.on-top', section: 'Window', title: onTop ? 'Stop keeping this window on top' : 'Keep this window on top', icon: 'pin', keywords: ['always on top', 'float', 'pin', 'reference'], run: () => keepOnTop(!onTop) },
  ] : []), [detached, dock, keepOnTop, onTop])

  return { onTop, keepOnTop, dock }
}
