/**
 * fileTreeOrder.js — the ordering algebra behind the file tree.
 *
 * The tree is user-sortable, so its order is stored per project as a map of
 * folder path to child list. These functions keep that map consistent when
 * entries are renamed, moved between folders, or deleted.
 *
 * Deliberately pure: no React, no filesystem, no localStorage. Callers hand in
 * the order map and get a new one back.
 */
export const getParentPath = (path = '') => path.split('/').slice(0, -1).join('/')

/* ----------------------------------------------------------------------------
   Manual ordering. Each folder maps to an ordered list of "type:path" ids;
   entries missing from the stored order are appended, stale ids are dropped.
---------------------------------------------------------------------------- */

export const ensureOrder = (order, folderPath, children) => {
  const folderKey = folderPath || ''
  const ids = children.map(child => `${child.type}:${child.path}`)
  const existing = order[folderKey] || []
  const filtered = existing.filter(id => ids.includes(id))
  const missing = ids.filter(id => !filtered.includes(id))
  const next = [...filtered, ...missing]
  const changed = existing.length !== next.length || existing.some((id, idx) => id !== next[idx])
  return { next, changed }
}

/** Recursively sort a tree's children by the stored manual order (unknown items last, A→Z). */
export const applyOrderToTree = (node, order) => {
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

/** Rewrite order keys/ids after a folder moves or is renamed (fromPath → toPath). */
export const remapOrderForFolder = (orderState, fromPath, toPath) => {
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

/** Rewrite order ids after any entry rename (delegates to the folder variant for folders). */
export const remapOrderForEntry = (orderState, type, fromPath, toPath) => {
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

/** Rewrite expanded-folder paths after a folder moves or is renamed. */
export const remapExpandedForFolder = (expandedSet, fromPath, toPath) => {
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

export const collectFolderPaths = (node) => {
  const paths = []

  const visit = (entry) => {
    if (!entry || entry.type !== 'folder') return
    if (entry.path) paths.push(entry.path)
    ;(entry.children || []).forEach(visit)
  }

  visit(node)
  return paths
}
