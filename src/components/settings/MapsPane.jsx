/**
 * Settings ▸ Maps: whether maps may fetch from the internet, and where satellite
 * pictures come from (onlineMaps.js). Kept on this computer, never in a project, so
 * a key is not shared with a project folder.
 */
import { useEffect, useState } from 'react'
import { FormRow, Input, SelectMenu, Toggle } from '../../ui'
import { ONLINE_MAPS_CHANGED, readOnlineMaps, saveOnlineMaps, SATELLITE_PROVIDERS } from '../../lib/map/onlineMaps'

const PROVIDERS = SATELLITE_PROVIDERS.map((provider) => ({ value: provider.id, label: provider.label }))

/** A text field committed on Return or blur. */
function CommitInput({ value, onCommit, ...rest }) {
  const [draft, setDraft] = useState(null)
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft)
    setDraft(null)
  }
  return (
    <Input
      value={draft ?? value}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
        if (event.key === 'Escape') setDraft(null)
      }}
      {...rest}
    />
  )
}

export default function MapsPane() {
  const [settings, setSettings] = useState(readOnlineMaps)
  useEffect(() => {
    const onChange = (event) => setSettings(event.detail || readOnlineMaps())
    window.addEventListener(ONLINE_MAPS_CHANGED, onChange)
    return () => window.removeEventListener(ONLINE_MAPS_CHANGED, onChange)
  }, [])
  const set = (patch) => setSettings(saveOnlineMaps(patch))
  const provider = SATELLITE_PROVIDERS.find((option) => option.id === settings.provider)

  return (
    <>
      <section className="settings-group">
        <h3 className="ib-eyebrow">Online maps</h3>
        <FormRow label="Use online maps" help="map.online">
          <Toggle label="Use online maps" checked={settings.enabled} onChange={(enabled) => set({ enabled })} />
        </FormRow>
        <p className="settings-footer">Satellite pictures, street detail, terrain and searching for real places. Without them, every map still works, offline.</p>
      </section>
      <section className="settings-group">
        <h3 className="ib-eyebrow">Satellite pictures</h3>
        <FormRow label="Come from" help="map.satellite-source">
          <SelectMenu label="Satellite pictures come from" value={settings.provider} options={PROVIDERS} disabled={!settings.enabled} onChange={(next) => set({ provider: next })} />
        </FormRow>
        {provider?.needsKey || settings.provider === 'custom' ? (
          <FormRow label={settings.provider === 'custom' ? 'Key (optional)' : 'API key'} stacked>
            <CommitInput type="password" autoComplete="off" spellCheck={false} aria-label="API key" disabled={!settings.enabled} value={settings.key} placeholder="Paste your key" onCommit={(key) => set({ key })} />
          </FormRow>
        ) : null}
        {settings.provider === 'custom' ? (
          <FormRow label="Tile address" stacked>
            <CommitInput aria-label="Tile address" spellCheck={false} disabled={!settings.enabled} value={settings.customUrl} placeholder="https://…/{z}/{x}/{y}.jpg" onCommit={(customUrl) => set({ customUrl })} />
          </FormRow>
        ) : null}
      </section>
    </>
  )
}
