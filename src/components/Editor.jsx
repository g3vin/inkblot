/**
 * Editor.jsx — top-level editor state container.
 *
 * Owns everything scoped to the open project: which documents are open
 * (primary/secondary/split view), per-document notes, workbench tiles,
 * clipboard history (fed by the window listeners in useEditorClipboardEvents),
 * version lists, and the right-sidebar tab. Persists
 * per-project session state through lib/preferences.ts and restores it on launch.
 *
 * Renders the ProjectLanding screen when no project is open, otherwise
 * hands all state down to EditorLayout.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import EditorLayout from './EditorLayout'
import { loadDocument, listProjects, documentExists } from '../lib/FileSystem'
import { PROJECT_FILES_CHANGED } from '../lib/projectFiles'
import { readDetachedTarget } from '../lib/docWindow'
import { normalizeNotes } from '../lib/noteUtils'
import { RevealGate } from '../ui/Reveal.jsx'
import { useRevealGateOpen } from '../ui/revealState.js'
import { REVEAL } from '../ui/motion.js'

import './Editor.css'

import ProjectLanding from './ProjectLanding'
import SheetFlight from './landing/SheetFlight'
import { observeExcerptPaths } from '../lib/docExcerpts'
import { remapRecents } from '../lib/recentDocs'
import { cancelSummaryRefresh, scheduleSummaryRefresh } from '../lib/projectSummaries'
import { PROJECT_DELETED, PROJECT_RENAMED } from '../lib/projectLifecycle'
import { useTabs } from '../hooks/useTabs'
import { useTabsPublisher } from '../hooks/useTabsPublisher'
import { useEntryOperations } from '../hooks/useEntryOperations'
import { useClipboardHistory } from '../hooks/useClipboardHistory'
import {
  CLIPBOARD_PERSIST_KEY,
  PERSIST_KEY,
  loadClipboardHistory,
  loadSession,
  normalizeProjectSession,
  openAloneIn,
} from '../lib/editorSession'
import { setPreference, setSessionValue } from '../lib/preferences'
import { setOpenProject, clearOpenProject } from '../lib/projectContext'
import { documentSurface } from '../bridge'
import { getProjectRoot } from '../lib/projectPaths'
import { useCommands } from '../lib/commands'
import { useWindowPop } from '../hooks/useWindowPop'
import DetachedWindowBar from './DetachedWindowBar'
import { CLOSE_PROJECT, FILETREE_SHOW_PROJECTS, PROJECT_OPENED } from '../lib/appEvents'
import { useClipboardDropBridge, useCopyToHistory, usePlainPasteShortcut, useSelectionDragTracking } from '../hooks/useEditorClipboardEvents'

/**
 * What opening a project waits for before any of it is shown (ui/Reveal.jsx): the file
 * tree, both panes' documents, the project's locks (so a lock badge arrives with its
 * document), and the check that the restored tabs still exist, so a tab never
 * vanishes after it is drawn.
 */
const REVEAL_PIECES = ['tree', 'primary', 'secondary', 'locks', 'session']
/** Opened from a sheet on the landing page, it also waits for the sheet to land (SheetFlight). */
const REVEAL_PIECES_ARRIVING = [...REVEAL_PIECES, 'arrival']
const SESSION_CHECKED = ['session']
const SESSION_AND_ARRIVAL = ['session', 'arrival']
const ARRIVAL_ONLY = ['arrival']
const NOTHING_CHECKED = []

/** Tells Editor when the RevealGate it is inside opens, for the flight waiting on it. */
function ReportGateOpen({ onOpen }) {
  const open = useRevealGateOpen()
  useEffect(() => { if (open) onOpen() }, [onOpen, open])
  return null
}

export default function Editor({
  projectName: initialProject = 'DefaultProject',
  showWordCountBadge = true,
}) {
  // Set in a window opened by "Open in New Window": that window boots straight
  // into one document and never writes the session back (see docWindow.js).
  const [detachedTarget] = useState(() => readDetachedTarget())
  const [initialSession] = useState(() => loadSession(initialProject))
  const [projectSessions, setProjectSessions] = useState(initialSession.projects || {})
  const [projectName, setProjectNameState] = useState('')
  const [editor, setEditor] = useState(null)
  const [secondaryEditor, setSecondaryEditor] = useState(null)
  const [activeEditor, setActiveEditor] = useState(null)

  const [currentDoc, setCurrentDoc] = useState('')
  const [sidebarTab, setSidebarTab] = useState('workbench')
  const [tiles, setTiles] = useState([])
  const [notesByDoc, setNotesByDoc] = useState({})
  const [clipboardHistory, setClipboardHistory] = useState(() => loadClipboardHistory())
  const [activeDoc, setActiveDoc] = useState('')
  const [versions, setVersionsState] = useState({})
  const setVersions = useCallback((docName, vs) => {
    if (!docName) return
    setVersionsState(prev => ({ ...prev, [docName]: vs || [] }))
  }, [])

  // The version comparison showing in the editor area: { docName, leftId, rightId }.
  // Deliberately NOT part of splitView — compare borrows the editor's space without
  // disturbing the panes underneath, so a split stays intact while you read a diff.
  const [compare, setCompare] = useState(null)
  const openCompare = useCallback((docName, leftId, rightId = 'current') => {
    if (!docName) return
    setCompare({ docName, leftId: String(leftId), rightId: String(rightId) })
  }, [])
  const closeCompare = useCallback(() => setCompare(null), [])

  const [splitView, setSplitView] = useState(null) // null, 'editor', or 'pinterest'
  const [splitOrientation, setSplitOrientation] = useState('columns') // 'columns' (side by side) | 'rows' (stacked)
  const [splitRatio, setSplitRatioState] = useState(0.5) // share of the split taken by the primary pane
  const [secondaryDoc, setSecondaryDoc] = useState(null) // The name of the second file
  // The splits kept in the file tree (editorSession's SavedSplit), and the one showing.
  const [splits, setSplits] = useState([])
  const [activeSplitId, setActiveSplitId] = useState(null)
  // Open tabs. A tab is { id, docPath }, where docPath: null is a draft —
  // a tab that has not decided what document it is yet (see DraftTabPane).
  const [tabs, setTabs] = useState([])
  const [activeTabId, setActiveTabId] = useState(null)
  // A sheet from the landing page on its way to becoming the document card: its box,
  // turn and words, the project and document it opens, whether it has landed, and
  // whether the document under it is ready (SheetFlight).
  const [arrival, setArrival] = useState(null)
  const refreshFilesRef = useRef(null)
  const draggedSelectionRef = useRef(null)
  // A document written outside the tree (lib/projectFiles.js) appears in it.
  useEffect(() => {
    const refresh = () => void refreshFilesRef.current?.()
    window.addEventListener(PROJECT_FILES_CHANGED, refresh)
    return () => window.removeEventListener(PROJECT_FILES_CHANGED, refresh)
  }, [])

  // Switch to a project (or back to the landing page when passed a falsy name),
  // restoring that project's persisted docs/tiles/sidebar state. `docPath` opens it at
  // that document instead (a sheet chosen from its pile), as the file tree would.
  const openProject = useCallback((nextProjectName, { docPath = '' } = {}) => {
    if (!nextProjectName) {
      setProjectNameState('')
      setCurrentDoc('')
      setActiveDoc('')
      setSecondaryDoc(null)
      setCompare(null)
      setSplitView(null)
      setSplitOrientation('columns')
      setSplitRatioState(0.5)
      setTabs([])
      setActiveTabId(null)
      setSplits([])
      setActiveSplitId(null)
      setSidebarTab('workbench')
      setTiles([])
      setNotesByDoc({})
      setVersionsState({})
      setArrival(null)
      // Nothing is open, so nothing should still answer for "the current project";
      // otherwise a Pinterest board mounting on the landing screen would keep the
      // last project's cache key.
      clearOpenProject()
      return
    }

    // The project's own loads come before the landing page's counting.
    cancelSummaryRefresh()
    const projectOpenId = `${nextProjectName}:${Date.now()}:${Math.random().toString(16).slice(2)}`
    try {
      // Ambient rather than React state: the Pinterest node views that read it have
      // no React path to reach. See lib/projectContext.
      setOpenProject(projectOpenId)
      setSessionValue('inkblot:project-open-id', projectOpenId)
      window.dispatchEvent(new CustomEvent(PROJECT_OPENED, {
        detail: { projectName: nextProjectName, projectOpenId },
      }))
    } catch {
      // Session markers are best-effort; project opening should never depend on them.
    }

    const saved = normalizeProjectSession(projectSessions[nextProjectName] || {})
    const workspace = {
      tabs: saved.docTabs,
      activeTabId: saved.activeTabId,
      currentDoc: saved.currentDoc,
      secondaryDoc: saved.secondaryDoc,
      activeDoc: saved.activeDoc || saved.currentDoc,
      splitView: saved.splitView,
      splitOrientation: saved.splitOrientation,
    }
    const shown = docPath && docPath !== saved.currentDoc ? openAloneIn(workspace, docPath) : workspace
    setProjectNameState(nextProjectName)
    setCurrentDoc(shown.currentDoc)
    setActiveDoc(shown.activeDoc || shown.currentDoc)
    setSecondaryDoc(shown.secondaryDoc)
    setSplitView(shown.splitView)
    setSplitOrientation(shown.splitOrientation)
    setSplitRatioState(saved.splitRatio)
    setTabs(shown.tabs)
    setActiveTabId(shown.activeTabId)
    setSplits(saved.splits)
    setActiveSplitId(saved.activeSplitId)
    setSidebarTab(saved.sidebarTab)
    setTiles(saved.tiles)
    setNotesByDoc({})
    setVersionsState({})
  }, [projectSessions])

  const createAndOpenProject = useCallback((nextProjectName) => {
    const now = new Date().toISOString()
    setProjectSessions(prev => ({
      ...prev,
      [nextProjectName]: normalizeProjectSession({
        ...(prev[nextProjectName] || {}),
        updatedAt: now,
      }),
    }))
    openProject(nextProjectName)
  }, [openProject])

  // A comparison borrows the editor area from the document it is about. Once that
  // document is no longer in either pane, the diff on screen describes something
  // you can't see and can no longer merge into — so it closes with it.
  useEffect(() => {
    if (!compare) return
    if (compare.docName !== currentDoc && compare.docName !== secondaryDoc) setCompare(null)
  }, [compare, currentDoc, secondaryDoc])

  const {
    openDocInTab,
    selectTab,
    newDraftTab,
    closeTab,
    setTabOrder,
    adoptDraftDoc,
    openDocInSplit,
    closeSplit,
    placeDocBeside,
    restorePanes,
    openSavedSplit,
    openDocAlone,
    forgetSplit,
    draftTabActive,
    setSplitRatio,
  } = useTabs({
    activeDoc,
    activeTabId,
    currentDoc,
    secondaryDoc,
    splitView,
    splitOrientation,
    setActiveDoc,
    setActiveTabId,
    setCurrentDoc,
    setSecondaryDoc,
    setSplitOrientation,
    setSplitRatioState,
    setSplitView,
    setTabs,
    splitRatio,
    tabs,
    splits,
    setSplits,
    activeSplitId,
    setActiveSplitId,
  })

  // Documents popping out into windows of their own and back (docWindow.js).
  const windowPop = useWindowPop({
    detached: Boolean(detachedTarget),
    projectName,
    currentDoc,
    setCurrentDoc,
    openDocInTab,
    openProject,
  })
  useTabsPublisher({
    projectName,
    tabs,
    activeTabId,
    actions: {
      selectTab,
      closeTab,
      setTabOrder,
      newDraftTab,
      openDocInTab,
      openDocInSplit,
      closeSplit,
    },
  })

  // Rename, move, delete and duplicate — from the tree, a menu, or a command —
  // without the pane's final autosave recreating the old path. See useEntryOperations.
  useEntryOperations({
    projectName,
    currentDoc,
    secondaryDoc,
    setActiveDoc,
    setCurrentDoc,
    setNotesByDoc,
    setSecondaryDoc,
    setSplitView,
    setTabs,
    setVersionsState,
    refreshFilesRef,
    openDocInTab,
  })

  // Bounding rect of the clipboard panel (or its sidebar container) used as the drag-drop target.
  const {
    getClipboardDropZoneRect,
    isPointInAnyEditorPane,
    addClipboardEntry,
    addClipboardImage,
    removeClipboardEntry,
    clearClipboardHistory,
    moveClipboardEntryToEditor,
    handleDropToClipboard,
  } = useClipboardHistory({
    activeDoc,
    currentDoc,
    draggedSelectionRef,
    editor,
    secondaryEditor,
    setClipboardHistory,
  })


  // Tell the shell which project is open. The picker and session restore are still
  // here, and a native sidebar showing a file tree has to be told whose tree it is.
  // The root is resolved here rather than by the shell so a relocated project is
  // answered by the same registry every other read goes through.
  useEffect(() => {
    let cancelled = false
    if (!projectName) {
      documentSurface.publishProjectChanged({})
      return () => { cancelled = true }
    }
    getProjectRoot(projectName)
      .then((projectRoot) => {
        if (!cancelled) documentSurface.publishProjectChanged({ projectName, projectRoot })
      })
      .catch(() => {
        if (!cancelled) documentSurface.publishProjectChanged({ projectName })
      })
    return () => { cancelled = true }
  }, [projectName])

  // The shell's project picker names a project; opening it is still ours to do.
  useEffect(() => documentSurface.onCommand('openProject', ({ projectName: nextProjectName }) => {
    openProject(nextProjectName)
  }), [openProject])

  // Back to the start screen: File ▸ All projects and the palette both land here. A
  // detached window has no start screen to go back to.
  const closeProject = useCallback(() => {
    if (!detachedTarget) openProject('')
  }, [detachedTarget, openProject])
  useEffect(() => {
    window.addEventListener(CLOSE_PROJECT, closeProject)
    return () => window.removeEventListener(CLOSE_PROJECT, closeProject)
  }, [closeProject])
  useCommands(() => (projectName && !detachedTarget ? [
    { id: 'project.close', section: 'App', title: 'Go to all projects', icon: 'grid', keys: 'Mod+Shift+O', keywords: ['close project', 'switch project', 'open project', 'start screen', 'home'], run: closeProject },
  ] : []), [projectName, detachedTarget, closeProject])

  const docRef = useRef(currentDoc)
  useEffect(() => { docRef.current = currentDoc }, [currentDoc])

  // Opening a project from the start screen: the start screen fades out over the
  // editor, which mounts beneath it at once so its loads are already under way. The
  // timer ends it should the fade never report (an animation that did not run).
  const [landingLeaving, setLandingLeaving] = useState(false)
  const [shownProject, setShownProject] = useState(projectName)
  if (shownProject !== projectName) {
    setShownProject(projectName)
    setLandingLeaving(Boolean(!shownProject && projectName && !detachedTarget))
  }
  const endLanding = useCallback(() => setLandingLeaving(false), [])
  useEffect(() => {
    if (!landingLeaving) return undefined
    const timer = window.setTimeout(endLanding, Math.max(1000, REVEAL.arrive + 600))
    return () => window.clearTimeout(timer)
  }, [endLanding, landingLeaving])

  // Validate the restored session against disk: bail out to the landing page if the
  // project vanished, and close docs that no longer exist.
  const [validatedProject, setValidatedProject] = useState('')
  useEffect(() => {
    let cancelled = false

    const validateSession = async () => {
      if (!projectName) return
      const tabDocs = tabs.map(tab => tab.docPath).filter(Boolean)
      // One round of reads rather than one after another: opening the project waits
      // on this answer (the 'session' piece of its RevealGate).
      const [projects, currentExists, secondaryExists, tabExistence] = await Promise.all([
        listProjects(),
        currentDoc ? documentExists(projectName, currentDoc) : true,
        secondaryDoc ? documentExists(projectName, secondaryDoc) : true,
        Promise.all(tabDocs.map(docPath => documentExists(projectName, docPath))),
      ])
      if (cancelled) return

      if (!projects.includes(projectName)) {
        openProject('')
        setCurrentDoc('')
        setActiveDoc('')
        setSecondaryDoc(null)
        setSplitView(null)
        setNotesByDoc({})
        window.dispatchEvent(new CustomEvent(FILETREE_SHOW_PROJECTS))
        return
      }

      if (!currentExists) {
        setCurrentDoc('')
        setActiveDoc('')
        setSecondaryDoc(null)
        setSplitView(null)
      } else if (!secondaryExists) {
        setSecondaryDoc(null)
        setSplitView(null)
      }

      // A tab whose document was deleted (or renamed) elsewhere would open
      // nothing, so it is dropped. Drafts have no document to check.
      const missing = new Set(tabDocs.filter((docPath, index) => !tabExistence[index]))
      if (missing.size) {
        setTabs(prev => prev.filter(tab => !tab.docPath || !missing.has(tab.docPath)))
      }
      setValidatedProject(projectName)
    }

    validateSession()
    return () => {
      cancelled = true
    }
  }, [projectName, currentDoc, secondaryDoc, tabs, openProject])

  // A detached window opens its one document and nothing else — no landing page,
  // no restored tabs.
  useEffect(() => {
    if (!detachedTarget) return
    openProject(detachedTarget.projectName)
    setCurrentDoc(detachedTarget.docPath)
    setActiveDoc(detachedTarget.docPath)
    // Boot-once: re-running this would yank the window back to its opening document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A project renamed or deleted (lib/projectLifecycle.js) takes its session with it.
  // The open project keeps its place under its new name rather than reopening, which
  // would restore it from a session it no longer has.
  const projectNameRef = useRef(projectName)
  useEffect(() => { projectNameRef.current = projectName }, [projectName])
  useEffect(() => {
    const renamed = ({ detail: { from, to } }) => {
      setProjectSessions((prev) => {
        if (!prev[from]) return prev
        const { [from]: session, ...rest } = prev
        return { ...rest, [to]: session }
      })
      if (projectNameRef.current === from) setProjectNameState(to)
    }
    const deleted = ({ detail: { name } }) => {
      setProjectSessions((prev) => {
        if (!prev[name]) return prev
        const { [name]: _dropped, ...rest } = prev
        return rest
      })
      if (projectNameRef.current === name) openProject('')
    }
    window.addEventListener(PROJECT_RENAMED, renamed)
    window.addEventListener(PROJECT_DELETED, deleted)
    return () => {
      window.removeEventListener(PROJECT_RENAMED, renamed)
      window.removeEventListener(PROJECT_DELETED, deleted)
    }
  }, [openProject])

  // Leaving a project, count its files and words again for the landing page.
  const leftProjectRef = useRef(projectName)
  useEffect(() => {
    const left = leftProjectRef.current
    leftProjectRef.current = projectName
    if (left && left !== projectName && !detachedTarget) scheduleSummaryRefresh([left], { staleAfter: 0 })
  }, [detachedTarget, projectName])

  // Excerpts and the recent list follow documents renamed or moved in the tree.
  useEffect(() => observeExcerptPaths(remapRecents), [])

  // Persist the session while on the landing page (covers project deletes/renames).
  useEffect(() => {
    if (detachedTarget) return
    if (projectName) return
    const payload = {
      lastProject: initialSession.lastProject || '',
      projects: projectSessions,
    }
    setPreference(PERSIST_KEY, JSON.stringify(payload))
  }, [detachedTarget, initialSession.lastProject, projectName, projectSessions])

  // Persist the open project's session whenever any of its state changes.
  useEffect(() => {
    if (detachedTarget) return
    if (!projectName) return
    const now = new Date().toISOString()
    const nextProjectSession = normalizeProjectSession({
      currentDoc,
      secondaryDoc,
      splitView,
      splitOrientation,
      splitRatio,
      activeDoc,
      sidebarTab,
      tiles,
      docTabs: tabs,
      activeTabId,
      splits,
      activeSplitId,
      updatedAt: now,
    })

    setProjectSessions(prev => {
      const nextProjectSessions = {
        ...prev,
        [projectName]: nextProjectSession,
      }

      const payload = {
        lastProject: projectName,
        projects: nextProjectSessions,
      }
      setPreference(PERSIST_KEY, JSON.stringify(payload))
      return nextProjectSessions
    })
  }, [detachedTarget, projectName, currentDoc, secondaryDoc, splitView, splitOrientation, splitRatio, activeDoc, sidebarTab, tiles, tabs, activeTabId, splits, activeSplitId])

  useEffect(() => {
    setPreference(CLIPBOARD_PERSIST_KEY, JSON.stringify(clipboardHistory))
  }, [clipboardHistory])

  // Outside of an editor split (or with no secondary doc), the primary doc is always active.
  useEffect(() => {
    if (splitView !== 'editor' || !secondaryDoc) {
      setActiveDoc(currentDoc)
    }
  }, [currentDoc, splitView, secondaryDoc])

  // Notes are stored per document; `notes`/`setNotes` below are views onto the active doc's list.
  const setNotesForDoc = useCallback((docName, updater) => {
    setNotesByDoc(prev => {
      const current = prev[docName] || []
      const next = typeof updater === 'function' ? updater(current) : updater
      return { ...prev, [docName]: normalizeNotes(next) }
    })
  }, [])

  const notes = notesByDoc[activeDoc] || []
  const setNotes = useCallback((updater) => {
    setNotesForDoc(activeDoc, updater)
  }, [activeDoc, setNotesForDoc])

  // The clipboard panel's half of the page: selection drags, copies and ⌘⇧V.
  useClipboardDropBridge(handleDropToClipboard)
  useSelectionDragTracking({ editor, secondaryEditor, currentDoc, secondaryDoc, draggedSelectionRef, getClipboardDropZoneRect, isPointInAnyEditorPane })
  useCopyToHistory({ addClipboardEntry, addClipboardImage })
  usePlainPasteShortcut({ activeEditor, editor, secondaryEditor })

  const documentCardRef = useRef(null)
  // A sheet taking off opens its project only once it is in the air (SheetFlight's
  // onLaunched): mounting the editor would otherwise hold its first frames back.
  const openFromLanding = useCallback((nextProjectName, { docPath, flight } = {}) => {
    if (!flight) {
      setArrival(null)
      openProject(nextProjectName, { docPath })
      return
    }
    setArrival({ key: `${nextProjectName}:${Date.now()}`, ...flight, project: nextProjectName, docPath, landed: false, gateOpen: false })
  }, [openProject])
  const arrivalRef = useRef(arrival)
  useEffect(() => { arrivalRef.current = arrival }, [arrival])
  const launchArrival = useCallback(() => {
    const launched = arrivalRef.current
    if (launched) openProject(launched.project, { docPath: launched.docPath })
  }, [openProject])
  const landArrival = useCallback(() => setArrival((prev) => (prev ? { ...prev, landed: true } : prev)), [])
  const arrivalGateOpened = useCallback(() => setArrival((prev) => (prev && !prev.gateOpen ? { ...prev, gateOpen: true } : prev)), [])
  const endArrival = useCallback(() => setArrival(null), [])
  const flight = arrival ? (
    <SheetFlight
      key={arrival.key}
      arrival={arrival}
      cardRef={documentCardRef}
      gateOpen={arrival.gateOpen}
      onLaunched={launchArrival}
      onLanded={landArrival}
      onDone={endArrival}
    />
  ) : null

  const landing = !projectName || landingLeaving ? (
    <ProjectLanding
      key="landing"
      projectSessions={projectSessions}
      onOpenProject={openFromLanding}
      onCreateProject={createAndOpenProject}
      leaving={Boolean(projectName)}
      flying={Boolean(arrival)}
      onLeft={endLanding}
    />
  ) : null

  // The flight comes first in both, so it is the same element across the hand-over.
  if (!projectName) return <>{flight}{landing}</>

  return (
    <>
    {flight}
    {landing}
    <RevealGate
      keys={arrival ? REVEAL_PIECES_ARRIVING : REVEAL_PIECES}
      resetKey={projectName}
      ready={validatedProject === projectName
        ? (arrival?.landed ? SESSION_AND_ARRIVAL : SESSION_CHECKED)
        : (arrival?.landed ? ARRIVAL_ONLY : NOTHING_CHECKED)}
    >
      {arrival ? <ReportGateOpen onOpen={arrivalGateOpened} /> : null}
      <EditorLayout
        documentCardRef={documentCardRef}
        arriving={arrival ? (arrival.landed ? 'landed' : 'flight') : undefined}
        splitView={splitView}
        setSplitView={setSplitView}
        splitOrientation={splitOrientation}
        splitRatio={splitRatio}
        setSplitRatio={setSplitRatio}

        draftTabActive={draftTabActive}
        onOpenDocInTab={openDocInTab}
        onOpenDocInSplit={openDocInSplit}
        onCloseSplit={closeSplit}
        onPlaceDocBeside={placeDocBeside}
        onRestorePanes={restorePanes}
        splits={splits}
        activeSplitId={activeSplitId}
        onOpenSavedSplit={openSavedSplit}
        onOpenDocAlone={openDocAlone}
        onForgetSplit={forgetSplit}
        onDraftCreated={adoptDraftDoc}

        editor={editor}
        setEditor={setEditor}
        secondaryEditor={secondaryEditor}
        setSecondaryEditor={setSecondaryEditor}
        activeEditor={activeEditor}
        setActiveEditor={setActiveEditor}

        projectName={projectName}
        setProjectName={openProject}
        currentDoc={currentDoc}
        setCurrentDoc={setCurrentDoc}
        secondaryDoc={secondaryDoc}
        setSecondaryDoc={setSecondaryDoc}

        sidebarTab={sidebarTab}
        setSidebarTab={setSidebarTab}

        tiles={tiles}
        setTiles={setTiles}

        notes={notes}
        setNotes={setNotes}
        notesByDoc={notesByDoc}
        setNotesForDoc={setNotesForDoc}
        activeDoc={activeDoc}
        setActiveDoc={setActiveDoc}

        versions={versions}
        setVersions={setVersions}
        compare={compare}
        openCompare={openCompare}
        closeCompare={closeCompare}
        clipboardHistory={clipboardHistory}
        clearClipboardHistory={clearClipboardHistory}
        onDropToClipboard={handleDropToClipboard}
        onMoveClipboardEntryToEditor={moveClipboardEntryToEditor}
        onRemoveClipboardEntry={removeClipboardEntry}
        showWordCountBadge={showWordCountBadge}

        loadDocument={loadDocument}
        refreshFiles={() => refreshFilesRef.current?.()}
        registerRefreshFiles={(fn) => { refreshFilesRef.current = fn }}
      />
      {detachedTarget ? (
        <DetachedWindowBar onTop={windowPop.onTop} onKeepOnTop={windowPop.keepOnTop} onDock={windowPop.dock} />
      ) : null}
    </RevealGate>
    </>
  )
}
