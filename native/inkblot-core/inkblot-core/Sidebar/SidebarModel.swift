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
        case clipboard, workbench, notes, references, history, page, book, publish, stats
        /// The map's inspector. Not one of the layouts' panels: it is in the selector
        /// bar, first, only while a map is showing (`hasMap`).
        case map
        var id: String { rawValue }

        /// The panels a layout can hold — every one but the map's.
        static var arrangeable: [Tab] { allCases.filter { $0 != .map } }

        var title: String {
            switch self {
            case .clipboard: "Clipboard"
            case .workbench: "Workbench"
            case .notes: "Notes"
            case .references: "References"
            case .history: "History"
            case .page: "Page"
            case .book: "Book"
            case .publish: "Publish"
            case .stats: "Stats"
            case .map: "Map"
            }
        }

        /// The same symbols as the page's tab strip.
        var symbol: String {
            switch self {
            case .clipboard: "doc.on.clipboard"
            case .workbench: "hammer"
            case .notes: "note.text"
            case .references: "books.vertical"
            case .history: "clock"
            case .page: "doc.richtext"
            case .book: "book.closed"
            case .publish: "square.and.arrow.up"
            case .stats: "chart.bar.xaxis"
            case .map: "map"
            }
        }
    }

    var isPresented = true

    /* ---------------- layouts ---------------- */

    /// Which of the two sets of panels the selector bar offers.
    private(set) var layout: InspectorLayout
    /// What each layout holds, as Customize Layout… left it.
    private(set) var layouts: InspectorLayouts
    /// The tab each layout last showed, so swapping back returns to it.
    private var chosen: [InspectorLayout: Tab]
    /// Which way the last swipe went (+1 toward the end of the bar), for the panel to
    /// slide in from that side.
    private(set) var lastStep = 1
    /// Customize Layout… is showing.
    var isCustomizingLayout = false

    /// The selector bar's tabs: the layout's, after the map's while a map is showing.
    var tabs: [Tab] { hasMap ? [.map] + layouts[layout] : layouts[layout] }

    /// The panel showing. Setting one the layout does not hold switches to the layout
    /// that does; if neither does it shows anyway, with nothing lit in the bar — File ▸
    /// Page Setup… still opens Page after Page is taken out of both.
    var tab: Tab {
        get {
            if showingMap && hasMap { return .map }
            return chosen[layout] ?? layouts[layout].first ?? .workbench
        }
        set {
            showingMap = newValue == .map
            guard newValue != .map else { return }
            if !layouts[layout].contains(newValue), layouts[layout.other].contains(newValue) {
                layout = layout.other
            }
            chosen[layout] = newValue
            saveSelection()
        }
    }

    func switchLayout() {
        showLayout(layout.other)
    }

    func showLayout(_ next: InspectorLayout) {
        layout = next
        showingMap = false
        if !layouts[layout].contains(chosen[layout] ?? .map) { chosen[layout] = layouts[layout].first }
        saveSelection()
    }

    /* ---------------- the map's panel ---------------- */

    /// A map is showing — the active document, or beside it in a split, where its panel
    /// stays in the bar while the other document is worked in.
    var hasMap: Bool { bridge.mapChrome != nil }
    /// The map's panel is the one showing, while there is a map. Chosen for the writer
    /// when a map becomes active, as Xcode's inspector follows what is selected; they
    /// can move to another panel, and are left there until the next map.
    private var showingMap = false
    /// The last `revealPanel` each map asked with, so a republish shows nothing.
    @ObservationIgnored private var mapReveals: [String: UInt32] = [:]

    private func mapChanged(_ state: MapChromeState?) {
        guard let state else { return }
        let wasActive = mapReveals[state.surfaceId] != nil
        let asked = state.revealPanel != (mapReveals[state.surfaceId] ?? 0)
        mapReveals[state.surfaceId] = state.revealPanel
        if !wasActive || asked { showingMap = true }
        if asked { isPresented = true }
    }

    /// The next tab along the bar (`step` +1) or the previous one (-1). Stops at the
    /// ends rather than wrapping: a swipe past the last tab does nothing, as it does
    /// past the last page of anything else.
    func step(by step: Int) {
        let index = tabs.firstIndex(of: tab).map { $0 + step } ?? 0
        guard tabs.indices.contains(index) else { return }
        lastStep = step
        tab = tabs[index]
    }

    func editLayouts(_ change: (inout InspectorLayouts) -> Void) {
        var edited = layouts
        change(&edited)
        guard edited != layouts else { return }
        layouts = edited
        layouts.save()
        for layout in InspectorLayout.allCases where !layouts[layout].contains(chosen[layout] ?? tab) {
            chosen[layout] = layouts[layout].first
        }
        saveSelection()
    }

    private static let layoutKey = "inkblot.inspector.layout"
    private static let chosenKey = "inkblot.inspector.tabs"

    private func saveSelection() {
        UserDefaults.standard.set(layout.rawValue, forKey: Self.layoutKey)
        UserDefaults.standard.set(
            Dictionary(uniqueKeysWithValues: chosen.map { ($0.key.rawValue, $0.value.rawValue) }),
            forKey: Self.chosenKey)
    }

    /* ---------------- search ---------------- */

    /// `panel` filters whatever tab is showing; every other scope searches and shows
    /// results instead — the same split as the page's search bar.
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
    /// Each burst's word change, by its newest and oldest version. A burst's delta is a
    /// diff of two whole versions, and the list asks for every burst each time it draws —
    /// which, uncached, was the pause on opening History. Emptied with each reload.
    @ObservationIgnored private var spanDeltas: [String: WordDelta] = [:]
    /// Each document's archive, as the page last sent it (`archiveChanged`). The page owns
    /// the file it is kept in, as it owns the document.
    private(set) var archives: [String: [ArchivedItem]] = [:]
    var historyArchive: [ArchivedItem] { historyDocPath.flatMap { archives[$0] } ?? [] }

    /* ---------------- references, as the page published them ---------------- */

    /// The project's sources, formatted for the document in view.
    private(set) var references: ReferencesChanged?
    /// The kinds of source, the contributor roles and the styles — sent once.
    private(set) var referenceSchema: ReferenceSchema?
    /// The source to scroll to and open: one just added, or one ⌥-clicked in the text.
    var focusedReferenceId: String?
    /// Bumped to put the caret in quick add (Insert ▸ Add Reference…).
    private(set) var quickAddRequest = 0
    /// Quick add is picking a source to cite rather than adding one (Insert Citation…).
    var citing = false

    @ObservationIgnored private let bridge: ShellBridge
    @ObservationIgnored private let core: CoreService
    @ObservationIgnored private var searchTask: Task<Void, Never>?

    init(bridge: ShellBridge, core: CoreService) {
        self.bridge = bridge
        self.core = core
        let defaults = UserDefaults.standard
        layouts = InspectorLayouts.load(from: defaults)
        layout = defaults.string(forKey: Self.layoutKey).flatMap(InspectorLayout.init(rawValue:)) ?? .drafting
        var chosen: [InspectorLayout: Tab] = [.drafting: .workbench]
        for (key, value) in defaults.dictionary(forKey: Self.chosenKey) as? [String: String] ?? [:] {
            if let layout = InspectorLayout(rawValue: key), let tab = Tab(rawValue: value) { chosen[layout] = tab }
        }
        self.chosen = chosen
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
        case .archiveChanged(let changed):
            archives[changed.docPath] = changed.items
        case .referencesChanged(let changed):
            references = changed
        case .referenceSchema(let schema):
            referenceSchema = schema
        case .revealReference(let reveal):
            isPresented = true
            tab = .references
            focusedReferenceId = reveal.id
        case .versionsChanged(let changed) where changed.docPath == historyDocPath:
            reloadHistory()
        case .activeEditorChanged(let changed):
            if changed.docPath != historyDocPath { loadHistory(for: changed.docPath) }
            if scope == .document { runSearch() }
        case .mapChromeChanged(let changed):
            // A map that stopped being active starts fresh next time: its panel comes
            // back when it does.
            if changed.state == nil { mapReveals = [:] }
            mapChanged(changed.state)
        case .showSidebarTab(let request):
            isPresented = true
            tab = Tab(request.tab)
        case .projectChanged:
            loadHistory(for: nil)
            archives = [:]
            references = nil
            focusedReferenceId = nil
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
            spanDeltas = [:]
            historyRows = []
            return
        }
        let loaded = VersionHistory.load(core: core.core, projectName: projectName, docName: docPath)
        history = loaded
        spanDeltas = [:]
        historyRows = (try? loaded.rowsJson()).flatMap { try? JSONDecoder().decode([VersionRow].self, from: Data($0.utf8)) } ?? []
    }

    func spanDelta(newest: VersionRow, oldest: VersionRow) -> WordDelta {
        let key = "\(newest.id)|\(oldest.id)"
        if let cached = spanDeltas[key] { return cached }
        guard let json = try? history?.spanDeltaJson(newestId: newest.id, oldestId: oldest.id),
              let delta = try? JSONDecoder().decode(WordDelta.self, from: Data(json.utf8))
        else { return WordDelta(added: 0, removed: 0) }
        spanDeltas[key] = delta
        return delta
    }

    func versionText(_ row: VersionRow) -> String {
        history?.textOf(versionId: row.id) ?? ""
    }

    func versionAction(_ action: VersionAction, _ row: VersionRow? = nil) {
        guard let docPath = historyDocPath else { return }
        bridge.send(.versionAction(VersionActionCommand(docPath: docPath, action: action, versionId: row?.id)))
    }

    /// Restore or delete something in the archive of the document History is showing.
    func archiveAction(_ action: ArchiveAction, _ item: ArchivedItem) {
        guard let docPath = historyDocPath else { return }
        bridge.send(.archiveAction(ArchiveActionCommand(docPath: docPath, itemId: item.id, action: action)))
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
        updateNote(note, in: docPath, patch)
    }

    /// For the hover cards, which know which document their marker is in — it may not
    /// be the one the Notes tab is showing.
    func updateNote(_ note: Note, in docPath: String, _ patch: NotePatch) {
        bridge.send(.updateNote(UpdateNoteCommand(docPath: docPath, noteId: note.id, patch: patch)))
    }

    func addReply(to note: Note, in docPath: String) {
        bridge.send(.addReply(AddReplyCommand(docPath: docPath, parentNoteId: note.id)))
    }

    func removeNote(_ note: Note) {
        guard let docPath = notesDocPath else { return }
        removeNote(note, in: docPath)
    }

    /// For the hover cards, as `updateNote(_:in:_:)`.
    func removeNote(_ note: Note, in docPath: String) {
        bridge.send(.removeNote(NoteRef(docPath: docPath, noteId: note.id)))
    }

    func jump(to note: Note) {
        guard let docPath = notesDocPath else { return }
        bridge.send(.jumpToNote(NoteRef(docPath: docPath, noteId: note.id)))
    }

    /* ---------------- references ---------------- */

    /// Open References with the caret in quick add; `cite` to pick a source to cite.
    func beginQuickAdd(cite: Bool) {
        isPresented = true
        tab = .references
        citing = cite
        quickAddRequest += 1
    }

    /// Look `input` up and add it to the document in view. Returns the new source's id.
    @discardableResult
    func addReference(_ input: String, cite: Bool = false) -> String {
        let id = Self.newReferenceId()
        bridge.send(.addReference(AddReferenceCommand(id: id, docPath: references?.docPath, input: input, cite: cite)))
        focusedReferenceId = id
        return id
    }

    /// A new, empty source of `kind`, for entering by hand.
    @discardableResult
    func createReference(kind: String) -> String {
        let id = Self.newReferenceId()
        bridge.send(.createReference(CreateReferenceCommand(id: id, docPath: references?.docPath, kind: kind)))
        focusedReferenceId = id
        return id
    }

    func updateReference(_ id: String, _ patch: ReferencePatch) {
        bridge.send(.updateReference(UpdateReferenceCommand(id: id, patch: patch)))
    }

    func deleteReference(_ id: String) {
        bridge.send(.deleteReference(ReferenceRef(id: id)))
    }

    func retryLookup(_ id: String) {
        bridge.send(.retryReferenceLookup(ReferenceRef(id: id)))
    }

    func chooseCandidate(_ id: String, index: Int) {
        bridge.send(.chooseReferenceCandidate(ChooseReferenceCandidateCommand(id: id, index: UInt32(index))))
    }

    func setAttached(_ id: String, _ attached: Bool) {
        guard let docPath = references?.docPath else { return }
        bridge.send(.setReferenceAttached(SetReferenceAttachedCommand(docPath: docPath, id: id, attached: attached)))
    }

    func cite(_ ids: [String], locator: String? = nil) {
        guard !ids.isEmpty else { return }
        bridge.send(.insertCitation(InsertCitationCommand(target: target, refIds: ids, locator: locator)))
    }

    func insertBibliography() {
        bridge.send(.insertBibliography(InsertBibliographyCommand(target: target)))
    }

    func setCitationStyle(_ style: String, projectDefault: Bool = false) {
        bridge.send(.setCitationStyle(SetCitationStyleCommand(
            docPath: references?.docPath, style: style, makeProjectDefault: projectDefault || references?.docPath == nil)))
    }

    /// Step through the styles, for ⌃⌘] and ⌃⌘[.
    func cycleCitationStyle(by step: Int) {
        guard let styles = referenceSchema?.styles, !styles.isEmpty else { return }
        let current = styles.firstIndex { $0.id == references?.style } ?? 0
        setCitationStyle(styles[(current + step + styles.count) % styles.count].id)
    }

    func setBibliographyOptions(_ change: (inout BibliographyEdit) -> Void) {
        guard let docPath = references?.docPath, let current = references?.bibliography else { return }
        var edit = BibliographyEdit(current)
        change(&edit)
        bridge.send(.setBibliographyOptions(SetBibliographyOptionsCommand(docPath: docPath, options: edit.options)))
    }

    private static func newReferenceId() -> String {
        "ref-\(UUID().uuidString.prefix(13).lowercased())"
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

    /// Does `text` pass the panel filter? Case-insensitive substring, as in the page.
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
        case .references: .references
        }
    }
}
