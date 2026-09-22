import AppKit
import SwiftUI

/// The project's files, natively — what replaces the page's `LeftSidebar`/`FileTree`.
///
/// **What it does:** browse, open (as `openDocument` over the bridge, into the pane the
/// page elects), create documents and folders, reveal in the Finder.
///
/// **What it does not do yet, and why.** Rename, move and delete are not here. Each
/// one changes a path the page may be holding — the open document, a tab, a split
/// pane, the per-document editor-state cache — and the page's own tree updates all of
/// those in the same breath as it touches the disk. Doing the disk half from here
/// would leave the page autosaving to a path that no longer exists, which recreates
/// the file under its old name. Those operations need protocol commands the page
/// applies (`entryRenamed`, `entryDeleted`) before they can move. HANDOFF.md tracks it.
struct FileTreeSidebar: View {
    @Environment(AppModel.self) private var model
    @State private var selection: String?
    @State private var creating: NewEntryKind?
    @State private var newName = ""
    @State private var createError: String?

    enum NewEntryKind: Identifiable {
        case document(parent: String)
        case folder(parent: String)
        var id: String {
            switch self {
            case .document(let parent): "doc:\(parent)"
            case .folder(let parent): "folder:\(parent)"
            }
        }
    }

    var body: some View {
        Group {
            if model.tree.projectName == nil {
                ContentUnavailableView(
                    "No Project Open",
                    systemImage: "folder",
                    description: Text("Choose a project in the window."))
            } else if let error = model.tree.loadError {
                ContentUnavailableView(
                    "Couldn’t Read the Project",
                    systemImage: "exclamationmark.triangle",
                    description: Text(error))
            } else {
                list
            }
        }
        .navigationTitle(model.tree.projectName ?? "Inkblot")
        .onChange(of: model.bridge.activeEditor?.docPath) { _, docPath in
            // Follow the page: a document opened from a tab, a search result or a
            // canvas card is selected here too — without sending it back as a command.
            if let docPath, docPath != selection { selection = docPath }
        }
        .onChange(of: selection) { _, path in
            guard let path, model.tree.filePaths.contains(path),
                  path != model.bridge.activeEditor?.docPath else { return }
            model.bridge.send(.openDocument(OpenDocumentCommand(path: path, pane: .primary)))
        }
        .sheet(item: $creating) { kind in
            NewEntrySheet(kind: kind, name: $newName, error: createError) { commit(kind) } cancel: {
                creating = nil
            }
        }
    }

    private var list: some View {
        List(selection: $selection) {
            if let children = model.tree.root?.children {
                OutlineGroup(children, id: \.path, children: \.outlineChildren) { node in
                    row(node)
                }
            }
        }
        .listStyle(.sidebar)
        .contextMenu(forSelectionType: String.self) { paths in
            contextMenu(for: paths.first)
        }
        .safeAreaInset(edge: .bottom) {
            HStack {
                Menu {
                    Button("New Document", systemImage: "doc") { begin(.document(parent: "")) }
                    Button("New Folder", systemImage: "folder") { begin(.folder(parent: "")) }
                } label: {
                    Image(systemName: "plus")
                }
                .menuStyle(.button)
                .buttonStyle(.borderless)
                .menuIndicator(.hidden)
                .fixedSize()
                .padding(8)
                .glassEffect(.regular.interactive(), in: .circle)
                .help("New Document or Folder")
                Spacer()
            }
            .padding(10)
        }
    }

    private func row(_ node: TreeNode) -> some View {
        Label {
            Text(node.type == .folder ? node.name : docDisplayName(path: node.path))
                .lineLimit(1)
        } icon: {
            Image(systemName: icon(for: node))
        }
        .tag(node.path)
    }

    private func icon(for node: TreeNode) -> String {
        if node.type == .folder { return "folder" }
        return isCanvasDoc(path: node.path) ? "rectangle.on.rectangle" : "doc.text"
    }

    @ViewBuilder
    private func contextMenu(for path: String?) -> some View {
        let parent = path.map(parentFolder(of:)) ?? ""
        Button("New Document") { begin(.document(parent: parent)) }
        Button("New Folder") { begin(.folder(parent: parent)) }
        if let path {
            Divider()
            Button("Reveal in Finder") { reveal(path) }
        }
    }

    /* ---------------- creating ---------------- */

    /// The folder a new entry goes in: the folder itself if a folder was clicked, the
    /// file's folder if a file was.
    private func parentFolder(of path: String) -> String {
        if !model.tree.filePaths.contains(path) { return path }
        return path.split(separator: "/").dropLast().joined(separator: "/")
    }

    private func begin(_ kind: NewEntryKind) {
        newName = ""
        createError = nil
        creating = kind
    }

    private func commit(_ kind: NewEntryKind) {
        guard let project = model.tree.projectName else { return }
        // A slash would make a nested path out of a name, and `.canvas` would route a
        // text document to the canvas editor — the same rule the page's tree applies.
        let name = newName.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "/", with: "-")
        guard !name.isEmpty, !name.hasPrefix(".") else {
            createError = "Choose a name that does not start with a dot."
            return
        }

        do {
            switch kind {
            case .document(let parent):
                let path = parent.isEmpty ? name : "\(parent)/\(name)"
                guard !isCanvasDoc(path: path) else {
                    createError = "Documents can’t end in .canvas."
                    return
                }
                try model.core.core.createDocument(projectName: project, docName: path)
                model.tree.reload()
                selection = path
            case .folder(let parent):
                let path = parent.isEmpty ? name : "\(parent)/\(name)"
                try model.core.core.createFolder(projectName: project, folderPath: path)
                model.tree.reload()
            }
            creating = nil
        } catch {
            createError = error.localizedDescription
        }
    }

    private func reveal(_ path: String) {
        guard let root = model.tree.projectRoot else { return }
        let base = URL(fileURLWithPath: root).appendingPathComponent(path)
        let target = model.tree.filePaths.contains(path) ? base.appendingPathExtension("json") : base
        NSWorkspace.shared.activateFileViewerSelecting([target])
    }
}

private struct NewEntrySheet: View {
    let kind: FileTreeSidebar.NewEntryKind
    @Binding var name: String
    let error: String?
    let commit: () -> Void
    let cancel: () -> Void

    private var title: String {
        switch kind {
        case .document: "New Document"
        case .folder: "New Folder"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.headline)
            TextField("Name", text: $name)
                .textFieldStyle(.roundedBorder)
                .frame(minWidth: 260)
                .onSubmit(commit)
            if let error {
                Text(error).font(.callout).foregroundStyle(.red)
            }
            HStack {
                Spacer()
                Button("Cancel", role: .cancel, action: cancel).keyboardShortcut(.cancelAction)
                Button("Create", action: commit)
                    .keyboardShortcut(.defaultAction)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(20)
    }
}
