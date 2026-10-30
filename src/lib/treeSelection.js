/**
 * treeSelection.js — choosing several rows in the left sidebar's lists (the file tree
 * and the Book navigator), the way Finder does.
 *
 * A click chooses one row; ⌘-click adds or takes away one; ⇧-click chooses everything
 * from the anchor (the last row clicked without ⇧) to the row, in the order the rows
 * are shown, and ⌘⇧-click adds that run to what is chosen. Rows are named by an id
 * the list gives them; the list hands over its shown order.
 */

/**
 * The selection after a click on `id`.
 *
 * @param {{ selection: Set<string>, anchor: string | null }} current
 * @param {string} id
 * @param {string[]} order  every row's id, in the order shown
 * @param {{ toggle?: boolean, range?: boolean }} keys  ⌘ (or Ctrl) and ⇧ held
 * @returns {{ selection: Set<string>, anchor: string | null }}
 */
export function clickRow({ selection, anchor }, id, order, { toggle = false, range = false } = {}) {
  if (range && anchor != null && order.includes(anchor) && order.includes(id)) {
    const from = order.indexOf(anchor)
    const to = order.indexOf(id)
    const run = order.slice(Math.min(from, to), Math.max(from, to) + 1)
    // The anchor stays where it was, so a second ⇧-click re-draws the run from it.
    return { selection: new Set(toggle ? [...selection, ...run] : run), anchor }
  }
  if (toggle) {
    const next = new Set(selection)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return { selection: next, anchor: id }
  }
  return { selection: new Set([id]), anchor: id }
}

/** The selection without the rows that are gone; the same Set when none are. */
export function pruneSelection(selection, present) {
  const has = present instanceof Set ? (id) => present.has(id) : (id) => present.includes(id)
  if ([...selection].every(has)) return selection
  return new Set([...selection].filter(has))
}

/** Two selections with the same rows. */
export const sameSelection = (a, b) => a.size === b.size && [...a].every((id) => b.has(id))

/** A file-tree row's id: what fileTreeNodeState calls its `nodeId`. */
export const entryId = (node) => `${node.type}:${node.path}`

/** The entry an id names. */
export const entryOf = (id) => {
  const at = id.indexOf(':')
  return { type: id.slice(0, at), path: id.slice(at + 1) }
}

/** Every row the file tree shows, in order: inside open folders only. */
export function visibleEntryIds(root, expanded, into = []) {
  for (const child of root?.children || []) {
    into.push(entryId(child))
    if (child.type === 'folder' && expanded.has(child.path)) visibleEntryIds(child, expanded, into)
  }
  return into
}

/** Every row in the tree, open folders or not, in order. */
export const allEntryIds = (root) => visibleEntryIds(root, { has: () => true })
