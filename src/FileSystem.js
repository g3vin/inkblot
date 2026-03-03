import {
  writeTextFile,
  readTextFile,
  BaseDirectory,
  mkdir,
  exists,
  readDir,
  rename,
  remove,
} from '@tauri-apps/plugin-fs'
import { appDataDir } from '@tauri-apps/api/path'

const ORDER_FILE = '.inkblot-order.json'

// --- existing saveDocument, loadDocument, listFiles stay the same ---

/**
 * Deletes a document file from the project folder.
 */
export async function deleteFile(projectName, docName) {
  try {
    const filePath = `${projectName}/${docName}.json`
    const fileExists = await exists(filePath, { baseDir: BaseDirectory.AppData })
    if (!fileExists) return

    await remove(filePath, { baseDir: BaseDirectory.AppData })
    console.log(`Deleted file: ${filePath}`)
  } catch (error) {
    console.error('Failed to delete file:', error)
  }
}

/**
 * Renames a document file within the project folder.
 */
export async function renameFile(projectName, oldName, newName) {
  try {
    const oldPath = `${projectName}/${oldName}.json`
    const newPath = `${projectName}/${newName}.json`

    const fileExists = await exists(oldPath, { baseDir: BaseDirectory.AppData })
    if (!fileExists) {
      console.warn(`File not found: ${oldPath}`)
      return
    }

    await rename(oldPath, newPath, { baseDir: BaseDirectory.AppData })
    console.log(`Renamed file: ${oldName} → ${newName}`)
  } catch (error) {
    console.error('Failed to rename file:', error)
  }
}


export async function saveDocument(projectName, docName, docData) {
  try {
    console.debug('[saveDocument] called', { projectName, docName, append: !!docData?._appendVersion })
    const nestedPath = docName?.split('/')?.slice(0, -1).join('/')
    const dir = nestedPath ? `${projectName}/${nestedPath}` : projectName
    const filePath = `${projectName}/${docName}.json`

    await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true })

    // If caller requests versioning, merge versions into the same document file
    if (docData._appendVersion) {
      try {
        // read existing file if present
        let existing = null
        try {
          const raw = await readTextFile(filePath, { baseDir: BaseDirectory.AppData })
          existing = JSON.parse(raw || '{}')
        } catch (e) {
          existing = null
        }

        const versions = Array.isArray(existing?.versions) ? existing.versions.slice() : []

        const newEntry = {
          id: Date.now(),
          timestamp: new Date().toISOString(),
          contentHtml: docData._version?.contentHtml || null,
          contentJson: docData._version?.contentJson || null,
        }

        console.debug('[saveDocument] appendVersion', { projectName, docName, newEntryId: newEntry.id })

        // avoid duplicate consecutive
        if (!(versions[0] && versions[0].contentHtml && newEntry.contentHtml && versions[0].contentHtml === newEntry.contentHtml)) {
          versions.unshift(newEntry)
          // cap versions list
          if (versions.length > 200) versions.length = 200
          console.debug('[saveDocument] merged version; versionsCount=', versions.length)
        } else {
          console.debug('[saveDocument] skipped duplicate consecutive version')
        }

        await writeTextFile(
          filePath,
          JSON.stringify({
            content: docData.content || [],
            notes: docData.notes || [],
            versions,
          }),
          { baseDir: BaseDirectory.AppData }
        )
        try {
          const verifyRaw = await readTextFile(filePath, { baseDir: BaseDirectory.AppData })
          const verify = JSON.parse(verifyRaw || '{}')
          console.debug('[saveDocument] write verified', { filePath, writtenVersions: Array.isArray(verify.versions) ? verify.versions.length : 0 })
        } catch (ve) {
          console.debug('[saveDocument] write verify failed', { filePath, err: String(ve) })
        }
        try {
          if (typeof window !== 'undefined' && window?.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('versions:changed', { detail: { projectName, docName } }))
            console.debug('[saveDocument] dispatched versions:changed', { projectName, docName })
          }
        } catch (e) {}
        return
      } catch (e) {
        console.error('[saveDocument] version merge failed:', e)
      }
    }

    await writeTextFile(
      filePath,
      JSON.stringify({
        content: docData.content || [],
        notes: docData.notes || [],
      }),
      { baseDir: BaseDirectory.AppData }
    )
    try {
      const verifyRaw2 = await readTextFile(filePath, { baseDir: BaseDirectory.AppData })
      const verify2 = JSON.parse(verifyRaw2 || '{}')
      console.debug('[saveDocument] write verified (no-versions)', { filePath, hasVersions: Array.isArray(verify2.versions) ? verify2.versions.length : 0 })
    } catch (ve2) {
      console.debug('[saveDocument] write verify failed (no-versions)', { filePath, err: String(ve2) })
    }
  } catch (error) {
    console.error('Failed to save document:', error)
  }
}

/**
 * Append a version entry for a document. Stores a small changelog file
 * under a `.versions` folder next to the project.
 */
export async function appendVersion(projectName, docName, { contentHtml, contentJson } = {}) {
  try {
    const rel = normalizePath(docName)
    const versionsDir = rel ? `${projectName}/.versions/${rel.split('/').slice(0, -1).join('/')}` : `${projectName}/.versions`
    const versionsFile = rel ? `${projectName}/.versions/${rel}.versions.json` : `${projectName}/.versions/${docName}.versions.json`

    // Ensure directory exists
    const parentDir = versionsDir || `${projectName}/.versions`
    await mkdir(parentDir, { baseDir: BaseDirectory.AppData, recursive: true })

    // Load existing versions (avoid `exists()` which may be forbidden in some capability scopes)
    let existing = []
    try {
      const raw = await readTextFile(versionsFile, { baseDir: BaseDirectory.AppData })
      existing = JSON.parse(raw || '[]')
    } catch (e) {
      existing = []
    }

    console.debug('[appendVersion] writing to', { versionsFile, projectName, docName })

    // Avoid duplicate consecutive entries
    const latest = existing[0]
    if (latest && latest.contentHtml && contentHtml && latest.contentHtml === contentHtml) {
      console.debug('[appendVersion] skipped duplicate consecutive entry')
      return
    }

    const entry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      contentHtml: contentHtml || null,
      // store a light representation (json) if provided for potential restores
      contentJson: contentJson || null,
    }

    existing.unshift(entry)

    await writeTextFile(versionsFile, JSON.stringify(existing), { baseDir: BaseDirectory.AppData })
    console.debug('[appendVersion] wrote version', { id: entry.id, versionsFile, total: existing.length })
    try {
      if (typeof window !== 'undefined' && window?.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('versions:changed', { detail: { projectName, docName } }))
        console.debug('[appendVersion] dispatched versions:changed', { projectName, docName })
      }
    } catch (e) {
      // ignore
    }
  } catch (e) {
    console.error('[appendVersion] failed:', e)
  }
}

export async function getVersions(projectName, docName) {
  try {
    // Prefer embedded versions in the main document file
    const docPath = `${projectName}/${docName}.json`
    try {
      const raw = await readTextFile(docPath, { baseDir: BaseDirectory.AppData })
      const parsed = JSON.parse(raw || '{}')
      const found = Array.isArray(parsed.versions) ? parsed.versions.length : 0
      console.debug('[getVersions] read from doc file', { docPath, projectName, docName, found })
      if (Array.isArray(parsed.versions) && parsed.versions.length) return parsed.versions
      // fallthrough to .versions file fallback
    } catch (e) {
      console.debug('[getVersions] failed reading doc file, will try .versions fallback', { docPath, projectName, docName, err: String(e) })
    }

    // Fallback: check for a .versions file stored alongside the project (used by appendVersion)
    try {
      const rel = normalizePath(docName)
      const versionsFile = rel ? `${projectName}/.versions/${rel}.versions.json` : `${projectName}/.versions/${docName}.versions.json`
      try {
        const raw2 = await readTextFile(versionsFile, { baseDir: BaseDirectory.AppData })
        const parsed2 = JSON.parse(raw2 || '[]')
        console.debug('[getVersions] read from .versions file', { versionsFile, projectName, docName, found: Array.isArray(parsed2) ? parsed2.length : 0 })
        return Array.isArray(parsed2) ? parsed2 : []
      } catch (e2) {
        console.debug('[getVersions] no .versions file found or failed to read', { versionsFile, err: String(e2) })
        return []
      }
    } catch (e3) {
      console.error('[getVersions] fallback read failed:', e3)
      return []
    }
  } catch (e) {
    console.error('[getVersions] failed:', e)
    return []
  }
}

/**
 * Loads a document from the AppData directory.
 */
export async function loadDocument(projectName, docName) {
  try {
    const filePath = `${projectName}/${docName}.json`

    const fileExists = await exists(filePath, {
      baseDir: BaseDirectory.AppData,
    })
    if (!fileExists) return null

    const contents = await readTextFile(filePath, {
      baseDir: BaseDirectory.AppData,
    })

    return JSON.parse(contents)
  } catch (error) {
    console.error('Failed to load document:', error)
    return null
  }
}

export async function documentExists(projectName, docName) {
  try {
    if (!projectName || !docName) return false
    const filePath = `${projectName}/${docName}.json`
    return await exists(filePath, { baseDir: BaseDirectory.AppData })
  } catch {
    return false
  }
}

export async function listFiles(projectName) {
  try {
    const entries = await readDir(projectName, { baseDir: BaseDirectory.AppData });
    // Filter for files and remove the .json extension for the UI
    return entries
      .filter(e => e.isFile)
      .map(e => e.name)
      .filter(name => name && !name.startsWith('.'))
      .filter(name => name.endsWith('.json'))
      .map(name => name.replace('.json', ''));
  } catch (e) {
    console.error("List files failed:", e);
    return [];
  }
}

export async function listProjects() {
  try {
    let entries = []
    try {
      entries = await readDir('', { baseDir: BaseDirectory.AppData })
    } catch {
      entries = await readDir('.', { baseDir: BaseDirectory.AppData })
    }
    return entries
      .filter(e => e.isDirectory)
      .map(e => e.name)
      .filter(name => name && !name.startsWith('.'))
  } catch (e) {
    console.error('List projects failed:', e)
    return []
  }
}

export async function createProject(projectName) {
  try {
    await mkdir(projectName, { baseDir: BaseDirectory.AppData, recursive: true })
    return true
  } catch (e) {
    console.error('Create project failed:', e)
    return false
  }
}

export async function deleteProject(projectName) {
  try {
    const existsProject = await exists(projectName, { baseDir: BaseDirectory.AppData })
    if (!existsProject) return true
    await remove(projectName, { baseDir: BaseDirectory.AppData, recursive: true })
    return true
  } catch (e) {
    console.error('Delete project failed:', e)
    return false
  }
}

export async function createFolder(projectName, folderPath) {
  try {
    const dir = folderPath ? `${projectName}/${folderPath}` : projectName
    await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true })
  } catch (e) {
    console.error('Create folder failed:', e)
  }
}

const normalizePath = (path) => path?.replace(/\/+/, '/').replace(/^\//, '') || ''

const filePathFor = (projectName, entryPath) => {
  const rel = normalizePath(entryPath)
  return rel ? `${projectName}/${rel}.json` : `${projectName}.json`
}

const folderPathFor = (projectName, entryPath) => {
  const rel = normalizePath(entryPath)
  return rel ? `${projectName}/${rel}` : projectName
}

export async function deleteEntry(projectName, entryPath, type = 'file') {
  try {
    const rel = normalizePath(entryPath)
    const targetPath = type === 'folder'
      ? folderPathFor(projectName, rel)
      : filePathFor(projectName, rel)

    const targetExists = await exists(targetPath, { baseDir: BaseDirectory.AppData })
    if (!targetExists) return

    await remove(targetPath, { baseDir: BaseDirectory.AppData, recursive: true })
  } catch (e) {
    console.error('Delete entry failed:', e)
  }
}

export async function renameEntry(projectName, entryPath, newName, type = 'file') {
  try {
    const rel = normalizePath(entryPath)
    const segments = rel.split('/').filter(Boolean)
    const parent = segments.slice(0, -1).join('/')
    const nextPath = parent ? `${parent}/${newName}` : newName

    const oldPath = type === 'folder'
      ? folderPathFor(projectName, rel)
      : filePathFor(projectName, rel)
    const newPath = type === 'folder'
      ? folderPathFor(projectName, nextPath)
      : filePathFor(projectName, nextPath)

    const fileExists = await exists(oldPath, { baseDir: BaseDirectory.AppData })
    if (!fileExists) return

    // Ensure the parent directory of the new path exists
    const newPathParent = newPath.split('/').slice(0, -1).join('/')
    if (newPathParent) {
      await mkdir(newPathParent, { baseDir: BaseDirectory.AppData, recursive: true })
    }

    // Use absolute paths for rename (like moveEntry)
    const baseDir = await appDataDir()
    // Ensure exactly one slash between baseDir and path
    const joinPath = (a, b) => `${a.replace(/[\\/]+$/, '')}/${b.replace(/^[/\\]+/, '')}`
    const absoluteOldPath = joinPath(baseDir, oldPath)
    const absoluteNewPath = joinPath(baseDir, newPath)
    await rename(absoluteOldPath, absoluteNewPath)
    return nextPath
  } catch (e) {
    console.error('Rename entry failed:', e)
    return null
  }
}

export async function moveEntry(projectName, entryPath, targetFolderPath, type = 'file') {
  try {
    const rel = normalizePath(entryPath)
    const targetFolder = normalizePath(targetFolderPath)
    const baseName = rel.split('/').filter(Boolean).pop()
    const nextPath = targetFolder ? `${targetFolder}/${baseName}` : baseName

    const oldPath = type === 'folder'
      ? folderPathFor(projectName, rel)
      : filePathFor(projectName, rel)
    const newPath = type === 'folder'
      ? folderPathFor(projectName, nextPath)
      : filePathFor(projectName, nextPath)

    // Get the absolute app data directory
    const baseDir = await appDataDir()
    const absoluteOldPath = `${baseDir}/${oldPath}`
    const absoluteNewPath = `${baseDir}/${newPath}`

    // Ensure the parent directory of the new path exists
    const newPathParent = newPath.split('/').slice(0, -1).join('/')
    if (newPathParent) {
      console.debug('[moveEntry] ensuring parent exists:', newPathParent)
      await mkdir(newPathParent, { baseDir: BaseDirectory.AppData, recursive: true })
    }

    console.debug('[moveEntry]', { oldPath, newPath, absoluteOldPath, absoluteNewPath, targetFolder, nextPath })

    const fileExists = await exists(oldPath, { baseDir: BaseDirectory.AppData })
    if (!fileExists) {
      console.error('[moveEntry] source does not exist:', oldPath)
      return null
    }

    // Use absolute paths for rename
    await rename(absoluteOldPath, absoluteNewPath)
    return nextPath
  } catch (e) {
    console.error('Move entry failed:', e)
    return null
  }
}

export async function listProjectTree(projectName) {
  const readDirectory = async (relativePath = '') => {
    const dirPath = relativePath ? `${projectName}/${relativePath}` : projectName
    const dirExists = await exists(dirPath, { baseDir: BaseDirectory.AppData })
    if (!dirExists) return []
    let entries = []
    try {
      entries = await readDir(dirPath, { baseDir: BaseDirectory.AppData })
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