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
    const nestedPath = docName?.split('/')?.slice(0, -1).join('/')
    const dir = nestedPath ? `${projectName}/${nestedPath}` : projectName
    const filePath = `${projectName}/${docName}.json`

    await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true })

    await writeTextFile(
      filePath,
      JSON.stringify({
        content: docData.content || [],
        notes: docData.notes || [],
      }),
      { baseDir: BaseDirectory.AppData }
    )
  } catch (error) {
    console.error('Failed to save document:', error)
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