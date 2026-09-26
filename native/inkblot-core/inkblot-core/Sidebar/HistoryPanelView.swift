import SwiftUI

/// The History tab: the document's versions as a timeline of days and bursts of edits.
///
/// Rows come from the core (`VersionHistory.rowsJson` — deltas, diff snippets and
/// session colours, all computed by the same diff engine the page uses). Grouping into
/// days is done here because a "day" is the viewer's, in their time zone; the burst
/// rule is the page's `groupVersions`: a new group at a named version, a new session,
/// or a gap of more than fifteen minutes.
///
/// Every action is a command, performed by the page under the lock its autosave writes
/// the history with; the page then announces `versionsChanged` and this re-reads.
///
/// The archive button opens the document's archive (`ArchiveListView`) in its place.
struct HistoryPanelView: View {
    @Environment(AppModel.self) private var model
    @State private var filter = HistoryFilter.all
    @State private var expanded: Set<String> = []
    /// The version whose actions are showing under it. One at a time, so the list stays
    /// a list to scan rather than a wall of buttons.
    @State private var selected: String?
    @State private var renaming: VersionRow?
    @State private var pendingDelete: VersionRow?
    @State private var showingArchive = false

    /// In Typeset, which history: the book's typesetting, or the document's text.
    @State private var showingText = false

    var body: some View {
        if model.pageLayout.mode == .typeset && !showingText {
            TypesetHistoryView { showingText = true }
        } else if showingArchive && isTextDocument {
            ArchiveListView { showingArchive = false }
        } else {
            versions
        }
    }

    private var versions: some View {
        let sidebar = model.sidebar
        let sections = sections
        return Form {
            if model.pageLayout.mode == .typeset {
                Section {
                    Picker("History", selection: Binding(get: { showingText }, set: { showingText = $0 })) {
                        Text("Typeset").tag(false)
                        Text("Text").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                }
            }
            Section {
                HStack(spacing: 8) {
                    SegmentedTextPicker(options: HistoryFilter.allCases, selection: $filter, title: \.title)
                        .accessibilityLabel("Show")
                    // Only prose has things archived out of it; a canvas or map has none.
                    if isTextDocument {
                        Button("Archive", systemImage: "archivebox") { showingArchive = true }
                            .labelStyle(.iconOnly)
                            .buttonStyle(.borderless)
                            .disabled(sidebar.historyDocPath == nil)
                            .help("View the archive: things put away out of this document")
                    }
                }
                Button {
                    sidebar.versionAction(.snapshot)
                } label: {
                    Label("Snapshot Now", systemImage: "plus.circle.fill")
                        .frame(maxWidth: .infinity)
                }
                .disabled(sidebar.historyDocPath == nil)
                .help("Save the current state as a version you can name")
            } footer: {
                Text(caption)
            }

            if sections.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label(emptyTitle, systemImage: "clock")
                    } description: {
                        Text(emptyDescription)
                    }
                }
            } else {
                ForEach(sections) { section in
                    Section(section.label) {
                        ForEach(section.groups) { group in
                            groupView(group)
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
        .sheet(item: $renaming) { row in
            RenameVersionSheet(row: row) { name in
                sidebar.renameVersion(row, to: name)
                renaming = nil
            } cancel: { renaming = nil }
        }
        .confirmationDialog("Delete this version?", isPresented: Binding(
            get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }
        ), presenting: pendingDelete) { row in
            Button("Delete", role: .destructive) { sidebar.versionAction(.delete, row) }
        }
    }

    private var emptyTitle: String {
        model.sidebar.historyRows.isEmpty ? "No Versions Yet" : (filter == .named ? "No Named Versions" : "No Matching Versions")
    }

    /// A rich-text document, rather than a canvas or a map.
    private var isTextDocument: Bool {
        guard let path = model.sidebar.historyDocPath else { return true }
        return !isCanvasDoc(path: path) && !isMapDoc(path: path)
    }

    private var emptyDescription: String {
        guard let path = model.sidebar.historyDocPath else { return "Open a document to see its history." }
        if isMapDoc(path: path) { return "Checkpoints appear as you work on the map." }
        if isCanvasDoc(path: path) { return "Checkpoints appear as you work on the canvas." }
        return "Checkpoints appear as you write."
    }

    /// Which document, and how much history it has.
    private var caption: String {
        let sidebar = model.sidebar
        guard let path = sidebar.historyDocPath else { return "No document open" }
        let rows = sidebar.historyRows
        let named = rows.filter { $0.name != nil }.count
        var text = "\(docDisplayName(path: path)) · \(rows.count.formatted()) \(rows.count == 1 ? "version" : "versions")"
        if named > 0 { text += ", \(named.formatted()) named" }
        return text
    }

    /* ---------------- grouping ---------------- */

    struct Group: Identifiable {
        let id: String
        var rows: [VersionRow]
        let named: Bool
    }

    struct DaySection: Identifiable {
        let id: String
        let label: String
        var groups: [Group]
    }

    private static let burstGap: TimeInterval = 15 * 60

    private var sections: [DaySection] {
        let sidebar = model.sidebar
        var list = sidebar.historyRows
        if filter == .named { list = list.filter { $0.name != nil } }
        if !sidebar.query.isEmpty {
            list = list.filter { row in
                sidebar.matchesFilter(row.name ?? "", row.timestamp, sidebar.versionText(row))
            }
        }

        var sections: [DaySection] = []
        var previousTime: Date?
        var previousSession: String?
        let calendar = Calendar.current

        for row in list {
            let time = Self.date(row.timestamp) ?? .distantPast
            let dayKey = calendar.startOfDay(for: time)
            let dayId = "\(dayKey.timeIntervalSince1970)"

            if sections.last?.id != dayId {
                sections.append(DaySection(id: dayId, label: Self.dayLabel(time), groups: []))
                previousTime = nil
            }

            let gap = previousTime.map { abs($0.timeIntervalSince(time)) } ?? .infinity
            let sameSession = row.sessionId == previousSession
            let last = sections[sections.count - 1].groups.last
            if row.name != nil || last == nil || last!.named || gap > Self.burstGap || !sameSession {
                sections[sections.count - 1].groups.append(Group(id: row.id, rows: [row], named: row.name != nil))
            } else {
                sections[sections.count - 1].groups[sections[sections.count - 1].groups.count - 1].rows.append(row)
            }
            previousTime = time
            previousSession = row.sessionId
        }
        return sections
    }

    /* ---------------- rows ---------------- */

    @ViewBuilder
    private func groupView(_ group: Group) -> some View {
        if group.rows.count == 1 {
            rowView(group.rows[0])
        } else {
            let newest = group.rows[0]
            let oldest = group.rows[group.rows.count - 1]
            let isExpanded = Binding(
                get: { expanded.contains(group.id) },
                set: { if $0 { expanded.insert(group.id) } else { expanded.remove(group.id) } }
            )
            DisclosureGroup(isExpanded: isExpanded) {
                ForEach(group.rows, id: \.id) { rowView($0) }
            } label: {
                HStack(spacing: 6) {
                    SessionDot(color: newest.sessionColor)
                    Text("\(Self.time(oldest.timestamp)) – \(Self.time(newest.timestamp))")
                    Text("\(group.rows.count) edits").foregroundStyle(.secondary)
                    Spacer()
                    DeltaBadge(delta: model.sidebar.spanDelta(newest: newest, oldest: oldest))
                }
                // The whole label opens the burst, not only its chevron.
                .contentShape(Rectangle())
                .onTapGesture { withAnimation(.snappy(duration: 0.2)) { isExpanded.wrappedValue.toggle() } }
                .help("\(group.rows.count) checkpoints in one burst of writing")
            }
        }
    }

    private func rowView(_ row: VersionRow) -> some View {
        let isSelected = selected == row.id
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                SessionDot(color: row.sessionColor)
                if let name = row.name {
                    Image(systemName: "tag.fill")
                        .font(.caption)
                        .foregroundStyle(.tint)
                    Text(name)
                        .fontWeight(.semibold)
                        .lineLimit(1)
                    Text(Self.time(row.timestamp))
                        .foregroundStyle(.secondary)
                        .fixedSize()
                } else {
                    Text(Self.time(row.timestamp))
                }
                Spacer(minLength: 4)
                DeltaBadge(delta: row.delta)
                Menu {
                    actions(row)
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .foregroundStyle(.secondary)
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .help("More actions")
            }
            preview(row)
                .font(.callout)
                .lineLimit(isSelected ? 8 : 2)
                .frame(maxWidth: .infinity, alignment: .leading)
            if isSelected {
                HStack(spacing: 8) {
                    Button("Restore", systemImage: "clock.arrow.circlepath") { model.sidebar.versionAction(.restore, row) }
                        .help("Replace the document with this version")
                    Button("Compare", systemImage: "arrow.left.arrow.right") { model.sidebar.versionAction(.compare, row) }
                        .help("Compare this version with the current document")
                    Spacer()
                }
                .controlSize(.small)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .onTapGesture {
            withAnimation(.snappy(duration: 0.2)) { selected = isSelected ? nil : row.id }
        }
        .help(Self.fullTimestamp(row.timestamp))
        .contextMenu { actions(row) }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? [.isSelected, .isButton] : .isButton)
    }

    /// Everything a version can do, for its menu and its context menu alike.
    @ViewBuilder
    private func actions(_ row: VersionRow) -> some View {
        let sidebar = model.sidebar
        Button("Restore This Version", systemImage: "clock.arrow.circlepath") { sidebar.versionAction(.restore, row) }
        Button("Compare with Current", systemImage: "arrow.left.arrow.right") { sidebar.versionAction(.compare, row) }
        Button("Make a Copy", systemImage: "doc.on.doc") { sidebar.versionAction(.makeCopy, row) }
        Divider()
        Button(row.name == nil ? "Name This Version…" : "Rename…", systemImage: "tag") { renaming = row }
        Button("Delete…", systemImage: "trash", role: .destructive) { pendingDelete = row }
    }

    /// The change, as the page's ChangeSnippet draws it: context, then what was added
    /// and what was struck out.
    private func preview(_ row: VersionRow) -> Text {
        if let summary = row.summary { return Text(summary).foregroundStyle(.secondary) }
        return row.snippet.reduce(Text("")) { text, op in
            let words = op.tokens.joined(separator: " ") + " "
            switch op.type {
            case .equal: return text + Text(words).foregroundStyle(.secondary)
            case .added: return text + Text(words).foregroundStyle(.green)
            case .removed: return text + Text(words).strikethrough().foregroundStyle(.red)
            }
        }
    }

    /* ---------------- formatting ---------------- */

    private static let isoParser: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static func date(_ iso: String) -> Date? {
        isoParser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }

    static func time(_ iso: String) -> String {
        date(iso)?.formatted(date: .omitted, time: .shortened) ?? ""
    }

    static func fullTimestamp(_ iso: String) -> String {
        date(iso)?.formatted(date: .abbreviated, time: .standard) ?? iso
    }

    static func dayLabel(_ date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "Today" }
        if calendar.isDateInYesterday(date) { return "Yesterday" }
        return date.formatted(date: .complete, time: .omitted)
    }
}

/// The editing-session colour. The core gives it as CSS `hsl(h, s%, l%)`.
struct SessionDot: View {
    let color: String
    var body: some View {
        Circle()
            .fill(Self.parse(color) ?? Color.secondary)
            .frame(width: 8, height: 8)
    }

    static func parse(_ css: String) -> Color? {
        let numbers = css.components(separatedBy: CharacterSet(charactersIn: "0123456789.").inverted)
            .compactMap(Double.init)
        guard css.hasPrefix("hsl"), numbers.count >= 3 else { return nil }
        // HSL to HSB: SwiftUI has no HSL initializer.
        let h = numbers[0] / 360, s = numbers[1] / 100, l = numbers[2] / 100
        let v = l + s * min(l, 1 - l)
        let sv = v == 0 ? 0 : 2 * (1 - l / v)
        return Color(hue: h, saturation: sv, brightness: v)
    }
}

struct DeltaBadge: View {
    let delta: WordDelta
    var body: some View {
        HStack(spacing: 3) {
            if delta.added > 0 { Text("+\(delta.added)").foregroundStyle(.green) }
            if delta.removed > 0 { Text("−\(delta.removed)").foregroundStyle(.red) }
        }
        .font(.caption.monospacedDigit())
    }
}

private struct RenameVersionSheet: View {
    let row: VersionRow
    let commit: (String) -> Void
    let cancel: () -> Void
    @State private var name = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Name This Version").font(.headline)
            TextField("e.g. First Draft", text: $name)
                .textFieldStyle(.roundedBorder)
                .frame(minWidth: 280)
                .onSubmit { commit(name) }
            Text("Leave it empty to make it an ordinary checkpoint again.")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Spacer()
                Button("Cancel", role: .cancel, action: cancel).keyboardShortcut(.cancelAction)
                Button("Save") { commit(name) }.keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .onAppear { name = row.name ?? "" }
    }
}

extension VersionRow: Identifiable {}

/// The History tab's filter: every checkpoint, or only the versions given a name.
enum HistoryFilter: String, CaseIterable, Identifiable {
    case all, named
    var id: String { rawValue }
    var title: String {
        switch self {
        case .all: "All"
        case .named: "Named"
        }
    }
}
