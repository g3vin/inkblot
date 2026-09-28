/**
 * useBubbleSessions — opening the bubble editor on a sentence, and writing it back.
 *
 * One session is open at a time. It is opened on a selection or a whole paragraph (a new
 * session; a paragraph starts as one bubble per sentence) or on a
 * session already in the document (its chip, or the context menu with the caret in its
 * sentence). Closing writes the arranged sentence over the one it came from, in one
 * transaction — so ⌘Z in the document undoes the whole thing:
 *
 *   - Done keeps the session: the new sentence carries the `bubbleSession` mark with
 *     the session in it, set-aside words and all.
 *   - Archive takes it off the sentence, which stays as written, and puts it in the
 *     document's archive (`lib/archiveStore.js`) — forms, set-aside words and all. The
 *     History panel's archive can put it back (`restoreArchivedBubble`).
 *
 * `open` is what EditorLayout renders `BubbleEditor` from.
 *
 * A new session holds a `TextAnchor` for its sentence until it closes; a reopened one is
 * found by its id, which the mark carries, so it survives any edit in between.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { readAnchor, resolveAnchor } from '../bridge/anchors'
import { isEditorReady } from '../lib/editorUtils'
import { composeSentence, createSession, normalizeSession, reconcileSession } from '../lib/bubbleText'
import { writeBubbleSession } from '../lib/bubbleWrite'
import { BubbleMode } from '../types'
import { BUBBLE_OPEN_EVENT, bubbleSessionAt, findBubbleSession } from '../extensions/BubbleSession'
import { archiveItem } from '../lib/archiveStore'

/** The selection with surrounding whitespace left out, or null if it is not one sentence's worth. */
export const selectionForBubble = (editor) => {
  if (!isEditorReady(editor)) return null
  const { selection, doc } = editor.state
  const { $from, $to } = selection
  // A sentence is inside one paragraph; rewriting across blocks would merge them.
  if (selection.empty || !$from.sameParent($to) || !$from.parent.isTextblock) return null
  const text = doc.textBetween(selection.from, selection.to, ' ')
  const lead = text.length - text.trimStart().length
  const trail = text.length - text.trimEnd().length
  const from = selection.from + lead
  const to = selection.to - trail
  return to > from ? { from, to } : null
}

/**
 * Where `text` is in the document, as positions, if it is there whole inside one block.
 * Walks the block's own children, so an image or a line break in the paragraph does not
 * throw the positions off.
 */
export const findTextInDocument = (doc, text) => {
  if (!text) return null
  let found = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (!node.isTextblock) return true
    let flat = ''
    const starts = []
    node.forEach((child, offset) => {
      const start = pos + 1 + offset
      if (child.isText) {
        for (let index = 0; index < child.text.length; index += 1) starts.push(start + index)
        flat += child.text
      } else {
        // Not text: a gap no sentence runs across.
        starts.push(-1)
        flat += '\uFFFC'
      }
    })
    const at = flat.indexOf(text)
    if (at !== -1) found = { from: starts[at], to: starts[at + text.length - 1] + 1 }
    return false
  })
  return found
}

/**
 * Put an archived session back on its sentence: the sentence as it was archived, if it
 * is still in the document. Returns whether it was.
 */
export const restoreArchivedBubble = (editor, session) => {
  if (!isEditorReady(editor) || !session?.id) return false
  if (findBubbleSession(editor.state.doc, session.id)) return false
  const range = findTextInDocument(editor.state.doc, composeSentence(session.words ?? [], session.original))
  if (!range) return false
  return writeBubbleSession(editor, range, normalizeSession(session), { keep: true })
}

/** The paragraph around the caret, trimmed, or null if there is no text in it. */
export const paragraphForBubble = (editor) => {
  if (!isEditorReady(editor)) return null
  const { selection, doc } = editor.state
  const { $from } = selection
  if (!$from.parent.isTextblock || !$from.sameParent(selection.$to)) return null
  const text = doc.textBetween($from.start(), $from.end(), ' ')
  const from = $from.start() + (text.length - text.trimStart().length)
  const to = $from.end() - (text.length - text.trimEnd().length)
  return to > from ? { from, to } : null
}

export { writeBubbleSession }

const snippet = (text) => (text.length > 80 ? `${text.slice(0, 79).trimEnd()}…` : text)

export function useBubbleSessions({ docPath, projectName }) {
  // { editor, session, anchor } — anchor only for a session not yet in the document.
  const [open, setOpen] = useState(null)
  const openRef = useRef(null)
  const docPathRef = useRef(docPath)
  const projectNameRef = useRef(projectName)
  useEffect(() => {
    docPathRef.current = docPath
    projectNameRef.current = projectName
  }, [docPath, projectName])

  const begin = useCallback((editor, session, anchor) => {
    // The document it is in, for its archive: fixed now, as the writer may switch panes.
    const next = { editor, session, anchor, docPath: docPathRef.current }
    openRef.current = next
    setOpen(next)
  }, [])

  const openSession = useCallback((editor, id) => {
    if (!isEditorReady(editor)) return
    const entry = findBubbleSession(editor.state.doc, id)
    if (!entry) return
    const text = editor.state.doc.textBetween(entry.from, entry.to, ' ')
    const stored = entry.session?.words ? { ...entry.session, id } : { ...createSession(text), id }
    begin(editor, reconcileSession(stored, text), null)
  }, [begin])

  /** The context menu's "Bubble": the session under the selection, or a new one on it. */
  const openFromSelection = useCallback((editor) => {
    if (!isEditorReady(editor)) return
    const { from, to } = editor.state.selection
    const existing = bubbleSessionAt(editor.state.doc, from, to)
    if (existing) {
      openSession(editor, existing.id)
      return
    }
    const range = selectionForBubble(editor)
    if (!range) return
    const anchor = readAnchor(editor, range.from, range.to)
    if (!anchor) return
    begin(editor, createSession(anchor.text), anchor)
  }, [begin, openSession])

  /** The context menu's "Bubble Paragraph": the whole paragraph, a bubble per sentence. */
  const openParagraph = useCallback((editor) => {
    const range = paragraphForBubble(editor)
    if (!range) return
    const existing = bubbleSessionAt(editor.state.doc, range.from, range.to)
    if (existing) {
      openSession(editor, existing.id)
      return
    }
    const anchor = readAnchor(editor, range.from, range.to)
    if (!anchor) return
    begin(editor, createSession(anchor.text, BubbleMode.Sentences), anchor)
  }, [begin, openSession])

  const finish = useCallback((editor, anchor, session, archive, docPath = docPathRef.current) => {
    const entry = anchor ? null : findBubbleSession(editor.state.doc, session.id)
    const range = anchor ? resolveAnchor(editor, anchor) : entry && { from: entry.from, to: entry.to }
    if (!range) {
      console.warn('Bubble: the sentence is no longer in the document; nothing was written.')
      return
    }
    const sentence = composeSentence(session.words, session.original)
    const keep = !archive && sentence !== ''
    writeBubbleSession(editor, range, session, { keep })
    if (archive) {
      archiveItem(projectNameRef.current, docPath, {
        kind: 'bubble',
        title: snippet(sentence || session.original || ''),
        bubble: session,
      })
    }
  }, [])

  const close = useCallback((session, archive) => {
    const current = openRef.current
    if (!current || !session || current.session.id !== session.id) return
    openRef.current = null
    setOpen(null)
    finish(current.editor, current.anchor, normalizeSession(session), archive, current.docPath)
  }, [finish])

  /** Archive a session from the document, without opening it: its text stays as it is. */
  const archiveSession = useCallback((editor, id) => {
    if (!isEditorReady(editor)) return
    const entry = findBubbleSession(editor.state.doc, id)
    if (!entry) return
    const text = editor.state.doc.textBetween(entry.from, entry.to, ' ')
    const session = reconcileSession({ ...(entry.session ?? createSession(text)), id }, text)
    finish(editor, null, normalizeSession(session), true)
  }, [finish])

  useEffect(() => {
    const onOpen = (event) => {
      const { editor, sessionId } = event?.detail || {}
      if (editor && sessionId) openSession(editor, sessionId)
    }
    window.addEventListener(BUBBLE_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(BUBBLE_OPEN_EVENT, onOpen)
  }, [openSession])

  return useMemo(
    () => ({ open, openFromSelection, openParagraph, openSession, archiveSession, close }),
    [open, openFromSelection, openParagraph, openSession, archiveSession, close]
  )
}
