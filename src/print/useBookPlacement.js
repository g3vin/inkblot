/**
 * useBookPlacement.js — where a document sits in its book, for a pane that shows it as
 * the book's pages: the book, its contents, the document's entry and how its head is
 * labelled.
 *
 * The chapters are the book folder's documents, read from the tree when the folder
 * changes and again whenever the tree does (`inkblot:book-chapters-changed`, which the
 * controller sends when the shell asks it to refresh them).
 */
import { useEffect, useMemo, useState } from 'react'

import { reconcileBookItems } from './bookItems'
import { bookRows } from './bookRows'
import { listBookChapters } from './compile'
import { bookFolderForScope, getBookSettings, usePrintLayoutStore } from './printLayoutStore'

export const BOOK_CHAPTERS_CHANGED_EVENT = 'inkblot:book-chapters-changed'

export const useBookPlacement = (projectName, docPath) => {
  const version = usePrintLayoutStore()
  const folder = projectName && docPath ? bookFolderForScope(projectName, docPath) : null
  const [listed, setListed] = useState({ key: '', chapters: null })
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const refresh = () => setRevision((n) => n + 1)
    window.addEventListener(BOOK_CHAPTERS_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(BOOK_CHAPTERS_CHANGED_EVENT, refresh)
  }, [])

  const key = `${projectName}:${folder}:${revision}`
  useEffect(() => {
    if (folder === null) return undefined
    let live = true
    listBookChapters(projectName, folder)
      .then((chapters) => { if (live) setListed({ key, chapters }) })
      .catch(() => {})
    return () => { live = false }
  }, [folder, key, projectName])

  return useMemo(() => {
    if (folder === null || !listed.chapters) return null
    const book = getBookSettings(projectName, folder)
    const items = reconcileBookItems(book, listed.chapters, folder)
    const rows = bookRows(items, book.chapterNumbering)
    const row = rows.find((r) => r.path === docPath) || null
    return { folder, book, items, rows, row, chapters: listed.chapters }
  }, [docPath, folder, listed, projectName, version]) // eslint-disable-line react-hooks/exhaustive-deps -- `version` re-reads the book settings from the store
}
