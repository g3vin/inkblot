/**
 * finishingText.js — the Finishing tabs' small pure helpers: font families, running
 * heads' previews, file choosing, and the glyph lists.
 */
import { convertFileSrc } from '@tauri-apps/api/core'

/** A file on disk as a URL the page can show. */
export const fileUrl = (path) => (path ? convertFileSrc(path) : null)

/** The family a CSS list starts with, unquoted. */
export const primaryFamily = (list) => String(list || '').split(',')[0].trim().replace(/^["']|["']$/g, '')

/** A family as a CSS list, with a fallback of its kind. */
export const cssFamily = (name) => {
  const mono = ['courier', 'mono', 'typewriter', 'menlo', 'consol'].some((part) => name.toLowerCase().includes(part))
  return `"${name}", ${mono ? 'Courier, monospace' : 'Georgia, serif'}`
}

/** A native file chooser for a picture or a font, as a path. Null when cancelled. */
export async function choosePath({ title = 'Choose a File', extensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'tif', 'tiff', 'heic'], name = 'Images' } = {}) {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const path = await open({ title, multiple: false, directory: false, filters: [{ name, extensions }] })
    return typeof path === 'string' ? path : null
  } catch {
    return null
  }
}

const roman = (value) => {
  if (value <= 0) return String(value)
  const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  let n = value
  let out = ''
  for (const [v, s] of table) while (n >= v) { out += s; n -= v }
  return out
}

/** As a manuscript gives it: to the nearest ten, hundred or thousand by length. */
export const describeWordCount = (words) => {
  const step = words < 100 ? 10 : words < 17500 ? 100 : 1000
  return `about ${(Math.round(Math.max(0, words) / step) * step).toLocaleString()} words`
}

/** What a running head's tokens stand for in the preview under its fields. */
export function runningPreview(state, setup, verso = false) {
  const first = setup.pageNumberStart
  let page = Math.max(state.currentPage, 1) - 1 + first
  if (verso && page % 2 === 1) page += 1
  const pages = Math.max(state.pageCount, 1) - 1 + first
  const docName = state.docPath?.split('/').pop() ?? 'Title'
  const title = state.scope === 'document' ? docName : (state.book?.title || docName)
  const name = state.scope !== 'document' && state.book?.author ? state.book.author : state.author?.byline ?? ''
  const author = name || 'Author'
  const number = (n) => (setup.pageNumberFormat === 'upperRoman' ? roman(n) : setup.pageNumberFormat === 'lowerRoman' ? roman(n).toLowerCase() : String(n))
  return (template) => String(template || '')
    .replaceAll('{page}', number(page))
    .replaceAll('{pages}', number(pages))
    .replaceAll('{title}', title)
    .replaceAll('{chapter}', 'Chapter')
    .replaceAll('{author}', author)
    .replaceAll('{surname}', author.split(' ').pop())
    .replaceAll('{words}', describeWordCount(state.wordCount ?? 0))
    .replaceAll('{date}', new Date().toLocaleDateString([], { dateStyle: 'long' }))
}

export const SCENE_BREAKS = ['* * *', '#', '⁂', '❧', '~', '• • •']

export const HEAD_GLYPHS = ['❦', '❧', '⁂', '✦', '❖', '§', '~', '* * *']

/** A reading time: 12 min, 2 hr, 2 hr 5 min. */
export const readingTime = (minutes) => {
  if (minutes < 60) return `${Math.max(1, minutes)} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`
}
