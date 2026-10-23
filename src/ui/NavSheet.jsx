/**
 * NavSheet — a large Dialog with a list of pages down its left side and the chosen page
 * on the right: Settings (⌘,) and Help. One stop in the tab order, on the page showing;
 * ↑/↓ move between pages. Items may carry a `group`, which heads a run of them
 * (Help's sections). `aside` sits above the list (Help's filter field).
 */
import { useEffect, useRef } from 'react'
import Icon from './Icon.jsx'
import Dialog from './Dialog.jsx'
import './NavSheet.css'

export default function NavSheet({ title, label, items, value, onChange, onClose, className, aside, children }) {
  const navRef = useRef(null)
  const at = items.findIndex((item) => item.id === value)

  // Opened on a page far down the list (Help, on the topic a right-click asked
  // about), or moved to one: bring it into view.
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [value])

  const move = (step) => {
    if (!items.length) return
    const next = items[(Math.max(at, 0) + step + items.length) % items.length]
    onChange(next.id)
    requestAnimationFrame(() => navRef.current?.querySelector('[aria-current="page"]')?.focus())
  }

  return (
    <Dialog title={title} onClose={onClose} size="large" className={['ib-navsheet', className].filter(Boolean).join(' ')}>
      <div className="ib-navsheet-layout">
        <div className="ib-navsheet-side">
          {aside}
          <nav ref={navRef} className="ib-navsheet-nav" aria-label={label ?? title}>
            {items.map((item, index) => (
              <div key={item.id} className="ib-navsheet-entry">
                {item.group && item.group !== items[index - 1]?.group ? <p className="ib-eyebrow ib-navsheet-group">{item.group}</p> : null}
                <button
                  type="button"
                  aria-current={item.id === value ? 'page' : undefined}
                  tabIndex={item.id === value || (at === -1 && index === 0) ? 0 : -1}
                  onClick={() => onChange(item.id)}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                    event.preventDefault()
                    move(event.key === 'ArrowDown' ? 1 : -1)
                  }}
                >
                  {item.icon ? <Icon name={item.icon} /> : null}
                  <span className="ib-navsheet-item-title">{item.title}</span>
                </button>
              </div>
            ))}
          </nav>
        </div>
        <div className="ib-navsheet-pane" key={value}>{children}</div>
      </div>
    </Dialog>
  )
}
