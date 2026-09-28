/**
 * useTypesetHistory.js — the typeset history, kept as the book is set.
 *
 * A version is kept a while after the typesetting changes (never for a change of words:
 * those are the text history's), whenever the writer saves one, and whenever the book is
 * printed or exported — so what went to the printer can always be had again. Restoring
 * one puts its typesetting back onto the text as it is now, after keeping the typeset
 * being replaced. The book's history is published for the shell's History tab, and the
 * Typeset view can show a version's pages, alone or beside the current ones.
 */
import { useCallback, useEffect, useRef } from 'react'

import { documentSurface } from '../bridge'
import { loadDocument, saveDocument } from '../lib/FileSystem'
import { newItemId, reconcileBookItems } from './bookItems'
import { listBookChapters } from './compile'
import {
  getBookSettings,
  getTypesetPreview,
  setBookSettings,
  setTypesetPreview,
  subscribePrintLayoutStore,
} from './printLayoutStore'
import { TYPESET_META } from './TypesetLock'
import { TYPESET_BLOCKS } from './TypesetAnchors'
import { applyChapterTypeset, restoreBook, sameSnapshot, snapshotOf, typesetDiff } from './typesetHistory'
import { addTypesetEntry, deleteTypesetEntry, onTypesetHistoryChanged, renameTypesetEntry, typesetEntries } from './typesetHistoryStore'

/** How long after the typesetting changes a version is kept. */
export const AUTO_DELAY_MS = 15000

/** Tell the history a print or export was made: `{ label }`. */
export const TYPESET_MILESTONE_EVENT = 'inkblot:typeset-milestone'

/** The Typeset view's preview bar: `{ action: 'restore' | 'done' }`. */
export const TYPESET_PREVIEW_EVENT = 'inkblot:typeset-preview'

/** The chapter documents of a book — chapters and matter pages — with their content now. */
const bookDocuments = async (projectName, folder, liveContent) => {
  const book = getBookSettings(projectName, folder)
  const items = reconcileBookItems(book, await listBookChapters(projectName, folder), folder)
  const out = {}
  for (const item of items) {
    if (!item.path || (item.kind !== 'chapter' && item.kind !== 'matter')) continue
    out[item.path] = liveContent(item.path) || (await loadDocument(projectName, item.path))?.content || null
  }
  return { book, docs: out }
}

/** The typesetting of an editor's document set back, as one undoable, typeset step. */
const applyToEditor = (editor, typeset) => {
  const { state } = editor
  const tr = state.tr
  let orphans = 0
  const found = new Set()
  state.doc.descendants((node, pos) => {
    const id = node.attrs?.typesetId
    if (!id || !(node.type.name in TYPESET_BLOCKS)) return
    const target = typeset?.blocks?.[id]
    if (target) found.add(id)
    for (const key of TYPESET_BLOCKS[node.type.name]) {
      if (!(key in node.attrs)) continue
      const value = target && key in target ? target[key] : (node.type.spec.attrs?.[key]?.default ?? null)
      if (node.attrs[key] !== value) tr.setNodeAttribute(pos, key, value)
    }
  })
  orphans = Object.keys(typeset?.blocks || {}).filter((id) => !found.has(id)).length
  tr.setDocAttribute('pageSetup', typeset?.pageSetup ?? null)
  tr.setDocAttribute('chapter', typeset?.chapter ?? null)
  tr.setMeta(TYPESET_META, true)
  editor.view.dispatch(tr)
  return orphans
}

export default function useTypesetHistory({ stateRef, currentBook, activeEditor: editor }) {
  const timerRef = useRef(null)
  const lastKey = useRef('')
  const noteRef = useRef(null)
  const publishedFolder = useRef(null)

  const liveContent = useCallback((path) => stateRef.current.editorFor?.(path)?.getJSON() || null, [stateRef])

  /** Publish the book's history, newest first. */
  const publish = useCallback(async () => {
    const { project, folder } = currentBook()
    if (!project) return
    publishedFolder.current = folder
    const entries = await typesetEntries(project, folder)
    const preview = getTypesetPreview()
    documentSurface.publishTypesetHistoryChanged({
      folder,
      rows: [...entries].reverse().map(({ id, timestamp, kind, name, summary }) => ({ id, timestamp, kind, name: name || undefined, summary })),
      previewing: preview?.id || undefined,
      comparing: Boolean(preview?.compare),
      note: noteRef.current || undefined,
    })
  }, [currentBook])

  /** Keep the book's typeset now, if it differs from the last kept (or it is asked for). */
  const record = useCallback(async (kind = 'auto', name = null) => {
    const { project, folder } = currentBook()
    if (!project) return null
    const { book, docs } = await bookDocuments(project, folder, liveContent)
    const snapshot = snapshotOf(book, docs)
    const entries = await typesetEntries(project, folder)
    const last = entries[entries.length - 1]
    if (kind === 'auto' && last && sameSnapshot(last.snapshot, snapshot)) return null
    const entry = {
      id: newItemId(),
      timestamp: new Date().toISOString(),
      kind,
      ...(name ? { name } : {}),
      summary: typesetDiff(last?.snapshot, snapshot),
      snapshot,
    }
    await addTypesetEntry(project, folder, entry)
    return entry
  }, [currentBook, liveContent])

  const schedule = useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { record('auto').catch((e) => console.error('[typeset] keeping a version failed:', e)) }, AUTO_DELAY_MS)
  }, [record])

  // A change to the book's typesetting, or a typesetting edit in the open document.
  useEffect(() => {
    const onStore = () => {
      const { project, folder, book } = currentBook()
      if (!project) return
      const { title: _t, author: _a, language: _l, ...typeset } = book
      const key = `${project}:${folder}:${JSON.stringify(typeset)}`
      if (folder !== publishedFolder.current) publish().catch(() => {})
      if (key === lastKey.current) return
      const first = !lastKey.current
      lastKey.current = key
      if (!first) schedule()
    }
    onStore()
    const unsubscribe = subscribePrintLayoutStore(onStore)
    return () => {
      unsubscribe()
      clearTimeout(timerRef.current)
    }
  }, [currentBook, publish, schedule])

  useEffect(() => {
    if (!editor) return undefined
    const onTransaction = ({ transaction }) => { if (transaction.docChanged && transaction.getMeta(TYPESET_META)) schedule() }
    editor.on('transaction', onTransaction)
    return () => editor.off('transaction', onTransaction)
  }, [editor, schedule])

  // A print or an export: what it was made from, kept.
  useEffect(() => {
    const onMilestone = (event) => {
      record('export', event.detail?.label || 'Exported').catch((e) => console.error('[typeset] keeping the export failed:', e))
    }
    window.addEventListener(TYPESET_MILESTONE_EVENT, onMilestone)
    return () => window.removeEventListener(TYPESET_MILESTONE_EVENT, onMilestone)
  }, [record])

  useEffect(() => onTypesetHistoryChanged(() => { publish().catch(() => {}) }), [publish])

  /** Put a version's typesetting back, keeping the one it replaces first. */
  const restore = useCallback(async (id) => {
    const { project, folder } = currentBook()
    if (!project) return
    const entries = await typesetEntries(project, folder)
    const target = entries.find((e) => e.id === id)
    if (!target) return
    await record('restore', `Before restoring ${target.name || 'a version'}`)
    setBookSettings(project, folder, restoreBook(getBookSettings(project, folder), target.snapshot))
    const { docs } = await bookDocuments(project, folder, liveContent)
    let orphans = 0
    for (const path of Object.keys(docs)) {
      const typeset = target.snapshot.chapters[path]
      const editor = stateRef.current.editorFor?.(path)
      if (editor) {
        orphans += applyToEditor(editor, typeset)
        continue
      }
      const saved = await loadDocument(project, path)
      if (!saved?.content) continue
      const { content, orphans: lost } = applyChapterTypeset(saved.content, typeset)
      orphans += lost
      await saveDocument(project, path, { content, notes: saved.notes || [] })
    }
    noteRef.current = orphans
      ? `${orphans} ${orphans === 1 ? 'setting' : 'settings'} had no paragraph or picture left to go to.`
      : null
    setTypesetPreview(null)
    await publish()
  }, [currentBook, liveContent, publish, record, stateRef])

  // The preview's own bar, in the Typeset view.
  useEffect(() => {
    const onPreview = (event) => {
      const preview = getTypesetPreview()
      if (event.detail?.action === 'restore' && preview) restore(preview.id).catch((e) => console.error('[typeset] restoring failed:', e))
      else setTypesetPreview(null)
      publish().catch(() => {})
    }
    window.addEventListener(TYPESET_PREVIEW_EVENT, onPreview)
    return () => window.removeEventListener(TYPESET_PREVIEW_EVENT, onPreview)
  }, [publish, restore])

  // The History tab's commands.
  useEffect(() => {
    const subscriptions = [
      documentSurface.onCommand('saveTypesetVersion', ({ name }) => {
        record('named', name?.trim() || 'Saved').catch((e) => console.error('[typeset] saving a version failed:', e))
      }),
      documentSurface.onCommand('restoreTypesetVersion', ({ id }) => {
        restore(id).catch((e) => console.error('[typeset] restoring failed:', e))
      }),
      documentSurface.onCommand('renameTypesetVersion', ({ id, name }) => {
        const { project, folder } = currentBook()
        if (project) renameTypesetEntry(project, folder, id, name)
      }),
      documentSurface.onCommand('deleteTypesetVersion', ({ id }) => {
        const { project, folder } = currentBook()
        if (!project) return
        if (getTypesetPreview()?.id === id) setTypesetPreview(null)
        deleteTypesetEntry(project, folder, id)
      }),
      documentSurface.onCommand('previewTypesetVersion', async ({ id, compare }) => {
        const { project, folder } = currentBook()
        if (!project) return
        if (!id) {
          setTypesetPreview(null)
          await publish()
          return
        }
        const entry = (await typesetEntries(project, folder)).find((e) => e.id === id)
        setTypesetPreview(entry ? { id, compare: Boolean(compare), snapshot: entry.snapshot, name: entry.name || '' } : null)
        await publish()
      }),
    ]
    return () => subscriptions.forEach((unsubscribe) => unsubscribe())
  }, [currentBook, publish, record, restore])

  return { record, restore, publish }
}

/** A version's typesetting on a chapter's content, for a preview: never saved. */
export const previewContent = (snapshot) => (path, content) => (
  snapshot?.chapters?.[path] ? applyChapterTypeset(content, snapshot.chapters[path]).content : content
)

/** The book a preview composes: the current one, with the version's typesetting. */
export const previewBook = (book, snapshot) => restoreBook(book, snapshot)
