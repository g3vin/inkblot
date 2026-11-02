/**
 * SelectionWheelPane — Settings ▸ Selection wheel: the key that opens it, and which
 * tools it holds in which places, with the wheel drawn as it will open.
 */
import { useState } from 'react'
import { Button, FormRow, Icon, IconButton, SelectMenu, Toggle, ToolWheelPreview } from '../../ui'
import { SELECTION_TOOLS, selectionTool } from '../../lib/selectionTools'
import { DEFAULT_SELECTION_WHEEL, HOLD_KEYS, WHEEL_MAX_TOOLS, saveSelectionWheel, useSelectionWheelSettings } from '../selectionWheelSettings'

export default function SelectionWheelPane() {
  const settings = useSelectionWheelSettings()
  const { tools, holdKey } = settings
  // The row the pointer or focus is on, lit on the preview so its place is plain.
  const [pointed, setPointed] = useState(null)
  const save = (next) => saveSelectionWheel({ ...settings, ...next })
  const move = (id, step) => {
    const from = tools.indexOf(id)
    const to = from + step
    if (from < 0 || to < 0 || to >= tools.length) return
    const next = [...tools]
    next.splice(from, 1)
    next.splice(to, 0, id)
    save({ tools: next })
  }
  const toggle = (id, on) => save({ tools: on ? [...tools, id] : tools.filter((tool) => tool !== id) })
  const full = tools.length >= WHEEL_MAX_TOOLS
  const rows = [...tools.map(selectionTool), ...SELECTION_TOOLS.filter((tool) => !tools.includes(tool.id))]
  const preview = tools.map((id) => {
    const tool = selectionTool(id)
    return { id, label: tool.label, icon: tool.icon, submenu: tool.options ? [] : undefined }
  })
  const isDefault = holdKey === DEFAULT_SELECTION_WHEEL.holdKey && tools.join() === DEFAULT_SELECTION_WHEEL.tools.join()

  return (
    <>
      <section className="settings-group">
        <h3 className="ib-eyebrow">Selection wheel</h3>
        <FormRow label="Open by holding" help="settings.selection-wheel">
          <SelectMenu label="Open by holding" value={holdKey} onChange={(value) => save({ holdKey: value })} options={HOLD_KEYS} />
        </FormRow>
        <p className="settings-footer">
          Select some text, hold the key and flick toward a tool. Tap the key instead to keep the wheel open. It's also in the command palette.
        </p>
      </section>
      <section className="settings-group">
        <h3 className="ib-eyebrow">On the wheel</h3>
        <div className="settings-wheel">
          {preview.length
            ? <ToolWheelPreview items={preview} label="Selection" target={pointed !== null && tools.includes(pointed) ? tools.indexOf(pointed) : null} />
            : <p className="settings-footer">Turn on a tool below to put it on the wheel.</p>}
        </div>
        <ul className="settings-wheel-tools" onPointerLeave={() => setPointed(null)}>
          {rows.map((tool) => {
            const on = tools.includes(tool.id)
            const index = tools.indexOf(tool.id)
            return (
              <li
                key={tool.id}
                className="settings-wheel-tool"
                data-on={on}
                onPointerEnter={() => setPointed(tool.id)}
                onFocus={() => setPointed(tool.id)}
              >
                <Icon name={tool.icon} />
                <span className="settings-grow">{tool.label}</span>
                {on ? (
                  <>
                    <IconButton icon="chevron-up" label={`Move ${tool.label} earlier`} size="capsule" disabled={index === 0} onClick={() => move(tool.id, -1)} />
                    <IconButton icon="chevron-down" label={`Move ${tool.label} later`} size="capsule" disabled={index === tools.length - 1} onClick={() => move(tool.id, 1)} />
                  </>
                ) : null}
                <Toggle label={`${tool.label} on the wheel`} checked={on} disabled={!on && full} onChange={(next) => toggle(tool.id, next)} />
              </li>
            )
          })}
        </ul>
        <p className="settings-footer">
          Up to {WHEEL_MAX_TOOLS} tools. The first sits at the top and the rest follow clockwise, always in the same places.
        </p>
        <Button size="capsule" disabled={isDefault} onClick={() => saveSelectionWheel(DEFAULT_SELECTION_WHEEL)}>Reset to default</Button>
      </section>
    </>
  )
}
