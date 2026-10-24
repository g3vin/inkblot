/**
 * Content arriving (src/ui/Reveal.jsx, revealState.js): a quick load never shows a
 * skeleton, a slow one shows it late and holds it long enough not to flicker, a gate
 * holds its pieces until all have reported, and the file layer and the prefetch that
 * feed them read what they should, once.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { files } from './stub-fs.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'DOMParser',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent',
  'MutationObserver', 'getComputedStyle'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { RevealGate } = await import('../../src/ui/Reveal.jsx')
const { useReveal, useRevealOnChange, useRevealReady } = await import('../../src/ui/revealState.js')
const { REVEAL } = await import('../../src/ui/motion.js')
const { listProjectTree, listProjects, loadDocument, saveDocument } = await import('../../src/lib/FileSystem.js')
const { prefetchProject, readDocument, recallProjects, rememberProjects } = await import('../../src/lib/projectPrefetch.js')
const { default: VersionComparePane } = await import('../../src/components/VersionComparePane.jsx')

const h = React.createElement
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// In small steps: act() holds back the renders a timer causes until it returns, and
// one long act would let timers that race each other in the page all land at once.
const settle = async (ms) => {
  for (let left = ms; left > 0; left -= 10) await act(async () => { await wait(Math.min(10, left)) })
}

/** Mount one region, recording every render's reveal state. */
async function mountRegion({ ready, gate = null }) {
  const seen = []
  let setReady
  function Region() {
    const [isReady, set] = React.useState(ready)
    setReady = set
    const reveal = useReveal(isReady)
    seen.push(reveal)
    return h('div', reveal.contentProps)
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => { root.render(gate ? gate(h(Region)) : h(Region)) })
  return {
    seen,
    last: () => seen[seen.length - 1],
    ready: (value) => act(async () => { setReady(value) }),
    unmount: () => act(async () => { root.unmount() }),
  }
}

// --- A quick load
{
  const region = await mountRegion({ ready: false })
  ok('a region not ready yet is hidden', region.last().phase === 'hidden')
  await settle(REVEAL.delay / 3)
  await region.ready(true)
  await settle(REVEAL.delay + 50)
  ok('a quick load never shows its skeleton', region.seen.every((reveal) => !reveal.skeleton))
  ok('and its content animates in', region.last().phase === 'shown')
  await region.unmount()
}

// --- A slow load
{
  const region = await mountRegion({ ready: false })
  await settle(REVEAL.delay + 60)
  ok('a slow load shows its skeleton once the delay has passed', region.last().skeleton === true)
  await region.ready(true)
  await settle(60)
  ok('the skeleton holds its minimum after the content is in', region.last().skeleton === true && region.last().phase === 'hidden')
  await settle(REVEAL.minVisible)
  ok('then hands over to the content', region.last().skeleton === false && region.last().phase === 'shown')
  await region.unmount()
}

// --- Ready from the start, and a reload
{
  const region = await mountRegion({ ready: true })
  ok('content ready on its first render does not animate', region.last().phase === 'static')
  await region.ready(false)
  await settle(REVEAL.delay / 3)
  ok('a reload keeps the old content up while it may still be quick', region.last().phase !== 'hidden')
  await settle(REVEAL.delay + 60)
  ok('and gives way to the skeleton once it is slow', region.last().phase === 'hidden' && region.last().skeleton)
  await region.unmount()
}

// --- The gate
{
  let markB
  function PieceB() {
    const [ready, set] = React.useState(false)
    markB = set
    useRevealReady('b', ready)
    return null
  }
  const region = await mountRegion({
    ready: true,
    gate: (child) => h(RevealGate, { keys: ['a', 'b'], ready: ['a'], timeout: 5000 }, child, h(PieceB)),
  })
  await settle(20)
  ok('a gated region waits while a piece has not reported', region.last().phase === 'hidden')
  await act(async () => { markB(true) })
  await settle(20)
  ok('and arrives once every piece has', region.last().phase === 'shown')
  ok('a gate opened that quickly showed no skeleton', region.seen.every((reveal) => !reveal.skeleton))
  await region.unmount()

  const stuck = await mountRegion({
    ready: true,
    gate: (child) => h(RevealGate, { keys: ['never'], timeout: 60 }, child),
  })
  await settle(REVEAL.delay + REVEAL.minVisible + 120)
  ok('a gate opens on its timeout when a piece never reports', stuck.last().phase === 'shown')
  ok('and one that opens before the delay shows no skeleton', stuck.seen.every((reveal) => !reveal.skeleton))
  await stuck.unmount()
}

// --- The file layer
await saveDocument('Atlas', 'Book/One/chapter', { content: { type: 'doc', content: [{ type: 'paragraph' }] }, notes: [] })
await saveDocument('Atlas', 'Book/Two/chapter', { content: { type: 'doc', content: [{ type: 'paragraph' }] }, notes: [] })
await saveDocument('Atlas', 'preface', { content: { type: 'doc', content: [{ type: 'paragraph' }] }, notes: [] })
{
  const tree = await listProjectTree('Atlas')
  const book = tree.children.find((node) => node.name === 'Book')
  ok('a tree read in parallel still has every folder and file', book?.children.length === 2 && tree.children.some((node) => node.path === 'preface'))
  ok('in the order the folder lists them', book.children.map((node) => node.name).join() === 'One,Two')
  ok('with nested paths intact', book.children[1].children[0]?.path === 'Book/Two/chapter')
  ok('a project with no folder on disk has an empty tree', (await listProjectTree('Nowhere')).children.length === 0)
  ok('a missing document loads as null', (await loadDocument('Atlas', 'nothing-here')) === null)

  const first = listProjects()
  ok('lists asked for at once share one read', listProjects() === first)
  ok('and that read finds the project', (await first).includes('Atlas'))
}

// --- Prefetch
{
  prefetchProject('Atlas', 'preface')
  await wait(5)
  files.set('/appdata/Atlas/preface.json', JSON.stringify({ content: { type: 'doc', content: [] }, notes: [{ id: 'later' }] }))
  const prefetched = await readDocument('Atlas', 'preface')
  ok('opening a document pointed at takes the read already made', Array.isArray(prefetched?.notes) && prefetched.notes.length === 0)
  const next = await readDocument('Atlas', 'preface')
  ok('which is handed out once: the next open reads the file again', next?.notes?.[0]?.id === 'later')
}

// --- Something that changes in place
{
  const phases = []
  let setValue
  function Changing() {
    const [value, set] = React.useState('document')
    setValue = set
    phases.push(useRevealOnChange(value))
    return null
  }
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => { root.render(h(Changing)) })
  ok('a value that has not changed does not animate', phases.at(-1) === 'static')
  await act(async () => { setValue('canvas') })
  ok('its first change replays the entrance', phases.at(-1) === 'shown')
  await act(async () => { setValue('map') })
  ok('and the next replays it again under the other name', phases.at(-1) === 'shown-again')
  await act(async () => { root.unmount() })
}

// --- The project list as last read
{
  ok('nothing is recalled before the first read', recallProjects() === null)
  rememberProjects(['Atlas', 'Novel'], { Atlas: '/appdata/Atlas' })
  rememberProjects(['Atlas', 'Novel', 'Poems'])
  const recalled = recallProjects()
  ok('the latest names are recalled', recalled.names.join() === 'Atlas,Novel,Poems')
  ok('a read of names alone keeps where each lives', recalled.roots.Atlas === '/appdata/Atlas')
}

// --- Version compare
{
  files.set('/appdata/Atlas/draft.json', JSON.stringify({
    content: { type: 'doc', content: [] },
    notes: [],
    versions: [{ id: 'v1', name: 'On disk', timestamp: '2026-10-01T10:00:00.000Z', contentHtml: '<p>An older line</p>' }],
  }))
  const mountCompare = async (props) => {
    const container = document.createElement('div')
    document.body.append(container)
    let sawIdentical = false
    const watch = new MutationObserver(() => { if (container.querySelector('.vcp-notice')) sawIdentical = true })
    watch.observe(container, { childList: true, subtree: true })
    const root = createRoot(container)
    await act(async () => {
      root.render(h(VersionComparePane, { projectName: 'Atlas', docName: 'draft', editor: null, initialLeftId: 'v1', initialRightId: 'current', onClose: () => {}, ...props }))
    })
    await settle(REVEAL.delay + REVEAL.minVisible + 60)
    watch.disconnect()
    return { container, sawIdentical: () => sawIdentical, unmount: () => act(async () => { root.unmount() }) }
  }

  const read = await mountCompare({})
  ok('a comparison waiting on its versions never claims the sides are identical', !read.sawIdentical())
  ok('and draws the diff once they are read', /difference/.test(read.container.querySelector('.vcp-stats')?.textContent || ''))
  await read.unmount()

  const seeded = await mountCompare({ initialVersions: [{ id: 'v1', name: 'Already held', timestamp: '2026-10-01T10:00:00.000Z', contentHtml: '<p>An older line</p>' }] })
  ok('versions handed over are used without reading the file', /Already held/.test(seeded.container.querySelector('.vcp-column-label')?.textContent || ''))
  await seeded.unmount()
}
