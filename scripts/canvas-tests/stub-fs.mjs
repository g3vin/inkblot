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
// A directory moves or goes with everything under it, as it does on disk — the entry
// suite renames and deletes folders with documents open inside them.
const underDir = (dir) => (key) => key.startsWith(`${dir}/`)
export async function rename(from, to) {
  const f = String(from), t = String(to)
  if (dirs.has(f)) {
    for (const key of [...files.keys()].filter(underDir(f))) {
      files.set(t + key.slice(f.length), files.get(key))
      files.delete(key)
    }
    for (const dir of [...dirs].filter((d) => d === f || underDir(f)(d))) {
      dirs.delete(dir)
      dirs.add(t + dir.slice(f.length))
    }
    return
  }
  files.set(t, files.get(f))
  files.delete(f)
}
export async function remove(path) {
  const p = String(path)
  files.delete(p)
  if (dirs.has(p)) {
    for (const key of [...files.keys()].filter(underDir(p))) files.delete(key)
    for (const dir of [...dirs].filter((d) => d === p || underDir(p)(d))) dirs.delete(dir)
  }
}
export async function copyFile(from, to) { files.set(String(to), files.get(String(from))) }
export async function writeFile(path, data) { files.set(String(path), data) }
export async function readFile(path) {
  const p = String(path)
  if (!files.has(p)) throw new Error('ENOENT ' + p)
  return files.get(p)
}
