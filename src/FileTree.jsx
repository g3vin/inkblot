import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  listProjects,
  createProject,
  listProjectTree,
  saveDocument,
  createFolder,
  moveEntry,
} from './FileSystem'
import SFIcon from './SFIcon'

const ORDER_PREFIX = 'inkblot-order:'
const EXPANDED_PREFIX = 'inkblot-expanded:'

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
  const dragDebug = true
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
  const [dragOverPath, setDragOverPath] = useState(null)
  const [dragInsert, setDragInsert] = useState(null)
  const [dragOverFolder, setDragOverFolder] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const manualDragRef = useRef(null)
  const manualDragActiveRef = useRef(false)
  const dragInsertRef = useRef(null)
  const dragOverFolderRef = useRef(null)

  const refreshProjects = useCallback(async () => {
    const list = await listProjects()
    setProjects(list)
  }, [])

  useEffect(() => {
    if (!dragDebug) return
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
  }, [dragDebug])

  const refreshTree = useCallback(async () => {
    if (!projectName) return
    const nextOrder = loadOrder(projectName)
    const rawTree = await listProjectTree(projectName)
    const orderedTree = applyOrderToTree(rawTree, nextOrder)
    saveOrder(projectName, nextOrder)
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
    setExpanded(new Set(loadExpanded(projectName)))
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

  // Listen for new entry or rename events
  useEffect(() => {
    const handler = (event) => {
      const detail = event?.detail || {}
      if (detail.rename && detail.path && detail.type && detail.name !== undefined) {
        setRenamingEntry({ path: detail.path, type: detail.type, oldName: detail.name, parent: detail.parent || '' })
        setRenameValue(detail.name)
        setIsAddingEntry(false)
        return
      }
      setView('files')
      setNewEntryType(detail.type || 'file')
      setNewEntryParent(detail.parent || '')
      setNewEntryName('')
      setIsAddingEntry(true)
    }
    window.addEventListener('filetree:new-entry', handler)
    return () => window.removeEventListener('filetree:new-entry', handler)
  }, [])

  useEffect(() => {
    setOrder(loadOrder(projectName))
  }, [projectName])

  const updateOrder = (updater) => {
    setOrder(prev => {
      const next = updater({ ...prev })
      saveOrder(projectName, next)
      return next
    })
  }

  const updateExpanded = (updater) => {
    setExpanded(prev => {
      const next = updater(new Set(prev))
      if (projectName) saveExpanded(projectName, Array.from(next))
      return next
    })
  }

  const expandPath = (path) => {
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
  }

  const confirmNewEntry = async () => {
    if (!newEntryName.trim()) return
    const trimmed = newEntryName.trim()
    const path = newEntryParent ? `${newEntryParent}/${trimmed}` : trimmed

    if (newEntryType === 'folder') {
      await createFolder(projectName, path)
    } else {
      await saveDocument(projectName, path, { type: 'doc', content: [] })
    }

    updateOrder(orderState => {
      const folderKey = newEntryParent || ''
      const next = orderState[folderKey] || []
      const itemId = `${newEntryType}:${path}`
      orderState[folderKey] = [...next, itemId]
      return orderState
    })

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

  const moveOrderItem = (itemId, fromFolder, toFolder, targetIndex) => {
    updateOrder(orderState => {
      const fromKey = fromFolder || ''
      const toKey = toFolder || ''

      const fromList = [...(orderState[fromKey] || [])]
      const fromIndex = fromList.indexOf(itemId)
      const filtered = fromList.filter(id => id !== itemId)
      orderState[fromKey] = filtered

      const toList = [...(orderState[toKey] || [])].filter(id => id !== itemId)
      let insertIndex = typeof targetIndex === 'number'
        ? Math.max(0, Math.min(targetIndex, toList.length))
        : toList.length

      if (fromKey === toKey && typeof targetIndex === 'number' && fromIndex !== -1 && fromIndex < targetIndex) {
        insertIndex = Math.max(0, insertIndex - 1)
      }

      if (dragDebug) {
        console.debug('[FileTree] moveOrderItem', { itemId, fromKey, toKey, fromIndex, targetIndex, insertIndex, fromList, toList })
      }

      toList.splice(insertIndex, 0, itemId)
      orderState[toKey] = toList

      return orderState
    })
  }

  const performMove = useCallback(async ({ path, type }, targetFolder, targetIndex) => {
    const fromParent = getParentPath(path)

    if (type === 'folder' && targetFolder.startsWith(`${path}/`)) return

    let nextPath = path

    if (dragDebug) {
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

    if (dragDebug) {
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
        if (dragDebug) {
          console.debug('[FileTree] manual drag start', drag)
        }
      }
      updateManualDrag(event.clientX, event.clientY)
    }

    const onUp = async () => {
      const drag = manualDragRef.current
      if (!drag) return
      if (manualDragActiveRef.current) {
        const insert = dragInsertRef.current
        const folder = dragOverFolderRef.current
        const targetFolder = folder || (insert ? insert.parentPath : getParentPath(drag.path))
        const targetIndex = insert ? insert.index : undefined
        if (dragDebug) {
          console.debug('[FileTree] manual drop', { drag, targetFolder, targetIndex, dragInsert, dragOverFolder })
        }
        await performMove({ path: drag.path, type: drag.type }, targetFolder, targetIndex)
      }

      manualDragRef.current = null
      manualDragActiveRef.current = false
      setIsDragging(false)
      setDragOverPath(null)
      setDragInsert(null)
      setDragOverFolder(null)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragDebug, dragInsert, dragOverFolder, performMove, updateManualDrag])

  // Handle rename confirm
  const handleRenameConfirm = useCallback(async () => {
    if (!renamingEntry) return
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === renamingEntry.oldName) {
      setRenamingEntry(null)
      setRenameValue('')
      return
    }
    const { renameEntry } = await import('./FileSystem')
    const { path, type } = renamingEntry
    await renameEntry(projectName, path, trimmed, type)
    setRenamingEntry(null)
    setRenameValue('')
    await refreshTree()
  }, [renamingEntry, renameValue, projectName, refreshTree])

  const renderNode = (node, depth = 0, siblings = []) => {
    if (!node) return null
    const isFolder = node.type === 'folder'
    const isExpanded = expanded.has(node.path)
    const isPrimary = currentDoc === node.path
    const isActive = activeDoc ? activeDoc === node.path : isPrimary
    const isSecondary = splitView === 'editor' && secondaryDoc === node.path
    const parentPath = getParentPath(node.path)
    const showInlineInput =
      isAddingEntry && newEntryParent === node.path && (isFolder || newEntryParent)
    const siblingIndex = siblings.findIndex(child => child.path === node.path && child.type === node.type)
    const showInsertLine = dragInsert && dragInsert.parentPath === parentPath && dragInsert.index === siblingIndex
    const showInsertAfterLast =
      dragInsert && dragInsert.parentPath === parentPath && dragInsert.index === siblings.length && siblingIndex === siblings.length - 1

    const isRenaming = renamingEntry && renamingEntry.path === node.path && renamingEntry.type === node.type
    return (
      <div key={`${node.type}:${node.path}`}>
        {showInsertLine && (
          <div
            className="file-drop-indicator"
            style={{ marginLeft: `${10 + depth * 12}px` }}
          />
        )}
        <div
          className={`file-item${isFolder ? ' folder' : ''}${isPrimary ? ' active' : ''}${isSecondary ? ' secondary' : ''}${dragOverPath === node.path ? ' drag-over' : ''}`}
          data-entry-type={node.type}
          data-entry-path={node.path}
          data-entry-parent={parentPath}
          data-entry-index={siblingIndex}
          onMouseDown={(e) => {
            e.preventDefault()
            if (e.button !== 0) return
            manualDragRef.current = { path: node.path, type: node.type, startX: e.clientX, startY: e.clientY }
            manualDragActiveRef.current = false
            dragInsertRef.current = null
            dragOverFolderRef.current = null
          }}
          onClick={() => {
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
          style={{ paddingLeft: `${10 + depth * 12}px` }}
        >
          <SFIcon
            name={isFolder ? (isExpanded ? 'folder.fill' : 'folder') : 'doc'}
            filled={!isFolder && isActive}
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
        </div>

        {showInsertAfterLast && (
          <div
            className="file-drop-indicator"
            style={{ marginLeft: `${10 + depth * 12}px` }}
          />
        )}

        {isFolder && isExpanded && (
          <div
            className="file-children"
            data-parent-path={node.path}
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
          </div>
        )}
      </div>
    )
  }

  const orderedRoot = useMemo(() => {
    const result = applyOrderToTree(tree, { ...order })
    if (dragDebug) {
      console.debug('[FileTree] orderedRoot computed', { order, rootChildren: result.children?.map(c => c.path) })
    }
    return result
  }, [tree, order])

  useEffect(() => {
    if (!projectName) return
    if (currentDoc) expandPath(getParentPath(currentDoc))
    if (splitView === 'editor' && secondaryDoc) expandPath(getParentPath(secondaryDoc))
  }, [projectName, currentDoc, secondaryDoc, splitView])

  return (
    <div
      className={`file-tree${isDragging ? ' dragging' : ''}`}
      data-view={view}
      onDragEnter={(e) => {
        if (dragDebug) {
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
        if (dragDebug) {
          console.debug('[FileTree] capture dragover', {
            target: e.target?.className || e.target?.tagName,
          })
        }
      }}
      onDropCapture={(e) => {
        if (dragDebug) {
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

        <button
          className="file-tree-add"
          onClick={() => {
            if (view === 'projects') {
              setIsAddingProject(true)
              return
            }
            setNewEntryType('file')
            setNewEntryParent('')
            setNewEntryName('')
            setIsAddingEntry(true)
          }}
          aria-label={view === 'projects' ? 'New project' : 'New file'}
          title={view === 'projects' ? 'New project' : 'New file'}
        >
          <SFIcon name="plus" />
        </button>
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
            {projects.map(project => (
              <div
                key={project}
                className="file-item project"
                data-project-name={project}
                onClick={() => handleSelectProject(project)}
              >
                <SFIcon name="folder" className="file-item-icon" />
                <span className="file-item-label">{project}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {view === 'files' && (
        <>
          <div className="file-list">
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
            {(orderedRoot.children || []).map(child => renderNode(child, 0, orderedRoot.children || []))}
            {dragInsert && dragInsert.parentPath === '' && dragInsert.index === (orderedRoot.children || []).length && (
              <div className="file-drop-indicator" style={{ marginLeft: '10px' }} />
            )}
          </div>
        </>
      )}
    </div>
  )
}