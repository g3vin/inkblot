/**
 * DigitalPreview.jsx — the e-book as a reader shows it, in Typeset's Digital view.
 *
 * Like a browser's responsive mode, for a book: the EPUB's own pages — compiled by the
 * export itself (`compileExport`), in the stylesheet it ships with (`ebookCss`) — laid
 * out as a reading system lays them out, in screen-wide columns turned a page at a
 * time, in a viewport the size of a device. Drag its edges to any size, or pick a
 * device; set the type size, the theme, the spacing, as a reader would, and see the
 * book hold up. Read-only: what is changed is changed in Print view or in Write.
 *
 * The book is compiled again a moment after it changes, and the page shown stays the
 * page shown — or as near as the new text allows.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { assetUrl, isAssetPath, measureImage } from '../lib/assets'
import { getPreference, setPreference } from '../lib/preferences'
import { OPEN_BOOK_ITEM_EVENT } from './BookPages'
import { activeCoverOf } from './chapterDesign'
import {
  clampViewport,
  DEFAULT_DEVICE,
  DEVICE_PRESETS,
  devicePreset,
  normalizeReader,
  READER_SCALES,
  READER_THEMES,
  readerCss,
} from './devicePresets'
import { ebookChecks, ebookImagesOf } from './export/ebook'
import { chapterBodyHtml, escapeHtml, frontSectionHtml } from './export/html'
import { mapImageSources } from './export/portable'
import { compileExport } from './export/runExport'
import { getPrintScope, setEbookIssues, setEditorMode, setTypesetReturn, setTypesetView, usePrintLayoutStore } from './printLayoutStore'

const COMPILE_DELAY_MS = 700
const DEVICE_KEY = 'inkblot-digital-device'
const READER_KEY = 'inkblot-digital-reader'

const readJson = (key) => {
  try {
    return JSON.parse(getPreference(key) || 'null')
  } catch {
    return null
  }
}

/** The device last chosen, or a size dragged to; a Paperwhite the first time. */
const initialViewport = () => {
  const stored = readJson(DEVICE_KEY)
  const preset = devicePreset(stored?.id) || (stored?.width ? null : devicePreset(DEFAULT_DEVICE))
  const width = stored?.width || preset.width
  const height = stored?.height || preset.height
  return { id: preset?.id || null, ...clampViewport(width, height) }
}

/** The whole e-book as one document of sections, each of the EPUB's files one. */
const bookHtml = ({ title, cover, front, contents, chapters }) => {
  const sections = []
  if (cover) sections.push(`<section class="ebook-item cover" data-item="cover"><img src="${escapeHtml(cover)}" alt="${escapeHtml(title)}"></section>`)
  for (const section of front) {
    sections.push(`<section class="ebook-item front-matter fm-${section.kind}">${frontSectionHtml(section)}</section>`)
  }
  if (contents) {
    const list = chapters.filter((c) => c.inContents !== false)
      .map((c) => `<li><a href="#" data-go="${escapeHtml(c.item || '')}">${escapeHtml(c.title)}</a></li>`).join('')
    sections.push(`<section class="ebook-item contents"><h1>Contents</h1><ol>${list}</ol></section>`)
  }
  for (const chapter of chapters) {
    sections.push(`<section class="ebook-item" data-item="${escapeHtml(chapter.item || '')}" data-title="${escapeHtml(chapter.title)}">${chapterBodyHtml(chapter.content)}</section>`)
  }
  return sections.join('\n')
}

/** Project pictures as URLs the preview can load. */
const withDisplaySources = async (projectName, chapters) => {
  const urls = new Map()
  for (const chapter of chapters) {
    for (const img of ebookImagesOf(chapter.content)) {
      if (isAssetPath(img.src) && !urls.has(img.src)) urls.set(img.src, await assetUrl(projectName, img.src))
    }
  }
  return {
    urls,
    chapters: chapters.map((c) => ({ ...c, content: mapImageSources(c.content, (src) => urls.get(src) || src) })),
  }
}

/** What the checks need to know of each picture: its size on disk and in pixels. */
const measureImages = async (images, urls) => {
  const out = []
  for (const img of images) {
    const url = urls.get(img.src) || img.src
    let bytes
    let size = null
    try {
      const response = await fetch(url)
      bytes = (await response.blob()).size
    } catch {
      bytes = undefined
    }
    try {
      size = await measureImage(url)
    } catch {
      size = null
    }
    out.push({ ...img, bytes, width: size?.width, height: size?.height })
  }
  return out
}

function Segmented({ value, options, onChange, label }) {
  return (
    <div className="digital-segmented" role="radiogroup" aria-label={label}>
      {options.map(([id, name]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? 'is-on' : ''} onClick={() => onChange(id)}>
          {name}
        </button>
      ))}
    </div>
  )
}

export default function DigitalPreview({ projectName, docPath, editor, placement }) {
  const version = usePrintLayoutStore()
  const [viewport, setViewport] = useState(initialViewport)
  const [reader, setReader] = useState(() => normalizeReader(readJson(READER_KEY)))
  const [compiled, setCompiled] = useState(null)
  const [page, setPage] = useState({ index: 0, count: 1, title: '' })
  const [fit, setFit] = useState(true)
  const [hostSize, setHostSize] = useState({ width: 0, height: 0 })
  const [showChecks, setShowChecks] = useState(false)
  const [checks, setChecks] = useState([])
  const [picked, setPicked] = useState(null)
  const hostRef = useRef(null)
  const frameRef = useRef(null)
  const timerRef = useRef(null)
  const runRef = useRef(0)
  // Where the reader is, as a share of the book, kept across a re-layout.
  const progressRef = useRef({ item: null, fraction: 0 })
  const book = placement?.book || null
  const itemId = placement?.row?.id || null
  const scope = placement ? (getPrintScope(projectName) === 'project' ? 'project' : 'folder') : 'document'

  const remember = (key, value) => {
    try {
      setPreference(key, JSON.stringify(value))
    } catch {
      // Remembering is a convenience.
    }
  }
  const chooseViewport = (next) => {
    const v = { ...next, ...clampViewport(next.width, next.height) }
    setViewport(v)
    remember(DEVICE_KEY, v)
  }
  const changeReader = (patch) => {
    setReader((r) => {
      const next = normalizeReader({ ...r, ...patch })
      remember(READER_KEY, next)
      return next
    })
  }

  /* ---------------- the book, compiled as the EPUB is ---------------- */

  const compile = useCallback(async () => {
    const run = ++runRef.current
    try {
      const title = book?.title || (docPath || '').split('/').pop() || 'Untitled'
      const live = (path) => (path === docPath && editor && !editor.isDestroyed ? editor.getJSON() : null)
      const result = await compileExport({ format: 'epub', projectName, docPath, scope, live, book: book || undefined, title })
      const { urls, chapters } = await withDisplaySources(projectName, result.exportChapters)
      const cover = activeCoverOf(book)?.front || null
      const coverUrl = cover ? (isAssetPath(cover) ? await assetUrl(projectName, cover) : cover) : null
      if (run !== runRef.current) return
      setCompiled({
        html: bookHtml({ title, cover: coverUrl, front: result.front, contents: result.contents, chapters }),
        css: result.css || '',
        language: book?.language || 'en',
      })
      // The checks, in the background: they read every picture.
      const images = result.exportChapters.flatMap((c) => ebookImagesOf(c.content))
      const seen = new Set()
      const unique = images.filter((img) => (seen.has(img.src) ? false : (seen.add(img.src), true)))
      const measured = await measureImages(unique, urls)
      const coverSize = coverUrl ? await measureImage(coverUrl).catch(() => null) : null
      if (run !== runRef.current) return
      const issues = ebookChecks({ images: measured, chapters: result.exportChapters.length, cover: coverSize })
      setChecks(issues)
      setEbookIssues(issues)
    } catch (error) {
      console.error('[digital] the e-book could not be set:', error)
    }
  }, [book, docPath, editor, projectName, scope])

  useEffect(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(compile, runRef.current ? COMPILE_DELAY_MS : 0)
    return () => clearTimeout(timerRef.current)
  }, [compile, version])

  useEffect(() => {
    if (!editor) return undefined
    const onTransaction = ({ transaction }) => {
      if (!transaction.docChanged) return
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(compile, COMPILE_DELAY_MS)
    }
    editor.on('transaction', onTransaction)
    return () => editor.off('transaction', onTransaction)
  }, [compile, editor])

  useEffect(() => () => setEbookIssues(null), [])

  /* ---------------- pages ---------------- */

  const frameDoc = () => frameRef.current?.contentDocument || null

  /** Count the pages, and say which is showing and whose it is. */
  const measure = useCallback(() => {
    const doc = frameDoc()
    const root = doc?.scrollingElement
    if (!root) return
    const width = viewport.width
    const count = Math.max(1, Math.ceil((root.scrollWidth - 1) / width))
    const index = Math.min(count - 1, Math.round(root.scrollLeft / width))
    let title = ''
    let item = null
    for (const section of doc.querySelectorAll('.ebook-item')) {
      const left = section.getBoundingClientRect().left + root.scrollLeft
      if (left <= root.scrollLeft + 1) {
        title = section.dataset.title || ''
        item = section.dataset.item || null
      } else break
    }
    progressRef.current = { item, fraction: count > 1 ? index / (count - 1) : 0 }
    setPage({ index, count, title })
  }, [viewport.width])

  const turnTo = useCallback((index) => {
    const root = frameDoc()?.scrollingElement
    if (!root) return
    const count = Math.max(1, Math.ceil((root.scrollWidth - 1) / viewport.width))
    root.scrollLeft = Math.max(0, Math.min(count - 1, index)) * viewport.width
    measure()
  }, [measure, viewport.width])

  const turn = useCallback((delta) => {
    const root = frameDoc()?.scrollingElement
    if (!root) return
    turnTo(Math.round(root.scrollLeft / viewport.width) + delta)
  }, [turnTo, viewport.width])

  /** The first page of one of the book's entries. */
  const goToItem = useCallback((id) => {
    const doc = frameDoc()
    const root = doc?.scrollingElement
    const section = id ? [...(doc?.querySelectorAll('.ebook-item') || [])].find((s) => s.dataset.item === id) : null
    if (!root || !section) return false
    const left = section.getBoundingClientRect().left + root.scrollLeft
    turnTo(Math.floor((left + 1) / viewport.width))
    return true
  }, [turnTo, viewport.width])

  // The document the frame shows: written once per compile and per reader setting.
  const srcDoc = useMemo(() => {
    if (!compiled) return ''
    const themeClass = READER_THEMES[reader.theme].dark ? ' class="reader-dark"' : ''
    return `<!doctype html><html lang="${escapeHtml(compiled.language)}"${themeClass}><head><meta charset="utf-8">
<style>${compiled.css}</style><style>${readerCss(reader, viewport.width, viewport.height)}</style></head>
<body>${compiled.html}</body></html>`
  }, [compiled, reader, viewport.width, viewport.height])

  // Once it has loaded: back to where the reader was, and listening for the keys and
  // clicks a reader answers to.
  const onFrameLoad = useCallback(() => {
    const doc = frameDoc()
    if (!doc) return
    const restore = () => {
      const { item, fraction } = progressRef.current
      const root = doc.scrollingElement
      if (!root) return
      const count = Math.max(1, Math.ceil((root.scrollWidth - 1) / viewport.width))
      root.scrollLeft = Math.round(fraction * (count - 1)) * viewport.width
      if (item && fraction === 0) goToItem(item)
      measure()
    }
    restore()
    // Pictures change the page count as they arrive.
    for (const img of doc.images) if (!img.complete) img.addEventListener('load', measure, { once: true })
    doc.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === ' ' || event.key === 'PageDown') { event.preventDefault(); turn(1) }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') { event.preventDefault(); turn(-1) }
    })
    doc.addEventListener('click', (event) => {
      const go = event.target.closest?.('[data-go]')
      if (go) {
        event.preventDefault()
        goToItem(go.dataset.go)
        return
      }
      // A reader's own: the outer thirds turn the page, the middle picks what is there.
      const x = event.clientX / viewport.width
      if (x < 0.3) turn(-1)
      else if (x > 0.7) turn(1)
      else {
        const section = event.target.closest?.('.ebook-item')
        const id = section?.dataset.item
        setPicked(id && id !== 'cover' ? { id, title: section.dataset.title || '' } : null)
      }
    })
    let wheelAt = 0
    doc.addEventListener('wheel', (event) => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : 0
      if (Math.abs(delta) < 12 || event.timeStamp - wheelAt < 350) return
      wheelAt = event.timeStamp
      turn(delta > 0 ? 1 : -1)
    }, { passive: true })
  }, [goToItem, measure, turn, viewport.width])

  // The navigator's choice: the chapter chosen is the page shown.
  const lastItem = useRef(null)
  useEffect(() => {
    if (!itemId || itemId === lastItem.current) return
    lastItem.current = itemId
    progressRef.current = { item: itemId, fraction: 0 }
    goToItem(itemId)
  }, [goToItem, itemId, compiled])

  useEffect(() => {
    const onKey = (event) => {
      if (event.target.closest?.('input, select, textarea')) return
      if (event.key === 'ArrowRight') turn(1)
      if (event.key === 'ArrowLeft') turn(-1)
    }
    const host = hostRef.current
    host?.addEventListener('keydown', onKey)
    return () => host?.removeEventListener('keydown', onKey)
  }, [turn])

  /* ---------------- the viewport ---------------- */

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(([entry]) => {
      setHostSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  // Shrunk to fit the pane, never enlarged.
  const scale = fit && hostSize.width
    ? Math.min(1, (hostSize.width - 64) / viewport.width, (hostSize.height - 150) / viewport.height)
    : 1

  /** Drag an edge or the corner: the viewport grows both ways from its centre. */
  const startDrag = (edge) => (event) => {
    event.preventDefault()
    const start = { x: event.clientX, y: event.clientY, width: viewport.width, height: viewport.height }
    const move = (e) => {
      const dx = ((e.clientX - start.x) * 2) / Math.max(scale, 0.1)
      const dy = (e.clientY - start.y) / Math.max(scale, 0.1)
      setViewport({
        id: null,
        ...clampViewport(edge === 'bottom' ? start.width : start.width + dx, edge === 'right' ? start.height : start.height + dy),
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setViewport((v) => {
        remember(DEVICE_KEY, v)
        return v
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const preset = devicePreset(viewport.id)
  const ppi = preset?.ppi || 96
  const inches = (px) => (px / ppi).toFixed(1)
  const theme = READER_THEMES[reader.theme]
  const scaleIndex = READER_SCALES.indexOf(reader.scale)

  const openPicked = (write) => {
    if (!picked) return
    window.dispatchEvent(new CustomEvent(OPEN_BOOK_ITEM_EVENT, { detail: { id: picked.id } }))
    if (write) {
      const path = placement?.book?.items?.find((it) => it.id === picked.id)?.path || (picked.id === itemId ? docPath : null)
      if (path) setTypesetReturn({ docPath: path, pos: null })
      setEditorMode(projectName, 'write')
    } else {
      setTypesetView(projectName, 'print')
    }
    setPicked(null)
  }
  const pickedIsChapter = picked && (placement?.book?.items?.find((it) => it.id === picked.id)?.kind || 'chapter') === 'chapter'

  return (
    <div ref={hostRef} className="digital-preview" tabIndex={-1}>
      <div className="digital-bar" role="toolbar" aria-label="E-book preview">
        <select
          aria-label="Device"
          value={viewport.id || ''}
          onChange={(e) => {
            const d = devicePreset(e.target.value)
            if (d) chooseViewport({ id: d.id, width: d.width, height: d.height })
          }}
        >
          {viewport.id ? null : <option value="">Responsive</option>}
          {DEVICE_PRESETS.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <span className="digital-size">
          {viewport.width} × {viewport.height}
          <small> · {inches(viewport.width)} × {inches(viewport.height)} in</small>
        </span>
        <button type="button" title="Rotate" onClick={() => chooseViewport({ id: viewport.id, width: viewport.height, height: viewport.width })}>⟲</button>
        <label className="digital-fit"><input type="checkbox" checked={fit} onChange={(e) => setFit(e.target.checked)} /> Fit</label>
        <span className="digital-sep" />
        <div className="digital-type" aria-label="Type size">
          <button type="button" disabled={scaleIndex <= 0} onClick={() => changeReader({ scale: READER_SCALES[scaleIndex - 1] })} title="Smaller type">A</button>
          <button type="button" disabled={scaleIndex >= READER_SCALES.length - 1} onClick={() => changeReader({ scale: READER_SCALES[scaleIndex + 1] })} title="Larger type" className="is-large">A</button>
        </div>
        <Segmented label="Theme" value={reader.theme} onChange={(theme) => changeReader({ theme })} options={Object.entries(READER_THEMES).map(([id, t]) => [id, t.name])} />
        <details className="digital-more">
          <summary>Reader</summary>
          <div className="digital-more-panel">
            <label><input type="checkbox" checked={reader.publisherFont} onChange={(e) => changeReader({ publisherFont: e.target.checked })} /> Publisher font</label>
            <div>Spacing <Segmented label="Line spacing" value={reader.spacing} onChange={(spacing) => changeReader({ spacing })} options={[['tight', 'Tight'], ['publisher', 'Book'], ['loose', 'Loose']]} /></div>
            <div>Margins <Segmented label="Margins" value={reader.margins} onChange={(margins) => changeReader({ margins })} options={[['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']]} /></div>
            <div>Alignment <Segmented label="Alignment" value={reader.align} onChange={(align) => changeReader({ align })} options={[['left', 'Left'], ['publisher', 'Book'], ['justify', 'Justified']]} /></div>
          </div>
        </details>
        <span className="digital-sep" />
        <button type="button" className={`digital-checks-toggle${checks.some((c) => c.severity !== 'note') ? ' has-warnings' : ''}`} onClick={() => setShowChecks((s) => !s)}>
          Checks{checks.length ? ` (${checks.length})` : ''}
        </button>
      </div>

      {showChecks ? (
        <ul className="digital-checks">
          {checks.length ? checks.map((c) => <li key={c.id} className={`is-${c.severity}`}>{c.message}</li>) : <li>Nothing stands in the way of the e-book.</li>}
        </ul>
      ) : null}

      <div className="digital-stage">
        <div className="digital-device" style={{ width: viewport.width * scale + 24, height: viewport.height * scale + 24 }}>
          <div
            className="digital-screen"
            style={{ width: viewport.width, height: viewport.height, transform: `scale(${scale})`, background: theme.background }}
          >
            {srcDoc ? (
              <iframe
                ref={frameRef}
                title="E-book preview"
                sandbox="allow-same-origin"
                srcDoc={srcDoc}
                onLoad={onFrameLoad}
                style={{ width: viewport.width, height: viewport.height }}
              />
            ) : <div className="digital-status">Setting the e-book…</div>}
          </div>
          <div className="digital-handle is-right" onPointerDown={startDrag('right')} title="Drag to resize" />
          <div className="digital-handle is-bottom" onPointerDown={startDrag('bottom')} title="Drag to resize" />
          <div className="digital-handle is-corner" onPointerDown={startDrag('corner')} title="Drag to resize" />
        </div>
      </div>

      <div className="digital-footer">
        <button type="button" onClick={() => turn(-1)} disabled={page.index <= 0} aria-label="Previous page">‹</button>
        <span>{page.title ? `${page.title} · ` : ''}Page {page.index + 1} of {page.count}</span>
        <button type="button" onClick={() => turn(1)} disabled={page.index >= page.count - 1} aria-label="Next page">›</button>
      </div>

      {picked ? (
        <div className="digital-picked" role="dialog" aria-label="Open this page">
          <span>{picked.title || 'This page'}</span>
          {pickedIsChapter ? <button type="button" onClick={() => openPicked(true)}>Edit in Write mode</button> : null}
          <button type="button" onClick={() => openPicked(false)}>Show in print layout</button>
          <button type="button" onClick={() => setPicked(null)} aria-label="Close">×</button>
        </div>
      ) : null}
    </div>
  )
}
