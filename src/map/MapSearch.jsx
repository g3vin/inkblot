/**
 * MapSearch.jsx — Find on this map (⌘F): a field at the top of the map, and what
 * answers it (mapFind.js) as you type. Choosing one flies there and selects it.
 *
 * On the Earth, with online maps on, Return also asks Photon for real places of that
 * name (onlineMaps.js — one search per Return, never per keystroke); choosing one
 * flies there, and "Add as a place" pins it.
 *
 * ↓ moves into the results, ↑ and ↓ move through them, Escape puts the field away.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, MenuItem, MenuLabel } from '../ui'
import { findOnMap } from '../lib/map/mapFind'
import { searchPlaces } from '../lib/map/onlineMaps'
import { getDocDisplayName } from '../lib/docKind'

const KIND_ICONS = { pin: 'map-pin', route: 'map-route', region: 'map-area', label: 'label', body: 'orbit', traveler: 'map-pin' }

export default function MapSearch({ map, space, day, online = false, near = null, onPick, onGoWorld, onAddWorld, onClose }) {
  const [query, setQuery] = useState('')
  const [world, setWorld] = useState({ query: '', results: [], status: '' })
  const [chosen, setChosen] = useState(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const found = useMemo(() => findOnMap(map, space, query, { day, docName: getDocDisplayName }), [day, map, query, space])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const askWorld = async () => {
    const text = query.trim()
    if (!online || !text) return
    setWorld({ query: text, results: [], status: 'Searching…' })
    try {
      const results = await searchPlaces(text, near)
      setWorld({ query: text, results, status: results.length ? '' : 'No real places by that name.' })
    } catch (error) {
      console.error('[map] place search failed:', error)
      setWorld({ query: text, results: [], status: 'The search could not be reached.' })
    }
  }

  const items = () => [...(listRef.current?.querySelectorAll('[role="menuitem"]') || [])]
  const onFieldKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      items()[0]?.focus()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (online) void askWorld()
      else if (found[0]) onPick(found[0])
    }
  }
  const onListKey = (event) => {
    const list = items()
    const at = list.indexOf(document.activeElement)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      list[Math.min(list.length - 1, at + 1)]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (at <= 0) inputRef.current?.focus()
      else list[at - 1]?.focus()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  const showWorld = online && world.query === query.trim() && (world.results.length || world.status)
  return (
    <div className="map-floating map-search" role="search">
      <div className="map-search-field">
        <Input
          ref={inputRef}
          icon="search"
          value={query}
          placeholder={online ? 'Find on this map, or a real place' : 'Find on this map'}
          aria-label="Find on this map"
          onChange={(event) => {
            setQuery(event.target.value)
            setChosen(null)
          }}
          onKeyDown={onFieldKey}
        />
      </div>
      {query.trim() ? (
        <div className="ib-menu map-search-results" role="menu" ref={listRef} onKeyDown={onListKey}>
          {found.map((hit) => (
            <MenuItem key={`${hit.kind}:${hit.id}`} icon={KIND_ICONS[hit.kind]} hint={hit.detail} closeOnSelect={false} onSelect={() => onPick(hit)}>
              {hit.name}
            </MenuItem>
          ))}
          {!found.length && !showWorld ? <p className="ib-hint map-search-note">{online ? 'Nothing here by that name. Press Return to look for real places.' : 'Nothing on this map by that name.'}</p> : null}
          {showWorld ? <MenuLabel>In the world</MenuLabel> : null}
          {showWorld && world.status ? <p className="ib-hint map-search-note">{world.status}</p> : null}
          {showWorld
            ? world.results.map((place, index) => (
                <MenuItem
                  key={`world:${index}`}
                  icon="globe"
                  hint={place.detail}
                  closeOnSelect={false}
                  onSelect={() => {
                    setChosen(place)
                    onGoWorld(place)
                  }}
                >
                  {place.name}
                </MenuItem>
              ))
            : null}
        </div>
      ) : null}
      {chosen ? (
        <div className="map-search-add">
          <Button variant="tinted" onClick={() => {
            onAddWorld(chosen)
            onClose()
          }}>
            Add “{chosen.name}” as a place
          </Button>
        </div>
      ) : null}
    </div>
  )
}
