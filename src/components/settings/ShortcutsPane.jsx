/**
 * Settings ▸ Shortcuts: every command and its shortcut, and changing it (keybindings.ts).
 *
 * The list is the command palette's: whatever is registered now, grouped by section.
 * Click a shortcut, then press the keys for it; Escape keeps the old one. A shortcut
 * another command or the app already uses is allowed, and said under the row. The
 * app's own keys (copy, the palette, bold…) are listed at the end and cannot be changed.
 *
 * Every change is saved as it is made.
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, IconButton } from '../../ui'
import Icon from '../../ui/Icon.jsx'
import Kbd from '../../ui/Kbd.jsx'
import { useAllCommands } from '../../lib/commands'
import {
  BUILT_IN,
  bindingFor,
  bindingFromEvent,
  conflictsFor,
  formatBinding,
  isBindable,
  isRebound,
  pauseKeybindings,
  resetAllBindings,
  resetBinding,
  setBinding,
  useKeybindingOverrides,
} from '../../lib/keybindings'

const describeConflicts = (conflicts) => conflicts
  .map((conflict) => (conflict.kind === 'command' ? `“${conflict.command.title}”` : `${conflict.title} (built in)`))
  .join(', ')

/** Listen for the next shortcut pressed, for one command, until it is set or cancelled. */
function useRecorder(onDone) {
  const [recording, setRecording] = useState(null)
  const [hint, setHint] = useState('')

  useEffect(() => {
    if (!recording) return undefined
    pauseKeybindings(true)
    const onKeyDown = (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecording(null)
        return
      }
      const binding = bindingFromEvent(event)
      if (!binding) return
      if (!isBindable(binding)) {
        setHint('Hold ⌘, ⌥ or ⌃ with the key.')
        return
      }
      setBinding(recording, binding)
      setRecording(null)
      onDone?.(recording)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      pauseKeybindings(false)
      window.removeEventListener('keydown', onKeyDown, true)
      setHint('')
    }
  }, [onDone, recording])

  return { recording, hint, record: setRecording }
}

function ShortcutRow({ command, overrides, commands, recorder }) {
  const fixed = command.keys === undefined && Boolean(command.shortcut) && !isRebound(command.id, overrides)
  const binding = bindingFor(command, overrides)
  const isRecording = recorder.recording === command.id
  const conflicts = binding && !fixed ? conflictsFor(binding, command.id, commands, overrides) : []

  return (
    <li className="settings-shortcut" data-recording={isRecording}>
      <div className="settings-shortcut-row">
        <span className="settings-shortcut-title">{command.title}</span>
        {fixed ? (
          <Kbd>{command.shortcut}</Kbd>
        ) : (
          <>
            {isRebound(command.id, overrides) ? (
              <IconButton icon="undo" label="Use the default shortcut" size="capsule" onClick={() => resetBinding(command.id)} />
            ) : null}
            {binding && !isRecording ? (
              <IconButton icon="close" label="Clear shortcut" size="capsule" onClick={() => setBinding(command.id, '')} />
            ) : null}
            <Button
              className="settings-shortcut-keys"
              aria-label={`Shortcut for ${command.title}`}
              onClick={() => recorder.record(isRecording ? null : command.id)}
            >
              {isRecording ? 'Press keys…' : binding ? <Kbd>{formatBinding(binding)}</Kbd> : 'Add shortcut'}
            </Button>
          </>
        )}
      </div>
      {isRecording && recorder.hint ? <p className="settings-footer">{recorder.hint}</p> : null}
      {conflicts.length ? (
        <p className="settings-shortcut-conflict">
          <Icon name="warning" />
          Also {describeConflicts(conflicts)}.
        </p>
      ) : null}
    </li>
  )
}

export default function ShortcutsPane() {
  const commands = useAllCommands()
  const overrides = useKeybindingOverrides()
  const [filter, setFilter] = useState('')
  const recorder = useRecorder()

  const sections = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const shown = commands
      .filter((command) => {
        if (!needle) return true
        const keys = formatBinding(bindingFor(command, overrides)) || command.shortcut || ''
        return `${command.title} ${command.section} ${keys}`.toLowerCase().includes(needle)
      })
      .sort((a, b) => a.section.localeCompare(b.section) || a.title.localeCompare(b.title))
    const bySection = new Map()
    for (const command of shown) {
      if (!bySection.has(command.section)) bySection.set(command.section, [])
      bySection.get(command.section).push(command)
    }
    return [...bySection]
  }, [commands, filter, overrides])

  const builtIn = BUILT_IN.filter(({ title, keys }) => {
    const needle = filter.trim().toLowerCase()
    return !needle || `${title} ${formatBinding(keys)}`.toLowerCase().includes(needle)
  })

  return (
    <>
      <section className="settings-group">
        <div className="settings-actions">
          <input
            className="settings-input settings-grow"
            type="search"
            aria-label="Find a shortcut"
            placeholder="Find a command or a shortcut"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <Button disabled={!Object.keys(overrides).length} onClick={resetAllBindings}>Restore defaults</Button>
        </div>
        <p className="settings-footer">
          Click a shortcut, then press the keys you want. Tools that are not open now list theirs when they are.
        </p>
      </section>
      {sections.map(([section, sectionCommands]) => (
        <section key={section} className="settings-group">
          <h3>{section}</h3>
          <ul className="settings-shortcuts">
            {sectionCommands.map((command) => (
              <ShortcutRow key={command.id} command={command} overrides={overrides} commands={commands} recorder={recorder} />
            ))}
          </ul>
        </section>
      ))}
      {builtIn.length ? (
        <section className="settings-group">
          <h3>Built in</h3>
          <ul className="settings-shortcuts">
            {builtIn.map(({ title, keys }) => (
              <li key={keys} className="settings-shortcut">
                <div className="settings-shortcut-row">
                  <span className="settings-shortcut-title">{title}</span>
                  <Kbd>{formatBinding(keys)}</Kbd>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}
