/**
 * The bridge protocol's client, both ends of it.
 *
 * This is the suite the phase is for. The protocol is defined in Rust and its wire
 * format is tested there; what is checked here is the half that has to be *right*
 * rather than merely agreed — the client that sits between a shell and a live
 * ProseMirror document, and the four behaviours a Swift shell will depend on without
 * being able to see this file:
 *
 *   - **a command reaches the right editor, and no editor at all is survivable.** A
 *     shell decides to send before it can know the pane still exists.
 *   - **a request is always answered.** A shell blocked on a reply that never comes is
 *     a hang with no symptom, and the commonest cause — the user closed the pane
 *     between the right-click and the menu — is entirely ordinary.
 *   - **coalescing drops intermediate values and never the last one.** Sharp edge #4:
 *     note anchors remap on every keystroke, and the shell's copy is only correct if
 *     the final state always arrives.
 *   - **the drag hand-off arbitrates.** Two drop targets can see the same drop, and
 *     `window.__inkblot_dropHandled` decided it by running order.
 *
 * Everything runs through the JSON-copying transport, so a payload that could not
 * cross a process boundary fails here rather than in Phase 5.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'

const ok = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) process.exitCode = 1 }

// readState/commands reach isEditorReady, which touches nothing global, but the
// coalescer looks for requestAnimationFrame. A DOM makes the frame path real rather
// than always falling through to the timeout branch.
// `pretendToBeVisual` is what gives jsdom a real requestAnimationFrame; without it
// the coalescer silently takes its setTimeout fallback and the frame path — the one
// the app actually uses — goes untested.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'])

const C = '../../src'
const { createInProcessTransports, createDeferredTransports } = await import(`${C}/bridge/transport.ts`)
const { createShellBridge, createSurfaceBridge, BridgeRequestError } = await import(`${C}/bridge/client.ts`)
const { createEditorRegistry } = await import(`${C}/bridge/editorRegistry.ts`)
const { createDocumentSurface } = await import(`${C}/bridge/surface.ts`)
const { createCoalescer, immediateScheduler } = await import(`${C}/bridge/coalesce.ts`)
const { createDragHandoff } = await import(`${C}/bridge/dragHandoff.ts`)
const { resolveAnchor, readAnchor, findText } = await import(`${C}/bridge/anchors.ts`)
const { EditorTarget, MarkKind, Alignment, DragPayloadKind } = await import(`${C}/types/index.ts`)

/* ------------------------------------------------------------------
   A fake editor.
   Not a mock of TipTap — a small document model that answers the same
   questions. The suites that need the real thing mount it (editor.mjs);
   what is under test here is the bridge, and a real editor would hide
   which of the two got something wrong.
------------------------------------------------------------------ */
function makeEditor(text = 'she hesitated at the door') {
  const state = {
    // `nodes` is here because isEditorReady checks for it. Leaving it out makes every
    // editor look torn down, and the assertions that expect a command to land pass by
    // never running one — which is exactly how this fake was wrong the first time.
    schema: {
      nodes: { paragraph: 'paragraphNode', doc: 'docNode' },
      marks: { bold: 'boldMark', italic: 'italicMark', highlight: 'highlightMark' },
    },
    selection: {
      from: 0,
      to: 0,
      empty: true,
      node: null,
      $from: {
        parent: { childAfter: () => ({ node: null }), childBefore: () => ({ node: null }) },
        parentOffset: 0,
      },
    },
    doc: {
      content: { size: text.length },
      textBetween: (from, to) => text.slice(from, to),
      rangeHasMark: () => false,
      nodesBetween: () => {},
      descendants: (f) => { f({ isText: true, text }, 0) },
    },
  }

  const calls = []
  const chain = new Proxy({}, {
    get: (_target, prop) => (...args) => {
      if (prop === 'run') { calls.push(['run']); return true }
      calls.push([prop, ...args])
      return chain
    },
  })

  return {
    calls,
    isDestroyed: false,
    state,
    view: { isDestroyed: false },
    commandManager: {},
    commands: {},
    chain: () => chain,
    getAttributes: (name) => (name === 'textStyle' ? { color: '#ff0000', fontSize: '20px' } : {}),
    isActive: () => false,
  }
}

/** Wire a shell and a surface together over one transport. */
function wire({ deferred = false } = {}) {
  const transports = deferred ? createDeferredTransports() : createInProcessTransports()
  // A gap in the sequence is a dropped message. In the app that is logged; here it is
  // a failure, because a suite that tolerates a dropped command proves nothing.
  const onGap = (message) => { throw new Error(message) }
  const shell = createShellBridge(transports.shell, { onGap })
  const bridge = createSurfaceBridge(transports.surface, { onGap })
  const registry = createEditorRegistry()
  const surface = createDocumentSurface({
    bridge, registry, scheduler: immediateScheduler,
  })
  return { transports, shell, bridge, registry, surface }
}

/* ---------------- commands reach the right editor ---------------- */
{
  const { shell, registry, surface } = wire()
  const primary = makeEditor()
  const secondary = makeEditor()
  registry.register(EditorTarget.Primary, { getEditor: () => primary })
  registry.register(EditorTarget.Secondary, { getEditor: () => secondary })
  registry.setActive(EditorTarget.Primary)

  shell.send('applyMark', { target: EditorTarget.Secondary, mark: MarkKind.Bold })
  ok('a command reaches the editor it names, not the active one',
    secondary.calls.some(([m]) => m === 'toggleBold') &&
    !primary.calls.some(([m]) => m === 'toggleBold'))

  shell.send('setColor', { target: EditorTarget.Primary, color: '#00ff00' })
  ok('setColor applies the color it carried',
    primary.calls.some(([m, arg]) => m === 'setColor' && arg === '#00ff00'))

  shell.send('setFontFamily', { target: EditorTarget.Primary, family: 'Georgia' })
  ok('setFontFamily quotes the family on this side of the seam',
    primary.calls.some(([m, arg]) => m === 'setFontFamily' && String(arg).includes('Georgia')))

  shell.send('setAlignment', { target: EditorTarget.Primary, alignment: Alignment.Center })
  ok('setAlignment falls to setTextAlign with no node selected',
    primary.calls.some(([m, arg]) => m === 'setTextAlign' && arg === Alignment.Center))

  // The case a shell cannot avoid: it decided to send before it could know.
  registry.setActive(null)
  let threw = false
  try {
    shell.send('applyMark', { target: EditorTarget.CanvasCard, mark: MarkKind.Italic })
  } catch { threw = true }
  ok('a command for an editor that is not there is survivable, not a throw', !threw)

  surface.dispose()
}

/* ---------------- a withdrawn editor stops answering ---------------- */
{
  const { shell, registry, surface } = wire()
  const editor = makeEditor()
  const withdraw = registry.register(EditorTarget.Primary, { getEditor: () => editor })
  registry.setActive(EditorTarget.Primary)

  withdraw()
  shell.send('setColor', { target: EditorTarget.Primary, color: '#123456' })
  ok('a withdrawn registration takes its editor out of reach',
    !editor.calls.some(([m]) => m === 'setColor'))

  surface.dispose()
}

/* ---------------- a destroyed editor is never handed out ---------------- */
{
  const { shell, registry, surface } = wire()
  const editor = makeEditor()
  registry.register(EditorTarget.Primary, { getEditor: () => editor })
  registry.setActive(EditorTarget.Primary)

  // The window between React unmounting a pane and TipTap finishing teardown.
  editor.isDestroyed = true
  shell.send('setColor', { target: EditorTarget.Primary, color: '#123456' })
  ok('a destroyed editor is filtered out by the registry, not by the caller',
    !editor.calls.some(([m]) => m === 'setColor'))
  ok('and it resolves as absent', registry.active() === null)

  surface.dispose()
}

/* ---------------- requests are always answered ---------------- */
{
  const { shell, registry, surface, transports } = wire({ deferred: true })
  const editor = makeEditor()
  registry.register(EditorTarget.Primary, { getEditor: () => editor, getDocPath: () => 'ch/one.md' })
  registry.setActive(EditorTarget.Primary)

  const toolbarPromise = shell.request('getToolbarState', {})
  await transports.flush()
  const toolbar = await toolbarPromise
  ok('getToolbarState answers from the live editor', toolbar.color === '#ff0000')
  ok('and reports which editor answered', toolbar.target === EditorTarget.Primary)

  const contextPromise = shell.request('getSelectionContext', {})
  await transports.flush()
  const context = await contextPromise
  ok('getSelectionContext answers with the doc it came from', context.docPath === 'ch/one.md')
  ok('and an empty selection says so', context.empty === true)

  // The ordinary case: the pane closed between the right-click and the menu.
  registry.setActive(null)
  const failing = shell.request('getSelectionContext', {})
  await transports.flush()
  let error = null
  try { await failing } catch (caught) { error = caught }
  ok('a request with no editor is refused rather than left hanging',
    error instanceof BridgeRequestError)
  ok('and the refusal says why', error?.code === 'noEditor')

  surface.dispose()
}

/* A request nothing registered a handler for still gets a reply. */
{
  const transports = createDeferredTransports()
  const shell = createShellBridge(transports.shell)
  const bridge = createSurfaceBridge(transports.surface)
  const registry = createEditorRegistry()
  const surface = createDocumentSurface({ bridge, registry, scheduler: immediateScheduler })

  const pending = shell.request('getReadAloudPayload', { selectionOnly: false })
  await transports.flush()
  let error = null
  try { await pending } catch (caught) { error = caught }
  ok('an unhandled request is refused, so a shell cannot hang on it',
    error instanceof BridgeRequestError && error.code === 'failed')

  surface.dispose()
}

/* ---------------- events reach the shell, typed ---------------- */
{
  const { shell, registry, surface } = wire()
  const editor = makeEditor()
  registry.register(EditorTarget.Primary, { getEditor: () => editor, getDocPath: () => 'ch/one.md' })

  const seen = []
  shell.on('activeEditorChanged', (payload) => seen.push(payload))
  registry.setActive(EditorTarget.Primary)
  surface.publishActiveEditor()

  ok('the election result crosses as a name, not an object',
    seen.length === 1 && seen[0].target === EditorTarget.Primary)
  ok('and it carries the document that editor is showing', seen[0].docPath === 'ch/one.md')

  surface.dispose()
}

/* ---------------- the toolbar inverts from pull to push ---------------- */
{
  const { shell, registry, surface } = wire()
  const editor = makeEditor()
  registry.register(EditorTarget.Primary, { getEditor: () => editor })
  registry.setActive(EditorTarget.Primary)

  const states = []
  shell.on('toolbarState', (state) => states.push(state))

  surface.publishToolbarState()
  ok('the toolbar state is pushed, and reads the live editor',
    states.length === 1 && states[0].fontSize === '20px')

  // Sharp edge #1: the remembered highlight was `editor.storage.lastHighlightColor`,
  // shared mutable state across a seam that does not exist yet.
  shell.send('setHighlight', { target: EditorTarget.Primary, color: '#ff00ff', remember: true })
  ok('a remembered highlight becomes protocol state',
    surface.lastHighlightColor() === '#ff00ff')
  ok('and is reported back on the next toolbar state',
    states[states.length - 1].lastHighlightColor === '#ff00ff')

  shell.send('setHighlight', { target: EditorTarget.Primary, color: '#010101', remember: false })
  ok('a preview highlight applies without being remembered',
    surface.lastHighlightColor() === '#ff00ff' &&
    editor.calls.some(([m, arg]) => m === 'setHighlight' && arg?.color === '#010101'))

  surface.dispose()
}

/* ---------------- coalescing (sharp edge #4) ---------------- */
{
  const delivered = []
  const coalescer = createCoalescer((value) => delivered.push(value), immediateScheduler)
  coalescer.push(1)
  ok('an immediate scheduler delivers at once', delivered.length === 1 && delivered[0] === 1)

  // Regression. A scheduler may run its callback synchronously, in which case `send`
  // has already cleared the pending slot before `schedule` returns — so holding on to
  // the canceller it returns leaves the coalescer looking permanently busy, and every
  // push after the first is swallowed. It delivered exactly one toolbar state for the
  // life of the app.
  coalescer.push(2)
  coalescer.push(3)
  ok('and keeps delivering after the first push, rather than wedging',
    delivered.length === 3 && delivered[2] === 3)

  // The real case: a frame scheduler, many pushes, one delivery.
  const framed = []
  let pendingFrame = null
  const manual = (callback) => { pendingFrame = callback; return () => { pendingFrame = null } }
  const batched = createCoalescer((value) => framed.push(value), manual)

  batched.push('a')
  batched.push('b')
  batched.push('c')
  ok('nothing is sent before the frame runs', framed.length === 0)
  ok('and only one frame is scheduled for three pushes', typeof pendingFrame === 'function')

  pendingFrame()
  ok('one delivery for three pushes', framed.length === 1)
  ok('and it is the LAST value, never an intermediate one', framed[0] === 'c')

  // Teardown with something pending: for a whole-state event, sending it is right.
  const flushed = []
  const onUnmount = createCoalescer((value) => flushed.push(value), manual)
  onUnmount.push('final')
  onUnmount.flush()
  ok('a pending value is flushed rather than lost at teardown',
    flushed.length === 1 && flushed[0] === 'final')

  const dropped = []
  const cancelled = createCoalescer((value) => dropped.push(value), manual)
  cancelled.push('gone')
  cancelled.cancel()
  ok('and cancel drops it without sending', dropped.length === 0)
}

/* notesRemapped coalesces per document, not globally. */
{
  const transports = createInProcessTransports()
  const shell = createShellBridge(transports.shell)
  const bridge = createSurfaceBridge(transports.surface)
  const registry = createEditorRegistry()

  let pending = []
  const manual = (callback) => {
    pending.push(callback)
    return () => { pending = pending.filter((entry) => entry !== callback) }
  }
  const surface = createDocumentSurface({ bridge, registry, scheduler: manual })

  const remaps = []
  shell.on('notesRemapped', (payload) => remaps.push(payload))

  surface.publishNotesRemapped({ docPath: 'a.md', notes: [], droppedNoteIds: [] })
  surface.publishNotesRemapped({ docPath: 'b.md', notes: [], droppedNoteIds: [] })
  surface.publishNotesRemapped({ docPath: 'a.md', notes: [], droppedNoteIds: ['n1'] })

  for (const callback of pending.splice(0)) callback()
  ok('two documents remapping in one frame both get through', remaps.length === 2)
  ok('and each carries its own latest state',
    remaps.find((r) => r.docPath === 'a.md')?.droppedNoteIds.length === 1)

  surface.dispose()
}

/* ---------------- the drag hand-off (the globals) ---------------- */
{
  const drag = createDragHandoff()
  const session = drag.begin({
    kind: DragPayloadKind.ClipboardEntry,
    text: 'she hesitated',
    sourceId: 'entry-1',
  })
  ok('a drag has an id, so two drags cannot be confused', Boolean(session.dragId))
  ok('and is unclaimed to begin with', drag.isClaimed() === false)

  // What `__inkblot_dropHandled` arbitrated by running order.
  ok('the first target to claim the drop wins', drag.claim() === true)
  ok('and every target after it loses', drag.claim() === false)

  drag.moveTo(10, 20)
  ok('the drag point is remembered, as __inkblot_dragPoint was',
    drag.point().x === 10 && drag.point().y === 20)

  const ended = drag.end()
  ok('the end reports that the drop was handled', ended.handled === true)
  ok('and the session is gone', drag.current() === null)
  ok('ending a drag that is not running is null, not a throw', drag.end() === null)

  const unclaimed = createDragHandoff()
  unclaimed.begin({ kind: DragPayloadKind.EditorSelection, text: 'x' })
  ok('a drag nobody claimed reports handled: false', unclaimed.end().handled === false)
}

/* The drag crosses the bridge as data. */
{
  const transports = createInProcessTransports()
  const shell = createShellBridge(transports.shell)
  const bridge = createSurfaceBridge(transports.surface)
  const registry = createEditorRegistry()
  const drag = createDragHandoff()
  const surface = createDocumentSurface({
    bridge, registry, drag, scheduler: immediateScheduler,
  })

  const started = []
  const ended = []
  shell.on('dragStarted', (payload) => started.push(payload))
  shell.on('dragEnded', (payload) => ended.push(payload))

  drag.begin({
    kind: DragPayloadKind.EditorSelection,
    text: 'she hesitated',
    docPath: 'ch/one.md',
    anchor: { from: 4, to: 17, text: 'she hesitated' },
  })
  surface.publishDragStarted()
  ok('a drag reaches the shell with its payload', started[0]?.text === 'she hesitated')
  ok('and names where in the document it came from', started[0]?.anchor?.from === 4)
  ok('the internal claim flag does not go on the wire', !('claimed' in started[0]))

  drag.claim()
  surface.publishDragEnded({ x: 3, y: 4 })
  ok('the end reports the claim across the bridge', ended[0]?.handled === true)

  surface.dispose()
}

/* ---------------- anchors (sharp edge #3) ---------------- */
{
  const editor = makeEditor('she hesitated at the door')

  ok('an anchor whose positions still cover its text is trusted',
    JSON.stringify(resolveAnchor(editor, { from: 4, to: 13, text: 'hesitated' })) ===
    JSON.stringify({ from: 4, to: 13 }))

  // The case the two hand-rolled versions get wrong: finite positions that have gone
  // stale. Both trusted them; this re-finds the text instead.
  const stale = resolveAnchor(editor, { from: 90, to: 99, text: 'hesitated' })
  ok('stale positions are re-resolved by text, not trusted',
    stale?.from === 4 && stale?.to === 13)

  const moved = resolveAnchor(editor, { from: 0, to: 3, text: 'hesitated' })
  ok('positions covering the WRONG text are re-resolved too',
    moved?.from === 4 && moved?.to === 13)

  ok('text that is gone resolves to nothing, rather than to a guess',
    resolveAnchor(editor, { from: 0, to: 5, text: 'nonexistent' }) === null)

  ok('preferPositions: false searches even when the positions would have worked',
    JSON.stringify(resolveAnchor(editor, { from: 4, to: 13, text: 'door' }, { preferPositions: false })) ===
    JSON.stringify({ from: 21, to: 25 }))

  const read = readAnchor(editor, 4, 13)
  ok('reading an anchor captures the text to re-resolve by', read.text === 'hesitated')
  ok('and clamps to the document rather than trusting the caller',
    readAnchor(editor, 0, 9999).to === 25)

  ok('findText returns null for an empty needle', findText(editor.state.doc, '') === null)
}

/* ---------------- the transport refuses what cannot cross ---------------- */
{
  const transports = createInProcessTransports()
  const shell = createShellBridge(transports.shell)

  let threw = null
  try {
    // What NoteAnnotation.js:155 ships today: a live EditorView in an event payload.
    const live = {}
    live.self = live
    shell.send('canvasRestore', { docPath: 'b.canvas', canvas: live })
  } catch (error) { threw = error }

  ok('a payload that cannot be serialized fails here, not in Phase 5',
    threw instanceof TypeError)
}

/* ---------------- delivery is not assumed to be synchronous ---------------- */
{
  const transports = createDeferredTransports()
  const shell = createShellBridge(transports.shell)
  const bridge = createSurfaceBridge(transports.surface)
  const registry = createEditorRegistry()
  const editor = makeEditor()
  registry.register(EditorTarget.Primary, { getEditor: () => editor })
  registry.setActive(EditorTarget.Primary)
  const surface = createDocumentSurface({ bridge, registry, scheduler: immediateScheduler })

  shell.send('applyMark', { target: EditorTarget.Primary, mark: MarkKind.Bold })
  ok('nothing has happened before the queue drains — as a real bridge behaves',
    !editor.calls.some(([m]) => m === 'toggleBold'))

  await transports.flush()
  ok('and the command lands once it does',
    editor.calls.some(([m]) => m === 'toggleBold'))

  surface.dispose()
}

/* ---------------- a dropped message is noticed ---------------- */
{
  const transports = createInProcessTransports()
  const gaps = []
  const bridge = createSurfaceBridge(transports.surface, { onGap: (m) => gaps.push(m) })
  const registry = createEditorRegistry()
  const surface = createDocumentSurface({ bridge, registry, scheduler: immediateScheduler })

  // Post by hand, skipping seq 0: what a transport that silently drops would look like.
  transports.shell.post({
    kind: 'command',
    message: { seq: 1, command: { type: 'setCaretAtDocPos', payload: { target: EditorTarget.Primary, pos: 0 } } },
  })
  ok('a gap in the sequence is reported rather than passing unnoticed', gaps.length === 1)

  surface.dispose()
}
