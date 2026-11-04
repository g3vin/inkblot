/**
 * NoteCharacters.jsx — the characters a note is about (`note.characters`, tree paths),
 * on both of a note's cards: the panel's (NoteCard) and the hover card
 * (NoteHoverPreview). A button picks them from the project's characters; each chosen
 * one shows as a chip in its ink, and clicking a chip opens that character.
 */
import { shellBridge } from '../bridge'
import { getDocDisplayName } from '../lib/docKind'
import { useCharacterEntries } from '../lib/storyEntries'
import { popUpMenu, Tag } from '../ui'
import Icon from '../ui/Icon.jsx'
import './NoteCharacters.css'

const toggled = (list, path) => (list.includes(path) ? list.filter((item) => item !== path) : [...list, path])

export function NoteCharacterButton({ characters = [], onChange, onOpen, className = 'note-tool-btn' }) {
  const entries = useCharacterEntries()
  const label = characters.length ? 'Change characters' : 'Add characters'
  return (
    <button
      type="button"
      className={`${className}${characters.length ? ' active' : ''}`}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation()
        onOpen?.()
        popUpMenu(event, entries.length
          ? entries.map((entry) => ({
              text: entry.name,
              checked: characters.includes(entry.path),
              action: () => onChange?.(toggled(characters, entry.path)),
            }))
          : [{ text: 'No characters yet', enabled: false }])
      }}
    >
      <Icon name="characters" active={characters.length > 0} />
    </button>
  )
}

export function NoteCharacterChips({ characters = [] }) {
  const entries = useCharacterEntries()
  if (!characters.length) return null
  return (
    <ul className="note-characters" aria-label="Characters">
      {characters.map((path) => {
        const entry = entries.find((item) => item.path === path)
        const name = entry?.name || getDocDisplayName(path)
        return (
          <li key={path}>
            {entry ? (
              <button
                type="button"
                className="note-character"
                title={`Open ${name}`}
                onClick={(event) => {
                  event.stopPropagation()
                  shellBridge.send('openDocument', { path: entry.path, pane: 'primary' })
                }}
              >
                <Tag ink={entry.ink}>{name}</Tag>
              </button>
            ) : (
              <span className="note-character is-missing" title={`${name} is no longer in the project`}>
                <Tag>{`${name} (missing)`}</Tag>
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
