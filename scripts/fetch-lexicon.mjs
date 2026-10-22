/**
 * Fetch misaki's gold English pronouncing dictionaries into src/lib/g2p/data/.
 *
 *   node scripts/fetch-lexicon.mjs           (write the files)
 *   node scripts/fetch-lexicon.mjs --check   (fail if the committed files differ)
 *
 * The files are pinned to one misaki commit and checked against their SHA-256 before
 * anything is written, so a moved branch or a tampered download can't change what
 * Read Aloud says. They're re-serialized without indentation, which is all the
 * transformation there is: the entries are misaki's, byte for byte in value.
 *
 * Only the gold dictionaries are taken. misaki's silver dictionaries are eSpeak NG
 * output, and eSpeak NG is GPL; see THIRD-PARTY-NOTICES.md.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const COMMIT = 'fba1236595f2d2bf21d414ba6e57d25256afada3'
const FILES = {
  'us_gold.json': 'dc414872a49a28ae6c141463d502fd945f3b2fde040484fdc47d00cc4612686f',
  'gb_gold.json': '29e62f4b60261c88f7f3c2c7811ca3825978948090b72d2b27d565b729282f71',
}
const OUT = new URL('../src/lib/g2p/data/', import.meta.url)
const check = process.argv.includes('--check')

let stale = 0
for (const [name, sha] of Object.entries(FILES)) {
  const url = `https://raw.githubusercontent.com/hexgrad/misaki/${COMMIT}/misaki/data/${name}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
  const raw = Buffer.from(await response.arrayBuffer())
  const actual = createHash('sha256').update(raw).digest('hex')
  if (actual !== sha) throw new Error(`${name}: expected sha256 ${sha}, got ${actual}`)

  const compact = `${JSON.stringify(JSON.parse(raw.toString('utf8')))}\n`
  const target = new URL(name, OUT)
  if (check) {
    let current = ''
    try { current = readFileSync(target, 'utf8') } catch { /* missing counts as stale */ }
    if (current !== compact) {
      console.error(`${name} is out of date: run node scripts/fetch-lexicon.mjs`)
      stale += 1
    }
  } else {
    writeFileSync(target, compact)
    console.log(`wrote src/lib/g2p/data/${name}`)
  }
}
if (stale) process.exit(1)
