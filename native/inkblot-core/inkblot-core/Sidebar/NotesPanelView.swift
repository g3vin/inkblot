import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// The Notes tab: the active document's notes as a tree of replies.
///
/// Ordering is the page's `compareNotes`: pinned first, then anchored notes in document
/// order, then free notes, newest first. Every edit is a `NotePatch` — see
/// `bridge/sidebar.rs` for why never a whole note.
struct NotesPanelView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let sidebar = model.sidebar
        let branches = NoteTree.build(sidebar.notes) { note in
            sidebar.matchesFilter(note.anchor, note.content)
        }
        if branches.isEmpty {
            ContentUnavailableView(
                sidebar.notes.isEmpty ? "No Notes Yet" : "No Matching Notes",
                systemImage: "note.text",
                description: Text(sidebar.notes.isEmpty ? "Select text in the document and choose Add Note." : ""))
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(branches) { branch in
                        NoteBranchView(branch: branch, depth: 0, filtering: !sidebar.query.isEmpty)
                    }
                }
                .padding(12)
            }
        }
    }
}

/// A note and its replies, pruned to what matches the filter.
struct NoteTree: Identifiable {
    let note: Note
    let children: [NoteTree]
    var id: String { note.id }

    static func build(_ notes: [Note], matches: (Note) -> Bool) -> [NoteTree] {
        let sorted = notes.sorted(by: NoteTree.ordered)
        let byParent = Dictionary(grouping: sorted) { $0.parentNoteId ?? "" }
        func branch(_ note: Note) -> NoteTree? {
            let children = (byParent[note.id] ?? []).compactMap(branch)
            guard matches(note) || !children.isEmpty else { return nil }
            return NoteTree(note: note, children: children)
        }
        return (byParent[""] ?? []).compactMap(branch)
    }

    /// `compareNotes` in `noteUtils.js`.
    static func ordered(_ a: Note, _ b: Note) -> Bool {
        if a.pinned != b.pinned { return a.pinned }
        let aFree = a.type == .free, bFree = b.type == .free
        if aFree != bFree { return !aFree }
        if !aFree {
            let aFrom = a.from ?? .greatestFiniteMagnitude
            let bFrom = b.from ?? .greatestFiniteMagnitude
            if aFrom != bFrom { return aFrom < bFrom }
        }
        return a.updatedAt > b.updatedAt
    }
}

private struct NoteBranchView: View {
    let branch: NoteTree
    let depth: Int
    let filtering: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            NoteCardView(note: branch.note, hasChildren: !branch.children.isEmpty)
                .padding(.leading, CGFloat(depth) * 16)
            if !branch.note.collapsedChildren || filtering {
                ForEach(branch.children) { child in
                    NoteBranchView(branch: child, depth: depth + 1, filtering: filtering)
                }
            }
        }
    }
}

/// One note. Used by the Notes tab and by the glass hover card over the document.
struct NoteCardView: View {
    @Environment(AppModel.self) private var model
    let note: Note
    var hasChildren = false
    var glass = false

    @State private var draft = ""
    @State private var confirmDelete = false
    @FocusState private var editing: Bool
    @State private var commitTask: Task<Void, Never>?

    static let colors = ["#ffd54f", "#ff9aa2", "#9ad0f5", "#9ee493", "#c7a8ff", "#ffb86b"]

    var body: some View {
        let sidebar = model.sidebar
        let accent = Color(hex: note.color) ?? .accentColor

        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                if note.type == .quote {
                    Button { sidebar.jump(to: note) } label: {
                        Text("“\(note.anchor)”")
                            .font(.callout.italic())
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                    .buttonStyle(.plain)
                    .help("Show in the document")
                }
                Spacer(minLength: 4)
                actions
            }

            TextField("Type your note here…", text: $draft, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(editing ? 3...20 : 1...6)
                .focused($editing)
                .onChange(of: draft) { _, text in scheduleCommit(text) }
                .onChange(of: editing) { _, isEditing in if !isEditing { commit(draft) } }

            if !note.images.isEmpty { images }
            if !note.audio.isEmpty { memos }

            HStack(spacing: 10) {
                if editing || glass { attachControls }
                Spacer()
                Text(note.timestamp).font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .background(alignment: .leading) {
            if !glass {
                RoundedRectangle(cornerRadius: 2).fill(accent).frame(width: 3).padding(.vertical, 8)
            }
        }
        .background {
            if !glass {
                RoundedRectangle(cornerRadius: 12).fill(.background.secondary)
            }
        }
        .onAppear { draft = note.content }
        .onChange(of: note.content) { _, content in
            // The page is the source of truth, but not while the user is typing here —
            // its echo of a half-committed draft would move the caret.
            if !editing { draft = content }
        }
        .dropDestination(for: URL.self) { urls, _ in attachImages(urls) }
        .confirmationDialog("Delete note?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive) { sidebar.removeNote(note) }
        } message: {
            if hasChildren { Text("Its replies will be deleted too.") }
        }
    }

    private var actions: some View {
        let sidebar = model.sidebar
        return HStack(spacing: 2) {
            if hasChildren {
                Button {
                    sidebar.updateNote(note, .with(collapsedChildren: !note.collapsedChildren))
                } label: {
                    Image(systemName: note.collapsedChildren ? "chevron.right" : "chevron.down")
                }
                .help(note.collapsedChildren ? "Expand branch" : "Collapse branch")
            }
            Menu {
                ForEach(Self.colors, id: \.self) { hex in
                    Button { sidebar.updateNote(note, .with(color: hex)) } label: {
                        Label(hex, systemImage: note.color == hex ? "checkmark.circle.fill" : "circle.fill")
                    }
                    .tint(Color(hex: hex))
                }
            } label: {
                Circle().fill(Color(hex: note.color) ?? .accentColor).frame(width: 10, height: 10)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("Note color")
            Button {
                sidebar.updateNote(note, .with(pinned: !note.pinned))
            } label: {
                Image(systemName: note.pinned ? "pin.fill" : "pin")
            }
            .help(note.pinned ? "Unpin note" : "Pin note")
            Button { confirmDelete = true } label: { Image(systemName: "xmark") }
                .help("Delete note")
        }
        .buttonStyle(.borderless)
        .font(.caption)
    }

    private var images: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(note.images, id: \.id) { image in
                    if let nsImage = NSImage.fromDataURI(image.src) {
                        Image(nsImage: nsImage)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 64, height: 64)
                            .clipShape(.rect(cornerRadius: 8))
                            .contextMenu {
                                Button("Remove Image", role: .destructive) {
                                    model.sidebar.updateNote(note, .with(
                                        images: note.images.filter { $0.id != image.id }))
                                }
                            }
                    }
                }
            }
        }
        .scrollIndicators(.never)
    }

    private var memos: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(note.audio, id: \.id) { clip in
                HStack(spacing: 6) {
                    Button {
                        if let root = model.sidebar.projectRoot { model.memoPlayer.toggle(clip, projectRoot: root) }
                    } label: {
                        Image(systemName: model.memoPlayer.playingClipId == clip.id ? "pause.fill" : "play.fill")
                    }
                    Text(formatMemoDuration(clip.durationMs)).font(.caption.monospacedDigit())
                    Spacer()
                    Button {
                        model.sidebar.updateNote(note, .with(audio: note.audio.filter { $0.id != clip.id }))
                    } label: { Image(systemName: "xmark") }
                    .help("Delete voice memo")
                }
                .buttonStyle(.borderless)
            }
        }
    }

    private var attachControls: some View {
        let recorder = model.memoRecorder
        return HStack(spacing: 8) {
            Button {
                if recorder.isRecording(note.id) {
                    guard let root = model.sidebar.projectRoot,
                          let clip = recorder.stop(projectRoot: root) else { return }
                    model.sidebar.updateNote(note, .with(audio: note.audio + [clip]))
                } else {
                    Task { await recorder.start(for: note.id) }
                }
            } label: {
                if recorder.isRecording(note.id) {
                    Label(formatMemoDuration(recorder.elapsed * 1000), systemImage: "stop.circle.fill")
                        .foregroundStyle(.red)
                } else {
                    Image(systemName: "mic")
                }
            }
            .help(recorder.error ?? (recorder.isRecording(note.id) ? "Stop recording" : "Record a voice memo"))
            .disabled(recorder.recordingNoteId != nil && !recorder.isRecording(note.id))

            Button { pickImages() } label: { Image(systemName: "photo") }
                .help("Add image")
        }
        .buttonStyle(.borderless)
        .font(.caption)
    }

    /* ---------------- editing ---------------- */

    /// Commit a pause after the last keystroke, so the page — and the autosave behind it —
    /// sees a note being written without a message per character.
    private func scheduleCommit(_ text: String) {
        commitTask?.cancel()
        commitTask = Task {
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            commit(text)
        }
    }

    private func commit(_ text: String) {
        commitTask?.cancel()
        guard text != note.content else { return }
        model.sidebar.updateNote(note, .with(content: text))
    }

    private func pickImages() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.allowedContentTypes = [.image]
        guard panel.runModal() == .OK else { return }
        _ = attachImages(panel.urls)
    }

    /// Note images are inlined as data URIs — the page's format, see `NoteImage`.
    private func attachImages(_ urls: [URL]) -> Bool {
        let added = urls.compactMap { url -> NoteImage? in
            guard let type = UTType(filenameExtension: url.pathExtension), type.conforms(to: .image),
                  let mime = type.preferredMIMEType,
                  let data = try? Data(contentsOf: url) else { return nil }
            return NoteImage(id: UUID().uuidString.lowercased(),
                             src: "data:\(mime);base64,\(data.base64EncodedString())",
                             mimeType: mime)
        }
        guard !added.isEmpty else { return false }
        model.sidebar.updateNote(note, .with(images: note.images + added))
        return true
    }
}

extension NotePatch {
    /// A patch naming only what changed. The generated memberwise init requires every
    /// field; this is the one with defaults.
    static func with(content: String? = nil, color: String? = nil, pinned: Bool? = nil,
                     collapsedChildren: Bool? = nil, images: [NoteImage]? = nil,
                     audio: [AudioClip]? = nil) -> NotePatch {
        .with(content: content, color: color, pinned: pinned, collapsedChildren: collapsedChildren,
                  images: images, audio: audio)
    }
}

extension NSImage {
    static func fromDataURI(_ uri: String) -> NSImage? {
        guard uri.hasPrefix("data:"), let comma = uri.firstIndex(of: ",") else { return nil }
        guard let data = Data(base64Encoded: String(uri[uri.index(after: comma)...])) else { return nil }
        return NSImage(data: data)
    }
}

extension Color {
    /// `#rgb` / `#rrggbb`, as notes store their colour.
    init?(hex: String) {
        var value = hex.trimmingCharacters(in: .whitespaces)
        guard value.hasPrefix("#") else { return nil }
        value.removeFirst()
        if value.count == 3 { value = value.map { "\($0)\($0)" }.joined() }
        guard value.count == 6, let rgb = Int(value, radix: 16) else { return nil }
        self.init(red: Double((rgb >> 16) & 0xff) / 255,
                  green: Double((rgb >> 8) & 0xff) / 255,
                  blue: Double(rgb & 0xff) / 255)
    }
}
