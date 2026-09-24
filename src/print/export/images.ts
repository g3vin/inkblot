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
