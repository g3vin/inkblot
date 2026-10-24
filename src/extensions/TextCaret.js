/**
 * TextCaret.js — the caret drawn as tall as the text, not the line.
 *
 * WebKit draws a contenteditable's caret from the bottom of the line above to the
 * bottom of its own, so with the editor's leading it runs up through the gap between
 * lines. CSS can't size the native caret, so it is hidden (`.has-text-caret` in
 * Editor.prose.css) and this one is drawn over the glyph box ProseMirror reports for
 * the caret's position.
 *
 * The caret's colour is `--caret-ink` where the caret is, else the text's colour (as
 * the native caret's `auto`); `transparent` hides it, as in a locked document.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'

export const TEXT_CARET_PLUGIN_KEY = new PluginKey('textCaret')

/** A rect taller than this many font sizes is a line box (an empty line's), not a glyph's. */
const MAX_GLYPH_EM = 1.4
/** The caret's height on an empty line, in font sizes: about a glyph box. */
const EMPTY_LINE_EM = 1.2

const elementAt = (view, pos) => {
  const { node } = view.domAtPos(pos)
  return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
}

const caretInk = (style) => {
  const ink = style.getPropertyValue('--caret-ink').trim()
  if (!ink || ink === 'auto' || ink.toLowerCase() === 'currentcolor') return style.color
  return ink
}

/** `transparent`, or a computed colour whose alpha is 0. */
const isClear = (ink) => ink === 'transparent' || /,\s*0\)$/.test(ink)

class TextCaretView {
  constructor(view) {
    this.view = view
    this.frame = 0
    this.el = document.createElement('div')
    this.el.className = 'text-caret'
    this.el.setAttribute('aria-hidden', 'true')
    this.el.hidden = true
    view.dom.parentElement?.appendChild(this.el)

    this.schedule = this.schedule.bind(this)
    this.onFocusChange = () => this.schedule()
    view.dom.addEventListener('focus', this.onFocusChange)
    view.dom.addEventListener('blur', this.onFocusChange)
    // Layout moves the text without a transaction: a resize, a scroll of an outer
    // scroller the caret isn't inside, a picture loading, a font arriving.
    window.addEventListener('resize', this.schedule)
    document.addEventListener('scroll', this.schedule, true)
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(this.schedule) : null
    this.resizeObserver?.observe(view.dom)
    this.schedule()
  }

  update(view, prevState) {
    this.view = view
    if (this.el.parentElement !== view.dom.parentElement) view.dom.parentElement?.appendChild(this.el)
    // Moving or typing restarts the blink, so the caret is solid while it is in use.
    if (!prevState || !prevState.selection.eq(view.state.selection) || !prevState.doc.eq(view.state.doc)) {
      this.restartBlink = true
    }
    this.schedule()
  }

  schedule() {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.draw()
    })
  }

  hide() {
    this.el.hidden = true
  }

  draw() {
    const { view } = this
    const { selection } = view.state
    if (!view.editable || !view.hasFocus() || view.composing || !(selection instanceof TextSelection) || !selection.empty) {
      this.hide()
      return
    }
    this.drawAt(selection.head)
  }

  drawAt(head) {
    const { view, el } = this
    let rect
    try {
      rect = view.coordsAtPos(head)
    } catch {
      this.hide()
      return
    }
    const target = elementAt(view, head)
    if (!target) {
      this.hide()
      return
    }
    const style = getComputedStyle(target)
    const ink = caretInk(style)
    if (isClear(ink)) {
      this.hide()
      return
    }

    el.hidden = false
    const parent = el.offsetParent
    if (!parent) {
      this.hide()
      return
    }
    const box = parent.getBoundingClientRect()
    // The page may be scaled (the canvas, Typeset's zoom): rects are on screen, the
    // caret's offsets are in the parent's own pixels.
    const scale = parent.offsetWidth ? box.width / parent.offsetWidth : 1
    const fontSize = parseFloat(style.fontSize) * scale || 16

    let top = rect.top
    let height = rect.bottom - rect.top
    if (height > fontSize * MAX_GLYPH_EM || height <= 0) {
      // The line box's leading is split evenly above and below its glyphs.
      const glyph = fontSize * EMPTY_LINE_EM
      top = (rect.top + rect.bottom) / 2 - glyph / 2
      height = glyph
    }

    const left = (rect.left - box.left) / scale - parent.clientLeft + parent.scrollLeft
    el.style.transform = `translate(${Math.round(left * 2) / 2 - 1}px, ${(top - box.top) / scale - parent.clientTop + parent.scrollTop}px)`
    el.style.height = `${height / scale}px`
    el.style.background = ink

    if (this.restartBlink) {
      this.restartBlink = false
      el.classList.remove('is-blinking')
      void el.offsetWidth
    }
    el.classList.add('is-blinking')
  }

  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.view.dom.removeEventListener('focus', this.onFocusChange)
    this.view.dom.removeEventListener('blur', this.onFocusChange)
    window.removeEventListener('resize', this.schedule)
    document.removeEventListener('scroll', this.schedule, true)
    this.resizeObserver?.disconnect()
    this.el.remove()
  }
}

export const TextCaret = Extension.create({
  name: 'textCaret',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: TEXT_CARET_PLUGIN_KEY,
        view: (view) => new TextCaretView(view),
        props: {
          attributes: { class: 'has-text-caret' },
        },
      }),
    ]
  },
})
