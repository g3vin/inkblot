/**
 * The stylesheets keep to the design system (src/styles/tokens.css, docs/DESIGN.md).
 *
 *   - Surfaces are flat: a gradient is allowed only where it does a job (a fade at a
 *     scroll edge, a mask, a grid, the dictation sweep), listed below by selector.
 *   - The translucent, blurred surfaces are the floating capsule over the page, the
 *     scrim behind a sheet, and a hover note. So a backdrop-filter is only ever one of
 *     the shared tokens.
 *   - Radii come from the --radius-* scale. Literals are counted, not failed yet, while
 *     the older stylesheets are brought over.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ok } from './assert.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const src = join(root, 'src')

const cssFiles = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  if (statSync(path).isDirectory()) return cssFiles(path)
  return name.endsWith('.css') ? [path] : []
})

// Gradients that do a job, by the selector of the rule they are in.
const FUNCTIONAL_GRADIENTS = [
  '.pinterest-board-expand-hint',   // fades a collapsed board out
  '.app-titlebar::before',          // content fading under the titlebar
  '.sidebar-list::before',          // lists fading under their sticky header
  '.dictation-inline-draft',        // the sweep over text being dictated
  '.canvas-grid',                   // the canvas grid
  '.ib-fade-scrim',                 // content fading under chrome that overlays it (src/ui FadeScrim)
  '.ib-tray',                       // the window's tray, in the writer's window colour (src/ui Surfaces.css)
  '.note-range',                    // a noted passage's highlight, a flat band sized to its words
]

const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))

// The selector of the rule a declaration at `index` sits in.
const selectorAt = (css, index) => {
  const open = css.lastIndexOf('{', index)
  const before = css.slice(0, open)
  const start = Math.max(before.lastIndexOf('}'), before.lastIndexOf(';'), before.lastIndexOf('{')) + 1
  return before.slice(start).trim()
}

// The declaration a match at `index` belongs to, e.g. `mask-image: linear-gradient(…`.
const declarationAt = (css, index) => {
  const start = Math.max(css.lastIndexOf(';', index), css.lastIndexOf('{', index)) + 1
  return css.slice(start, index).trim()
}

const gradientProblems = []
const blurProblems = []
let radiusLiterals = 0

for (const file of cssFiles(src)) {
  const css = strip(readFileSync(file, 'utf8'))
  const name = relative(root, file)
  const line = (i) => css.slice(0, i).split('\n').length

  for (const m of css.matchAll(/(?:linear|radial|conic)-gradient\(/g)) {
    const decl = declarationAt(css, m.index)
    if (/^(-webkit-)?mask(-image)?\s*:/.test(decl)) continue
    const selector = selectorAt(css, m.index)
    if (FUNCTIONAL_GRADIENTS.some((allowed) => selector.includes(allowed))) continue
    gradientProblems.push(`${name}:${line(m.index)} ${selector}`)
  }

  for (const m of css.matchAll(/(?:-webkit-)?backdrop-filter\s*:\s*([^;}]*)/g)) {
    const value = m[1].trim()
    if (value === 'var(--blur-over-page)' || value === 'var(--blur-note)' || value === 'none') continue
    blurProblems.push(`${name}:${line(m.index)} ${value}`)
  }

  for (const m of css.matchAll(/border-radius\s*:\s*([^;}]*)/g)) {
    if (/\d(px|rem|em)/.test(m[1]) && !m[1].includes('var(')) radiusLiterals += 1
  }
}

for (const problem of gradientProblems) console.log(`      decorative gradient: ${problem}`)
ok('no decorative gradients', gradientProblems.length === 0)

for (const problem of blurProblems) console.log(`      blur: ${problem}`)
ok('every backdrop-filter is a --blur-* token', blurProblems.length === 0)

console.log(`      ${radiusLiterals} border-radius literals left to bring onto --radius-*`)
const tokens = readFileSync(join(src, 'styles/tokens.css'), 'utf8')
ok('the radius scale is defined (soft: 4 / 8 / 12)',
  /--radius-sm:\s*4px/.test(tokens) && /--radius-md:\s*8px/.test(tokens) && /--radius-lg:\s*12px/.test(tokens) && /--radius-card:\s*12px/.test(tokens))

const index = readFileSync(join(src, 'index.css'), 'utf8')
ok('no prefers-color-scheme duplicates: data-theme is always set',
  cssFiles(src).every((file) => !readFileSync(file, 'utf8').includes('prefers-color-scheme')))
ok('no Vite starter colours left', !/#646cff|#535bf2|#747bff/i.test(index))
