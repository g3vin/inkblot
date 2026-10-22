/**
 * After an update (releaseNotes.ts, UpdateBanner.jsx).
 *
 *   - once per version: a first launch shows nothing, a new version shows the banner,
 *     and it is not shown again for that version;
 *   - highlights read from a release's Markdown, under headings or by commit prefix,
 *     without credits and links;
 *   - a release that cannot be read still gives the version and the releases page;
 *   - the banner lists what was added and fixed, links to the release, and dismisses.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { setInvokeHandler } from './stub-core.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true

setInvokeHandler(async (command) => (command === 'preferences_load' ? { app: {} } : null))
const prefs = await import('../../src/lib/preferences.ts')
if (!prefs.isHydrated()) await prefs.hydratePreferences()
const R = await import('../../src/lib/releaseNotes.ts')

/* ---------------- once per version ---------------- */

prefs.removePreference(R.LAST_SEEN_VERSION_KEY)
ok('a first launch is not an update', R.updatedVersion('0.1.0') === null)
ok('and remembers the version', prefs.getPreference(R.LAST_SEEN_VERSION_KEY) === '0.1.0')
ok('the same version again is not an update', R.updatedVersion('0.1.0') === null)
ok('a new version is', R.updatedVersion('0.2.0') === '0.2.0')
R.markVersionSeen('0.2.0')
ok('and once seen, is not again', R.updatedVersion('0.2.0') === null)
ok('no version, nothing to say', R.updatedVersion(null) === null)

/* ---------------- highlights ---------------- */

const body = [
  '## What’s new',
  '- Lock documents so they are read-only',
  '* Rebind any shortcut by @g3vin in https://github.com/g3vin/inkblot/pull/80',
  '',
  '### Bug fixes',
  '- [Tables](https://example.com) keep their widths',
  '',
  '## Other',
  '- Bumped a dependency',
].join('\n')
const read = R.readHighlights(body)
ok('bullets under a "new" heading are added', read.added.join('|') === 'Lock documents so they are read-only|Rebind any shortcut')
ok('under a "fixes" heading, fixed, links made text', read.fixed.join('|') === 'Tables keep their widths')
ok('other sections are left out', !JSON.stringify(read).includes('dependency'))
const commits = R.readHighlights('- feat(editor): table toolbar\n- fix: the caret in split view\n- chore: tidy')
ok('without headings, commit prefixes say which', commits.added[0] === 'Table toolbar' && commits.fixed[0] === 'The caret in split view' && commits.added.length === 1)
ok('at most four of each', R.readHighlights(Array.from({ length: 9 }, (_, i) => `- feat: thing ${i}`).join('\n')).added.length === 4)

/* ---------------- fetching ---------------- */

let asked = ''
const found = await R.fetchReleaseNotes('0.2.0', async (url) => {
  asked = url
  return { ok: true, json: async () => ({ html_url: 'https://github.com/x/y/releases/tag/v0.2.0', body }) }
})
ok('asks for the version’s tag', asked.endsWith('/releases/tags/v0.2.0'))
ok('and takes its page and highlights', found.url.endsWith('v0.2.0') && found.added.length === 2 && found.fixed.length === 1)
const missing = await R.fetchReleaseNotes('0.3.0', async () => ({ ok: false }))
ok('a release not there gives the releases page', missing.url === R.RELEASES_URL && !missing.added.length)
const offline = await R.fetchReleaseNotes('0.3.0', async () => { throw new Error('offline') })
ok('offline, the same', offline.url === R.RELEASES_URL && offline.version === '0.3.0')

/* ---------------- the banner ---------------- */

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: UpdateBanner } = await import('../../src/components/UpdateBanner.jsx')

const notes = { version: '0.4.0', url: 'https://github.com/x/y/releases/tag/v0.4.0', added: ['Folder types'], fixed: ['The tab bar'] }
const getVersion = async () => '0.4.0'
const loadNotes = async () => notes
const root = createRoot(document.getElementById('root'))
await act(async () => root.render(React.createElement(UpdateBanner, { getVersion, loadNotes })))
const banner = () => document.querySelector('.update-banner')
ok('after an update, the banner shows', banner()?.textContent.includes('Updated to 0.4.0'))
ok('with what was added and fixed', banner().textContent.includes('Folder types') && banner().textContent.includes('The tab bar'))
ok('and is marked seen', prefs.getPreference(R.LAST_SEEN_VERSION_KEY) === '0.4.0')
await act(async () => { banner().querySelector('[aria-label="Dismiss"]').click() })
ok('Dismiss closes it', !banner())
await act(async () => root.unmount())

const again = createRoot(document.getElementById('root'))
await act(async () => again.render(React.createElement(UpdateBanner, { getVersion, loadNotes })))
ok('the next launch of the same version shows nothing', !banner())
await act(async () => again.unmount())
