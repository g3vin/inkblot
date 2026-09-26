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
import { EditorTarget, Pane } from '../types'
import { countEditorWords } from '../lib/wordCount'
import type {
  ActiveEditorChanged,
  ArchiveChanged,
  BubbleChipsChanged,
  WordCountsChanged,
  BubbleSessionOpened,
  CanvasCommandRequest,
  CanvasDropDocCommand,
  CanvasDropNoteCommand,
  CanvasToolbarChanged,
  MapChromeChanged,
  AttachTimelineEventCommand,
  JumpToTimelinePassageCommand,
  RevealTimelineEventCommand,
  SetTimeLensCommand,
  SetTimelineRangeEditingCommand,
  TimelineChromeChanged,
  TimelineCommandRequest,
  TimelineCursorChanged,
  TimelineRangesChanged,
  MapCommandRequest,
  CanvasRestoreCommand,
  CanvasRevealCommand,
  DictationCancelCommand,
  DictationLevelCommand,
  DictationTranscript,
  DocChanged,
  FocusModeView,
  Note,
  NoteMarkerEvent,
  NoteMarkersChanged,
  NotePreviewDismissed,
  NotesRemapped,
  OpenDocumentCommand,
  PageLayoutCatalog,
  PageLayoutState,
  ReferenceSchema,
  ReferencesChanged,
  RevealReference,
  PrintJobStatus,
  PrintRequest,
  ClipboardChanged,
  NotesChanged,
  ProjectChanged,
  ShowSidebarTab,
  TilesChanged,
  VersionsChanged,
  ReadAloudPayloadEvent,
  SearchMatches,
  SelectionContext,
  SetContentCommand,
  SyncNotesCommand,
  TabsChanged,
  ToolbarState,
  ViewOptions,
} from '../types'
import type {
  CommandPayload,
  CommandType,
  RequestHandler,
  RequestType,
  SurfaceBridge,
  Unsubscribe,
} from './client'
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
  mapCommand?(command: MapCommandRequest): void
  timelineCommand?(command: TimelineCommandRequest): void
  /** The passage is already selected in `editor` (a document at `docPath`). */
  attachTimelineEvent?(command: AttachTimelineEventCommand, editor: unknown, docPath: string | null): void
  jumpToTimelinePassage?(command: JumpToTimelinePassageCommand): void
  revealTimelineEvent?(command: RevealTimelineEventCommand): void
  setTimeLens?(command: SetTimeLensCommand): void
  setTimelineRangeEditing?(command: SetTimelineRangeEditingCommand): void
}

export interface DocumentSurfaceOptions {
  bridge: SurfaceBridge
  registry: EditorRegistry
  delegates?: SurfaceDelegates
  /** Injected so a test can run without a frame loop. */
  scheduler?: Scheduler
  /**
   * When a window of edits is sent as one `docChanged`. Slower than a frame: each one
   * recounts the whole document, and the shell only needs it often enough to see
   * typing as typing. Injected for the same reason `scheduler` is.
   */
  docChangeScheduler?: Scheduler
  drag?: DragHandoff
}

/** How long `docChanged` gathers edits before it sends them. */
export const DOC_CHANGE_WINDOW_MS = 250

const docChangeTimer: Scheduler = (callback) => {
  const handle = setTimeout(callback, DOC_CHANGE_WINDOW_MS)
  return () => clearTimeout(handle)
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

  /**
   * Answer a request, for the component that owns the answer — `ReadAloudControl` and
   * `getReadAloudPayload`, which needs the read aloud module this file does not load.
   * One handler per request: a later registration replaces an earlier one, and
   * unsubscribing a replaced handler leaves its replacement in place.
   */
  onRequest<T extends RequestType>(type: T, handler: RequestHandler<T>): Unsubscribe

  /** The remembered highlight color. It is protocol state, not editor storage. */
  lastHighlightColor(): string

  /** Read the active editor and push a `toolbarState`. Coalesced to one per frame. */
  publishToolbarState(): void
  /** Read the active editor and push a `selectionContext`. Coalesced. */
  publishSelectionContext(options?: { docPath?: string | null; isCanvas?: boolean }): void
  /** The canvas's own controls, or none while they are not up. Coalesced per frame. */
  publishCanvasToolbar(payload: CanvasToolbarChanged): void
  /** The active map's toolbar and inspector, or none. Coalesced per frame. */
  publishMapChrome(payload: MapChromeChanged): void
  /** The active timeline view's toolbar and inspector, or none. Coalesced per frame. */
  publishTimelineChrome(payload: TimelineChromeChanged): void
  /** A document's timeline passages. Coalesced per document. */
  publishTimelineRanges(payload: TimelineRangesChanged): void
  /** The time lens's and passage handles' switches. Not coalesced: rare. */
  publishTimelineCursor(payload: TimelineCursorChanged): void
  /** Push the election result. Not coalesced — it is rare and ordering matters. */
  publishActiveEditor(info?: Partial<ActiveEditorChanged>): void
  publishDocChanged(payload: DocChanged): void
  /**
   * An editor's transaction changed its document. Called by `DocChangeReporter` for
   * every editor; one that is not registered is ignored. Edits are summed per editor
   * and sent as one `docChanged` per window, except a paste, which is sent on its own.
   */
  noteDocTransaction(editor: unknown, transaction: unknown): void
  /** Push a whole remapped note set. Coalesced per document. */
  publishNotesRemapped(payload: NotesRemapped): void
  publishNoteMarker(kind: 'hover' | 'leave' | 'pin', payload: NoteMarkerEvent): void
  publishSearchMatches(payload: SearchMatches): void
  publishFocusModeView(payload: FocusModeView): void
  /**
   * The page's view settings a native toolbar offers as toggles. Each is owned by a
   * different component — focus mode by `EditorLayout`, the word count by `App` — so
   * each publishes only its own; the surface keeps the rest and sends the whole.
   */
  publishViewOptions(patch: Partial<ViewOptions>): void
  publishReadAloudPayload(payload: ReadAloudPayloadEvent): void
  /** Which project is open. Not coalesced — it changes when the user picks one. */
  publishProjectChanged(payload: ProjectChanged): void
  /**
   * The right sidebar's state, for a shell that draws the sidebar itself. Notes, the
   * clipboard and tiles each carry the whole list, which is what makes coalescing
   * them to one per frame safe (see `coalesce.ts`) — a keystroke in a note would otherwise
   * be a message per keystroke.
   */
  publishNotesChanged(payload: NotesChanged): void
  publishClipboardChanged(payload: ClipboardChanged): void
  publishTilesChanged(payload: TilesChanged): void
  publishVersionsChanged(payload: VersionsChanged): void
  publishShowSidebarTab(payload: ShowSidebarTab): void
  /** An open preview's marker moved. Coalesced — each carries the whole rect. */
  publishNoteMarkerMoved(payload: NoteMarkerEvent): void
  publishNotePreviewDismissed(payload: NotePreviewDismissed): void
  /** Every visible note marker, for a shell that draws the dots. Coalesced per frame. */
  publishNoteMarkersChanged(payload: NoteMarkersChanged): void
  /** Open the bubble editor, for a shell that draws it. Not coalesced — one per open. */
  publishBubbleSessionOpened(payload: BubbleSessionOpened): void
  /** Every visible session chip, for a shell that draws them. Coalesced per frame. */
  publishBubbleChipsChanged(payload: BubbleChipsChanged): void
  /** A document's archive, whole. */
  publishArchiveChanged(payload: ArchiveChanged): void
  /** Every visible word-count badge, for a shell that draws them. Coalesced per frame. */
  publishWordCountsChanged(payload: WordCountsChanged): void
  /** Print Layout's state, for the inspector's Page tab. Coalesced — each carries it all. */
  publishPageLayoutState(payload: PageLayoutState): void
  /** Ask the shell to print the web view at a paper size. Not coalesced: each is a job. */
  publishPrintRequest(payload: PrintRequest): void
  /** The Finishing tabs' fixed lists — sizes, formats, tokens — once. */
  publishPageLayoutCatalog(payload: PageLayoutCatalog): void
  /** Where a print or export has got to. Not coalesced: the last of a job must arrive. */
  publishPrintJobStatus(payload: PrintJobStatus): void
  /** The project's sources for the document in view. Coalesced — each carries them all. */
  publishReferencesChanged(payload: ReferencesChanged): void
  /** The kinds of source and the styles, once. */
  publishReferenceSchema(payload: ReferenceSchema): void
  /** Show a source in the References panel. */
  publishRevealReference(payload: RevealReference): void

  /** The tabs and the split, whole. Coalesced — a tab switch changes several fields at once. */
  publishTabsChanged(payload: TabsChanged): void

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
  docChangeScheduler = docChangeTimer,
  drag = dragHandoff,
}: DocumentSurfaceOptions): DocumentSurface {
  let delegates = initialDelegates
  let lastHighlightColor: string = TOOLBAR_DEFAULTS.highlight
  let viewOptions: ViewOptions = { focusMode: false, wordCountVisible: true }
  const subscriptions: Unsubscribe[] = []

  /* ---------------- docChanged ---------------- */

  // Not a coalescer: `inserted`/`deleted` are deltas, and a coalescer keeps only the
  // last value (see `coalesce.ts`). This sums instead, per editor — two panes edited in
  // one window are two documents.
  interface PendingDocChange {
    editor: unknown
    pane: Pane
    docPath: string
    inserted: number
    deleted: number
    paste: boolean
    userEdit: boolean
    cancel: (() => void) | null
  }
  const pendingDocChanges = new Map<EditorTarget, PendingDocChange>()

  const sendDocChange = (target: EditorTarget) => {
    const pending = pendingDocChanges.get(target)
    if (!pending) return
    pendingDocChanges.delete(target)
    pending.cancel?.()
    const editor = pending.editor as { isDestroyed?: boolean; getText(): string; state: { doc: { textContent: string } } }
    if (editor.isDestroyed) return
    bridge.emit('docChanged', {
      pane: pending.pane,
      docPath: pending.docPath,
      userEdit: pending.userEdit,
      wordCount: countEditorWords(editor),
      charCount: editor.state.doc.textContent.length,
      inserted: pending.inserted,
      deleted: pending.deleted,
      paste: pending.paste,
    })
  }

  const targetOf = (editor: unknown) => {
    for (const target of [EditorTarget.Primary, EditorTarget.Secondary, EditorTarget.CanvasCard]) {
      const resolved = registry.resolve(target)
      if (resolved?.editor === editor) return resolved
    }
    return null
  }

  const noteDocTransaction = (editor: unknown, transaction: unknown) => {
    const resolved = targetOf(editor)
    if (!resolved?.docPath) return
    const tr = transaction as {
      getMeta(key: string): unknown
      mapping: { maps: { forEach(f: (oldStart: number, oldEnd: number, newStart: number, newEnd: number) => void): void }[] }
    }
    let inserted = 0
    let deleted = 0
    for (const map of tr.mapping.maps) {
      map.forEach((oldStart, oldEnd, newStart, newEnd) => {
        deleted += oldEnd - oldStart
        inserted += newEnd - newStart
      })
    }
    const uiEvent = tr.getMeta('uiEvent')
    const paste = tr.getMeta('paste') === true || uiEvent === 'paste' || uiEvent === 'drop'
    // A plugin's own bookkeeping (ids, normalisation) opts out of history; it is the
    // document changing, but it is not the writer.
    const userEdit = tr.getMeta('addToHistory') !== false

    const target = resolved.target
    const existing = pendingDocChanges.get(target)
    // A different document in the same editor, or a paste: whatever was gathering is
    // about something else, so it goes first.
    if (existing && (existing.docPath !== resolved.docPath || existing.editor !== editor || paste)) {
      sendDocChange(target)
    }

    // A canvas card has no pane of its own; its document is the canvas.
    const pane = target === EditorTarget.Secondary ? Pane.Secondary : Pane.Primary
    const pending = pendingDocChanges.get(target) ?? {
      editor, pane, docPath: resolved.docPath, inserted: 0, deleted: 0,
      paste: false, userEdit: false, cancel: null,
    }
    pending.inserted += inserted
    pending.deleted += deleted
    pending.userEdit ||= userEdit
    pendingDocChanges.set(target, pending)

    if (paste) {
      pending.paste = true
      sendDocChange(target)
      return
    }
    if (!pending.cancel) {
      let ran = false
      const cancel = docChangeScheduler(() => { ran = true; sendDocChange(target) })
      // A synchronous scheduler has sent it already; see `createCoalescer` for why the
      // canceller must not be kept then.
      if (!ran) pending.cancel = cancel
    }
  }

  /* ---------------- coalesced publishers ---------------- */

  const toolbar = createCoalescer<ToolbarState>(
    (state) => bridge.emit('toolbarState', state),
    scheduler
  )
  const canvasToolbar = createCoalescer<CanvasToolbarChanged>(
    (payload) => bridge.emit('canvasToolbarChanged', payload),
    scheduler
  )
  const mapChrome = createCoalescer<MapChromeChanged>(
    (payload) => bridge.emit('mapChromeChanged', payload),
    scheduler
  )
  const timelineChrome = createCoalescer<TimelineChromeChanged>(
    (payload) => bridge.emit('timelineChromeChanged', payload),
    scheduler
  )
  // Keyed by document, as notes are: two panes map their passages independently.
  const timelineRangesByDoc = new Map<string, ReturnType<typeof createCoalescer<TimelineRangesChanged>>>()
  const timelineRangesCoalescer = (docPath: string) => {
    let coalescer = timelineRangesByDoc.get(docPath)
    if (!coalescer) {
      coalescer = createCoalescer<TimelineRangesChanged>((payload) => bridge.emit('timelineRangesChanged', payload), scheduler)
      timelineRangesByDoc.set(docPath, coalescer)
    }
    return coalescer
  }
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
  const notesChangedByDoc = new Map<string, ReturnType<typeof createCoalescer<NotesChanged>>>()
  const notesChangedFor = (docPath: string) => {
    const existing = notesChangedByDoc.get(docPath)
    if (existing) return existing
    const created = createCoalescer<NotesChanged>((payload) => bridge.emit('notesChanged', payload), scheduler)
    notesChangedByDoc.set(docPath, created)
    return created
  }
  const clipboardChanges = createCoalescer<ClipboardChanged>(
    (payload) => bridge.emit('clipboardChanged', payload),
    scheduler
  )
  const tileChanges = createCoalescer<TilesChanged>(
    (payload) => bridge.emit('tilesChanged', payload),
    scheduler
  )
  const markerMoves = createCoalescer<NoteMarkerEvent>(
    (payload) => bridge.emit('noteMarkerMoved', payload),
    scheduler
  )
  const markerLists = createCoalescer<NoteMarkersChanged>(
    (payload) => bridge.emit('noteMarkersChanged', payload),
    scheduler
  )
  const chipLists = createCoalescer<BubbleChipsChanged>(
    (payload) => bridge.emit('bubbleChipsChanged', payload),
    scheduler
  )
  const wordCountLists = createCoalescer<WordCountsChanged>(
    (payload) => bridge.emit('wordCountsChanged', payload),
    scheduler
  )
  const pageLayoutChanges = createCoalescer<PageLayoutState>(
    (payload) => bridge.emit('pageLayoutState', payload),
    scheduler
  )
  const referenceLists = createCoalescer<ReferencesChanged>(
    (payload) => bridge.emit('referencesChanged', payload),
    scheduler
  )
  const tabChanges = createCoalescer<TabsChanged>(
    (payload) => bridge.emit('tabsChanged', payload),
    scheduler
  )
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
  handle('setBlockType', (payload) => {
    withEditor(payload, (editor) => { commands.setBlockType(editor, payload) })
  })
  handle('setWritingFormat', (payload) => {
    withEditor(payload, (editor) => { commands.setWritingFormat(editor, payload) })
  })
  handle('toggleList', (payload) => {
    withEditor(payload, (editor) => { commands.toggleList(editor, payload) })
  })
  handle('editorHistory', (payload) => {
    withEditor(payload, (editor) => { commands.editorHistory(editor, payload) })
  })
  handle('insertConversationTile', (payload) => {
    withEditor(payload, (editor) => { commands.insertConversationTile(editor) })
  })
  handle('insertCitation', (payload) => {
    withEditor(payload, (editor) => { commands.insertCitation(editor, payload) })
  })
  handle('insertBibliography', (payload) => {
    withEditor(payload, (editor) => { commands.insertBibliography(editor) })
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
  handle('mapCommand', (payload) => delegates.mapCommand?.(payload))
  handle('timelineCommand', (payload) => delegates.timelineCommand?.(payload))
  // The passage is put in the selection first, from its anchor, so attaching reads the
  // text the shell meant even if positions moved on the way.
  handle('attachTimelineEvent', (payload) => {
    withEditor(payload, (editor, resolved) => {
      if (!commands.setSelection(editor, { target: payload.target, anchor: payload.anchor, scrollIntoView: false, focus: false })) return
      delegates.attachTimelineEvent?.(payload, editor, resolved.docPath)
    })
  })
  handle('jumpToTimelinePassage', (payload) => delegates.jumpToTimelinePassage?.(payload))
  handle('revealTimelineEvent', (payload) => delegates.revealTimelineEvent?.(payload))
  handle('setTimeLens', (payload) => delegates.setTimeLens?.(payload))
  handle('setTimelineRangeEditing', (payload) => delegates.setTimelineRangeEditing?.(payload))

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
     aloud module, which loads Kokoro and which `ReadAloudControl` already owns; it
     registers the handler through `onRequest` while it is mounted. When it is not, the
     request replies with an error rather than hanging — see `createSurfaceBridge`. */

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
    onRequest(type, handler) {
      const unsubscribe = bridge.onRequest(type, handler)
      subscriptions.push(unsubscribe)
      return unsubscribe
    },
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

    publishCanvasToolbar(payload) { canvasToolbar.push(payload) },
    publishMapChrome(payload) { mapChrome.push(payload) },
    publishTimelineChrome(payload) { timelineChrome.push(payload) },
    publishTimelineRanges(payload) { timelineRangesCoalescer(payload.docPath).push(payload) },
    publishTimelineCursor(payload) { bridge.emit('timelineCursorChanged', payload) },

    publishDocChanged(payload) { bridge.emit('docChanged', payload) },
    noteDocTransaction,

    publishNotesRemapped(payload) { notesCoalescer(payload.docPath).push(payload) },

    publishNoteMarker(kind, payload) {
      const type = kind === 'hover'
        ? 'noteMarkerHover'
        : kind === 'leave' ? 'noteMarkerLeave' : 'noteMarkerPin'
      bridge.emit(type, payload)
    },

    publishSearchMatches(payload) { bridge.emit('searchMatches', payload) },
    publishFocusModeView(payload) { bridge.emit('focusModeView', payload) },
    publishViewOptions(patch) {
      viewOptions = { ...viewOptions, ...patch }
      bridge.emit('viewOptions', viewOptions)
    },
    publishReadAloudPayload(payload) { bridge.emit('readAloudPayload', payload) },
    publishProjectChanged(payload) { bridge.emit('projectChanged', payload) },
    publishNotesChanged(payload) { notesChangedFor(payload.docPath).push(payload) },
    publishClipboardChanged(payload) { clipboardChanges.push(payload) },
    publishTilesChanged(payload) { tileChanges.push(payload) },
    publishVersionsChanged(payload) { bridge.emit('versionsChanged', payload) },
    publishShowSidebarTab(payload) { bridge.emit('showSidebarTab', payload) },
    publishNoteMarkerMoved(payload) { markerMoves.push(payload) },
    publishNoteMarkersChanged(payload) { markerLists.push(payload) },
    publishBubbleSessionOpened(payload) { bridge.emit('bubbleSessionOpened', payload) },
    publishBubbleChipsChanged(payload) { chipLists.push(payload) },
    publishArchiveChanged(payload) { bridge.emit('archiveChanged', payload) },
    publishWordCountsChanged(payload) { wordCountLists.push(payload) },
    publishPageLayoutState(payload) { pageLayoutChanges.push(payload) },
    publishTabsChanged(payload) { tabChanges.push(payload) },
    publishPrintRequest(payload) { bridge.emit('printRequest', payload) },
    publishPageLayoutCatalog(payload) { bridge.emit('pageLayoutCatalog', payload) },
    publishPrintJobStatus(payload) { bridge.emit('printJobStatus', payload) },
    publishReferencesChanged(payload) { referenceLists.push(payload) },
    publishReferenceSchema(payload) { bridge.emit('referenceSchema', payload) },
    publishRevealReference(payload) { bridge.emit('revealReference', payload) },
    publishNotePreviewDismissed(payload) {
      // A move queued for a preview that is closing would reopen nothing, but it would
      // arrive after the dismissal and be one message the shell has to reason about.
      markerMoves.cancel()
      referenceLists.cancel()
      bridge.emit('notePreviewDismissed', payload)
    },

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
      for (const target of [...pendingDocChanges.keys()]) sendDocChange(target)
      toolbar.flush()
      canvasToolbar.flush()
      mapChrome.flush()
      timelineChrome.flush()
      for (const coalescer of timelineRangesByDoc.values()) coalescer.flush()
      selection.flush()
      dragMoves.flush()
      clipboardChanges.flush()
      tileChanges.flush()
      markerMoves.flush()
      markerLists.flush()
      chipLists.flush()
      wordCountLists.flush()
      pageLayoutChanges.flush()
      tabChanges.flush()
      referenceLists.flush()
      for (const coalescer of notesByDoc.values()) coalescer.flush()
      for (const coalescer of notesChangedByDoc.values()) coalescer.flush()
    },

    dispose() {
      for (const pending of pendingDocChanges.values()) pending.cancel?.()
      pendingDocChanges.clear()
      toolbar.cancel()
      canvasToolbar.cancel()
      mapChrome.cancel()
      timelineChrome.cancel()
      for (const coalescer of timelineRangesByDoc.values()) coalescer.cancel()
      timelineRangesByDoc.clear()
      selection.cancel()
      dragMoves.cancel()
      clipboardChanges.cancel()
      tileChanges.cancel()
      markerMoves.cancel()
      markerLists.cancel()
      chipLists.cancel()
      wordCountLists.cancel()
      pageLayoutChanges.cancel()
      tabChanges.cancel()
      for (const coalescer of notesByDoc.values()) coalescer.cancel()
      for (const coalescer of notesChangedByDoc.values()) coalescer.cancel()
      notesByDoc.clear()
      notesChangedByDoc.clear()
      for (const unsubscribe of subscriptions) unsubscribe()
      subscriptions.length = 0
    },
  }
}

export type { Note }
