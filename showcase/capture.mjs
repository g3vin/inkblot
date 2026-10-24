#!/usr/bin/env node
/**
 * capture.mjs — everything the website shows of the app, captured from the app itself.
 *
 *   npm run showcase                         # every shot, into showcase/out/
 *   npm run showcase -- --only editor        # one shot
 *   npm run showcase -- --stills-only        # skip loops (CI: checks every shot still runs)
 *   npm run showcase -- --dev --log          # dev server, and print every bridge call
 *
 * Each shot in shots.mjs is driven in WebKit against the showcase mock and the sample
 * book (fixtures/), then encoded for the web:
 *
 *   still  AVIF + WebP at 1× and 2×
 *   loop   MP4 (H.264) + WebM (VP9), seamless (the end crossfades into the start, unless
 *          the shot ends where it began: `seam: 0`), and a WebP poster from its first
 *          frame. Over the size budget, it is re-encoded smaller; still over at the
 *          smallest, the run fails. Its `marks` (h.mark) say when each step happens, and
 *          `rest` names the mark whose frame stands in for it without motion.
 *   sequence  the frames of a short recording, cropped to `h.focus`, as numbered WebPs:
 *          for a page to play by scrolling, forward and back.
 *
 * out/manifest.json lists every file with the app's version, commit and changelog. The
 * release workflow zips out/ as site-content.zip and the website builds from it.
 *
 * Needs playwright-core with WebKit (see session.mjs) and ffmpeg with libx264, libvpx-vp9
 * and libaom-av1 (libwebp too, or `cwebp` on the PATH).
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { SHOTS } from './shots.mjs'
import { book } from './fixtures/books.mjs'
import { loadPlaywright, openPage, repo, serve } from './session.mjs'
import { parseChangelog } from './changelog.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

const OUT = path.resolve(option('--out') || path.join(here, 'out'))
const MEDIA = path.join(OUT, 'media')
const TMP = path.join(here, '.tmp')
const only = option('--only')?.split(',')
const stillsOnly = flag('--stills-only')

/** The loop size budget (design-iterations/final/ASSETS.md in the site: "Loop under 3 MB"). */
const LOOP_BUDGET = 3 * 1024 * 1024
/** A still's budget, per file. */
const STILL_BUDGET = 600 * 1024
/** Crossfade from a loop's end into its start, in seconds. */
const SEAM = 0.5
/** A sequence's frame rate, and its budget for all its frames together. */
const SEQUENCE_FPS = 24
const SEQUENCE_BUDGET = 3 * 1024 * 1024

const shots = SHOTS.filter((s) => (!only || only.includes(s.id)) && !(stillsOnly && s.kind !== 'still'))
if (only && shots.length !== only.length) {
  console.error(`Unknown shot: ${only.filter((id) => !SHOTS.some((s) => s.id === id)).join(', ')}`)
  process.exit(1)
}

/* ---------------- encoding ---------------- */

const ffmpeg = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: ['ignore', 'ignore', 'inherit'] })
const encoders = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' })
const has = (name) => encoders.includes(` ${name} `)
for (const need of ['libx264', 'libvpx-vp9', 'libaom-av1']) {
  if (!has(need)) { console.error(`ffmpeg has no ${need} encoder.`); process.exit(2) }
}
const size = (file) => fs.statSync(file).size
const rel = (file) => path.relative(OUT, file).split(path.sep).join('/')

function webp(input, output, width, quality = 82) {
  if (has('libwebp')) return ffmpeg('-i', input, '-frames:v', '1', '-vf', `scale=${width}:-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', String(quality), output)
  const scaled = `${output}.png`
  ffmpeg('-i', input, '-frames:v', '1', '-vf', `scale=${width}:-2:flags=lanczos`, scaled)
  execFileSync('cwebp', ['-quiet', '-q', String(quality), scaled, '-o', output])
  fs.rmSync(scaled)
}

function avif(input, output, width, crf = 30) {
  ffmpeg('-i', input, '-frames:v', '1', '-vf', `scale=${width}:-2:flags=lanczos,format=yuv420p`, '-c:v', 'libaom-av1', '-still-picture', '1', '-crf', String(crf), '-cpu-used', '4', output)
}

/** A still: AVIF and WebP at 1× and 2×. */
function encodeStill(png, base, dims) {
  const images = []
  for (const scale of [1, 2]) {
    // Even widths: the encoders work in 4:2:0.
    const width = 2 * Math.round((dims.width * scale) / 2)
    const out = { width, avif: `${base}@${scale}x.avif`, webp: `${base}@${scale}x.webp` }
    avif(png, out.avif, width)
    webp(png, out.webp, width)
    for (const file of [out.avif, out.webp]) {
      if (size(file) > STILL_BUDGET) throw new Error(`${rel(file)} is ${(size(file) / 1024).toFixed(0)} KB, over the ${STILL_BUDGET / 1024} KB budget`)
    }
    images.push({ width, avif: rel(out.avif), webp: rel(out.webp), bytes: size(out.avif) })
  }
  return { width: dims.width, height: dims.height, images }
}

/**
 * A loop: cut [lead, lead + seconds] from the recording and fold its last SEAM seconds
 * over its first, so the end runs into the start. The result is seconds − SEAM long.
 */
/**
 * A camera move for a loop: zoompan, eased between the shot's zoom keyframes
 * ({ t, over, rect } — a rect to frame, or null for the whole window). `in` is the
 * frame number at 30 fps from the loop's start.
 */
function zoomFilter(zooms, { width: W, height: H }) {
  if (!zooms?.length) return ''
  const states = [{ t: 0, over: 1, z: 1, cx: W / 2, cy: H / 2 }]
  for (const { t, over, rect } of zooms) {
    states.push(rect
      ? { t, over, z: Math.min(W / rect.width, H / rect.height), cx: rect.x + rect.width / 2, cy: rect.y + rect.height / 2 }
      : { t, over, z: 1, cx: W / 2, cy: H / 2 })
  }
  const T = 'in/30'
  const eased = (key) => {
    let expr = `${states[0][key]}`
    for (let i = 1; i < states.length; i++) {
      const a = states[i - 1][key].toFixed(4)
      const delta = (states[i][key] - states[i - 1][key]).toFixed(4)
      const u = `clip((${T}-${states[i].t.toFixed(3)})/${states[i].over},0,1)`
      expr = `if(lt(${T},${states[i].t.toFixed(3)}),${expr},${a}+${delta}*${u}*${u}*(3-2*${u}))`
    }
    return expr
  }
  return `,zoompan=z='${eased('z')}'` +
    `:x='max(0,min(iw-iw/zoom,${eased('cx')}-iw/zoom/2))'` +
    `:y='max(0,min(ih-ih/zoom,${eased('cy')}-ih/zoom/2))'` +
    `:d=1:s=${W}x${H}:fps=30`
}

function encodeLoop(recording, base, { lead, seconds, viewport, zooms, seam: fold = SEAM, marks = {}, rest }) {
  // The loop is cut (and any camera move made) first, then its last `fold` seconds are
  // folded over its first. The recording's frame rate varies; xfade needs one rate.
  const cut = `[0]trim=start=${lead}:end=${lead + seconds},setpts=PTS-STARTPTS,fps=30${zoomFilter(zooms, viewport)}`
  const seam = fold > 0
    ? `${cut},split[x][y];` +
      `[x]trim=start=${fold},setpts=PTS-STARTPTS,fps=30[a];` +
      `[y]trim=end=${fold},setpts=PTS-STARTPTS,fps=30[b];` +
      `[a][b]xfade=transition=fade:duration=${fold}:offset=${seconds - 2 * fold},format=yuv420p[v]`
    : `${cut},format=yuv420p[v]`
  const master = path.join(TMP, `${path.basename(base)}.master.mkv`)
  ffmpeg('-i', recording, '-filter_complex', seam, '-map', '[v]', '-c:v', 'libx264', '-crf', '12', '-preset', 'veryfast', master)
  // Folding moves the loop's clock back by `fold`: what happened at t now plays at t − fold.
  const shift = (t) => +Math.max(0, t - fold).toFixed(2)

  const mp4 = `${base}.mp4`
  const webm = `${base}.webm`
  const fit = (encode, file) => {
    for (const quality of [0, 1, 2, 3, 4]) {
      encode(quality)
      if (size(file) <= LOOP_BUDGET) return
    }
    throw new Error(`${rel(file)} is ${(size(file) / 1048576).toFixed(1)} MB even at the lowest quality, over the 3 MB budget. Shorten the loop or calm it down.`)
  }
  fit((q) => ffmpeg('-i', master, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(24 + q * 3), '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4), mp4)
  fit((q) => ffmpeg('-i', master, '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(36 + q * 4), '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', webm), webm)

  const poster = `${base}.poster.webp`
  webp(master, poster, viewport.width)
  // The frame that stands for the loop where nothing moves (reduced motion).
  let still = null
  if (rest) {
    if (marks[rest] == null) throw new Error(`rest names "${rest}", but the run never marked it`)
    const frame = path.join(TMP, `${path.basename(base)}.rest.png`)
    ffmpeg('-ss', String(shift(marks[rest])), '-i', master, '-frames:v', '1', frame)
    const out = { avif: `${base}.rest.avif`, webp: `${base}.rest.webp` }
    avif(frame, out.avif, viewport.width)
    webp(frame, out.webp, viewport.width)
    still = { avif: rel(out.avif), webp: rel(out.webp) }
  }
  fs.rmSync(master)
  return {
    width: viewport.width,
    height: viewport.height,
    seconds: seconds - fold,
    mp4: rel(mp4),
    webm: rel(webm),
    poster: rel(poster),
    ...(Object.keys(marks).length ? { marks: Object.fromEntries(Object.entries(marks).map(([k, t]) => [k, shift(t)])) } : {}),
    ...(still ? { rest: still } : {}),
    bytes: size(mp4),
  }
}

/**
 * A sequence: [lead, lead + seconds] of the recording, cropped to `focus` (CSS px, at 1×:
 * WebKit records at 1× whatever the scale), as numbered WebPs at SEQUENCE_FPS.
 */
function encodeSequence(recording, base, { lead, seconds, viewport, focus }) {
  if (!focus) throw new Error('a sequence needs h.focus(rect) to say what to keep')
  const crop = roundRect(focus)
  crop.width -= crop.width % 2
  crop.height -= crop.height % 2
  const dir = base
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const frames = path.join(TMP, `${path.basename(base)}-%04d.png`)
  ffmpeg('-i', recording, '-vf', `trim=start=${lead}:end=${lead + seconds},setpts=PTS-STARTPTS,fps=${SEQUENCE_FPS},crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`, frames)
  const pngs = fs.readdirSync(TMP).filter((f) => f.startsWith(`${path.basename(base)}-`) && f.endsWith('.png')).sort()
  let total = 0
  for (const [i, png] of pngs.entries()) {
    const out = path.join(dir, `${String(i + 1).padStart(4, '0')}.webp`)
    webp(path.join(TMP, png), out, crop.width, 78)
    total += size(out)
    fs.rmSync(path.join(TMP, png))
  }
  if (total > SEQUENCE_BUDGET) throw new Error(`${rel(dir)} is ${(total / 1048576).toFixed(1)} MB, over the 3 MB budget. Shorten it or keep less of the window.`)
  return {
    width: crop.width,
    height: crop.height,
    window: { width: viewport.width, height: viewport.height },
    focus: crop,
    fps: SEQUENCE_FPS,
    frames: pngs.length,
    pattern: `${rel(dir)}/%04d.webp`,
    bytes: total,
  }
}

/* ---------------- capture ---------------- */

const roundRect = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) })

async function captureOne(browser, url, shot, theme) {
  const fixture = book(shot.fixture)
  const prefs = { ...fixture.prefs, ...shot.prefs, 'inkblot-theme': theme, ...(shot.accent ? { 'inkblot-accent-color': shot.accent } : {}) }
  const loop = shot.kind !== 'still'
  const videoDir = path.join(TMP, `${shot.id}-${theme}`)
  const started = Date.now()
  const { context, page, errors } = await openPage(browser, url, {
    files: fixture.files,
    prefs,
    ipc: shot.ipc,
    routes: shot.routes,
    viewport: shot.viewport,
    scale: loop ? 1 : 2,
    video: loop ? videoDir : undefined,
    cursor: shot.cursor,
    log: flag('--log'),
  })
  let recordAt = null
  const zooms = []
  const marks = {}
  let focus = null
  // Where the pointer is (Playwright doesn't say), for glides from it.
  let hand = { x: shot.viewport.width - 4, y: shot.viewport.height - 4 }
  const now = () => (Date.now() - started) / 1000 - recordAt
  const h = {
    /** Everything from here on is the loop. */
    record: async () => { recordAt = (Date.now() - started) / 1000 },
    /** Wait until `s` seconds into the loop. */
    until: async (s) => {
      const left = recordAt + s - (Date.now() - started) / 1000
      if (left < 0) console.warn(`  ${shot.id}: the script ran ${(-left).toFixed(1)} s past ${s} s; the loop is cut there`)
      else await page.waitForTimeout(left * 1000)
    },
    /** From now, move the camera in to frame `rect` (CSS px) over `over` seconds. */
    zoom: (rect, over = 1.2) => { zooms.push({ t: now(), over, rect }) },
    /** From now, back out to the whole window. */
    zoomOut: (over = 1.2) => { zooms.push({ t: now(), over, rect: null }) },
    /** Note that step `name` happens now, or at `at` (a Date.now()); the site times its captions by these. */
    mark: (name, at = Date.now()) => { marks[name] = (at - started) / 1000 - recordAt },
    /** What a sequence keeps of the window (CSS px). */
    focus: (rect) => { focus = rect },
    /** Put the pointer at `to` at once. */
    point: async (to) => { hand = { ...to }; await page.mouse.move(to.x, to.y) },
    /** Move the pointer to `to` as a hand does: easing in and out, over `seconds`. */
    glide: async (to, seconds = 0.8) => {
      const from = hand
      const steps = Math.max(2, Math.round(seconds * 60))
      const t0 = Date.now()
      for (let i = 1; i <= steps; i++) {
        const u = i / steps, k = u * u * (3 - 2 * u)
        await page.mouse.move(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k)
        const wait = t0 + (seconds * 1000 * i) / steps - Date.now()
        if (wait > 0) await page.waitForTimeout(wait)
      }
      hand = { ...to }
    },
  }
  try {
    await shot.run(page, h)
  } catch (error) {
    await page.screenshot({ path: path.join(TMP, `${shot.id}-${theme}.failed.png`) }).catch(() => {})
    await context.close()
    throw new Error(`Shot "${shot.id}" (${theme}) failed: ${error.message.split('\n')[0]}\n  Last frame: showcase/.tmp/${shot.id}-${theme}.failed.png`, { cause: error })
  }
  if (errors.length) console.warn(`  ${shot.id}: the page threw ${errors.length} error(s): ${errors[0]}`)

  const base = path.join(MEDIA, `${shot.id}-${theme}`)
  if (!loop) {
    const png = path.join(TMP, `${shot.id}-${theme}.png`)
    await page.mouse.move(0, shot.viewport.height - 1)
    // A shot may keep only part of the window (`clip`), e.g. a passage and its note.
    const clip = shot.clip ? roundRect(await shot.clip(page)) : null
    await page.screenshot({ path: png, ...(clip ? { clip } : {}) })
    await context.close()
    return encodeStill(png, base, clip ?? shot.viewport)
  }
  if (recordAt == null) throw new Error(`${shot.kind} "${shot.id}" never called h.record()`)
  const video = page.video()
  await context.close()
  const recording = await video.path()
  if (shot.kind === 'sequence') return encodeSequence(recording, base, { lead: recordAt, seconds: shot.seconds, viewport: shot.viewport, focus })
  return encodeLoop(recording, base, { lead: recordAt, seconds: shot.seconds, viewport: shot.viewport, zooms, seam: shot.seam, marks, rest: shot.rest })
}

const git = (...a) => { try { return execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null } }

const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'))
const changelog = parseChangelog(fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8'))
const tag = process.env.SHOWCASE_TAG || git('describe', '--tags', '--exact-match') || `v${pkg.version}`
const released = changelog.find((r) => r.version === pkg.version)

fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })
if (!only) fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(MEDIA, { recursive: true })

const { webkit } = await loadPlaywright()
const server = await serve({ dev: flag('--dev') })
const browser = await webkit.launch()

const manifestFile = path.join(OUT, 'manifest.json')
const previous = only && fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')).shots : {}
const results = { ...previous }
let failed = 0
try {
  for (const shot of shots) {
    const entry = { kind: shot.kind, aspect: null, themes: {} }
    for (const theme of shot.themes) {
      const t = Date.now()
      try {
        entry.themes[theme] = await captureOne(browser, server.url, shot, theme)
        entry.aspect ??= `${entry.themes[theme].width} / ${entry.themes[theme].height}`
        console.log(`✓ ${shot.id} · ${theme} (${((Date.now() - t) / 1000).toFixed(0)} s)`)
      } catch (error) {
        failed++
        console.error(`✗ ${error.message}`)
      }
    }
    results[shot.id] = entry
  }
} finally {
  await browser.close()
  await server.close()
}

const manifest = {
  schema: 1,
  app: {
    version: pkg.version,
    tag,
    date: released?.date ?? null,
    // In CI's container git may be missing or refuse the checkout; the workflow passes the commit.
    commit: process.env.SHOWCASE_COMMIT || git('rev-parse', 'HEAD'),
    capturedAt: new Date().toISOString(),
  },
  changelog: changelog.filter((r) => r.version !== 'Unreleased'),
  shots: results,
}
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)
if (failed) {
  console.error(`\n${failed} capture(s) failed.`)
  process.exit(1)
}
fs.rmSync(TMP, { recursive: true, force: true })
console.log(`\n${Object.keys(results).length} shot(s) → ${path.relative(process.cwd(), OUT)}/`)
