/**
 * CommandPalette.jsx — ⌘K (Ctrl+K elsewhere): search every action in the app.
 *
 * Mounted once, in App. Lists what src/lib/commands.ts holds, grouped by section,
 * fuzzy-matched as you type. ↑/↓ move, Enter runs, Escape closes. It behaves as a Dialog
 * does (the scrim, the motion in and out, an inert app behind); its body is its own: a
 * search field over a list (docs/DESIGN.md §9 → Dialogs).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { runCommand, scoreCommand, useCommandList } from '../lib/commands'
import { shortcutLabel, useKeybindingOverrides } from '../lib/keybindings'
import { useExitAnimation, useFocusTrap } from './hooks'
import Icon from './Icon'
import Kbd from './Kbd'
import './Dialog.css'
import './Popover.css'
import './CommandPalette.css'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

export default function CommandPalette() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (event) => {
      if ((isMac ? event.metaKey : event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('inkblot:command-palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('inkblot:command-palette', onOpen)
    }
  }, [])

  return open ? <PaletteDialog onClose={() => setOpen(false)} /> : null
}

function PaletteDialog({ onClose }) {
  const commands = useCommandList()
  const keybindings = useKeybindingOverrides()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const ref = useRef(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const scrimRef = useRef(null)
  useFocusTrap(true, ref, inputRef)

  // A Dialog's behaviour (DESIGN.md §9 → Dialogs): it leaves the way it came, and the app
  // behind is inert while it's open.
  useExitAnimation(scrimRef)
  useEffect(() => {
    const root = document.getElementById('root')
    root?.setAttribute('inert', '')
    return () => root?.removeAttribute('inert')
  }, [])

  const results = useMemo(() => {
    const scored = commands
      .map((command) => ({ command, score: scoreCommand(command, query) }))
      .filter((entry) => entry.score > 0)
    if (query.trim()) scored.sort((a, b) => b.score - a.score)
    else scored.sort((a, b) => a.command.section.localeCompare(b.command.section) || a.command.title.localeCompare(b.command.title))
    return scored.map((entry) => entry.command).slice(0, 60)
  }, [commands, query])

  const activeIndex = Math.min(active, Math.max(0, results.length - 1))

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const run = (command) => {
    onClose()
    // After the palette closes, so focus is back where the command expects it.
    window.requestAnimationFrame(() => { runCommand(command.id) })
  }

  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setActive((activeIndex + 1) % Math.max(1, results.length)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((activeIndex - 1 + results.length) % Math.max(1, results.length)) }
    else if (event.key === 'Enter' && results[activeIndex]) { event.preventDefault(); run(results[activeIndex]) }
  }

  let lastSection = null
  return createPortal(
    <div ref={scrimRef} className="ib-palette-scrim" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Command palette" className="ib-palette ib-menu" onKeyDown={onKeyDown}>
        <div className="ib-palette-search">
          <Icon name="search" size={20} />
          <input
            ref={inputRef}
            className="ib-palette-input"
            placeholder="Search commands…"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActive(0) }}
            role="combobox"
            aria-expanded="true"
            aria-controls="ib-palette-list"
            aria-activedescendant={results[activeIndex] ? `ib-palette-${results[activeIndex].id}` : undefined}
            spellCheck={false}
          />
          <Kbd>esc</Kbd>
        </div>
        <div ref={listRef} id="ib-palette-list" role="listbox" className="ib-palette-list">
          {results.length === 0 ? (
            <p className="ib-palette-empty">No commands match “{query}”.</p>
          ) : results.map((command, index) => {
            const header = !query.trim() && command.section !== lastSection
            lastSection = command.section
            return (
              <div key={command.id}>
                {header ? <div className="ib-eyebrow ib-palette-section">{command.section}</div> : null}
                <div
                  id={`ib-palette-${command.id}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  data-index={index}
                  className="ib-palette-item"
                  onPointerMove={() => setActive(index)}
                  onClick={() => run(command)}
                >
                  <span className="ib-palette-item-icon">{command.icon ? <Icon name={command.icon} /> : null}</span>
                  <span className="ib-palette-item-title">{command.title}</span>
                  {query.trim() ? <span className="ib-meta">{command.section}</span> : null}
                  {shortcutLabel(command, keybindings) ? <Kbd>{shortcutLabel(command, keybindings)}</Kbd> : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}
