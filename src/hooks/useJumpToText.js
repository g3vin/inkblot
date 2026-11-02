/**
 * useJumpToText — taking the writer to a place in a document: a note's text, or a
 * search result in this document, another one, a canvas node or a map item.
 *
 * `jumpToText` selects and scrolls to text in the active editor. `openSearchTarget`
 * opens a result, switching documents first when it must and queueing the jump until
 * the target's editor has mounted.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { resolveAnchor } from '../bridge/anchors'
import { requestCanvasReveal } from '../canvas/canvasEvents'
import { isCanvasDoc, isMapDoc } from '../lib/docKind'
import { requestMapReveal } from '../map/mapEvents'

export function useJumpToText({ activeEditor, editor, activeDoc, currentDoc, setActiveDoc, setCurrentDoc }) {
  const [pendingSearchTarget, setPendingSearchTarget] = useState(null)
  const pendingSearchTargetRef = useRef(null)

  useEffect(() => {
    pendingSearchTargetRef.current = pendingSearchTarget
  }, [pendingSearchTarget])

  // Select and scroll to a note's text in the active editor. Accepts a note object
  // (which carries stored from/to) or a plain anchor string. `resolveAnchor` only
  // trusts the stored positions if they still cover the anchor text.
  const jumpToText = useCallback((noteOrAnchor) => {
    const currentEditor = activeEditor || editor
    if (!currentEditor) return

    const note = typeof noteOrAnchor === 'object' && noteOrAnchor !== null
      ? noteOrAnchor
      : null
    const text = typeof noteOrAnchor === 'string' ? noteOrAnchor : note?.anchor
    if (!text) return

    const range = resolveAnchor(currentEditor, {
      from: Number.isFinite(note?.from) ? note.from : -1,
      to: Number.isFinite(note?.to) ? note.to : -1,
      text,
    })

    // Null means the text is gone. Doing nothing is the right answer: the note has
    // lost what it was about, and a guessed position is worse than no movement.
    if (!range) return

    currentEditor
      .chain()
      .focus()
      .setTextSelection({
        from: range.from,
        to: range.to > range.from ? range.to : range.from,
      })
      .scrollIntoView()
      .run()
  }, [activeEditor, editor])

  // Open a search result: jump immediately if its doc is already open,
  // otherwise switch documents and queue the jump for after the editor loads.
  const openSearchTarget = useCallback((target) => {
    if (!target) return

    const docName = target.docName || activeDoc || currentDoc
    if (!docName) return

    const normalizedTarget = {
      ...target,
      docName,
    }

    // A canvas hit has no document position to jump to — it names a node. Ask for
    // the reveal and switch documents if needed; the canvas claims the request
    // whether it is already mounted or about to be (see canvasEvents).
    if (isCanvasDoc(docName)) {
      if (docName !== activeDoc && docName !== currentDoc) {
        setActiveDoc(docName)
        setCurrentDoc(docName)
      }
      if (normalizedTarget.nodeId) {
        requestCanvasReveal(docName, normalizedTarget.nodeId)
      }
      return
    }

    // A map hit names an item (pin, route, label…) the same way.
    if (isMapDoc(docName)) {
      if (docName !== activeDoc && docName !== currentDoc) {
        setActiveDoc(docName)
        setCurrentDoc(docName)
      }
      if (normalizedTarget.nodeId) {
        requestMapReveal(docName, normalizedTarget.nodeId)
      }
      return
    }

    if (docName === activeDoc || docName === currentDoc) {
      if (normalizedTarget.skipJump) return
      jumpToText(
        normalizedTarget.note || {
          anchor: normalizedTarget.anchor,
          from: normalizedTarget.from,
          to: normalizedTarget.to,
        }
      )
      return
    }

    setActiveDoc(docName)
    setCurrentDoc(docName)
    if (!normalizedTarget.skipJump) {
      setPendingSearchTarget(normalizedTarget)
    }
  }, [activeDoc, currentDoc, jumpToText, setActiveDoc, setCurrentDoc])

  // Complete a queued search jump once the target document's editor is mounted
  // (retries briefly while the editor initializes).
  useEffect(() => {
    if (!pendingSearchTarget || pendingSearchTarget.docName !== currentDoc) return

    let cancelled = false
    let attempts = 0

    const tryJump = () => {
      if (cancelled) return
      const target = pendingSearchTargetRef.current
      if (!target || target.docName !== currentDoc) return

      if (!editor) {
        if (attempts < 8) {
          attempts += 1
          window.setTimeout(tryJump, 80)
        }
        return
      }

      jumpToText(
        target.note || {
          anchor: target.anchor,
          from: target.from,
          to: target.to,
        }
      )
      setPendingSearchTarget(null)
    }

    const timeoutId = window.setTimeout(tryJump, 100)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [currentDoc, editor, jumpToText, pendingSearchTarget])

  return { jumpToText, openSearchTarget }
}
