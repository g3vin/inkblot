import Foundation
import Observation

/// The right sidebar's state, as the shell holds it.
///
/// Mirrors what the page publishes — notes, the clipboard history, workbench tiles —
/// and reads version history and search results itself, through the core, because
/// those come from disk. It never writes the page's state: every edit is a command, and
/// the page's next publish is how the edit shows up here. That round trip is what keeps
/// a note edited in this panel and the note's hover preview in the page the same note.
/// See `bridge/sidebar.rs` for why.
@MainActor
@Observable
final class SidebarModel {
    enum Tab: String, CaseIterable, Identifiable {
        case clipboard, workbench, notes, history
        var id: String { rawValue }

        var title: String {
            switch self {
            case .clipboard: "Clipboard"
            case .workbench: "Workbench"
            case .notes: "Notes"
            case .history: "History"
            }
        }

        /// The same symbols the page's tab strip used.
        var symbol: String {
            switch self {
            case .clipboard: "doc.on.clipboard"
            case .workbench: "hammer"
            case .notes: "note.text"
            case .history: "clock"
            }
        }
    }

    var isPresented = true
    var tab: Tab = .workbench

    /* ---------------- search ---------------- */

    /// `panel` filters whatever tab is showing; every other scope searches and shows
    /// results instead — the same split the page's search bar had.
    var scope: SearchScope = .panel
    var query = ""
    var matchCase = false
    var wholeWord = false
    var useRegex = false
    private(set) var results: [SearchResult] = []
    private(set) var searchError: String?

    /* ---------------- what the page published ---------------- */

    private(set) var notesDocPath: String?
    private(set) var notes: [Note] = []
    private(set) var clipboard: [ClipboardEntry] = []
    private(set) var tiles: [WorkbenchTile] = []

    /* ---------------- history, read from disk ---------------- */

    private(set) var historyDocPath: String?
    private(set) var history: VersionHistory?
    private(set) var historyRows: [VersionRow] = []

    @ObservationIgnored private let bridge: ShellBridge
    @ObservationIgnored private let core: CoreService
    @ObservationIgnored private var searchTask: Task<Void, Never>?

    init(bridge: ShellBridge, core: CoreService) {
        self.bridge = bridge
        self.core = core
        bridge.addListener { [weak self] event in self?.handle(event) }
    }

    var projectName: String? { bridge.project.projectName }
    var projectRoot: String? { bridge.project.projectRoot }
    var activeDocPath: String? { bridge.activeEditor?.docPath }
    var target: EditorTarget? { bridge.toolbar?.target ?? bridge.activeEditor?.target }

    private func handle(_ event: WebviewEvent) {
        switch event {
        case .notesChanged(let changed):
            notesDocPath = changed.docPath
            notes = changed.notes
        case .clipboardChanged(let changed):
            clipboard = changed.entries
        case .tilesChanged(let changed):
            tiles = changed.tiles
        case .versionsChanged(let changed) where changed.docPath == historyDocPath:
            reloadHistory()
        case .activeEditorChanged(let changed):
            if changed.docPath != historyDocPath { loadHistory(for: changed.docPath) }
            if scope == .document { runSearch() }
        case .showSidebarTab(let request):
            isPresented = true
            tab = Tab(request.tab)
        case .projectChanged:
            loadHistory(for: nil)
            results = []
        default:
            break
        }
    }

    /* ---------------- history ---------------- */

    func loadHistory(for docPath: String?) {
        historyDocPath = docPath
        reloadHistory()
    }

    func reloadHistory() {
        guard let projectName, let docPath = historyDocPath else {
            history = nil
            historyRows = []
            return
        }
        let loaded = VersionHistory.load(core: core.core, projectName: projectName, docName: docPath)
        history = loaded
        historyRows = (try? loaded.rowsJson()).flatMap { try? JSONDecoder().decode([VersionRow].self, from: Data($0.utf8)) } ?? []
    }

    func spanDelta(newest: VersionRow, oldest: VersionRow) -> WordDelta {
        guard let json = try? history?.spanDeltaJson(newestId: newest.id, oldestId: oldest.id),
              let delta = try? JSONDecoder().decode(WordDelta.self, from: Data(json.utf8))
        else { return WordDelta(added: 0, removed: 0) }
        return delta
    }

    func versionText(_ row: VersionRow) -> String {
        history?.textOf(versionId: row.id) ?? ""
    }

    func versionAction(_ action: VersionAction, _ row: VersionRow? = nil) {
        guard let docPath = historyDocPath else { return }
        bridge.send(.versionAction(VersionActionCommand(docPath: docPath, action: action, versionId: row?.id)))
    }

    func renameVersion(_ row: VersionRow, to name: String) {
        guard let docPath = historyDocPath else { return }
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        bridge.send(.renameVersion(RenameVersionCommand(
            docPath: docPath, versionId: row.id, name: trimmed.isEmpty ? nil : trimmed)))
    }

    /* ---------------- notes ---------------- */

    func updateNote(_ note: Note, _ patch: NotePatch) {
        guard let docPath = notesDocPath else { return }
        bridge.send(.updateNote(UpdateNoteCommand(docPath: docPath, noteId: note.id, patch: patch)))
    }

    func removeNote(_ note: Note) {
        guard let docPath = notesDocPath else { return }
        bridge.send(.removeNote(NoteRef(docPath: docPath, noteId: note.id)))
    }

    func jump(to note: Note) {
        guard let docPath = notesDocPath else { return }
        bridge.send(.jumpToNote(NoteRef(docPath: docPath, noteId: note.id)))
    }

    /* ---------------- clipboard ---------------- */

    func dropOnClipboard(_ text: String) {
        bridge.send(.clipboardDrop(ClipboardDropCommand(text: text)))
    }

    func removeClipboard(_ ids: [String]?) {
        bridge.send(.removeClipboardEntries(RemoveClipboardEntriesCommand(ids: ids)))
    }

    func insertClipboard(_ entry: ClipboardEntry) {
        guard let target else { return }
        bridge.send(.insertClipboardEntry(InsertClipboardEntryCommand(id: entry.id, target: target)))
    }

    /* ---------------- workbench ---------------- */

    func removeTiles(_ ids: [String]?) {
        bridge.send(.removeTiles(RemoveTilesCommand(ids: ids)))
    }

    func replaceWord(of tile: WorkbenchTile, with word: String) {
        bridge.send(.replaceTileWord(ReplaceTileWordCommand(id: tile.id, word: word)))
    }

    func selectWord(of tile: WorkbenchTile) {
        bridge.send(.selectTileWord(TileRef(id: tile.id)))
    }

    /* ---------------- search ---------------- */

    var isSearching: Bool { scope != .panel }

    /// Does `text` pass the panel filter? Case-insensitive substring, as the page's was.
    func matchesFilter(_ parts: String...) -> Bool {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty, scope == .panel else { return true }
        return parts.joined(separator: " ").lowercased().contains(needle)
    }

    /// Debounced: a search per keystroke over a whole project is wasted work.
    func runSearch() {
        searchTask?.cancel()
        guard isSearching, let projectName else {
            results = []
            searchError = nil
            return
        }
        let query = query
        let options = SearchOptions(matchCase: matchCase, wholeWord: wholeWord, useRegex: useRegex)
        let scope = scope
        let docPath = activeDocPath
        searchTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(180))
            guard let self, !Task.isCancelled else { return }
            guard !query.trimmingCharacters(in: .whitespaces).isEmpty else {
                results = []
                searchError = nil
                return
            }
            do {
                let json: String
                if scope == .document {
                    guard let docPath else { results = []; return }
                    json = try core.core.searchDocumentJson(
                        projectName: projectName, docName: docPath, query: query, options: options)
                } else {
                    json = try core.core.searchProjectJson(
                        projectName: projectName, scope: scope.rawValue, query: query, options: options)
                }
                results = (try? JSONDecoder().decode([SearchResult].self, from: Data(json.utf8))) ?? []
                searchError = nil
            } catch {
                results = []
                searchError = error.localizedDescription
            }
        }
    }

    func reveal(_ result: SearchResult) {
        let anchor: TextAnchor? = if let from = result.from, let to = result.to, let text = result.matchText {
            TextAnchor(from: from, to: to, text: text)
        } else {
            nil
        }
        let noteId = (result.note?.value as? [String: Any])?["id"] as? String
        bridge.send(.revealSearchResult(RevealSearchResultCommand(
            docPath: result.docName, anchor: anchor, nodeId: result.nodeId, noteId: noteId)))
    }

    /// Replace every match in the open document, by anchor — the page resolves each by
    /// its text, so a match that moved since the save is still found, and one that is
    /// gone is skipped rather than guessed at.
    func replaceAll(with replacement: String) {
        guard scope == .document, let target else { return }
        let edits = results.compactMap { result -> RangeEdit? in
            guard let from = result.from, let to = result.to, let text = result.matchText else { return nil }
            return RangeEdit(anchor: TextAnchor(from: from, to: to, text: text), text: replacement)
        }
        guard !edits.isEmpty else { return }
        bridge.send(.replaceRanges(ReplaceRangesCommand(target: target, edits: edits)))
        results = []
        // Search reads the saved file, and the replacement reaches it with the next
        // autosave (800ms) — searching again sooner would show what was just replaced.
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(1200))
            self?.runSearch()
        }
    }
}

extension SidebarModel.Tab {
    init(_ tab: SidebarTab) {
        self = switch tab {
        case .clipboard: .clipboard
        case .workbench: .workbench
        case .notes: .notes
        case .history: .history
        }
    }
}
