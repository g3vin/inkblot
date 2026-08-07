// In-memory stand-in for @tauri-apps/plugin-fs, so the real FileSystem.js runs under node.
export const files = new Map()
export const dirs = new Set(['/appdata'])
export const BaseDirectory = { AppData: 'AppData' }

export async function writeTextFile(path, contents) { files.set(String(path), contents) }
export async function readTextFile(path) {
  const p = String(path)
  if (!files.has(p)) throw new Error('ENOENT ' + p)
  return files.get(p)
}
export async function mkdir(path) { dirs.add(String(path)) }
export async function exists(path) { const p = String(path); return files.has(p) || dirs.has(p) }
export async function readDir() { return [] }
export async function rename(from, to) { files.set(String(to), files.get(String(from))); files.delete(String(from)) }
export async function remove(path) { files.delete(String(path)) }
export async function copyFile(from, to) { files.set(String(to), files.get(String(from))) }
export async function writeFile(path, data) { files.set(String(path), data) }
export async function readFile(path) {
  const p = String(path)
  if (!files.has(p)) throw new Error('ENOENT ' + p)
  return files.get(p)
}
