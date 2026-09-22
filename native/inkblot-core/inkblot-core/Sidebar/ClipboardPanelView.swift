import AppKit
import SwiftUI

/// The Clipboard tab: the copy history.
///
/// Dragging an entry out is a plain-text drag, so it drops into the editor — or into any
/// other app — as text. Dropping text *on* the panel adds an entry, and when that text is
/// the selection being dragged out of the document, the page removes it from the
/// document: a move, as it always was (see `recentSelectionDrag.ts` for how the page
/// knows). "Insert at Cursor" is the other way in: it puts the entry at the caret and
/// takes it off the history, which is what dropping a tile into the editor did.
struct ClipboardPanelView: View {
    @Environment(AppModel.self) private var model
    @State private var dropTargeted = false
    @State private var copiedId: String?

    var body: some View {
        let sidebar = model.sidebar
        let entries = sidebar.clipboard.filter {
            sidebar.matchesFilter($0.text, $0.docName ?? "", $0.timestamp ?? "")
        }

        VStack(spacing: 0) {
            if !sidebar.clipboard.isEmpty {
                HStack {
                    Spacer()
                    Button("Clear All") { sidebar.removeClipboard(nil) }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }

            Group {
                if entries.isEmpty {
                    ContentUnavailableView(
                        sidebar.clipboard.isEmpty ? "Nothing Copied Yet" : "No Matching Entries",
                        systemImage: "doc.on.clipboard",
                        description: Text(sidebar.clipboard.isEmpty ? "Copy text, or drag a selection here." : ""))
                } else {
                    List(entries, id: \.id) { entry in
                        row(entry)
                    }
                    .listStyle(.inset)
                }
            }
        }
        .overlay {
            if dropTargeted {
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(Color.accentColor, style: StrokeStyle(lineWidth: 2, dash: [6]))
                    .padding(6)
            }
        }
        .dropDestination(for: String.self) { texts, _ in
            for text in texts where !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                sidebar.dropOnClipboard(text)
            }
            return !texts.isEmpty
        } isTargeted: { dropTargeted = $0 }
    }

    private func row(_ entry: ClipboardEntry) -> some View {
        let sidebar = model.sidebar
        return VStack(alignment: .leading, spacing: 4) {
            Text(entry.text).lineLimit(4)
            HStack {
                if let doc = entry.docName, !doc.isEmpty {
                    Text(docDisplayName(path: doc))
                }
                Spacer()
                if copiedId == entry.id {
                    Text("Copied").foregroundStyle(.tint)
                } else if let time = entry.timestamp.flatMap(HistoryPanelView.date) {
                    Text(time.formatted(date: .omitted, time: .shortened))
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
        .draggable(entry.text)
        .contextMenu {
            Button("Insert at Cursor") { sidebar.insertClipboard(entry) }
                .disabled(sidebar.target == nil)
            Button("Copy") { copy(entry) }
            Divider()
            Button("Remove", role: .destructive) { sidebar.removeClipboard([entry.id]) }
        }
        .onTapGesture(count: 2) { sidebar.insertClipboard(entry) }
        .help("Drag into the document, or double-click to insert at the cursor")
    }

    private func copy(_ entry: ClipboardEntry) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(entry.text, forType: .string)
        copiedId = entry.id
        Task {
            try? await Task.sleep(for: .seconds(1.1))
            if copiedId == entry.id { copiedId = nil }
        }
    }
}
