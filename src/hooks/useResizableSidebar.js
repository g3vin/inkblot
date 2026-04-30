import { useState, useCallback, useEffect, useRef } from 'react'

export function useResizableSidebar(initial, min, max, side = 'left') {
  const [width, setWidth] = useState(initial)
  const [resizing, setResizing] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [pinned, setPinned] = useState(true)
  const [peeked, setPeeked] = useState(false)
  const lastWidthRef = useRef(initial)
  const lastClientXRef = useRef(null)
  const draggingRef = useRef(false)

  const collapse = useCallback(() => {
    setCollapsed(true)
    setPeeked(false)
    setPinned(false)
    setWidth(0)
  }, [])

  const pin = useCallback(() => {
    setPinned(true)
    setCollapsed(false)
    setPeeked(false)
    setWidth(lastWidthRef.current || min)
  }, [min])

  const unpin = useCallback(() => {
    setPinned(false)
  }, [])

  const togglePin = useCallback(() => {
    setPinned(prev => {
      if (prev) return false
      setCollapsed(false)
      setPeeked(false)
      setWidth(lastWidthRef.current || min)
      return true
    })
  }, [min])

  const onMouseMove = useCallback(
    e => {
      if (!resizing) return
      lastClientXRef.current = e.clientX
      const value =
        side === 'left'
          ? e.clientX
          : window.innerWidth - e.clientX
      const collapseThreshold = 40

      if (value <= collapseThreshold) {
        lastWidthRef.current = width || lastWidthRef.current
        setResizing(false)
        collapse()
        return
      }

      if (value >= min && value <= max) {
        setWidth(value)
        lastWidthRef.current = value
        setCollapsed(false)
        setPeeked(false)
      }
    },
    [resizing, min, max, side, collapse, width]
  )

  useEffect(() => {
    const onMouseUp = () => {
      draggingRef.current = false
      setResizing(false)
    }

    const onMouseLeave = (e) => {
      if (!resizing) return
      const lastX = e?.clientX ?? lastClientXRef.current
      if (lastX == null) return

      const collapseThreshold = 40
      const shouldCollapse =
        side === 'left'
          ? lastX <= collapseThreshold || lastX <= 0
          : lastX >= window.innerWidth - collapseThreshold || lastX >= window.innerWidth

      if (shouldCollapse) {
        lastWidthRef.current = width || lastWidthRef.current
        draggingRef.current = false
        setResizing(false)
        collapse()
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('mouseleave', onMouseLeave)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('mouseleave', onMouseLeave)
    }
  }, [onMouseMove, resizing, side, width, collapse])

  useEffect(() => {
    const onEdgeHover = (e) => {
      if (pinned || !collapsed || draggingRef.current) return

      const nearEdge =
        side === 'left'
          ? e.clientX <= 4
          : e.clientX >= window.innerWidth - 4

      if (nearEdge) {
        setPeeked(true)
        setWidth(lastWidthRef.current || min)
      }
    }

    window.addEventListener('mousemove', onEdgeHover)
    return () => window.removeEventListener('mousemove', onEdgeHover)
  }, [collapsed, pinned, side, min])

  const displayWidth = collapsed && !peeked ? 0 : width

  return {
    width: displayWidth,
    resizing,
    start: () => {
      draggingRef.current = true
      setResizing(true)
    },
    collapsed,
    pinned,
    peeked,
    pin,
    unpin,
    togglePin,
    collapse,
  }
}
