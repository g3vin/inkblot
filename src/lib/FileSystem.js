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
import { CANVAS_SUFFIX, isCanvasDoc } from './docKind'
import { EDIT_SESSION_ID } from './versionHistory'
import {
  ORDER_FILE,
  CANVAS_SUFFIX_LENGTH,
  appDataRoot,
  getProjectRoot,
  joinPath,
  normalizePath,
  parentOf,
  stripTrailingSlash,
} from './projectPaths'
import { withDocLock } from './docLock'
import {
  buildTextVersionEntry,
  emitVersionsChanged,
  pushVersionEntry,
  versionsSidecarPath,
} from './versionStore'

/* This was one 956-line module. Paths, the per-document write lock and version
   history now live in their own files; they are re-exported here so the call
   sites that import them from FileSystem keep working. */
export { getProjectRoot } from './projectPaths'
export {
  buildTextVersionEntry,
  buildCanvasVersionEntry,
  getVersions,
  appendVersionEntry,
  appendCanvasVersion,
  updateVersionEntry,
  deleteVersionEntry,
} from './versionStore'
import {
  listLocations,
  getProjectLocation,
  setProjectLocation,
  removeProjectLocation,
  renameProjectLocation,
} from './projectLocations'


/**
 * Write a document file verbatim — no key whitelist, no version merging.
 *
 * saveDocument() below only ever emits { content, notes, versions }, which is
 * right for text documents and destructive for anything else. Document kinds
 * with their own shape (canvases) persist through here instead.
 */
export async function writeDocumentRaw(projectName, docName, data) {
  // Under the document's lock like every other write to it, so something that needs
  // the last write to have landed — a rename, see entryOperations.ts — can wait for it.
  return withDocLock(projectName, docName, () => writeDocumentUnlocked(projectName, docName, data))
}

// For callers already holding the document's lock. The lock is a queue, not a
// re-entrant mutex: taking it again from inside waits on itself forever.
async function writeDocumentUnlocked(projectName, docName, data) {
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

      await writeDocumentUnlocked(projectName, docName, {
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
