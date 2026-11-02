/**
 * SelectionWheel — the tool wheel for selected text, opened by holding a key.
 *
 * Select some text and hold Option: the wheel blooms under the pointer, a flick toward
 * a tool and letting go of Option applies it. A quick tap of Option instead leaves the
 * wheel open to click or turn with the arrows. Nothing appears on a selection by itself.
 *
 * The key only counts held on its own: Option with anything else (⌥⇧→ extending a
 * selection, ⌥-letters, a shortcut, a click) is left alone. Which tools the wheel holds,
 * and the key, are the writer's (Settings ▸ Selection wheel).
 *
 * Without a keyboard (an iPad), a long press on the selection opens it under the finger:
 * drag toward a tool and lift.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ToolWheel } from '../ui'
import { useCommands } from '../lib/commands'
import { isEditorReady } from '../lib/editorUtils'
import { runSelectionTool, wheelItems } from '../lib/selectionTools'
import { useSelectionWheelSettings } from './selectionWheelSettings'

// Held this long, the key opens the wheel for a flick; released sooner, it was a tap.
const HOLD_MS = 180
// A finger held this long on the selection, without moving further than this, opens it.
const LONG_PRESS_MS = 450
const LONG_PRESS_SLOP = 8

const OTHER_MODIFIERS = {
  Alt: (event) => event.shiftKey || event.metaKey || event.ctrlKey,
  Control: (event) => event.shiftKey || event.metaKey || event.altKey,
}

/**
 * @param {{
 *   getEditor: () => any,
 *   ctx: object,
 *   enabled: boolean,
 * }} props
 *
 * `getEditor` returns the live editor the wheel acts on (the active pane's); `ctx` is
 * lent to the tools (lib/selectionTools.js).
 */
export default function SelectionWheel({ getEditor, ctx, enabled }) {
  const { tools, holdKey } = useSelectionWheelSettings()
  const [wheel, setWheel] = useState(null)
  const pointerRef = useRef(null)
  const live = useRef({})
  useLayoutEffect(() => { live.current = { getEditor, ctx, enabled, tools, holdKey, wheel } })

  /** The editor, if the wheel may open on it now: focused, unlocked, with text selected. */
  const ready = useCallback(({ focused = true } = {}) => {
    const { getEditor: get, enabled: on, wheel: open } = live.current
    const editor = get()
    if (!on || open || !isEditorReady(editor)) return null
    if (editor.state.selection.empty || editor.storage.documentLock?.locked) return null
    if (!focused) return editor
    // Held over the page only: not while another gesture (an ink wheel) or a dialog has it.
    if (!editor.view.hasFocus() || document.querySelector('[data-ink-wheel], [data-tool-wheel], [role="dialog"]')) return null
    return editor
  }, [])

  /** Open the wheel; `at` is where a finger opened it. */
  const open = useCallback((mode, at = null) => {
    const editor = ready({ focused: mode !== 'keyboard' })
    if (!editor) return
    const pointer = at ?? pointerRef.current
    const overEditor = Boolean(at || (pointer && mode !== 'keyboard' && editor.view.dom.contains(pointer.target)))
    let anchor
    if (overEditor) anchor = { x: pointer.x, y: pointer.y }
    else {
      const caret = editor.view.coordsAtPos(editor.state.selection.head)
      anchor = { x: caret.left, y: (caret.top + caret.bottom) / 2 }
    }
    const { ctx: lent, tools: ids } = live.current
    setWheel({ mode, anchor, fromPointer: overEditor, items: wheelItems(editor, lent, ids), editor })
  }, [ready])

  // The hold key: held alone, it opens the wheel for a flick; tapped, it leaves it open.
  useEffect(() => {
    if (holdKey === 'off') return undefined
    let pending = null
    const cancel = () => {
      if (pending) window.clearTimeout(pending.timer)
      pending = null
    }
    const onKeyDown = (event) => {
      if (live.current.wheel) return
      if (event.key !== holdKey || event.repeat || event.isComposing || OTHER_MODIFIERS[holdKey](event)) {
        cancel()
        return
      }
      if (!ready()) return
      cancel()
      pending = { timer: window.setTimeout(() => { pending = null; open('hold') }, HOLD_MS) }
    }
    const onKeyUp = (event) => {
      if (!pending || event.key !== holdKey) return
      cancel()
      open('sticky')
    }
    const onPointerMove = (event) => { pointerRef.current = { x: event.clientX, y: event.clientY, target: event.target } }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('pointerdown', cancel, true)
    window.addEventListener('blur', cancel)
    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true })
    return () => {
      cancel()
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('pointerdown', cancel, true)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('pointermove', onPointerMove, { capture: true })
    }
  }, [holdKey, open, ready])

  // A long press on the selection, for a hand without a keyboard.
  useEffect(() => {
    let press = null
    const cancel = () => {
      if (press) window.clearTimeout(press.timer)
      press = null
    }
    const onDown = (event) => {
      cancel()
      if (event.pointerType === 'mouse' || !event.isPrimary) return
      const editor = ready()
      if (!editor || !editor.view.dom.contains(event.target)) return
      const at = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
      const { from, to } = editor.state.selection
      if (!at || at.pos < from || at.pos > to) return
      const point = { x: event.clientX, y: event.clientY }
      press = { id: event.pointerId, point, timer: window.setTimeout(() => { press = null; open('touch', point) }, LONG_PRESS_MS) }
    }
    const onMove = (event) => {
      if (press?.id === event.pointerId && Math.hypot(event.clientX - press.point.x, event.clientY - press.point.y) > LONG_PRESS_SLOP) cancel()
    }
    const onEnd = (event) => { if (press?.id === event.pointerId) cancel() }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointermove', onMove, { capture: true, passive: true })
    window.addEventListener('pointerup', onEnd, true)
    window.addEventListener('pointercancel', onEnd, true)
    window.addEventListener('blur', cancel)
    return () => {
      cancel()
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointermove', onMove, { capture: true })
      window.removeEventListener('pointerup', onEnd, true)
      window.removeEventListener('pointercancel', onEnd, true)
      window.removeEventListener('blur', cancel)
    }
  }, [open, ready])

  useCommands(() => [
    {
      id: 'writing.selection-wheel',
      section: 'Writing',
      title: 'Open selection wheel',
      icon: 'highlight',
      keywords: ['tools', 'format', 'radial', 'hide', 'highlight', 'bold'],
      when: () => Boolean(ready({ focused: false })),
      run: () => open('keyboard'),
    },
  ], [open, ready])

  const onPick = useCallback((id, option) => {
    const editor = live.current.wheel?.editor
    if (!isEditorReady(editor)) return
    runSelectionTool(editor, live.current.ctx, id, option)
  }, [])

  const onClose = useCallback(() => {
    const editor = live.current.wheel?.editor
    // Back to the page, unless the tool took the writer elsewhere (a bubble, a panel).
    // Focus still on the wheel counts as nowhere: the wheel is about to go, and an
    // unfocused editor would ignore the next hold.
    const focused = document.activeElement
    const nowhere = !focused || focused === document.body || Boolean(focused.closest?.('[data-tool-wheel]'))
    setWheel(null)
    if (isEditorReady(editor) && nowhere) editor.commands.focus()
  }, [])

  if (!wheel) return null
  return (
    <ToolWheel
      anchor={wheel.anchor}
      items={wheel.items}
      label="Selection"
      mode={wheel.mode}
      holdKey={holdKey}
      fromPointer={wheel.fromPointer}
      onPick={onPick}
      onClose={onClose}
    />
  )
}
