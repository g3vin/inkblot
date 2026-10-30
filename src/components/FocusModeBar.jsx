/**
 * FocusModeBar — focus mode's toolbar: the card's toolbar row, with focus mode's own
 * controls in it, that floats in over the top of the card while the pointer is there.
 *
 * It never stays: it shows for a moment as focus mode opens, then only while the
 * pointer is at the card's top, a control in it has focus, or its text size popover is
 * open, and never while focus mode is zooming in or out (`hidden`). The sidebar buttons
 * sit in its corners, as on the card's toolbar.
 */
import { useEffect, useRef, useState } from 'react'
import { FormRow, IconButton, Popover, Segmented, Stepper } from '../ui'
import { FOCUS_MODE_LIMITS } from './focusModeSettings'

/** How long the bar shows as focus mode opens, so the writer knows where it lives. */
const INTRO_MS = 3200
/** How long it waits after the pointer leaves before it goes. */
const HIDE_DELAY_MS = 450

const VIEWS = [
  { value: 'sentence', label: 'Sentence' },
  { value: 'paragraph', label: 'Paragraph' },
]

export default function FocusModeBar({ settings, onSetting, onExit, sidebars, hidden = false }) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [intro, setIntro] = useState(true)
  const [sizesOpen, setSizesOpen] = useState(false)
  const hideTimer = useRef(null)
  const sizesRef = useRef(null)

  // The intro counts from when the bar can first show, after the zoom in.
  useEffect(() => {
    if (hidden) return undefined
    const timer = window.setTimeout(() => setIntro(false), INTRO_MS)
    return () => window.clearTimeout(timer)
  }, [hidden])
  useEffect(() => () => window.clearTimeout(hideTimer.current), [])

  const enter = () => {
    window.clearTimeout(hideTimer.current)
    setHovered(true)
  }
  const leave = () => {
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setHovered(false), HIDE_DELAY_MS)
  }

  const shown = !hidden && (hovered || focused || intro || sizesOpen)
  const paragraph = settings.paragraphContext
  const { left, right } = sidebars ?? {}

  return (
    <div
      className={`focus-mode-bar-zone${shown ? ' is-shown' : ''}`}
      onPointerEnter={enter}
      onPointerLeave={leave}
      onMouseDown={(event) => event.stopPropagation()}
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}
    >
      <div className="focus-mode-bar" role="toolbar" aria-label="Focus mode">
        <div className="titlebar-toggle is-left">
          {left ? (
            <IconButton icon="sidebar" label={left.pinned ? 'Hide sidebar' : 'Keep sidebar open'} onClick={left.togglePin} />
          ) : null}
        </div>

        <div className="focus-mode-bar-controls">
          <Segmented
            value={paragraph ? 'paragraph' : 'sentence'}
            onChange={(value) => onSetting('paragraphContext', value === 'paragraph')}
            options={VIEWS}
            label="Show"
          />
          {paragraph ? null : (
            <>
              <span className="focus-mode-bar-field">
                <span className="focus-mode-bar-label">Before</span>
                <Stepper
                  value={settings.before}
                  min={FOCUS_MODE_LIMITS.before.min}
                  max={FOCUS_MODE_LIMITS.before.max}
                  label="Sentences before"
                  onChange={(value) => onSetting('before', value)}
                />
              </span>
              <span className="focus-mode-bar-field">
                <span className="focus-mode-bar-label">After</span>
                <Stepper
                  value={settings.after}
                  min={FOCUS_MODE_LIMITS.after.min}
                  max={FOCUS_MODE_LIMITS.after.max}
                  label="Sentences after"
                  onChange={(value) => onSetting('after', value)}
                />
              </span>
            </>
          )}
          <IconButton
            ref={sizesRef}
            icon="font-size"
            label="Text size"
            aria-expanded={sizesOpen}
            filled={sizesOpen}
            onClick={() => setSizesOpen((open) => !open)}
          />
          <Popover
            anchorRef={sizesRef}
            open={sizesOpen}
            onClose={() => setSizesOpen(false)}
            className="focus-mode-popover"
          >
            <FormRow label={paragraph ? 'Sentence you’re on' : 'This sentence'}>
              <Stepper
                value={settings.fontSize}
                min={FOCUS_MODE_LIMITS.fontSize.min}
                max={FOCUS_MODE_LIMITS.fontSize.max}
                step={2}
                label="Size of the sentence you’re on"
                onChange={(value) => onSetting('fontSize', value)}
              />
            </FormRow>
            <FormRow label="The rest">
              <Stepper
                value={settings.contextFontSize}
                min={FOCUS_MODE_LIMITS.contextFontSize.min}
                max={FOCUS_MODE_LIMITS.contextFontSize.max}
                step={2}
                label="Size of the sentences around it"
                onChange={(value) => onSetting('contextFontSize', value)}
              />
            </FormRow>
          </Popover>
          <IconButton
            icon="number"
            label={settings.showPosition ? 'Hide position' : 'Show position'}
            title={settings.showPosition ? 'Hide paragraph and sentence numbers' : 'Show paragraph and sentence numbers'}
            aria-pressed={settings.showPosition}
            onClick={() => onSetting('showPosition', !settings.showPosition)}
          />
          <IconButton
            className="focus-mode-bar-done"
            icon="check"
            label="Done"
            title="Leave focus mode (Esc)"
            variant="tinted"
            size="circle"
            onClick={onExit}
          />
        </div>

        <div className="titlebar-toggle is-right">
          {right ? (
            <IconButton icon="sidebar" className="is-mirrored" label={right.pinned ? 'Hide inspector' : 'Keep inspector open'} onClick={right.togglePin} />
          ) : null}
        </div>
      </div>
    </div>
  )
}
