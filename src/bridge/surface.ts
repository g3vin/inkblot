/**
 * surface.ts — the webview's half of the bridge, assembled.
 *
 * `createDocumentSurface` takes a `SurfaceBridge` and an `EditorRegistry` and installs
 * every command and request handler the protocol defines. What comes back is the object
 * the React shell publishes *through*: `publishToolbarState()`, `publishNotesRemapped()`
 * and friends, each coalesced, each typed.
 *
 * **The split between handlers and delegates is the interesting line.** A command that
 * only needs a live editor — every formatting command, the selection commands — is
 * handled here, completely, and needs nothing from the app. A command that changes what
 * the app is *showing* — open a document, replace a pane's content, run a canvas
 * command — cannot be: it needs React state that only the app owns. Those are delegated
 * out, and the delegate list is therefore an exact statement of what a native shell
 * cannot do without the app's cooperation. It is short, and keeping it short is what
 * keeps the seam thin.
 */
import { EditorTarget } from '../types'
import type {
  ActiveEditorChanged,
  CanvasCommandRequest,
  CanvasDropDocCommand,
  CanvasDropNoteCommand,
  CanvasRestoreCommand,
  CanvasRevealCommand,
  DictationCancelCommand,
  DictationLevelCommand,
  DictationTranscript,
  DocChanged,
  FocusModeView,
  Note,
  NoteMarkerEvent,
  NotesRemapped,
  OpenDocumentCommand,
  ProjectChanged,
  ReadAloudPayloadEvent,
  SearchMatches,
  SelectionContext,
  SetContentCommand,
  SyncNotesCommand,
  ToolbarState,
} from '../types'
import type { CommandPayload, CommandType, SurfaceBridge, Unsubscribe } from './client'
import type { EditorRegistry, ResolvedEditor } from './editorRegistry'
import { createCoalescer, frameScheduler, type Scheduler } from './coalesce'
import { TOOLBAR_DEFAULTS, readSelectionContext, readToolbarState } from './readState'
import * as commands from './commands'
import { dragHandoff, type DragHandoff } from './dragHandoff'

/** What the surface cannot do alone. Every one of these needs app state. */
export interface SurfaceDelegates {
  openDocument?(command: OpenDocumentCommand): void
  setContent?(command: SetContentCommand): void
  syncNotes?(command: SyncNotesCommand): void
  dictationPartial?(command: DictationTranscript): void
  dictationFinal?(command: DictationTranscript): void
  dictationLevel?(command: DictationLevelCommand): void
  dictationCancel?(command: DictationCancelCommand): void
  canvasCommand?(command: CanvasCommandRequest): void
  canvasDropDoc?(command: CanvasDropDocCommand): void
  canvasDropNote?(command: CanvasDropNoteCommand): void
  canvasReveal?(command: CanvasRevealCommand): void
  canvasRestore?(command: CanvasRestoreCommand): void
}

export interface DocumentSurfaceOptions {
  bridge: SurfaceBridge
  registry: EditorRegistry
  delegates?: SurfaceDelegates
  /** Injected so a test can run without a frame loop. */
  scheduler?: Scheduler
  drag?: DragHandoff
}

export interface DocumentSurface {
  /** Replace the delegates — React's callbacks change identity on every render. */
  setDelegates(delegates: SurfaceDelegates): void

  /**
   * Handle a command directly, alongside the delegates.
   *
   * For the components that own a command outright rather than on the app's behalf:
   * `DictationControl` is the whole reason this exists. The delegate table is set in
   * one place by one component, which is right for commands the app routes, and wrong
   * for a command whose only possible handler is a control that may not be mounted.
   * Several handlers may register for the same command; all of them are called.
   */
  onCommand<T extends CommandType>(
    type: T,
    handler: (payload: CommandPayload<T>) => void
  ): Unsubscribe

  /** The remembered highlight color, which is now protocol state rather than editor storage. */
  lastHighlightColor(): string

  /** Read the active editor and push a `toolbarState`. Coalesced to one per frame. */
  publishToolbarState(): void
  /** Read the active editor and push a `selectionContext`. Coalesced. */
  publishSelectionContext(options?: { docPath?: string | null; isCanvas?: boolean }): void
  /** Push the election result. Not coalesced — it is rare and ordering matters. */
  publishActiveEditor(info?: Partial<ActiveEditorChanged>): void
  publishDocChanged(payload: DocChanged): void
  /** Push a whole remapped note set. Coalesced per document. */
  publishNotesRemapped(payload: NotesRemapped): void
  publishNoteMarker(kind: 'hover' | 'leave' | 'pin', payload: NoteMarkerEvent): void
  publishSearchMatches(payload: SearchMatches): void
  publishFocusModeView(payload: FocusModeView): void
  publishReadAloudPayload(payload: ReadAloudPayloadEvent): void
  /** Which project is open. Not coalesced — it changes when the user picks one. */
  publishProjectChanged(payload: ProjectChanged): void

  /** Report a drag over the bridge. The hand-off state itself lives in `dragHandoff`. */
  publishDragStarted(): void
  publishDragMoved(x: number, y: number): void
  publishDragEnded(at?: { x?: number; y?: number }): void

  /** Send anything still pending. Called when a pane tears down. */
  flush(): void
  dispose(): void
}

export function createDocumentSurface({
  bridge,
  registry,
  delegates: initialDelegates = {},
  scheduler = frameScheduler,
  drag = dragHandoff,
}: DocumentSurfaceOptions): DocumentSurface {
  let delegates = initialDelegates
  let lastHighlightColor: string = TOOLBAR_DEFAULTS.highlight
  const subscriptions: Unsubscribe[] = []

  /* ---------------- coalesced publishers ---------------- */

  const toolbar = createCoalescer<ToolbarState>(
    (state) => bridge.emit('toolbarState', state),
    scheduler
  )
  const selection = createCoalescer<SelectionContext>(
    (context) => bridge.emit('selectionContext', context),
    scheduler
  )
  // Keyed by document: two panes remap independently, and coalescing them into one slot
  // would drop one pane's notes every time both changed in the same frame.
  const notesByDoc = new Map<string, ReturnType<typeof createCoalescer<NotesRemapped>>>()
  const notesCoalescer = (docPath: string) => {
    const existing = notesByDoc.get(docPath)
    if (existing) return existing
    const created = createCoalescer<NotesRemapped>(
      (payload) => bridge.emit('notesRemapped', payload),
      scheduler
    )
    notesByDoc.set(docPath, created)
    return created
  }
  const dragMoves = createCoalescer<{ dragId: string; clientX: number; clientY: number }>(
    (moved) => bridge.emit('dragMoved', moved),
    scheduler
  )

  /* ---------------- resolving a target ---------------- */

  /** `undefined` on a command means "whichever editor is active" — see `EditorQuery`. */
  const resolve = (target?: EditorTarget | null): ResolvedEditor | null =>
    (target ? registry.resolve(target) : registry.active())

  /** Run a command against its target, silently doing nothing if it is gone. */
  const withEditor = <T extends { target?: EditorTarget }>(
    payload: T,
    body: (editor: unknown, resolved: ResolvedEditor) => void
  ) => {
    const resolved = resolve(payload.target)
    // Not an error. A command aimed at a pane the user just closed is ordinary, and a
    // shell cannot avoid the race — it decided to send before it could know.
    if (!resolved) return
    body(resolved.editor, resolved)
  }

  /* ---------------- command handlers ---------------- */

  const handle = <T extends CommandType>(
    type: T,
    handler: (payload: CommandPayload<T>) => void
  ) => {
    subscriptions.push(bridge.onCommand(type, handler))
  }

  handle('applyMark', (payload) => {
    withEditor(payload, (editor) => { commands.applyMark(editor, payload) })
  })
  handle('setColor', (payload) => {
    withEditor(payload, (editor) => { commands.setColor(editor, payload) })
  })
  handle('setHighlight', (payload) => {
    // The remembered color is updated whether or not an editor took the command: the
    // user chose it, and the context menu should offer it next time regardless.
    if (payload.remember) lastHighlightColor = payload.color
    withEditor(payload, (editor) => { commands.setHighlight(editor, payload) })
    publishToolbarState()
  })
  handle('setFontFamily', (payload) => {
    withEditor(payload, (editor) => { commands.setFontFamily(editor, payload) })
  })
  handle('setFontSize', (payload) => {
    withEditor(payload, (editor) => { commands.setFontSize(editor, payload) })
  })
  handle('setAlignment', (payload) => {
    withEditor(payload, (editor) => { commands.setAlignment(editor, payload) })
  })
  handle('insertTable', (payload) => {
    withEditor(payload, (editor) => { commands.insertTable(editor, payload) })
  })
  handle('insertConversationTile', (payload) => {
    withEditor(payload, (editor) => { commands.insertConversationTile(editor) })
  })
  handle('setSelection', (payload) => {
    withEditor(payload, (editor) => { commands.setSelection(editor, payload) })
  })
  handle('jumpToAnchor', (payload) => {
    withEditor(payload, (editor) => { commands.jumpToAnchor(editor, payload) })
  })
  handle('replaceRanges', (payload) => {
    withEditor(payload, (editor) => { commands.replaceRanges(editor, payload) })
  })
  handle('setCaretAtDocPos', (payload) => {
    withEditor(payload, (editor) => { commands.setCaretAtDocPos(editor, payload) })
  })
  handle('insertPlainText', (payload) => {
    withEditor(payload, (editor) => { commands.insertPlainText(editor, payload) })
  })

  /* Delegated: these change what the app is showing, which the surface does not own. */
  handle('openDocument', (payload) => delegates.openDocument?.(payload))
  handle('setContent', (payload) => delegates.setContent?.(payload))
  handle('syncNotes', (payload) => delegates.syncNotes?.(payload))
  handle('dictationPartial', (payload) => delegates.dictationPartial?.(payload))
  handle('dictationFinal', (payload) => delegates.dictationFinal?.(payload))
  handle('dictationLevel', (payload) => delegates.dictationLevel?.(payload))
  handle('dictationCancel', (payload) => delegates.dictationCancel?.(payload))
  handle('canvasCommand', (payload) => delegates.canvasCommand?.(payload))
  handle('canvasDropDoc', (payload) => delegates.canvasDropDoc?.(payload))
  handle('canvasDropNote', (payload) => delegates.canvasDropNote?.(payload))
  handle('canvasReveal', (payload) => delegates.canvasReveal?.(payload))
  handle('canvasRestore', (payload) => delegates.canvasRestore?.(payload))

  /* ---------------- request handlers ---------------- */

  subscriptions.push(bridge.onRequest('getToolbarState', ({ target }) => {
    const resolved = resolve(target)
    return readToolbarState(resolved?.editor, {
      target: resolved?.target ?? null,
      lastHighlightColor,
    })
  }))

  subscriptions.push(bridge.onRequest('getSelectionContext', ({ target }) => {
    const resolved = resolve(target)
    if (!resolved) return null
    return readSelectionContext(resolved.editor, {
      target: resolved.target,
      docPath: resolved.docPath,
      isCanvas: resolved.target === EditorTarget.CanvasCard,
    })
  }))

  subscriptions.push(bridge.onRequest('getDocumentText', ({ target }) => {
    const resolved = resolve(target)
    if (!resolved) return null
    const doc = (resolved.editor as { state: { doc: {
      content: { size: number }
      textBetween(from: number, to: number, sep?: string, leaf?: string): string
    } } }).state.doc
    return {
      docPath: resolved.docPath ?? '',
      text: doc.textBetween(0, doc.content.size, '\n', '\n'),
    }
  }))

  /* `getReadAloudPayload` has no handler here on purpose. Building it needs the read
     aloud chunker and the document's block structure, which `ReadAloudControl` owns;
     it registers its own handler while it is mounted. An unanswered request replies
     with an error rather than hanging — see `createSurfaceBridge`. */

  /* ---------------- publishers ---------------- */

  function publishToolbarState() {
    const resolved = registry.active()
    toolbar.push(readToolbarState(resolved?.editor, {
      target: resolved?.target ?? null,
      lastHighlightColor,
    }))
  }

  function publishSelectionContext(options: { docPath?: string | null; isCanvas?: boolean } = {}) {
    const resolved = registry.active()
    if (!resolved) return
    const context = readSelectionContext(resolved.editor, {
      target: resolved.target,
      docPath: options.docPath ?? resolved.docPath,
      isCanvas: options.isCanvas ?? resolved.target === EditorTarget.CanvasCard,
    })
    if (context) selection.push(context)
  }

  return {
    setDelegates(next) { delegates = next },
    onCommand: (type, handler) => bridge.onCommand(type, handler),
    lastHighlightColor: () => lastHighlightColor,

    publishToolbarState,
    publishSelectionContext,

    publishActiveEditor(info = {}) {
      const resolved = registry.active()
      bridge.emit('activeEditorChanged', {
        target: info.target ?? resolved?.target ?? undefined,
        docPath: info.docPath ?? resolved?.docPath ?? undefined,
        surfaceId: info.surfaceId ?? resolved?.surfaceId ?? undefined,
      })
      // The toolbar is about the active editor, so a new winner means a new answer.
      publishToolbarState()
    },

    publishDocChanged(payload) { bridge.emit('docChanged', payload) },

    publishNotesRemapped(payload) { notesCoalescer(payload.docPath).push(payload) },

    publishNoteMarker(kind, payload) {
      const type = kind === 'hover'
        ? 'noteMarkerHover'
        : kind === 'leave' ? 'noteMarkerLeave' : 'noteMarkerPin'
      bridge.emit(type, payload)
    },

    publishSearchMatches(payload) { bridge.emit('searchMatches', payload) },
    publishFocusModeView(payload) { bridge.emit('focusModeView', payload) },
    publishReadAloudPayload(payload) { bridge.emit('readAloudPayload', payload) },
    publishProjectChanged(payload) { bridge.emit('projectChanged', payload) },

    publishDragStarted() {
      const session = drag.current()
      if (!session) return
      const { claimed: _claimed, ...started } = session
      bridge.emit('dragStarted', started)
    },

    publishDragMoved(x, y) {
      const moved = drag.moveTo(x, y)
      if (moved) dragMoves.push(moved)
    },

    publishDragEnded(at) {
      // A pending move describes a drag that is over; sending it after the end would
      // put the two out of order for no benefit.
      dragMoves.cancel()
      const ended = drag.end(at)
      if (ended) bridge.emit('dragEnded', ended)
    },

    flush() {
      toolbar.flush()
      selection.flush()
      dragMoves.flush()
      for (const coalescer of notesByDoc.values()) coalescer.flush()
    },

    dispose() {
      toolbar.cancel()
      selection.cancel()
      dragMoves.cancel()
      for (const coalescer of notesByDoc.values()) coalescer.cancel()
      notesByDoc.clear()
      for (const unsubscribe of subscriptions) unsubscribe()
      subscriptions.length = 0
    },
  }
}

export type { Note }
