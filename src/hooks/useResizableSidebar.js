import { useState, useCallback, useEffect } from 'react'

export function useResizableSidebar(initial, min, max, side = 'left') {
  const [width, setWidth] = useState(initial)
  const [resizing, setResizing] = useState(false)

  const onMouseMove = useCallback(
    e => {
      if (!resizing) return
      const value =
        side === 'left'
          ? e.clientX
          : window.innerWidth - e.clientX
      if (value >= min && value <= max) setWidth(value)
    },
    [resizing, min, max, side]
  )

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', () => setResizing(false))
    return () => window.removeEventListener('mousemove', onMouseMove)
  }, [onMouseMove])

  return { width, start: () => setResizing(true) }
}