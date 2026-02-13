import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

const PINTEREST_SCRIPT_ID = 'inkblot-pinterest-pinit-js'
const PINTEREST_SCRIPT_SRC = 'https://assets.pinterest.com/js/pinit.js'

const PINTEREST_PIDGETS_BASE = 'https://widgets.pinterest.com/v3/pidgets/boards'
const PINTEREST_LOG = '[PinterestBoard]'

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
 * Returns a canonical Pinterest board URL if `text` looks like a board URL.
 * Otherwise returns null.
 */
export function normalizePinterestBoardUrl(text) {
  if (!text) return null
  const trimmed = String(text).trim()
  if (!trimmed) return null

  // Fast path: only consider pinterest.com URLs.
  if (!/^https?:\/\//i.test(trimmed)) return null

  let url
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase()
  if (!(host === 'pinterest.com' || host === 'www.pinterest.com')) return null

  // Board URLs are typically: /{username}/{board}/
  const segments = url.pathname
    .split('/')
    .map(s => s.trim())
    .filter(Boolean)

  if (segments.length < 2) return null

  const [first, second] = segments

  // Ignore non-board routes.
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

      const actions = document.createElement('div')
      actions.className = 'pinterest-board-actions'

      const openInAppBtn = document.createElement('button')
      openInAppBtn.type = 'button'
      openInAppBtn.className = 'pinterest-board-open-in-app'
      openInAppBtn.textContent = 'Open in Pinterest window'

      const onOpenInApp = async (e) => {
        e.preventDefault()
        e.stopPropagation()
        try {
          const mod = await import('../openPinterest')
          if (mod && typeof mod.openPinterest === 'function') {
            await mod.openPinterest(currentUrl)
          }
        } catch {
          // ignore
        }
      }

      openInAppBtn.addEventListener('click', onOpenInApp)

      actions.appendChild(openInAppBtn)

      container.appendChild(inner)
      container.appendChild(fallback)
      container.appendChild(actions)
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

        // Default to showing the fallback while we work.
        fallback.style.display = ''

        const parts = parsePinterestBoardParts(currentUrl)

        // Board section (sub-board) preview.
        // Pinterest's embedBoard (and the board-pins pidgets endpoint) do not reliably
        // filter by section slug. For public sections, we instead scrape the actual
        // section page in a hidden Pinterest webview window.
        if (parts?.section) {
          console.debug(PINTEREST_LOG, 'section preview start', {
            url: currentUrl,
            user: parts.user,
            board: parts.board,
            section: parts.section,
          })
          fallback.textContent = 'Loading section preview…'

          container.dataset.scrapeFinalUrl = ''
          container.dataset.scrapeReason = ''
          container.dataset.scrapeError = ''

          try {
            const mod = await import('../pinterestScrape')
            if (mod && typeof mod.scrapePinterestPins === 'function') {
              const scrapeResult = await Promise.race([
                mod.scrapePinterestPins(currentUrl, {
                  maxPins: 30,
                  timeoutMs: 30000,
                }),
                new Promise(resolve => setTimeout(() => resolve({ pins: [], reason: 'timeout' }), 35000)),
              ])

              console.debug(PINTEREST_LOG, 'section scrape result', {
                url: currentUrl,
                resultShape: Array.isArray(scrapeResult) ? 'array' : 'object',
                reason: Array.isArray(scrapeResult) ? '(legacy-array)' : scrapeResult?.reason,
                finalUrl: Array.isArray(scrapeResult) ? '' : scrapeResult?.finalUrl,
                pinCount: Array.isArray(scrapeResult)
                  ? scrapeResult.length
                  : (Array.isArray(scrapeResult?.pins) ? scrapeResult.pins.length : 0),
                error: Array.isArray(scrapeResult) ? '' : scrapeResult?.error,
              })

              // If a newer refresh started while we were scraping, ignore this result.
              if (runId !== refreshRunId) return

              const pins = Array.isArray(scrapeResult)
                ? scrapeResult
                : (Array.isArray(scrapeResult?.pins) ? scrapeResult.pins : [])

              if (pins.length) {
                const okMasonry = renderMasonry(pins)
                console.debug(PINTEREST_LOG, 'section masonry render result', {
                  url: currentUrl,
                  pinCount: pins.length,
                  okMasonry,
                })
                if (okMasonry) {
                  fallback.style.display = 'none'
                  inFlightForUrl = null
                  return
                }
              }

              // Keep some details around for the fallback message.
              const finalUrl = !Array.isArray(scrapeResult) ? String(scrapeResult?.finalUrl || '') : ''
              const reason = !Array.isArray(scrapeResult) ? String(scrapeResult?.reason || '') : ''
              const errText = !Array.isArray(scrapeResult) ? String(scrapeResult?.error || '') : ''

              container.dataset.scrapeFinalUrl = finalUrl
              container.dataset.scrapeReason = reason
              container.dataset.scrapeError = errText
            }
          } catch {
            console.debug(PINTEREST_LOG, 'section scrape threw error', { url: currentUrl })
            // ignore
          }

          // If scrape fails, avoid falling back to the full parent board.
          fallback.innerHTML = ''
          const msg = document.createElement('div')
          const finalUrl = container.dataset.scrapeFinalUrl || ''
          const reason = container.dataset.scrapeReason || ''
          const errText = container.dataset.scrapeError || ''

          let hint = ''
          if (finalUrl && finalUrl !== currentUrl && /\/login\b|\/accounts\b|\/signup\b/i.test(finalUrl)) {
            hint = ' (Pinterest redirected to login — open Pinterest and sign in, then try again.)'
          } else if (reason === 'eval_failed') {
            hint = ' (scrape window not ready yet — retry in a moment.)'
          } else if (reason === 'timeout') {
            hint = ' (timed out.)'
          }

          msg.textContent = `Couldn't load section preview.${hint} `
          const a = document.createElement('a')
          a.href = currentUrl
          a.target = '_blank'
          a.rel = 'noreferrer'
          a.textContent = 'Open on Pinterest'
          fallback.appendChild(msg)
          fallback.appendChild(a)

          // If we got a concrete error string, surface it in a tooltip for debugging.
          if (errText) {
            a.title = errText
          }

          console.debug(PINTEREST_LOG, 'section preview fallback shown', {
            url: currentUrl,
            reason,
            finalUrl,
            errText,
            hint,
          })

          fallback.style.display = ''
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

        const ok = await ensurePinterestScriptLoaded()
        if (!ok) {
          fallback.innerHTML = ''
          const a = document.createElement('a')
          a.href = currentUrl
          a.target = '_blank'
          a.rel = 'noreferrer'
          a.textContent = 'Open Pinterest board'
          fallback.appendChild(a)
          fallback.style.display = ''
          inFlightForUrl = null
          return
        }

        // Give the script a tick to register PinUtils.
        setTimeout(() => {
          const built = buildPinterestEmbeds(container)
          // Even if build() runs, Pinterest may refuse to render (e.g. private boards).
          // Check shortly after for an iframe/widget.
          fallback.style.display = ''

          setTimeout(() => {
            // If Pinterest rendered spans (non-iframe path), extract pins and render our own masonry.
            // If it rendered an iframe, we can't access contents; fall back.
            if (!container.querySelector('iframe')) {
              const extracted = extractPinsFromEmbedDom()
              if (extracted.length) {
                const okMasonry = renderMasonry(extracted)
                if (okMasonry) {
                  fallback.style.display = 'none'
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
              inFlightForUrl = null
              return
            }

            fallback.innerHTML = ''
            const msg = document.createElement('div')
            msg.textContent = 'Couldn\'t load embed (board may be private). '
            const a = document.createElement('a')
            a.href = currentUrl
            a.target = '_blank'
            a.rel = 'noreferrer'
            a.textContent = 'Open on Pinterest'
            fallback.appendChild(msg)
            fallback.appendChild(a)
            fallback.style.display = ''
            inFlightForUrl = null
          }, 1200)
        }, 0)
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
          openInAppBtn.removeEventListener('click', onOpenInApp)
          container.removeEventListener('click', onExpand)
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
