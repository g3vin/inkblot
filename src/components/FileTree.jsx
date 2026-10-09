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
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  listProjects,
  createProject,
  listProjectTree,
  createFolder,
} from '../lib/FileSystem'
import { createDocumentOfKind, nameForKind } from '../lib/createDocument'
import { getDocKind, stripDocSuffix } from '../lib/docKind'
import Icon from '../ui/Icon.jsx'
import { IconButton, popUpNativeMenu } from '../ui'
import { useFileTreeDrag } from '../hooks/useFileTreeDrag'
import { deriveFileNodeState } from '../lib/fileTreeNodeState'
import { EMPTY_FILTER, applyTreeFilter, folderPaths, isFilterActive } from '../lib/treeFilter'
import { noteOpened, recentDocs } from '../lib/recentDocs'
import { lockReason, refreshLocks, useLocks } from '../lib/docLocks'
import TreeFilterBar from './tree/TreeFilterBar'
import {
  STORY_FOLDER_PRESETS,
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


export default function FileTree({
  projectName,
  currentDoc,
  secondaryDoc,
  splitView,
  activeDoc,
  onSelectDoc,
  onSelectProject,
  registerRefreshFiles,
  // Where the + and the filter go: under the list when not given; into this element
  // when given (the left sidebar keeps them at its foot, still while Files and Book
  // swipe past above); nowhere when null (the book has the foot).
  footerSlot,
}) {
  const prefersReducedMotion = useReducedMotion()
  const locks = useLocks()
  const [view, setView] = useState('files')
  const [projects, setProjects] = useState([])
  const [tree, setTree] = useState({ type: 'folder', name: '', path: '', children: [] })
  const [expanded, setExpanded] = useState(new Set(['']))
  const [filter, setFilter] = useState(EMPTY_FILTER)
  const filtering = isFilterActive(filter)
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
    setProjects(list)
  }, [])

  const refreshTree = useCallback(async () => {
    if (!projectName) return
    const nextOrder = loadOrder(projectName)
    const rawTree = await listProjectTree(projectName)
    const orderedTree = applyOrderToTree(rawTree, nextOrder)
    saveOrder(projectName, nextOrder)
    orderRef.current = nextOrder
    setOrder(nextOrder)
    setTree(orderedTree)
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
    const preset = getStoryFolderPresetByKey(presetKey)
    if (!preset || !projectName) return

    const path = parent ? `${parent}/${preset.name}` : preset.name
    await createFolder(projectName, path)
    ensureOrderItem(parent || '', `folder:${path}`)
    setIsAddingEntry(false)
    await refreshTree()
    expandPath(path)
  }, [ensureOrderItem, expandPath, projectName, refreshTree])

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
  const renderNode = (node, depth = 0, siblings = []) => {
    if (!node) return null
    // Every decision this row makes lives in fileTreeNodeState.js; what is left
    // below is markup and handlers.
    const {
      dragName,
      hasEntryIcon,
      iconFilled,
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
      renamingEntry,
      secondaryDoc,
      siblings,
      splitView,
    })
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
          className={`file-item${isFolder ? ' folder' : ''}${isPrimary ? ' active' : ''}${isSecondary ? ' secondary' : ''}${isDragOver ? ' drag-over' : ''}${isDragSource ? ' is-drag-source' : ''}`}
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
            manualDragRef.current = {
              path: node.path,
              type: node.type,
              name: dragName,
              iconName,
              iconFilled,
              startX: e.clientX,
              startY: e.clientY,
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
            <Icon name={iconName} active={iconFilled} className="file-item-icon" />
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

  const orderedRoot = useMemo(() => {
    const result = applyOrderToTree(tree, { ...order })
    return result
  }, [tree, order])

  // The filter bar's view of the tree, fully open while it filters.
  const shownRoot = useMemo(
    () => (filtering ? applyTreeFilter(orderedRoot, filter, recentDocs(projectName)) : orderedRoot),
    [filtering, orderedRoot, filter, projectName],
  )
  const shownExpanded = useMemo(() => (filtering ? folderPaths(shownRoot) : expanded), [filtering, shownRoot, expanded])

  // What the clock button filters to: documents as they are opened.
  useEffect(() => { noteOpened(projectName, activeDoc) }, [projectName, activeDoc])

  // Expand or collapse every folder: all open unless all already are.
  const toggleAllFolders = useCallback(() => {
    const all = folderPaths(orderedRoot)
    const allOpen = [...all].every((path) => expandedRef.current.has(path))
    const next = allOpen ? new Set(['']) : all
    expandedRef.current = next
    setExpanded(next)
  }, [orderedRoot])

  // Contextual create button: while a document inside a story-preset folder is
  // open, offer a sibling of the same kind ("New Character" in Characters/…).
  const storyFolderContext = useMemo(
    () => getStoryFolderAncestor(activeDoc || currentDoc || ''),
    [activeDoc, currentDoc]
  )

  useEffect(() => {
    if (!projectName) return
    if (currentDoc) expandPath(getParentPath(currentDoc))
    if (splitView === 'editor' && secondaryDoc) expandPath(getParentPath(secondaryDoc))
  }, [projectName, currentDoc, secondaryDoc, splitView, expandPath])

  // Everything that can be added at the top of the project, as a native menu: the
  // kinds, then a sibling for the story folder being written in ("New character"),
  // then the story folders.
  const openNewMenu = (event) => {
    const contextLabel = storyFolderContext?.preset.entryLabel.toLowerCase()
    popUpNativeMenu(event, [
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
        items: STORY_FOLDER_PRESETS.map((preset) => ({
          text: preset.name,
          action: () => { void createStoryFolder(preset.key, '') },
        })),
      },
    ])
  }

  const footer = (
    <div className="file-tree-footer">
      <IconButton
        icon="add"
        label="New…"
        title="Add a document, canvas, map, timeline or folder"
        size="circle"
        className="floating-capsule file-tree-new"
        aria-haspopup="menu"
        onClick={openNewMenu}
      />
      <TreeFilterBar filter={filter} onChange={setFilter} onToggleFolders={toggleAllFolders} />
    </div>
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
      {/* A project's files add from the + beside the filter; the projects list from here. */}
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
          <div className="file-list">
            {projects.length === 0 ? (
              <div className="file-tree-empty">No projects yet.</div>
            ) : (
              projects.map(project => {
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
        </>
      )}

      {view === 'files' && (
        <>
          <MotionDiv className="file-list" layout>
            {isAddingEntry && newEntryParent === '' && renderNewEntryInput()}
            {(shownRoot.children || []).length === 0 ? (
              <div className="file-tree-empty">
                {!filtering ? 'No files yet.' : filter.recentOnly && !recentDocs(projectName).length ? 'No recent files' : 'No matching files'}
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {(shownRoot.children || []).map(child => renderNode(child, 0, shownRoot.children || []))}
                {dragInsert && dragInsert.parentPath === '' && dragInsert.index === (orderedRoot.children || []).length
                  ? renderDropSlot(TREE_ROOT_INDENT)
                  : null}
              </AnimatePresence>
            )}
          </MotionDiv>
          {footerSlot === undefined ? footer : footerSlot ? createPortal(footer, footerSlot) : null}
        </>
      )}

      <AnimatePresence>
        {dragPreview ? (
          <MotionDiv
            className="file-tree-drag-ghost"
            initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.94 }}
            animate={prefersReducedMotion ? undefined : { opacity: 1, scale: 1 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.94 }}
            // The ghost hangs off the pointer rather than sitting away from it: the
            // cursor rides just inside its leading edge, level with its middle.
            // (Offset in px, not a transform — framer owns this element's transform.)
            style={{
              left: dragPreview.x - 10,
              top: dragPreview.y - 18,
            }}
          >
            {dragPreview.iconName ? (
              <Icon name={dragPreview.iconName} active={dragPreview.iconFilled} className="file-item-icon" />
            ) : null}
            <span className="file-tree-drag-ghost-label">{dragPreview.name}</span>
          </MotionDiv>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
