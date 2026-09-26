import SwiftUI

/// A document's archive, opened from the History tab: everything put away out of the
/// document, newest first, to look at, restore or delete.
///
/// The page keeps the archive in the document's file and sends it whole
/// (`archiveChanged`); restoring and deleting are commands it performs (`archiveAction`).
/// For now the only kind is a bubble session archived from its sentence, but the list
/// is for anything a writer puts aside — a new kind needs only its label and icon here.
struct ArchiveListView: View {
    @Environment(AppModel.self) private var model
    let back: () -> Void
    @State private var pendingDelete: ArchivedItem?

    var body: some View {
        let sidebar = model.sidebar
        Form {
            Section {
                HStack {
                    Button("History", systemImage: "chevron.left", action: back)
                        .buttonStyle(.borderless)
                        .help("Back to the document's versions")
                    Spacer()
                    Text("Archive").font(.headline)
                }
            } footer: {
                if !sidebar.historyArchive.isEmpty {
                    Text("\(sidebar.historyArchive.count.formatted()) archived")
                }
            }

            if sidebar.historyArchive.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label("Nothing Archived", systemImage: "archivebox")
                    } description: {
                        Text(sidebar.historyDocPath == nil
                            ? "Open a document to see its archive."
                            : "Things you archive, like a bubble, are kept here.")
                    }
                }
            } else {
                Section {
                    ForEach(sidebar.historyArchive, id: \.id) { item in
                        row(item)
                            .contextMenu {
                                Button("Restore", systemImage: "arrow.uturn.backward") { sidebar.archiveAction(.restore, item) }
                                Button("Delete…", systemImage: "trash", role: .destructive) { pendingDelete = item }
                            }
                    }
                }
            }
        }
        .formStyle(.grouped)
        .confirmationDialog("Delete this for good?", isPresented: Binding(
            get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }
        ), presenting: pendingDelete) { item in
            Button("Delete", role: .destructive) { sidebar.archiveAction(.delete, item) }
        } message: { _ in
            Text("Version history still has the document from before it was archived.")
        }
    }

    private func row(_ item: ArchivedItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Label(Self.label(item.kind), systemImage: Self.icon(item.kind))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tint)
                Spacer()
                Text(HistoryPanelView.fullTimestamp(item.archivedAt))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(item.title.isEmpty ? "Untitled" : item.title)
                .font(.system(.body, design: .serif))
                .lineLimit(4)
            HStack {
                Button("Restore") { sidebar.archiveAction(.restore, item) }
                    .help("Put it back into the document. A bubble goes back on its sentence, if the sentence is still there as it was.")
                Button("Delete", systemImage: "trash", role: .destructive) { pendingDelete = item }
                    .labelStyle(.iconOnly)
                    .help("Delete it for good")
            }
            .controlSize(.small)
        }
        .padding(.vertical, 4)
    }

    private var sidebar: SidebarModel { model.sidebar }

    static func label(_ kind: ArchivedKind) -> String {
        switch kind {
        case .bubble: "Bubble"
        }
    }

    static func icon(_ kind: ArchivedKind) -> String {
        switch kind {
        case .bubble: "bubble.left.and.bubble.right"
        }
    }
}
