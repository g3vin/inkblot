/**
 * conversationWidgets.js — the small DOM controls the node view builds by hand.
 *
 * The node view is imperative DOM, not React, so its buttons, colour wells and
 * text fields are constructed here rather than rendered.
 */
export const makeAniconSvg = (name, size = 14) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add('conversation-tool-icon', `conversation-tool-icon-${name}`)

  const paths = name === 'plus'
    ? ['M5 12h14', 'M12 5v14']
    : name === 'edit'
      ? [
        'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
        'm15 5 4 4',
      ]
      : ['M18 6 6 18', 'm6 6 12 12']

  paths.forEach((d) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    svg.appendChild(path)
  })

  return svg
}

export const makeButton = (label, title, onClick, className = '') => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = ['conversation-tool-button', className].filter(Boolean).join(' ')
  const isPlus = label === '+' || label.startsWith('+ ')
  const isX = label === 'x'
  const isEdit = label === 'Edit'
  if (isPlus || isX || isEdit) {
    button.classList.add('has-anicon')
    button.appendChild(makeAniconSvg(isPlus ? 'plus' : isEdit ? 'edit' : 'x'))
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

export const makeColorInput = (label, value, onInput) => {
  const wrapper = document.createElement('label')
  wrapper.className = 'conversation-color-control'
  wrapper.title = label
  wrapper.contentEditable = 'false'

  const swatch = document.createElement('input')
  swatch.type = 'color'
  swatch.value = value
  swatch.setAttribute('aria-label', label)
  swatch.addEventListener('pointerdown', event => event.stopPropagation())
  swatch.addEventListener('input', () => onInput(swatch.value))

  wrapper.appendChild(swatch)
  return wrapper
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

