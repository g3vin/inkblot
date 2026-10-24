/**
 * FileTree.jsx — project/file browser in the left sidebar.
 *
 * Two views: a project list and the open project's file tree. Handles
 * creating/renaming files, folders, story-preset folders, and projects;
 * custom (mouse-driven) drag & drop for reordering and re-parenting entries;
 * and per-project persistence of manual ordering and folder expansion in
 * the preference store. Other parts of the app talk to it through `filetree:*`
 * window events (new-entry, refresh-projects, folders-visibility, …).
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  listProjects,
  createProject,
  listProjectTree,
  createFolder,
} from '../lib/FileSystem'
import { readProjectTree, recallProjects, recallTree, rememberProjects, rememberTree } from '../lib/projectPrefetch'
import { createDocumentOfKind, nameForKind } from '../lib/createDocument'
import { getDocDisplayName, getDocKind, stripDocSuffix } from '../lib/docKind'
import Icon from '../ui/Icon.jsx'
import { IconButton, Inlay, InlaySlot, SkeletonOverlay, SkeletonRows, popUpMenu, useReveal, useRevealReady } from '../ui'
import { useFileTreeDrag } from '../hooks/useFileTreeDrag'
import { deriveFileNodeState, docKindIcon } from '../lib/fileTreeNodeState'
import { EMPTY_FILTER, TREE_KINDS, applyTreeFilter, folderPaths } from '../lib/treeFilter'
import { noteOpened } from '../lib/recentDocs'
import { lockReason, refreshLocks, useLocks } from '../lib/docLocks'
import { openFolderPresets, useFolderPresets } from '../lib/folderPresets'
import { inkColor } from '../lib/palette'
import {
  getStoryFolderAncestor,
  getStoryFolderPresetByKey,
} from '../lib/storyStructure'

const MotionDiv = motion.div

const DRAG_SLOT_HEIGHT = 22
const TREE_ROOT_INDENT = 8
const TREE_DEPTH_INDENT = 10
const FOLDER_STICKY_STEP = 22

import { itemRevealVariants, folderChildrenVariants } from './fileTreeVariants'
import {
  applyOrderToTree,
  collectFolderPaths,
  getParentPath,
  remapExpandedForFolder,
  remapOrderForEntry,
} from '../lib/fileTreeOrder'
import {
  loadExpanded,
  loadOrder,
  migrateProjectTreeState,
  saveExpanded,
  saveOrder,
} from '../lib/fileTreeState'



const NO_SPLITS = []

/** The paths of every document in a tree. */
const filePathsIn = (node, into = new Set()) => {
  if (node.type === 'file') into.add(node.path)
  for (const child of node.children || []) filePathsIn(child, into)
  return into
}

/** Marks a scrolled list, so its stuck folder rows know to cover what passes under them. */
const markScrolled = (event) => {
  event.currentTarget.toggleAttribute('data-scrolled', event.currentTarget.scrollTop > 0)
}

export default function FileTree({
  projectName,
  currentDoc,
  secondaryDoc,
  splitView,
  activeDoc,
  onSelectDoc,
  onSelectProject,
  // The splits kept above the files (editorSession's SavedSplit), the one showing, and
  // what choosing one or its × does.
  splits = NO_SPLITS,
  activeSplitId = null,
  onOpenSplit,
  onForgetSplit,
  registerRefreshFiles,
  // Where the + goes: under the list when not given; into this element
  // when given (the left sidebar keeps them at its foot, still while Files and Book
  // swipe past above); nowhere when null (the book has the foot).
  footerSlot,
}) {
  const prefersReducedMotion = useReducedMotion()
  const locks = useLocks()
  const presets = useFolderPresets()
  const [view, setView] = useState('files')
  const [projects, setProjects] = useState(() => recallProjects()?.names ?? null)
  // A project opened before this session shows the tree it last had at once; the read
  // below then brings it up to date. `treeFor` is whose tree is showing.
  const [tree, setTree] = useState(() => recallTree(projectName) ?? { type: 'folder', name: '', path: '', children: [] })
  const [treeFor, setTreeFor] = useState(() => (recallTree(projectName) ? projectName : ''))
  const [expanded, setExpanded] = useState(new Set(['']))
  // Which kinds of file the tree shows (the + menu's Show). Finding by name is the
  // search's, beside the + at the sidebar's foot.
  const [kind, setKind] = useState('all')
  const filtering = kind !== 'all'
  const [order, setOrder] = useState({})
  const [isAddingEntry, setIsAddingEntry] = useState(false)
  const [newEntryName, setNewEntryName] = useState('')
  const [newEntryType, setNewEntryType] = useState('file')
  const [newEntryParent, setNewEntryParent] = useState('')
  const [renamingEntry, setRenamingEntry] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [isAddingProject, setIsAddingProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectLocation, setNewProjectLocation] = useState(null)
  const [dragOverPath, setDragOverPath] = useState(null)
  const [dragInsert, setDragInsert] = useState(null)
  const [dragOverFolder, setDragOverFolder] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragPreview, setDragPreview] = useState(null)
  const [dragSourceId, setDragSourceId] = useState(null)
  const manualDragRef = useRef(null)
  const manualDragActiveRef = useRef(false)
  const dragInsertRef = useRef(null)
  const dragOverFolderRef = useRef(null)
  // Where the pointer was last seen during a manual drag. `onUp` receives no event,
  // but it has to know whether the drop landed on a canvas — see the guard there.
  const dragPointRef = useRef(null)
  const orderRef = useRef({})
  const expandedRef = useRef(new Set(['']))

  const refreshProjects = useCallback(async () => {
    const list = await listProjects()
    rememberProjects(list)
    setProjects(list)
  }, [])

  const refreshTree = useCallback(async () => {
    if (!projectName) return
    const nextOrder = loadOrder(projectName)
    const rawTree = await readProjectTree(projectName)
    const orderedTree = applyOrderToTree(rawTree, nextOrder)
    saveOrder(projectName, nextOrder)
    orderRef.current = nextOrder
    setOrder(nextOrder)
    setTree(orderedTree)
    setTreeFor(projectName)
    rememberTree(projectName, orderedTree)
    // Whatever changed the tree may have moved, copied or removed something locked.
    void refreshLocks(projectName)
  }, [projectName])

  useEffect(() => {
    refreshProjects()
  }, [refreshProjects])

  useEffect(() => {
    const handler = () => {
      refreshProjects()
    }
    window.addEventListener('filetree:refresh-projects', handler)
    return () => window.removeEventListener('filetree:refresh-projects', handler)
  }, [refreshProjects])

  useEffect(() => {
    refreshTree()
  }, [refreshTree])

  // Switched to a project this session has shown before: its last tree, until the read lands.
  const [recalledFor, setRecalledFor] = useState(projectName)
  if (recalledFor !== projectName) {
    setRecalledFor(projectName)
    const recalled = recallTree(projectName)
    if (recalled) {
      setTree(recalled)
      setTreeFor(projectName)
    }
  }

  const treeReady = Boolean(projectName) && treeFor === projectName
  useRevealReady('tree', treeReady)
  const treeReveal = useReveal(treeReady)
  const projectsReveal = useReveal(projects !== null, { gated: false })

  useEffect(() => {
    if (!projectName) return
    const nextExpanded = new Set(loadExpanded(projectName))
    expandedRef.current = nextExpanded
    setExpanded(nextExpanded)
  }, [projectName])

  useEffect(() => {
    if (!registerRefreshFiles) return
    registerRefreshFiles(refreshTree)
  }, [registerRefreshFiles, refreshTree])

  useEffect(() => {
    const handler = () => {
      setView('projects')
      setIsAddingProject(true)
    }
    window.addEventListener('filetree:new-project', handler)
    return () => window.removeEventListener('filetree:new-project', handler)
  }, [])

  useEffect(() => {
    const handler = () => {
      setView('projects')
    }
    window.addEventListener('filetree:show-projects', handler)
    return () => window.removeEventListener('filetree:show-projects', handler)
  }, [])

  useEffect(() => {
    const nextOrder = loadOrder(projectName)
    orderRef.current = nextOrder
    setOrder(nextOrder)
  }, [projectName])

  const updateOrder = useCallback((updater) => {
    const next = updater({ ...orderRef.current })
    orderRef.current = next
    saveOrder(projectName, next)
    setOrder(next)
  }, [projectName])

  const updateExpanded = useCallback((updater) => {
    const next = updater(new Set(expandedRef.current))
    expandedRef.current = next
    if (projectName) saveExpanded(projectName, Array.from(next))
    setExpanded(next)
  }, [projectName])

  useEffect(() => {
    const handler = (event) => {
      const action = event?.detail?.action
      if (action === 'expand-all') {
        updateExpanded(() => new Set(['', ...collectFolderPaths(tree)]))
      } else if (action === 'collapse-all') {
        updateExpanded(() => new Set(['']))
      }
    }

    window.addEventListener('filetree:folders-visibility', handler)
    return () => window.removeEventListener('filetree:folders-visibility', handler)
  }, [tree, updateExpanded])

  const expandPath = useCallback((path) => {
    if (!path) return
    const parts = path.split('/').filter(Boolean)
    let acc = ''
    updateExpanded(prev => {
      parts.forEach(part => {
        acc = acc ? `${acc}/${part}` : part
        prev.add(acc)
      })
      return prev
    })
  }, [updateExpanded])

  const beginNewEntry = useCallback((type = 'file', parent = '') => {
    setView('files')
    setNewEntryType(type)
    setNewEntryParent(parent)
    setNewEntryName('')
    setIsAddingEntry(true)
    // The name box renders among the folder's children, which only exist while
    // the folder is open.
    if (parent) expandPath(parent)
  }, [expandPath])

  const ensureOrderItem = useCallback((folderKey, itemId) => {
    updateOrder(orderState => {
      const next = orderState[folderKey] || []
      if (next.includes(itemId)) return orderState
      orderState[folderKey] = [...next, itemId]
      return orderState
    })
  }, [updateOrder])

  const createStoryFolder = useCallback(async (presetKey, parent = '') => {
    const preset = getStoryFolderPresetByKey(presetKey, presets)
    if (!preset || !projectName) return

    const path = parent ? `${parent}/${preset.name}` : preset.name
    await createFolder(projectName, path)
    ensureOrderItem(parent || '', `folder:${path}`)
    setIsAddingEntry(false)
    await refreshTree()
    expandPath(path)
  }, [ensureOrderItem, expandPath, presets, projectName, refreshTree])

  // Listen for new entry or rename events
  useEffect(() => {
    const handler = (event) => {
      const detail = event?.detail || {}
      if (detail.rename && detail.type && detail.name !== undefined) {
        setRenamingEntry({
          path: detail.path || detail.name,
          type: detail.type,
          oldName: stripDocSuffix(detail.name),
          parent: detail.parent || '',
        })
        setRenameValue(stripDocSuffix(detail.name))
        setIsAddingEntry(false)
        setIsAddingProject(false)
        return
      }
      if (detail.presetKey) {
        void createStoryFolder(detail.presetKey, detail.parent || '')
        return
      }
      beginNewEntry(detail.type || 'file', detail.parent || '')
    }
    window.addEventListener('filetree:new-entry', handler)
    return () => window.removeEventListener('filetree:new-entry', handler)
  }, [beginNewEntry, createStoryFolder])

  const confirmNewEntry = async () => {
    if (!newEntryName.trim()) return
    // The `.canvas` or `.map` suffix is what routes a document to its editor, so it
    // follows the kind being created — never whatever the user typed. Without
    // this, a text file named "plan.canvas" would collide with a real canvas.
    const name = nameForKind(newEntryName, newEntryType)
    if (!stripDocSuffix(name)) return
    const path = newEntryParent ? `${newEntryParent}/${name}` : name

    if (newEntryType === 'folder') {
      await createFolder(projectName, path)
    } else {
      await createDocumentOfKind(projectName, path, newEntryType)
    }

    // Folders and files are the only entry kinds the tree orders; a canvas or map is a file.
    const orderType = newEntryType === 'folder' ? 'folder' : 'file'
    ensureOrderItem(newEntryParent || '', `${orderType}:${path}`)

    setNewEntryName('')
    setIsAddingEntry(false)
    await refreshTree()
    if (newEntryType !== 'folder') onSelectDoc(path)
  }

  const handleSelectProject = async (name) => {
    onSelectProject?.(name)
    setView('files')
    const rawTree = await listProjectTree(name)
    const firstFile = (() => {
      const stack = [...(rawTree.children || [])]
      while (stack.length) {
        const node = stack.shift()
        if (!node) continue
        if (node.type === 'file') return node.path
        if (node.type === 'folder') stack.unshift(...(node.children || []))
      }
      return null
    })()
    if (firstFile) {
      onSelectDoc(firstFile)
    }
  }

  const handleNewProject = async () => {
    if (!newProjectName.trim()) return
    const trimmed = newProjectName.trim()
    const created = await createProject(trimmed, newProjectLocation || null)
    if (created) {
      setNewProjectName('')
      setNewProjectLocation(null)
      setIsAddingProject(false)
      await refreshProjects()
    }
  }

  const chooseNewProjectLocation = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Choose a folder to store this project',
      })
      if (typeof selected === 'string' && selected) {
        setNewProjectLocation(selected)
      }
    } catch (err) {
      console.warn('Failed to choose project location:', err)
    }
  }

  const { handleDrop, updateManualDrag } = useFileTreeDrag({
    dragInsert,
    dragInsertRef,
    dragOverFolder,
    dragOverFolderRef,
    dragPointRef,
    manualDragActiveRef,
    manualDragRef,
    order,
    projectName,
    refreshTree,
    setDragInsert,
    setDragOverFolder,
    setDragOverPath,
    setDragPreview,
    setDragSourceId,
    setIsDragging,
    updateOrder,
  })


  // Handle rename confirm
  const handleRenameConfirm = useCallback(async () => {
    if (!renamingEntry) return
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === renamingEntry.oldName) {
      setRenamingEntry(null)
      setRenameValue('')
      return
    }
    const { path, type } = renamingEntry

    if (type === 'project') {
      const { renameProject } = await import('../lib/FileSystem')
      const nextName = await renameProject(path, trimmed)
      if (nextName) {
        if (nextName !== path) {
          const { statsService } = await import('../stats/service')
          statsService.renameProject(path, nextName)
        }
        migrateProjectTreeState(path, nextName)
        if (projectName === path) {
          onSelectProject?.(nextName)
        }
        await refreshProjects()
      }
      setRenamingEntry(null)
      setRenameValue('')
      return
    }

    // Renaming must not change a document's kind: re-apply its `.canvas` or `.map`
    // suffix (the edit box shows the bare name) and strip any from anything else.
    const nextName = nameForKind(trimmed, type === 'file' ? getDocKind(path) : 'folder')
    if (!stripDocSuffix(nextName)) {
      setRenamingEntry(null)
      setRenameValue('')
      return
    }

    const { renameEntry } = await import('../lib/entryOperations')
    const nextPath = await renameEntry(projectName, path, nextName, type)
    if (nextPath) {
      updateOrder(orderState => remapOrderForEntry(orderState, type, path, nextPath))
      if (type === 'folder') {
        updateExpanded(expandedState => remapExpandedForFolder(expandedState, path, nextPath))
      }
    }
    setRenamingEntry(null)
    setRenameValue('')
    await refreshTree()
  }, [onSelectProject, projectName, refreshProjects, refreshTree, renamingEntry, renameValue, updateExpanded, updateOrder])

  // Render helpers (plain functions, not components, so inputs keep focus across re-renders).

  const renderDropSlot = (indentPx) => (
    <MotionDiv
      className="file-drop-slot"
      style={{ marginLeft: `${indentPx}px` }}
      initial={prefersReducedMotion ? false : { height: 0, opacity: 0, scaleY: 0.5 }}
      animate={prefersReducedMotion ? undefined : { height: DRAG_SLOT_HEIGHT, opacity: 1, scaleY: 1 }}
      exit={prefersReducedMotion ? undefined : { height: 0, opacity: 0, scaleY: 0.5 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      <div className="file-drop-slot-inner" />
    </MotionDiv>
  )

  const renderNewEntryInput = (style) => (
    <div className="new-file-input" style={style}>
      <input
        autoFocus
        value={newEntryName}
        onChange={(e) => setNewEntryName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            confirmNewEntry()
          }
        }}
        onBlur={() => {
          if (!newEntryName.trim()) setIsAddingEntry(false)
        }}
        placeholder={
          newEntryType === 'folder'
            ? 'Folder name...'
            : newEntryType === 'canvas'
              ? 'Canvas name...'
              : newEntryType === 'map'
                ? 'Map name...'
                : newEntryType === 'timeline'
                  ? 'Timeline name...'
                  : 'File name...'
        }
      />
    </div>
  )

  const renderRenameInput = (style) => (
    <input
      className="new-file-input"
      autoFocus
      value={renameValue}
      onChange={e => setRenameValue(e.target.value)}
      onKeyDown={async e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          await handleRenameConfirm()
        } else if (e.key === 'Escape') {
          setRenamingEntry(null)
          setRenameValue('')
        }
      }}
      onBlur={handleRenameConfirm}
      style={style}
    />
  )

  // Render one tree node (file or folder) plus its drop slots and children.
  const orderedRoot = useMemo(() => {
    const result = applyOrderToTree(tree, { ...order })
    return result
  }, [tree, order])

  // The tree narrowed to one kind of file, fully open while it is.
  const shownRoot = useMemo(
    () => (filtering ? applyTreeFilter(orderedRoot, { ...EMPTY_FILTER, kind }) : orderedRoot),
    [filtering, orderedRoot, kind],
  )
  const shownExpanded = useMemo(() => (filtering ? folderPaths(shownRoot) : expanded), [filtering, shownRoot, expanded])

  // A kept split shows while both its documents are in the tree; a split is showing
  // when the panes are split and one of the kept ones is what they show.
  const filePaths = useMemo(() => filePathsIn(tree), [tree])
  const shownSplits = useMemo(
    () => (treeFor === projectName ? splits.filter((split) => filePaths.has(split.primaryDoc) && filePaths.has(split.secondaryDoc)) : NO_SPLITS),
    [filePaths, projectName, splits, treeFor],
  )
  const splitShowing = splitView === 'editor' && Boolean(activeSplitId)

  const renderNode = (node, depth = 0, siblings = []) => {
    if (!node) return null
    // Every decision this row makes lives in fileTreeNodeState.js; what is left
    // below is markup and handlers.
    const {
      dragName,
      hasEntryIcon,
      iconFilled,
      iconInk,
      iconName,
      isDragOver,
      isDragSource,
      isExpanded,
      isFolder,
      isPrimary,
      isRenaming,
      isSecondary,
      label,
      nodeId,
      parentPath,
      showFolderDivider,
      showInlineInput,
      showInsertAfterLast,
      showInsertSlot,
      siblingIndex,
    } = deriveFileNodeState(node, {
      activeDoc,
      currentDoc,
      dragInsert,
      dragOverPath,
      dragSourceId,
      expanded: shownExpanded,
      isAddingEntry,
      newEntryParent,
      presets,
      renamingEntry,
      secondaryDoc,
      siblings,
      splitView,
    })
    // While a kept split is showing, the split's own row is the selection; its two
    // documents are only marked as being in it.
    const inShownSplit = splitShowing && (isPrimary || isSecondary)
    // Locked itself, or inside a locked folder (docLocks.ts), which marks it more quietly.
    const lock = lockReason(node.path, locks)
    const lockInherited = lock?.by === 'folder' && lock.folder !== node.path

    return (
      <MotionDiv
        key={nodeId}
        className={`file-node${isFolder ? ' folder-node' : ''}`}
        layout="position"
        variants={prefersReducedMotion ? undefined : itemRevealVariants}
        initial={prefersReducedMotion ? false : 'collapsed'}
        animate={prefersReducedMotion ? undefined : 'expanded'}
        custom={siblingIndex}
      >
        <AnimatePresence initial={false}>
          {showInsertSlot ? renderDropSlot(TREE_ROOT_INDENT + depth * TREE_DEPTH_INDENT) : null}
        </AnimatePresence>

        <MotionDiv
          layout="position"
          className={`file-item${isFolder ? ' folder' : ''}${inShownSplit ? ' in-split' : `${isPrimary ? ' active' : ''}${isSecondary ? ' secondary' : ''}`}${isDragOver ? ' drag-over' : ''}${isDragSource ? ' is-drag-source' : ''}`}
          data-entry-type={node.type}
          data-entry-path={node.path}
          data-entry-parent={parentPath}
          data-entry-index={siblingIndex}
          animate={prefersReducedMotion ? undefined : isDragSource ? { opacity: 0.24, scale: 0.985 } : { opacity: 1, scale: 1 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          onMouseDown={(e) => {
            if (e.target instanceof HTMLElement && e.target.closest('input, textarea, button')) {
              return
            }
            e.preventDefault()
            // A filtered tree hides siblings, so there is nowhere certain to drop.
            if (e.button !== 0 || filtering) return
            // The ghost is the row itself, lifted: its size, and held where it was grabbed.
            const rowRect = e.currentTarget.getBoundingClientRect()
            manualDragRef.current = {
              path: node.path,
              type: node.type,
              name: dragName,
              iconName,
              iconFilled,
              startX: e.clientX,
              startY: e.clientY,
              box: {
                width: rowRect.width,
                height: rowRect.height,
                grabX: e.clientX - rowRect.left,
                grabY: e.clientY - rowRect.top,
                paddingLeft: getComputedStyle(e.currentTarget).paddingLeft,
              },
            }
            manualDragActiveRef.current = false
            dragInsertRef.current = null
            dragOverFolderRef.current = null
          }}
          onClick={(e) => {
            if (e.target instanceof HTMLElement && e.target.closest('input, textarea, button')) {
              return
            }
            if (manualDragActiveRef.current) return
            if (isFolder) {
              updateExpanded(prev => {
                if (prev.has(node.path)) prev.delete(node.path)
                else prev.add(node.path)
                return prev
              })
            } else {
              onSelectDoc(node.path)
            }
          }}
          style={{
            paddingLeft: `${TREE_ROOT_INDENT + depth * TREE_DEPTH_INDENT}px`,
            '--folder-divider-left': `${TREE_ROOT_INDENT + depth * TREE_DEPTH_INDENT}px`,
            '--folder-sticky-top': `${depth * FOLDER_STICKY_STEP}px`,
            '--folder-sticky-depth': depth,
          }}
        >
          {hasEntryIcon ? (
            <Icon name={iconName} active={iconFilled} className="file-item-icon" style={iconInk ? { color: inkColor(iconInk) } : undefined} />
          ) : null}
          {isRenaming ? (
            renderRenameInput({ marginLeft: hasEntryIcon ? 4 : 0, minWidth: 80 })
          ) : (
            <span className="file-item-label">{label}</span>
          )}
          {lock && !isRenaming ? (
            <Icon
              name="lock"
              label={lockInherited ? `Locked with “${lock.folder.split('/').pop()}”` : 'Locked'}
              className={`file-item-lock${lockInherited ? ' is-inherited' : ''}`}
            />
          ) : null}

          <AnimatePresence initial={false}>
            {showFolderDivider ? (
              <MotionDiv
                className="folder-open-divider-wrap"
                initial={prefersReducedMotion ? false : { opacity: 0 }}
                animate={prefersReducedMotion ? undefined : { opacity: 1 }}
                exit={prefersReducedMotion ? undefined : { opacity: 0 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
              >
                <MotionDiv
                  className="folder-open-divider"
                  initial={prefersReducedMotion ? false : { scaleX: 0, opacity: 0.7 }}
                  animate={prefersReducedMotion ? undefined : { scaleX: 1, opacity: 1 }}
                  exit={prefersReducedMotion ? undefined : { scaleX: 0, opacity: 0.7 }}
                  transition={{ duration: 0.24, ease: 'easeInOut' }}
                />
              </MotionDiv>
            ) : null}
          </AnimatePresence>
        </MotionDiv>

        <AnimatePresence initial={false}>
          {showInsertAfterLast ? renderDropSlot(TREE_ROOT_INDENT + depth * TREE_DEPTH_INDENT) : null}
        </AnimatePresence>

        {isFolder ? (
          <AnimatePresence initial={false}>
            {isExpanded ? (
              <MotionDiv
                className="file-children"
                data-parent-path={node.path}
                layout
                variants={prefersReducedMotion ? undefined : folderChildrenVariants}
                initial={prefersReducedMotion ? false : 'collapsed'}
                animate={prefersReducedMotion ? undefined : 'expanded'}
                exit={prefersReducedMotion ? undefined : 'collapsed'}
                style={{ overflow: 'visible' }}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOverFolder(null)
                  setDragOverPath(null)
                  setDragInsert({ parentPath: node.path, index: (node.children || []).length })
                }}
                onDrop={(e) => handleDrop(e, null, node.path)}
              >
                {showInlineInput && renderNewEntryInput({
                  paddingLeft: `${TREE_ROOT_INDENT + (depth + 1) * TREE_DEPTH_INDENT}px`,
                })}
                {(node.children || []).map(child => renderNode(child, depth + 1, node.children || []))}
              </MotionDiv>
            ) : null}
          </AnimatePresence>
        ) : null}
      </MotionDiv>
    )
  }

  // What the search offers as recent files: documents as they are opened.
  useEffect(() => { noteOpened(projectName, activeDoc) }, [projectName, activeDoc])

  // Expand or collapse every folder: all open unless all already are.
  const allFoldersOpen = useCallback(
    () => [...folderPaths(orderedRoot)].every((path) => expandedRef.current.has(path)),
    [orderedRoot],
  )
  const toggleAllFolders = useCallback(() => {
    const next = allFoldersOpen() ? new Set(['']) : folderPaths(orderedRoot)
    expandedRef.current = next
    setExpanded(next)
  }, [allFoldersOpen, orderedRoot])

  // Contextual create button: while a document inside a story-preset folder is
  // open, offer a sibling of the same kind ("New Character" in Characters/…).
  const storyFolderContext = useMemo(
    () => getStoryFolderAncestor(activeDoc || currentDoc || '', presets),
    [activeDoc, currentDoc, presets]
  )

  useEffect(() => {
    if (!projectName) return
    if (currentDoc) expandPath(getParentPath(currentDoc))
    if (splitView === 'editor' && secondaryDoc) expandPath(getParentPath(secondaryDoc))
  }, [projectName, currentDoc, secondaryDoc, splitView, expandPath])

  // Everything that can be added at the top of the project, as a native menu: the
  // kinds, then a sibling for the story folder being written in ("New character"),
  // then the story folders. Under them, how the tree is shown: every folder open or
  // shut, and which kinds of file it lists.
  const openNewMenu = (event) => {
    const contextLabel = storyFolderContext?.preset.entryLabel.toLowerCase()
    popUpMenu(event, [
      { text: 'New document', action: () => beginNewEntry('file', '') },
      { text: 'New canvas', action: () => beginNewEntry('canvas', '') },
      { text: 'New map', action: () => beginNewEntry('map', '') },
      { text: 'New timeline', action: () => beginNewEntry('timeline', '') },
      { text: 'New folder', action: () => beginNewEntry('folder', '') },
      { separator: true },
      storyFolderContext
        ? { text: `New ${contextLabel}`, action: () => beginNewEntry('file', storyFolderContext.path) }
        : null,
      {
        text: 'New story folder',
        items: [
          ...presets.map((preset) => ({
            text: preset.name,
            action: () => { void createStoryFolder(preset.key, '') },
          })),
          { separator: true },
          { text: 'Edit folder types…', action: () => openFolderPresets() },
        ],
      },
      { separator: true },
      { text: allFoldersOpen() ? 'Collapse all folders' : 'Expand all folders', action: toggleAllFolders },
      {
        text: 'Show',
        items: TREE_KINDS.map(({ value, label }) => ({ text: label, checked: kind === value, action: () => setKind(value) })),
      },
    ])
  }

  const footer = (
    <InlaySlot className="file-tree-footer">
      <Inlay round>
        <IconButton
          icon="add"
          label="New…"
          title="Add a document, canvas, map, timeline or folder"
          size="circle"
          className="file-tree-new"
          aria-haspopup="menu"
          onClick={openNewMenu}
        />
      </Inlay>
    </InlaySlot>
  )

  return (
    <div
      className={`file-tree${isDragging ? ' dragging' : ''}`}
      data-view={view}
      onMouseMove={(e) => {
        if (!manualDragRef.current || !manualDragActiveRef.current) return
        updateManualDrag(e.clientX, e.clientY)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => handleDrop(e, null, '')}
    >
      {/* A project's files add from the + at the sidebar's foot; the projects list from here. */}
      {view === 'projects' ? (
        <div className="file-tree-header">
          <span className="file-tree-title">Projects</span>
          <button
            className="file-tree-add"
            onClick={() => setIsAddingProject(true)}
            aria-label="New project"
            title="New project"
          >
            <Icon name="add" />
          </button>
        </div>
      ) : null}

      {view === 'projects' && (
        <>
          {isAddingProject && (
            <div className="new-project-input">
              <div className="new-file-input">
                <input
                  autoFocus
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleNewProject()
                    } else if (e.key === 'Escape') {
                      setIsAddingProject(false)
                      setNewProjectName('')
                      setNewProjectLocation(null)
                    }
                  }}
                  placeholder="Project name..."
                />
              </div>
              <button
                type="button"
                className="new-project-location"
                onClick={chooseNewProjectLocation}
                title={newProjectLocation || 'Stored in the app’s default location'}
              >
                <Icon name="folder" className="new-project-location-icon" />
                <span className="new-project-location-label">
                  {newProjectLocation
                    ? newProjectLocation.split('/').filter(Boolean).pop()
                    : 'Default location'}
                </span>
              </button>
            </div>
          )}
          <div className="file-list-frame">
          <div className="file-list" {...projectsReveal.contentProps}>
            {projects?.length === 0 ? (
              <div className="file-tree-empty">No projects yet.</div>
            ) : (
              (projects || []).map(project => {
                const isRenamingProject =
                  renamingEntry && renamingEntry.type === 'project' && renamingEntry.path === project

                return (
                  <div
                    key={project}
                    className="file-item project"
                    data-project-name={project}
                    onClick={(e) => {
                      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, button')) {
                        return
                      }
                      handleSelectProject(project)
                    }}
                  >
                    <Icon name="folder" className="file-item-icon" />
                    {isRenamingProject ? (
                      renderRenameInput({ marginLeft: 4, minWidth: 80 })
                    ) : (
                      <span className="file-item-label">{project}</span>
                    )}
                  </div>
                )
              })
            )}
          </div>
          <SkeletonOverlay visible={projectsReveal.skeleton} label="Loading projects">
            <SkeletonRows count={4} className="file-tree-skeleton" />
          </SkeletonOverlay>
          </div>
        </>
      )}

      {view === 'files' && (
        <>
          <div className="file-list-frame">
          {/* Stuck folders paint a background only once the list has scrolled under them. */}
          {/* The rows mount when the tree is revealed, so their own entrance (the stagger
              in itemRevealVariants) plays then; the list itself does not fade over it. */}
          <MotionDiv className="file-list" layout onScroll={markScrolled} aria-busy={treeReveal.contentProps['aria-busy']}>
            {treeReveal.phase === 'hidden' ? null : (<>
            {shownSplits.length ? (
              <div className="file-split-list" role="list" aria-label="Splits" data-reveal={treeReveal.phase}>
                {shownSplits.map((split) => {
                  const showing = splitShowing && split.id === activeSplitId
                  const first = getDocDisplayName(split.primaryDoc)
                  const second = getDocDisplayName(split.secondaryDoc)
                  const half = (docPath, name) => (
                    <span className="split-entry-doc">
                      <Icon name={docKindIcon(docPath)} className="file-item-icon" />
                      <span className="split-entry-name">{name}</span>
                    </span>
                  )
                  return (
                    <div
                      key={split.id}
                      role="listitem"
                      className={`file-item split-entry${showing ? ' active' : ''}`}
                      style={{ paddingLeft: `${TREE_ROOT_INDENT}px` }}
                      title={`${first} beside ${second}`}
                      onClick={(event) => {
                        if (event.target instanceof Element && event.target.closest('button')) return
                        onOpenSplit?.(split.id)
                      }}
                    >
                      <span
                        role="button"
                        tabIndex={0}
                        className="split-entry-open"
                        aria-current={showing || undefined}
                        aria-label={`${first} beside ${second}`}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          onOpenSplit?.(split.id)
                        }}
                      >
                        {half(split.primaryDoc, first)}
                        <span className="split-entry-rule" aria-hidden="true" />
                        {half(split.secondaryDoc, second)}
                      </span>
                      <IconButton
                        icon="close"
                        size="circle"
                        label="Close split"
                        className="split-entry-close"
                        onClick={() => onForgetSplit?.(split.id)}
                      />
                    </div>
                  )
                })}
              </div>
            ) : null}
            {isAddingEntry && newEntryParent === '' && renderNewEntryInput()}
            {(shownRoot.children || []).length === 0 ? (
              <div className="file-tree-empty" data-reveal={treeReveal.phase}>
                {!filtering ? 'No files yet.' : `No ${TREE_KINDS.find((entry) => entry.value === kind)?.label.toLowerCase()} yet.`}
              </div>
            ) : (
              <AnimatePresence initial={treeReveal.phase === 'shown'}>
                {(shownRoot.children || []).map(child => renderNode(child, 0, shownRoot.children || []))}
                {dragInsert && dragInsert.parentPath === '' && dragInsert.index === (orderedRoot.children || []).length
                  ? renderDropSlot(TREE_ROOT_INDENT)
                  : null}
              </AnimatePresence>
            )}
            </>)}
          </MotionDiv>
          <SkeletonOverlay visible={treeReveal.skeleton} label="Loading files">
            <SkeletonRows count={7} className="file-tree-skeleton" />
          </SkeletonOverlay>
          </div>
          {footerSlot === undefined ? footer : footerSlot ? createPortal(footer, footerSlot) : null}
        </>
      )}

      {/* On the body: the sidebar's sliding track is transformed, which would hold a
          fixed ghost inside the sidebar instead of letting it follow the pointer out. */}
      {createPortal(<AnimatePresence>
        {dragPreview ? (
          <MotionDiv
            className="file-tree-drag-ghost"
            initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.94 }}
            // Settled, the document is in the split it opened, not under the pointer.
            animate={prefersReducedMotion ? undefined : (dragPreview.settled ? { opacity: 0, scale: 0.94 } : { opacity: 1, scale: 1 })}
            exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.94 }}
            // The ghost is the row lifted out of the tree, held where it was grabbed.
            // (Offset in px, not a transform — framer owns this element's transform.)
            style={{
              left: dragPreview.x - (dragPreview.box?.grabX ?? 10),
              top: dragPreview.y - (dragPreview.box?.grabY ?? 12),
              width: dragPreview.box?.width,
              height: dragPreview.box?.height,
              paddingLeft: dragPreview.box?.paddingLeft,
              visibility: prefersReducedMotion && dragPreview.settled ? 'hidden' : undefined,
            }}
          >
            {dragPreview.iconName ? (
              <Icon name={dragPreview.iconName} active={dragPreview.iconFilled} className="file-item-icon" />
            ) : null}
            <span className="file-tree-drag-ghost-label">{dragPreview.name}</span>
          </MotionDiv>
        ) : null}
      </AnimatePresence>, document.body)}
    </div>
  )
}
