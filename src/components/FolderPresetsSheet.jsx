/**
 * FolderPresetsSheet — Folder types: the built-in story folders, and the writer's own.
 *
 * A folder type is a name, an icon and an ink. Any folder of that name, and the
 * documents in it, wear the icon (folderPresets.ts). The five suggestions (Flora,
 * Fauna, Magic, Government, Religion) fill the form in one click; they are examples,
 * never built in.
 *
 * Opened from ⌘K, the file tree's + and its context menu (`openFolderPresets`).
 */
import { useEffect, useRef, useState } from 'react'
import { Button, Field, IconButton, InkPicker, Input, Sheet } from '../ui'
import Icon from '../ui/Icon.jsx'
import { inkColor } from '../lib/palette'
import { useCommands } from '../lib/commands'
import { CUSTOM_PRESET_ICONS, PRESET_SUGGESTIONS, STORY_FOLDER_PRESETS } from '../lib/storyStructure'
import {
  FOLDER_PRESETS_EVENT,
  addFolderPreset,
  presetNameProblem,
  removeFolderPreset,
  updateFolderPreset,
  useSavedFolderPresets,
} from '../lib/folderPresets'
import './FolderPresetsSheet.css'

const EMPTY = { name: '', entryLabel: '', icon: 'folder', ink: 'blue' }

function IconChoice({ value, onChange }) {
  return (
    <div role="radiogroup" aria-label="Icon" className="folder-preset-icons">
      {CUSTOM_PRESET_ICONS.map((icon) => (
        <IconButton
          key={icon}
          icon={icon}
          label={icon.replace('-', ' ')}
          size="circle"
          role="radio"
          aria-checked={value === icon}
          filled={value === icon}
          className="folder-preset-icon"
          onClick={() => onChange(icon)}
        />
      ))}
    </div>
  )
}

function PresetForm({ initial, editing, onDone }) {
  const [form, setForm] = useState(initial)
  const [tried, setTried] = useState(false)
  const nameRef = useRef(null)
  const problem = presetNameProblem(form.name, editing)
  const set = (patch) => setForm((current) => ({ ...current, ...patch }))

  useEffect(() => { nameRef.current?.focus() }, [])

  const submit = async (event) => {
    event.preventDefault()
    setTried(true)
    if (problem) return
    const fields = { name: form.name, entryLabel: form.entryLabel, icon: form.icon, ink: form.ink }
    const done = editing ? await updateFolderPreset(editing, fields) : await addFolderPreset(fields)
    if (done) onDone()
  }

  return (
    <form className="folder-preset-form" onSubmit={submit}>
      {editing ? null : (
        <div className="folder-preset-suggestions" aria-label="Suggestions">
          <span className="ib-hint">Start from</span>
          {PRESET_SUGGESTIONS.filter((suggestion) => !presetNameProblem(suggestion.name)).map((suggestion) => (
            <Button key={suggestion.name} variant="tinted" onClick={() => setForm({ ...suggestion })}>
              <Icon name={suggestion.icon} />{suggestion.name}
            </Button>
          ))}
        </div>
      )}
      <Field label="Name" htmlFor="folder-preset-name" error={tried ? problem : ''} hint="Folders with this name use this type.">
        <Input id="folder-preset-name" ref={nameRef} value={form.name} placeholder="Flora" onChange={(event) => set({ name: event.target.value })} />
      </Field>
      <Field label="Each document in it is a" htmlFor="folder-preset-entry" hint="For “New …” in the file tree.">
        <Input id="folder-preset-entry" value={form.entryLabel ?? ''} placeholder="Entry" onChange={(event) => set({ entryLabel: event.target.value })} />
      </Field>
      <Field label="Icon">
        <IconChoice value={form.icon} onChange={(icon) => set({ icon })} />
      </Field>
      <Field label="Colour">
        <InkPicker label="Colour" value={form.ink} onChange={(ink) => set({ ink })} />
      </Field>
      <div className="folder-preset-actions">
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="filled">{editing ? 'Save' : 'Add folder type'}</Button>
      </div>
    </form>
  )
}

export default function FolderPresetsSheet({ projectName }) {
  const saved = useSavedFolderPresets()
  const [open, setOpen] = useState(false)
  // null: the list; 'new': adding one; an id: editing that one.
  const [form, setForm] = useState(null)

  useEffect(() => {
    const show = (event) => {
      setOpen(true)
      setForm(event.detail?.editId ?? null)
    }
    window.addEventListener(FOLDER_PRESETS_EVENT, show)
    return () => window.removeEventListener(FOLDER_PRESETS_EVENT, show)
  }, [])

  useCommands(() => [{
    id: 'folders.presets',
    section: 'Document',
    title: 'Edit folder types…',
    icon: 'folder',
    keywords: ['preset', 'story folder', 'flora', 'fauna', 'magic', 'custom', 'category'],
    when: () => Boolean(projectName),
    run: () => { setOpen(true); setForm(null) },
  }], [projectName])

  if (!open || !projectName) return null
  const editing = form && form !== 'new' ? saved.find((preset) => preset.id === form) : null

  return (
    <Sheet title="Folder types" onClose={() => setOpen(false)} width={520}>
      {form ? (
        <PresetForm
          key={form}
          initial={editing ? { ...EMPTY, ...editing } : EMPTY}
          editing={editing?.id ?? null}
          onDone={() => setForm(null)}
        />
      ) : (
        <div className="folder-preset-list">
          <p className="ib-hint">A folder with one of these names, and the documents in it, wear its icon. Add your own for anything your story keeps a list of.</p>
          <ul>
            {STORY_FOLDER_PRESETS.map((preset) => (
              <li key={preset.key} className="folder-preset-row">
                <Icon name={preset.folderIcon} />
                <span className="folder-preset-name">{preset.name}</span>
                <span className="ib-meta">Built in</span>
              </li>
            ))}
            {saved.map((preset) => (
              <li key={preset.id} className="folder-preset-row">
                <span style={{ color: inkColor(preset.ink, 'currentColor') }}><Icon name={preset.icon} /></span>
                <span className="folder-preset-name">{preset.name}</span>
                <IconButton icon="edit" label={`Edit ${preset.name}`} size="capsule" onClick={() => setForm(preset.id)} />
                <IconButton icon="delete" label={`Remove ${preset.name}`} size="capsule" onClick={() => removeFolderPreset(preset.id)} />
              </li>
            ))}
          </ul>
          <Button variant="tinted" onClick={() => setForm('new')}><Icon name="add" />New folder type</Button>
        </div>
      )}
    </Sheet>
  )
}
