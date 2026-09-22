import AppKit
import SwiftUI

/// The project's files, natively — what replaces the page's `LeftSidebar`/`FileTree`.
///
/// Browsing is local: the tree is read from disk by the core and kept current by
/// FSEvents (`ProjectTree`). **Every change goes through the page**, as a protocol
/// command — `createEntry`, `renameEntry`, `moveEntry`, `deleteEntry`,
/// `duplicateEntry`. That is not deference, it is correctness: the page may be holding
/// the path being changed, and its pane's last autosave would otherwise recreate the
/// old one (see `useEntryOperations`). The page closes what the entry touches, waits for
/// those saves, does the disk operation and reopens at the new paths.
struct FileTreeSidebar: View {
    @Environment(AppModel.self) private var model
    @State private var selection: String?
    @State private var prompt: NamePrompt?
    @State private var pendingDelete: TreeEntry?

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
        .sheet(item: $prompt) { current in
            NamePromptSheet(prompt: current) { name in
                perform(current.action, name: name)
                prompt = nil
            } cancel: {
                prompt = nil
            }
        }
        .confirmationDialog(
            pendingDelete.map { "Delete “\($0.displayName)”?" } ?? "",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { entry in
            Button("Delete", role: .destructive) {
                model.bridge.send(.deleteEntry(DeleteEntryCommand(path: entry.path, isFolder: entry.isFolder)))
            }
        } message: { entry in
            Text(entry.isFolder
                 ? "The folder and everything in it will be deleted. This can’t be undone."
                 : "This can’t be undone.")
        }
    }

    /* ---------------- the list ---------------- */

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
            contextMenu(for: paths.first.map(entry(at:)))
        }
        // Dropping on the empty part of the list moves to the project root.
        .dropDestination(for: String.self) { paths, _ in move(paths, to: "") }
        .safeAreaInset(edge: .bottom) {
            HStack {
                Menu {
                    newItems(in: "")
                } label: {
                    Image(systemName: "plus")
                }
                .menuStyle(.button)
                .buttonStyle(.borderless)
                .menuIndicator(.hidden)
                .fixedSize()
                .padding(8)
                .glassEffect(.regular.interactive(), in: .circle)
                .help("New Document, Canvas or Folder")
                Spacer()
            }
            .padding(10)
        }
    }

    @ViewBuilder
    private func row(_ node: TreeNode) -> some View {
        let label = Label {
            Text(node.type == .folder ? node.name : docDisplayName(path: node.path))
                .lineLimit(1)
        } icon: {
            Image(systemName: icon(for: node))
        }
        .tag(node.path)
        .draggable(node.path)

        if node.type == .folder {
            label.dropDestination(for: String.self) { paths, _ in move(paths, to: node.path) }
        } else {
            label
        }
    }

    private func icon(for node: TreeNode) -> String {
        if node.type == .folder { return "folder" }
        return isCanvasDoc(path: node.path) ? "rectangle.on.rectangle" : "doc.text"
    }

    /* ---------------- menus ---------------- */

    @ViewBuilder
    private func newItems(in folder: String) -> some View {
        Button("New Document", systemImage: "doc.text") { ask(.create(.document, in: folder)) }
        Button("New Canvas", systemImage: "rectangle.on.rectangle") { ask(.create(.canvas, in: folder)) }
        Button("New Folder", systemImage: "folder") { ask(.create(.folder, in: folder)) }
    }

    @ViewBuilder
    private func contextMenu(for entry: TreeEntry?) -> some View {
        newItems(in: entry?.containingFolder ?? "")
        if let entry {
            Divider()
            Button("Rename…") { ask(.rename(entry)) }
            if !entry.isFolder {
                Button("Duplicate") {
                    model.bridge.send(.duplicateEntry(DuplicateEntryCommand(path: entry.path)))
                }
            }
            Menu("Move To") {
                ForEach(moveTargets(for: entry), id: \.self) { folder in
                    Button(folder.isEmpty ? (model.tree.projectName ?? "Project") : folder) {
                        _ = move([entry.path], to: folder)
                    }
                }
            }
            Divider()
            Button("Reveal in Finder") { reveal(entry) }
            Divider()
            Button("Delete…", role: .destructive) { pendingDelete = entry }
        }
    }

    /* ---------------- entries ---------------- */

    private func entry(at path: String) -> TreeEntry {
        TreeEntry(path: path, isFolder: !model.tree.filePaths.contains(path))
    }

    /// Every folder an entry could move into: not where it already is, and — for a
    /// folder — not into itself or anything under it.
    private func moveTargets(for entry: TreeEntry) -> [String] {
        var folders = [""]
        func walk(_ node: TreeNode) {
            for child in node.children ?? [] where child.type == .folder {
                folders.append(child.path)
                walk(child)
            }
        }
        model.tree.root.map(walk)
        return folders.filter { folder in
            folder != entry.containingFolder
                && !(entry.isFolder && (folder == entry.path || folder.hasPrefix(entry.path + "/")))
        }
    }

    @discardableResult
    private func move(_ paths: [String], to folder: String) -> Bool {
        var moved = false
        for path in paths {
            let source = entry(at: path)
            guard moveTargets(for: source).contains(folder) else { continue }
            model.bridge.send(.moveEntry(MoveEntryCommand(path: path, isFolder: source.isFolder, targetFolder: folder)))
            moved = true
        }
        return moved
    }

    private func ask(_ action: NamePrompt.Action) {
        prompt = NamePrompt(action: action)
    }

    private func perform(_ action: NamePrompt.Action, name: String) {
        switch action {
        case .create(let kind, let folder):
            model.bridge.send(.createEntry(CreateEntryCommand(parentFolder: folder, name: name, kind: kind)))
        case .rename(let entry):
            model.bridge.send(.renameEntry(RenameEntryCommand(path: entry.path, isFolder: entry.isFolder, newName: name)))
        }
    }

    private func reveal(_ entry: TreeEntry) {
        guard let root = model.tree.projectRoot else { return }
        let base = URL(fileURLWithPath: root).appendingPathComponent(entry.path)
        NSWorkspace.shared.activateFileViewerSelecting([entry.isFolder ? base : base.appendingPathExtension("json")])
    }
}

/// One row of the tree, as the menus and commands need it.
struct TreeEntry: Hashable, Identifiable {
    let path: String
    let isFolder: Bool

    var id: String { path }
    var name: String { String(path.split(separator: "/").last ?? "") }
    var displayName: String { isFolder ? name : docDisplayName(path: path) }
    /// Where a new entry made "here" goes: inside a folder, or beside a file.
    var containingFolder: String {
        isFolder ? path : path.split(separator: "/").dropLast().joined(separator: "/")
    }
}

/// A question that ends in a name: creating something, or renaming it.
struct NamePrompt: Identifiable {
    enum Action {
        case create(EntryKind, in: String)
        case rename(TreeEntry)
    }

    let id = UUID()
    let action: Action

    var title: String {
        switch action {
        case .create(.document, _): "New Document"
        case .create(.canvas, _): "New Canvas"
        case .create(.folder, _): "New Folder"
        case .rename(let entry): "Rename “\(entry.displayName)”"
        }
    }

    var confirm: String {
        if case .rename = action { return "Rename" }
        return "Create"
    }

    var initialName: String {
        if case .rename(let entry) = action { return entry.displayName }
        return ""
    }
}

private struct NamePromptSheet: View {
    let prompt: NamePrompt
    let commit: (String) -> Void
    let cancel: () -> Void
    @State private var name = ""
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(prompt.title).font(.headline)
            TextField("Name", text: $name)
                .textFieldStyle(.roundedBorder)
                .frame(minWidth: 280)
                .onSubmit(submit)
            if let error {
                Text(error).font(.callout).foregroundStyle(.red)
            }
            HStack {
                Spacer()
                Button("Cancel", role: .cancel, action: cancel).keyboardShortcut(.cancelAction)
                Button(prompt.confirm, action: submit)
                    .keyboardShortcut(.defaultAction)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(20)
        .onAppear { name = prompt.initialName }
    }

    /// The same rules the page's tree applies: no slash (it would make a path), no
    /// leading dot (the tree hides dotfiles, so the entry would vanish). The `.canvas`
    /// suffix is the page's to add or strip, by kind.
    private func submit() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        guard !trimmed.contains("/") else {
            error = "Names can’t contain “/”."
            return
        }
        guard !trimmed.hasPrefix(".") else {
            error = "Names can’t start with a dot."
            return
        }
        commit(trimmed)
    }
}
