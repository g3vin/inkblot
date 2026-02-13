import React, { useEffect, useMemo, useState } from 'react'

const BASE_URL = 'https://raw.githubusercontent.com/andrewtavis/sf-symbols-online/master'

export default function SFIcon({ name, filled = false, className = '', title }) {
  const [fillAvailable, setFillAvailable] = useState(true)

  useEffect(() => {
    setFillAvailable(true)
  }, [name])

  const iconName = useMemo(() => {
    if (filled && fillAvailable) return `${name}.fill`
    return name
  }, [name, filled, fillAvailable])

  const lightSrc = `${BASE_URL}/glyphs/${iconName}.png`
  const darkSrc = `${BASE_URL}/glyphs_white/${iconName}.png`

  return (
    <span className={`sf-icon ${className}`} aria-hidden="true" title={title}>
      <img
        className="sf-icon-light"
        src={lightSrc}
        alt=""
        onError={() => {
          if (filled) setFillAvailable(false)
        }}
      />
      <img
        className="sf-icon-dark"
        src={darkSrc}
        alt=""
        onError={() => {
          if (filled) setFillAvailable(false)
        }}
      />
    </span>
  )
}
