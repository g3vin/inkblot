/**
 * images.ts — an image in a document, as bytes an export can write out.
 *
 * Document images are inlined as base64 `data:` URIs; canvas-era images and
 * imports are project-relative asset paths (`.assets/<hash>.png`). Remote URLs are
 * left as they are: an EPUB may not reference the network, so those are dropped
 * there, but HTML and Markdown can keep the link.
 */
import { readFile } from '@tauri-apps/plugin-fs'

import { getProjectRoot } from '../../lib/FileSystem'

export interface ResolvedImage {
  bytes: Uint8Array
  mime: string
  ext: string
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
}

const MIME_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]))
MIME_BY_EXT.jpeg = 'image/jpeg'

export const decodeDataUri = (src: string): ResolvedImage | null => {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src)
  if (!match) return null
  const mime = match[1].toLowerCase()
  const payload = match[3]
  let bytes: Uint8Array
  if (match[2]) {
    const binary = atob(payload)
    bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(payload))
  }
  return { bytes, mime, ext: EXT[mime] || 'bin' }
}

export const isRemote = (src: string) => /^https?:\/\//i.test(src)

export const resolveImage = async (projectName: string, src: string): Promise<ResolvedImage | null> => {
  if (!src) return null
  if (src.startsWith('data:')) return decodeDataUri(src)
  if (isRemote(src)) return null
  // A project-relative asset path, or an asset:// URL the webview was given for one.
  let relative = src
  const assetAt = src.indexOf('/.assets/')
  if (/^(asset|https?):/i.test(src) && assetAt >= 0) relative = decodeURIComponent(src.slice(assetAt + 1))
  if (!relative.startsWith('.assets/')) return null
  try {
    const root = await getProjectRoot(projectName)
    const bytes = await readFile(`${root}/${relative}`)
    const ext = (relative.split('.').pop() || '').toLowerCase()
    return { bytes, mime: MIME_BY_EXT[ext] || 'application/octet-stream', ext: ext || 'bin' }
  } catch {
    return null
  }
}

export const toDataUri = (image: ResolvedImage): string => {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < image.bytes.length; i += chunk) {
    binary += String.fromCharCode(...image.bytes.subarray(i, i + chunk))
  }
  return `data:${image.mime};base64,${btoa(binary)}`
}

/**
 * An image's pixel size, read from its header: PNG, GIF and JPEG, the formats every
 * word processor opens. Null for anything else, or bytes too short to say.
 */
export const imageSize = (image: ResolvedImage): { width: number; height: number } | null => {
  const b = image.bytes
  const u16 = (i: number, little = false) => (little ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1])
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: u32(16), height: u32(20) }
  }
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { width: u16(6, true), height: u16(8, true) }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i += 1
        continue
      }
      const marker = b[i + 1]
      // Start-of-frame markers, not the huffman (C4), JPEG-LS (C8) or arithmetic (CC) ones.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: u16(i + 7), height: u16(i + 5) }
      }
      i += 2 + u16(i + 2)
    }
  }
  return null
}

/**
 * An image a word processor can open: PNG, JPEG and GIF as they are; anything else
 * (WebP, SVG, AVIF, HEIC) redrawn as a PNG, where the browser can draw it. Null when
 * it cannot, and the export leaves the image out.
 */
export const toPortableImage = async (image: ResolvedImage): Promise<ResolvedImage | null> => {
  if (['image/png', 'image/jpeg', 'image/gif'].includes(image.mime) && imageSize(image)) return image
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return null
  try {
    const bitmap = await createImageBitmap(new Blob([image.bytes as BlobPart], { type: image.mime }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return null
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png', ext: 'png' }
  } catch {
    return null
  }
}
