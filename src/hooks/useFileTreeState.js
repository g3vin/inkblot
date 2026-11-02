/**
 * useFileTreeState — what the file tree shows and keeps for a project: the project
 * list, the project's tree, its manual order and which folders are open, each read
 * when the project opens and saved per project (fileTreeState.js) when it changes.
 *
 * The setters for `tree`/`treeFor` and `expanded` are returned for FileTree's own
 * transitions (recalling a project's last tree, remapping a renamed folder). The refs
 * hold the latest order and expanded set for updaters that run outside a render.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { listProjects } from '../lib/FileSystem'
import { refreshLocks } from '../lib/docLocks'
import { applyOrderToTree, collectFolderPaths } from '../lib/fileTreeOrder'
import { loadExpanded, loadOrder, saveExpanded, saveOrder } from '../lib/fileTreeState'
import { readProjectTree, recallProjects, recallTree, rememberProjects, rememberTree } from '../lib/projectPrefetch'
import { FILETREE_FOLDERS_VISIBILITY, FILETREE_REFRESH_PROJECTS } from '../lib/appEvents'

export function useFileTreeState({ projectName, registerRefreshFiles }) {
  const [projects, setProjects] = useState(() => recallProjects()?.names ?? null)
  // A project opened before this session shows the tree it last had at once; the read
  // below then brings it up to date. `treeFor` is whose tree is showing.
  const [tree, setTree] = useState(() => recallTree(projectName) ?? { type: 'folder', name: '', path: '', children: [] })
  const [treeFor, setTreeFor] = useState(() => (recallTree(projectName) ? projectName : ''))
  const [expanded, setExpanded] = useState(new Set(['']))
  const [order, setOrder] = useState({})
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
    window.addEventListener(FILETREE_REFRESH_PROJECTS, handler)
    return () => window.removeEventListener(FILETREE_REFRESH_PROJECTS, handler)
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

    window.addEventListener(FILETREE_FOLDERS_VISIBILITY, handler)
    return () => window.removeEventListener(FILETREE_FOLDERS_VISIBILITY, handler)
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

  return {
    projects, tree, setTree, treeFor, setTreeFor, expanded, setExpanded, expandedRef, order, orderRef,
    refreshProjects, refreshTree, updateOrder, updateExpanded, expandPath,
  }
}
