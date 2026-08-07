/**
 * assets.js — binary assets (images) stored beside a project's documents.
 *
 * Everywhere else in inkblot, images are base64-inlined into the document JSON
 * (see the paste handler in EditorCanvas and noteImageUtils). That does not scale
 * to a canvas: twenty photos would make a multi-megabyte file that is re-parsed
 * on every load. Canvas images are written to `<projectRoot>/.assets/` instead
 * and referenced by a project-relative path.
 *
 * Assets are content-addressed — the filename IS the hash of the bytes — so
 * pasting the same image twice writes one file, and an edit never orphans the
 * previous version.
 *
 * `.assets` starts with a dot, so listProjectTree already skips it and the folder
 * never shows up in the file tree.
 */
import { convertFileSrc } from '@tauri-apps/api/core'
import { exists, mkdir, readFile, writeFile } from '@tauri-apps/plugin-fs'
import { getProjectRoot } from './FileSystem'

const ASSETS_DIR = '.assets'

const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/heic': 'heic',
  // Voice memos. A MediaRecorder mime type carries codec parameters
  // ("audio/webm;codecs=opus"), so lookups must strip them first — see mimeToExt().
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/aac': 'aac',
}

/** `audio/webm;codecs=opus` → `webm`. Returns '' for a mime we don't store. */
export const mimeToExt = (mimeType) => EXT_BY_MIME[String(mimeType || '').split(';')[0].trim()] || ''

export const IMAGE_EXTENSIONS_LIST = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'heic']

const IMAGE_EXTENSIONS = new Set(IMAGE_EXTENSIONS_LIST)
const AUDIO_EXTENSIONS = new Set(['webm', 'ogg', 'm4a', 'mp3', 'wav', 'aac'])

export const extensionOf = (path) => String(path).split('.').pop()?.toLowerCase() || ''

export const isImagePath = (path) => IMAGE_EXTENSIONS.has(extensionOf(path))

export const isAudioPath = (path) => AUDIO_EXTENSIONS.has(extensionOf(path))

export const isAssetPath = (path) => String(path || '').startsWith(`${ASSETS_DIR}/`)

/**
 * SHA-256 of the bytes, truncated. crypto.subtle needs a secure context —
 * tauri://localhost and http://localhost both qualify — but fall back to FNV-1a
 * rather than fail if it is ever unavailable. Either way the hash only needs to
 * avoid collisions within one project, not resist attack.
 */
async function hashBytes(bytes) {
  if (globalThis.crypto?.subtle) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 20)
    } catch {
      // fall through
    }
  }

  let hash = 0x811c9dc5
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i]
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `fnv${hash.toString(16).padStart(8, '0')}${bytes.length.toString(16)}`
}

/**
 * Write bytes into the project's asset folder. Returns the project-relative path
 * to store on the node (e.g. `.assets/9f2c….png`).
 */
export async function writeAsset(projectName, bytes, ext = 'png') {
  const root = await getProjectRoot(projectName)
  await mkdir(`${root}/${ASSETS_DIR}`, { recursive: true })

  const relativePath = `${ASSETS_DIR}/${await hashBytes(bytes)}.${ext}`
  const absolutePath = `${root}/${relativePath}`

  // Content-addressed: identical bytes are already on disk under this name.
  if (!(await exists(absolutePath))) {
    await writeFile(absolutePath, bytes)
  }
  return relativePath
}

/** Import an image already on disk (an OS drag-and-drop) into the project. */
export async function importAssetFromPath(projectName, sourcePath) {
  const bytes = await readFile(sourcePath)
  const ext = extensionOf(sourcePath) || 'png'
  return writeAsset(projectName, bytes, ext === 'jpeg' ? 'jpg' : ext)
}

/** Import a File/Blob from a paste or drop. */
export async function writeAssetFromFile(projectName, file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const ext = mimeToExt(file.type) || extensionOf(file.name) || 'png'
  return writeAsset(projectName, bytes, ext)
}

/**
 * Import a raw Blob whose extension we already know — a recorded voice memo has a
 * mime type but no filename, so writeAssetFromFile's name-based fallback has nothing
 * to work with.
 */
export async function writeAssetFromBlob(projectName, blob, fallbackExt = 'webm') {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return writeAsset(projectName, bytes, mimeToExt(blob.type) || fallbackExt)
}

/**
 * A URL the webview can render for a stored asset. Needs `assetProtocol` enabled
 * in tauri.conf.json — without it convertFileSrc produces a URL the webview will
 * refuse to load.
 */
const urlCache = new Map()

export async function assetUrl(projectName, relativePath) {
  const key = `${projectName}::${relativePath}`
  if (urlCache.has(key)) return urlCache.get(key)

  const root = await getProjectRoot(projectName)
  const url = convertFileSrc(`${root}/${relativePath}`)
  urlCache.set(key, url)
  return url
}

/** Natural pixel size of an image, for sizing the card it lands on. */
export function measureImage(url) {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve(null)
    image.src = url
  })
}
