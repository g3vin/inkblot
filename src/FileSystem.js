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
    const dir = projectName
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