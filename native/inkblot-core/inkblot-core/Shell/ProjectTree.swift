#if os(macOS)
import CoreServices
#endif
import Foundation
import Observation

/// The open project's tree, kept current.
///
/// The page writes the tree — every autosave, every canvas card dropped into a
/// folder, everything the page's own code creates — and it does not say so over the
/// bridge. So the tree is re-read from disk whenever the disk changes, which also
/// catches a project moved in the Finder or synced down from iCloud. The core reads
/// the tree (`list_project_tree`), so the rules about what is shown — dotfiles and
/// the order file hidden — are the same ones the page's tree applies.
@MainActor
@Observable
final class ProjectTree {
    private(set) var projectName: String?
    private(set) var projectRoot: String?
    private(set) var root: TreeNode?
    private(set) var loadError: String?

    @ObservationIgnored private let core: CoreService
    @ObservationIgnored private var watcher: DirectoryWatcher?

    init(core: CoreService) {
        self.core = core
    }

    /// Follow the project the page says is open.
    func follow(_ project: ProjectChanged) {
        guard project.projectName != projectName || project.projectRoot != projectRoot else { return }
        projectName = project.projectName
        projectRoot = project.projectRoot ?? project.projectName.map { core.core.projectRoot(projectName: $0) }

        watcher = projectRoot.flatMap { root in
            DirectoryWatcher(path: root) { [weak self] in self?.reload() }
        }
        reload()
    }

    func reload() {
        guard let projectName else {
            root = nil
            loadError = nil
            return
        }
        do {
            root = try core.projectTree(projectName)
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    /// Every file path in tree order — what "is this name taken" is checked against.
    var filePaths: Set<String> {
        var paths = Set<String>()
        func walk(_ node: TreeNode) {
            if node.type == .file { paths.insert(node.path) }
            node.children?.forEach(walk)
        }
        root.map(walk)
        return paths
    }
}

extension TreeNode {
    /// `OutlineGroup` wants leaves to have `nil` children, and a folder always has a
    /// list — possibly empty, which still draws a disclosure triangle, and should.
    var outlineChildren: [TreeNode]? { type == .folder ? (children ?? []) : nil }
}

extension Notification.Name {
    /// A path under the app's control changed on disk: `TauriHost` posts it after each
    /// write, rename, removal or copy it performs for the page, with the path as the
    /// object. On iOS it is how the tree hears about changes at all (no FSEvents).
    static let inkblotFileChanged = Notification.Name("inkblotFileChanged")
}

#if !os(macOS)
/// The iOS watcher. There are no FSEvents, and in the sandbox nothing but this app
/// changes a project — and everything this app changes goes through `TauriHost`. So
/// its announcements are the change feed, coalesced the same way FSEvents' are.
@MainActor
final class DirectoryWatcher {
    private var observer: NSObjectProtocol?
    private var pending: Task<Void, Never>?

    init?(path: String, latency: CFTimeInterval = 0.3, onChange: @escaping () -> Void) {
        let root = URL(fileURLWithPath: path).standardizedFileURL.path
        observer = NotificationCenter.default.addObserver(
            forName: .inkblotFileChanged, object: nil, queue: .main
        ) { [weak self] note in
            guard let changed = note.object as? String,
                  URL(fileURLWithPath: changed).standardizedFileURL.path.hasPrefix(root)
            else { return }
            MainActor.assumeIsolated {
                self?.pending?.cancel()
                self?.pending = Task {
                    try? await Task.sleep(for: .seconds(latency))
                    if !Task.isCancelled { onChange() }
                }
            }
        }
    }

    isolated deinit {
        pending?.cancel()
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }
}
#else
/// FSEvents on one directory tree, coalesced to one callback per burst.
///
/// An autosave is a temp-file write and a rename, and a canvas save touches its
/// sidecar too; without the latency window each save would re-read the tree three
/// times.
@MainActor
final class DirectoryWatcher {
    private var stream: FSEventStreamRef?
    private let onChange: () -> Void

    init?(path: String, latency: CFTimeInterval = 0.3, onChange: @escaping () -> Void) {
        self.onChange = onChange

        var context = FSEventStreamContext(
            version: 0,
            info: Unmanaged.passUnretained(self).toOpaque(),
            retain: nil, release: nil, copyDescription: nil)

        let callback: FSEventStreamCallback = { _, info, _, _, _, _ in
            guard let info else { return }
            let watcher = Unmanaged<DirectoryWatcher>.fromOpaque(info).takeUnretainedValue()
            // The stream is scheduled on the main queue, below.
            MainActor.assumeIsolated { watcher.onChange() }
        }

        guard let stream = FSEventStreamCreate(
            kCFAllocatorDefault, callback, &context, [path] as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow), latency,
            FSEventStreamCreateFlags(kFSEventStreamCreateFlagNoDefer | kFSEventStreamCreateFlagWatchRoot))
        else { return nil }

        self.stream = stream
        FSEventStreamSetDispatchQueue(stream, .main)
        FSEventStreamStart(stream)
    }

    isolated deinit {
        guard let stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
    }
}
#endif
