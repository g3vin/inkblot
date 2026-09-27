/**
 * projectFonts.js — fonts kept in the project, so a book is set in the same face on
 * any Mac it is opened on, and its PDF and EPUB embed it.
 *
 * They live in `<project>/.assets/fonts/`, under their own file names (a family's
 * weights side by side). Each is read for its family, weight and style (fontFile.ts) and
 * added to the page's fonts, so a typography naming the family sets in it — in Typeset,
 * in the print job's off-screen layout and in the PDF, which WebKit embeds it in. The
 * list is read once per project and again after a font is added.
 */
import { exists, mkdir, readDir, readFile, writeFile } from '@tauri-apps/plugin-fs'

import { getProjectRoot } from '../lib/FileSystem'
import { fontFileType, readFontInfo } from './fontFile'

export const FONTS_DIR = '.assets/fonts'

const cache = new Map()
const listeners = new Set()

/** Called whenever a project's fonts have been read again. */
export const onProjectFontsChanged = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The fonts already read for a project, without reading: [] until they have been. */
export const projectFontsNow = (projectName) => cache.get(projectName)?.fonts || []

const baseName = (path) => path.split(/[/\\]/).pop() || path

/** Each font file's family, style and permission, added to the page's fonts. */
const readFonts = async (projectName) => {
  const root = await getProjectRoot(projectName)
  const dir = `${root}/${FONTS_DIR}`
  if (!(await exists(dir))) return []
  const entries = await readDir(dir)
  const out = []
  for (const entry of entries) {
    if (!entry.name || entry.isDirectory || !fontFileType(entry.name)) continue
    try {
      const bytes = await readFile(`${dir}/${entry.name}`)
      const info = readFontInfo(bytes, entry.name)
      if (typeof FontFace !== 'undefined' && typeof document !== 'undefined' && document.fonts) {
        const face = new FontFace(info.family, bytes, { weight: String(info.weight), style: info.style })
        await face.load()
        document.fonts.add(face)
      }
      out.push({ ...info, path: `${FONTS_DIR}/${entry.name}`, file: entry.name })
    } catch (error) {
      console.warn(`[fonts] ${entry.name} could not be read:`, error)
    }
  }
  return out.sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight)
}

/** A project's fonts, read once and remembered. */
export const loadProjectFonts = (projectName) => {
  if (!projectName) return Promise.resolve([])
  const cached = cache.get(projectName)
  if (cached) return cached.promise
  const entry = { fonts: [], promise: null }
  entry.promise = readFonts(projectName)
    .then((fonts) => {
      entry.fonts = fonts
      for (const listener of listeners) listener(projectName)
      return fonts
    })
    .catch((error) => {
      console.warn('[fonts] the project’s fonts could not be read:', error)
      return []
    })
  cache.set(projectName, entry)
  return entry.promise
}

/** Copy a font file into the project, and read the fonts again. Resolves with its path. */
export const addProjectFont = async (projectName, sourcePath) => {
  const name = baseName(sourcePath)
  if (!fontFileType(name)) throw new Error(`${name} is not a font file (OpenType, TrueType or WOFF).`)
  const root = await getProjectRoot(projectName)
  await mkdir(`${root}/${FONTS_DIR}`, { recursive: true })
  await writeFile(`${root}/${FONTS_DIR}/${name}`, await readFile(sourcePath))
  cache.delete(projectName)
  await loadProjectFonts(projectName)
  return `${FONTS_DIR}/${name}`
}

/** The families the project's fonts provide, one entry each, for the Swift picker. */
export const projectFontFamilies = (projectName) => {
  const byFamily = new Map()
  for (const font of projectFontsNow(projectName)) {
    const known = byFamily.get(font.family)
    // A family is embeddable only if all its files are.
    if (!known) byFamily.set(font.family, { family: font.family, path: font.path, embeddable: font.embeddable })
    else known.embeddable = known.embeddable && font.embeddable
  }
  return [...byFamily.values()]
}

/** The project's files for one family, with their bytes: what an EPUB embeds. */
export const projectFontFiles = async (projectName, family) => {
  const root = await getProjectRoot(projectName)
  const out = []
  for (const font of projectFontsNow(projectName)) {
    if (font.family !== family) continue
    const type = fontFileType(font.file)
    if (!type) continue
    out.push({ ...font, ...type, bytes: await readFile(`${root}/${font.path}`) })
  }
  return out
}
