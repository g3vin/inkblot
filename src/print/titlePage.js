/**
 * titlePage.js — the page before the text: a manuscript's, a book's or a script's.
 *
 * Built as a printed page, the size of the rest, and put in front of them by a print
 * job; never numbered, and never part of the flow Print Layout paginates. A book's
 * title page is a recto, so a mirrored setup gets a blank verso after it and the text
 * still opens on a right-hand page.
 *
 *   manuscript  contact details top left, the rounded word count top right, the title
 *               and byline centred halfway down — a standard manuscript submission
 *   book        the title and the author, a third of the way down
 *   screenplay  the title, "Written by" and the author a third down; contact details
 *               bottom left
 */
import { TitlePageStyle } from '../types'
import { describeWordCount, pageMetrics } from './pageSetup'
import { applyTypography } from './typography'

const text = (className, content, style = {}) => {
  const el = document.createElement('div')
  el.className = className
  el.textContent = content
  Object.assign(el.style, style)
  return el
}

/** The contact block's lines: the name first, then address, phone, email, agent. */
export const contactLines = (profile = {}) => {
  const lines = [profile.legalName || profile.byline]
  if (profile.address) lines.push(...profile.address.split(/\r?\n/))
  if (profile.phone) lines.push(profile.phone)
  if (profile.email) lines.push(profile.email)
  if (profile.agent) lines.push(`Represented by ${profile.agent}`)
  return lines.map((line) => (line || '').trim()).filter(Boolean)
}

/**
 * The title page, and the blank verso after it when the setup mirrors its margins.
 * Returns [] when the setup asks for none.
 */
export const buildTitlePages = ({ setup, title, profile = {}, author = '', words = 0 }) => {
  const options = setup.titlePage
  if (!options) return []
  const m = pageMetrics(setup)
  const page = document.createElement('div')
  page.className = `print-page print-title-page is-${options.style}`
  Object.assign(page.style, { width: `${m.width}px`, height: `${m.height}px` })
  applyTypography(page, setup.typography)

  const left = setup.margins.insideMm + setup.margins.gutterMm
  const inset = { left: `${left}mm`, right: `${setup.margins.outsideMm}mm` }
  const byline = author || profile.byline || ''

  if (options.style === TitlePageStyle.Manuscript) {
    if (options.showContact) {
      page.appendChild(text('tp-block tp-contact', contactLines(profile).join('\n'), { left: inset.left, top: `${setup.margins.topMm}mm` }))
    }
    if (options.showWordCount && words > 0) {
      page.appendChild(text('tp-block tp-words', describeWordCount(words), { right: inset.right, top: `${setup.margins.topMm}mm`, textAlign: 'right' }))
    }
    const center = document.createElement('div')
    center.className = 'tp-center'
    Object.assign(center.style, { top: '45%', ...inset })
    center.appendChild(text('tp-title', title))
    if (byline) center.appendChild(text('tp-byline', `by ${byline}`))
    page.appendChild(center)
  } else if (options.style === TitlePageStyle.Screenplay) {
    const center = document.createElement('div')
    center.className = 'tp-center'
    Object.assign(center.style, { top: '33%', ...inset })
    center.appendChild(text('tp-title', title))
    center.appendChild(text('tp-written', 'Written by'))
    if (byline) center.appendChild(text('tp-byline', byline))
    page.appendChild(center)
    if (options.showContact) {
      page.appendChild(text('tp-block tp-contact', contactLines(profile).join('\n'), { left: inset.left, bottom: `${setup.margins.bottomMm}mm` }))
    }
  } else {
    const center = document.createElement('div')
    center.className = 'tp-center'
    Object.assign(center.style, { top: '33%', ...inset })
    center.appendChild(text('tp-title', title))
    if (byline) center.appendChild(text('tp-byline', byline))
    page.appendChild(center)
  }

  const pages = [page]
  if (setup.mirrorMargins) {
    const blank = document.createElement('div')
    blank.className = 'print-page is-blank'
    Object.assign(blank.style, { width: `${m.width}px`, height: `${m.height}px` })
    pages.push(blank)
  }
  return pages
}

/** Plain text of a TipTap JSON document, for counting its words. */
export const textOfContent = (node) => {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text') return node.text || ''
  const inner = (node.content || []).map(textOfContent)
  return node.type === 'doc' || node.type === 'tableRow' ? inner.join('\n') : `${inner.join(' ')}\n`
}
