/**
 * NativeDraftPane.jsx — the new-tab chooser, when the shell draws it.
 *
 * Takes `DraftTabPane`'s place in the pane and draws nothing: the pane is still the
 * page's (a draft holds it open, and a split stays up around it), so what is left here
 * is saying where it is — `draftPaneChanged`, with the pane's rectangle in the web
 * view's coordinates — and doing what the shell's chooser asks. Creating goes through
 * `createDraftDocument`, the same checks `DraftTabPane` runs; a refusal comes back as
 * the chooser's status line.
 */
import { useEffect, useRef, useState } from 'react'
import { documentSurface } from '../bridge'
import { createDraftDocument, DraftRefusal } from '../lib/draftDocument'

export default function NativeDraftPane({ tabId, projectName, onCreated, refreshFiles }) {
  const paneRef = useRef(null)
  const [rect, setRect] = useState(null)
  const [status, setStatus] = useState('')
  const [creating, setCreating] = useState(false)
  const wireTabId = tabId != null ? String(tabId) : null

  const latest = useRef({})
  useEffect(() => {
    latest.current = { wireTabId, projectName, onCreated, refreshFiles, creating }
  })

  // Follow the pane: it moves when a sidebar opens or a split is dragged.
  useEffect(() => {
    const pane = paneRef.current
    if (!pane) return undefined
    const measure = () => {
      const box = pane.getBoundingClientRect()
      setRect({ x: box.left, y: box.top, width: box.width, height: box.height })
    }
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(pane)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  useEffect(() => {
    if (!wireTabId) return
    documentSurface.publishDraftPaneChanged({
      tabId: wireTabId,
      ...(rect ? { rect } : {}),
      ...(status ? { status } : {}),
      creating,
    })
  }, [wireTabId, rect, status, creating])

  // Gone: the draft became a document, or another tab was chosen.
  useEffect(() => () => { documentSurface.publishDraftPaneChanged({ creating: false }) }, [])

  useEffect(() => documentSurface.onCommand('createFromDraft', async ({ tabId: target, name, kind }) => {
    const state = latest.current
    if (target !== state.wireTabId || state.creating || !state.projectName) return
    setCreating(true)
    setStatus('')
    try {
      const path = await createDraftDocument(state.projectName, name, kind)
      await state.refreshFiles?.()
      state.onCreated?.(path)
    } catch (error) {
      if (error instanceof DraftRefusal) {
        setStatus(error.message)
      } else {
        console.warn('Failed to create document:', error)
        setStatus('Could not create that document.')
      }
    } finally {
      setCreating(false)
    }
  }), [])

  return <div ref={paneRef} className="draft-pane" aria-hidden="true" />
}
