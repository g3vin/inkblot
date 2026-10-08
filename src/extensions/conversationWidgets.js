/**
 * conversationWidgets.js — the small DOM controls the node view builds by hand.
 *
 * The node view is imperative DOM, not React, so its buttons, selects and text
 * fields are constructed here rather than rendered. Icons come from src/ui.
 */
import iconElement from '../ui/iconElement.js'

const BUTTON_ICONS = { '+': 'add', x: 'close', Edit: 'edit' }
export const makeButton = (label, title, onClick, className = '') => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = ['conversation-tool-button', className].filter(Boolean).join(' ')
  const icon = label.startsWith('+ ') ? 'add' : BUTTON_ICONS[label]
  if (icon) {
    button.classList.add('has-icon')
    button.appendChild(iconElement(icon))
    if (label.startsWith('+ ')) {
      const text = document.createElement('span')
      text.textContent = label.slice(2)
      button.appendChild(text)
    }
  } else {
    button.textContent = label
  }
  button.title = title
  button.setAttribute('aria-label', title)
  button.contentEditable = 'false'
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    event.stopPropagation()
  })
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onClick(event)
  })
  return button
}

/** A native select dressed as the shared SelectMenu (src/ui), for node-view toolbars. */
export const makeSelect = (label, value, options, onChange) => {
  const select = document.createElement('select')
  select.className = 'ui-select'
  select.setAttribute('aria-label', label)
  select.title = label
  select.contentEditable = 'false'
  options.forEach(({ value: optionValue, label: optionLabel }) => {
    const option = document.createElement('option')
    option.value = optionValue
    option.textContent = optionLabel
    select.appendChild(option)
  })
  select.value = value
  select.addEventListener('pointerdown', event => event.stopPropagation())
  select.addEventListener('change', () => onChange(select.value))
  return select
}

export const makeTextInput = (value, label, onInput, controlId = '') => {
  const input = document.createElement('input')
  input.type = 'text'
  input.value = value || ''
  input.placeholder = label
  input.setAttribute('aria-label', label)
  if (controlId) input.dataset.controlId = controlId
  input.addEventListener('input', () => onInput(input.value))
  return input
}

export const readImageFile = (file, callback) => {
  if (!file || !file.type?.startsWith('image/')) return
  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result === 'string') callback(reader.result)
  }
  reader.readAsDataURL(file)
}

