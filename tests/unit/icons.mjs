/**
 * Icons: every icon name the page asks for is registered (src/ui/icons.js). An unknown
 * name would otherwise draw nothing, with only a console warning in development.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ok } from './assert.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const src = join(root, 'src')
const { ICONS } = await import('../../src/ui/icons.js')
const { REFERENCE_KINDS } = await import('../../src/lib/references/referenceKinds.js')
const { METRIC_INFO } = await import('../../src/stats/goals.js')
const { MAP_TOOLS } = await import('../../src/map/mapOptions.js')
const { DOCUMENT_KINDS } = await import('../../src/lib/createDocument.js')

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  if (statSync(path).isDirectory()) return files(path)
  return /\.(jsx?|tsx?)$/.test(name) ? [path] : []
})

const NAME = `['"]([a-z][a-z0-9-]*)['"]`
// Where an icon name is written: <Icon name="…">, an `icon` or `glyph` prop or field
// (either side of a ternary), and the file-tree presets' fileIcon / folderIcon.
const PATTERNS = [
  new RegExp(`<Icon\\b[^>]*?\\bname=\\{?\\s*${NAME}`, 'g'),
  new RegExp(`<Icon\\b[^>]*?\\bname=\\{[^}]*?\\?\\s*${NAME}\\s*:\\s*${NAME}`, 'g'),
  new RegExp(`\\b(?:icon|glyph|fileIcon|folderIcon)\\s*[:=]\\s*\\{?\\s*${NAME}`, 'g'),
  new RegExp(`\\bicon=\\{[^}]*?\\?\\s*${NAME}\\s*:\\s*${NAME}`, 'g'),
]

const used = new Map()
const note = (name, where) => { if (name && !used.has(name)) used.set(name, where) }
for (const file of files(src)) {
  const rel = relative(root, file)
  if (rel.endsWith('ui/icons.js')) continue
  const text = readFileSync(file, 'utf8')
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern)) match.slice(1).forEach((name) => note(name, rel))
  }
}
REFERENCE_KINDS.forEach((kind) => note(kind.icon, `reference kind ${kind.id}`))
Object.entries(METRIC_INFO).forEach(([id, info]) => note(info.icon, `goal ${id}`))
MAP_TOOLS.forEach((tool) => note(tool.icon, `map tool ${tool.id}`))
DOCUMENT_KINDS.forEach((kind) => note(kind.icon, `document kind ${kind.id}`))

const unknown = [...used].filter(([name]) => !ICONS[name])
for (const [name, where] of unknown) console.log(`      no icon "${name}" (${where})`)
ok(`every icon name used in src/ is registered (${used.size} names)`, unknown.length === 0)
ok('the reference kinds each name an icon', REFERENCE_KINDS.every((kind) => ICONS[kind.icon]))
