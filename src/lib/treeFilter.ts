/**
 * treeFilter.ts — what the filter bar under the file tree narrows it to, as Xcode's
 * navigator filter does (TreeFilter.swift): the rows that match, with the folders
 * they are in.
 *
 * A folder whose own name matches keeps what is in it, so typing a folder's name
 * shows its contents. Matching ignores case and accents, as Finder's does. With
 * nothing filtered the tree comes back as it was.
 */
import { getDocKind } from './docKind'

export type TreeKind = 'all' | 'documents' | 'canvases' | 'maps'

export interface TreeFilter {
  text: string
  kind: TreeKind
  /** Only files opened lately — the clock button. */
  recentOnly: boolean
}

export interface FilterNode {
  type: 'file' | 'folder'
  name: string
  path: string
  children?: FilterNode[]
}

export const EMPTY_FILTER: TreeFilter = { text: '', kind: 'all', recentOnly: false }

export const TREE_KINDS: { value: TreeKind; label: string }[] = [
  { value: 'all', label: 'All files' },
  { value: 'documents', label: 'Documents' },
  { value: 'canvases', label: 'Canvases' },
  { value: 'maps', label: 'Maps' },
]

const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase()

export const isFilterActive = (filter: TreeFilter) =>
  filter.text.trim() !== '' || filter.kind !== 'all' || filter.recentOnly

/** The name a document is shown under: its file name without the kind's suffix. */
export function displayName(path: string): string {
  const leaf = path.split('/').pop() ?? path
  return leaf.replace(/\.(canvas|map)$/, '')
}

function kindPasses(kind: TreeKind, path: string): boolean {
  const docKind = getDocKind(path)
  switch (kind) {
    case 'documents': return docKind === 'text'
    case 'canvases': return docKind === 'canvas'
    case 'maps': return docKind === 'map'
    default: return true
  }
}

export function applyTreeFilter<T extends FilterNode>(root: T, filter: TreeFilter, recent: Iterable<string> = []): T {
  if (!root || !isFilterActive(filter)) return root
  const query = fold(filter.text.trim())
  const recentSet = new Set(recent)
  const matches = (name: string) => !query || fold(name).includes(query)

  const filtered = (nodes: T[], folderMatched: boolean): T[] => nodes.flatMap((node) => {
    if (node.type === 'folder') {
      const matched = folderMatched || matches(node.name)
      const children = filtered((node.children ?? []) as T[], matched)
      return children.length ? [{ ...node, children }] : []
    }
    if (!folderMatched && !matches(displayName(node.path))) return []
    if (filter.recentOnly && !recentSet.has(node.path)) return []
    return kindPasses(filter.kind, node.path) ? [node] : []
  })

  return { ...root, children: filtered((root.children ?? []) as T[], false) }
}

/** Every folder in a tree, for showing a filtered tree fully open. */
export function folderPaths(root: FilterNode): Set<string> {
  const paths = new Set<string>([''])
  const walk = (node: FilterNode) => {
    if (node.type !== 'folder') return
    paths.add(node.path)
    for (const child of node.children ?? []) walk(child)
  }
  walk(root)
  return paths
}
