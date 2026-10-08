/**
 * iconElement.js — an Icon as a plain DOM element, for code that builds DOM by hand
 * (TipTap node views) and so cannot render <Icon />. Same glyphs, weights and sizes.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Icon from './Icon.jsx'

const cache = new Map()

/**
 * @param {string} name A semantic name from ./icons.js.
 * @param {{ size?: 16|20, active?: boolean }} [options]
 * @returns {SVGElement}
 */
export default function iconElement(name, { size = 16, active = false } = {}) {
  const key = `${name}:${size}:${active}`
  if (!cache.has(key)) {
    const template = document.createElement('template')
    template.innerHTML = renderToStaticMarkup(createElement(Icon, { name, size, active }))
    cache.set(key, template.content.firstElementChild)
  }
  return /** @type {SVGElement} */ (cache.get(key).cloneNode(true))
}
