/**
 * versionActions.js — what the History panel does to a document's history.
 *
 * Lifted out of HistoryPanel.jsx unchanged, so the React panel and the native one
 * (arriving as protocol commands, see useNativeSidebar) run the same steps in the same
 * order. The order is the part worth protecting: a restore checkpoints the current
 * state *before* replacing it, so a restore is always itself undoable from History.
 *
 * Each takes the live `editor` for a text document because the current state of a text
 * document is the editor's, not the file's — the file is up to 800ms behind.
 */
import {
  appendVersionEntry,
  buildCanvasVersionEntry,
  buildMapVersionEntry,
  buildTextVersionEntry,
  createDocumentFromVersion,
  deleteVersionEntry,
  getVersions,
  loadDocument,
  updateVersionEntry,
} from './FileSystem'
import { isCanvasDoc, isMapDoc } from './docKind'
import { formatFullTimestamp } from './versionHistory'
import { dispatchCanvasRestore } from '../canvas/canvasEvents'
import { dispatchMapRestore } from '../map/mapEvents'
import { setContentKeepingPageSetup } from '../print/DocPageSetup'

/** Save the current state as a version. Resolves to the stored entry, or null. */
export async function snapshotVersion({ projectName, docName, editor }) {
  if (!projectName || !docName) return null
  if (isMapDoc(docName)) {
    const raw = await loadDocument(projectName, docName)
    if (!raw) return null
    return appendVersionEntry(projectName, docName, buildMapVersionEntry({ map: raw, auto: false }))
  }
  if (isCanvasDoc(docName)) {
    const raw = await loadDocument(projectName, docName)
    if (!raw) return null
    return appendVersionEntry(projectName, docName, buildCanvasVersionEntry({ canvas: raw, auto: false }))
  }
  if (!editor) return null
  return appendVersionEntry(projectName, docName, buildTextVersionEntry({
    contentHtml: editor.getHTML(),
    contentJson: editor.getJSON(),
    auto: false,
  }))
}

/**
 * Restore a version: checkpoint what is there now, swap the content, and record the
 * restore as a named version of its own.
 */
export async function restoreVersion({ projectName, docName, editor, version }) {
  if (!projectName || !docName || !version) return
  const restoredName = `Restored from ${formatFullTimestamp(version.timestamp)}`

  if (isMapDoc(docName)) {
    if (!version.map) return
    const current = await loadDocument(projectName, docName)
    if (current) {
      await appendVersionEntry(projectName, docName, buildMapVersionEntry({ map: current, auto: true }))
    }
    dispatchMapRestore(docName, version.map)
    await appendVersionEntry(projectName, docName, buildMapVersionEntry({
      map: version.map, name: restoredName, auto: false,
    }))
    return
  }

  if (isCanvasDoc(docName)) {
    // What's on disk now (autosave keeps it ≤1s stale), then swap the live canvas —
    // one undoable doc/replace.
    const current = await loadDocument(projectName, docName)
    if (current) {
      await appendVersionEntry(projectName, docName, buildCanvasVersionEntry({ canvas: current, auto: true }))
    }
    dispatchCanvasRestore(docName, version.canvas)
    await appendVersionEntry(projectName, docName, buildCanvasVersionEntry({
      canvas: version.canvas, name: restoredName, auto: false,
    }))
    return
  }

  if (!editor) return
  await appendVersionEntry(projectName, docName, buildTextVersionEntry({
    contentHtml: editor.getHTML(),
    contentJson: editor.getJSON(),
    auto: true,
  }))
  setContentKeepingPageSetup(editor, version.contentJson || version.contentHtml || '<p></p>')
  await appendVersionEntry(projectName, docName, buildTextVersionEntry({
    contentHtml: version.contentHtml,
    contentJson: version.contentJson,
    name: restoredName,
    auto: false,
  }))
}

/** Materialize a version as a new document beside this one. Resolves to its path. */
export async function copyVersionAsDocument({ projectName, docName, version }) {
  if (!projectName || !docName || !version) return null
  const label = version.name || formatFullTimestamp(version.timestamp)
  return createDocumentFromVersion(projectName, docName, version, label)
}

/** Name a version; an empty name makes it an unnamed (auto) checkpoint again. */
export async function renameVersion({ projectName, docName, versionId, name }) {
  const trimmed = String(name || '').trim()
  await updateVersionEntry(projectName, docName, versionId, { name: trimmed || null, auto: !trimmed })
}

export async function deleteVersion({ projectName, docName, versionId }) {
  await deleteVersionEntry(projectName, docName, versionId)
}

/** A version by id, read fresh — the caller may be holding a list from before a write. */
export async function findVersion({ projectName, docName, versionId }) {
  const versions = await getVersions(projectName, docName)
  return (versions || []).find((entry) => String(entry.id) === String(versionId)) || null
}
