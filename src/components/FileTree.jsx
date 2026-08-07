import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  listProjects,
  createProject,
  listProjectTree,
  saveDocument,
  createFolder,
  moveEntry,
} from './FileSystem'
import SFIcon from './SFIcon'
import {
  STORY_FOLDER_PRESETS,
  getStoryFolderPresetByKey,
  getStoryFolderPresetForEntry,
} from './storyStructure'

const MotionDiv = motion.div

const ORDER_PREFIX = 'inkblot-order:'
const EXPANDED_PREFIX = 'inkblot-expanded:'
const DRAG_DEBUG = false
const DRAG_SLOT_HEIGHT = 28

const itemRevealVariants = {
  collapsed: {
    opacity: 0,
    y: -8,
  },
  expanded: (index = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.2,
      ease: 'easeOut',
      delay: Math.min(index, 8) * 0.024,
    },
  }),
}

const folderChildrenVariants = {
  collapsed: {
    height: 0,
    opacity: 0,
    transition: {
      duration: 0.18,
      ease: 'easeInOut',
      when: 'afterChildren',
      staggerChildren: 0.018,
      staggerDirection: -1,
    },
  },
  expanded: {
    height: 'auto',
    opacity: 1,
    transition: {
      duration: 0.24,
      ease: 'easeOut',
      when: 'beforeChildren',
      staggerChildren: 0.03,
      delayChildren: 0.02,
    },
  },
}

const loadOrder = (projectName) => {
  try {
    return JSON.parse(localStorage.getItem(`${ORDER_PREFIX}${projectName}`) || '{}')
  } catch {
    return {}
  }
}

const saveOrder = (projectName, order) => {
  localStorage.setItem(`${ORDER_PREFIX}${projectName}`, JSON.stringify(order))
}

const loadExpanded = (projectName) => {
  try {
    const raw = localStorage.getItem(`${EXPANDED_PREFIX}${projectName}`)
    if (!raw) return ['']
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : ['']
  } catch {
    return ['']
  }
}

const saveExpanded = (projectName, expandedList) => {
  localStorage.setItem(`${EXPANDED_PREFIX}${projectName}`, JSON.stringify(expandedList))
}

const migrateProjectTreeState = (fromProjectName, toProjectName) => {
  if (!fromProjectName || !toProjectName || fromProjectName === toProjectName) return

  const pairs = [
    [`${ORDER_PREFIX}${fromProjectName}`, `${ORDER_PREFIX}${toProjectName}`],
    [`${EXPANDED_PREFIX}${fromProjectName}`, `${EXPANDED_PREFIX}${toProjectName}`],
  ]

  pairs.forEach(([fromKey, toKey]) => {
    const value = localStorage.getItem(fromKey)
    if (value == null) return
    localStorage.setItem(toKey, value)
    localStorage.removeItem(fromKey)
  })
}

const getParentPath = (path = '') => path.split('/').slice(0, -1).join('/')

const ensureOrder = (order, folderPath, children) => {
  const folderKey = folderPath || ''
  const ids = children.map(child => `${child.type}:${child.path}`)
  const existing = order[folderKey] || []
  const filtered = existing.filter(id => ids.includes(id))
  const missing = ids.filter(id => !filtered.includes(id))
  const next = [...filtered, ...missing]
  const changed = existing.length !== next.length || existing.some((id, idx) => id !== next[idx])
  return { next, changed }
}

const applyOrderToTree = (node, order) => {
  if (!node || node.type !== 'folder') return node

  const children = node.children || []
  const { next, changed } = ensureOrder(order, node.path, children)
  if (changed) {
    order[node.path || ''] = next
  }

  const indexMap = new Map(next.map((id, index) => [id, index]))
  const sorted = [...children].sort((a, b) => {
    const aId = `${a.type}:${a.path}`
    const bId = `${b.type}:${b.path}`
    const aIndex = indexMap.get(aId)
    const bIndex = indexMap.get(bId)

    if (aIndex == null && bIndex == null) return a.name.localeCompare(b.name)
    if (aIndex == null) return 1
    if (bIndex == null) return -1
    return aIndex - bIndex
  })

  return {
    ...node,
    children: sorted.map(child => applyOrderToTree(child, order)),
  }
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

const remapOrderForEntry = (orderState, type, fromPath, toPath) => {
  if (type === 'folder') {
    return remapOrderForFolder(orderState, fromPath, toPath)
  }

  const fromId = `${type}:${fromPath}`
  const toId = `${type}:${toPath}`
  const next = {}

  Object.entries(orderState).forEach(([key, list]) => {
    next[key] = list.map(id => (id === fromId ? toId : id))
  })

  return next
}

const remapExpandedForFolder = (expandedSet, fromPath, toPath) => {
  const next = new Set()

  expandedSet.forEach(path => {
    if (path === fromPath || path.startsWith(`${fromPath}/`)) {
      next.add(path.replace(fromPath, toPath))
    } else {
      next.add(path)
    }
  })

  return next
}

const collectFolderPaths = (node) => {
  const paths = []

  const visit = (entry) => {
    if (!entry || entry.type !== 'folder') return
    if (entry.path) paths.push(entry.path)
    ;(entry.children || []).forEach(visit)
  }

  visit(node)
  return paths
}

export default function FileTree({
  projectName,
  currentDoc,
  secondaryDoc,
  splitView,
  activeDoc,
  onSelectDoc,
  onSelectProject,
  onExitProject,
  registerRefreshFiles,
}) {
  const prefersReducedMotion = useReducedMotion()
  const [view, setView] = useState('files')
  const [projects, setProjects] = useState([])
  const [tree, setTree] = useState({ type: 'folder', name: '', path: '', children: [] })
  const [expanded, setExpanded] = useState(new Set(['']))
  const [order, setOrder] = useState({})
  const [isAddingEntry, setIsAddingEntry] = useState(false)
  const [newEntryName, setNewEntryName] = useState('')
  const [newEntryType, setNewEntryType] = useState('file')
  const [newEntryParent, setNewEntryParent] = useState('')
  const [renamingEntry, setRenamingEntry] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [isAddingProject, setIsAddingProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false)
  const [dragOverPath, setDragOverPath] = useState(null)
  const [dragInsert, setDragInsert] = useState(null)
  const [dragOverFolder, setDragOverFolder] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragPreview, setDragPreview] = useState(null)
  const [dragSourceId, setDragSourceId] = useState(null)
  const [entryMenu, setEntryMenu] = useState(null)
  const createMenuRef = useRef(null)
  const entryMenuRef = useRef(null)
  const manualDragRef = useRef(null)
  const manualDragActiveRef = useRef(false)
  const dragInsertRef = useRef(null)
  const dragOverFolderRef = useRef(null)
  const orderRef = useRef({})
  const expandedRef = useRef(new Set(['']))

  const refreshProjects = useCallback(async () => {
    const list = await listProjects()
    setProjects(list)
  }, [])

  useEffect(() => {
    if (!DRAG_DEBUG) return
    const onDragOver = (event) => {
      console.debug('[FileTree] window dragover', {
        target: event.target?.className || event.target?.tagName,
      })
    }
    const onDragEnter = (event) => {
      console.debug('[FileTree] window dragenter', {
        target: event.target?.className || event.target?.tagName,
      })
    }
    const onDrop = (event) => {
      console.debug('[FileTree] window drop', {
        target: event.target?.className || event.target?.tagName,
      })
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('drop', onDrop)
    }
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
    setIsCreateMenuOpen(false)
  }, [])

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
    setIsCreateMenuOpen(false)
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
          oldName: detail.name,
          parent: detail.parent || '',
        })
        setRenameValue(detail.name)
        setIsAddingEntry(false)
        setIsAddingProject(false)
        setIsCreateMenuOpen(false)
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

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!createMenuRef.current?.contains(event.target)) {
        setIsCreateMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  useEffect(() => {
    const handlePointerDown = (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target.closest('.file-item-menu-btn')) return
      if (entryMenuRef.current?.contains(target)) return
      setEntryMenu(null)
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setEntryMenu(null)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const openEntryMenu = useCallback((event, node) => {
    event.preventDefault()
    event.stopPropagation()

    const rect = event.currentTarget.getBoundingClientRect()
    const menuWidth = 190
    const preferredLeft = rect.right + 8
    const viewportWidth = window.innerWidth || 0
    const left = viewportWidth
      ? Math.min(preferredLeft, Math.max(12, viewportWidth - menuWidth - 12))
      : preferredLeft

    setEntryMenu({
      id: `${node.type}:${node.path}`,
      type: node.type,
      name: node.name,
      left,
      top: rect.top + rect.height / 2,
    })
  }, [])

  const confirmNewEntry = async () => {
    if (!newEntryName.trim()) return
    const trimmed = newEntryName.trim()
    const path = newEntryParent ? `${newEntryParent}/${trimmed}` : trimmed

    if (newEntryType === 'folder') {
      await createFolder(projectName, path)
    } else {
      await saveDocument(projectName, path, { type: 'doc', content: [] })
    }

    ensureOrderItem(newEntryParent || '', `${newEntryType}:${path}`)

    setNewEntryName('')
    setIsAddingEntry(false)
    await refreshTree()
    if (newEntryType === 'file') onSelectDoc(path)
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
    const created = await createProject(trimmed)
    if (created) {
      setNewProjectName('')
      setIsAddingProject(false)
      await refreshProjects()
    }
  }

  const moveOrderItem = useCallback((itemId, fromFolder, toFolder, targetIndex) => {
    updateOrder(orderState => {
      const fromKey = fromFolder || ''
      const toKey = toFolder || ''

      const fromList = [...(orderState[fromKey] || [])]
      const fromIndex = fromList.indexOf(itemId)
      const filtered = fromList.filter(id => id !== itemId)
      orderState[fromKey] = filtered

      const toList = [...(orderState[toKey] || [])].filter(id => id !== itemId)
      let requestedIndex = typeof targetIndex === 'number'
        ? targetIndex
        : toList.length

      if (fromKey === toKey && typeof targetIndex === 'number' && fromIndex !== -1 && fromIndex < targetIndex) {
        requestedIndex -= 1
      }

      const insertIndex = Math.max(0, Math.min(requestedIndex, toList.length))

      if (DRAG_DEBUG) {
        console.debug('[FileTree] moveOrderItem', {
          itemId,
          fromKey,
          toKey,
          fromIndex,
          targetIndex,
          requestedIndex,
          insertIndex,
          fromList,
          toList,
        })
      }

      toList.splice(insertIndex, 0, itemId)
      orderState[toKey] = toList

      return orderState
    })
  }, [updateOrder])

  const performMove = useCallback(async ({ path, type }, targetFolder, targetIndex) => {
    const fromParent = getParentPath(path)

    if (type === 'folder' && targetFolder.startsWith(`${path}/`)) return

    let nextPath = path

    if (DRAG_DEBUG) {
      console.debug('[FileTree] performMove', { path, type, fromParent, targetFolder, targetIndex })
    }

    // Moving to a different folder - need filesystem operation
    if (fromParent !== targetFolder) {
      const moved = await moveEntry(projectName, path, targetFolder, type)
      if (!moved) {
        await refreshTree()
        return
      }
      nextPath = moved
      if (type === 'folder') {
        updateOrder(orderState => remapOrderForFolder(orderState, path, nextPath))
      }
      moveOrderItem(`${type}:${nextPath}`, fromParent, targetFolder, targetIndex)
      await refreshTree()
    } else {
      // Same folder reorder - just update the order, no filesystem operation needed
      moveOrderItem(`${type}:${nextPath}`, fromParent, targetFolder, targetIndex)
    }
  }, [projectName, refreshTree, moveOrderItem, updateOrder])

  const handleDrop = async (event, targetNode, targetParent) => {
    event.preventDefault()
    setDragOverPath(null)
    setDragInsert(null)
    setDragOverFolder(null)

    let data
    try {
      const raw = event.dataTransfer.getData('application/json') || event.dataTransfer.getData('text/plain')
      data = JSON.parse(raw)
    } catch {
      return
    }

    if (!data?.path || !data?.type) return
    if (data.path === targetNode?.path) return

    const useInsert = dragInsert && dragInsert.parentPath === (targetParent || '')
    const targetFolder = useInsert
      ? dragInsert.parentPath
      : (dragOverFolder && targetNode?.type === 'folder')
        ? targetNode.path
        : (targetNode?.type === 'folder' ? targetNode.path : (targetParent || ''))

    const targetIndex = useInsert
      ? dragInsert.index
      : (targetNode && targetNode.type !== 'folder'
        ? (order[targetParent || ''] || []).indexOf(`${targetNode.type}:${targetNode.path}`)
        : undefined)

    if (DRAG_DEBUG) {
      console.debug('[FileTree] drop', {
        item: data,
        targetFolder,
        targetIndex,
        dragInsert,
        dragOverFolder,
        targetNode,
        targetParent,
      })
    }

    await performMove(data, targetFolder, targetIndex)
  }

  const updateManualDrag = useCallback((clientX, clientY) => {
    const el = document.elementFromPoint(clientX, clientY)
    if (!el) return

    const item = el.closest('.file-item')
    if (item) {
      const entryType = item.getAttribute('data-entry-type')
      const entryPath = item.getAttribute('data-entry-path')
      const parentPath = item.getAttribute('data-entry-parent') || ''
      const indexAttr = item.getAttribute('data-entry-index')
      const rect = item.getBoundingClientRect()
      const offsetY = clientY - rect.top
      const beforeZone = rect.height * 0.33
      const afterZone = rect.height * 0.66
      const index = Number.isNaN(Number(indexAttr))
        ? (order[parentPath] || []).indexOf(`${entryType}:${entryPath}`)
        : Number(indexAttr)

      if (entryType === 'folder' && offsetY > beforeZone && offsetY < afterZone) {
        setDragOverFolder(entryPath)
        dragOverFolderRef.current = entryPath
        setDragInsert(null)
        dragInsertRef.current = null
        setDragOverPath(entryPath)
        return
      }

      const insertIndex = offsetY >= afterZone
        ? index + 1
        : index

      setDragOverFolder(null)
      dragOverFolderRef.current = null
      setDragOverPath(null)
      setDragInsert({ parentPath, index: insertIndex })
      dragInsertRef.current = { parentPath, index: insertIndex }
      return
    }

    const childrenContainer = el.closest('.file-children')
    if (childrenContainer) {
      // Keep the current drag insert position rather than jumping to end
      return
    }

    const list = el.closest('.file-list')
    if (list) {
      // Keep the current drag insert position rather than jumping to end
      return
    }
  }, [order])

  useEffect(() => {
    const onMove = (event) => {
      const drag = manualDragRef.current
      if (!drag) return
      const dx = Math.abs(event.clientX - drag.startX)
      const dy = Math.abs(event.clientY - drag.startY)
      if (!manualDragActiveRef.current) {
        if (dx + dy < 4) return
        manualDragActiveRef.current = true
        setIsDragging(true)
        setDragSourceId(`${drag.type}:${drag.path}`)
        setDragPreview({
          x: event.clientX,
          y: event.clientY,
          name: drag.name,
          iconName: drag.iconName,
          iconFilled: drag.iconFilled,
        })
        if (DRAG_DEBUG) {
          console.debug('[FileTree] manual drag start', drag)
        }
      }
      setDragPreview((current) => current ? {
        ...current,
        x: event.clientX,
        y: event.clientY,
      } : current)
      updateManualDrag(event.clientX, event.clientY)
    }

    const onUp = async () => {
      const drag = manualDragRef.current
      if (!drag) return
      const didDrag = manualDragActiveRef.current
      const insert = dragInsertRef.current
      const folder = dragOverFolderRef.current

      manualDragRef.current = null
      manualDragActiveRef.current = false
      setIsDragging(false)
      setDragPreview(null)
      setDragSourceId(null)
      setDragOverPath(null)
      setDragInsert(null)
      setDragOverFolder(null)

      if (didDrag) {
        const targetFolder = folder || (insert ? insert.parentPath : getParentPath(drag.path))
        const targetIndex = insert ? insert.index : undefined
        if (DRAG_DEBUG) {
          console.debug('[FileTree] manual drop', { drag, targetFolder, targetIndex, dragInsert, dragOverFolder })
        }
        await performMove({ path: drag.path, type: drag.type }, targetFolder, targetIndex)
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragInsert, dragOverFolder, performMove, updateManualDrag])

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
      const { renameProject } = await import('./FileSystem')
      const nextName = await renameProject(path, trimmed)
      if (nextName) {
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

    const { renameEntry } = await import('./FileSystem')
    const nextPath = await renameEntry(projectName, path, trimmed, type)
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

  const renderNode = (node, depth = 0, siblings = []) => {
    if (!node) return null
    const isFolder = node.type === 'folder'
    const isExpanded = expanded.has(node.path)
    const isPrimary = currentDoc === node.path
    const isActive = activeDoc ? activeDoc === node.path : isPrimary
    const isSecondary = splitView === 'editor' && secondaryDoc === node.path
    const storyPreset = getStoryFolderPresetForEntry(node.path, node.type)
    const parentPath = getParentPath(node.path)
    const nodeId = `${node.type}:${node.path}`
    const iconName = isFolder
      ? (storyPreset?.folderIcon || (isExpanded ? 'folder.fill' : 'folder'))
      : 'doc'
    const iconFilled = !isFolder && isActive
    const showInlineInput =
      isAddingEntry && newEntryParent === node.path && (isFolder || newEntryParent)
    const siblingIndex = siblings.findIndex(child => child.path === node.path && child.type === node.type)
    const showInsertSlot = dragInsert && dragInsert.parentPath === parentPath && dragInsert.index === siblingIndex
    const showInsertAfterLast =
      dragInsert && dragInsert.parentPath === parentPath && dragInsert.index === siblings.length && siblingIndex === siblings.length - 1

    const isRenaming = renamingEntry && renamingEntry.path === node.path && renamingEntry.type === node.type
    const isDragSource = dragSourceId === nodeId
    const isMenuOpen = entryMenu?.id === nodeId
    const showFolderDivider = isFolder && isExpanded
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
          {showInsertSlot ? (
            <MotionDiv
              className="file-drop-slot"
              style={{ marginLeft: `${10 + depth * 12}px` }}
              initial={prefersReducedMotion ? false : { height: 0, opacity: 0, scaleY: 0.5 }}
              animate={prefersReducedMotion ? undefined : { height: DRAG_SLOT_HEIGHT, opacity: 1, scaleY: 1 }}
              exit={prefersReducedMotion ? undefined : { height: 0, opacity: 0, scaleY: 0.5 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <div className="file-drop-slot-inner" />
            </MotionDiv>
          ) : null}
        </AnimatePresence>

        <MotionDiv
          layout="position"
          className={`file-item${isFolder ? ' folder' : ''}${isPrimary ? ' active' : ''}${isSecondary ? ' secondary' : ''}${dragOverPath === node.path ? ' drag-over' : ''}${isDragSource ? ' is-drag-source' : ''}${isMenuOpen ? ' menu-open' : ''}`}
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
            if (e.button !== 0) return
            manualDragRef.current = {
              path: node.path,
              type: node.type,
              name: node.name,
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
            paddingLeft: `${10 + depth * 12}px`,
            '--folder-sticky-top': `${depth * 28}px`,
            '--folder-sticky-depth': depth,
          }}
        >
          <SFIcon
            name={iconName}
            filled={iconFilled}
            className="file-item-icon"
          />
          {isRenaming ? (
            <input
              className="new-file-input"
              autoFocus
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={async e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  await handleRenameConfirm();
                } else if (e.key === 'Escape') {
                  setRenamingEntry(null);
                  setRenameValue('');
                }
              }}
              onBlur={handleRenameConfirm}
              style={{ marginLeft: 4, minWidth: 80 }}
            />
          ) : (
            <span className="file-item-label">{node.name}</span>
          )}

          {!isRenaming ? (
            <button
              type="button"
              className="file-item-menu-btn"
              aria-label={`${isFolder ? 'Folder' : 'Document'} options`}
              title="Options"
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => openEntryMenu(event, node)}
            >
              <SFIcon name="ellipsis" size={15} />
            </button>
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
          {showInsertAfterLast ? (
            <MotionDiv
              className="file-drop-slot"
              style={{ marginLeft: `${10 + depth * 12}px` }}
              initial={prefersReducedMotion ? false : { height: 0, opacity: 0, scaleY: 0.5 }}
              animate={prefersReducedMotion ? undefined : { height: DRAG_SLOT_HEIGHT, opacity: 1, scaleY: 1 }}
              exit={prefersReducedMotion ? undefined : { height: 0, opacity: 0, scaleY: 0.5 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <div className="file-drop-slot-inner" />
            </MotionDiv>
          ) : null}
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
                {showInlineInput && (
                  <div className="new-file-input" style={{ paddingLeft: `${10 + (depth + 1) * 12}px` }}>
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
                      placeholder={newEntryType === 'folder' ? 'Folder name...' : 'File name...'}
                    />
                  </div>
                )}
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
    if (DRAG_DEBUG) {
      console.debug('[FileTree] orderedRoot computed', { order, rootChildren: result.children?.map(c => c.path) })
    }
    return result
  }, [tree, order])

  useEffect(() => {
    if (!projectName) return
    if (currentDoc) expandPath(getParentPath(currentDoc))
    if (splitView === 'editor' && secondaryDoc) expandPath(getParentPath(secondaryDoc))
  }, [projectName, currentDoc, secondaryDoc, splitView, expandPath])

  return (
    <div
      className={`file-tree${isDragging ? ' dragging' : ''}`}
      data-view={view}
      onDragEnter={(e) => {
        if (DRAG_DEBUG) {
          console.debug('[FileTree] root dragenter', {
            target: e.target?.className || e.target?.tagName,
          })
        }
      }}
      onMouseMove={(e) => {
        if (!manualDragRef.current || !manualDragActiveRef.current) return
        updateManualDrag(e.clientX, e.clientY)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDragOverCapture={(e) => {
        if (DRAG_DEBUG) {
          console.debug('[FileTree] capture dragover', {
            target: e.target?.className || e.target?.tagName,
          })
        }
      }}
      onDropCapture={(e) => {
        if (DRAG_DEBUG) {
          console.debug('[FileTree] capture drop', {
            target: e.target?.className || e.target?.tagName,
          })
        }
      }}
      onDrop={(e) => handleDrop(e, null, '')}
    >
      <div className="file-tree-header">
        {view === 'files' ? (
          <button
            className="file-tree-back"
            onClick={() => {
              setView('projects')
              onExitProject?.()
            }}
            title="Back to projects"
            aria-label="Back to projects"
          >
            <SFIcon name="chevron.left" />
          </button>
        ) : (
          <span className="file-tree-title">Projects</span>
        )}

        {view === 'files' ? (
          <span className="file-tree-title">{projectName}</span>
        ) : null}

        <div className="file-tree-add-wrap" ref={createMenuRef}>
          <button
            className="file-tree-add"
            onClick={() => {
              if (view === 'projects') {
                setIsAddingProject(true)
                return
              }
              setIsCreateMenuOpen(open => !open)
            }}
            aria-label={view === 'projects' ? 'New project' : 'Create new'}
            title={view === 'projects' ? 'New project' : 'Create new'}
          >
            <SFIcon name="plus" />
          </button>

          {view === 'files' && isCreateMenuOpen && (
            <div className="file-tree-create-menu">
              <button
                className="file-tree-create-option"
                onClick={() => beginNewEntry('file', '')}
              >
                <SFIcon name="doc" className="file-tree-create-icon" />
                <span>New File</span>
              </button>
              <button
                className="file-tree-create-option"
                onClick={() => beginNewEntry('folder', '')}
              >
                <SFIcon name="folder" className="file-tree-create-icon" />
                <span>New Folder</span>
              </button>
              {STORY_FOLDER_PRESETS.map(preset => (
                <button
                  key={preset.key}
                  className="file-tree-create-option"
                  onClick={() => {
                    void createStoryFolder(preset.key, '')
                  }}
                >
                  <SFIcon name={preset.folderIcon} className="file-tree-create-icon" />
                  <span>{preset.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {view === 'projects' && (
        <>
          {isAddingProject && (
            <div className="new-file-input">
              <input
                autoFocus
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleNewProject()
                  }
                }}
                onBlur={() => {
                  if (!newProjectName.trim()) setIsAddingProject(false)
                }}
                placeholder="Project name..."
              />
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
                    <SFIcon name="folder" className="file-item-icon" />
                    {isRenamingProject ? (
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
                        style={{ marginLeft: 4, minWidth: 80 }}
                      />
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
            {isAddingEntry && newEntryParent === '' && (
              <div className="new-file-input">
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
                  placeholder={newEntryType === 'folder' ? 'Folder name...' : 'File name...'}
                />
              </div>
            )}
            {(orderedRoot.children || []).length === 0 ? (
              <div className="file-tree-empty">No files yet.</div>
            ) : (
              <AnimatePresence initial={false}>
                {(orderedRoot.children || []).map(child => renderNode(child, 0, orderedRoot.children || []))}
                {dragInsert && dragInsert.parentPath === '' && dragInsert.index === (orderedRoot.children || []).length ? (
                  <MotionDiv
                    className="file-drop-slot"
                    style={{ marginLeft: '10px' }}
                    initial={prefersReducedMotion ? false : { height: 0, opacity: 0, scaleY: 0.5 }}
                    animate={prefersReducedMotion ? undefined : { height: DRAG_SLOT_HEIGHT, opacity: 1, scaleY: 1 }}
                    exit={prefersReducedMotion ? undefined : { height: 0, opacity: 0, scaleY: 0.5 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                  >
                    <div className="file-drop-slot-inner" />
                  </MotionDiv>
                ) : null}
              </AnimatePresence>
            )}
          </MotionDiv>
        </>
      )}

      <AnimatePresence>
        {entryMenu ? (
          <MotionDiv
            ref={entryMenuRef}
            className="file-entry-floating-menu"
            style={{
              left: `${entryMenu.left}px`,
              top: `${entryMenu.top}px`,
            }}
            initial={prefersReducedMotion ? false : { opacity: 0, x: -4, y: '-50%', scale: 0.96 }}
            animate={prefersReducedMotion ? undefined : { opacity: 1, x: 0, y: '-50%', scale: 1 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0, x: -4, y: '-50%', scale: 0.96 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            <div className="file-entry-floating-title">
              {entryMenu.type === 'folder' ? 'Folder' : 'Document'}
            </div>
            <div className="file-entry-floating-name">{entryMenu.name}</div>
            <div className="file-entry-floating-placeholder">Options coming soon</div>
          </MotionDiv>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {dragPreview ? (
          <MotionDiv
            className="file-tree-drag-ghost"
            initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.94, rotate: -3 }}
            animate={prefersReducedMotion ? undefined : { opacity: 1, scale: 1, rotate: -2 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.94, rotate: -4 }}
            style={{
              left: dragPreview.x + 14,
              top: dragPreview.y + 12,
            }}
          >
            <SFIcon
              name={dragPreview.iconName}
              filled={dragPreview.iconFilled}
              className="file-item-icon"
            />
            <span className="file-tree-drag-ghost-label">{dragPreview.name}</span>
          </MotionDiv>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
