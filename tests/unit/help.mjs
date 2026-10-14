/**
 * Help: every help topic a control points at (data-help="…", or a `help` prop on
 * FormRow, Section and the panels) exists in src/lib/help.ts, and the registry holds
 * together: unique ids, a section and body for each, related links that resolve.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ok } from './assert.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const { HELP_TOPICS, helpTopic, helpMenuItem } = await import('../../src/lib/help.ts')
const { SECTION_IDS } = await import('../../src/components/RightSidebar/finishing/sectionIds.js')

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  if (statSync(path).isDirectory()) return files(path)
  return /\.(jsx?|tsx?)$/.test(name) ? [path] : []
})

const ID = `['"]([a-z][a-z0-9-]*(?:\\.[a-z0-9-]+)+)['"]`
const PATTERNS = [
  new RegExp(`\\bdata-help=\\{?\\s*${ID}`, 'g'),
  new RegExp(`\\bhelp=\\{?\\s*${ID}`, 'g'),
  new RegExp(`\\bhelpTopic:\\s*${ID}`, 'g'),
  new RegExp(`\\bopenHelp\\(\\s*${ID}`, 'g'),
]

const used = new Map()
for (const file of files(join(root, 'src'))) {
  const rel = relative(root, file)
  if (rel.endsWith('lib/help.ts')) continue
  const text = readFileSync(file, 'utf8')
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern)) if (!used.has(match[1])) used.set(match[1], rel)
  }
}

const unknown = [...used].filter(([id]) => !helpTopic(id))
for (const [id, where] of unknown) console.log(`      no help topic "${id}" (${where})`)
ok(`every help topic used in src/ exists (${used.size} ids)`, unknown.length === 0)

// A Typeset or Print section offers the topic under its own id (FinishingSection).
const unexplained = SECTION_IDS.filter((id) => !helpTopic(id))
for (const id of unexplained) console.log(`      no help topic for the section "${id}"`)
ok('every Typeset and Print section has a help topic', unexplained.length === 0)

const ids = HELP_TOPICS.map((topic) => topic.id)
ok('help topic ids are unique', new Set(ids).size === ids.length)
ok('every help topic has a section, a title and words', HELP_TOPICS.every((topic) => topic.section && topic.title && topic.body.length > 0))
ok('every related link resolves', HELP_TOPICS.every((topic) => (topic.related ?? []).every((id) => helpTopic(id) && id !== topic.id)))
ok('titles are sentence case, with no closing period', HELP_TOPICS.every((topic) => topic.title[0] === topic.title[0].toUpperCase() && !topic.title.endsWith('.')))

// The right-click item: offered for a tagged element or anything inside it, not otherwise.
const tagged = { closest: (selector) => (selector === '[data-help]' ? { getAttribute: () => 'settings.accent' } : null) }
Object.setPrototypeOf(tagged, globalThis.Element?.prototype ?? Object.prototype)
if (globalThis.Element) {
  const item = helpMenuItem(tagged)
  ok('a right-click on a tagged control offers its help', item?.text === 'Help: Accent colour…')
  const plain = Object.setPrototypeOf({ closest: () => null }, Element.prototype)
  ok('a right-click on anything else offers none', helpMenuItem(plain) === null)
}
