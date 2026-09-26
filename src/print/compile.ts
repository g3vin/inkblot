/**
 * compile.ts — a folder (or a whole project) read as one book.
 *
 * Authors keep a book as a document per chapter, so printing and exporting a book
 * means gathering those documents in the order the author arranged them in the file
 * tree — the same order the tree shows, from the same saved order map — and loading
 * each one's content. Canvases are not chapters and are skipped.
 */
import { BookItemKind } from '../types'
import type { BookItem, BookSettings } from '../types'
import { isTextDoc } from '../lib/docKind'
import { listProjectTree, loadDocument } from '../lib/FileSystem'
import { applyOrderToTree, getParentPath } from '../lib/fileTreeOrder'
import { loadOrder } from '../lib/fileTreeState'
import { nativeOwns } from '../lib/host'
import { refreshPreferenceScope } from '../lib/preferences'
import type { TreeNode } from '../types'
import { isLegacyMatter, itemTitle, reconcileBookItems } from './bookItems'

export type CompileScope = 'document' | 'folder' | 'project'

export interface Chapter {
  /** Tree path of the document. */
  path: string
  /** The document's name, which is the chapter's title unless it opens with an H1. */
  name: string
  /** TipTap JSON. */
  content: { type: 'doc'; attrs?: Record<string, unknown>; content?: unknown[] }
}

/**
 * The folder a scope compiles, for a document: its parent, or the project root. A page
 * of the book's own — kept in the book folder's `.book/` — belongs to that folder.
 */
export const bookFolderFor = (docPath: string | null | undefined, scope: CompileScope): string => {
  if (scope === 'project') return ''
  const parent = getParentPath(docPath || '')
  if (parent === '.book') return ''
  return parent.endsWith('/.book') ? parent.slice(0, -'/.book'.length) : parent
}

const findFolder = (node: TreeNode | null | undefined, path: string): TreeNode | null => {
  if (!node) return null
  if ((node.path || '') === path && node.type === 'folder') return node
  for (const child of node.children || []) {
    const hit = findFolder(child, path)
    if (hit) return hit
  }
  return null
}

const collectFiles = (node: TreeNode | null | undefined, out: string[] = []): string[] => {
  if (!node) return out
  for (const child of node.children || []) {
    if (child.type === 'file') {
      if (isTextDoc(child.path)) out.push(child.path)
    } else {
      collectFiles(child, out)
    }
  }
  return out
}

/** Tree paths of a folder's documents, depth-first in the tree's saved order. */
export const listBookChapters = async (projectName: string, folder: string): Promise<string[]> => {
  // A shell that draws the tree saves its order itself; read what it last saved.
  if (nativeOwns('fileTree')) await refreshPreferenceScope('file-tree')
  const tree = await listProjectTree(projectName)
  const ordered = applyOrderToTree(tree as TreeNode, loadOrder(projectName) || {})
  return collectFiles(findFolder(ordered, folder || ''))
}

const asDoc = (content: unknown): Chapter['content'] => {
  if (content && typeof content === 'object' && (content as { type?: string }).type === 'doc') {
    return content as Chapter['content']
  }
  // Documents written by older builds stored a bare array of blocks.
  return { type: 'doc', content: Array.isArray(content) ? content : [] }
}

/**
 * Load a scope's chapters. `live` supplies the open documents' current content;
 * `excluded` are the chapters the book leaves out.
 */
export const loadChapters = async (
  projectName: string,
  docPath: string,
  scope: CompileScope,
  live: (path: string) => Chapter['content'] | null = () => null,
  { excluded = [] }: { excluded?: string[] } = {}
): Promise<Chapter[]> => {
  // A chapter the book leaves out is still printed on its own.
  const left = new Set(excluded)
  const paths = scope === 'document'
    ? [docPath]
    : (await listBookChapters(projectName, bookFolderFor(docPath, scope))).filter((path) => !left.has(path))
  const chapters: Chapter[] = []
  for (const path of paths) {
    const open = live(path)
    const content = open || asDoc((await loadDocument(projectName, path))?.content)
    chapters.push({ path, name: path.split('/').pop() || path, content })
  }
  return chapters
}

/** One entry of a book as it compiles: its item, and the content it prints. */
export interface BookSection {
  item: BookItem
  /** The document's tree path; empty for a page the book lays out itself. */
  path: string
  /** What it is called: a chapter's document name, a matter page's kind. */
  name: string
  /** TipTap JSON for a chapter or a matter page; null for a part or a generated page. */
  content: Chapter['content'] | null
}

/**
 * A book's contents in book order, less what is hidden, each with its content: the
 * open documents' as they are now (`live`), the rest from disk. A legacy matter page —
 * text from before front and back matter were documents — has none; `bookMatter.ts`
 * sets its text.
 */
export const loadBookSections = async (
  projectName: string,
  folder: string,
  book: Partial<BookSettings> | null | undefined,
  live: (path: string) => Chapter['content'] | null = () => null
): Promise<BookSection[]> => {
  const chapters = await listBookChapters(projectName, folder)
  const items = reconcileBookItems(book || {}, chapters, folder).filter((item) => !item.hidden)
  const sections: BookSection[] = []
  for (const item of items) {
    const path = item.path || ''
    const readable = (item.kind === BookItemKind.Chapter || item.kind === BookItemKind.Matter) && path && !isLegacyMatter(item)
    let content: Chapter['content'] | null = null
    if (readable) {
      content = live(path) || asDoc((await loadDocument(projectName, path))?.content)
    }
    const name = item.kind === BookItemKind.Chapter ? (path.split('/').pop() || path) : itemTitle(item)
    sections.push({ item, path: item.kind === BookItemKind.Part ? '' : path, name, content })
  }
  return sections
}
