/**
 * SheetFlight — a sheet from a pile on the landing page growing into the document
 * card as the project opens (docs/DESIGN.md §7, "Opening a project").
 *
 * The flight is the card's paper, carried from the sheet to the card on --spring-gentle:
 * the sheet's own face fades as it lifts, and a page face (the same opening lines in
 * the editor's type, where the editor will draw them) fades in as it grows.
 *
 * Mounting the editor holds the page's main thread for a moment, so the flight sets
 * off first, aimed where the card was last time (lib/landingCard.js), and only once
 * it is running (two frames: it is then the compositor's) does it tell Editor to open
 * the project (`onLaunched`). When the real card is there it is measured, and if it is
 * somewhere else the rest of the path bends onto it. Landed, it says so (`onLanded`:
 * the card is shown under it and the RevealGate may open), and once the gate has
 * opened (`gateOpen`) it fades on --spring-smooth while the real document arrives in
 * place, then goes (`onDone`).
 *
 * Geometry is in lib/sheetFlight.js. Only transforms and opacity move, through the Web
 * Animations API. WAAPI ignores the stylesheet's reduced-motion rule, so the landing
 * page never starts a flight under Reduce motion.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PaperSheet } from '../../ui/Paper.jsx'
import { REVEAL } from '../../ui/motion.js'
import { flightKeyframes, measureFinalRect, retargetKeyframes } from '../../lib/sheetFlight'
import { SPRINGS, spring, springAt } from '../../ui/physics.js'
import { springTiming } from '../../ui/useSpring.js'
import { measurePage, predictCardRect, rememberCardRect } from '../../lib/landingCard'
import './SheetFlight.css'

/** When the sheet's face has gone, and when the page face is in, as shares of the flight. */
const SHEET_FADE = [0, 0.24]
const PAGE_FADE = [0.16, 0.6]
/** The editor draws headings as the browser does, so the page face uses the same tags. */
const PAGE_TAGS = { h1: 'h1', h2: 'h2', h3: 'h3', p: 'p' }
/** How long to look for the card before landing where the flight was aimed. */
const FIND_CARD_MS = 3000
const sameBox = (a, b) => ['left', 'top', 'width', 'height'].every((side) => Math.abs(a[side] - b[side]) < 1)

/** The flight is the long carry: the gentle spring, applied to the values. */
const FLIGHT = spring(SPRINGS.gentle)
const motionTokens = () => {
  const duration = REVEAL.arrive
  return { duration, ease: (t) => (t >= 1 ? 1 : springAt(FLIGHT, 0, 1, 0, t * duration).value) }
}

export default function SheetFlight({ arrival, cardRef, gateOpen = false, onLaunched, onLanded, onDone }) {
  const [target, setTarget] = useState(() => {
    const to = predictCardRect()
    return { to, page: measurePage(null, to), found: false }
  })
  const [landed, setLanded] = useState(false)
  const frameRef = useRef(null)
  const paperRef = useRef(null)
  const sheetRef = useRef(null)
  const sheetFadeRef = useRef(null)
  const pageRef = useRef(null)
  const pageFadeRef = useRef(null)
  // What is in flight: when it set off, where it was aimed, and its transform animations.
  const flight = useRef(null)
  const callbacks = useRef({ onLaunched, onLanded, onDone })
  useEffect(() => { callbacks.current = { onLaunched, onLanded, onDone } })

  // Set off, or bend onto the card once it has been found somewhere else.
  useLayoutEffect(() => {
    const from = { ...arrival.rect, rotate: arrival.rotate }
    const sheet = { width: arrival.rect.width, height: arrival.rect.height }
    const { duration, ease } = motionTokens()
    const layers = [frameRef, paperRef, sheetRef, pageRef].map((ref) => ref.current)
    const land = () => {
      if (flight.current?.landed) return
      flight.current.landed = true
      setLanded(true)
      callbacks.current.onLanded?.()
    }
    const run = (frames, timing) => {
      flight.current.animations?.forEach((animation) => animation.cancel())
      const sets = [frames.frame, frames.paper, frames.sheetFace, frames.pageFace]
      flight.current.animations = layers.map((layer, i) => layer?.animate(sets[i], timing)).filter(Boolean)
      flight.current.animations[0]?.finished.then(land, () => {})
    }

    if (!flight.current) {
      flight.current = { start: performance.now(), duration, to: target.to, landed: false }
      const timing = { duration, easing: 'linear', fill: 'both' }
      run(flightKeyframes({ from, to: target.to, sheet, ease }), timing)
      const fade = (a, b, [start, end]) => [
        { opacity: a, offset: 0 }, { opacity: a, offset: start }, { opacity: b, offset: end }, { opacity: b, offset: 1 },
      ]
      const { easing } = springTiming(SPRINGS.gentle)
      sheetFadeRef.current?.animate(fade(1, 0, SHEET_FADE), { ...timing, easing })
      pageFadeRef.current?.animate(fade(0, 1, PAGE_FADE), { ...timing, easing })
      return undefined
    }

    if (sameBox(flight.current.to, target.to)) return undefined
    const at = Math.min(1, (performance.now() - flight.current.start) / flight.current.duration)
    const was = flight.current.to
    flight.current.to = target.to
    if (flight.current.landed || at >= 1) {
      // Already down: the layers, now sized to the card, are simply put on it.
      flight.current.animations?.forEach((animation) => animation.cancel())
      return undefined
    }
    run(retargetKeyframes({ from, was, to: target.to, sheet, at, ease }), {
      duration: (1 - at) * flight.current.duration, easing: 'linear', fill: 'both',
    })
    return undefined
    // `arrival` is fixed for a flight's life; only the target moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  // Two frames in, the flight is the compositor's: now the editor may mount. Once only.
  const launched = useRef(false)
  useEffect(() => {
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        if (launched.current) return
        launched.current = true
        callbacks.current.onLaunched?.()
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  // Find the card once the editor has mounted it, and the text box inside it.
  useEffect(() => {
    if (target.found) return undefined
    const began = performance.now()
    let frame = 0
    const look = () => {
      const card = cardRef.current
      const to = card ? measureFinalRect(card) : null
      if (to && to.width > 0) {
        rememberCardRect(card)
        setTarget({ to, page: measurePage(card, to), found: true })
        return
      }
      if (performance.now() - began > FIND_CARD_MS) {
        setTarget((prev) => ({ ...prev, found: true }))
        return
      }
      frame = window.requestAnimationFrame(look)
    }
    frame = window.requestAnimationFrame(look)
    return () => window.cancelAnimationFrame(frame)
  }, [cardRef, target.found])

  // Never outstay a load that never reports: the gate's own timeout, and a little more.
  useEffect(() => {
    const timer = window.setTimeout(() => callbacks.current.onDone?.(), FIND_CARD_MS + REVEAL.gateTimeout + REVEAL.arrive)
    return () => window.clearTimeout(timer)
  }, [])

  const leaving = landed && gateOpen
  const { to, page } = target
  return createPortal(
    <div
      ref={frameRef}
      className={`sheet-flight${leaving ? ' is-leaving' : ''}`}
      style={{ left: to.left + to.width / 2, top: to.top + to.height / 2 }}
      aria-hidden="true"
      onAnimationEnd={(event) => { if (event.target === event.currentTarget) callbacks.current.onDone?.() }}
    >
      <div ref={paperRef} className="sheet-flight-paper" style={{ left: -to.width / 2, top: -to.height / 2, width: to.width, height: to.height }}>
        <div ref={pageRef} className="sheet-flight-face" style={{ width: to.width, height: to.height }}>
          <div ref={pageFadeRef} className="sheet-flight-page">
            <div className="sheet-flight-titlebar" style={{ height: page.titlebarHeight }} />
            {arrival.sheet.blocks?.length ? (
              <div
                className="sheet-flight-words ib-prose"
                style={{
                  left: page.left,
                  top: page.top,
                  width: page.width,
                  fontSize: page.fontSize,
                  lineHeight: page.lineHeight,
                  fontFamily: page.family,
                  '--flight-gap': page.gap,
                }}
              >
                {arrival.sheet.blocks.map((block, index) => {
                  const Tag = PAGE_TAGS[block.t] ?? 'p'
                  return <Tag key={index}>{block.x}</Tag>
                })}
              </div>
            ) : null}
          </div>
        </div>
        <div ref={sheetRef} className="sheet-flight-face" style={{ width: arrival.rect.width, height: arrival.rect.height }}>
          <div ref={sheetFadeRef} className="sheet-flight-sheet">
            <PaperSheet title={arrival.sheet.title} blocks={arrival.sheet.blocks} kind={arrival.sheet.kind} blank={arrival.sheet.blank} />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
