/**
 * CanvasLinkNode.jsx — a JSON Canvas `link` node: a URL on the canvas.
 *
 * A Pinterest board url renders as the board itself (a masonry of pins); anything
 * else renders as a plain link card. `link` is a node type the spec already defines,
 * so a canvas with a board on it still opens correctly in Obsidian — it just shows a
 * link there, which is exactly what it is.
 *
 * Pins come from the SAME preference-store cache the in-document board uses
 * (lib/pinterestBoard.js), so a board you have already looked at appears instantly,
 * with no scrape and no spinner. A refresh runs in the background at most once per
 * project-open.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchPinterestPins,
  hasRefreshedThisSession,
  isPinterestBoardUrl,
  markRefreshedThisSession,
  normalizePinterestBoardUrl,
  readPinterestCache,
} from '../lib/pinterestBoard'
import { openPinterest } from '../lib/openPinterest'

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function PinterestBoardNode({ node }) {
  const url = useMemo(() => normalizePinterestBoardUrl(node.url), [node.url])

  // Start from the cache, so a known board paints on the first frame.
  const [pins, setPins] = useState(() => readPinterestCache(url)?.pins || [])
  const [status, setStatus] = useState(() => (readPinterestCache(url)?.pins?.length ? 'ready' : 'idle'))
  const startedRef = useRef(false)

  useEffect(() => {
    if (!url) return

    const cached = readPinterestCache(url)?.pins || []
    setPins(cached)

    // Refresh at most once per project-open: scraping drives a hidden webview and is
    // far too expensive to repeat every time a card scrolls into view.
    if (cached.length && hasRefreshedThisSession(url)) {
      setStatus('ready')
      return
    }
    if (startedRef.current) return
    startedRef.current = true

    let cancelled = false
    setStatus(cached.length ? 'ready' : 'loading')

    fetchPinterestPins(url).then(({ pins: fresh }) => {
      if (cancelled) return
      markRefreshedThisSession(url)
      if (fresh.length) {
        setPins(fresh)
        setStatus('ready')
      } else {
        setStatus(cached.length ? 'ready' : 'empty')
      }
    })

    return () => {
      cancelled = true
    }
  }, [url])

  const open = (event, target) => {
    event.preventDefault()
    event.stopPropagation()
    void openPinterest(target).catch(() => {})
  }

  /*
   * A press anywhere on the card must be able to DRAG the card — including the header
   * and the pins, which is most of it. So nothing here swallows pointerdown; the press
   * falls through to CanvasNode and starts a move.
   *
   * The cost is that a pin's click still fires at the end of a drag, which would open
   * Pinterest every time you repositioned the card. So a click only counts as a click
   * if the pointer barely moved.
   */
  const pressRef = useRef({ x: 0, y: 0 })

  const notePress = (event) => {
    pressRef.current = { x: event.clientX, y: event.clientY }
  }

  const wasClick = (event) =>
    Math.abs(event.clientX - pressRef.current.x) + Math.abs(event.clientY - pressRef.current.y) < 4

  const openIfClick = (event, target) => {
    event.preventDefault()
    if (!wasClick(event)) return
    open(event, target)
  }

  return (
    <div className="canvas-board" onPointerDown={notePress}>
      <div className="canvas-board-header" onDoubleClick={(event) => open(event, url)}>
        <span className="canvas-board-title">{node.label || 'Pinterest board'}</span>
        <button
          type="button"
          className="canvas-board-open"
          // The button is the one thing that must NOT start a card drag.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => open(event, url)}
          title="Open in Pinterest"
        >
          Open
        </button>
      </div>

      {pins.length ? (
        <div className="canvas-board-scroll" data-canvas-scroll>
          {/* Same class names as the in-document board, so one restyle covers both. */}
          <div className="canvas-board-masonry pinterest-board-masonry">
            {pins.map((pin) => (
              <a
                key={`${pin.pinHref}::${pin.imageUrl}`}
                className="pinterest-board-masonry-item"
                href={pin.pinHref}
                onClick={(event) => openIfClick(event, pin.pinHref)}
              >
                <img src={pin.imageUrl} alt="" loading="lazy" decoding="async" draggable={false} />
              </a>
            ))}
          </div>
        </div>
      ) : (
        <div className="canvas-board-empty">
          {status === 'loading' ? 'Loading board…' : null}
          {status === 'empty'
            ? 'No preview available. Open Pinterest and sign in, then refresh.'
            : null}
          {status === 'idle' ? 'No pins cached yet.' : null}
        </div>
      )}
    </div>
  )
}

function PlainLinkNode({ node }) {
  const pressRef = useRef({ x: 0, y: 0 })

  return (
    // Like the board: the whole card must stay draggable, so the press falls through
    // and only a genuine click (not the tail of a drag) follows the link.
    <a
      className="canvas-link"
      href={node.url}
      onPointerDown={(event) => {
        pressRef.current = { x: event.clientX, y: event.clientY }
      }}
      onClick={(event) => {
        event.preventDefault()
        const moved =
          Math.abs(event.clientX - pressRef.current.x) +
          Math.abs(event.clientY - pressRef.current.y)
        if (moved >= 4) return
        event.stopPropagation()
        try {
          window.open(node.url, '_blank', 'noopener,noreferrer')
        } catch {
          // Opening a link is best-effort.
        }
      }}
    >
      <span className="canvas-link-title">{node.label || hostOf(node.url)}</span>
      <span className="canvas-link-url">{node.url}</span>
    </a>
  )
}

export default function CanvasLinkNode({ node }) {
  return isPinterestBoardUrl(node.url) ? (
    <PinterestBoardNode node={node} />
  ) : (
    <PlainLinkNode node={node} />
  )
}
