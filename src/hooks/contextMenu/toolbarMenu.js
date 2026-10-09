/**
 * toolbarMenu.js — right-clicking the toolbar band: how the toolbar shows its items,
 * Customize Toolbar…, and Customize Inspector Layout…. The same menu wherever in the
 * band it lands, items and gaps alike (as ToolbarContextMenu.swift had it).
 */
import { popUpNativeMenu } from '../../ui/useNativeMenu'
import { readDisplayMode, writeDisplayMode } from '../../components/toolbar/useToolbarLayout'
import { CUSTOMIZE_TOOLBAR_EVENT } from '../../components/toolbar/toolbarContext'

export const CUSTOMIZE_INSPECTOR_EVENT = 'inkblot:customize-inspector'

export function toolbarMenuItems(display = readDisplayMode()) {
  return [
    { text: 'Icon and text', checked: display === 'iconAndLabel', action: () => writeDisplayMode('iconAndLabel') },
    { text: 'Icon only', checked: display === 'icon', action: () => writeDisplayMode('icon') },
    { text: 'Text only', checked: display === 'label', action: () => writeDisplayMode('label') },
    { separator: true },
    { text: 'Customize toolbar…', action: () => window.dispatchEvent(new CustomEvent(CUSTOMIZE_TOOLBAR_EVENT)) },
    { text: 'Customize inspector layout…', action: () => window.dispatchEvent(new CustomEvent(CUSTOMIZE_INSPECTOR_EVENT)) },
  ]
}

export function popUpToolbarMenu(event) {
  // A text field in the band keeps its own Cut/Copy/Paste menu.
  if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
  void popUpNativeMenu(event, toolbarMenuItems())
}
