/**
 * FileSystem.js — all persistence for projects and documents.
 *
 * Storage layout:
 *   <projectRoot>/                      one directory per project
 *   <projectRoot>/<path/to/doc>.json    { content, notes, versions? }
 *   <projectRoot>/.versions/…           canvas version sidecars (a canvas file is
 *                                       spec-shaped JSON Canvas, so its history
 *                                       cannot ride inside it); also read as the
 *                                       legacy fallback for old text documents
 *
 * A project's root defaults to `<AppData>/<project>`, but the user may store a
 * project anywhere on disk (e.g. an iCloud or OneDrive folder). Custom
 * locations are tracked in projectLocations.js; every operation here resolves a
 * project name to its absolute root before touching the filesystem, so both
 * default and relocated projects go through the same code paths.
 *
 * Documents are stored as JSON with their TipTap content, notes, and an
 * embedded capped version history. Folder structure on disk mirrors the file
 * tree in the UI. A `versions:changed` window event fires whenever a document's
 * version list is updated.
 */
import {
  writeTextFile,
  readTextFile,
  copyFile,
  mkdir,
  exists,
  readDir,
  rename,
  remove,
} from '@tauri-apps/plugin-fs'
import { appDataDir } from '@tauri-apps/api/path'
import { CANVAS_SUFFIX, isCanvasDoc } from './docKind'
import { EDIT_SESSION_ID, countWords, countCanvasWords } from './versionHistory'
import {
  listLocations,
  getProjectLocation,
  setProjectLocation,
  removeProjectLocation,
  renameProjectLocation,
} from './projectLocations'

const ORDER_FILE = '.inkblot-order.json'
const CANVAS_SUFFIX_LENGTH = CANVAS_SUFFIX.length

/* ---------- path helpers (all filesystem access uses absolute paths) ---------- */

const stripTrailingSlash = (p) => String(p || '').replace(/[\\/]+$/, '')
const stripLeadingSlash = (p) => String(p || '').replace(/^[/\\]+/, '')

/** Join absolute/relative parts with exactly one separator between them. */
const joinPath = (...parts) =>
  parts
    .filter((p) => p != null && p !== '')
    .map((p, i) => (i === 0 ? stripTrailingSlash(p) : stripLeadingSlash(stripTrailingSlash(p))))
    .join('/')

const parentOf = (absPath) => stripTrailingSlash(absPath).split('/').slice(0, -1).join('/')

let appDataRootCache = null
async function appDataRoot() {
  if (!appDataRootCache) appDataRootCache = stripTrailingSlash(await appDataDir())
  return appDataRootCache
}

/** Absolute directory path for a project (custom location or AppData default). */
export async function getProjectRoot(projectName) {
  const custom = await getProjectLocation(projectName)
  if (custom) return stripTrailingSlash(custom)
  return joinPath(await appDataRoot(), projectName)
}

/* ---------- version history storage ---------- */

// Unnamed checkpoints beyond this are dropped oldest-first. Named versions are
// landmarks the user placed deliberately and are NEVER evicted by the cap.
const VERSION_CAP = 200

const newVersionId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const emitVersionsChanged = (projectName, docName) => {
  try {
    if (typeof window !== 'undefined' && window?.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('versions:changed', { detail: { projectName, docName } }))
    }
  } catch {
    void 0
  }
}

/* ---------- one writer at a time, per document ---------- */

// Every write below is a read-modify-write of the same file: read the version list,
// add to it, write the whole thing back. Left unsynchronized they interleave — an
// autosave reads the list, the user hits "Snapshot now", the snapshot lands, and
// then the autosave writes back the list it read BEFORE the snapshot existed. The
// snapshot is gone, and nothing errors. Queueing per document makes each cycle see
// the previous one's result.
const docWriteQueues = new Map()

function withDocLock(projectName, docName, task) {
  const key = `${projectName}\u0000${docName}`
  const previous = docWriteQueues.get(key) || Promise.resolve()

  // `task` runs whether the previous write resolved or rejected — one failed save
  // must not wedge the queue for the rest of the session.
  const run = previous.then(task, task)
  const settled = run.catch(() => {})

  docWriteQueues.set(key, settled)
  settled.then(() => {
    if (docWriteQueues.get(key) === settled) docWriteQueues.delete(key)
  })

  return run
}

/** A version entry for a text document, stamped with session + word count. */
export const buildTextVersionEntry = ({ contentHtml, contentJson, name = null, auto = true }) => ({
  id: newVersionId(),
  timestamp: new Date().toISOString(),
  kind: 'text',
  name: name || null,
  auto,
  sessionId: EDIT_SESSION_ID,
  words: countWords(contentHtml || ''),
  contentHtml: contentHtml || null,
  contentJson: contentJson || null,
})

/** A version entry holding a full serialized canvas. */
export const buildCanvasVersionEntry = ({ canvas, name = null, auto = true }) => ({
  id: newVersionId(),
  timestamp: new Date().toISOString(),
  kind: 'canvas',
  name: name || null,
  auto,
  sessionId: EDIT_SESSION_ID,
  words: countCanvasWords(canvas),
  canvas,
})

/** Two entries hold the same document state (viewport and metadata aside). */
const sameVersionContent = (a, b) => {
  if (!a || !b) return false
  if (a.canvas || b.canvas) {
    try {
      return JSON.stringify({ n: a.canvas?.nodes, e: a.canvas?.edges }) ===
        JSON.stringify({ n: b.canvas?.nodes, e: b.canvas?.edges })
    } catch {
      return false
    }
  }
  return Boolean(a.contentHtml) && a.contentHtml === b.contentHtml
}

/**
 * Push `entry` onto a newest-first version list. Consecutive duplicates fold
 * away — naming a state identical to the latest checkpoint names that
 * checkpoint instead of stacking a twin on top of it. The cap only ever evicts
 * unnamed entries.
 */
const pushVersionEntry = (versions, entry) => {
  const next = Array.isArray(versions) ? versions.slice() : []

  if (next[0] && sameVersionContent(next[0], entry)) {
    if (entry.name && !next[0].name) {
      next[0] = { ...next[0], name: entry.name, auto: false }
      return next
    }
    if (!entry.name) return next
  }

  next.unshift(entry)

  let unnamed = next.reduce((count, v) => count + (v.name ? 0 : 1), 0)
  for (let i = next.length - 1; i >= 0 && unnamed > VERSION_CAP; i--) {
    if (!next[i].name) {
      next.splice(i, 1)
      unnamed--
    }
  }

  return next
}

const versionsSidecarPath = (root, docName) => {
  const rel = normalizePath(docName)
  return joinPath(root, '.versions', `${rel || docName}.versions.json`)
}

async function readSidecarVersions(root, docName) {
  try {
    const raw = await readTextFile(versionsSidecarPath(root, docName))
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeSidecarVersions(root, docName, versions) {
  const filePath = versionsSidecarPath(root, docName)
  await mkdir(parentOf(filePath), { recursive: true })
  await writeTextFile(filePath, JSON.stringify(versions))
}

/**
 * Write a document file verbatim — no key whitelist, no version merging.
 *
 * saveDocument() below only ever emits { content, notes, versions }, which is
 * right for text documents and destructive for anything else. Document kinds
 * with their own shape (canvases) persist through here instead.
 */
export async function writeDocumentRaw(projectName, docName, data) {
  const root = await getProjectRoot(projectName)
  const filePath = joinPath(root, `${docName}.json`)
  await mkdir(parentOf(filePath), { recursive: true })
  await writeTextFile(filePath, JSON.stringify(data))
}

/**
 * Save a text document ({ content, notes }). When docData._appendVersion is set,
 * also push docData._version onto the document's embedded version history
 * (deduped against the latest entry, capped at 200).
 *
 * Only the keys above survive; everything else in docData is dropped. That makes
 * this function unsafe for any other document kind, so canvases are refused
 * outright rather than silently overwritten with an empty text document — they
 * go through saveCanvasDocument (canvasFileSystem.js) instead.
 */
/**
 * Replace only a document's `notes`, preserving its content and version history.
 *
 * This exists for note cards on a canvas. Notes normally ride along with a document
 * save, which needs a live editor to supply `content` — so a note belonging to a
 * document that ISN'T open in a pane has no way to persist. Calling saveDocument()
 * with just notes would write `content: []` and erase the document (see the whitelist
 * below); this reads the file first and puts back everything it didn't come to change.
 */
export async function saveDocumentNotes(projectName, docName, notes) {
  if (isCanvasDoc(docName)) {
    console.error('[saveDocumentNotes] refused: %s is a canvas and has no notes.', docName)
    return false
  }

  return withDocLock(projectName, docName, async () => {
    try {
      const existing = await loadDocument(projectName, docName)
      // Refuse to create a document from nothing: a note pointing at a file that is no
      // longer there must not resurrect it as an empty stub.
      if (!existing) return false

      await writeDocumentRaw(projectName, docName, {
        ...existing,
        notes: Array.isArray(notes) ? notes : [],
      })
      return true
    } catch (error) {
      console.error('Failed to save document notes:', error)
      return false
    }
  })
}

export async function saveDocument(projectName, docName, docData) {
  if (isCanvasDoc(docName)) {
    console.error(
      '[saveDocument] refused: %s is a canvas. Use saveCanvasDocument() — this path would erase it.',
      docName
    )
    return
  }

  return withDocLock(projectName, docName, async () => {
    try {
      const root = await getProjectRoot(projectName)
      const filePath = joinPath(root, `${docName}.json`)
      const dir = parentOf(filePath)

      await mkdir(dir, { recursive: true })

      // Version history lives in this same file, so every write has to carry it
      // forward. An autosave that rebuilt the file from { content, notes } alone
      // would erase the history — including named snapshots — on the next keystroke.
      let existing = null
      try {
        existing = JSON.parse((await readTextFile(filePath)) || '{}')
      } catch {
        existing = null
      }

      let versions = Array.isArray(existing?.versions) ? existing.versions : []
      let appended = false

      if (docData._appendVersion) {
        versions = pushVersionEntry(versions, buildTextVersionEntry({
          contentHtml: docData._version?.contentHtml || null,
          contentJson: docData._version?.contentJson || null,
          name: docData._version?.name || null,
          auto: docData._version?.auto !== false,
        }))
        appended = true
      }

      await writeTextFile(
        filePath,
        JSON.stringify({
          content: docData.content || [],
          notes: docData.notes || [],
          versions,
        })
      )

      if (appended) emitVersionsChanged(projectName, docName)
    } catch (error) {
      console.error('Failed to save document:', error)
    }
  })
}

/**
 * Load a document's version history.
 *
 * Text documents embed their versions in the document file; canvases keep
 * theirs in a `.versions/` sidecar (the canvas file itself is spec-shaped JSON
 * Canvas and must stay that way). The sidecar is also the legacy fallback for
 * text documents written by older app versions.
 */
export async function getVersions(projectName, docName) {
  try {
    const root = await getProjectRoot(projectName)

    if (!isCanvasDoc(docName)) {
      try {
        const raw = await readTextFile(joinPath(root, `${docName}.json`))
        const parsed = JSON.parse(raw || '{}')
        if (Array.isArray(parsed.versions) && parsed.versions.length) return parsed.versions
        // fallthrough to the sidecar fallback
      } catch {
        void 0
      }
    }

    return await readSidecarVersions(root, docName)
  } catch (e) {
    console.error('[getVersions] failed:', e)
    return []
  }
}

/**
 * Where a document's versions live and what they currently are — the one place
 * that knows embedded-vs-sidecar, so every mutation below shares it.
 */
async function readVersionStore(projectName, docName) {
  const root = await getProjectRoot(projectName)

  if (isCanvasDoc(docName)) {
    return { root, store: 'sidecar', doc: null, versions: await readSidecarVersions(root, docName) }
  }

  let doc = null
  try {
    const raw = await readTextFile(joinPath(root, `${docName}.json`))
    doc = JSON.parse(raw || '{}')
  } catch {
    doc = null
  }

  if (doc && Array.isArray(doc.versions) && doc.versions.length) {
    return { root, store: 'embedded', doc, versions: doc.versions }
  }

  // No embedded history yet: legacy sidecar if present, otherwise start
  // embedding (a text doc must exist to version).
  const legacy = await readSidecarVersions(root, docName)
  if (legacy.length) return { root, store: 'sidecar', doc, versions: legacy }
  return doc ? { root, store: 'embedded', doc, versions: [] } : null
}

async function writeVersionStore(projectName, docName, location, versions) {
  if (location.store === 'sidecar') {
    await writeSidecarVersions(location.root, docName, versions)
  } else {
    await writeTextFile(
      joinPath(location.root, `${docName}.json`),
      JSON.stringify({ ...location.doc, versions })
    )
  }
  emitVersionsChanged(projectName, docName)
}

/**
 * Append a version entry outside the autosave path — manual snapshots, the
 * safety checkpoint taken before a restore, and canvas checkpoints all land
 * here. Returns the entry actually stored (deduping may fold it into the
 * latest one) or null on failure.
 */
export async function appendVersionEntry(projectName, docName, entry) {
  return withDocLock(projectName, docName, async () => {
    try {
      const location = await readVersionStore(projectName, docName)
      if (!location) return null

      const versions = pushVersionEntry(location.versions, entry)
      await writeVersionStore(projectName, docName, location, versions)
      return versions[0] || null
    } catch (e) {
      console.error('[appendVersionEntry] failed:', e)
      return null
    }
  })
}

/** Debounced canvas checkpoint: store the full serialized canvas as a version. */
export async function appendCanvasVersion(projectName, docPath, canvas, { name = null, auto = true } = {}) {
  return appendVersionEntry(projectName, docPath, buildCanvasVersionEntry({ canvas, name, auto }))
}

/** Rename (or un-name) a version, or patch any of its metadata. */
export async function updateVersionEntry(projectName, docName, versionId, patch) {
  return withDocLock(projectName, docName, async () => {
    try {
      const location = await readVersionStore(projectName, docName)
      if (!location) return false

      let found = false
      const versions = location.versions.map((entry) => {
        if (String(entry.id) !== String(versionId)) return entry
        found = true
        return { ...entry, ...patch }
      })
      if (!found) return false

      await writeVersionStore(projectName, docName, location, versions)
      return true
    } catch (e) {
      console.error('[updateVersionEntry] failed:', e)
      return false
    }
  })
}

export async function deleteVersionEntry(projectName, docName, versionId) {
  return withDocLock(projectName, docName, async () => {
    try {
      const location = await readVersionStore(projectName, docName)
      if (!location) return false

      const versions = location.versions.filter((entry) => String(entry.id) !== String(versionId))
      if (versions.length === location.versions.length) return false

      await writeVersionStore(projectName, docName, location, versions)
      return true
    } catch (e) {
      console.error('[deleteVersionEntry] failed:', e)
      return false
    }
  })
}

/**
 * "Make a copy": materialize a version as a NEW document beside the original,
 * so old text can be pulled out without touching the live draft. Returns the
 * new document's tree path, or null.
 */
export async function createDocumentFromVersion(projectName, docName, version, label = '') {
  try {
    const root = await getProjectRoot(projectName)
    const rel = normalizePath(docName)
    const isCanvas = isCanvasDoc(rel)
    const base = isCanvas ? rel.slice(0, -CANVAS_SUFFIX_LENGTH) : rel
    const suffix = String(label || 'copy').replace(/[/\\]/g, '-')
    const withSuffix = (name) => (isCanvas ? `${name}${CANVAS_SUFFIX}` : name)

    let candidate = withSuffix(`${base} (${suffix})`)
    let counter = 2
    while (await exists(filePathFor(root, candidate))) {
      candidate = withSuffix(`${base} (${suffix} ${counter})`)
      counter += 1
    }

    const data = version.canvas
      ? version.canvas
      : { content: version.contentJson || [], notes: [] }

    await writeDocumentRaw(projectName, candidate, data)
    return candidate
  } catch (e) {
    console.error('[createDocumentFromVersion] failed:', e)
    return null
  }
}

/**
 * Loads a document from its project's storage location.
 */
export async function loadDocument(projectName, docName) {
  try {
    const root = await getProjectRoot(projectName)
    const filePath = joinPath(root, `${docName}.json`)

    const fileExists = await exists(filePath)
    if (!fileExists) return null

    const contents = await readTextFile(filePath)
    return JSON.parse(contents)
  } catch (error) {
    console.error('Failed to load document:', error)
    return null
  }
}

export async function documentExists(projectName, docName) {
  try {
    if (!projectName || !docName) return false
    const root = await getProjectRoot(projectName)
    return await exists(joinPath(root, `${docName}.json`))
  } catch {
    return false
  }
}

export async function listProjects() {
  try {
    // Default projects: subdirectories of the AppData root.
    const root = await appDataRoot()
    let entries = []
    try {
      entries = await readDir(root)
    } catch (e) {
      console.error('List projects (AppData) failed:', e)
      entries = []
    }
    const appDataProjects = entries
      .filter((e) => e.isDirectory)
      .map((e) => e.name)
      .filter((name) => name && !name.startsWith('.'))

    // Custom-located projects: registry entries whose directory still exists.
    const external = await listLocations()
    const externalNames = []
    for (const [name, absPath] of Object.entries(external)) {
      try {
        if (await exists(absPath)) externalNames.push(name)
      } catch {
        void 0
      }
    }

    return Array.from(new Set([...appDataProjects, ...externalNames]))
  } catch (e) {
    console.error('List projects failed:', e)
    return []
  }
}

/**
 * Create a project. When `targetParentDir` is provided, the project directory
 * is created inside it and the custom location is recorded; otherwise the
 * project is created in the default AppData location.
 */
export async function createProject(projectName, targetParentDir = null) {
  try {
    const name = projectName?.trim()
    if (!name) return false

    const root = targetParentDir
      ? joinPath(targetParentDir, name)
      : joinPath(await appDataRoot(), name)

    await mkdir(root, { recursive: true })

    if (targetParentDir) {
      await setProjectLocation(name, root)
    }
    return true
  } catch (e) {
    console.error('Create project failed:', e)
    return false
  }
}

/**
 * Adopt a project directory that already exists on disk, under the name of the
 * folder itself.
 *
 * This is the repair path for a project that has stopped appearing in the app.
 * listProjects() hides a registry entry whose directory is gone, so a project
 * that was moved, renamed, or restored from a backup outside the app silently
 * drops out of the picker while its documents sit untouched on disk. Pointing
 * the registry back at the folder's current location brings it back whole.
 *
 * Returns { ok, name, alreadyLinked, error }.
 */
export async function linkProject(projectDir) {
  try {
    const dir = stripTrailingSlash(projectDir)
    if (!dir) return { ok: false, error: 'invalid-arguments' }
    if (!(await exists(dir))) return { ok: false, error: 'source-missing' }

    const name = dir.split(/[\\/]/).filter(Boolean).pop()
    // Dotted directories are skipped by listProjects(), so linking one would
    // "succeed" into a project that never appears.
    if (!name || name.startsWith('.')) return { ok: false, error: 'invalid-name' }

    // Never hijack a name a different, still-reachable project holds — that
    // would strand the other one. A stale entry (its directory gone) is exactly
    // what this function exists to repair, so overwriting that is the point.
    const currentRoot = await getProjectRoot(name)
    const alreadyLinked = stripTrailingSlash(currentRoot) === dir
    if (!alreadyLinked && (await exists(currentRoot))) {
      return { ok: false, error: 'name-exists', name }
    }

    // A project sitting in the default AppData location is found by directory
    // scan and needs no registry entry.
    const defaultRoot = joinPath(await appDataRoot(), name)
    if (dir === defaultRoot) {
      await removeProjectLocation(name)
    } else {
      await setProjectLocation(name, dir)
    }

    return { ok: true, name, alreadyLinked }
  } catch (e) {
    console.error('Link project failed:', e)
    return { ok: false, error: 'link-failed' }
  }
}

export async function deleteProject(projectName) {
  try {
    const root = await getProjectRoot(projectName)
    if (await exists(root)) {
      await remove(root, { recursive: true })
    }
    await removeProjectLocation(projectName)
    return true
  } catch (e) {
    console.error('Delete project failed:', e)
    return false
  }
}

export async function renameProject(projectName, newName) {
  try {
    const currentName = projectName?.trim()
    const nextName = newName?.trim()
    if (!currentName || !nextName) return null
    if (currentName === nextName) return nextName

    const oldRoot = await getProjectRoot(currentName)
    const projectExists = await exists(oldRoot)
    if (!projectExists) return null

    const newRoot = joinPath(parentOf(oldRoot), nextName)
    const targetExists = await exists(newRoot)
    if (targetExists) return null

    await rename(oldRoot, newRoot)

    // Keep the location registry consistent for custom-located projects.
    const custom = await getProjectLocation(currentName)
    if (custom) {
      await renameProjectLocation(currentName, nextName, newRoot)
    }
    return nextName
  } catch (e) {
    console.error('Rename project failed:', e)
    return null
  }
}

/**
 * Move an existing project's directory to a new parent folder. Falls back to a
 * recursive copy + delete when a plain rename crosses filesystem boundaries.
 * Returns { ok, root, error }.
 */
export async function moveProject(projectName, targetParentDir) {
  try {
    const name = projectName?.trim()
    const parent = stripTrailingSlash(targetParentDir)
    if (!name || !parent) return { ok: false, error: 'invalid-arguments' }

    const oldRoot = await getProjectRoot(name)
    const newRoot = joinPath(parent, name)

    if (stripTrailingSlash(oldRoot) === newRoot) {
      return { ok: true, root: newRoot }
    }

    if (!(await exists(oldRoot))) return { ok: false, error: 'source-missing' }
    if (await exists(newRoot)) return { ok: false, error: 'target-exists' }

    try {
      await rename(oldRoot, newRoot)
    } catch {
      // Cross-volume move (e.g. into a cloud folder on another volume).
      await copyDirRecursive(oldRoot, newRoot)
      await remove(oldRoot, { recursive: true })
    }

    // Update the registry: a project moved back into AppData reverts to default.
    const appDataProjectRoot = joinPath(await appDataRoot(), name)
    if (newRoot === appDataProjectRoot) {
      await removeProjectLocation(name)
    } else {
      await setProjectLocation(name, newRoot)
    }

    return { ok: true, root: newRoot }
  } catch (e) {
    console.error('Move project failed:', e)
    return { ok: false, error: 'move-failed' }
  }
}

async function copyDirRecursive(sourceDir, destDir) {
  await mkdir(destDir, { recursive: true })
  const entries = await readDir(sourceDir)
  for (const entry of entries) {
    if (!entry.name) continue
    const from = joinPath(sourceDir, entry.name)
    const to = joinPath(destDir, entry.name)
    if (entry.isDirectory) {
      await copyDirRecursive(from, to)
    } else if (entry.isFile) {
      await copyFile(from, to)
    }
  }
}

export async function createFolder(projectName, folderPath) {
  try {
    const root = await getProjectRoot(projectName)
    const dir = folderPath ? joinPath(root, folderPath) : root
    await mkdir(dir, { recursive: true })
  } catch (e) {
    console.error('Create folder failed:', e)
  }
}

/* ---------- entry helpers (files and folders addressed by tree path) ---------- */

const normalizePath = (path) => path?.replace(/\/+/, '/').replace(/^\//, '') || ''

const filePathFor = (root, entryPath) => {
  const rel = normalizePath(entryPath)
  return rel ? joinPath(root, `${rel}.json`) : `${root}.json`
}

const folderPathFor = (root, entryPath) => {
  const rel = normalizePath(entryPath)
  return rel ? joinPath(root, rel) : root
}

/** Move/delete a document's version sidecar alongside the document itself. */
async function relocateSidecar(root, fromRel, toRel) {
  try {
    const from = versionsSidecarPath(root, fromRel)
    if (!(await exists(from))) return
    if (!toRel) {
      await remove(from)
      return
    }
    const to = versionsSidecarPath(root, toRel)
    await mkdir(parentOf(to), { recursive: true })
    await rename(from, to)
  } catch {
    // History is best-effort here; never block the file operation itself.
  }
}

export async function deleteEntry(projectName, entryPath, type = 'file') {
  try {
    const root = await getProjectRoot(projectName)
    const rel = normalizePath(entryPath)
    const targetPath = type === 'folder'
      ? folderPathFor(root, rel)
      : filePathFor(root, rel)

    const targetExists = await exists(targetPath)
    if (!targetExists) return

    await remove(targetPath, { recursive: true })
    if (type === 'file') await relocateSidecar(root, rel, null)
  } catch (e) {
    console.error('Delete entry failed:', e)
  }
}

/** Absolute path of a document's file on disk — what "Copy Path" and "Reveal in Finder" need. */
export async function getEntryFilePath(projectName, entryPath, type = 'file') {
  const root = await getProjectRoot(projectName)
  const rel = normalizePath(entryPath)
  return type === 'folder' ? folderPathFor(root, rel) : filePathFor(root, rel)
}

/**
 * Copy a document beside itself as "<name> copy" (then "copy 2", …).
 *
 * The bytes are copied verbatim rather than round-tripped through
 * loadDocument/saveDocument, because that pair whitelists the keys of a *text*
 * document and would quietly strip a canvas down to nothing.
 */
export async function duplicateEntry(projectName, entryPath) {
  try {
    const root = await getProjectRoot(projectName)
    const rel = normalizePath(entryPath)
    const source = filePathFor(root, rel)
    if (!(await exists(source))) return null

    // The `.canvas` suffix carries the document's kind, so the copy keeps it.
    const isCanvas = isCanvasDoc(rel)
    const base = isCanvas ? rel.slice(0, -CANVAS_SUFFIX_LENGTH) : rel
    const withSuffix = (name) => (isCanvas ? `${name}${CANVAS_SUFFIX}` : name)

    let candidate = withSuffix(`${base} copy`)
    let counter = 2
    while (await exists(filePathFor(root, candidate))) {
      candidate = withSuffix(`${base} copy ${counter}`)
      counter += 1
    }

    await copyFile(source, filePathFor(root, candidate))
    return candidate
  } catch (e) {
    console.error('Duplicate entry failed:', e)
    return null
  }
}

export async function renameEntry(projectName, entryPath, newName, type = 'file') {
  try {
    const root = await getProjectRoot(projectName)
    const rel = normalizePath(entryPath)
    const segments = rel.split('/').filter(Boolean)
    const parent = segments.slice(0, -1).join('/')
    const nextPath = parent ? `${parent}/${newName}` : newName

    const oldPath = type === 'folder'
      ? folderPathFor(root, rel)
      : filePathFor(root, rel)
    const newPath = type === 'folder'
      ? folderPathFor(root, nextPath)
      : filePathFor(root, nextPath)

    const fileExists = await exists(oldPath)
    if (!fileExists) return

    // Ensure the parent directory of the new path exists
    const newPathParent = parentOf(newPath)
    if (newPathParent) {
      await mkdir(newPathParent, { recursive: true })
    }

    await rename(oldPath, newPath)
    if (type === 'file') await relocateSidecar(root, rel, nextPath)
    return nextPath
  } catch (e) {
    console.error('Rename entry failed:', e)
    return null
  }
}

export async function moveEntry(projectName, entryPath, targetFolderPath, type = 'file') {
  try {
    const root = await getProjectRoot(projectName)
    const rel = normalizePath(entryPath)
    const targetFolder = normalizePath(targetFolderPath)
    const baseName = rel.split('/').filter(Boolean).pop()
    const nextPath = targetFolder ? `${targetFolder}/${baseName}` : baseName

    const oldPath = type === 'folder'
      ? folderPathFor(root, rel)
      : filePathFor(root, rel)
    const newPath = type === 'folder'
      ? folderPathFor(root, nextPath)
      : filePathFor(root, nextPath)

    // Ensure the parent directory of the new path exists
    const newPathParent = parentOf(newPath)
    if (newPathParent) {
      await mkdir(newPathParent, { recursive: true })
    }

    const fileExists = await exists(oldPath)
    if (!fileExists) {
      console.error('[moveEntry] source does not exist:', oldPath)
      return null
    }

    await rename(oldPath, newPath)
    if (type === 'file') await relocateSidecar(root, rel, nextPath)
    return nextPath
  } catch (e) {
    console.error('Move entry failed:', e)
    return null
  }
}

/** Read a project's full folder/file tree (dotfiles and the order file excluded). */
export async function listProjectTree(projectName) {
  const root = await getProjectRoot(projectName)

  const readDirectory = async (relativePath = '') => {
    const dirPath = relativePath ? joinPath(root, relativePath) : root
    const dirExists = await exists(dirPath)
    if (!dirExists) return []
    let entries = []
    try {
      entries = await readDir(dirPath)
    } catch (e) {
      console.error('Read dir failed:', e)
      return []
    }

    const children = []

    for (const entry of entries) {
      if (!entry.name || entry.name.startsWith('.')) continue
      if (entry.name === ORDER_FILE) continue

      if (entry.isDirectory) {
        const folderPath = relativePath ? `${relativePath}/${entry.name}` : entry.name
        children.push({
          type: 'folder',
          name: entry.name,
          path: folderPath,
          children: await readDirectory(folderPath),
        })
      } else if (entry.isFile && entry.name.endsWith('.json')) {
        const baseName = entry.name.replace(/\.json$/, '')
        const filePath = relativePath ? `${relativePath}/${baseName}` : baseName
        children.push({
          type: 'file',
          name: baseName,
          path: filePath,
        })
      }
    }

    return children
  }

  return {
    type: 'folder',
    name: projectName,
    path: '',
    children: await readDirectory(''),
  }
}
