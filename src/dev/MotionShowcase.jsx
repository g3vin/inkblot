/**
 * MotionShowcase.jsx — the showcase's Motion section (docs/DESIGN.md §7): each spring's
 * curve, a puck to flick between stops (projection, the rubber band, momentum's
 * overshoot) and a box to send back and forth mid-flight (a retarget keeps its speed).
 */
import { useRef, useState } from 'react'
import { Button, Card } from '../ui'
import { SPRINGS, nearestTarget, project, rubberClamp, settleTime, spring, springAt, trackSample, velocityFrom } from '../ui/physics.js'
import { useSpring } from '../ui/useSpring.js'

const CURVE_W = 200
const CURVE_H = 80

/** A spring from rest drawn over its settle time, with the line it settles on. */
function SpringCurve({ name, preset }) {
  const params = spring(preset)
  const settle = settleTime(params)
  // Room above the line for an overshoot.
  const top = 1.25
  const points = Array.from({ length: 61 }, (_, i) => {
    const t = (settle * i) / 60
    const value = springAt(params, 0, 1, 0, t).value
    return `${((i / 60) * CURVE_W).toFixed(1)},${(CURVE_H - (value / top) * CURVE_H).toFixed(1)}`
  })
  const rest = CURVE_H - CURVE_H / top
  return (
    <Card>
      <p className="ib-meta">{`--spring-${name}`}</p>
      <svg className="ds-spring-curve" viewBox={`0 0 ${CURVE_W} ${CURVE_H}`} role="img" aria-label={`The ${name} spring`}>
        <line x1="0" x2={CURVE_W} y1={rest} y2={rest} className="ds-spring-rest" />
        <polyline points={points.join(' ')} className="ds-spring-line" />
      </svg>
      <p className="ib-meta">{`${preset.duration}ms · bounce ${preset.bounce} · still by ${Math.round(settle)}ms`}</p>
    </Card>
  )
}

const STOPS = [0, 0.5, 1]

/** Drag and let go: it lands on the stop nearest where the throw would coast to. */
function FlickDemo() {
  const railRef = useRef(null)
  const puckRef = useRef(null)
  const ghostRef = useRef(null)
  const drag = useRef(null)
  const x = useSpring(0, {
    spring: SPRINGS.momentum,
    onChange: (value) => { if (puckRef.current) puckRef.current.style.translate = `${value}px 0` },
  })
  const width = () => (railRef.current?.clientWidth ?? 0) - (puckRef.current?.offsetWidth ?? 0)

  const onPointerDown = (event) => {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    x.stop()
    drag.current = { grab: event.clientX - x.value, samples: [] }
  }
  const onPointerMove = (event) => {
    if (!drag.current) return
    const raw = event.clientX - drag.current.grab
    trackSample(drag.current.samples, { t: performance.now(), x: raw })
    x.jump(rubberClamp(raw, 0, width(), width()))
  }
  const onPointerUp = () => {
    if (!drag.current) return
    const velocity = velocityFrom(drag.current.samples).x
    drag.current = null
    const span = width()
    const landing = nearestTarget(x.value, velocity, STOPS.map((stop) => stop * span))
    if (ghostRef.current) {
      ghostRef.current.style.translate = `${Math.max(0, Math.min(span, x.value + project(velocity)))}px 0`
      ghostRef.current.dataset.shown = 'true'
    }
    x.set(landing, { velocity })
  }

  return (
    <Card>
      <p className="ib-meta">Flick between the stops</p>
      <div ref={railRef} className="ds-flick-rail">
        {STOPS.map((stop) => <span key={stop} className="ds-flick-stop" style={{ left: `calc(${stop} * (100% - var(--size-circle)))` }} />)}
        <span ref={ghostRef} className="ds-flick-ghost" aria-hidden="true" />
        <span
          ref={puckRef}
          className="ds-flick-puck"
          role="presentation"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
      <p className="ib-meta">The ring marks where the throw would coast to.</p>
    </Card>
  )
}

/** Send it back and forth as fast as you like: it turns round without a jump. */
function RetargetDemo() {
  const boxRef = useRef(null)
  const [far, setFar] = useState(false)
  const x = useSpring(0, {
    spring: SPRINGS.smooth,
    onChange: (value) => { if (boxRef.current) boxRef.current.style.translate = `${value}px 0` },
  })
  const toggle = () => {
    const next = !far
    setFar(next)
    const span = (boxRef.current?.parentElement?.clientWidth ?? 0) - (boxRef.current?.offsetWidth ?? 0)
    x.set(next ? span : 0)
  }
  return (
    <Card>
      <p className="ib-meta">Retarget mid-flight</p>
      <div className="ds-flick-rail"><span ref={boxRef} className="ds-flick-puck" /></div>
      <Button onClick={toggle}>{far ? 'Send it back' : 'Send it over'}</Button>
    </Card>
  )
}

export default function MotionShowcase() {
  return (
    <>
      <div className="ds-grid">
        {Object.entries(SPRINGS).map(([name, preset]) => <SpringCurve key={name} name={name} preset={preset} />)}
      </div>
      <div className="ds-grid">
        <FlickDemo />
        <RetargetDemo />
      </div>
    </>
  )
}
