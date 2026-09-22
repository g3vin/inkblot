/**
 * useEditorWordCount — the per-pane word-count badge.
 *
 * Two rates, because they cost different amounts. The selected-word count is read
 * synchronously on every selectionUpdate: it walks only the selected range, and a
 * lagging number under a live drag-select looks broken. The total walks the whole
 * document, so it is debounced.
 *
 * Both write through an equality check rather than setting state outright. A
 * selectionUpdate fires on every arrow key, and a total recount usually produces the
 * same number it did last time; without the check each one re-renders the pane, and
 * the pane holds the editor.
 */
import { useCallback, useEffect, useState } from 'react'
import { debounce } from 'lodash'

import { isEditorReady } from '../lib/editorUtils'

const WORD_COUNT_DEBOUNCE_MS = 300

/** Whitespace-delimited word count. */
const countWords = (text = '') => {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

const emptyWordStats = {
  total: 0,
  selected: null,
}

const areWordStatsEqual = (left, right) => (
  left.total === right.total &&
  left.selected === right.selected
)

const getWordStats = (targetEditor, previousTotal = 0, includeTotal = true) => {
  if (!isEditorReady(targetEditor)) return emptyWordStats

  const { selection, doc } = targetEditor.state
  const selectedText = selection?.empty
    ? ''
    : doc.textBetween(selection.from, selection.to, '\n')

  return {
    total: includeTotal ? countWords(targetEditor.getText()) : previousTotal,
    selected: selection?.empty ? null : countWords(selectedText),
  }
}

export const formatWordStats = ({ total, selected }) => {
  const count = selected == null ? total : selected
  const wordLabel = count === 1 ? 'word' : 'words'
  return selected == null ? `${count} ${wordLabel}` : `${count} ${wordLabel} selected`
}

export function useEditorWordCount({ editor, secondaryEditor, showWordCountBadge, splitView }) {
  const [primaryWordStats, setPrimaryWordStats] = useState(emptyWordStats)
  const [secondaryWordStats, setSecondaryWordStats] = useState(emptyWordStats)

  // Called by the document loader once a pane has a document in it: the badge has to
  // change the moment the pane does, and no editor event fires for a state install.
  const syncWordStats = useCallback((paneId, targetEditor) => {
    const setStats = paneId === 'secondary' ? setSecondaryWordStats : setPrimaryWordStats
    setStats(getWordStats(targetEditor))
  }, [])

  useEffect(() => {
    if (!showWordCountBadge || !isEditorReady(editor)) return

    const updateSelectedCount = () => {
      if (!isEditorReady(editor)) return
      setPrimaryWordStats((current) => {
        const next = getWordStats(editor, current.total, false)
        return areWordStatsEqual(current, next) ? current : next
      })
    }

    const updateTotalCount = debounce(() => {
      if (!isEditorReady(editor)) return
      setPrimaryWordStats((current) => {
        const next = getWordStats(editor)
        return areWordStatsEqual(current, next) ? current : next
      })
    }, WORD_COUNT_DEBOUNCE_MS)

    editor.on('update', updateTotalCount)
    editor.on('selectionUpdate', updateSelectedCount)
    updateTotalCount()

    return () => {
      if (!editor.isDestroyed) {
        editor.off('update', updateTotalCount)
        editor.off('selectionUpdate', updateSelectedCount)
      }
      updateTotalCount.cancel()
    }
  }, [editor, showWordCountBadge])

  useEffect(() => {
    if (!showWordCountBadge || !isEditorReady(secondaryEditor) || splitView !== 'editor') return

    const updateSelectedCount = () => {
      if (!isEditorReady(secondaryEditor)) return
      setSecondaryWordStats((current) => {
        const next = getWordStats(secondaryEditor, current.total, false)
        return areWordStatsEqual(current, next) ? current : next
      })
    }

    const updateTotalCount = debounce(() => {
      if (!isEditorReady(secondaryEditor)) return
      setSecondaryWordStats((current) => {
        const next = getWordStats(secondaryEditor)
        return areWordStatsEqual(current, next) ? current : next
      })
    }, WORD_COUNT_DEBOUNCE_MS)

    secondaryEditor.on('update', updateTotalCount)
    secondaryEditor.on('selectionUpdate', updateSelectedCount)
    updateTotalCount()

    return () => {
      if (!secondaryEditor.isDestroyed) {
        secondaryEditor.off('update', updateTotalCount)
        secondaryEditor.off('selectionUpdate', updateSelectedCount)
      }
      updateTotalCount.cancel()
    }
  }, [secondaryEditor, showWordCountBadge, splitView])

  return { primaryWordStats, secondaryWordStats, syncWordStats }
}
