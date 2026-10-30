/**
 * usePeekSpring — a hidden sidebar peeking over the card, and going again, on a spring
 * that can be turned round.
 *
 * Hidden and peeked are both undocked: only the sidebar's slide and fade change between
 * them. A CSS transition reversed mid-slide sets off again from a standstill, which
 * shows as a stop when the pointer brushes the edge and leaves. Here the slide is a
 * SpringValue written to the sidebar's style, so a peek called off mid-way turns round
 * at the speed it was going (docs/DESIGN.md §7).
 *
 * Docking and undocking stay with the stylesheet (Sidebar.css), which also moves the
 * card's margins: the spring only takes over between two undocked states, and lets go
 * of the style whenever the sidebar is docked.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SPRINGS } from '../ui/physics.js'
import { SpringValue } from '../ui/useSpring.js'

const STYLED = ['transform', 'opacity', 'visibility', 'transition']

export default function usePeekSpring(sidebarRef, { side, docked, shown }) {
  const [spring] = useState(() => new SpringValue(shown || docked ? 1 : 0, { spring: SPRINGS.smooth, precision: 0.001 }))
  const was = useRef({ docked, shown })

  useLayoutEffect(() => {
    const element = sidebarRef.current
    const sign = side === 'left' ? -1 : 1
    const release = () => {
      if (!element) return
      for (const property of STYLED) element.style.removeProperty(property)
    }
    const paint = (progress) => {
      if (!element) return
      element.style.transition = 'none'
      element.style.transform = `translateX(calc((100% + var(--sidebar-inset) * 2) * ${sign * (1 - progress)}))`
      element.style.opacity = String(Math.min(1, Math.max(0, progress)))
      element.style.visibility = progress > 0.001 ? 'visible' : 'hidden'
    }
    spring.onChange = paint
    spring.onRest = (progress) => { if (progress === 0 || progress === 1) paint(progress) }

    const before = was.current
    was.current = { docked, shown }
    const target = shown || docked ? 1 : 0
    if (docked || before.docked) {
      // Docking or undocking: the stylesheet moves it and the card together.
      spring.stop()
      spring.jump(target)
      release()
      return
    }
    if (before.shown === shown) return
    // From hidden to peeked or back: from wherever it is drawn, at the speed it is going.
    spring.set(target)
    if (!spring.moving) paint(target)
  }, [docked, shown, side, sidebarRef, spring])

  useEffect(() => () => spring.stop(), [spring])
}
