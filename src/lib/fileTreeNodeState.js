/**
 * fileTreeNodeState.js — everything a file-tree row needs to know about itself.
 *
 * FileTree's renderNode opens with ~20 derived constants before it emits any markup:
 * which of four highlight states the row is in, which icon and whether it is filled,
 * whether a drop indicator belongs above it or below it, whether it is being renamed
 * or dragged. That block is the part with actual decisions in it, and it was the part
 * no test could reach.
 *
 * Deliberately NOT a <FileNode> component. renderNode reads about two dozen values
 * out of its closure — five pieces of drag state, four refs, three inline-editor
 * renderers, the motion variants — and almost all of them are plumbing for the
 * markup and the handlers rather than for the decisions. A component would turn that
 * closure into a two-dozen-prop interface and move nothing that is hard to follow;
 * the recursion is the easy part. Pulling the derivation out instead leaves the JSX
 * where it reads naturally, and makes the decisions testable on their own.
 *
 * Pure: no React, no DOM, no I/O.
 */
import { getDocDisplayName, getDocKind } from './docKind'
import { getParentPath } from './fileTreeOrder'
import { getStoryFolderPresetForEntry } from './storyStructure'

/**
 * @param node     a tree entry: { type: 'file' | 'folder', name, path, children? }
 * @param context  the tree's current selection, editing and drag state, plus the
 *                 `siblings` array this node sits in (needed for its index, which
 *                 is what the drop indicators are positioned against)
 */
export function deriveFileNodeState(node, context = {}) {
  const {
    activeDoc = null,
    currentDoc = null,
    dragInsert = null,
    dragOverPath = null,
    dragSourceId = null,
    expanded = new Set(),
    isAddingEntry = false,
    newEntryParent = '',
    renamingEntry = null,
    secondaryDoc = null,
    siblings = [],
    splitView = null,
  } = context

  const isFolder = node.type === 'folder'
  const isExpanded = expanded.has(node.path)
  const parentPath = getParentPath(node.path)
  const nodeId = `${node.type}:${node.path}`

  // Four highlight states, and they are not mutually exclusive. `primary` is the
  // document in the main pane; `secondary` is the split pane's; `active` is whichever
  // pane the writer is in, which falls back to primary when nothing is active yet.
  const isPrimary = currentDoc === node.path
  const isActive = activeDoc ? activeDoc === node.path : isPrimary
  const isSecondary = splitView === 'editor' && secondaryDoc === node.path

  const storyPreset = getStoryFolderPresetForEntry(node.path, node.type)
  const kind = isFolder ? null : getDocKind(node.path)
  const isCanvas = kind === 'canvas'
  const iconName = isFolder
    ? (storyPreset?.folderIcon || (isExpanded ? 'folder.fill' : 'folder'))
    : (isCanvas ? 'canvas' : kind === 'map' ? 'map' : null)
  const hasEntryIcon = Boolean(iconName)
  // Only a document's icon fills in — a folder's is already solid when open.
  const iconFilled = !isFolder && isActive && hasEntryIcon

  const showInlineInput =
    isAddingEntry && newEntryParent === node.path && (isFolder || newEntryParent)

  const siblingIndex = siblings.findIndex(
    child => child.path === node.path && child.type === node.type
  )

  // A drop lands *between* two rows, so the indicator is drawn by whichever row the
  // gap sits above — except at the end of a list, where the last row draws it below
  // itself because there is no row after it to take the job.
  const showInsertSlot = Boolean(
    dragInsert && dragInsert.parentPath === parentPath && dragInsert.index === siblingIndex
  )
  const showInsertAfterLast = Boolean(
    dragInsert &&
    dragInsert.parentPath === parentPath &&
    dragInsert.index === siblings.length &&
    siblingIndex === siblings.length - 1
  )

  const isRenaming = Boolean(
    renamingEntry && renamingEntry.path === node.path && renamingEntry.type === node.type
  )

  return {
    dragName: getDocDisplayName(node.name),
    hasEntryIcon,
    iconFilled,
    iconName,
    isActive,
    isCanvas,
    isDragOver: dragOverPath === node.path,
    isDragSource: dragSourceId === nodeId,
    isExpanded,
    isFolder,
    isPrimary,
    isRenaming,
    isSecondary,
    label: isFolder ? node.name : getDocDisplayName(node.name),
    nodeId,
    parentPath,
    showFolderDivider: isFolder && isExpanded,
    showInlineInput,
    showInsertAfterLast,
    showInsertSlot,
    siblingIndex,
    storyPreset,
  }
}
