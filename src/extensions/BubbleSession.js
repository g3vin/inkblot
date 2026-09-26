/**
 * BubbleSession.js — a bubble session left open on its sentence.
 *
 * The sentence carries a `bubbleSession` mark whose attributes are the whole session:
 * the bubbles in order and the ones thrown aside. Keeping it on the text, rather than in
 * a list beside the document, is what lets it follow the sentence through every edit
 * and what makes version history bring a resolved session back — a version's JSON has
 * the mark in it.
 *
 * The indicator is a small chip after the sentence (a widget decoration, so it is not
 * text and cannot be typed into or copied). Clicking it emits BUBBLE_OPEN_EVENT, which
 * `useBubbleSessions` answers by opening the editor on that session.
 *
 * Pasted text loses the mark: a copied sentence is not a second copy of the session.
 *
 * **Forms, from the document.** A session with saved forms (`lib/bubbleForms.ts`) can be
 * switched between them without opening the editor: the chip shows a dot per form, and
 * which is showing; ⌥⌘] and ⌥⌘[ with the caret in the sentence, or the context menu,
 * turn to the next or previous. So does a two-finger swipe sideways over the sentence,
 * made hard to do by accident: it has to begin over the sentence and begin sideways (a
 * scroll that starts up-and-down, or drifts onto the sentence, is left alone), and it
 * has to travel `SWIPE_DISTANCE`, far beyond a stray scroll, while the sentence lights
 * up more and more to show it is being taken. One swipe turns one page.
 */
import { Mark, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Fragment, Slice } from '@tiptap/pm/model'
import { normalizeSession, reconcileSession, composeSentence } from '../lib/bubbleText'
import { formPage, formPages, formsStateOf, showFormPage, withFormsState } from '../lib/bubbleForms'
import { writeBubbleSession } from '../lib/bubbleWrite'
import { marginHangDecorations } from '../lib/marginHang'

/** `detail: { editor, sessionId }` — open the bubble editor on that session. */
export const BUBBLE_OPEN_EVENT = 'inkblot:bubble-open'

const BUBBLE_CHIP_PLUGIN_KEY = new PluginKey('bubbleSessionChips')
const BUBBLE_SWIPE_PLUGIN_KEY = new PluginKey('bubbleSessionSwipe')

/** How far two fingers must travel sideways over a sentence to turn it to another form. */
const SWIPE_DISTANCE = 150
/** Movement before a two-finger gesture is judged sideways or not. */
const SWIPE_LOCK = 12
/** A pause this long ends a wheel gesture. */
const SWIPE_IDLE_MS = 120
/**
 * Momentum after a swipe comes as deltas that only shrink. One that grows again — by
 * this much, after a few that shrank — is new fingers on the trackpad: a new gesture,
 * which need not wait for the old one's momentum to run out.
 */
const SWIPE_RENEW = 1.6
/** More forms than this and the chip says "2/7" instead of showing a dot for each. */
const CHIP_DOTS = 5

const parseSession = (value) => {
  if (!value) return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/**
 * Every session in a document, as `{ id, from, to, session }`, one per id. A session's
 * range is its first contiguous run of marked text; a mark split by other formatting
 * (a bold word inside the sentence) is still one run.
 */
export const findBubbleSessions = (doc) => {
  const found = new Map()
  doc.descendants((node, pos) => {
    if (!node.isText) return
    const mark = node.marks.find((candidate) => candidate.type.name === 'bubbleSession')
    const id = mark?.attrs?.id
    if (!id) return
    const end = pos + node.nodeSize
    const existing = found.get(id)
    if (!existing) {
      found.set(id, { id, from: pos, to: end, session: parseSession(mark.attrs.session) })
    } else if (existing.to === pos) {
      existing.to = end
    }
  })
  return [...found.values()]
}

/** The session with this id, or null if it is no longer in the document. */
export const findBubbleSession = (doc, id) =>
  findBubbleSessions(doc).find((entry) => entry.id === id) ?? null

/**
 * An entry's session as the document has it now — its bubbles made to agree with the
 * sentence — and which of its pages (`lib/bubbleForms.ts`) is showing.
 */
export const sessionForms = (doc, entry) => {
  const text = doc.textBetween(entry.from, entry.to, ' ')
  const stored = entry.session?.words ? { ...entry.session, id: entry.id } : null
  const session = stored ? reconcileSession(stored, text) : null
  const state = session ? formsStateOf(session) : null
  return {
    session,
    state,
    page: state ? formPage(state) : 0,
    pages: state && state.forms.length ? formPages(state) : 0,
  }
}

/**
 * Turn a sentence to another of its session's forms, where it is: the caret and the
 * scroll stay put, and ⌘Z in the document turns it back. `page` is a page's index, or a
 * function from the page showing to the one wanted. Returns whether it turned.
 */
export const showSessionForm = (editor, id, page) => {
  const doc = editor?.state?.doc
  const entry = doc && findBubbleSession(doc, id)
  if (!entry) return false
  const { session, state, page: current, pages } = sessionForms(doc, entry)
  if (!pages) return false
  const target = typeof page === 'function' ? page(current) : page
  const next = showFormPage(state, target)
  // A form with nothing in the sentence would take the sentence, and its session, away.
  if (next === state || !composeSentence(next.words, session.original)) return false
  return writeBubbleSession(editor, entry, normalizeSession(withFormsState(session, next)), { keep: true, quiet: true })
}

/** The session the range from..to touches, if any. */
export const bubbleSessionAt = (doc, from, to = from) =>
  findBubbleSessions(doc).find((entry) => entry.from <= to && entry.to >= from) ?? null

const stripSessionMarks = (fragment, type) => {
  const children = []
  fragment.forEach((node) => {
    if (node.isText) {
      children.push(node.mark(type.removeFromSet(node.marks)))
    } else {
      children.push(node.copy(stripSessionMarks(node.content, type)))
    }
  })
  return Fragment.fromArray(children)
}

/** How tall a font's text is, ascender to descender, in ems — without the line's gap. */
const extents = new Map()
let measuring = null
const textExtent = (style) => {
  const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  if (extents.has(font)) return extents.get(font)
  measuring ??= document.createElement('canvas').getContext?.('2d') ?? null
  let extent = null
  if (measuring) {
    measuring.font = font
    const metrics = measuring.measureText('Hg')
    const size = parseFloat(style.fontSize)
    const height = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent
    if (size > 0 && Number.isFinite(height) && height > 0) extent = height / size
  }
  extents.set(font, extent)
  return extent
}

/**
 * Centre each chip on the text of its line: on the font's own height, ascender to
 * descender, not the line's, which adds the gap above. CSS has no unit for that height,
 * so it is measured once per font and handed to the chip's stylesheet.
 *
 * And tell its `.margin-hang` wrapper how wide it is, which depends on its dots or count.
 */
const fitChips = (view) => {
  const chips = [...view.dom.querySelectorAll('.bubble-session-chip')].filter((chip) => chip.parentElement)
  if (!chips.length) return
  // All the reads, then all the writes: measured chip by chip, each write forced the
  // next chip's read to lay the document out again — once per chip, per keystroke.
  const extents = chips.map((chip) => textExtent(window.getComputedStyle(chip.parentElement)))
  chips.forEach((chip, i) => {
    if (extents[i]) chip.style.setProperty('--bubble-text-extent', String(extents[i]))
  })
  const widths = chips.map((chip) => chip.offsetWidth + parseFloat(window.getComputedStyle(chip).marginLeft))
  chips.forEach((chip, i) => {
    if (widths[i] > 0) chip.parentElement.style.setProperty('--hang-width', `${widths[i]}px`)
  })
}

const buildChips = (doc, editor) => {
  const decorations = []
  for (const entry of findBubbleSessions(doc)) {
    const count = Array.isArray(entry.session?.aside) ? entry.session.aside.length : 0
    const { page, pages, state } = sessionForms(doc, entry)
    decorations.push(...marginHangDecorations(doc, entry.to, () => {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'bubble-session-chip'
      chip.dataset.bubbleSessionId = entry.id
      chip.dataset.formPage = String(page)
      chip.dataset.formPages = String(pages)
      chip.contentEditable = 'false'
      const aside = count ? ` (${count} set aside)` : ''
      const showing = page < state?.forms.length ? `Form ${page + 1} of ${state.forms.length}` : 'Unsaved'
      chip.title = pages
        ? `Open Bubble${aside} — ${showing}. Swipe sideways over the sentence, or ⌥⌘[ ⌥⌘], to change form.`
        : `Open Bubble${aside}`
      chip.setAttribute('aria-label', chip.title)
      if (pages > CHIP_DOTS) {
        chip.classList.add('has-forms')
        const label = document.createElement('span')
        label.className = 'bubble-session-chip-count'
        label.textContent = `${page + 1}/${pages}`
        chip.appendChild(label)
      } else {
        if (pages) chip.classList.add('has-forms')
        for (let index = 0; index < (pages || 3); index += 1) {
          const dot = document.createElement('span')
          dot.className = 'bubble-session-chip-dot'
          if (pages && index === page) dot.classList.add('is-current')
          if (pages && index === state.forms.length) dot.classList.add('is-unsaved')
          chip.appendChild(dot)
        }
      }
      // The editor would otherwise take the press and move the caret under the chip.
      chip.onmousedown = (event) => {
        event.preventDefault()
        event.stopPropagation()
      }
      chip.onclick = (event) => {
        event.preventDefault()
        event.stopPropagation()
        window.dispatchEvent(new CustomEvent(BUBBLE_OPEN_EVENT, {
          detail: { editor, sessionId: entry.id },
        }))
      }
      return chip
    }, { side: 1, key: `bubble-chip:${entry.id}:${count}:${page}/${pages}`, ignoreSelection: true }))
  }
  return DecorationSet.create(doc, decorations)
}

export const BubbleSession = Mark.create({
  name: 'bubbleSession',
  // Typing at either end of the sentence is not typing into the session.
  inclusive: false,
  excludes: 'bubbleSession',

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-bubble-session'),
        renderHTML: (attributes) => (attributes.id ? { 'data-bubble-session': attributes.id } : {}),
      },
      session: {
        default: null,
        parseHTML: (element) => parseSession(element.getAttribute('data-bubble-state')),
        renderHTML: (attributes) => (
          attributes.session ? { 'data-bubble-state': JSON.stringify(attributes.session) } : {}
        ),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-bubble-session]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'bubble-session' }), 0]
  },

  addKeyboardShortcuts() {
    const step = (delta) => () => {
      const { from, to } = this.editor.state.selection
      const entry = bubbleSessionAt(this.editor.state.doc, from, to)
      return Boolean(entry) && showSessionForm(this.editor, entry.id, (page) => page + delta)
    }
    return { 'Mod-Alt-]': step(1), 'Mod-Alt-[': step(-1) }
  },

  addProseMirrorPlugins() {
    const { editor } = this
    const type = this.type
    return [
      swipePlugin(editor),
      new Plugin({
        key: BUBBLE_CHIP_PLUGIN_KEY,
        state: {
          init: (_, state) => buildChips(state.doc, editor),
          apply: (tr, previous) => (tr.docChanged ? buildChips(tr.doc, editor) : previous),
        },
        view(view) {
          fitChips(view)
          return { update: (next, previous) => { if (next.state.doc !== previous.doc) fitChips(next) } }
        },
        props: {
          decorations: (state) => BUBBLE_CHIP_PLUGIN_KEY.getState(state),
          transformPasted: (slice) =>
            new Slice(stripSessionMarks(slice.content, type), slice.openStart, slice.openEnd),
        },
      }),
    ]
  },
})

/** The spans of a session's sentence, for lighting it up while it is swiped. */
const sentenceSpans = (view, id) => [...view.dom.querySelectorAll('span[data-bubble-session]')]
  .filter((span) => span.getAttribute('data-bubble-session') === id)

/**
 * A two-finger swipe sideways over a sentence with forms turns it to the next or
 * previous one. Wheel events carry no begin or end, so a gesture is a run of them with no
 * pause of `SWIPE_IDLE_MS`; what it began over, and which way, decides it for its whole
 * length — momentum included, so one swipe turns one page.
 */
function swipePlugin(editor) {
  return new Plugin({
    key: BUBBLE_SWIPE_PLUGIN_KEY,
    view(view) {
      // { id, x, y, axis, spent } — or { ignored: true } for a gesture that is not a swipe.
      let gesture = null
      let idle = 0
      let lit = []

      const light = (id, progress) => {
        for (const span of lit) {
          span.classList.remove('is-form-swiping')
          span.style.removeProperty('--bubble-swipe')
        }
        lit = id && progress > 0 ? sentenceSpans(view, id) : []
        for (const span of lit) {
          span.classList.add('is-form-swiping')
          span.style.setProperty('--bubble-swipe', String(Math.min(1, progress)))
        }
      }

      const flash = (id) => {
        window.requestAnimationFrame(() => {
          for (const span of sentenceSpans(view, id)) {
            span.classList.remove('is-form-changed')
            // Restart the animation on spans ProseMirror kept.
            void span.offsetWidth
            span.classList.add('is-form-changed')
          }
        })
      }

      const sessionUnder = (event) => {
        const chip = event.target?.closest?.('.bubble-session-chip')
        if (chip) return chip.dataset.bubbleSessionId || null
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
        if (!at) return null
        const entry = bubbleSessionAt(view.state.doc, at.pos)
        // posAtCoords finds the nearest position even in the margin: the pointer has to
        // be on the sentence itself.
        if (!entry || !sentenceSpans(view, entry.id).some((span) => (
          [...span.getClientRects()].some((rect) => event.clientX >= rect.left && event.clientX <= rect.right
            && event.clientY >= rect.top && event.clientY <= rect.bottom)
        ))) return null
        return entry.id
      }

      const onWheel = (event) => {
        if (event.ctrlKey) return
        window.clearTimeout(idle)
        idle = window.setTimeout(() => {
          gesture = null
          light(null)
        }, SWIPE_IDLE_MS)
        // A gesture that is over bar its momentum (turned its page, or not a swipe at
        // all) gives way to new fingers at once.
        const size = Math.hypot(event.deltaX, event.deltaY)
        if (gesture && (gesture.spent || gesture.ignored || gesture.axis === 'y')) {
          if (gesture.shrinking >= 3 && size > gesture.last * SWIPE_RENEW + 2) {
            gesture = null
          } else {
            gesture.shrinking = size < gesture.last ? gesture.shrinking + 1 : 0
            gesture.last = size
          }
        }
        if (!gesture) {
          const id = sessionUnder(event)
          const entry = id && findBubbleSession(view.state.doc, id)
          gesture = entry && sessionForms(view.state.doc, entry).pages > 1
            ? { id, x: 0, y: 0, axis: null, spent: false, last: size, shrinking: 0 }
            : { ignored: true, last: size, shrinking: 0 }
        }
        if (gesture.ignored || gesture.axis === 'y') return
        if (gesture.spent) {
          event.preventDefault()
          return
        }
        // Where the fingers went. Under natural scrolling (WebKit says whether it is on)
        // a positive deltaX is the fingers moving left, toward the next form.
        const sign = event.webkitDirectionInvertedFromDevice === false ? 1 : -1
        gesture.x += sign * event.deltaX
        gesture.y += sign * event.deltaY
        if (!gesture.axis) {
          if (Math.hypot(gesture.x, gesture.y) < SWIPE_LOCK) return
          gesture.axis = Math.abs(gesture.x) > 2 * Math.abs(gesture.y) ? 'x' : 'y'
          if (gesture.axis === 'y') return
        }
        event.preventDefault()
        if (Math.abs(gesture.x) < SWIPE_DISTANCE) {
          light(gesture.id, Math.abs(gesture.x) / SWIPE_DISTANCE)
          return
        }
        gesture.spent = true
        gesture.last = size
        gesture.shrinking = 0
        light(null)
        const delta = gesture.x < 0 ? 1 : -1
        if (showSessionForm(editor, gesture.id, (page) => page + delta)) flash(gesture.id)
      }

      // Not passive: a swipe that is taken must not also scroll.
      view.dom.addEventListener('wheel', onWheel, { passive: false })
      return {
        destroy() {
          window.clearTimeout(idle)
          light(null)
          view.dom.removeEventListener('wheel', onWheel)
        },
      }
    },
  })
}
