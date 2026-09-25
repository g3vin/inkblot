#if os(macOS)
import AppKit
#endif
import Foundation
import Observation

/// Everything one window is made of, created once.
///
/// One main window. The page holds per-window state (the open project, its panes
/// and tabs) and a second `WindowGroup` instance would be a second page over the same
/// files with no coordination between them — two autosaves racing on one document.
/// `InkblotApp` uses a single scene for exactly that reason (detached documents are
/// separate windows with their own page; see `AuxiliaryWindows`).
@MainActor
@Observable
final class AppModel {
    let core: CoreService
    let bridge: ShellBridge
    let menus: WebMenus
    let tree: ProjectTree
    let picker: ProjectPicker
    let sidebar: SidebarModel
    let notePreviews: NotePreviewModel
    let bubble: BubbleModel
    let pageLayout: PageLayoutModel
    let statsService: StatsService
    let stats: StatsTracker
    let timer: WritingTimer
    let timerAnnouncer = TimerAnnouncer()
    let goals: GoalsModel
    /// Sprint mode has the file tree hidden; `ContentView` follows.
    var sprintHidesFileTree = false
    /// What sprint mode changed, to put back when the writing segment ends.
    @ObservationIgnored private var sprintRestore: (inspector: Bool, focusMode: Bool)?
    let memoRecorder = AudioMemoRecorder()
    let memoPlayer = AudioMemoPlayer()
    let language = LanguageServices()
    /// The vertical centre of the file tree's bottom bar (the + and the filter), in
    /// window coordinates — so the word-count badges can sit level with it.
    var sidebarBarMidY: CGFloat?
    @ObservationIgnored private(set) lazy var web = EditorWebController(bridge: bridge, menus: menus, core: core)

    init() {
        core = CoreService.shared
        bridge = ShellBridge()
        menus = WebMenus()
        tree = ProjectTree(core: core)
        picker = ProjectPicker(core: core)
        sidebar = SidebarModel(bridge: bridge, core: core)
        notePreviews = NotePreviewModel(bridge: bridge)
        bubble = BubbleModel(bridge: bridge)
        pageLayout = PageLayoutModel(bridge: bridge)
        let statsService = StatsService(core: core.core)
        self.statsService = statsService
        let stats = StatsTracker(
            config: statsService.loadConfig(),
            environment: .live(record: statsService.record))
        self.stats = stats
        let bridge = bridge
        let announcer = timerAnnouncer
        let goals = GoalsModel(service: statsService, stats: stats, notifier: announcer)
        self.goals = goals
        timer = WritingTimer(environment: WritingTimer.Environment(
            wordsWritten: { [weak stats] in stats?.wordsWritten ?? 0 },
            project: { [weak bridge] in bridge?.project.projectName },
            record: { [weak goals] run in
                statsService.record(run)
                goals?.refresh()
            },
            announce: { [weak stats, weak announcer] announcement in
                guard let stats else { return }
                announcer?.announce(announcement, notify: stats.config.timerNotifications, sound: stats.config.timerSounds)
            },
            track: { [weak stats] runID, paused in
                stats?.timerRunId = runID
                stats?.isPaused = paused
            }))
        stats.onRecord = { [weak goals] in goals?.refresh() }
        stats.onTick = { [weak goals] in goals?.check() }

        bridge.addListener { [weak self] event in
            guard let self else { return }
            switch event {
            case .projectChanged(let project):
                tree.follow(project)
                stats.follow(project: project.projectName)
                deliverPendingProject(after: project)
            case .activeEditorChanged(let changed):
                if let docPath = changed.docPath { tree.noteOpened(docPath) }
                stats.elect(docPath: changed.docPath)
            case .printRequest(let request):
                // The page has laid the sheets out; print the web view at their size,
                // and tell it when it can take them down.
                web.print(request) { [weak self] completed in
                    self?.bridge.send(.printFinished(PrintFinishedCommand(jobId: request.jobId, completed: completed)))
                }
            case .docChanged(let changed):
                stats.edit(changed)
                // A document the tree has not seen — made by the page, most likely. The
                // watcher will catch it too; this just does not wait for the latency.
                if !tree.filePaths.contains(changed.docPath) { tree.reload() }
            default:
                break
            }
        }
        stats.start()
        timerAnnouncer.install()
        timerAnnouncer.onProceed = { [weak self] in self?.timer.proceed() }
        timer.onSegmentChanged = { [weak self] segment in self?.sprintSegmentChanged(segment) }
        timerAnnouncer.onStartSprint = { [weak self] in
            guard let self else { return }
            startTimer(defaultRoutine)
        }
        goals.refresh()
        timerAnnouncer.onOpen = { [weak self] in
            #if os(macOS)
            NSApp.activate()
            #endif
            self?.showStats()
        }
        watchTreeForBook()
    }

    /* ---------------- the book's chapters ---------------- */

    /// The documents in tree order, as last told to the page.
    @ObservationIgnored private var bookTreeSignature: [String] = []

    /// A book is its folder's documents in tree order, so the Book tab's chapters change
    /// when the tree does — a document added, removed, renamed or dragged. The tree is
    /// reloaded on every write (autosave included), so the page is asked to list the
    /// chapters again only when the order of the documents has actually changed.
    private func watchTreeForBook() {
        withObservationTracking {
            _ = tree.root
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in
                guard let self else { return }
                let signature = Self.orderedFilePaths(tree.root)
                if signature != bookTreeSignature {
                    bookTreeSignature = signature
                    pageLayout.refreshChapters()
                }
                watchTreeForBook()
            }
        }
    }

    private static func orderedFilePaths(_ root: TreeNode?) -> [String] {
        var paths: [String] = []
        func walk(_ node: TreeNode) {
            if node.type == .file { paths.append(node.path) }
            node.children?.forEach(walk)
        }
        root.map(walk)
        return paths
    }

    /* ---------------- writing stats ---------------- */

    /// A rename or a move the shell is asking the page for: the entry's writing history
    /// goes with it. The session in progress is about the old path, so it ends first.
    func statsFollowRename(of path: String, to name: String, isFolder: Bool) {
        guard let project = bridge.project.projectName else { return }
        stats.endSession()
        statsService.renameEntry(project: project, path: path, newName: name, isFolder: isFolder)
    }

    func statsFollowMove(of path: String, into folder: String, isFolder: Bool) {
        guard let project = bridge.project.projectName else { return }
        stats.endSession()
        statsService.moveEntry(project: project, path: path, into: folder, isFolder: isFolder)
    }

    /// Run a routine, and remember it as the one Start runs next time.
    func startTimer(_ routine: WritingRoutine) {
        if stats.config.timerNotifications { timerAnnouncer.requestPermission() }
        stats.config.lastRoutineID = routine.id
        saveStatsConfig()
        timer.start(routine)
    }

    /// Keep the stats settings, and let what depends on them — goals, the streak,
    /// reminders, deadlines — see the change.
    func saveStatsConfig() {
        statsService.save(stats.config)
        goals.refresh()
    }

    /// Sprint mode: a writing segment clears the screen — the page's focus mode, the
    /// file tree and the inspector away — and the end of it puts back what was there.
    func sprintSegmentChanged(_ segment: TimerSegment?) {
        let writing = segment?.kind == .write
        if writing, stats.config.sprintFocus, sprintRestore == nil {
            sprintRestore = (sidebar.isPresented, bridge.viewOptions.focusMode)
            if !bridge.viewOptions.focusMode { bridge.send(.setFocusMode(SetFocusModeCommand(open: true))) }
            sidebar.isPresented = false
            sprintHidesFileTree = true
        } else if !writing, let restore = sprintRestore {
            sprintRestore = nil
            if !restore.focusMode, bridge.viewOptions.focusMode { bridge.send(.setFocusMode(SetFocusModeCommand(open: false))) }
            sidebar.isPresented = restore.inspector
            sprintHidesFileTree = false
        }
    }

    /// The routine Start runs: the last one run, or a sprint.
    var defaultRoutine: WritingRoutine {
        stats.config.routine(stats.config.lastRoutineID) ?? .sprint
    }

    /// The Stats tab, from a notification or the Timer menu.
    func showStats() {
        sidebar.isPresented = true
        sidebar.tab = .stats
    }

    /* ---------------- opening a project ---------------- */

    /// A project the picker chose that the page has not yet said it opened.
    @ObservationIgnored private var pendingProject: String?

    /// Open a project in the page.
    ///
    /// The page does not queue commands it has no handler for yet, and the picker runs
    /// before the page exists: the editor window, and so the page, only open once a
    /// project is chosen, and a page that is still loading drops the command. So it is
    /// kept until the page reports the project open, and sent again when a page reports
    /// that it has started with nothing open — its first `projectChanged` comes from the
    /// same commit that subscribes to `openProject`.
    func openProject(_ name: String) {
        guard bridge.project.projectName != name else { return }
        pendingProject = name
        bridge.send(.openProject(OpenProjectCommand(projectName: name)))
    }

    private func deliverPendingProject(after project: ProjectChanged) {
        guard let pendingProject else { return }
        if project.projectName == pendingProject {
            self.pendingProject = nil
        } else if project.projectName == nil {
            bridge.send(.openProject(OpenProjectCommand(projectName: pendingProject)))
        }
    }

    /// Give the keyboard back to the document — after a citation is inserted from the
    /// References panel, the writer carries on typing where it went.
    func focusDocument() {
        #if os(macOS)
        web.webView.window?.makeFirstResponder(web.webView)
        #endif
    }

    /* ---------------- what the menu bar does ---------------- */

    /// The editor a menu command is for: the one the page elected, as the page's own
    /// toolbar would target.
    var target: EditorTarget? {
        bridge.toolbar?.target ?? bridge.activeEditor?.target
    }

    func toggle(_ mark: MarkKind) {
        guard let target else { return }
        bridge.send(.applyMark(ApplyMarkCommand(target: target, mark: mark)))
    }

    func align(_ alignment: Alignment) {
        guard let target else { return }
        bridge.send(.setAlignment(SetAlignmentCommand(target: target, alignment: alignment)))
    }

    /// File ▸ Page Setup…: the inspector's Page tab.
    func showPageSetup() {
        sidebar.isPresented = true
        sidebar.tab = .page
    }

    /// File ▸ Book Settings…: the Finishing layout's Book tab.
    func showBook() {
        sidebar.isPresented = true
        sidebar.tab = .book
    }

    /// File ▸ Publish…: the Finishing layout's Publish tab.
    func showPublish() {
        sidebar.isPresented = true
        sidebar.tab = .publish
    }

    /// Edit ▸ Paste and Match Style. The pasteboard is read here, not in the page —
    /// see `InsertPlainTextCommand` for why it has to be.
    func pasteAndMatchStyle() {
        guard let target, let text = Platform.pastedText, !text.isEmpty else {
            Platform.beep()
            return
        }
        bridge.send(.insertPlainText(InsertPlainTextCommand(target: target, text: text)))
    }
}
