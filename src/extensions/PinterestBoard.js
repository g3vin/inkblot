import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { openPinterest } from '../openPinterest'

const PINTEREST_SCRIPT_ID = 'inkblot-pinterest-pinit-js'
const PINTEREST_SCRIPT_SRC = 'https://assets.pinterest.com/js/pinit.js'

const PINTEREST_PIDGETS_BASE = 'https://widgets.pinterest.com/v3/pidgets/boards'
const SECTION_PUBLIC_PREVIEW_TIMEOUT_MS = 2000
const SECTION_PRIVATE_PREVIEW_TIMEOUT_MS = 15000
const PINTEREST_OPEN_WINDOW_EVENT = 'inkblot:pinterest-open-window'
const PINTEREST_COPY_LINK_EVENT = 'inkblot:pinterest-copy-link'

const ensurePinterestMenuBridge = (() => {
  let installed = false

  return () => {
    if (installed) return
    if (typeof window === 'undefined') return

    window.addEventListener(PINTEREST_OPEN_WINDOW_EVENT, async (event) => {
      const url = String(event?.detail?.url || '').trim()
      if (!url) return
      try {
        await openPinterest(url)
      } catch {
        try {
          window.open(url, '_blank', 'noopener,noreferrer')
        } catch {
          // ignore
        }
      }
    })

    window.addEventListener(PINTEREST_COPY_LINK_EVENT, async (event) => {
      const url = String(event?.detail?.url || '').trim()
      if (!url) return
      try {
        await navigator.clipboard.writeText(url)
      } catch {
        // ignore
      }
    })

    installed = true
  }
})()

ensurePinterestMenuBridge()

const parsePinterestBoardParts = (pinterestUrl) => {
  if (!pinterestUrl) return null
  let url
  try {
    url = new URL(String(pinterestUrl))
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase()
  if (!(host === 'pinterest.com' || host === 'www.pinterest.com')) return null

  const segments = url.pathname
    .split('/')
    .map(s => s.trim())
    .filter(Boolean)

  if (segments.length < 2) return null

  const [user, board] = segments
  const reservedThird = new Set(['pins', 'activity', 'ideas', 'more_ideas'])
  const third = segments[2]
  const section = third && !reservedThird.has(third.toLowerCase()) ? third : null

  return { user, board, section }
}

/**
 * returns a Pinterest board URL if `text` looks like a board URL
 * otherwise returns null
 */
export function normalizePinterestBoardUrl(text) {
  if (!text) return null
  const trimmed = String(text).trim()
  if (!trimmed) return null

  // only consider pinterest.com URLs
  if (!/^https?:\/\//i.test(trimmed)) return null

  let url
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase()
  if (!(host === 'pinterest.com' || host === 'www.pinterest.com')) return null

  // board URLs are typically: /{username}/{board}/
  const segments = url.pathname
    .split('/')
    .map(s => s.trim())
    .filter(Boolean)

  if (segments.length < 2) return null

  const [first, second] = segments

  // ignore non-board routes.
  const blocked = new Set([
    'pin',
    'search',
    'ideas',
    'explore',
    'today',
    'topics',
    'settings',
    '_tools',
  ])

  if (blocked.has(first.toLowerCase())) return null

  const allowedThird = new Set(['pins', 'activity', 'ideas', 'more_ideas'])

  // Pinterest board *sections* (what you're calling sub-boards) look like:
  //   /{user}/{board}/{section}/
  // In that case, preserve the section path so we only render that section.
  if (segments.length >= 3) {
    const third = segments[2]
    if (allowedThird.has(third.toLowerCase())) {
      return `https://www.pinterest.com/${encodeURIComponent(first)}/${encodeURIComponent(second)}/`
    }
    return `https://www.pinterest.com/${encodeURIComponent(first)}/${encodeURIComponent(second)}/${encodeURIComponent(third)}/`
  }

  // Strip query/hash and normalize trailing slash.
  return `https://www.pinterest.com/${encodeURIComponent(first)}/${encodeURIComponent(second)}/`
}

const pidgetsPinsUrlFromPinterestUrl = (pinterestUrl) => {
  const parts = parsePinterestBoardParts(pinterestUrl)
  if (!parts) return null

  const base = `${PINTEREST_PIDGETS_BASE}/${encodeURIComponent(parts.user)}/${encodeURIComponent(parts.board)}/pins/`

  // NOTE: `?section=<slug>` appears accepted but is NOT reliably filtered.
  // We keep the base endpoint here and handle section-specific fetching elsewhere.
  return base
}

const ensurePinterestScriptLoaded = (() => {
  let promise = null

  return () => {
    if (typeof window === 'undefined') return Promise.resolve(false)

    // Already loaded
    if (window.PinUtils && typeof window.PinUtils.build === 'function') {
      return Promise.resolve(true)
    }

    if (promise) return promise

    promise = new Promise(resolve => {
      const existing = document.getElementById(PINTEREST_SCRIPT_ID)
      if (existing) {
        existing.addEventListener('load', () => resolve(true), { once: true })
        existing.addEventListener('error', () => resolve(false), { once: true })
        return
      }

      const script = document.createElement('script')
      script.id = PINTEREST_SCRIPT_ID
      script.async = true
      script.defer = true
      script.src = PINTEREST_SCRIPT_SRC
      script.onload = () => resolve(true)
      script.onerror = () => resolve(false)
      document.head.appendChild(script)
    })

    return promise
  }
})()

const buildPinterestEmbeds = (rootEl) => {
  try {
    if (window.PinUtils && typeof window.PinUtils.build === 'function') {
      // PinUtils.build() accepts an optional root element.
      try {
        window.PinUtils.build(rootEl)
      } catch {
        window.PinUtils.build()
      }
      return true
    }
  } catch {
    // ignore
  }
  return false
}

const PinterestBoard = Node.create({
  name: 'pinterestBoard',

  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      url: {
        default: null,
        parseHTML: element => element.getAttribute('data-url') || null,
        renderHTML: attributes => ({
          'data-url': attributes.url || null,
        }),
      },
      boardWidth: {
        default: 400,
        parseHTML: element => {
          const v = element.getAttribute('data-board-width')
          return v ? Number(v) : 400
        },
        renderHTML: attributes => ({
          'data-board-width': attributes.boardWidth,
        }),
      },
      scaleHeight: {
        default: 320,
        parseHTML: element => {
          const v = element.getAttribute('data-scale-height')
          return v ? Number(v) : 320
        },
        renderHTML: attributes => ({
          'data-scale-height': attributes.scaleHeight,
        }),
      },
      scaleWidth: {
        default: 80,
        parseHTML: element => {
          const v = element.getAttribute('data-scale-width')
          return v ? Number(v) : 80
        },
        renderHTML: attributes => ({
          'data-scale-width': attributes.scaleWidth,
        }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="pinterest-board"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'pinterest-board',
      }),
    ]
  },

  addCommands() {
    return {
      insertPinterestBoard:
        (attrs) =>
        ({ commands }) => {
          const url = normalizePinterestBoardUrl(attrs?.url)
          if (!url) return false
          return commands.insertContent({
            type: this.name,
            attrs: {
              url,
              boardWidth: attrs?.boardWidth ?? 400,
              scaleHeight: attrs?.scaleHeight ?? 320,
              scaleWidth: attrs?.scaleWidth ?? 80,
            },
          })
        },
    }
  },

  addNodeView() {
    return ({ node }) => {
      const container = document.createElement('div')
      container.className = 'pinterest-board-node'

      let currentUrl = node.attrs.url
      let expanded = false

      // Avoid restarting expensive async refreshes (scrape/fetch) repeatedly.
      let refreshRunId = 0
      let inFlightForUrl = null

      const COLLAPSE_HEIGHT_PX = 600

      let resizeObserver = null
      let selectionClassObserver = null

      const inner = document.createElement('div')
      inner.className = 'pinterest-board-inner'

      const masonry = document.createElement('div')
      masonry.className = 'pinterest-board-masonry'

      const expandHint = document.createElement('div')
      expandHint.className = 'pinterest-board-expand-hint'
      expandHint.textContent = 'Click to expand'

      const link = document.createElement('a')
      link.href = currentUrl
      link.target = '_blank'
      link.rel = 'noreferrer'
      link.setAttribute('data-pin-do', 'embedBoard')
      link.setAttribute('data-pin-board-width', String(node.attrs.boardWidth || 400))
      link.setAttribute('data-pin-scale-height', String(node.attrs.scaleHeight || 320))
      link.setAttribute('data-pin-scale-width', String(node.attrs.scaleWidth || 80))

      // Pinterest replaces the <a> with the embed.
      inner.appendChild(link)

      const fallback = document.createElement('div')
      fallback.className = 'pinterest-board-fallback'
      fallback.textContent = 'Loading Pinterest board…'

      const refreshPreviewBtn = document.createElement('button')
      refreshPreviewBtn.type = 'button'
      refreshPreviewBtn.className = 'pinterest-board-refresh-btn'
      refreshPreviewBtn.title = 'Refresh preview'
      refreshPreviewBtn.setAttribute('aria-label', 'Refresh preview')
      refreshPreviewBtn.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M20 12a8 8 0 1 1-2.34-5.66" />
          <path d="M20 4v6h-6" />
        </svg>
      `

      const onRefreshPreview = (e) => {
        e.preventDefault()
        e.stopPropagation()
        refresh()
      }

      const onTileContextMenu = async (e) => {
        e.preventDefault()
        e.stopPropagation()
        try {
          const { Menu, MenuItem, PredefinedMenuItem } = await import('@tauri-apps/api/menu')
          const openItem = await MenuItem.new({
            text: 'Open in Pinterest window',
            action: () => {
              window.setTimeout(() => {
                window.dispatchEvent(new CustomEvent(PINTEREST_OPEN_WINDOW_EVENT, {
                  detail: { url: currentUrl },
                }))
              }, 0)
            },
          })
          const copyItem = await MenuItem.new({
            text: 'Copy link',
            action: () => {
              window.setTimeout(() => {
                window.dispatchEvent(new CustomEvent(PINTEREST_COPY_LINK_EVENT, {
                  detail: { url: currentUrl },
                }))
              }, 0)
            },
          })
          const separator = await PredefinedMenuItem.new({ item: 'Separator' })
          const menu = await Menu.new({ items: [openItem, separator, copyItem] })
          await menu.popup()
        } catch {
          // ignore
        }
      }

      refreshPreviewBtn.addEventListener('click', onRefreshPreview)

      container.appendChild(inner)
      container.appendChild(refreshPreviewBtn)
      container.appendChild(fallback)
      container.appendChild(expandHint)

      const updateCollapseState = () => {
        if (expanded) {
          container.classList.remove('is-collapsed')
          container.classList.add('is-expanded')
          expandHint.style.display = 'none'
          return
        }

        // Only collapse when masonry is actually rendered.
        if (masonry.style.display === 'none' || !masonry.isConnected) {
          container.classList.remove('is-collapsed')
          container.classList.remove('is-expanded')
          expandHint.style.display = 'none'
          return
        }

        const measuredHeight = Math.max(
          masonry.scrollHeight || 0,
          Math.ceil(masonry.getBoundingClientRect().height || 0)
        )

        const tooTall = measuredHeight > COLLAPSE_HEIGHT_PX
        if (tooTall) {
          container.classList.add('is-collapsed')
          container.classList.remove('is-expanded')
          expandHint.style.display = ''
        } else {
          container.classList.remove('is-collapsed')
          container.classList.remove('is-expanded')
          expandHint.style.display = 'none'
        }
      }

      const attachResizeObserver = () => {
        if (resizeObserver) return
        if (typeof ResizeObserver === 'undefined') return
        resizeObserver = new ResizeObserver(() => {
          updateCollapseState()
        })
        try {
          resizeObserver.observe(masonry)
        } catch {
          // ignore
        }
      }

      const onExpand = (e) => {
        // While collapsed, any click inside the board (including images/links)
        // should expand it first.
        if (container.classList.contains('is-collapsed')) {
          e?.preventDefault?.()
          e?.stopPropagation?.()
          expanded = true
          updateCollapseState()
          return
        }

        // When already expanded, don't hijack normal interactions.
      }

      const collapseIfExpanded = () => {
        if (!expanded) return
        expanded = false
        updateCollapseState()
      }

      const attachSelectionClassObserver = () => {
        if (selectionClassObserver) return
        if (typeof MutationObserver === 'undefined') return

        selectionClassObserver = new MutationObserver(() => {
          // Mirror the visual selection state (blue border):
          // when the selected class is removed, collapse.
          if (!container.classList.contains('is-selected')) {
            collapseIfExpanded()
          }
        })

        try {
          selectionClassObserver.observe(container, {
            attributes: true,
            attributeFilter: ['class'],
          })
        } catch {
          // ignore
        }
      }

      const onOutsidePointerDown = (e) => {
        const target = e?.target
        if (!target) return
        if (container.contains(target)) return
        collapseIfExpanded()
      }

      const onSelectionChange = () => {
        // Let ProseMirror apply node selection classes first.
        requestAnimationFrame(() => {
          if (!container.classList.contains('is-selected')) {
            collapseIfExpanded()
          }
        })
      }

      const onWindowBlur = () => {
        collapseIfExpanded()
      }

      container.addEventListener('click', onExpand)
      container.addEventListener('contextmenu', onTileContextMenu)
      expandHint.addEventListener('click', onExpand)
      attachSelectionClassObserver()
      document.addEventListener('pointerdown', onOutsidePointerDown, true)
      document.addEventListener('selectionchange', onSelectionChange)
      window.addEventListener('blur', onWindowBlur)

      const clearMasonry = () => {
        masonry.innerHTML = ''
        masonry.style.display = 'none'
        updateCollapseState()
      }

      const renderMasonry = (items) => {
        clearMasonry()
        if (!items?.length) return false

        masonry.style.display = 'block'
        attachResizeObserver()
        for (const item of items) {
          const a = document.createElement('a')
          a.className = 'pinterest-board-masonry-item'
          a.href = item.pinHref
          a.target = '_blank'
          a.rel = 'noreferrer'

          const img = document.createElement('img')
          img.loading = 'lazy'
          img.decoding = 'async'
          img.alt = ''

          // Recompute collapse after images load (masonry height changes).
          // Attach listener before setting src to avoid missing cached-load cases.
          img.addEventListener('load', () => updateCollapseState(), { once: true })
          img.src = item.imageUrl

          a.appendChild(img)
          masonry.appendChild(a)
        }

        // Remove Pinterest embed DOM so it doesn't compete visually.
        inner.innerHTML = ''
        inner.appendChild(masonry)

        // Measure after layout.
        requestAnimationFrame(() => updateCollapseState())
        setTimeout(() => updateCollapseState(), 250)
        setTimeout(() => updateCollapseState(), 1200)

        return true
      }

      const extractPinsFromEmbedDom = () => {
        const spans = Array.from(
          container.querySelectorAll('span[data-pin-href]')
        )

        const items = []
        const seen = new Set()

        for (const el of spans) {
          const pinHref = el.getAttribute('data-pin-href')
          if (!pinHref) continue

          // Only collect actual pins.
          // Examples:
          //  - https://www.pinterest.com/pin/807199933259231008
          //  - https://www.pinterest.com/pin/807199933259231008/
          let pinUrl
          try {
            pinUrl = new URL(pinHref)
          } catch {
            continue
          }

          const isPinterestPin =
            (pinUrl.hostname === 'www.pinterest.com' || pinUrl.hostname === 'pinterest.com') &&
            /^\/pin\/(\d+)(\/)?$/i.test(pinUrl.pathname)

          if (!isPinterestPin) continue

          // Pinterest embed uses background-image; get the computed style if needed.
          const bg = el.style?.backgroundImage || getComputedStyle(el).backgroundImage
          if (!bg || bg === 'none') continue

          const match = bg.match(/url\((['"]?)(.*?)\1\)/i)
          const imageUrl = match?.[2]
          if (!imageUrl) continue

          // Only accept Pinterest CDN images (prevents picking up logo/PFPs that may be embedded).
          let imgUrl
          try {
            imgUrl = new URL(imageUrl)
          } catch {
            continue
          }

          const isPinImg = imgUrl.hostname === 'i.pinimg.com'
          if (!isPinImg) continue

          const key = `${pinHref}::${imageUrl}`
          if (seen.has(key)) continue
          seen.add(key)

          items.push({ pinHref: pinUrl.toString(), imageUrl: imgUrl.toString() })
        }

        // Some Pinterest embed layouts include a non-pin tile at the start/end
        // (often avatar / Pinterest branding). As a pragmatic guard, drop them.
        if (items.length >= 3) return items.slice(1, -1)
        return items
      }

      const ensureEmbedLinkPresent = () => {
        // Keep the Pinterest <a data-pin-do="embedBoard"> around only long enough
        // for PinUtils.build() to populate its DOM.
        if (!inner.contains(link)) {
          inner.innerHTML = ''
          inner.appendChild(link)
        }
      }

      const resetScrapeMeta = () => {
        container.dataset.scrapeFinalUrl = ''
        container.dataset.scrapeReason = ''
        container.dataset.scrapeError = ''
      }

      const storeScrapeMeta = (scrapeResult) => {
        container.dataset.scrapeFinalUrl = String(scrapeResult?.finalUrl || '')
        container.dataset.scrapeReason = String(scrapeResult?.reason || '')
        container.dataset.scrapeError = String(scrapeResult?.error || '')
      }

      const getScrapeHint = (kind) => {
        const finalUrl = container.dataset.scrapeFinalUrl || ''
        const reason = container.dataset.scrapeReason || ''

        if (finalUrl && finalUrl !== currentUrl && /\/login\b|\/accounts\b|\/signup\b/i.test(finalUrl)) {
          return ' Pinterest redirected to login. Sign in, then click the refresh icon.'
        }

        if (reason === 'eval_failed' || reason === 'eval_probe_failed' || reason === 'eval_noexec') {
          return ' Pinterest is still loading in the preview session. Click the refresh icon again in a moment.'
        }

        if (reason === 'timeout') {
          return ` ${kind} preview timed out. If it's private, sign in to Pinterest, then click the refresh icon.`
        }

        return ` If this ${kind} is private, sign in to Pinterest, then click the refresh icon.`
      }

      const showPreviewFallback = ({ message, kind, linkText = 'Open on Pinterest' }) => {
        fallback.innerHTML = ''

        const msg = document.createElement('div')
        msg.textContent = `${message}${getScrapeHint(kind)} `

        const a = document.createElement('a')
        a.href = currentUrl
        a.target = '_blank'
        a.rel = 'noreferrer'
        a.textContent = linkText

        const errText = container.dataset.scrapeError || ''
        if (errText) {
          a.title = errText
        }

        fallback.appendChild(msg)
        fallback.appendChild(a)
        fallback.style.display = ''
      }

      const attemptSessionPreview = async ({
        runId,
        strategy = 'session-only',
        maxPins = 30,
        timeoutMs = 30000,
        allowWebviewFallback = true,
      }) => {
        try {
          const mod = await import('../pinterestScrape')
          if (!mod || typeof mod.scrapePinterestPins !== 'function') {
            return { ok: false }
          }

          const timeoutBufferMs = strategy === 'session-only' ? 3000 : 1500

          const scrapeResult = await Promise.race([
            mod.scrapePinterestPins(currentUrl, {
              maxPins,
              timeoutMs,
              strategy,
              allowWebviewFallback,
            }),
            new Promise(resolve => setTimeout(() => resolve({ pins: [], reason: 'timeout' }), timeoutMs + timeoutBufferMs)),
          ])

          if (runId !== refreshRunId) {
            return { ok: false, stale: true }
          }

          const pins = Array.isArray(scrapeResult)
            ? scrapeResult
            : (Array.isArray(scrapeResult?.pins) ? scrapeResult.pins : [])

          if (pins.length) {
            const okMasonry = renderMasonry(pins)
            if (okMasonry) {
              fallback.style.display = 'none'
              return { ok: true, scrapeResult }
            }
          }

          storeScrapeMeta(scrapeResult)
          return { ok: false, scrapeResult }
        } catch (error) {
          storeScrapeMeta({
            finalUrl: currentUrl,
            reason: 'session_scrape_failed',
            error: String(error?.message || error || ''),
          })
          return { ok: false }
        }
      }

      const tryPublicEmbedPreview = async (runId) => {
        const ok = await ensurePinterestScriptLoaded()
        if (!ok) {
          return { ok: false }
        }

        return await new Promise(resolve => {
          setTimeout(() => {
            const built = buildPinterestEmbeds(container)
            fallback.style.display = ''

            setTimeout(() => {
              if (runId !== refreshRunId) {
                resolve({ ok: false, stale: true })
                return
              }

              if (!container.querySelector('iframe')) {
                const extracted = extractPinsFromEmbedDom()
                if (extracted.length) {
                  const okMasonry = renderMasonry(extracted)
                  if (okMasonry) {
                    fallback.style.display = 'none'
                    resolve({ ok: true })
                    return
                  }
                }
              }

              const hasEmbed =
                container.querySelector('iframe') ||
                container.querySelector('[data-pin-href]') ||
                container.querySelector('.PIN_')

              if (built && hasEmbed) {
                fallback.style.display = 'none'
                resolve({ ok: true })
                return
              }

              resolve({ ok: false })
            }, 1200)
          }, 0)
        })
      }

      // Start with masonry hidden until we can extract.
      clearMasonry()

      const refresh = async () => {
        currentUrl = link.href

        // If we already have a refresh running for this URL, don't restart it.
        if (inFlightForUrl && inFlightForUrl === currentUrl) return
        inFlightForUrl = currentUrl

        const runId = ++refreshRunId

        expanded = false
        container.classList.remove('is-expanded')
        clearMasonry()
        ensureEmbedLinkPresent()
        resetScrapeMeta()

        // Default to showing the fallback while we work.
        fallback.style.display = ''

        const parts = parsePinterestBoardParts(currentUrl)

        // Board section (sub-board) preview.
        // Pinterest's embedBoard (and the board-pins pidgets endpoint) do not reliably
        // filter by section slug. For public sections, we instead scrape the actual
        // section page in a hidden Pinterest webview window.
        if (parts?.section) {
          fallback.innerHTML = ''
          fallback.textContent = 'Checking public section preview…'

          const sectionPreview = await attemptSessionPreview({
            runId,
            strategy: 'auto',
            maxPins: 30,
            timeoutMs: SECTION_PUBLIC_PREVIEW_TIMEOUT_MS,
            allowWebviewFallback: false,
          })
          if (sectionPreview.stale) return
          if (sectionPreview.ok) {
            inFlightForUrl = null
            return
          }

          fallback.innerHTML = ''
          fallback.textContent = 'Opening your Pinterest session…'

          const privateSectionPreview = await attemptSessionPreview({
            runId,
            strategy: 'session-only',
            maxPins: 30,
            timeoutMs: SECTION_PRIVATE_PREVIEW_TIMEOUT_MS,
          })
          if (privateSectionPreview.stale) return
          if (privateSectionPreview.ok) {
            inFlightForUrl = null
            return
          }

          showPreviewFallback({
            message: 'Couldn\'t load section preview.',
            kind: 'section',
          })
          inFlightForUrl = null
          return
        }

        // 1) Prefer the Pinterest widgets JSON API (“pidgets”).
        // This supports board sections via `?section=...` and avoids accidentally
        // scraping non-pin tiles from the embed DOM.
        const pidgetsUrl = pidgetsPinsUrlFromPinterestUrl(currentUrl)
        if (pidgetsUrl) {
          try {
            const res = await fetch(pidgetsUrl)
            if (res.ok) {
              const json = await res.json()
              const pins = json?.data?.pins || []
              const items = pins
                .map(p => {
                  const imageUrl =
                    p?.images?.['236x']?.url ||
                    p?.images?.['237x']?.url ||
                    p?.images?.['564x']?.url
                  if (!imageUrl || !p?.id) return null
                  return {
                    pinHref: `https://www.pinterest.com/pin/${p.id}/`,
                    imageUrl,
                  }
                })
                .filter(Boolean)

              if (items.length) {
                const okMasonry = renderMasonry(items)
                if (okMasonry) {
                  fallback.style.display = 'none'
                  inFlightForUrl = null
                  return
                }
              }
            }
          } catch {
            // ignore; fall back to pinit.js widget path
          }
        }

        fallback.innerHTML = ''
        fallback.textContent = 'Loading Pinterest board…'

        const publicEmbedPreview = await tryPublicEmbedPreview(runId)
        if (publicEmbedPreview.stale) return
        if (publicEmbedPreview.ok) {
          inFlightForUrl = null
          return
        }

        fallback.innerHTML = ''
        fallback.textContent = 'Trying your Pinterest session…'

        const privatePreview = await attemptSessionPreview({
          runId,
          strategy: 'session-only',
          maxPins: 30,
          timeoutMs: 30000,
        })
        if (privatePreview.stale) return
        if (privatePreview.ok) {
          inFlightForUrl = null
          return
        }

        showPreviewFallback({
          message: 'Couldn\'t load board preview.',
          kind: 'board',
        })
        inFlightForUrl = null
      }

      refresh()

      return {
        dom: container,
        selectNode: () => {
          container.classList.add('is-selected')
        },
        deselectNode: () => {
          container.classList.remove('is-selected')
          // Keep behavior aligned with editor selection state:
          // if user clicks away/unselects, collapse back.
          collapseIfExpanded()
        },
        update: (updatedNode) => {
          if (updatedNode.type.name !== node.type.name) return false

          // Update in-place.
          currentUrl = updatedNode.attrs.url
          link.href = currentUrl
          link.setAttribute('data-pin-board-width', String(updatedNode.attrs.boardWidth || 400))
          link.setAttribute('data-pin-scale-height', String(updatedNode.attrs.scaleHeight || 320))
          link.setAttribute('data-pin-scale-width', String(updatedNode.attrs.scaleWidth || 80))

          refresh()
          return true
        },
        destroy: () => {
          refreshPreviewBtn.removeEventListener('click', onRefreshPreview)
          container.removeEventListener('click', onExpand)
          container.removeEventListener('contextmenu', onTileContextMenu)
          expandHint.removeEventListener('click', onExpand)
          document.removeEventListener('pointerdown', onOutsidePointerDown, true)
          document.removeEventListener('selectionchange', onSelectionChange)
          window.removeEventListener('blur', onWindowBlur)
          try {
            resizeObserver?.disconnect()
          } catch {
            // ignore
          }
          resizeObserver = null
          try {
            selectionClassObserver?.disconnect()
          } catch {
            // ignore
          }
          selectionClassObserver = null
        },
      }
    }
  },

  addProseMirrorPlugins() {
    const key = new PluginKey('pinterestBoardAutoEmbed')

    return [
      new Plugin({
        key,
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some(t => t.docChanged)) return null

          const boardType = newState.schema.nodes.pinterestBoard
          if (!boardType) return null

          let tr = newState.tr
          let modified = false

          newState.doc.descendants((node, pos) => {
            if (node.type.name !== 'paragraph') return

            // Only transform paragraphs that are *just* a URL.
            if (node.content.childCount !== 1) return
            const child = node.firstChild
            if (!child?.isText) return

            const raw = child.text
            if (!raw) return

            const url = normalizePinterestBoardUrl(raw)
            if (!url) return

            // Require that trimming doesn't remove other characters (avoid converting mid-sentence).
            if (raw.trim() !== raw) return

            const from = tr.mapping.map(pos)
            const to = from + node.nodeSize

            const boardNode = boardType.create({
              url,
              boardWidth: 400,
              scaleHeight: 320,
              scaleWidth: 80,
            })

            tr = tr.replaceWith(from, to, boardNode)
            modified = true

            // Don’t descend into replaced content.
            return false
          })

          return modified ? tr : null
        },
      }),
    ]
  },
})

export default PinterestBoard
