/**
 * projectLocations.js — registry mapping project names to custom storage
 * directories on disk.
 *
 * By default a project lives at `<AppData>/<project>`. When the user chooses a
 * different location (e.g. an iCloud or OneDrive folder), the absolute path to
 * that project's directory is recorded here. The registry itself is a small
 * JSON file kept in AppData so it survives regardless of where projects live.
 *
 * A registry value is the absolute path to the project directory itself, not
 * its parent. Projects stored in the default AppData location have no entry.
 */
import {
  writeTextFile,
  readTextFile,
  exists,
  BaseDirectory,
} from '@tauri-apps/plugin-fs'

const REGISTRY_FILE = '.inkblot-project-locations.json'

let cache = null

async function load() {
  if (cache) return cache
  try {
    const present = await exists(REGISTRY_FILE, { baseDir: BaseDirectory.AppData })
    if (present) {
      const raw = await readTextFile(REGISTRY_FILE, { baseDir: BaseDirectory.AppData })
      const parsed = JSON.parse(raw || '{}')
      cache = parsed && typeof parsed === 'object' ? parsed : {}
    } else {
      cache = {}
    }
  } catch (e) {
    console.error('[projectLocations] load failed:', e)
    cache = {}
  }
  return cache
}

async function persist(map) {
  cache = map
  try {
    await writeTextFile(REGISTRY_FILE, JSON.stringify(map, null, 2), {
      baseDir: BaseDirectory.AppData,
    })
  } catch (e) {
    console.error('[projectLocations] persist failed:', e)
  }
}

/** Return a shallow copy of the full { name: absolutePath } map. */
export async function listLocations() {
  return { ...(await load()) }
}

/** Absolute directory path for a custom-located project, or null if default. */
export async function getProjectLocation(name) {
  const map = await load()
  return map[name] || null
}

export async function setProjectLocation(name, absolutePath) {
  const map = { ...(await load()) }
  map[name] = absolutePath
  await persist(map)
}

export async function removeProjectLocation(name) {
  const map = { ...(await load()) }
  if (name in map) {
    delete map[name]
    await persist(map)
  }
}

/** Move a registry entry to a new name/path (used when renaming projects). */
export async function renameProjectLocation(oldName, newName, newPath) {
  const map = { ...(await load()) }
  if (oldName in map) delete map[oldName]
  map[newName] = newPath
  await persist(map)
}
