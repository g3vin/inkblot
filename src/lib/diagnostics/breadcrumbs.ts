/**
 * breadcrumbs.ts — the trail of what the writer did, for a report to replay.
 *
 * Sources: commands (palette, shortcuts, menus), the bridge in both directions,
 * clicks on chrome, shortcuts, dialogs opening and closing, and the window's focus.
 * Typing is counted, never recorded: a keystroke in the editor adds to a "typing"
 * crumb's count and nothing else. Events that fire per keystroke collapse into the
 * crumb before them with a count, so the trail spans minutes, not the last sentence.
 */
import { onShellPost, shellBridge } from '../../bridge/appBridge'
import { observeCommands } from '../commands'
import { Ring } from './ring'
import { summarize } from './sanitize'

export interface Breadcrumb {
  at: number
  type: string
  data?: unknown
  /** How many in a row this crumb stands for. */
  count?: number
}

const crumbs = new Ring<Breadcrumb>(300)
let changed = false

/** Bridge events that fire with every keystroke or selection: their type is enough. */
const TYPE_ONLY_EVENTS = new Set(['toolbarState', 'selectionContext', 'timelineRangesChanged'])
/** Events whose payload is the writer's text or the project's sources. */
const NEVER_SUMMARIZED = new Set(['readAloudPayload', 'referencesChanged', 'referenceSchema', 'pageLayoutCatalog'])

export function addCrumb(type: string, data?: unknown, { collapse = false } = {}): void {
  const now = Date.now()
  const last = crumbs.last()
  if (collapse && last && last.type === type) {
    last.count = (last.count ?? 1) + 1
    last.at = now
    if (data !== undefined) last.data = data
  } else {
    crumbs.push(data === undefined ? { at: now, type } : { at: now, type, data })
  }
  changed = true
}

export const breadcrumbs = (limit?: number): Breadcrumb[] => crumbs.toArray(limit)

/** True once since the last call if anything was recorded: the heartbeat's cue. */
export function takeChanged(): boolean {
  const was = changed
  changed = false
  return was
}

const inEditor = (target: EventTarget | null): boolean =>
  target instanceof Element && !!target.closest('[contenteditable="true"], .ProseMirror, input, textarea')

/**
 * A control's name: its label, or its text when that is short. A long text is not a
 * control's name but content shown in one, such as a search result's snippet.
 */
function controlName(element: Element): string {
  const label = element.getAttribute('aria-label') || element.getAttribute('title')
  if (label) return label.trim().slice(0, 60)
  const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ')
  return text.length <= 32 && text.split(' ').length <= 4 ? text : `<text len=${text.length}>`
}

function shortcutOf(event: KeyboardEvent): string | null {
  if (!event.metaKey && !event.ctrlKey && !event.altKey) return null
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return null
  const parts = [event.metaKey && 'Cmd', event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift']
  return [...parts.filter(Boolean), event.code].join('+')
}

/** Start recording. Returns a function that stops. */
export function installBreadcrumbs(): () => void {
  const stops: Array<() => void> = []

  observeCommands((id) => addCrumb('command', { id }))
  stops.push(() => observeCommands(null))

  stops.push(shellBridge.onAny((event) => {
    const { type } = event
    if (NEVER_SUMMARIZED.has(type) || TYPE_ONLY_EVENTS.has(type)) addCrumb(`event:${type}`, undefined, { collapse: true })
    else addCrumb(`event:${type}`, summarize((event as { payload?: unknown }).payload), { collapse: type === 'docChanged' })
  }))

  stops.push(onShellPost((message) => {
    const sent = message.kind === 'command' ? message.message.command : message.message.request
    addCrumb(`${message.kind}:${sent.type}`, summarize(sent.payload), { collapse: message.kind === 'request' })
  }))

  const onKeyDown = (event: KeyboardEvent) => {
    const shortcut = shortcutOf(event)
    if (shortcut) addCrumb('shortcut', { keys: shortcut })
    else if (inEditor(event.target)) addCrumb('typing', undefined, { collapse: true })
  }
  const onClick = (event: MouseEvent) => {
    if (inEditor(event.target)) return
    const control = event.target instanceof Element
      ? event.target.closest('button, a, [role="menuitem"], [role="tab"], [role="option"], [role="treeitem"]')
      : null
    if (control) addCrumb('click', { role: control.getAttribute('role') ?? control.tagName.toLowerCase(), name: controlName(control) })
  }
  const onFocus = () => addCrumb('window', { state: 'focus' })
  const onBlur = () => addCrumb('window', { state: 'blur' })
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('click', onClick, true)
  window.addEventListener('focus', onFocus)
  window.addEventListener('blur', onBlur)
  stops.push(() => {
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('click', onClick, true)
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('blur', onBlur)
  })

  // Dialogs, sheets and the palette portal into <body>: watch its children only.
  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const [nodes, state] of [[record.addedNodes, 'open'], [record.removedNodes, 'close']] as const) {
          nodes.forEach((node) => {
            if (!(node instanceof Element) || !node.classList.contains('ib-dialog-scrim')) return
            if (node.classList.contains('is-leaving')) return
            const label = node.querySelector('[role="dialog"]')?.getAttribute('aria-label')
              ?? node.querySelector('.ib-title')?.textContent ?? ''
            addCrumb('dialog', { state, name: label.trim().slice(0, 60) })
          })
        }
      }
    })
    observer.observe(document.body, { childList: true })
    stops.push(() => observer.disconnect())
  }

  return () => stops.forEach((stop) => stop())
}
