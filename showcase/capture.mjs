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
 *   loop   MP4 (H.264) + WebM (VP9), seamless (the end crossfades into the start), and a
 *          WebP poster from its first frame. Over the size budget, it is re-encoded
 *          smaller; still over at the smallest, the run fails.
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
import { book } from './fixtures/lighthouse-keeper.mjs'
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

const shots = SHOTS.filter((s) => (!only || only.includes(s.id)) && !(stillsOnly && s.kind === 'loop'))
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
function encodeLoop(recording, base, { lead, seconds, viewport }) {
  // The recording's frame rate varies; xfade needs both sides at one constant rate.
  const seam = `[0]split[x][y];` +
    `[x]trim=start=${lead + SEAM}:end=${lead + seconds},setpts=PTS-STARTPTS,fps=30[a];` +
    `[y]trim=start=${lead}:end=${lead + SEAM},setpts=PTS-STARTPTS,fps=30[b];` +
    `[a][b]xfade=transition=fade:duration=${SEAM}:offset=${seconds - 2 * SEAM},format=yuv420p[v]`
  const master = path.join(TMP, `${path.basename(base)}.master.mkv`)
  ffmpeg('-i', recording, '-filter_complex', seam, '-map', '[v]', '-c:v', 'libx264', '-crf', '12', '-preset', 'veryfast', master)

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
  fs.rmSync(master)
  return {
    width: viewport.width,
    height: viewport.height,
    seconds: seconds - SEAM,
    mp4: rel(mp4),
    webm: rel(webm),
    poster: rel(poster),
    bytes: size(mp4),
  }
}

/* ---------------- capture ---------------- */

const roundRect = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) })

async function captureOne(browser, url, shot, theme) {
  const fixture = book(shot.fixture)
  const prefs = { ...fixture.prefs, 'inkblot-theme': theme, ...(shot.accent ? { 'inkblot-accent-color': shot.accent } : {}) }
  const loop = shot.kind === 'loop'
  const videoDir = path.join(TMP, `${shot.id}-${theme}`)
  const started = Date.now()
  const { context, page, errors } = await openPage(browser, url, {
    files: fixture.files,
    prefs,
    viewport: shot.viewport,
    scale: loop ? 1 : 2,
    video: loop ? videoDir : undefined,
    log: flag('--log'),
  })
  let recordAt = null
  const h = {
    /** Everything from here on is the loop. */
    record: async () => { recordAt = (Date.now() - started) / 1000 },
    /** Wait until `s` seconds into the loop. */
    until: async (s) => {
      const left = recordAt + s - (Date.now() - started) / 1000
      if (left < 0) console.warn(`  ${shot.id}: the script ran ${(-left).toFixed(1)} s past ${s} s; the loop is cut there`)
      else await page.waitForTimeout(left * 1000)
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
  if (recordAt == null) throw new Error(`Loop "${shot.id}" never called h.record()`)
  const video = page.video()
  await context.close()
  return encodeLoop(await video.path(), base, { lead: recordAt, seconds: shot.seconds, viewport: shot.viewport })
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
    commit: git('rev-parse', 'HEAD'),
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
