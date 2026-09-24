import AppKit
import Observation

/// Everything one window is made of, created once.
///
/// One window for now. The page holds per-window state (the open project, its panes
/// and tabs) and a second `WindowGroup` instance would be a second page over the same
/// files with no coordination between them — two autosaves racing on one document.
/// `InkblotApp` uses a single `Window` scene for exactly that reason.
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

        bridge.addListener { [weak self] event in
            guard let self else { return }
            switch event {
            case .projectChanged(let project):
                tree.follow(project)
                deliverPendingProject(after: project)
            case .activeEditorChanged(let changed):
                if let docPath = changed.docPath { tree.noteOpened(docPath) }
            case .printRequest(let request):
                // The page has laid the sheets out; print the web view at their size,
                // and tell it when it can take them down.
                web.print(request) { [weak self] completed in
                    self?.bridge.send(.printFinished(PrintFinishedCommand(jobId: request.jobId, completed: completed)))
                }
            case .docChanged(let changed) where !tree.filePaths.contains(changed.docPath):
                // A document the tree has not seen — made by the page, most likely. The
                // watcher will catch it too; this just does not wait for the latency.
                tree.reload()
            default:
                break
            }
        }
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
        web.webView.window?.makeFirstResponder(web.webView)
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

    /// Edit ▸ Paste and Match Style. The pasteboard is read here, not in the page —
    /// see `InsertPlainTextCommand` for why it has to be.
    func pasteAndMatchStyle() {
        guard let target, let text = NSPasteboard.general.string(forType: .string), !text.isEmpty else {
            NSSound.beep()
            return
        }
        bridge.send(.insertPlainText(InsertPlainTextCommand(target: target, text: text)))
    }
}
