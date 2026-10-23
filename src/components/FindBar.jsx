/**
 * FindBar.jsx — find and replace in the open document (⌘F).
 *
 * While it is open it is the card's toolbar (DESIGN.md §6), as an address bar becomes a
 * find field: the field, "2 of 5", previous and next, close, and a click away the
 * replace field beside it. The toolbar's tools stay mounted, hidden, and come back as
 * they were. Enter goes to the next match, Shift+Enter the previous; Escape puts the
 * bar away and gives the document back its caret.
 *
 * It opens on FIND_EVENT (requestFind, from ⌘F or the project search's "Find all in
 * this document"), with what was selected or searched for already in the field.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../ui/Icon.jsx'
import IconButton from '../ui/IconButton.jsx'
import Button from '../ui/Button.jsx'
import { FIND_EVENT, collectEditorMatches, createMatcher } from '../lib/sidebarSearch'
import './FindBar.css'

export default function FindBar({ editor }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [replaceValue, setReplaceValue] = useState('')
  const [current, setCurrent] = useState(0)
  // Bumped by each edit to the document, so the matches are counted again.
  const [revision, setRevision] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    const onFind = (event) => {
      const asked = event.detail?.query
      if (asked) setQuery(asked)
      setCurrent(0)
      setOpen(true)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
    window.addEventListener(FIND_EVENT, onFind)
    return () => window.removeEventListener(FIND_EVENT, onFind)
  }, [])

  useEffect(() => {
    if (!open || !editor) return undefined
    const onUpdate = () => setRevision((value) => value + 1)
    editor.on('update', onUpdate)
    return () => editor.off('update', onUpdate)
  }, [editor, open])

  const matcher = useMemo(() => createMatcher(query), [query])
  const matches = useMemo(
    () => (open && editor && !editor.isDestroyed ? collectEditorMatches(editor, matcher) : []),
    // `revision` re-counts after an edit; the editor object itself does not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, matcher, open, revision],
  )
  const index = matches.length ? Math.min(current, matches.length - 1) : -1

  const select = useCallback((match, { focus = false } = {}) => {
    if (!editor || !match) return
    const chain = editor.chain()
    if (focus) chain.focus()
    chain.setTextSelection({ from: match.from, to: match.to }).scrollIntoView().run()
  }, [editor])

  const go = (step) => {
    if (!matches.length) return
    const next = (index + step + matches.length) % matches.length
    setCurrent(next)
    select(matches[next])
  }

  const close = () => {
    setOpen(false)
    setReplacing(false)
    editor?.commands.focus()
  }

  const replaceOne = () => {
    const target = matches[index]
    if (!editor || !target) return
    editor.chain().setTextSelection({ from: target.from, to: target.to }).insertContent(replaceValue).run()
  }

  // One transaction, applied back to front so replacing an early match does not shift
  // the positions of the ones after it: one step to undo.
  const replaceAll = () => {
    const view = editor?.view
    if (!view || !matches.length) return
    let tr = view.state.tr
    ;[...matches].sort((left, right) => right.from - left.from).forEach((match) => {
      tr = tr.insertText(replaceValue, match.from, match.to)
    })
    view.dispatch(tr.scrollIntoView())
  }

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'Enter' && event.target === inputRef.current) {
      event.preventDefault()
      go(event.shiftKey ? -1 : 1)
    }
  }

  if (!open) return null

  const count = matches.length ? `${index + 1} of ${matches.length}` : query ? 'No matches' : ''

  return (
    <div className="find-bar" role="search" aria-label="Find in document" onKeyDown={onKeyDown}>
      <div className="find-bar-row">
        <IconButton
          icon={replacing ? 'chevron-down' : 'chevron-right'}
          label={replacing ? 'Hide replace' : 'Replace'}
          size="capsule"
          aria-expanded={replacing}
          onClick={() => setReplacing((value) => !value)}
        />
        <label className="find-bar-field">
          <Icon name="search" className="find-bar-field-icon" />
          <input
            ref={inputRef}
            className="find-bar-input"
            type="text"
            placeholder="Find in document"
            aria-label="Find in document"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setCurrent(0) }}
          />
          <span className="find-bar-count ib-meta" aria-live="polite">{count}</span>
        </label>
        <IconButton icon="chevron-up" label="Previous match" title="Previous match (Shift+Enter)" size="capsule" disabled={!matches.length} onClick={() => go(-1)} />
        <IconButton icon="chevron-down" label="Next match" title="Next match (Enter)" size="capsule" disabled={!matches.length} onClick={() => go(1)} />
        <IconButton icon="close" label="Close" title="Close (Esc)" size="capsule" onClick={close} />
      </div>
      {replacing ? (
        <div className="find-bar-row find-bar-replace">
          <label className="find-bar-field">
            <Icon name="edit" className="find-bar-field-icon" />
            <input
              className="find-bar-input"
              type="text"
              placeholder="Replace with"
              aria-label="Replace with"
              value={replaceValue}
              onChange={(event) => setReplaceValue(event.target.value)}
            />
          </label>
          <Button disabled={index < 0} onClick={replaceOne}>Replace</Button>
          <Button disabled={!matches.length} onClick={replaceAll}>Replace all</Button>
        </div>
      ) : null}
    </div>
  )
}
