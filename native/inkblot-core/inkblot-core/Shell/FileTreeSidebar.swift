#if os(macOS)
import AppKit
#endif
import SwiftUI

/// The project's files, natively — the Swift app's counterpart to the page's
/// `LeftSidebar`/`FileTree`, which do not render when this does.
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
    @State private var filter = TreeFilter()
    @State private var expansion: ProjectOutline.ExpansionRequest?

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
        let shown = filter.apply(to: model.tree.root, recent: Set(model.tree.recent))
        return ProjectOutline(
            root: shown,
            numbers: model.tree.chapterNumbers,
            isFiltered: filter.isActive,
            expansion: expansion,
            selection: $selection,
            // A filtered tree hides siblings, so a drop's index among the rows shown is
            // not its index in the folder.
            canDrop: { paths, folder, index in
                !filter.isActive && paths.contains { accepts($0, into: folder, at: index) }
            },
            drop: { paths, folder, index in drop(paths, into: folder, at: index) },
            menu: { path in contextMenu(for: path.map(entry(at:))) })
        .overlay {
            if filter.isActive && (shown?.children ?? []).isEmpty {
                Text(filter.recentOnly && model.tree.recent.isEmpty ? "No Recent Files" : "No Matching Files")
                    .foregroundStyle(.secondary)
            }
        }
        .overlay(alignment: .bottom) {
            GlassEffectContainer {
                HStack(spacing: 8) {
                    // The tab bar's sizes: a 28-point round button, a 24-point capsule.
                    // Sized outside the menu: a borderless menu ignores its label's frame.
                    Menu {
                        newItems(in: "")
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 13, weight: .medium))
                    }
                    .menuStyle(.button)
                    .buttonStyle(.borderless)
                    .menuIndicator(.hidden)
                    .fixedSize()
                    .frame(width: 28, height: 28)
                    .contentShape(.circle)
                    .glassEffect(.regular.interactive(), in: .circle)
                    .help("New Document, Canvas, Map or Folder")

                    FilterBar(filter: $filter) { expansion = .init() }
                }
                .onGeometryChange(for: CGFloat.self, of: { $0.frame(in: .global).midY }) { midY in
                    if model.sidebarBarMidY != midY { model.sidebarBarMidY = midY }
                }
            }
            .padding(10)
        }
    }

    /* ---------------- menus ---------------- */

    @ViewBuilder
    private func newItems(in folder: String) -> some View {
        Button("New Document", systemImage: "doc.text") { ask(.create(.document, in: folder)) }
        Button("New Canvas", systemImage: "rectangle.on.rectangle") { ask(.create(.canvas, in: folder)) }
        Button("New Map", systemImage: "map") { ask(.create(.map, in: folder)) }
        Button("New Folder", systemImage: "folder") { ask(.create(.folder, in: folder)) }
    }

    /// AppKit items, because the outline view asks for its menu per click.
    private func contextMenu(for entry: TreeEntry?) -> [NSMenuItem] {
        let folder = entry?.containingFolder ?? ""
        var items: [NSMenuItem] = [
            ClosureMenuItem("New Document", systemImage: "doc.text") { ask(.create(.document, in: folder)) },
            ClosureMenuItem("New Canvas", systemImage: "rectangle.on.rectangle") { ask(.create(.canvas, in: folder)) },
            ClosureMenuItem("New Map", systemImage: "map") { ask(.create(.map, in: folder)) },
            ClosureMenuItem("New Folder", systemImage: "folder") { ask(.create(.folder, in: folder)) },
        ]
        guard let entry else { return items }
        if !entry.isFolder {
            // A tab of its own, or beside what is open. Not split against itself: the
            // primary pane already has it, and one document is never in both.
            var open = [ClosureMenuItem("Open in New Tab", systemImage: "plus.square.on.square") {
                model.tabs.openInTab(entry.path)
            }]
            if entry.path != model.tabs.currentDoc {
                open.append(ClosureMenuItem("Open in Split Right", systemImage: "rectangle.split.2x1") {
                    model.tabs.openSplit(.columns, docPath: entry.path)
                })
                open.append(ClosureMenuItem("Open in Split Below", systemImage: "rectangle.split.1x2") {
                    model.tabs.openSplit(.rows, docPath: entry.path)
                })
            }
            items.insert(contentsOf: open + [.separator()], at: 0)
        }
        if entry.isFolder { items.append(contentsOf: bookItems(for: entry.path)) }
        items.append(.separator())
        items.append(ClosureMenuItem("Rename…") { ask(.rename(entry)) })
        if !entry.isFolder {
            items.append(ClosureMenuItem("Duplicate") {
                model.bridge.send(.duplicateEntry(DuplicateEntryCommand(path: entry.path)))
            })
        }
        let moveTo = NSMenuItem(title: "Move To", action: nil, keyEquivalent: "")
        let submenu = NSMenu()
        for target in moveTargets(for: entry) {
            submenu.addItem(ClosureMenuItem(target.isEmpty ? (model.tree.projectName ?? "Project") : target) {
                drop([entry.path], into: target, at: nil)
            })
        }
        moveTo.submenu = submenu
        moveTo.isEnabled = !submenu.items.isEmpty
        items.append(moveTo)
        items.append(.separator())
        items.append(ClosureMenuItem("Reveal in Finder") { reveal(entry) })
        items.append(.separator())
        items.append(ClosureMenuItem("Delete…") { pendingDelete = entry })
        return items
    }

    /// A folder's book options: its documents numbered in the tree, and read as one.
    private func bookItems(for folder: String) -> [NSMenuItem] {
        let start = model.tree.numberedFolders[folder]
        let numbered = start != nil
        let from0 = start == 0
        let send = { (number: Bool?, start: UInt32?, continuous: Bool?) in
            model.bridge.send(.setFolderBookOptions(SetFolderBookOptionsCommand(
                folder: folder, numberInTree: number, startAt: start, continuous: continuous)))
        }
        let numbers = NSMenuItem(title: "Number Documents", action: nil, keyEquivalent: "")
        let submenu = NSMenu()
        let off = ClosureMenuItem("Off") { send(false, nil, nil) }
        off.state = numbered ? .off : .on
        let one = ClosureMenuItem("From 1") { send(true, 1, nil) }
        one.state = numbered && !from0 ? .on : .off
        let zero = ClosureMenuItem("From 0") { send(true, 0, nil) }
        zero.state = from0 ? .on : .off
        [off, one, zero].forEach(submenu.addItem)
        numbers.submenu = submenu
        let continuous = ClosureMenuItem("Read as One Document") {
            send(nil, nil, !model.tree.continuousFolders.contains(folder))
        }
        continuous.state = model.tree.continuousFolders.contains(folder) ? .on : .off
        return [.separator(), numbers, continuous]
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

    /// Move entries into `folder` at `index` among its children, as the drop showed it;
    /// `nil` — a drop onto the folder itself, or Move To — puts them last. A drop in
    /// the folder an entry is already in only reorders it: the order is the shell's,
    /// and the disk does not change. Anything else is a move, which the page performs.
    @discardableResult
    private func drop(_ paths: [String], into folder: String, at index: Int?) -> Bool {
        var index = index
        var dropped = false
        for path in paths where accepts(path, into: folder, at: index) {
            let source = entry(at: path)
            let newPath = folder.isEmpty ? source.name : "\(folder)/\(source.name)"
            if source.containingParent != folder {
                model.bridge.send(.moveEntry(MoveEntryCommand(path: path, isFolder: source.isFolder, targetFolder: folder)))
                model.statsFollowMove(of: path, into: folder, isFolder: source.isFolder)
            }
            let placed = model.tree.place(path: path, isFolder: source.isFolder, newPath: newPath, in: folder, at: index)
            index = index.map { _ in placed + 1 }
            dropped = true
        }
        return dropped
    }

    /// Whether dropping `path` there does anything: a reorder needs a place to go, and a
    /// move needs a folder it may enter with its name free. The move is a rename on
    /// disk, and a rename onto a name that is taken replaces what had it.
    private func accepts(_ path: String, into folder: String, at index: Int?) -> Bool {
        let source = entry(at: path)
        if source.containingParent == folder { return index != nil }
        let intoItself = source.isFolder && (folder == path || folder.hasPrefix(path + "/"))
        return !intoItself && !isTaken(source.name, isFolder: source.isFolder, in: folder)
    }

    private func isTaken(_ name: String, isFolder: Bool, in folder: String) -> Bool {
        let children = folder.isEmpty ? model.tree.root?.children : node(at: folder)?.children
        return (children ?? []).contains { $0.name == name && ($0.type == .folder) == isFolder }
    }

    private func node(at path: String) -> TreeNode? {
        func find(_ nodes: [TreeNode]) -> TreeNode? {
            for node in nodes {
                if node.path == path { return node }
                if path.hasPrefix(node.path + "/"), let found = find(node.children ?? []) { return found }
            }
            return nil
        }
        return find(model.tree.root?.children ?? [])
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
            model.statsFollowRename(of: entry.path, to: name, isFolder: entry.isFolder)
        }
    }

    /// Show in Finder. There is no Finder on iPadOS; the Files app is the nearest thing,
    /// and it can only be sent a folder.
    private func reveal(_ entry: TreeEntry) {
        guard let root = model.tree.projectRoot else { return }
        let base = URL(fileURLWithPath: root).appendingPathComponent(entry.path)
        #if os(macOS)
        NSWorkspace.shared.activateFileViewerSelecting([entry.isFolder ? base : base.appendingPathExtension("json")])
        #else
        let folder = entry.isFolder ? base : base.deletingLastPathComponent()
        if let files = URL(string: "shareddocuments://" + folder.path) { Platform.open(files) }
        #endif
    }
}

/// The field beside the "+", as Xcode's navigator has under its lists: a menu of what
/// to show, the text to match, and buttons for recent files and expanding everything.
private struct FilterBar: View {
    @Binding var filter: TreeFilter
    let toggleExpansion: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 6) {
            Menu {
                Picker("Show", selection: $filter.kind) {
                    ForEach(TreeFilter.Kind.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.inline)
            } label: {
                HStack(spacing: 1) {
                    Image(systemName: "line.3.horizontal.decrease.circle")
                    Image(systemName: "chevron.down").font(.system(size: 7, weight: .bold))
                }
                .foregroundStyle(filter.kind == .all ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tint))
            }
            .menuStyle(.button)
            .buttonStyle(.borderless)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("Filter Options")

            TextField("Filter", text: $filter.text)
                .textFieldStyle(.plain)
                .focused($focused)
                .onExitCommand { filter.text = "" }

            if !filter.text.isEmpty {
                button("xmark.circle.fill", help: "Clear Filter") { filter.text = "" }
            }
            button("clock", help: "Show Only Recent Files", on: filter.recentOnly) {
                filter.recentOnly.toggle()
            }
            button("plusminus.circle", help: "Expand or Collapse All Folders", action: toggleExpansion)
        }
        .font(.system(size: 12))
        .imageScale(.small)
        .padding(.horizontal, 9)
        .frame(height: 24)
        .glassEffect(.regular.interactive(), in: .capsule)
        .contentShape(.capsule)
        .onTapGesture { focused = true }
    }

    private func button(_ symbol: String, help: String, on: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
        }
        .buttonStyle(.borderless)
        .foregroundStyle(on ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
        .help(help)
    }
}

/// One row of the tree, as the menus and commands need it.
struct TreeEntry: Hashable, Identifiable {
    let path: String
    let isFolder: Bool

    var id: String { path }
    var name: String { String(path.split(separator: "/").last ?? "") }
    var displayName: String { isFolder ? name : docDisplayName(path: path) }
    /// The folder the entry is in.
    var containingParent: String { TreeOrder.parent(of: path) }
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
        case .create(.map, _): "New Map"
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
