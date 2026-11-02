/**
 * documentShape.ts — what the open documents look like, without a word of them.
 *
 * Node types and counts, sizes, the selection's offsets and the undo depth: enough to
 * reproduce "the cursor jumped in a long document with a table", nothing that says
 * what the document says. `openDocumentTexts` reads the text for the leak guard,
 * which compares in memory and keeps nothing.
 */
import { redoDepth, undoDepth } from '@tiptap/pm/history'
import { editorRegistry } from '../../bridge/appBridge'
import { EditorTarget } from '../../types'

interface PmNode {
  type: { name: string }
  nodeSize: number
  childCount: number
  textContent: string
  descendants: (visit: (node: PmNode) => boolean | void) => void
  textBetween: (from: number, to: number, blockSeparator?: string, leafText?: string) => string
}

interface PmState {
  doc: PmNode
  selection: { from: number; to: number; empty: boolean; toJSON: () => { type?: string } }
}

const TARGETS = [EditorTarget.Primary, EditorTarget.Secondary, EditorTarget.CanvasCard]

function openEditors() {
  return TARGETS.flatMap((target) => {
    const resolved = editorRegistry.resolve(target)
    const state = (resolved?.editor as { state?: PmState } | undefined)?.state
    return resolved && state ? [{ target, docPath: resolved.docPath, state }] : []
  })
}

const countWords = (text: string): number => text.match(/[\p{L}\p{N}']+/gu)?.length ?? 0

export function documentShapes() {
  return openEditors().map(({ target, docPath, state }) => {
    const nodeTypes: Record<string, number> = {}
    state.doc.descendants((node) => {
      nodeTypes[node.type.name] = (nodeTypes[node.type.name] ?? 0) + 1
    })
    const text = state.doc.textBetween(0, state.doc.nodeSize - 2, '\n', ' ')
    let history: { undo: number; redo: number } | null = null
    try {
      history = { undo: undoDepth(state as never), redo: redoDepth(state as never) }
    } catch {
      // An editor without the history plugin, such as a read-only preview.
    }
    const { from, to, empty } = state.selection
    return {
      target,
      docPath,
      docSize: state.doc.nodeSize,
      topLevelBlocks: state.doc.childCount,
      words: countWords(text),
      chars: text.length,
      nodeTypes,
      // toJSON's type ('text', 'node', 'all'), not the class name, which minifying mangles.
      selection: { from, to, empty, kind: state.selection.toJSON().type ?? null },
      history,
    }
  })
}

/** The open documents' text, for the leak guard only. */
export const openDocumentTexts = (): string[] =>
  openEditors().map(({ state }) => state.doc.textBetween(0, state.doc.nodeSize - 2, '\n', ' '))
