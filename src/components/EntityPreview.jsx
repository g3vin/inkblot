/**
 * EntityPreview.jsx — the card a name tag shows when the pointer rests on it: what the
 * entry is (Character, Setting…), its name and other names, and the first lines of its
 * document or canvas, with a way to open it.
 *
 * It answers ENTITY_PREVIEW_EVENT (lib/entityLinks.js), from tags in documents and on
 * canvas cards alike. It never takes focus: the writer is reading, and may be typing.
 * It shows after a short rest, so sweeping across a page of names opens nothing, and
 * stays while the pointer crosses from the tag onto it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { shellBridge } from '../bridge'
import { Button, Card } from '../ui'
import { fieldsProject } from '../lib/documentFields'
import { ENTITY_PREVIEW_EVENT, linkHint } from '../lib/entityLinks'
import { entryExcerpt } from '../lib/entryExcerpt'
import { placePopover } from '../ui/placePopover'
import { useStoryEntries } from '../lib/storyEntries'
import './EntityPreview.css'

const SHOW_DELAY_MS = 450
const HIDE_DELAY_MS = 200
export default function EntityPreview() {
  const entries = useStoryEntries()
  const [target, setTarget] = useState(null)
  const [excerpt, setExcerpt] = useState({ path: null, text: '' })
  const [place, setPlace] = useState(null)
  const cardRef = useRef(null)
  const timers = useRef({ show: 0, hide: 0 })
  const overCard = useRef(false)

  useEffect(() => {
    const clear = () => {
      window.clearTimeout(timers.current.show)
      window.clearTimeout(timers.current.hide)
    }
    const onPreview = ({ detail }) => {
      clear()
      if (detail?.path) {
        timers.current.show = window.setTimeout(() => setTarget({ path: detail.path, rect: detail.rect }), SHOW_DELAY_MS)
      } else {
        timers.current.hide = window.setTimeout(() => { if (!overCard.current) setTarget(null) }, HIDE_DELAY_MS)
      }
    }
    const close = () => {
      clear()
      overCard.current = false
      setTarget(null)
    }
    const onKey = (event) => { if (event.key === 'Escape') close() }
    window.addEventListener(ENTITY_PREVIEW_EVENT, onPreview)
    window.addEventListener('keydown', onKey)
    // The tag moves with the page: a scrolled card would point at nothing.
    window.addEventListener('scroll', close, true)
    return () => {
      clear()
      window.removeEventListener(ENTITY_PREVIEW_EVENT, onPreview)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
    }
  }, [])

  const path = target?.path || null
  useEffect(() => {
    const project = fieldsProject()
    if (!path || !project) return undefined
    let live = true
    entryExcerpt(project, path).then((text) => { if (live) setExcerpt({ path, text }) }).catch(() => {})
    return () => { live = false }
  }, [path])

  // Placed once its size is known, under the tag or, without room, over it.
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!target || !card) {
      setPlace(null)
      return
    }
    const { width, height } = card.getBoundingClientRect()
    setPlace(placePopover(target.rect, { width, height }, { width: window.innerWidth, height: window.innerHeight }))
  }, [target, excerpt])

  const entry = path ? entries.find((item) => item.path === path) : null
  if (!target || !entry) return null
  const text = excerpt.path === path ? excerpt.text : ''

  return (
    <Card
      ref={cardRef}
      ink={entry.ink}
      className="entity-preview"
      role="tooltip"
      style={place ? { left: place.left, top: place.top } : { visibility: 'hidden' }}
      onMouseEnter={() => {
        overCard.current = true
        window.clearTimeout(timers.current.hide)
      }}
      onMouseLeave={() => {
        overCard.current = false
        timers.current.hide = window.setTimeout(() => setTarget(null), HIDE_DELAY_MS)
      }}
    >
      <p className="ib-eyebrow">{entry.kind}</p>
      <p className="ib-title entity-preview-name">{entry.name}</p>
      {entry.aliases.length ? <p className="ib-hint">{`Also called ${entry.aliases.join(', ')}`}</p> : null}
      {text ? <p className="ib-body entity-preview-excerpt">{text}</p> : null}
      <div className="entity-preview-foot">
        <span className="ib-meta">{`${linkHint()} a name to open it`}</span>
        <Button
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            shellBridge.send('openDocument', { path: entry.path, pane: 'primary' })
            setTarget(null)
          }}
        >
          Open
        </Button>
      </div>
    </Card>
  )
}
