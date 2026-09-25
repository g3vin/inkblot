/**
 * noteImageUtils.js — image helpers for notes.
 *
 * Note images are base64 data URLs stored on the note itself (unlike canvas images and
 * voice memos, which are asset files). That is fine for the small pasted thumbnails
 * notes actually carry, and it is the existing format — changing it would be a
 * migration, not a feature.
 */
import { IMAGE_EXTENSIONS_LIST } from './assets'

/** Extract pasted images from a ClipboardData object as { id, src (data URL), mimeType } entries. */
export const readClipboardImages = async (clipboardData) => {
  if (!clipboardData?.items?.length) return []

  const imageItems = Array.from(clipboardData.items)
    .filter((item) => item.type?.startsWith('image/'))

  if (imageItems.length === 0) return []

  const images = await Promise.all(imageItems.map((item) => new Promise((resolve) => {
    const file = item.getAsFile?.()
    if (!file) {
      resolve(null)
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      resolve({
        id: crypto.randomUUID(),
        src: typeof reader.result === 'string' ? reader.result : '',
        mimeType: file.type || item.type || 'image/png',
      })
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })))

  return images.filter((image) => image?.src)
}

const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  heic: 'image/heic',
}

const toBase64 = (bytes) => {
  let binary = ''
  // Chunked: a single spread of a multi-megabyte array blows the argument limit.
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * Pick images from disk and read them as note images (the alternative to pasting).
 */
export const pickNoteImages = async () => {
  const [{ open }, { readFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ])

  const selected = await open({
    multiple: true,
    filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS_LIST }],
  })
  if (!selected) return []

  const paths = Array.isArray(selected) ? selected : [selected]
  const images = []

  for (const path of paths) {
    try {
      const bytes = await readFile(path)
      const ext = String(path).split('.').pop()?.toLowerCase() || 'png'
      const mimeType = MIME_BY_EXT[ext] || 'image/png'

      images.push({
        id: crypto.randomUUID(),
        src: `data:${mimeType};base64,${toBase64(bytes)}`,
        mimeType,
      })
    } catch (error) {
      console.error('[notes] could not read image:', error)
    }
  }

  return images
}
