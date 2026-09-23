/**
 * anchors.ts — turning a `TextAnchor` back into a place in a live document.
 *
 * A ProseMirror position is invalidated by every edit, and across a process boundary
 * the holder does not see the edits. So everything the protocol carries names its
 * place by position *and* by the text that position covered (`TextAnchor`), and this
 * is where the two are reconciled.
 *
 * `resolveAnchor` verifies before it trusts: the stored positions are used only if
 * they still cover the anchor's text; otherwise the text is searched for; and if the
 * text is gone the answer is null. Null is a real outcome every caller must handle — a
 * note whose words were deleted has lost what it was about, and a guessed position
 * would put the caret somewhere wrong with no signal that anything went wrong.
 *
 * Every place in the app that turns a stored range back into a selection (jumping to
 * a note, a Workbench tile, a search result) goes through here.
 */
import type { TextAnchor } from '../types'
import { isEditorReady } from '../lib/editorUtils'

/** The subset of a TipTap editor this module needs, so a test can supply a fake. */
export interface AnchorDoc {
  textBetween(from: number, to: number, blockSeparator?: string, leafText?: string): string
  descendants(f: (node: { isText: boolean; text?: string }, pos: number) => boolean | void): void
  content: { size: number }
}

export interface AnchorEditor {
  state: { doc: AnchorDoc }
}

export interface ResolvedRange {
  from: number
  to: number
}

/**
 * Find `needle` in the document, returning the first occurrence.
 *
 * **It only matches inside a single text node**, which is the same limitation both
 * hand-rolled versions have and is kept on purpose. A mark boundary splits a text node,
 * so "she *hesitated*" is two nodes and a search for `she hesitated` does not find it.
 * Fixing that means walking the document as one string and mapping offsets back to
 * positions — which is a real piece of work, and a different one from this phase. It is
 * written down here so the next person meets it as a known limitation and not as a
 * mystery.
 */
export function findText(doc: AnchorDoc, needle: string): ResolvedRange | null {
  if (!needle) return null

  let found: ResolvedRange | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (!node.isText || !node.text) return
    // `indexOf` counts UTF-16 code units, which is what a ProseMirror position counts.
    const index = node.text.indexOf(needle)
    if (index === -1) return
    found = { from: pos + index, to: pos + index + needle.length }
    return false
  })

  return found
}

/** Whether `from..to` still covers exactly the anchor's text. */
export function anchorStillCovers(doc: AnchorDoc, anchor: TextAnchor): boolean {
  const { from, to, text } = anchor
  if (!Number.isFinite(from) || !Number.isFinite(to)) return false
  if (from < 0 || to > doc.content.size || from > to) return false
  // A caret carries no text, so there is nothing to verify — only to bound.
  if (!text) return from === to
  return doc.textBetween(from, to, '\n', '\n') === text
}

export interface ResolveOptions {
  /**
   * Try the anchor's own positions first. False for an anchor whose positions were
   * never meaningful in this document — a hit found by scanning a file on disk.
   */
  preferPositions?: boolean
}

/**
 * Where this anchor is in this document now, or null if its text is gone.
 *
 * The order is: trust the positions if they still cover the text, otherwise search for
 * the text, otherwise give up. Giving up is a real outcome and callers must handle it —
 * a note whose text was deleted has genuinely lost what it was about, and putting the
 * caret at a guessed position is worse than doing nothing.
 */
export function resolveAnchor(
  editor: unknown,
  anchor: TextAnchor,
  options: ResolveOptions = {}
): ResolvedRange | null {
  if (!isEditorReady(editor)) return null
  const { preferPositions = true } = options
  const doc = (editor as AnchorEditor).state.doc

  if (preferPositions && anchorStillCovers(doc, anchor)) {
    return { from: anchor.from, to: anchor.to }
  }

  return findText(doc, anchor.text)
}

/**
 * Read an anchor out of a live document — the other direction, and the only way one
 * should ever be built.
 *
 * Building a `TextAnchor` by hand from a pair of positions is how an anchor with no
 * text in it gets onto the bridge, and an anchor with no text is a bare position
 * wearing a costume: it resolves by trusting numbers nobody checked.
 */
export function readAnchor(editor: unknown, from: number, to: number): TextAnchor | null {
  if (!isEditorReady(editor)) return null
  const doc = (editor as AnchorEditor).state.doc
  const size = doc.content.size
  const clampedFrom = Math.max(0, Math.min(from, size))
  const clampedTo = Math.max(clampedFrom, Math.min(to, size))

  return {
    from: clampedFrom,
    to: clampedTo,
    text: clampedTo > clampedFrom ? doc.textBetween(clampedFrom, clampedTo, '\n', '\n') : '',
  }
}

/** The anchor for whatever is selected right now. */
export function readSelectionAnchor(editor: unknown): TextAnchor | null {
  if (!isEditorReady(editor)) return null
  const { from, to } = (editor as { state: { selection: { from: number; to: number } } }).state.selection
  return readAnchor(editor, from, to)
}
