import SwiftUI

/// The History tab in Typeset: the book's typeset versions, apart from its text's.
///
/// A version is kept a while after the typesetting changes, when the writer saves one,
/// and whenever the book is printed or exported — so the interior sent to the printer
/// can always be had again. Each says what changed since the one before. A version can
/// be previewed as pages, compared beside the current ones, or restored: restoring puts
/// its typesetting back onto the text as it is now, and never changes a word.
struct TypesetHistoryView: View {
    @Environment(AppModel.self) private var model
    let showText: () -> Void
    @State private var naming = false
    @State private var newName = ""
    @State private var renaming: TypesetVersionRow?
    @State private var pendingDelete: TypesetVersionRow?
    @State private var pendingRestore: TypesetVersionRow?

    var body: some View {
        let layout = model.pageLayout
        let history = layout.typesetHistory
        let rows = history?.rows ?? []
        Form {
            Section {
                Picker("History", selection: Binding(get: { false }, set: { if $0 { showText() } })) {
                    Text("Typeset").tag(false)
                    Text("Text").tag(true)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                Button {
                    newName = ""
                    naming = true
                } label: {
                    Label("Save Typeset Version…", systemImage: "plus.circle.fill")
                        .frame(maxWidth: .infinity)
                }
                .keyboardShortcut("s", modifiers: [.command, .option])
                .help("Keep the book’s typesetting as it is now, under a name (⌥⌘S)")
                if let previewing = history?.previewing {
                    HStack {
                        Text(history?.comparing == true ? "Comparing in the pages" : "Previewing in the pages").foregroundStyle(.secondary)
                        Spacer()
                        Button("Restore") { pendingRestore = rows.first { $0.id == previewing } }
                        Button("Done") { layout.previewTypesetVersion(nil) }
                    }
                    .font(.callout)
                }
                if let note = history?.note {
                    FinishingCaution(text: note)
                }
            } footer: {
                Text(rows.isEmpty ? "No typeset versions yet" : "\(rows.count) typeset \(rows.count == 1 ? "version" : "versions") of this book")
            }

            if rows.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label("No Typeset Versions Yet", systemImage: "textformat")
                    } description: {
                        Text("A version is kept as you typeset the book, and each time it is printed or exported.")
                    }
                }
            } else {
                ForEach(days(rows), id: \.label) { day in
                    Section(day.label) {
                        ForEach(day.rows, id: \.id) { row in rowView(row, previewing: history?.previewing == row.id) }
                    }
                }
            }
        }
        .formStyle(.grouped)
        .alert("Save Typeset Version", isPresented: $naming) {
            TextField("Name", text: $newName, prompt: Text("Sent to the printer"))
            Button("Save") { layout.saveTypesetVersion(newName) }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Rename", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $newName)
            Button("Rename") {
                if let row = renaming { layout.renameTypesetVersion(row.id, to: newName) }
                renaming = nil
            }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
        .confirmationDialog("Delete this typeset version?", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }), presenting: pendingDelete) { row in
            Button("Delete", role: .destructive) { layout.deleteTypesetVersion(row.id) }
        }
        .confirmationDialog("Restore this typeset?", isPresented: Binding(get: { pendingRestore != nil }, set: { if !$0 { pendingRestore = nil } }), presenting: pendingRestore) { row in
            Button("Restore") { layout.restoreTypesetVersion(row.id) }
        } message: { _ in
            Text("The book’s typesetting goes back to this version. The text is not changed, and the typeset it replaces is kept first.")
        }
    }

    private func rowView(_ row: TypesetVersionRow, previewing: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: symbol(row.kind)).foregroundStyle(.secondary)
                Text(row.name ?? time(row.timestamp)).fontWeight(row.name != nil ? .semibold : .regular)
                Spacer()
                if row.name != nil { Text(time(row.timestamp)).font(.caption).foregroundStyle(.secondary) }
            }
            ForEach(Array(row.summary.prefix(4).enumerated()), id: \.offset) { _, line in
                Text(line).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            if row.summary.count > 4 {
                Text("and \(row.summary.count - 4) more").font(.caption).foregroundStyle(.tertiary)
            }
            HStack(spacing: 8) {
                Button(previewing ? "Previewing" : "Preview") { model.pageLayout.previewTypesetVersion(row.id) }
                    .disabled(previewing)
                Button("Compare") { model.pageLayout.previewTypesetVersion(row.id, compare: true) }
                Button("Restore…") { pendingRestore = row }
                Spacer()
                Menu {
                    Button("Name…") {
                        newName = row.name ?? ""
                        renaming = row
                    }
                    Button("Delete…", role: .destructive) { pendingDelete = row }
                } label: { Image(systemName: "ellipsis.circle") }
                    .menuStyle(.borderlessButton)
                    .menuIndicator(.hidden)
                    .fixedSize()
            }
            .controlSize(.small)
            .buttonStyle(.borderless)
        }
        .padding(.vertical, 2)
        .listRowBackground(previewing ? Color.accentColor.opacity(0.12) : nil)
    }

    private func symbol(_ kind: TypesetVersionKind) -> String {
        switch kind {
        case .auto: "clock"
        case .named: "bookmark.fill"
        case .export: "printer.fill"
        case .restore: "arrow.uturn.backward"
        }
    }

    private struct Day { let label: String; let rows: [TypesetVersionRow] }

    /// The rows by the day they were kept, in the viewer's own time zone.
    private func days(_ rows: [TypesetVersionRow]) -> [Day] {
        var out: [Day] = []
        for row in rows {
            let label = Self.day(row.timestamp)
            if out.last?.label == label {
                out[out.count - 1] = Day(label: label, rows: out[out.count - 1].rows + [row])
            } else {
                out.append(Day(label: label, rows: [row]))
            }
        }
        return out
    }

    static func date(_ iso: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }

    static func day(_ iso: String) -> String {
        guard let date = date(iso) else { return "Earlier" }
        if Calendar.current.isDateInToday(date) { return "Today" }
        if Calendar.current.isDateInYesterday(date) { return "Yesterday" }
        return date.formatted(date: .abbreviated, time: .omitted)
    }

    private func time(_ iso: String) -> String {
        Self.date(iso)?.formatted(date: .omitted, time: .shortened) ?? iso
    }
}
