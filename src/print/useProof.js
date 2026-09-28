/**
 * useProof.js — the proof, read off a pane's Typeset pages while it is on.
 *
 * Once the pages have settled after a change (pagination takes a pass or two), the
 * lines are read (`readParagraphLines`), judged (`analyzeLines`), listed for the
 * inspector's Proof section (the store) and marked on the page. Turned off, or the pane
 * no longer showing live pages, the marks go.
 */
import { useEffect } from 'react'

import { paginationKey } from './PaginationExtension'
import { analyzeLines, proofMarksKey, readParagraphLines, setProofMarks } from './proofIssues'
import { getProofFocus, getProofIssues, setProofIssues, usePrintLayoutStore } from './printLayoutStore'

/** How long after the last change the pages are read. */
const SETTLE_MS = 450

export function useProof({ editor, docPath, active, hyphenLimit = 2 }) {
  usePrintLayoutStore()

  useEffect(() => {
    if (!editor || editor.isDestroyed || !active) return undefined
    let timer = null
    let lastPushes = null
    const run = () => {
      if (editor.isDestroyed) return
      const state = paginationKey.getState(editor.state)
      if (!state?.frame || !state.result) return
      lastPushes = state.pushes
      const issues = analyzeLines(readParagraphLines(editor.view, state.frame), { hyphenLimit })
      setProofIssues(docPath, issues)
      setProofMarks(editor.view, issues, getProofFocus())
    }
    const onTransaction = ({ transaction }) => {
      if (transaction.getMeta(proofMarksKey)) return
      // A caret moving changes nothing on the page.
      if (!transaction.docChanged && paginationKey.getState(editor.state)?.pushes === lastPushes) return
      clearTimeout(timer)
      timer = setTimeout(run, SETTLE_MS)
    }
    editor.on('transaction', onTransaction)
    timer = setTimeout(run, SETTLE_MS)
    return () => {
      clearTimeout(timer)
      editor.off('transaction', onTransaction)
      if (!editor.isDestroyed) setProofMarks(editor.view, [])
      setProofIssues(docPath, [])
    }
  }, [active, docPath, editor, hyphenLimit])

  // A mark picked from the list is outlined.
  const focus = getProofFocus()
  useEffect(() => {
    if (!editor || editor.isDestroyed || !active) return
    const issues = getProofIssues(docPath)
    if (issues.length) setProofMarks(editor.view, issues, focus)
  }, [active, docPath, editor, focus])
}
