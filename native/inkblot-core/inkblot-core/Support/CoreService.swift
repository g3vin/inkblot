import Foundation

/// `inkblot-core`, as the shell uses it.
///
/// Rooted at the same directory the Tauri app resolves `appDataDir()` to, on purpose:
/// both shells are the same app to the user, and a project opened in one has to be
/// there in the other. The app sandbox is off for the same reason — a sandboxed build
/// would be redirected into its own container and see none of it, and projects can
/// live anywhere on disk besides.
@MainActor
final class CoreService {
    static let shared = CoreService()

    /// The Tauri app's bundle identifier. Not this app's — see above.
    static let dataIdentifier = "com.inkblot.app"

    let appDataRoot: URL
    let core: InkblotCore

    private init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        appDataRoot = support.appendingPathComponent(Self.dataIdentifier, isDirectory: true)
        try? FileManager.default.createDirectory(at: appDataRoot, withIntermediateDirectories: true)
        core = InkblotCore(appDataRoot: appDataRoot.path, sessionId: UUID().uuidString)
    }

    /// A project's tree, decoded into the typeshare type — see `inkblot-ffi` for why
    /// it crosses as JSON.
    func projectTree(_ projectName: String) throws -> TreeNode {
        let json = try core.projectTreeJson(projectName: projectName)
        return try JSONDecoder().decode(TreeNode.self, from: Data(json.utf8))
    }
}

