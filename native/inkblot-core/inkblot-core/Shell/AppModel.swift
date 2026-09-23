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
    let sidebar: SidebarModel
    let notePreviews: NotePreviewModel
    let workspace: WorkspaceModel
    let memoRecorder = AudioMemoRecorder()
    let memoPlayer = AudioMemoPlayer()
    let language = LanguageServices()
    @ObservationIgnored private(set) lazy var web = EditorWebController(bridge: bridge, menus: menus, core: core)

    init() {
        core = CoreService.shared
        bridge = ShellBridge()
        menus = WebMenus()
        tree = ProjectTree(core: core)
        sidebar = SidebarModel(bridge: bridge, core: core)
        notePreviews = NotePreviewModel(bridge: bridge)
        workspace = WorkspaceModel(bridge: bridge)

        bridge.addListener { [weak self] event in
            guard let self else { return }
            switch event {
            case .projectChanged(let project):
                tree.follow(project)
            case .docChanged(let changed) where !tree.filePaths.contains(changed.docPath):
                // A document the tree has not seen — made by the page, most likely. The
                // watcher will catch it too; this just does not wait for the latency.
                tree.reload()
            default:
                break
            }
        }
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
