/**
 * landingCard.js — where the document card will be, before it exists.
 *
 * A sheet on the landing page sets off for the card at once (components/landing/
 * SheetFlight), but the editor that draws the card takes a moment to mount. So the
 * card's place is remembered as its insets from the window's edges each time a
 * project closes, and the flight aims there; the window's size can change in between,
 * which is why it is kept as insets rather than a box. A first flight, with nothing
 * remembered, aims at the card between the two docked sidebars at their usual widths.
 *
 * The editor's text box inside the card is kept with it (measurePage), so the words
 * the flight carries are already the size and in the place the editor will draw them.
 */
import { getPreference, setPreference } from './preferences'

const KEY = 'inkblot.landing.card'
/** The card between a docked file tree and inspector, each at its default width. */
const USUAL = { left: 220, top: 8, right: 300, bottom: 8 }

const read = () => {
  try {
    const stored = JSON.parse(getPreference(KEY) || 'null')
    return stored && ['left', 'top', 'right', 'bottom'].every((side) => Number.isFinite(stored[side])) ? stored : null
  } catch {
    return null
  }
}
const readInsets = () => read() ?? USUAL

/**
 * The editor's text box inside a card at `box`: where its words start, how wide they
 * run, and their size. Read from the card's editor when there is one; otherwise as
 * Editor.prose.css lays it out (a column of at most 900px, 40px in), at the size last
 * seen, or 18px.
 */
export function measurePage(card, box) {
  const prose = card?.querySelector('.primary-pane .ProseMirror') ?? card?.querySelector('.ProseMirror')
  if (!prose) {
    const remembered = read()?.page
    if (remembered && Math.abs(remembered.cardWidth - box.width) < 1) return remembered
    const column = Math.min(box.width, 900)
    return {
      left: (box.width - column) / 2 + 40,
      top: (remembered?.titlebarHeight ?? 44) + 40,
      width: column - 80,
      fontSize: remembered?.fontSize ?? 18,
      lineHeight: remembered?.lineHeight ?? 1.6,
      gap: remembered?.gap ?? '1em',
      family: remembered?.family,
      titlebarHeight: remembered?.titlebarHeight ?? 44,
      cardWidth: box.width,
    }
  }
  const rect = prose.getBoundingClientRect()
  const style = getComputedStyle(prose)
  const px = (value) => parseFloat(value) || 0
  const first = prose.querySelector('p')
  const fontSize = px(style.fontSize) || 18
  return {
    left: rect.left - box.left + px(style.paddingLeft),
    top: rect.top - box.top + px(style.paddingTop),
    width: rect.width - px(style.paddingLeft) - px(style.paddingRight),
    fontSize,
    lineHeight: px(style.lineHeight) ? px(style.lineHeight) / fontSize : 1.6,
    gap: first ? getComputedStyle(first).marginBottom : '1em',
    family: style.fontFamily,
    titlebarHeight: card.querySelector('.app-titlebar')?.getBoundingClientRect().height || 44,
    cardWidth: box.width,
  }
}

/** The card's box in a window of `width` × `height`, as it was last time. */
export function predictCardRect(width = window.innerWidth, height = window.innerHeight) {
  const insets = readInsets()
  const box = {
    left: insets.left,
    top: insets.top,
    width: width - insets.left - insets.right,
    height: height - insets.top - insets.bottom,
  }
  // A window narrower than the sidebars it last had: aim at most of it instead.
  return box.width > 200 && box.height > 200 ? box : { left: 8, top: 8, width: width - 16, height: height - 16 }
}

/** Remember where `card` is in the window, for the next flight. */
export function rememberCardRect(card) {
  if (!card) return
  const box = card.getBoundingClientRect()
  if (box.width < 1 || box.height < 1) return
  const insets = {
    left: Math.round(box.left),
    top: Math.round(box.top),
    right: Math.round(window.innerWidth - box.right),
    bottom: Math.round(window.innerHeight - box.bottom),
  }
  const page = card.querySelector('.ProseMirror') ? measurePage(card, box) : read()?.page
  const next = JSON.stringify(page ? { ...insets, page } : insets)
  if (next !== getPreference(KEY)) setPreference(KEY, next)
}
