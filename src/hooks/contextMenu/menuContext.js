/**
 * menuContext.js — the shared state one right-click needs.
 *
 * The right-click handler is split into one module per menu branch (canvas, editor,
 * file tree, tab, common). Everything the branches read in common is assembled here
 * once: the Tauri menu classes, the accumulating item list, the document helpers, and
 * the DOM targets under the pointer.
 *
 * The targets are resolved here rather than inside the file-tree branch because
 * `fileItem` reaches beyond it — the canvas and editor branches both key off it.
 */
import { confirm } from '@tauri-apps/plugin-dialog'
import { getEntryFilePath, listProjectTree } from '../../lib/FileSystem'
import { moveEntry } from '../../lib/entryOperations'
import { getDocDisplayName } from '../../lib/docKind'

export async function createMenuContext(e, props) {
  const { projectName, refreshFiles } = props
  const { Menu, MenuItem, PredefinedMenuItem, Submenu } = await import('@tauri-apps/api/menu')
  const items = []

  const confirmDelete = async (message) => {
    try {
      return await confirm(message)
    } catch {
      return false
    }
  }

  /* ---------- shared document actions ---------- */

  const copyText = async (text) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch (err) {
      console.warn('Failed to copy to clipboard:', err)
    }
  }

  const revealEntry = async (entryPath, type = 'file') => {
    try {
      const absolute = await getEntryFilePath(projectName, entryPath, type)
      const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
      await revealItemInDir(absolute)
    } catch (err) {
      console.warn('Failed to reveal entry:', err)
    }
  }

  const beginRename = (entryPath, entryType, entryName, entryParent) => {
    // FileTree owns renaming — it renames in place, in the tree.
    window.dispatchEvent(
      new CustomEvent('filetree:new-entry', {
        detail: {
          rename: true,
          path: entryPath,
          type: entryType,
          name: entryName,
          parent: entryParent || '',
        },
      })
    )
  }

  const buildCopyPathSubmenu = async (docPath) => Submenu.new({
    text: 'Copy Path',
    items: [
      await MenuItem.new({
        text: 'Copy Name',
        action: () => copyText(getDocDisplayName(docPath)),
      }),
      await MenuItem.new({
        text: 'Copy Project Path',
        action: () => copyText(docPath),
      }),
      await MenuItem.new({
        text: 'Copy Absolute Path',
        action: async () => copyText(await getEntryFilePath(projectName, docPath, 'file')),
      }),
    ],
  })

  /** "Move File to…" lists the project's folders — the destinations that exist. */
  const buildMoveToSubmenu = async (docPath) => {
    const currentParent = docPath.split('/').slice(0, -1).join('/')

    const folders = []
    const walk = (node) => {
      if (!node) return
      if (node.type === 'folder') {
        folders.push(node.path || '')
        ;(node.children || []).forEach(walk)
      }
    }

    try {
      walk(await listProjectTree(projectName))
    } catch (err) {
      console.warn('Failed to list folders for move:', err)
    }

    const destinations = folders.filter(folderPath => folderPath !== currentParent)

    const moveItems = destinations.length
      ? await Promise.all(destinations.map(folderPath => MenuItem.new({
        text: folderPath || 'Project Root',
        action: async () => {
          await moveEntry(projectName, docPath, folderPath, 'file')
          await refreshFiles?.()
        },
      })))
      : [await MenuItem.new({ text: 'No other folders', enabled: false })]

    return Submenu.new({ text: 'Move File to…', items: moveItems })
  }

  const fileTree = e.target.closest('.file-tree')
  const leftSidebar = e.target.closest('.left-sidebar')
  const fileTreeEl = fileTree || leftSidebar?.querySelector('.file-tree')
  const treeView = fileTreeEl?.getAttribute('data-view')
  const fileItem = e.target.closest('.file-item')
  const projectItem = e.target.closest('.file-item.project')
  const isFileTreeArea = fileTree || leftSidebar

  return {
    ...props,
    e,
    items,
    Menu,
    MenuItem,
    PredefinedMenuItem,
    Submenu,
    confirmDelete,
    copyText,
    revealEntry,
    beginRename,
    buildCopyPathSubmenu,
    buildMoveToSubmenu,
    fileTree,
    leftSidebar,
    fileTreeEl,
    treeView,
    fileItem,
    projectItem,
    isFileTreeArea,
  }
}
