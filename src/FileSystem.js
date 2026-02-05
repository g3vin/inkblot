import { 
  writeTextFile, 
  readTextFile, 
  BaseDirectory, 
  mkdir, 
  exists, 
  readDir
} from '@tauri-apps/plugin-fs';

export async function saveDocument(projectName, docName, content) {
  try {
    const dir = projectName;
    const filePath = `${projectName}/${docName}.json`;

    // Ensure directory exists
    await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true });

    await writeTextFile(filePath, JSON.stringify(content), {
      baseDir: BaseDirectory.AppData,
    });
    console.log('Document saved successfully');
  } catch (error) {
    console.error('Failed to save document:', error);
  }
}

/**
 * Loads a document from the AppData directory.
 */
export async function loadDocument(projectName, docName) {
  try {
    const filePath = `${projectName}/${docName}.json`;

    const fileExists = await exists(filePath, { baseDir: BaseDirectory.AppData });
    if (!fileExists) return null;

    const contents = await readTextFile(filePath, {
      baseDir: BaseDirectory.AppData,
    });
    return JSON.parse(contents);
  } catch (error) {
    console.error('Failed to load document:', error);
    return null;
  }
}

export async function listFiles(projectName) {
  try {
    const entries = await readDir(projectName, { baseDir: BaseDirectory.AppData });
    // Filter for files and remove the .json extension for the UI
    return entries
      .filter(e => e.isFile)
      .map(e => e.name.replace('.json', ''));
  } catch (e) {
    console.error("List files failed:", e);
    return [];
  }
}