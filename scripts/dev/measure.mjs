#!/usr/bin/env node
/**
 * measure.mjs — measure surfaces from the browser's computed styles and behaviour, for
 * the design review's audit (docs/design-review/audit.md). Screenshots show drift;
 * this says what exactly differs.
 *
 *   npm i --no-save playwright-core
 *   npm run dev                                       # in another terminal
 *   node scripts/dev/measure.mjs                      # → design-review/out/<run>/measure.json
 *   node scripts/dev/measure.mjs --only 'sheet-*' --run control
 *
 * Two kinds of measurement, both at desktop size in the light theme:
 *
 * - Overlays: every surface in design-review/surfaces.json with a `root` (its own
 *   element). Geometry, surface, type, header anatomy, close button, footer order,
 *   scrim and motion, each value named by the token it resolves to; then behaviour on
 *   fresh pages: where focus lands, whether Tab stays inside, whether Escape and a click
 *   outside close it, where focus goes after, whether the exit animates, and whether
 *   reduced motion stills it.
 * - Elements: the PROBES below (panel headers, empty states, toolbars and capsules).
 *
 * Takes --only, --run, --variant and --jobs as capture.mjs does, and the same
 * environment (BASE_URL, CHROMIUM, PLAYWRIGHT_CORE).
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { VIEWPORTS, cli, launch, pick, preparePage, repo } from './surfaces.mjs'

const { opt, opts } = cli()
const variant = opt('variant')
const sha = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: repo }).toString().trim() } catch { return 'nosha' } })()
const run = opt('run', sha)
const outDir = path.join(repo, 'design-review/out', run)
fs.mkdirSync(outDir, { recursive: true })

// Things that aren't overlays, measured where they show. `pick` chooses which matches:
// 'all' (every visible match), or 'first'.
const PROBES = [
  ...['editor-text', 'inspector-clipboard', 'inspector-notes', 'inspector-timeline', 'inspector-references', 'inspector-history', 'inspector-stats', 'typeset', 'typeset-print-export', 'typeset-history', 'map-blank', 'timeline-empty', 'canvas-card']
    .map((surface) => ({ family: 'panel', surface, kind: 'panel', selector: '.right-sidebar' })),
  ...['editor-text', 'inspector-clipboard', 'inspector-history', 'inspector-references', 'inspector-timeline', 'project-empty', 'editor-no-document', 'palette-empty', 'help-filtered', 'canvas-empty', 'timeline-empty', 'editor-new-tab', 'left-search', 'typeset-history']
    .map((surface) => ({ family: 'empty-state', surface, kind: 'empty' })),
  { family: 'toolbar', surface: 'editor-text', kind: 'bar', selector: '.app-titlebar' },
  { family: 'toolbar', surface: 'typeset', kind: 'bar', selector: '.app-titlebar' },
  { family: 'toolbar', surface: 'canvas-card', kind: 'bar', selector: '.app-titlebar' },
  { family: 'toolbar', surface: 'map-blank', kind: 'bar', selector: '.app-titlebar' },
  { family: 'toolbar', surface: 'timeline-empty', kind: 'bar', selector: '.app-titlebar' },
  { family: 'toolbar', surface: 'timeline-empty', kind: 'bar', selector: '.timeline-toolbar' },
  { family: 'toolbar', surface: 'editor-find', kind: 'bar', selector: '.find-bar' },
  { family: 'toolbar', surface: 'editor-table', kind: 'bar', selector: '.table-toolbar' },
  { family: 'toolbar', surface: 'timer-capsule', kind: 'bar', selector: '.timer-capsule' },
  { family: 'toolbar', surface: 'editor-page-view', kind: 'bar', selector: '.floating-capsule', pick: 'all' },
  { family: 'toolbar', surface: 'editor-locked', kind: 'bar', selector: '.floating-capsule', pick: 'all' },
  { family: 'toolbar', surface: 'editor-new-tab', kind: 'bar', selector: '.floating-capsule', pick: 'all' },
  { family: 'toolbar', surface: 'map-blank', kind: 'bar', selector: '.map-floating', pick: 'all' },
  { family: 'toolbar', surface: 'canvas-card', kind: 'bar', selector: '.canvas-toolbar', pick: 'all' },
]

/* ------------------------------------------------------------------ in the page */

// Runs in the browser. Defines window.__ibMeasure: computed styles named by the token
// they resolve to.
function installMeasure() {
  const TOKENS = {
    color: ['--menu-bg', '--popover-bg', '--surface-float', '--app-bg', '--control-bg', '--paper-2', '--text-primary', '--text-secondary', '--text-muted', '--text-subtle', '--border-color', '--menu-border', '--popover-border', '--accent-color', '--card-tint', '--scrim-bg', '--modal-overlay-bg', '--map-ui-bg'],
    shadow: ['--shadow-float', '--shadow-dialog', '--shadow-card', '--shadow-lift', '--shadow-popover', '--menu-shadow'],
    text: ['--text-2xs', '--text-xs', '--text-sm', '--text-md', '--text-lg', '--text-xl', '--text-2xl'],
    length: ['--radius-sm', '--radius-md', '--radius-lg', '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-8', '--control-h', '--control-h-sm', '--row-h', '--size-capsule', '--size-circle', '--size-toolbar'],
    time: ['--dur-instant', '--dur-fast', '--dur-base', '--dur-slow'],
    ease: ['--ease-out', '--ease-in', '--ease-in-out'],
    z: ['--z-chrome', '--z-panel', '--z-popover', '--z-dialog', '--z-toast', '--z-tooltip'],
  }
  const probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none'
  document.body.append(probe)
  const table = new Map()
  const resolve = (kind, name) => {
    const prop = { color: 'color', shadow: 'box-shadow', text: 'width', length: 'width', time: 'transition-duration', ease: 'transition-timing-function', z: 'z-index' }[kind]
    probe.style.setProperty(prop, `var(${name})`)
    const value = getComputedStyle(probe).getPropertyValue(prop)
    probe.style.removeProperty(prop)
    return value
  }
  for (const [kind, names] of Object.entries(TOKENS)) {
    for (const name of names) {
      const value = resolve(kind, name)
      if (!value) continue
      const key = `${kind}:${value}`
      if (!table.has(key)) table.set(key, [])
      table.get(key).push(name)
    }
  }
  const named = (kind, value) => {
    const hit = table.get(`${kind}:${value}`)
    return hit ? hit[0] : value
  }
  const px = (v) => (v.endsWith('px') ? named('length', v) : v)
  const box = (cs, side) => [cs[`${side}Top`], cs[`${side}Right`], cs[`${side}Bottom`], cs[`${side}Left`]].map(px).join(' ')
  const zOf = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.position !== 'static' && cs.zIndex !== 'auto') return named('z', cs.zIndex)
    }
    return 'auto'
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight
  }
  const label = (el) => {
    if (!el || el === document.body) return 'body'
    const text = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)
    return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/)[0]}` : ''}${text ? ` "${text}"` : ''}`
  }
  const font = (el) => {
    const cs = getComputedStyle(el)
    return `${named('text', cs.fontSize)} ${cs.fontWeight} ${cs.fontFamily.split(',')[0].replace(/"/g, '')} ${named('color', cs.color)}${cs.textTransform !== 'none' ? ` ${cs.textTransform}` : ''}`
  }
  const surface = (el) => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      el: label(el).split(' "')[0],
      size: `${Math.round(r.width)}×${Math.round(r.height)}`,
      radius: px(cs.borderTopLeftRadius),
      bg: named('color', cs.backgroundColor),
      border: cs.borderTopStyle === 'none' || cs.borderTopWidth === '0px' ? 'none' : `${cs.borderTopWidth} ${named('color', cs.borderTopColor)}`,
      shadow: cs.boxShadow === 'none' ? 'none' : named('shadow', cs.boxShadow),
      padding: box(cs, 'padding'),
      z: zOf(el),
      backdrop: cs.backdropFilter === 'none' ? 'none' : cs.backdropFilter,
      animation: cs.animationName === 'none' ? 'none' : `${cs.animationName} ${named('time', cs.animationDuration)} ${named('ease', cs.animationTimingFunction)}`,
    }
  }
  window.__ibMeasure = { named, label, font, surface, visible, px }
}

// Runs in the browser: an overlay's anatomy.
function overlayAnatomy(rootSelector) {
  const { label, font, surface, visible, px } = window.__ibMeasure
  const root = [...document.querySelectorAll(rootSelector)].find(visible)
  if (!root) return null
  const rr = root.getBoundingClientRect()
  const title = [...root.querySelectorAll('h1, h2, h3, .ib-title, [class*="title"]')].find(visible)
  const eyebrow = [...root.querySelectorAll('.ib-eyebrow')].find((e) => visible(e) && title && (e.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING) && e.getBoundingClientRect().top < title.getBoundingClientRect().top)
  const description = root.querySelector('.ib-dialog-description') || (title?.nextElementSibling?.tagName === 'P' ? title.nextElementSibling : null)
  const close = [...root.querySelectorAll('button')].find((b) => visible(b) && /^close\b/i.test(b.getAttribute('aria-label') || b.textContent.trim()))
  let closeAt = null
  if (close) {
    const r = close.getBoundingClientRect()
    closeAt = `${r.top - rr.top < 56 ? 'top' : 'bottom'}-${rr.right - r.right < 56 ? 'right' : r.left - rr.left < 56 ? 'left' : 'middle'}`
  }
  const footer = root.querySelector(':scope footer, .ib-dialog-footer')
  const buttons = [...(footer || root).querySelectorAll('.ui-button')].filter(visible)
  const footerButtons = (footer ? buttons : buttons.filter((b) => rr.bottom - b.getBoundingClientRect().bottom < 72))
    .map((b) => `${b.textContent.trim().replace(/\s+/g, ' ')} [${b.dataset.variant}]`)
  // A scrim: something fixed over the whole window that isn't the overlay.
  let scrim = null
  for (const [x, y] of [[3, innerHeight - 3], [innerWidth - 3, 3]]) {
    for (let e = document.elementFromPoint(x, y); e && e !== document.body; e = e.parentElement) {
      const r = e.getBoundingClientRect()
      if (e !== root && getComputedStyle(e).position === 'fixed' && r.width >= innerWidth - 2 && r.height >= innerHeight - 60 && !document.getElementById('root')?.contains(e)) {
        scrim = surface(e)
        break
      }
    }
    if (scrim) break
  }
  const labelledBy = root.getAttribute('aria-labelledby')
  return {
    rect: { x: Math.round(rr.x), y: Math.round(rr.y), width: Math.round(rr.width), height: Math.round(rr.height) },
    surface: surface(root),
    role: root.getAttribute('role') || root.querySelector('[role]')?.getAttribute('role') || 'none',
    ariaModal: root.getAttribute('aria-modal') === 'true',
    name: root.getAttribute('aria-label') || (labelledBy ? document.getElementById(labelledBy)?.textContent?.trim() : null) || null,
    duplicateTitleId: labelledBy ? document.querySelectorAll(`[id="${labelledBy}"]`).length > 1 : false,
    appInert: Boolean(document.getElementById('root')?.inert),
    header: {
      eyebrow: eyebrow ? `${eyebrow.textContent.trim()} (${font(eyebrow)})` : null,
      title: title ? `${title.textContent.trim().slice(0, 60)} (${font(title)})` : null,
      description: description ? `${description.textContent.trim().slice(0, 60)} (${font(description)})` : null,
      padding: title ? px(getComputedStyle(title.closest('header') || title.parentElement).paddingTop) : null,
    },
    close: close ? `${label(close)} at ${closeAt}` : null,
    footer: footerButtons,
    primaryAt: footerButtons.length ? (footerButtons.findIndex((b) => /\[filled\]|\[destructive\]/.test(b)) === footerButtons.length - 1 ? 'last' : footerButtons.some((b) => /\[filled\]|\[destructive\]/.test(b)) ? 'not last' : 'no primary') : null,
    scrim,
  }
}

/* ------------------------------------------------------------------ in node */

const browser = await launch()
const context = async (reducedMotion = 'no-preference') => browser.newContext({ ...VIEWPORTS.desktop, colorScheme: 'light', reducedMotion })

async function opened(surface, reducedMotion) {
  const ctx = await context(reducedMotion)
  const page = await ctx.newPage()
  const go = await preparePage(page, surface, { variant })
  const steps = surface.steps
  await go(steps.slice(0, -1))
  await page.evaluate(installMeasure)
  // Mark where focus was before the last step, to see whether it comes back.
  await page.evaluate(() => document.activeElement?.setAttribute('data-measure-opener', ''))
  const opener = await page.evaluate(() => window.__ibMeasure?.label(document.activeElement) ?? document.activeElement?.tagName)
  await go(steps.slice(-1))
  await page.waitForTimeout(700)
  await page.evaluate(installMeasure)
  return { ctx, page, opener }
}

const isOpen = (page, root) => page.evaluate((sel) => [...document.querySelectorAll(sel)].some((e) => window.__ibMeasure.visible(e)), root)

async function measureOverlay(surface) {
  const out = { id: surface.id, family: surface.family, title: surface.title, root: surface.root }
  // 1. Anatomy, focus on open, and Tab.
  {
    const { ctx, page } = await opened(surface)
    try {
      Object.assign(out, await page.evaluate(overlayAnatomy, surface.root))
      const where = () => page.evaluate((sel) => {
        const root = [...document.querySelectorAll(sel)].find((e) => window.__ibMeasure.visible(e))
        const a = document.activeElement
        return { at: window.__ibMeasure.label(a), inside: Boolean(root && a && root.contains(a)) }
      }, surface.root)
      out.focusOnOpen = await where()
      const trail = []
      for (let i = 0; i < 24; i++) { await page.keyboard.press('Tab'); trail.push(await where()) }
      const left = trail.find((t) => !t.inside)
      out.tabTrapped = !left
      out.tabLeavesTo = left ? left.at : null
    } finally { await ctx.close() }
  }
  // 2. Escape, the exit, and where focus goes.
  {
    const { ctx, page, opener } = await opened(surface)
    try {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(40)
      const stillThereAt40 = await isOpen(page, surface.root)
      await page.waitForTimeout(500)
      out.escapeCloses = !(await isOpen(page, surface.root))
      out.exit = !out.escapeCloses ? null : stillThereAt40 ? 'animated' : 'instant'
      out.focusAfterClose = out.escapeCloses
        ? await page.evaluate(() => (document.activeElement?.hasAttribute('data-measure-opener') ? 'returned to opener' : window.__ibMeasure.label(document.activeElement)))
        : null
      out.opener = opener
    } finally { await ctx.close() }
  }
  // 3. A click outside, with reduced motion on.
  {
    const { ctx, page } = await opened(surface, 'reduce')
    try {
      out.reducedMotion = await page.evaluate((sel) => {
        const root = [...document.querySelectorAll(sel)].find((e) => window.__ibMeasure.visible(e))
        const cs = getComputedStyle(root)
        const ms = parseFloat(cs.animationDuration) * (cs.animationDuration.endsWith('ms') ? 1 : 1000)
        return cs.animationName === 'none' || ms <= 1 ? 'still' : `animates ${cs.animationDuration}`
      }, surface.root)
      const r = await page.locator(`${surface.root} >> visible=true`).first().boundingBox()
      const x = r.x > 80 ? r.x - 40 : Math.min(r.x + r.width + 40, 1390)
      const y = Math.min(Math.max(r.y + r.height / 2, 60), 880)
      await page.mouse.click(x, y)
      await page.waitForTimeout(500)
      out.outsideClickCloses = !(await isOpen(page, surface.root))
    } finally { await ctx.close() }
  }
  return out
}

async function measureProbe(probe) {
  const surface = pick([probe.surface])[0]
  const ctx = await context()
  const page = await ctx.newPage()
  try {
    const go = await preparePage(page, surface, { variant })
    await go(surface.steps)
    await page.waitForTimeout(700)
    await page.evaluate(installMeasure)
    const found = await page.evaluate(({ kind, selector, pick }) => {
      const { label, font, surface: surf, visible, named } = window.__ibMeasure
      const sizes = (els) => [...new Set(els.filter(visible).map((e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.width)}×${Math.round(r.height)}` }))]
      if (kind === 'empty') {
        // EmptyState instances, and anything else that says a place is empty.
        const said = /^(no |nothing|the workbench is empty|create a new|double-click|loading)/i
        const candidates = [...document.querySelectorAll('.ib-empty'), ...[...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && said.test(e.textContent.trim()) && !e.closest('.ib-empty'))]
        return candidates.filter(visible).map((e) => {
          const isPrimitive = e.classList.contains('ib-empty')
          const title = isPrimitive ? e.querySelector('.ib-empty-title') : e
          const hint = isPrimitive ? e.querySelector('.ib-empty-hint') : null
          const icon = (isPrimitive ? e : e.parentElement).querySelector('svg')
          return {
            primitive: isPrimitive ? `EmptyState${e.classList.contains('ib-empty--compact') ? ' compact' : ''}` : 'bespoke',
            where: label(e.closest('.right-sidebar, .left-sidebar, .ib-dialog, .ib-palette, .canvas-pane, .timeline-view, [class*="pane"]') || e.parentElement).split(' "')[0],
            title: title ? `${title.textContent.trim().slice(0, 50)} (${font(title)})` : null,
            hint: hint ? `${hint.textContent.trim().slice(0, 50)} (${font(hint)})` : null,
            icon: icon && visible(icon) ? `${Math.round(icon.getBoundingClientRect().width)}px` : null,
            align: getComputedStyle(title || e).textAlign,
          }
        })
      }
      const els = [...document.querySelectorAll(selector)].filter(visible)
      return (pick === 'all' ? els : els.slice(0, 1)).map((root) => {
        const base = surf(root)
        if (kind === 'bar') {
          const controls = [...root.querySelectorAll('button, input, select, [role="button"]')]
          return {
            ...base,
            text: root.textContent.trim().replace(/\s+/g, ' ').slice(0, 40),
            controlSizes: sizes(controls),
            controlRadii: [...new Set(controls.filter(visible).map((c) => named('length', getComputedStyle(c).borderTopLeftRadius)))],
            iconSizes: [...new Set([...root.querySelectorAll('svg')].filter(visible).map((s) => `${Math.round(s.getBoundingClientRect().width)}`))],
            gap: getComputedStyle(root).gap === 'normal' ? 'none' : getComputedStyle(root).gap,
          }
        }
        // A panel: its header row, what comes first, and how many ways it sets type.
        const header = root.querySelector('.inspector-header')
        // The title track holds every tab's label; the one showing sits inside its box.
        const track = root.querySelector('.right-sidebar-global-title')?.getBoundingClientRect()
        const title = [...root.querySelectorAll('.panel-header-label')].find((l) => {
          const r = l.getBoundingClientRect()
          return visible(l) && (!track || (r.left >= track.left - 1 && r.right <= track.right + 1 && r.top >= track.top - 1 && r.bottom <= track.bottom + 1))
        })
        const body = [...root.querySelectorAll('.ib-segmented, [class*="segmented"], .ui-section, .ib-empty, .ui-form-row')].filter(visible)
        const textEls = [...root.querySelectorAll('*')].filter((e) => visible(e) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
        const actions = header ? [...header.querySelectorAll('button[aria-label]')].filter(visible).map((b) => b.getAttribute('aria-label')).filter((l) => !/^switch to/i.test(l)) : []
        return {
          title: title ? `${title.textContent.trim()} (${font(title)})` : null,
          headerActions: actions.filter((a) => !/^(clipboard|workbench|notes|timeline|references|history|stats|typeset|print & export|map)$/i.test(a)),
          segmented: body.filter((e) => /segmented/.test(e.className)).length,
          sections: body.filter((e) => e.classList.contains('ui-section')).length,
          formRows: body.filter((e) => e.classList.contains('ui-form-row')).length,
          firstBlock: body[0] ? label(body[0]).split(' "')[0] : null,
          typeStyles: [...new Set(textEls.map((e) => font(e).split(' ').slice(0, 3).join(' ')))].sort(),
          controlSizes: sizes([...root.querySelectorAll('.inspector-body button, .inspector-body input, .inspector-body select, button, input, select')].filter((e) => !e.closest('.inspector-header, .sidebar-topbar'))),
        }
      })
    }, probe)
    return { ...probe, found }
  } catch (error) {
    return { ...probe, error: error.message.split('\n')[0] }
  } finally { await ctx.close() }
}

const globs = opts('only')
const overlays = pick(globs).filter((s) => s.root)
const probes = PROBES.filter((p) => !globs.length || pick(globs).some((s) => s.id === p.surface))
const tasks = [...overlays.map((s) => () => measureOverlay(s).catch((e) => ({ id: s.id, error: e.message.split('\n')[0] }))), ...probes.map((p) => () => measureProbe(p))]
const results = []
let next = 0
await Promise.all(Array.from({ length: Number(opt('jobs', 4)) }, async () => {
  while (next < tasks.length) {
    const i = next++
    results[i] = await tasks[i]()
    console.log(`${results[i].error ? 'FAIL' : 'ok  '} ${results[i].id ?? `${results[i].surface} ${results[i].selector ?? results[i].kind}`}${results[i].error ? `  ${results[i].error}` : ''}`)
  }
}))
await browser.close()

const file = path.join(outDir, 'measure.json')
const report = {
  run,
  sha,
  date: new Date().toISOString(),
  overlays: results.slice(0, overlays.length),
  elements: results.slice(overlays.length),
}
fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
console.log(`\n${overlays.length} overlays and ${probes.length} element probes → ${path.relative(repo, file)}`)
