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

// No dead names: every registered icon is named somewhere in src/ (as a quoted string,
// so names in data tables and maps count too). An icon nothing draws goes.
const everything = files(src).filter((file) => !file.endsWith(join('ui', 'icons.js'))).map((file) => readFileSync(file, 'utf8')).join('\n')
const unused = Object.keys(ICONS).filter((name) => !new RegExp(`['"\`]${name}['"\`]`).test(everything))
for (const name of unused) console.log(`      icon "${name}" is registered but nothing uses it`)
for (const [name, where] of unknown) console.log(`      no icon "${name}" (${where})`)
ok(`every icon name used in src/ is registered (${used.size} names)`, unknown.length === 0)
ok(`every registered icon is used (${Object.keys(ICONS).length} names)`, unused.length === 0)
ok('the reference kinds each name an icon', REFERENCE_KINDS.every((kind) => ICONS[kind.icon]))

// One meaning, one glyph (DESIGN.md §8). Read each labelled control with the icon it
// draws: a label on the element (label, aria-label, title, help, text) and the icon in
// it (icon=, <Icon name=>, or an `icon:` field in the same object).
const LABEL = `(?:label|aria-label|title|help|text)\\s*[:=]\\s*\\{?\\s*['"\`]([^'"\`]+)['"\`]`
const pairs = []
for (const file of files(src)) {
  const rel = relative(root, file)
  if (rel.endsWith('ui/icons.js')) continue
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(new RegExp(LABEL, 'g'))) {
    // The rest of the element, or of the object literal, the label sits in.
    const rest = text.slice(match.index, match.index + 320)
    const end = rest.search(/<\/button>|\/>\s*\n|\}\s*[,\])]/)
    const scope = end === -1 ? rest : rest.slice(0, end + 2)
    const before = text.slice(Math.max(0, match.index - 160), match.index)
    const ownStart = Math.max(before.lastIndexOf('<'), before.lastIndexOf('{'))
    const head = ownStart === -1 ? '' : before.slice(ownStart)
    const icon = new RegExp(`(?:\\bicon\\s*[:=]\\s*\\{?\\s*|<Icon\\b[^>]*?\\bname=\\{?\\s*)['"]([a-z][a-z0-9-]*)['"]`).exec(head + scope)?.[1]
    if (icon) pairs.push({ label: match[1], icon, where: rel })
  }
}
const misuse = (test, why) => {
  const bad = pairs.filter(test)
  for (const pair of bad) console.log(`      "${pair.label}" draws "${pair.icon}": ${why} (${pair.where})`)
  return bad.length === 0
}
ok(`deleting draws the trash, never × (${pairs.length} labelled icons read)`, misuse(({ label, icon }) => /^(delete|remove)\b/i.test(label) && icon !== 'delete', 'delete and remove use "delete" (trash)'))
ok('closing and clearing draw ×, never the trash', misuse(({ label, icon }) => /^(close|dismiss|clear)\b/i.test(label) && icon === 'delete', 'close, dismiss and clear use "close" (×)'))
ok('the magnifier finds; zoom has its own glyphs', misuse(({ label, icon }) => /zoom/i.test(label) && icon === 'search', 'zoom uses "zoom-in" / "zoom-out"'))
ok('settings is the app gear, not a stand-in for other things', misuse(({ label, icon }) => icon === 'settings' && /theme|colour|color/i.test(label), 'settings (gear) opens settings'))

const glyphs = new Map()
for (const [name, glyph] of Object.entries(ICONS)) {
  const key = glyph.displayName ?? glyph.render?.displayName ?? glyph
  glyphs.set(key, [...(glyphs.get(key) ?? []), name])
}
// Pairs that are the same thing in two places' words.
const SAME_THING = [['government', 'statute'].sort().join()]
const shared = [...glyphs.values()].filter((names) => names.length > 1 && !SAME_THING.includes([...names].sort().join()))
for (const names of shared) console.log(`      one glyph, several names: ${names.join(', ')}`)
ok('no glyph answers to two names', shared.length === 0)
