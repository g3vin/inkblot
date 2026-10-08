/**
 * Icons: every SF-style name the page asks for draws a real icon, and every semantic
 * name the adapter points at is registered (src/ui/icons.js). An unknown SF name would
 * otherwise fall back to the search glyph without any error.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ok } from './assert.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const src = join(root, 'src')
const { SF_TO_ICON, resolveSFIcon } = await import('../../src/components/sfIconNames.js')
const { ICONS } = await import('../../src/ui/icons.js')

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  if (statSync(path).isDirectory()) return files(path)
  return /\.(jsx?|tsx?)$/.test(name) ? [path] : []
})

// Where an SF name is written: <SFIcon name="…">, an IconButton's or a registry's
// `symbol`, and the file-tree presets' fileIcon / folderIcon.
const PATTERNS = [
  /<SFIcon\b[^>]*?\bname=\{?\s*['"]([a-z][a-z0-9.]*)['"]/g,
  /<SFIcon\b[^>]*?\bname=\{[^}]*?\?\s*['"]([a-z][a-z0-9.]*)['"]\s*:\s*['"]([a-z][a-z0-9.]*)['"]/g,
  /\b(?:symbol|fileIcon|folderIcon)\s*[:=]\s*\{?\s*['"]([a-z][a-z0-9.]*)['"]/g,
]

const used = new Map()
for (const file of files(src)) {
  const rel = relative(root, file)
  if (rel.endsWith('sfIconNames.js')) continue
  const text = readFileSync(file, 'utf8')
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      for (const name of match.slice(1).filter(Boolean)) {
        if (!used.has(name)) used.set(name, rel)
      }
    }
  }
}

const unresolved = [...used].filter(([name]) => !resolveSFIcon(name))
for (const [name, file] of unresolved) console.log(`      no icon for "${name}" (${file})`)
ok(`every SF name used in src/ resolves to an icon (${used.size} names)`, unresolved.length === 0)

const dangling = Object.entries(SF_TO_ICON).filter(([, semantic]) => !ICONS[semantic])
for (const [sf, semantic] of dangling) console.log(`      "${sf}" points at unregistered icon "${semantic}"`)
ok('every SF mapping points at a registered icon', dangling.length === 0)
